import { ApiError } from '@/lib/api';
import { buildPageLabels, resolvePageQuestion } from '@/lib/pdf-pages';
import { labels, type MetricName } from '@/lib/detail-model';
import { resolveYoy } from '@/lib/crawl-display';
import { canonicalPeriodFromTitle } from '@/lib/ingest-period';
import type { Evidence, MemoryMessage } from '@/lib/conversations';
import type { RetrievalRepository } from '../domain/retrieval-repository';
import type {
  QueryPlan,
  RetrievalContext,
  RetrievalMetric,
  RetrievalReport,
} from '../domain/retrieval';
import { planQuestion } from './question-planner';
import { decideDirectAnswer, outOfScopeReply, type FactLine } from './answer-policy';
import type { PassageRetriever } from './keyword-passage-retriever';

export type RetrievalObserver = (report: RetrievalReport) => Promise<void>;

function overlayPeriod(metric: RetrievalMetric, report: RetrievalReport | undefined): RetrievalMetric {
  if (!report) return metric;
  const token = canonicalPeriodFromTitle(report.title, report.publishedAt);
  return token ? { ...metric, period: token } : metric;
}

function metricLabel(name: string) {
  return labels[name as MetricName] ?? name;
}

function addUniqueReports(target: RetrievalReport[], seen: Set<string>, rows: RetrievalReport[], targetId: string) {
  for (const row of rows) {
    if (row.id === targetId || seen.has(row.id)) continue;
    seen.add(row.id);
    target.push(row);
  }
}

async function findRelatedReports(input: {
  repository: RetrievalRepository;
  target: RetrievalReport;
  reportId: string;
  period: string;
  plan: QueryPlan;
}) {
  const related: RetrievalReport[] = [];
  const seen = new Set<string>();
  if (input.plan.needsHistory) {
    addUniqueReports(related, seen, await input.repository.findCompanyHistory({
      code: input.target.code,
      excludeReportId: input.reportId,
      periodSuffix: input.period.replace(/^20\d{2}/, ''),
      limit: 10,
    }), input.reportId);
  }
  if (input.plan.namedPeerCodes.length) {
    addUniqueReports(related, seen, await input.repository.findNamedPeerReports({
      codes: input.plan.namedPeerCodes,
      preferredPeriod: input.period,
    }), input.reportId);
  }
  if (input.plan.needsPeers && input.target.industry && input.target.industry !== '待分类') {
    addUniqueReports(related, seen, await input.repository.findIndustryPeerReports({
      industry: input.target.industry,
      excludeCode: input.target.code,
      preferredPeriod: input.period,
      limit: 6,
    }), input.reportId);
  }
  return related.slice(0, 12);
}

function selectUniqueReports(reports: RetrievalReport[], metrics: RetrievalMetric[], targetId: string) {
  const seen = new Set<string>();
  return reports.filter(report => {
    const period = metrics.find(metric => metric.reportId === report.id)?.period;
    const key = `${report.code}:${period}`;
    if (report.id !== targetId && seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Orchestrates planning, structured retrieval, keyword passage retrieval, and answer policy. */
export async function retrieveContext(input: {
  reportId: string;
  question: string;
  history: MemoryMessage[];
  summary?: boolean;
  repository: RetrievalRepository;
  passageRetriever: PassageRetriever;
  observeTarget?: RetrievalObserver;
}): Promise<RetrievalContext> {
  const target = await input.repository.findReport(input.reportId);
  if (!target) throw new ApiError(404, '报告不存在');
  await input.observeTarget?.(target).catch(() => undefined);

  const currentRaw = await input.repository.findMetrics([input.reportId]);
  const current = currentRaw.map(metric => overlayPeriod(metric, target));
  const period = current[0]?.period ?? '';
  const watched = await input.repository.listWatchedCompanies();
  const plan = planQuestion({
    question: input.question,
    history: input.history,
    watched,
    currentCode: target.code,
    summary: input.summary,
  });
  if (plan.outOfScope) {
    const directAnswer = outOfScopeReply(plan.outOfScopeKind);
    return {
      question: input.question,
      retrievalQuestion: plan.retrievalQuestion,
      structuredContext: `当前报告：${target.companyName}（${target.code}）。本轮问题超出财报问答范围。`,
      industry: target.industry || '',
      evidence: [],
      passages: [],
      fallback: directAnswer,
      directAnswer,
      mode: 'out-of-scope',
      softScopeHint: false,
      metrics: [],
      peers: [],
    };
  }
  const related = await findRelatedReports({
    repository: input.repository,
    target,
    reportId: input.reportId,
    period,
    plan,
  });
  const reports = [target, ...related];
  const reportById = new Map(reports.map(report => [report.id, report]));
  const relatedMetrics = await input.repository.findMetrics(related.map(report => report.id));
  const allMetrics = [...current, ...relatedMetrics].map(metric => overlayPeriod(metric, reportById.get(metric.reportId)));
  const selectedReports = selectUniqueReports(reports, allMetrics, input.reportId);
  const selectedIds = selectedReports.map(report => report.id);
  const metrics = allMetrics.filter(metric => selectedIds.includes(metric.reportId));
  // Only flood overview KPIs when the plan actually wants a broad read
  // (summary / history / peers). Bare entity asks like「茅台学院是什么意思」
  // must not inherit revenue/net_profit/eps/roe just because metricNames is empty.
  const useDefaultOverview = !plan.metricNames.length
    && Boolean(input.summary || plan.needsHistory || plan.needsPeers);
  const relevantMetrics = metrics.filter(metric => plan.metricNames.length
    ? plan.metricNames.includes(metric.metric as typeof plan.metricNames[number])
    : useDefaultOverview && ['revenue', 'net_profit', 'eps', 'roe'].includes(metric.metric));

  const evidence: Evidence[] = [];
  const addEvidence = (item: Omit<Evidence, 'id'>) => {
    const match = evidence.find(existing => existing.reportId === item.reportId && existing.page === item.page && existing.quote === item.quote);
    if (match) return match;
    const created = { ...item, id: `E${evidence.length + 1}` };
    evidence.push(created);
    return created;
  };
  const factLines: FactLine[] = relevantMetrics.map(metric => {
    const report = reportById.get(metric.reportId)!;
    const citation = metric.sourcePage ? addEvidence({
      reportId: report.id,
      companyName: report.companyName,
      period: metric.period,
      page: metric.sourcePage,
      quote: metric.sourceLabel ?? metricLabel(metric.metric),
      metric: metric.metric,
      code: report.code,
    }) : null;
    return {
      metric,
      citation,
      line: `${report.companyName} ${metric.period} ${metricLabel(metric.metric)}：${metric.value}${metric.unit}${citation ? `【${citation.id}】` : '（无原文页码，待核验）'}`,
    };
  });
  const priorPeriod = period.replace(/^20\d{2}/, year => String(Number(year) - 1));
  const calculations: string[] = [];
  for (const fact of factLines.filter(item => item.metric.reportId === input.reportId)) {
    const prior = factLines.find(item => item.metric.period === priorPeriod
      && item.metric.metric === fact.metric.metric
      && reportById.get(item.metric.reportId)?.code === target.code);
    const yoy = resolveYoy(fact.metric.value, {
      disclosedPrior: fact.metric.priorValue,
      disclosedYoyPct: fact.metric.yoyPct,
      crossReportPrior: prior?.metric.value,
    });
    if (yoy) {
      const formula = yoy.source === 'disclosed'
        ? (yoy.naPercent ? '财报披露；跨零或基期为零，百分比记为 N/A' : '来自本份财报同比增减列')
        : yoy.naPercent
          ? '跨零或基期为零，百分比记为 N/A'
          : (fact.metric.value < 0 && (prior?.metric.value ?? 0) < 0)
            ? '公式：(本期-上期)/|上期|'
            : '公式：(本期-上期)/上期';
      const priorBit = prior
        ? `基期 ${priorPeriod}${prior.citation ? `【${prior.citation.id}】` : ''}`
        : (fact.metric.priorValue != null ? '基期来自本份财报上年同期列' : '无跨报告基期');
      calculations.push(`${metricLabel(fact.metric.metric)}同比：${yoy.label}${fact.citation ? `【${fact.citation.id}】` : ''}（${priorBit}，绝对变化 ${yoy.absoluteDelta}，${formula}）`);
    }
  }

  const chunks = await input.repository.findChunks(selectedIds.slice(0, 9), 900);
  const chunksByReport = new Map<string, typeof chunks>();
  for (const chunk of chunks) {
    const rows = chunksByReport.get(chunk.reportId) ?? [];
    if (rows.length < 400) rows.push(chunk);
    chunksByReport.set(chunk.reportId, rows);
  }
  const currentChunks = chunksByReport.get(input.reportId) ?? [];
  const pageQuery = resolvePageQuestion(plan.retrievalQuestion, buildPageLabels(currentChunks.map(chunk => ({ page: chunk.page, content: chunk.content }))));
  const passages: RetrievalContext['passages'] = [];
  const pushPassages = (report: RetrievalReport, limit: number) => {
    const metricPages = metrics.filter(metric => metric.reportId === report.id && plan.metricNames.includes(metric.metric as typeof plan.metricNames[number]))
      .flatMap(metric => metric.sourcePage ? [metric.sourcePage] : []);
    const ranked = input.passageRetriever.retrieve({ query: pageQuery, chunks: chunksByReport.get(report.id) ?? [], metricPages, limit });
    const reportPeriod = metrics.find(metric => metric.reportId === report.id)?.period ?? '';
    for (const candidate of ranked) {
      const content = input.passageRetriever.excerpt(plan.retrievalQuestion, candidate.content);
      const quote = input.passageRetriever.excerpt(plan.retrievalQuestion, content, 160);
      passages.push({
        ...addEvidence({ reportId: report.id, companyName: report.companyName, period: reportPeriod, page: candidate.page, quote, code: report.code }),
        content,
      });
    }
  };
  pushPassages(target, 6);
  for (const report of selectedReports.filter(report => report.id !== input.reportId).slice(0, 8)) pushPassages(report, 2);

  const peers = selectedReports.filter(report => report.code !== target.code).map(report => ({ code: report.code, company_name: report.companyName }));
  const relatedPeriods = [...new Set(metrics.map(metric => metric.period))].filter(Boolean);
  const structuredContext = [
    `当前报告：${target.companyName}（${target.code}），${period || '报告期尚未解析'}，行业 ${target.industry}。`,
    plan.softScopeHint
      ? '本轮问题与财报关联度可能偏低：请先用一两句简短有用的话回答用户（含常识性问题如天气），再在末尾加软提示；边界不要过硬，天气/宏观因素也可能影响业绩。不要编造本份报告里没有的财务数字。'
      : '',
    '以下数据来自服务端数据库，可含同公司其他报告期及同业已入库财报；不同公司、不同报告期严格分开。金额为原单位，ROE 变化若以差值表达请用百分点。',
    related.length ? `本轮已附带 ${related.length} 份相关财报（同公司跨期 ${related.filter(report => report.code === target.code).length} 份，同业/点名公司 ${related.filter(report => report.code !== target.code).length} 份）。可用报告期：${relatedPeriods.join('、') || '无'}。` : '',
    '同比仅当报告期后缀相同（如 2026Q1 对 2025Q1）。年报与季报可作补充参考，不得称为同比。若已提供上期或同业数据，评估业绩好坏应使用这些对比，不要以「仅有单期」为由拒绝回答。',
    ...factLines.map(fact => fact.line),
    ...calculations,
    plan.needsPeers ? `同业比较仅限上述已入库公司（${peers.length + 1} 家），不代表全行业排名；未列出的公司没有可用比较数据。` : '',
  ].filter(Boolean).join('\n');
  const decision = decideDirectAnswer({ plan, currentReportId: input.reportId, metrics, factLines, calculations, passages });
  // Never dump overview KPIs for out-of-scope asks (belt-and-suspenders if early return is skipped).
  // Scoped metric asks: fallback only matched fact lines (current report first).
  // Entity / page-text asks with no metricNames: passages only — never invent revenue.
  const fallback = decision.directAnswer ?? (plan.outOfScope
    ? outOfScopeReply(plan.outOfScopeKind)
    : (() => {
      const scopedFacts = plan.metricNames.length && !plan.needsHistory && !plan.needsPeers
        ? factLines.filter(fact => fact.metric.reportId === input.reportId)
        : factLines;
      const factCap = plan.needsPeers ? 24 : (plan.metricNames.length ? 6 : 0);
      const passageCap = plan.metricNames.length ? 3 : 6;
      const lines = [
        scopedFacts.length || passages.length
          ? (scopedFacts.length
            ? '当前返回可核验的数据与原文摘录，尚未完成 AI 归纳：'
            : '当前返回与问题相关的原文摘录，尚未完成 AI 归纳：')
          : '暂无法回答：当前报告中没有足够的已解析指标或原文证据。',
        ...scopedFacts.slice(0, factCap).map(fact => fact.line),
        ...(plan.wantsChangeCalculation ? calculations : []),
        ...passages.slice(0, passageCap).map(passage => `${passage.quote}【${passage.id}】`),
      ].filter(Boolean);
      return lines.join('\n');
    })());

  return {
    question: input.question,
    retrievalQuestion: plan.retrievalQuestion,
    structuredContext,
    industry: target.industry || '',
    evidence,
    passages,
    fallback,
    directAnswer: decision.directAnswer,
    mode: decision.mode,
    softScopeHint: Boolean(plan.softScopeHint),
    metrics: current.map(metric => ({
      announcement_id: metric.reportId,
      metric: metric.metric,
      value: metric.value,
      unit: metric.unit,
      period: metric.period,
      source_page: metric.sourcePage,
      source_label: metric.sourceLabel,
    })),
    peers,
  };
}
