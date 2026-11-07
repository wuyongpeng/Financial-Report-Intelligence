/**
 * Home voice/typed chitchat (non-company) helpers.
 * Company-like asks with 0 listed hits must NOT enter this path.
 */
import { hasQuestionIntent, parseHomeQuery } from '@/lib/home-search';
import { EVA_INTRO_LINE, EVA_PRODUCT_NAME } from '@/lib/product-identity';

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

export function homeGreetingNudge(): string {
  return `${EVA_INTRO_LINE}帮你快速了解财报内容。可以说公司名或六位代码，或直接问问题。`;
}

export function homeChitchatFallback(): string {
  return `${EVA_INTRO_LINE}我帮你快速看懂已入库财报。不做荐股；想分析哪家，直接说公司名或代码。`;
}

export function homeChitchatSystemPrompt(): string {
  return [
    `你是${EVA_PRODUCT_NAME}（简称 Eva），面向 A 股上市公司财报的智能阅读与分析助手。`,
    '产品定位：把交易所公开财报 PDF，变成可查询、可对比、可点回原文的阅读台；帮用户快速了解财报内容。',
    '核心用法：首页搜公司/代码 → 进详情三栏（原文·概览·追问）→ 可语音连续问；不做证券买卖建议。',
    '本轮是首页闲聊（尚未锁定具体公司）。规则：',
    '1) 简要口语，适合语音播报，不超过 100 字；',
    '2) 不荐股、不给买卖/目标价/「能不能买」结论；',
    '3) 不编造具体财报数字或未提供的公司事实；',
    '4) 题外话礼貌短答后，提醒用户可以说公司名或六位代码进入分析；',
    '5) 不要假装已经读过某家财报。',
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
  ].filter(Boolean).join('\n');
}

export const HOME_CHITCHAT_SNAPSHOT_PLACEHOLDER =
  '【首页闲聊】当前未锁定具体上市公司；请按产品定位简要回答，并引导用户说出公司名或六位代码。';
