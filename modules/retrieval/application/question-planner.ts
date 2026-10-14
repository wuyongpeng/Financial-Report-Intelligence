import { nameVariants, WELL_KNOWN_ALIASES } from '@/lib/company-aliases';
import type { MemoryMessage } from '@/lib/conversations';
import {
  METRIC_PATTERNS,
  type QueryPlan,
  type RetrievalMetricName,
  type WatchedCompany,
} from '../domain/retrieval';

export function wantsCompanyHistory(query: string) {
  return /同比|环比|上年|去年|前年|历年|历史|趋势|过去|变化|增长|下降|对比|比较|业绩|好不好|好吗|怎样|怎么样|如何|今年|改善|下滑|亮眼|疲软|20\d{2}/.test(query);
}

export function wantsPeerCompare(query: string) {
  return /竞品|同行|同业|对标|可比公司|对比|比较|\bvs\b|versus|和.+比|与.+比/.test(query);
}

export function wantsEvaluativeJudgement(query: string) {
  return /好不好|好吗|怎样|怎么样|如何|亮眼|疲软|优秀|差吗/.test(query);
}

export function retrievalQuestion(question: string, history: MemoryMessage[]) {
  const previous = [...history].reverse().find(message => message.role === 'user')?.content;
  if (!previous) return question;
  const hasTopic = Object.values(METRIC_PATTERNS).some(pattern => pattern.test(question));
  return !hasTopic || /那它|这个|该指标|上述|这项|这张|为什么|为何/.test(question)
    ? `${previous.slice(0, 600)}\n当前追问：${question}`
    : question;
}

export function mentionedCompanyCodes(
  query: string,
  watched: Array<WatchedCompany | { code: string; company_name: string }>,
  currentCode: string,
) {
  const companies = watched.map(row => ({
    code: row.code,
    companyName: 'companyName' in row ? row.companyName : row.company_name,
  }));
  const found = new Set<string>();
  for (const match of query.matchAll(/(?<!\d)(\d{6})(?!\d)/g)) {
    if (match[1] !== currentCode && companies.some(row => row.code === match[1])) found.add(match[1]);
  }
  for (const row of companies) {
    if (row.code === currentCode) continue;
    if (row.companyName && query.includes(row.companyName)) {
      found.add(row.code);
      continue;
    }
    if (nameVariants(row.companyName).some(variant => variant.length >= 2 && query.includes(variant))) {
      found.add(row.code);
    }
  }
  for (const [alias, official] of Object.entries(WELL_KNOWN_ALIASES)) {
    if (!query.includes(alias)) continue;
    const hit = companies.find(row => row.companyName === official || row.companyName.includes(official));
    if (hit && hit.code !== currentCode) found.add(hit.code);
  }
  return [...found];
}

export function planQuestion(input: {
  question: string;
  history: MemoryMessage[];
  watched: WatchedCompany[];
  currentCode: string;
  summary?: boolean;
}): QueryPlan {
  const query = retrievalQuestion(input.question, input.history);
  const namedPeerCodes = mentionedCompanyCodes(query, input.watched, input.currentCode);
  const needsHistory = Boolean(input.summary) || wantsCompanyHistory(query);
  const needsPeers = wantsPeerCompare(query) || namedPeerCodes.length > 0 || wantsEvaluativeJudgement(query);
  const metricNames = Object.entries(METRIC_PATTERNS)
    .filter(([, pattern]) => pattern.test(query))
    .map(([name]) => name as RetrievalMetricName);
  const explicit = query.match(/第\s*(\d+)\s*页/)?.[1];
  return {
    originalQuestion: input.question,
    retrievalQuestion: query,
    metricNames,
    needsHistory,
    needsPeers,
    namedPeerCodes,
    explicitPage: explicit ? Number(explicit) : null,
    wantsStructuredValue: metricNames.length > 0
      && /多少|数值/.test(input.question)
      && !/为什么|原因|解释|合理|风险|构成/.test(input.question),
    wantsChangeCalculation: /同比|增长|下降/.test(input.question),
    outOfScope: /买入|卖出|推荐股票|预测.*股价|明天.*股价/.test(input.question),
  };
}
