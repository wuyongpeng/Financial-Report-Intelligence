import { getDb } from './db';
import { ApiError } from './api';
import { rankEvidence, relevance, unsupportedYears } from './chat-evidence';
import { buildPageLabels, resolvePageQuestion } from './pdf-pages';
import { labels, change, type MetricName } from './detail-model';
import { nameVariants, WELL_KNOWN_ALIASES } from './company-aliases';
import type { Evidence, MemoryMessage } from './conversations';
import { canonicalPeriodFromTitle } from './ingest-period';
import { healFilingLabels } from './period-heal';

type Metric = { announcement_id: string; metric: string; value: number; unit: string; period: string; source_page: number | null; source_label: string | null };
type Report = { id: string; code: string; company_name: string; industry: string; report_type: string; title: string; published_at: string };

function overlayPeriod(metric: Metric, report: Report | undefined): Metric {
  if (!report) return metric;
  const token = canonicalPeriodFromTitle(report.title, report.published_at);
  return token ? { ...metric, period: token } : metric;
}
type Chunk = { announcement_id: string; page: number; content: string };
export type RagContext = {
  question: string; retrievalQuestion: string; structuredContext: string; evidence: Evidence[];
  passages: Array<Evidence & { content: string }>; fallback: string; directAnswer?: string;
  mode: string; metrics: Metric[]; peers: Array<{ code: string; company_name: string }>;
};

const patterns: Record<string, RegExp> = {
  revenue: /营业收入|营收|收入/, net_profit: /净利|利润/, eps: /每股|EPS/i, roe: /收益率|ROE/i,
  total_assets: /资产|负债率/, total_liabilities: /负债/, operating_cash_flow: /现金流/,
  operating_cost: /成本|毛利/,
};

export function retrievalQuestion(question: string, history: MemoryMessage[]) {
  const previous = [...history].reverse().find(m => m.role === 'user')?.content;
  if (!previous) return question;
  // Supply the recent topic for elliptical follow-ups; do not let unrelated
  // earlier topics dominate an explicit new metric query.
  const hasTopic = Object.values(patterns).some(pattern => pattern.test(question));
  return !hasTopic || /那它|这个|该指标|上述|这项|这张|为什么|为何/.test(question)
    ? `${previous.slice(0, 600)}\n当前追问：${question}` : question;
}

export function excerpt(query: string, content: string, length = 1600) {
  if (content.length <= length) return content;
  // Use overlapping passages so tables/Chinese text without punctuation remain
  // searchable. Store and cite the exact substring, without generated quotes.
  const spans: Array<{ start: number; text: string; score: number }> = [];
  for (let start = 0; start < content.length; start += Math.floor(length / 2)) {
    const text = content.slice(start, start + length);
    spans.push({ start, text, score: relevance(query, text) });
  }
  return spans.sort((a, b) => b.score - a.score || a.start - b.start)[0].text;
}

function metricLabel(name: string) { return labels[name as MetricName] ?? name; }

/** Same-company multi-period context: YoY, trends, and evaluative “how is this year”. */
export function wantsCompanyHistory(query: string) {
  return /同比|环比|上年|去年|前年|历年|历史|趋势|过去|变化|增长|下降|对比|比较|业绩|好不好|好吗|怎样|怎么样|如何|今年|改善|下滑|亮眼|疲软|20\d{2}/.test(query);
}

/** Explicit peer / competitor comparison, or “A vs B”. */
export function wantsPeerCompare(query: string) {
  return /竞品|同行|同业|对标|可比公司|对比|比较|\bvs\b|versus|和.+比|与.+比/.test(query);
}

/** Judgement questions that need a baseline (prior period and/or peers), not a single print. */
export function wantsEvaluativeJudgement(query: string) {
  return /好不好|好吗|怎样|怎么样|如何|亮眼|疲软|优秀|差吗/.test(query);
}

export function mentionedCompanyCodes(
  query: string,
  watched: Array<{ code: string; company_name: string }>,
  currentCode: string,
) {
  const found = new Set<string>();
  for (const match of query.matchAll(/(?<!\d)(\d{6})(?!\d)/g)) {
    if (match[1] !== currentCode && watched.some((row) => row.code === match[1])) found.add(match[1]);
  }
  for (const row of watched) {
    if (row.code === currentCode) continue;
    if (row.company_name && query.includes(row.company_name)) {
      found.add(row.code);
      continue;
    }
    if (nameVariants(row.company_name).some((variant) => variant.length >= 2 && query.includes(variant))) {
      found.add(row.code);
    }
  }
  for (const [alias, official] of Object.entries(WELL_KNOWN_ALIASES)) {
    if (!query.includes(alias)) continue;
    const hit = watched.find((row) => row.company_name === official || row.company_name.includes(official));
    if (hit && hit.code !== currentCode) found.add(hit.code);
  }
  return [...found];
}

export async function loadRagContext(reportId: string, question: string, history: MemoryMessage[], summary = false): Promise<RagContext> {
  const db = getDb();
  const [target] = await db<Report[]>`SELECT a.id, a.code, a.company_name, a.report_type, a.title, a.published_at, c.industry
    FROM announcements a JOIN companies c ON c.code=a.code WHERE a.id=${reportId}`;
  if (!target) throw new ApiError(404, '报告不存在');
  await healFilingLabels(db, [{ id: target.id, title: target.title, published_at: target.published_at }]).catch(() => undefined);
  const currentRaw = await db<Metric[]>`SELECT announcement_id, metric, value, unit, period, source_page, source_label
    FROM financial_metrics WHERE announcement_id=${reportId} ORDER BY metric`;
  const current = currentRaw.map((m) => overlayPeriod(m, target));
  const period = current[0]?.period ?? '';
  const query = retrievalQuestion(question, history);
  const watched = await db<Array<{ code: string; company_name: string }>>`SELECT code, name AS company_name FROM companies WHERE enabled=true`;
  const namedPeerCodes = mentionedCompanyCodes(query, watched, target.code);
  const historyIntent = summary || wantsCompanyHistory(query);
  const peerIntent = wantsPeerCompare(query) || namedPeerCodes.length > 0 || wantsEvaluativeJudgement(query);
  const suffix = period.replace(/^20\d{2}/, '');
  const related: Report[] = [];
  const seenRelated = new Set<string>();
  const addRelated = (rows: Report[]) => {
    for (const row of rows) {
      if (row.id === reportId || seenRelated.has(row.id)) continue;
      seenRelated.add(row.id);
      related.push(row);
    }
  };
  if (historyIntent) {
    const historical = await db<Report[]>`SELECT a.id, a.code, a.company_name, a.report_type, a.title, a.published_at, c.industry FROM announcements a
      JOIN companies c ON c.code=a.code
      WHERE a.code=${target.code} AND a.id<>${reportId}
        AND EXISTS (SELECT 1 FROM financial_metrics m WHERE m.announcement_id=a.id)
      ORDER BY CASE
        WHEN EXISTS (
          SELECT 1 FROM financial_metrics m
          WHERE m.announcement_id=a.id AND m.period LIKE ${`%${suffix || '%'}`}
        ) THEN 0
        ELSE 1
      END, a.published_at DESC
      LIMIT 10`;
    addRelated(historical);
  }
  if (namedPeerCodes.length) {
    const namedPeers = await db<Report[]>`SELECT DISTINCT ON (a.code) a.id, a.code, a.company_name, a.report_type, a.title, a.published_at, c.industry
      FROM announcements a JOIN companies c ON c.code=a.code
      WHERE a.code IN ${db(namedPeerCodes)}
        AND EXISTS (SELECT 1 FROM financial_metrics m WHERE m.announcement_id=a.id)
      ORDER BY a.code,
        CASE WHEN EXISTS (SELECT 1 FROM financial_metrics m WHERE m.announcement_id=a.id AND m.period=${period || ''}) THEN 0 ELSE 1 END,
        a.published_at DESC`;
    addRelated(namedPeers);
  }
  if (peerIntent && target.industry && target.industry !== '待分类') {
    const peers = await db<Report[]>`SELECT DISTINCT ON (a.code) a.id, a.code, a.company_name, a.report_type, a.title, a.published_at, c.industry
      FROM announcements a JOIN companies c ON c.code=a.code
      WHERE c.industry=${target.industry} AND c.enabled=true AND a.code<>${target.code}
        AND EXISTS (SELECT 1 FROM financial_metrics m WHERE m.announcement_id=a.id)
      ORDER BY a.code,
        CASE WHEN EXISTS (SELECT 1 FROM financial_metrics m WHERE m.announcement_id=a.id AND m.period=${period || ''}) THEN 0 ELSE 1 END,
        a.published_at DESC
      LIMIT 6`;
    addRelated(peers);
  }
  if (related.length > 12) related.length = 12;
  const reports = [target, ...related];
  const reportById = new Map(reports.map((r) => [r.id, r]));
  const relatedMetrics = related.length
    ? await db<Metric[]>`SELECT announcement_id, metric, value, unit, period, source_page, source_label
    FROM financial_metrics WHERE announcement_id IN ${db(related.map(r => r.id))} ORDER BY metric`
    : [];
  const allMetrics = [...current, ...relatedMetrics].map((m) => overlayPeriod(m, reportById.get(m.announcement_id)));
  // Keep one filing per company/period. Target report always takes precedence;
  // historical revisions are ordered newest first by the query above.
  const seen = new Set<string>();
  const selectedReports = reports.filter(report => {
    const p = allMetrics.find(m => m.announcement_id === report.id)?.period;
    const key = `${report.code}:${p}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const selectedIds = selectedReports.map(r => r.id);
  const metrics = allMetrics.filter(m => selectedIds.includes(m.announcement_id));
  const named = Object.entries(patterns).filter(([, pattern]) => pattern.test(query)).map(([name]) => name);
  const relevantMetrics = metrics.filter(m => named.length ? named.includes(m.metric) : ['revenue', 'net_profit', 'eps', 'roe'].includes(m.metric));
  const evidence: Evidence[] = [];
  const add = (item: Omit<Evidence, 'id'>) => {
    const match = evidence.find(e => e.reportId === item.reportId && e.page === item.page && e.quote === item.quote);
    if (match) return match;
    const created = { ...item, id: `E${evidence.length + 1}` }; evidence.push(created); return created;
  };
  const factLines = relevantMetrics.map(m => {
    const report = reports.find(r => r.id === m.announcement_id)!;
    const cite = m.source_page ? add({ reportId: report.id, companyName: report.company_name, period: m.period, page: m.source_page, quote: m.source_label ?? metricLabel(m.metric), metric: m.metric, code: report.code }) : null;
    return { metric: m, citation: cite, line: `${report.company_name} ${m.period} ${metricLabel(m.metric)}：${m.value}${m.unit}${cite ? `【${cite.id}】` : '（无原文页码，待核验）'}` };
  });
  const priorPeriod = period.replace(/^20\d{2}/, year => String(Number(year) - 1));
  const calculations: string[] = [];
  for (const row of factLines.filter(f => f.metric.announcement_id === reportId)) {
    const prior = factLines.find(f => f.metric.period === priorPeriod && f.metric.metric === row.metric.metric && reports.find(r => r.id === f.metric.announcement_id)?.code === target.code);
    const delta = change(row.metric.value, prior?.metric.value);
    if (prior && delta !== undefined) calculations.push(`${metricLabel(row.metric.metric)}同比：${delta >= 0 ? '+' : ''}${delta.toFixed(2)}%${row.citation ? `【${row.citation.id}】` : ''}（基期 ${priorPeriod}${prior.citation ? `【${prior.citation.id}】` : ''}，公式：(本期-上期)/|上期|）`);
  }
  const chunkSourceIds = selectedIds.slice(0, 9);
  const chunkRows = chunkSourceIds.length
    ? await db<Chunk[]>`SELECT announcement_id, page, content FROM report_chunks
        WHERE announcement_id IN ${db(chunkSourceIds)} ORDER BY page LIMIT 900`
    : [];
  const chunksByReport = new Map<string, Chunk[]>();
  for (const row of chunkRows) {
    const list = chunksByReport.get(row.announcement_id) ?? [];
    if (list.length < 400) list.push(row);
    chunksByReport.set(row.announcement_id, list);
  }
  const currentChunks = chunksByReport.get(reportId) ?? [];
  const pageQuery = resolvePageQuestion(query, buildPageLabels(currentChunks));
  const primaryPages = current.filter(m => named.includes(m.metric)).flatMap(m => m.source_page ? [m.source_page] : []);
  const passages: Array<Evidence & { content: string }> = [];
  const pushRanked = (report: Report, chunks: Chunk[], metricPages: number[], limit: number) => {
    const reportPeriod = metrics.find(m => m.announcement_id === report.id)?.period ?? '';
    for (const chunk of rankEvidence(pageQuery, chunks, metricPages).slice(0, limit)) {
      const content = excerpt(query, chunk.content);
      const quote = excerpt(query, content, 160);
      passages.push({ ...add({ reportId: report.id, companyName: report.company_name, period: reportPeriod, page: chunk.page, quote, code: report.code }), content });
    }
  };
  pushRanked(target, currentChunks, primaryPages, 6);
  for (const report of selectedReports.filter(r => r.id !== reportId).slice(0, 8)) {
    const extraPages = metrics.filter(m => m.announcement_id === report.id && named.includes(m.metric)).flatMap(m => m.source_page ? [m.source_page] : []);
    pushRanked(report, chunksByReport.get(report.id) ?? [], extraPages, 2);
  }
  const missingYears = unsupportedYears(question, metrics.map(m => m.period).join(' '));
  const peers = selectedReports.filter(r => r.code !== target.code).map(({ code, company_name }) => ({ code, company_name }));
  const relatedPeriods = [...new Set(metrics.map(m => m.period))].filter(Boolean);
  const structuredContext = [
    `当前报告：${target.company_name}（${target.code}），${period || '报告期尚未解析'}，行业 ${target.industry}。`,
    '以下数据来自服务端数据库，可含同公司其他报告期及同业已入库财报；不同公司、不同报告期严格分开。金额为原单位，ROE 变化若以差值表达请用百分点。',
    related.length ? `本轮已附带 ${related.length} 份相关财报（同公司跨期 ${related.filter(r => r.code === target.code).length} 份，同业/点名公司 ${related.filter(r => r.code !== target.code).length} 份）。可用报告期：${relatedPeriods.join('、') || '无'}。` : '',
    '同比仅当报告期后缀相同（如 2026Q1 对 2025Q1）。年报与季报可作补充参考，不得称为同比。若已提供上期或同业数据，评估业绩好坏应使用这些对比，不要以「仅有单期」为由拒绝回答。',
    ...factLines.map(row => row.line), ...calculations,
    peerIntent ? `同业比较仅限上述已入库公司（${peers.length + 1} 家），不代表全行业排名；未列出的公司没有可用比较数据。` : '',
  ].filter(Boolean).join('\n');
  let directAnswer: string | undefined;
  let mode = 'evidence-retrieval';
  if (/买入|卖出|推荐股票|预测.*股价|明天.*股价/.test(question)) {
    directAnswer = '不提供投资建议或股价预测。可以继续查看本期指标、经营变化与财报原文。'; mode = 'out-of-scope';
  } else if (missingYears.length) {
    directAnswer = `暂无法回答：尚未入库 ${missingYears.join('、')} 年对应的同口径结构化数据。当前可核验报告期：${[...new Set(metrics.map(m => m.period))].join('、') || '无'}。`; mode = 'out-of-scope';
  } else if (/第\s*\d+\s*页/.test(pageQuery) && !passages.some(p => p.reportId === reportId)) {
    directAnswer = '暂无法回答：所选页没有可检索的原文，请打开原始 PDF 核验。'; mode = 'insufficient-evidence';
  } else if (named.length && /多少|数值/.test(question) && !/为什么|原因|解释|合理|风险|构成/.test(question)) {
    const lines = historyIntent || peerIntent ? factLines : factLines.filter(f => f.metric.announcement_id === reportId);
    directAnswer = lines.length ? [...lines.map(f => f.line), ...(/同比|增长|下降/.test(question) ? calculations : [])].join('\n') : '暂无法回答：相关指标尚未解析。';
    mode = lines.length ? 'structured-query' : 'insufficient-evidence';
  }
  const fallback = directAnswer ?? [
    '当前返回可核验的数据与原文摘录，尚未完成 AI 归纳：',
    ...factLines.slice(0, peerIntent ? 24 : 8).map(f => f.line), ...calculations,
    ...passages.slice(0, 3).map(p => `${p.quote}【${p.id}】`),
  ].join('\n');
  if (!directAnswer && !factLines.length && !passages.length) {
    directAnswer = '暂无法回答：当前报告中没有足够的已解析指标或原文证据。'; mode = 'insufficient-evidence';
  }
  return { question, retrievalQuestion: query, structuredContext, evidence, passages, fallback, directAnswer, mode, metrics: current, peers };
}
