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

/**
 * True when the utterance should stay on the home AI path with roster context,
 * instead of company-detail handoff / unrecognized-join dialogs.
 */
export function isHomeRosterQuestion(text: string): boolean {
  const q = normalizeVoiceText(text);
  if (!q) return false;
  if (isHomeRosterListQuestion(q)) return true;
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
  if (/筛选|当前列表|列表里/.test(q)) return 'filtered';
  return 'visible';
}
