import { nameVariants, WELL_KNOWN_ALIASES } from '@/lib/company-aliases';
import type { MemoryMessage } from '@/lib/conversations';
import {
  METRIC_PATTERNS,
  type OutOfScopeKind,
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

/** Prior turn that should never be merged into a later finance ask. */
export function isDisposablePriorQuestion(question: string) {
  return isMetaModelQuestion(question) || isClearOffTopicQuestion(question);
}

/**
 * True when the current utterance is a short anaphoric follow-up that needs the
 * previous user turn for topic. Self-contained asks like「这个季度业绩好不好」
 * must NOT match — bare「这个」used to prepend a prior meta ask and confuse the LLM.
 */
export function isAnaphoricFollowUp(question: string) {
  const q = question.trim();
  if (!q) return false;
  // Period / report deixis is self-contained, not a pointer to the prior ask.
  if (/这个季度|这季度|这份报告|本季度|本期财报|该公司|这家公司|这一页|本页|当前页/.test(q)) {
    return /那它|该指标|上述|这项|这张|具体原因|那为什么|为何如此/.test(q);
  }
  if (/那它|该指标|上述|这项|这张|具体原因呢|那为什么|为何如此/.test(q)) return true;
  if (/^(为什么|为何)[？?]?$/.test(q)) return true;
  // Very short deixis without its own metric/finance topic.
  const hasTopic = Object.values(METRIC_PATTERNS).some(pattern => pattern.test(q));
  if (!hasTopic && !hasFinanceSignal(q) && /^(那|这个|该项|它|为啥)/.test(q) && q.length < 24) {
    return true;
  }
  if (!hasTopic && !hasFinanceSignal(q) && /为什么|为何/.test(q) && q.length < 36) return true;
  return false;
}

export function retrievalQuestion(question: string, history: MemoryMessage[]) {
  const previous = [...history].reverse().find(message => message.role === 'user')?.content;
  if (!previous) return question;
  // Never carry meta / weather / chitchat priors into retrieval or planning.
  if (isDisposablePriorQuestion(previous)) return question;
  if (!isAnaphoricFollowUp(question)) return question;
  return `${previous.slice(0, 600)}\n当前追问：${question}`;
}

/** Drop meta/off-topic turns so the LLM never re-answers a prior chitchat ask. */
export function historyForModel(history: MemoryMessage[]) {
  const out: MemoryMessage[] = [];
  for (let i = 0; i + 1 < history.length; i += 2) {
    const user = history[i];
    const assistant = history[i + 1];
    if (user?.role !== 'user' || assistant?.role !== 'assistant') continue;
    if (isDisposablePriorQuestion(user.content)) continue;
    out.push(user, assistant);
  }
  return out;
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

/** Investment advice / price prediction — refuse without dumping KPIs. */
const INVESTMENT_SCOPE = /买入|卖出|推荐股票|预测.*股价|明天.*股价/;

/** Which model / provider — answer from config, never from report metrics. */
export function isMetaModelQuestion(question: string) {
  const q = question.trim();
  if (!q) return false;
  if (/大语言模型|语言模型|底层模型|AI\s*模型|\bLLM\b/i.test(q)) return true;
  if (/\b(?:GPT|Claude|Gemini|DeepSeek)\b/i.test(q)) return true;
  if (/(?:哪个|什么).{0,8}(?:大)?模型/.test(q)) return true;
  if (/(?:用的|使用|基于).{0,8}(?:哪个|什么).{0,8}(?:大)?模型/.test(q)) return true;
  if (/(?:模型|LLM).{0,8}(?:哪个|什么|叫什么)/i.test(q)) return true;
  return false;
}

/**
 * Clear non-report chitchat / general-knowledge asks.
 * Keep this denylist narrow; the no-finance-signal gate covers the long tail.
 */
export function isClearOffTopicQuestion(question: string) {
  const q = question.trim();
  if (!q) return false;
  if (/你是谁|你叫什么|自我介绍|你是什么助手/.test(q)) return true;
  return /天气|气温|下雨|下雪|限行|雾霾|空气质量|外卖|几点了|现在几点|讲个笑话|写首诗|写一首诗|翻译成|怎么做(?:饭|菜)|足球比分|篮球赛|星座|今日运势|今天吃什么/.test(q);
}

/** Lexicon that indicates the ask is about report / PDF / financial content. */
const FINANCE_SIGNAL = /财报|年报|季报|半年报|报告期|PDF|原文|披露|附注|资产负债表|利润表|现金流量表|科目|口径|同比|环比|业绩|经营|管理层|股东|分红|派息|营收|营业收入|收入|净利润|净利|利润|总资产|资产|负债|现金流|ROE|EPS|每股收益|净资产|应收|应付|商誉|存货|借款|债券|职工薪酬|货币资金|费用|成本|毛利|研发|产能|出货|销量|客户|合同负债|审计|风险因素|减值|拨备|息差|不良|资本充足|保费|基本面|亮点|估值|市盈率|市净率|这[一]?页|本页|该页|第\s*\d+\s*页|主营|业务概要|核心竞争力|公司治理|员工人数|非经常性|扣非|同业|竞品|对标/i;

/**
 * Named-entity / definition asks about something that may appear in the filing
 * (e.g.「茅台学院是什么意思」). Keep in-scope so keyword passage retrieval can run;
 * insufficient-evidence handles a true miss. Do not require finance lexicon.
 */
export function isReportEntityQuestion(question: string) {
  const q = question.trim();
  if (!q || q.length > 80) return false;
  if (isClearOffTopicQuestion(q) || isMetaModelQuestion(q)) return false;
  if (INVESTMENT_SCOPE.test(q)) return false;
  return /是什么意思|是啥意思|指的?是什么|指什么|是什么$|是啥$|什么意思$/.test(q);
}

export function hasFinanceSignal(question: string) {
  return FINANCE_SIGNAL.test(question) || Object.values(METRIC_PATTERNS).some(pattern => pattern.test(question));
}

export function classifyQuestionScope(input: {
  originalQuestion: string;
  retrievalQuestion: string;
  summary?: boolean;
  metricNames: RetrievalMetricName[];
  explicitPage: number | null;
}): { outOfScope: boolean; outOfScopeKind?: OutOfScopeKind } {
  const original = input.originalQuestion.trim();
  if (INVESTMENT_SCOPE.test(original)) return { outOfScope: true, outOfScopeKind: 'investment' };
  if (isMetaModelQuestion(original)) return { outOfScope: true, outOfScopeKind: 'meta-model' };
  if (isClearOffTopicQuestion(original)) return { outOfScope: true, outOfScopeKind: 'off-topic' };
  if (input.summary) return { outOfScope: false };
  if (input.metricNames.length || input.explicitPage != null) return { outOfScope: false };
  // Follow-ups rewrite into retrievalQuestion with prior finance context — treat as in-scope.
  if (hasFinanceSignal(input.retrievalQuestion) || hasFinanceSignal(original)) return { outOfScope: false };
  //「茅台学院是什么意思」etc. — try PDF text before refusing as chitchat.
  if (isReportEntityQuestion(original) || isReportEntityQuestion(input.retrievalQuestion)) {
    return { outOfScope: false };
  }
  return { outOfScope: true, outOfScopeKind: 'off-topic' };
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
  const explicitPage = explicit ? Number(explicit) : null;
  const scope = classifyQuestionScope({
    originalQuestion: input.question,
    retrievalQuestion: query,
    summary: input.summary,
    metricNames,
    explicitPage,
  });
  return {
    originalQuestion: input.question,
    retrievalQuestion: query,
    metricNames,
    needsHistory: scope.outOfScope ? false : needsHistory,
    needsPeers: scope.outOfScope ? false : needsPeers,
    namedPeerCodes: scope.outOfScope ? [] : namedPeerCodes,
    explicitPage,
    wantsStructuredValue: metricNames.length > 0
      && /多少|数值/.test(input.question)
      && !/为什么|原因|解释|合理|风险|构成/.test(input.question),
    wantsChangeCalculation: /同比|增长|下降/.test(input.question),
    outOfScope: scope.outOfScope,
    outOfScopeKind: scope.outOfScopeKind,
  };
}
