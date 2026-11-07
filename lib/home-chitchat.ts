/**
 * Home voice/typed chitchat (non-company) helpers.
 * Company-like asks with 0 listed hits must NOT enter this path.
 */
import { hasQuestionIntent, parseHomeQuery } from '@/lib/home-search';
import { isHomeRosterQuestion } from '@/lib/home-roster-intent';
import { EVA_INTRO_LINE, EVA_PRODUCT_NAME } from '@/lib/product-identity';
import { isVoiceGreetingOrNoise } from '@/lib/voice/greeting-intent';
import { isVoiceHowToAskIntent } from '@/lib/voice/how-to-ask-intent';
import { isVoiceCapabilityIntent } from '@/lib/voice/meta-intent';

/** Finance / report vocabulary — leftover name + these ⇒ unresolved company ask, not chitchat. */
const FINANCE_COMPANY_ASK_RE =
  /营收|营业收入|净利润|利润总额|毛利率|净利率|财报|年报|季报|半年报|中报|业绩|每股收益|净资产收益率|\bROE\b|\bROA\b|资产负债|现金流|扣非|同比|环比|增长原因|下降原因|主营业务|分红|市值|股价|研报/;

const COMPANY_SUFFIX_RE = /股份|集团|银行|科技|控股|有限|公司|制药|证券|保险|地产|能源/;

const CHITCHAT_RESIDUE_RE =
  /天气|心情|笑话|故事|人生|意义|人工智能|大模型|chatgpt|电影|音乐|足球|篮球|新闻|今天|明天|昨天|周末|开心|无聊|吃饭|睡觉|你觉得|怎么办|几点|星期|明星|八卦/;

const CHITCHAT_TOPIC_RE =
  /笑话|天气|心情|故事|唱歌|吃什么|无聊|聊天|你觉得|人工智能|chatgpt|大模型|几点了|星期几|开心吗|累不累|在干嘛/;

export function isChitchatResidue(token: string): boolean {
  const t = token.replace(/\s+/g, '').trim();
  if (!t) return true;
  return CHITCHAT_RESIDUE_RE.test(t);
}

/**
 * True when the user seems to ask about a (possibly unknown) listed company /
 * finance fact. Those must stay on empty-state / report path — never pretend via chitchat.
 */
export function looksLikeUnresolvedCompanyAsk(raw: string): boolean {
  const text = raw.trim();
  if (!text) return false;
  if (FINANCE_COMPANY_ASK_RE.test(text)) return true;
  const parsed = parseHomeQuery(text);
  if (!parsed.hasQuestionIntent) return false;
  const cq = parsed.companyQuery.trim();
  if (!cq) return false;
  if (COMPANY_SUFFIX_RE.test(cq) || COMPANY_SUFFIX_RE.test(text)) return true;
  if (/^[\u4e00-\u9fffA-Za-z0-9]{2,10}$/.test(cq) && !isChitchatResidue(cq)) return true;
  return false;
}

/** Soft entry for home chitchat after company / roster routes miss. */
export function isLikelyHomeChitchat(raw: string): boolean {
  const text = raw.trim();
  if (!text) return false;
  if (looksLikeUnresolvedCompanyAsk(text)) return false;
  if (CHITCHAT_TOPIC_RE.test(text)) return true;
  if (hasQuestionIntent(text) && !looksLikeUnresolvedCompanyAsk(text)) {
    const cq = parseHomeQuery(text).companyQuery.trim();
    if (!cq || isChitchatResidue(cq)) return true;
    // Long free-text with no company-like residue
    if (text.length >= 8 && isChitchatResidue(text)) return true;
    if (text.length >= 10 && !COMPANY_SUFFIX_RE.test(text) && !FINANCE_COMPANY_ASK_RE.test(text)) {
      // e.g. 「你觉得学习重要吗」
      if (/你|我|吗|呢|啊|吧|怎么|什么|为何|为什么/.test(text)) return true;
    }
  }
  return false;
}

/** Clear non-A-share market asks. Null when this is not a market-scope question. */
export function homeMarketScopeAnswer(raw: string): string | null {
  const t = raw.replace(/\s+/g, '');
  if (!t) return null;
  const us = /美股|纳斯达克|纽交所/.test(t);
  const hk = /港股|港交所/.test(t);
  if (!us && !hk) return null;
  if (us && hk) return '我只看 A 股上市公司财报，暂不支持美股和港股。';
  if (us) return '我只看 A 股上市公司财报，暂不支持美股。';
  return '我只看 A 股上市公司财报，暂不支持港股。';
}

/**
 * Home small-talk that must not filter the company grid or open a company.
 * Greetings stay on the local nudge path (this returns false for them).
 * 「你是谁 / 你能干啥 / 怎么问 / 美股」and other non-company asks return true.
 */
export function isHomeChitchatUtterance(raw: string): boolean {
  const text = raw.trim();
  if (!text) return false;
  if (isVoiceGreetingOrNoise(text)) return false;
  if (isHomeRosterQuestion(text)) return false;
  const market = homeMarketScopeAnswer(text);
  if (looksLikeUnresolvedCompanyAsk(text) && !market) return false;
  if (market) return true;
  if (isVoiceCapabilityIntent(text) || isVoiceHowToAskIntent(text)) return true;
  return isLikelyHomeChitchat(text);
}

/** Live search box text that must leave the company grid on its default filter. */
export function shouldIgnoreHomeCompanyFilter(raw: string): boolean {
  const text = raw.trim();
  if (!text) return false;
  if (isVoiceGreetingOrNoise(text)) return true;
  return isHomeChitchatUtterance(text);
}

const THINK_BLOCK_RE = /<think\b[^>]*>[\s\S]*?<\/think>/gi;
const PLAN_RE = /用户问的是|我需要[:：]|根据我的产品定位|简短说明|思考过程/;

/** Drop model thinking. Empty when the reply is only a plan or an unclosed think tag. */
export function sanitizeHomeAssistantText(text: string): string {
  const raw = text ?? '';
  if (/<think\b/i.test(raw) && !/<\/think>/i.test(raw)) return '';
  const visible = raw
    .replace(THINK_BLOCK_RE, ' ')
    .replace(/<\/?think\b[^>]*>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!visible) return '';
  if (PLAN_RE.test(visible)) return '';
  if (/^\d+[.、]/.test(visible)) return '';
  return visible;
}

export function homeGreetingNudge(): string {
  return `${EVA_INTRO_LINE}帮你快速了解财报内容。可以说公司名或六位代码，或直接问问题。`;
}

export function homeChitchatFallback(): string {
  return '我只看 A 股上市公司财报。想看哪家，直接说公司名或代码。';
}

export function homeChitchatSystemPrompt(spoken = false): string {
  return [
    `你是${EVA_PRODUCT_NAME}（简称 Eva），只做 A 股上市公司财报阅读。`,
    '直接对用户说话，像正常人回答，不要客服腔，不要复述问题。',
    spoken ? '只说一句，不超过 40 字。' : '最多两句，不超过 80 字。',
    '禁止输出思考过程，禁止 <think>，禁止“用户问的是”“我需要”，禁止编号和步骤。',
    '做不到就直接说不做。用户问美股时回答：我只看 A 股上市公司财报，暂不支持美股。',
    '用户问你是谁、能干啥、怎么问时，按这一句具体问题回答，不要每轮复读同一句自我介绍。',
    '不荐股，不编造财报数字，不假装已经打开某家公司。',
  ].join('');
}

export function homeChitchatUserPrompt(input: {
  question: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}): string {
  const hist = (input.history ?? [])
    .slice(-4)
    .map((t) => `${t.role === 'user' ? '用户' : 'Eva'}：${t.content}`)
    .join('\n');
  return [
    hist ? `【首页近期闲聊】\n${hist}\n` : '',
    `用户说：${input.question}`,
    '只输出你对用户说的话。',
  ].filter(Boolean).join('\n');
}

export const HOME_CHITCHAT_SNAPSHOT_PLACEHOLDER =
  '【首页闲聊】当前未锁定具体上市公司；请按产品定位简要回答，并引导用户说出公司名或六位代码。';
