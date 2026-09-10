import { getDb } from './db';
import { ApiError } from './api';
import { rankEvidence, relevance, unsupportedYears } from './chat-evidence';
import { buildPageLabels, resolvePageQuestion } from './pdf-pages';
import { labels, change, type MetricName } from './detail-model';
import type { Evidence, MemoryMessage } from './conversations';

type Metric = { announcement_id: string; metric: string; value: number; unit: string; period: string; source_page: number | null; source_label: string | null };
type Report = { id: string; code: string; company_name: string; industry: string; report_type: string };
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

export async function loadRagContext(reportId: string, question: string, history: MemoryMessage[], summary = false): Promise<RagContext> {
  const db = getDb();
  const [target] = await db<Report[]>`SELECT a.id, a.code, a.company_name, a.report_type, c.industry
    FROM announcements a JOIN companies c ON c.code=a.code WHERE a.id=${reportId}`;
  if (!target) throw new ApiError(404, '报告不存在');
  const current = await db<Metric[]>`SELECT announcement_id, metric, value, unit, period, source_page, source_label
    FROM financial_metrics WHERE announcement_id=${reportId} ORDER BY metric`;
  const period = current[0]?.period ?? '';
  const query = retrievalQuestion(question, history);
  const peerIntent = /竞品|同行|同业|对标|可比公司/.test(query);
  const historyIntent = summary || /同比|上年|去年|历年|历史|趋势|过去|变化|增长|下降|对比|20\d{2}/.test(query);
  const suffix = period.replace(/^20\d{2}/, '');
  const related: Report[] = [];
  if (period && historyIntent) {
    const historical = await db<Report[]>`SELECT a.id, a.code, a.company_name, a.report_type, c.industry FROM announcements a
      JOIN companies c ON c.code=a.code WHERE a.code=${target.code} AND a.report_type=${target.report_type}
      AND EXISTS (SELECT 1 FROM financial_metrics m WHERE m.announcement_id=a.id AND m.period<${period} AND m.period LIKE ${`%${suffix}`})
      ORDER BY a.published_at DESC LIMIT 8`;
    related.push(...historical);
  }
  if (period && peerIntent) {
    const peers = await db<Report[]>`SELECT DISTINCT ON (a.code) a.id, a.code, a.company_name, a.report_type, c.industry
      FROM announcements a JOIN companies c ON c.code=a.code WHERE c.industry=${target.industry} AND c.enabled=true AND a.code<>${target.code}
      AND a.report_type=${target.report_type} AND EXISTS(SELECT 1 FROM financial_metrics m WHERE m.announcement_id=a.id AND m.period=${period})
      ORDER BY a.code, a.published_at DESC LIMIT 8`;
    related.push(...peers);
  }
  const reports = [target, ...related];
  const allMetrics = related.length ? [...current, ...await db<Metric[]>`SELECT announcement_id, metric, value, unit, period, source_page, source_label
    FROM financial_metrics WHERE announcement_id IN ${db(related.map(r => r.id))} ORDER BY metric`] : current;
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
    const cite = m.source_page ? add({ reportId: report.id, companyName: report.company_name, period: m.period, page: m.source_page, quote: m.source_label ?? metricLabel(m.metric), metric: m.metric }) : null;
    return { metric: m, citation: cite, line: `${report.company_name} ${m.period} ${metricLabel(m.metric)}：${m.value}${m.unit}${cite ? `【${cite.id}】` : '（无原文页码，待核验）'}` };
  });
  const priorPeriod = period.replace(/^20\d{2}/, year => String(Number(year) - 1));
  const calculations: string[] = [];
  for (const row of factLines.filter(f => f.metric.announcement_id === reportId)) {
    const prior = factLines.find(f => f.metric.period === priorPeriod && f.metric.metric === row.metric.metric && reports.find(r => r.id === f.metric.announcement_id)?.code === target.code);
    const delta = change(row.metric.value, prior?.metric.value);
    if (prior && delta !== undefined) calculations.push(`${metricLabel(row.metric.metric)}同比：${delta >= 0 ? '+' : ''}${delta.toFixed(2)}%（基期 ${priorPeriod}，公式：(本期-上期)/|上期|）${row.citation ? `【${row.citation.id}】` : ''}${prior.citation ? `【${prior.citation.id}】` : ''}`);
  }
  const chunks = await db<Chunk[]>`SELECT announcement_id, page, content FROM report_chunks
    WHERE announcement_id=${reportId} ORDER BY page LIMIT 400`;
  const pageQuery = resolvePageQuestion(query, buildPageLabels(chunks));
  const primaryPages = current.filter(m => named.includes(m.metric)).flatMap(m => m.source_page ? [m.source_page] : []);
  const ranked = rankEvidence(pageQuery, chunks, primaryPages).slice(0, 6);
  const passages = ranked.map(chunk => {
    const content = excerpt(query, chunk.content);
    const quote = excerpt(query, content, 160);
    return { ...add({ reportId, companyName: target.company_name, period, page: chunk.page, quote }), content };
  });
  const missingYears = unsupportedYears(question, metrics.map(m => m.period).join(' '));
  const peers = selectedReports.filter(r => r.code !== target.code).map(({ code, company_name }) => ({ code, company_name }));
  const structuredContext = [
    `当前报告：${target.company_name}（${target.code}），${period || '报告期尚未解析'}，行业 ${target.industry}。`,
    '以下数据来自服务端数据库；不同公司、不同报告期严格分开。金额为原单位，ROE 变化若以差值表达请用百分点。',
    ...factLines.map(row => row.line), ...calculations,
    peerIntent ? `同业比较仅限上述同报告期 ${peers.length + 1} 家已入库公司，不代表全行业排名；未列出的公司没有可用比较数据。` : '',
  ].filter(Boolean).join('\n');
  let directAnswer: string | undefined;
  let mode = 'evidence-retrieval';
  if (/买入|卖出|推荐股票|预测.*股价|明天.*股价/.test(question)) {
    directAnswer = '不提供投资建议或股价预测。可以继续查看本期指标、经营变化与财报原文。'; mode = 'out-of-scope';
  } else if (missingYears.length) {
    directAnswer = `暂无法回答：尚未入库 ${missingYears.join('、')} 年对应的同口径结构化数据。当前可核验报告期：${[...new Set(metrics.map(m => m.period))].join('、') || '无'}。`; mode = 'out-of-scope';
  } else if (/第\s*\d+\s*页/.test(pageQuery) && !ranked.length) {
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
