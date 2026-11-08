/**
 * Home-surface questions about the visible company roster (not a report ask).
 * Typed + voice share this detector; company-detail must not use it for RAG.
 * Match against normalizeVoiceText (no spaces / punctuation).
 */
import { normalizeVoiceText } from './voice/text-normalize';

/** List / presence / objective “worth analyzing” / open-by-name on home. */
const LIST_RE =
  /(?:首页|主页|当前|现在|监控池|列表|卡片).{0,20}(?:有哪些|都有哪些|收入了哪些|展示|哪些公司|有什么公司)|有哪些公司|都有哪些公司|都收入了哪些|监控池里有什么|首页上有什么|当前都?收入了哪些/;

const PRESENCE_RE =
  /在不在|有没有|在吗|在不在(?:首页|列表|监控池|里面)|首页有没有|列表里有没有|监控池有没有/;

const WORTH_RE =
  /哪些值得(?:分析|看|买)|值得分析一下|值得买|推荐(?:先)?看哪|推荐买|先看哪(?:家|个)|哪家值得|哪些可以先看|客观信号|买哪个|买哪家/;

const OPEN_RE =
  /^(?:打开|进入|跳到|跳转|打开公司)(.+)$/;

const HOME_SCOPE_RE =
  /首页|主页|监控池|列表里|卡片上|当前展示|现在展示/;

const DISCOVERY_LIST_RE =
  /有哪些|哪些公司|什么公司|哪几家|哪家|有谁|有什么|相关的公司|有关的公司|同行|同业|做.{0,10}的|从事|涉及.{0,8}公司|找.{0,6}公司/;
const DISCOVERY_SET_RE =
  /公司|企业|个股|股票|名单|行业|产业|产业链|赛道|板块|概念|a股|A股/;
const ISSUER_FACT_RE =
  /营收|净利润|同比|财报|年报|季报|业绩|增长原因|下降原因|毛利率|现金流|净资产收益率|每股收益|ROE|EPS/i;

/**
 * Two named companies plus a report metric, e.g.「立讯精密2024年ROE与工业富联相比如何」.
 * This is a company ask, not a homepage list question, and must not wait on intent classification.
 */
export function isNamedIssuerCompare(text: string, listedCount: number): boolean {
  if (listedCount < 2) return false;
  const q = normalizeVoiceText(text);
  if (!q) return false;
  if (!/比较|对比|相比/.test(q) || !/和|跟|与/.test(q)) return false;
  return ISSUER_FACT_RE.test(q);
}

/**
 * Set / theme questions that should use the homepage list, not a single company.
 * 「有哪些公司」alone stays a plain list. A named issuer's numbers stay off this path.
 */
export function isHomeDiscoveryQuestion(text: string): boolean {
  const q = normalizeVoiceText(text);
  if (!q || q.length > 48) return false;
  if (DISCOVERY_LIST_RE.test(q) && DISCOVERY_SET_RE.test(q)) {
    if (ISSUER_FACT_RE.test(q) && !/哪些公司|什么公司|相关的公司|同行|同业|行业|产业|赛道|板块/.test(q)) return false;
    return true;
  }
  if (/行业|产业|产业链|赛道|板块/.test(q) && /怎么样|如何|怎样|介绍|说说|讲讲|有哪些|哪些|情况/.test(q)) {
    return !ISSUER_FACT_RE.test(q) || /行业|产业|赛道|板块/.test(q);
  }
  if (/有没有|有谁/.test(q) && /做|造|生产|从事|属于/.test(q)) return true;
  if (/比较|对比|相比/.test(q) && /和|跟|与/.test(q) && !ISSUER_FACT_RE.test(q)) return true;
  return false;
}

/** @deprecated alias — theme scans are discovery questions. */
export function isHomeIndustryRosterQuestion(text: string): boolean {
  return isHomeDiscoveryQuestion(text);
}

export function isHomeRosterListQuestion(text: string): boolean {
  const q = normalizeVoiceText(text);
  if (!q) return false;
  return LIST_RE.test(q);
}

export function isHomeRosterPresenceQuestion(text: string): boolean {
  const q = normalizeVoiceText(text);
  if (!q) return false;
  return PRESENCE_RE.test(q);
}

export function isHomeRosterWorthQuestion(text: string): boolean {
  const q = normalizeVoiceText(text);
  if (!q) return false;
  return WORTH_RE.test(q);
}

/** 「打开贵州茅台」→ residual name/code query, else null. */
export function parseHomeRosterOpenQuery(text: string): string | null {
  const q = normalizeVoiceText(text);
  if (!q) return null;
  const m = q.match(OPEN_RE);
  if (!m?.[1]) return null;
  const name = m[1].replace(/(?:的吧啊呢了呀哦)+$/g, '').trim();
  if (!name) return null;
  // Reject finance questions smuggled after 打开/进入
  if (/是否|怎么|如何|为何|为什么|增长|下降|同比|环比|多少|什么|哪些|分析|解读|原因|值得买/.test(name)) {
    return null;
  }
  if (name.length > 20) return null;
  return name;
}

/** 「你都支持哪些公司 / 已经解析了哪些」— needs the parsed roster, not a vague capability line. */
export function isHomeCoverageQuestion(text: string): boolean {
  const q = normalizeVoiceText(text);
  if (!q || q.length > 40) return false;
  if (ISSUER_FACT_RE.test(q)) return false;
  return /支持哪些|能看哪些|覆盖哪些|可以问哪些|能问哪些|已经解析|已解析哪些|解析了哪些|解析好了哪些|都支持|收入了哪些|你这里有哪些|都有哪些公司|有哪些公司可以/.test(q);
}

/** Detail-page design and how to use Eva. Not a single company's numbers. */
export function isHomeProductGuideQuestion(text: string): boolean {
  const q = normalizeVoiceText(text);
  if (!q || q.length > 40) return false;
  if (ISSUER_FACT_RE.test(q) && !/划词|三栏|角标|详情页|怎么用|如何使用/.test(q)) return false;
  return /划词|三栏|角标|详情页|设计理念|怎么用|如何使用|怎么提问|怎么核对|回原文|有什么功能|能做什么|能干啥|能干什么|你会什么|产品特点|怎么选词/.test(q);
}

export function isHomeRosterQuestion(text: string): boolean {
  const q = normalizeVoiceText(text);
  if (!q) return false;
  if (isHomeRosterListQuestion(q)) return true;
  if (isHomeCoverageQuestion(q)) return true;
  if (isHomeDiscoveryQuestion(q)) return true;
  if (isHomeRosterPresenceQuestion(q)) return true;
  if (isHomeRosterWorthQuestion(q)) return true;
  if (parseHomeRosterOpenQuery(q)) return true;
  if (HOME_SCOPE_RE.test(q) && /什么|怎么|哪些|介绍|说明|情况/.test(q)) return true;
  return false;
}

/** Prefer full monitor pool vs screen-visible window for the answer source. */
export function homeRosterSourcePreference(
  text: string,
): 'pool' | 'filtered' | 'visible' {
  const q = normalizeVoiceText(text);
  if (/监控池|全部公司|都收入|收入了哪些/.test(q)) return 'pool';
  // Theme scans need the whole pool. A plain 「首页有哪些公司」stays on what's on screen.
  if (isHomeDiscoveryQuestion(q) && !isHomeRosterListQuestion(q)) return 'pool';
  if (/筛选|当前列表|列表里/.test(q)) return 'filtered';
  return 'visible';
}
