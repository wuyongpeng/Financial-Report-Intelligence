/**
 * 「怎么问 / 问什么」— local, no LLM.
 * Prefer industry-skill examples when company industry resolves; else generic / home tip.
 */

import { resolveIndustrySkillKey } from '@/lib/industry-skills-ui';
import { normalizeVoiceText } from './text-normalize';

export type HowToAskSurface = 'detail' | 'home';

/** Generic report asks Eva can actually answer (metrics / MD&A / risks / segment). */
export const HOW_TO_ASK_GENERIC: readonly string[] = [
  '本期营业收入是多少，同比怎么变',
  '归母净利润呢，主要会计数据里有没有原因说明',
  '这份财报提到了哪些主要风险',
  '有没有分产品或分地区的收入拆分',
];

/**
 * Industry skill key → 3–4 TTS-friendly example questions.
 * Keys match data/industry-skills/*.json `industry` field.
 */
export const HOW_TO_ASK_BY_INDUSTRY: Readonly<Record<string, readonly string[]>> = {
  白酒: [
    '本期收入和毛利率同比怎么变',
    '合同负债或预收款有没有披露',
    '高端占比或吨价相关表述有吗',
    '经营现金流和利润是否同向',
  ],
  啤酒: [
    '销量、吨价同比怎么变',
    '产品结构升级相关披露有吗',
    '毛利率和销售费用率呢',
    '经营现金流怎么样',
  ],
  乳制品: [
    '液奶或奶粉等品类收入怎么拆',
    '毛利率和原奶成本相关表述有吗',
    '销售费用率同比如何',
    '经营现金流怎么样',
  ],
  调味品: [
    '吨价或提价相关披露有吗',
    '毛利率同比怎么变',
    '销售费用和经销商表述呢',
    '经营现金流怎么样',
  ],
  家电: [
    '内销和外销收入怎么拆',
    '毛利率和费用率同比如何',
    '存货和经营现金流呢',
    '分品类收入有没有披露',
  ],
  免税: [
    '收入和毛利率同比怎么变',
    '客流或客单相关披露有吗',
    '存货怎么样',
    '经营现金流和费用呢',
  ],
  农林牧渔: [
    '出栏量或均价有没有披露',
    '养殖成本和毛利率呢',
    '生物资产相关表述有吗',
    '经营现金流怎么样',
  ],
  银行: [
    '净息差或净利息收益率是多少',
    '贷款或生息资产规模怎么增长',
    '不良贷款率和拨备覆盖率呢',
    '非利息收入有没有结构拆分',
  ],
  保险: [
    '原保费或保险服务收入是多少',
    '新业务价值或内含价值有披露吗',
    '投资收益怎么样',
    '偿付能力相关指标呢',
  ],
  券商: [
    '经纪、投行、资管等业务线收入怎么拆',
    '自营或投资收益占比如何',
    'ROE 或杠杆相关披露有吗',
    '经营现金流怎么样',
  ],
  光伏: [
    '出货量和均价有没有披露',
    '毛利率同比怎么变',
    '存货或减值相关表述呢',
    '经营现金流和资本开支怎么样',
  ],
  锂电: [
    '出货量或装机有没有披露',
    '毛利率和碳酸锂成本相关表述呢',
    '客户结构怎么写的',
    '存货和资本开支怎么样',
  ],
  锂矿: [
    '锂产品销量和售价有没有披露',
    '毛利率同比怎么变',
    '产量或储量相关表述呢',
    '经营现金流怎么样',
  ],
  新能源车: [
    '汽车销量和均价有没有披露',
    '毛利率和费用率同比如何',
    '海外收入占比呢',
    '存货和经营现金流怎么样',
  ],
  半导体: [
    '晶圆销量或平均售价有没有披露',
    '毛利率同比怎么变',
    '按地区或应用的收入拆分呢',
    '存货和资本开支怎么样',
  ],
  半导体设备: [
    '订单或在手订单有没有披露',
    '毛利率同比怎么变',
    '研发费用怎么样',
    '存货和回款相关表述呢',
  ],
  存储: [
    '毛利率和周期量价相关披露有吗',
    '产品结构怎么写的',
    '存货跌价有没有计提',
    '研发费用和经营现金流呢',
  ],
  光通信: [
    '光模块出货或均价有没有披露',
    '毛利率同比怎么变',
    '存货和客户集中度呢',
    '经营现金流怎么样',
  ],
  面板: [
    '出货面积或均价有没有披露',
    '毛利率同比怎么变',
    '存货怎么样',
    '经营现金流呢',
  ],
  消费电子: [
    '收入和毛利率同比怎么变',
    '大客户或产品结构有拆分吗',
    '存货和应收账款呢',
    '经营现金流怎么样',
  ],
  通信设备: [
    '运营商相关收入怎么写的',
    '毛利率和研发费用呢',
    '合同负债或应收账款怎么样',
    '经营现金流呢',
  ],
  AI应用: [
    '分产品收入谁增谁减',
    '分产品毛利有没有披露',
    '合同负债或回款和收入是否同向',
    '研发投入强度怎么样',
  ],
  AI芯片: [
    '产品或客户收入怎么拆',
    '毛利率同比怎么变',
    '研发费用或流片相关披露呢',
    '存货怎么样',
  ],
  AI算力: [
    '收入和毛利率同比怎么变',
    '服务器或部件产品结构呢',
    '存货和应收账款怎么样',
    '资本开支有没有披露',
  ],
  煤炭: [
    '销量和均价有没有披露',
    '毛利率同比怎么变',
    '经营现金流怎么样',
    '资本开支或减值相关表述呢',
  ],
  石油石化: [
    '上下游收入怎么拆',
    '原油价格对利润的影响原文怎么写',
    '产量或储量有没有披露',
    '经营现金流和资本开支呢',
  ],
  化工: [
    '主要产品销量和价格怎么变',
    '价差或毛利率呢',
    '存货和开工相关表述有吗',
    '经营现金流和资本开支怎么样',
  ],
  有色: [
    '主要金属销量和价格有没有披露',
    '毛利率同比怎么变',
    '存货或套期相关表述呢',
    '经营现金流和资本开支怎么样',
  ],
  钢铁: [
    '钢材销量和均价有没有披露',
    '毛利率同比怎么变',
    '存货怎么样',
    '经营现金流呢',
  ],
  军工: [
    '收入和毛利率同比怎么变',
    '合同负债或预收款有没有披露',
    '应收账款和经营现金流呢',
    '研发投入怎么样',
  ],
  工程机械: [
    '内销和出口怎么拆',
    '毛利率同比怎么变',
    '存货或按揭信用风险相关表述呢',
    '经营现金流怎么样',
  ],
  工控机器人: [
    '收入和毛利率同比怎么变',
    '下游行业结构有披露吗',
    '订单或合同负债呢',
    '研发费用和回款怎么样',
  ],
  轨交装备: [
    '车辆或维保收入怎么拆',
    '毛利率同比怎么变',
    '合同负债或订单有没有披露',
    '经营现金流怎么样',
  ],
  交通运输: [
    '客运量、货运量或吞吐量有没有披露',
    '票价或运价怎么变',
    '成本率怎么样',
    '经营现金流和资本开支呢',
  ],
  中药: [
    '核心品种收入和占比有吗',
    '毛利率同比怎么变',
    '销售费用率呢',
    '经营现金流和集采相关表述怎么样',
  ],
  创新药: [
    '产品或授权收入怎么拆',
    '研发费用怎么样',
    '毛利率有没有披露',
    '经营现金流和现金储备呢',
  ],
  医疗器械: [
    '产品线收入怎么拆',
    '国内外收入占比呢',
    '毛利率同比怎么变',
    '回款和集采相关表述怎么样',
  ],
  医疗服务: [
    '门诊或手术量有没有披露',
    '毛利率和费用率呢',
    '经营现金流怎么样',
    '扩张或资本开支相关表述呢',
  ],
  疫苗: [
    '收入和毛利率同比怎么变',
    '销售费用率呢',
    '存货或批签发相关表述有吗',
    '经营现金流怎么样',
  ],
  CXO: [
    '营收和在手订单有没有披露',
    '毛利率同比怎么变',
    '客户或地缘结构呢',
    '经营现金流和资本开支怎么样',
  ],
};

/** Sector-level fallback when skill key missing from the map (rare). */
const HOW_TO_ASK_BY_SECTOR: Readonly<Record<string, readonly string[]>> = {
  消费: HOW_TO_ASK_BY_INDUSTRY.白酒,
  金融: HOW_TO_ASK_BY_INDUSTRY.银行,
  新能源: HOW_TO_ASK_BY_INDUSTRY.光伏,
  科技: HOW_TO_ASK_BY_INDUSTRY.半导体,
  周期: HOW_TO_ASK_BY_INDUSTRY.化工,
  医药: HOW_TO_ASK_BY_INDUSTRY.中药,
  制造军工: HOW_TO_ASK_BY_INDUSTRY.军工,
};

const SECTOR_OF: Readonly<Record<string, string>> = {
  白酒: '消费', 啤酒: '消费', 乳制品: '消费', 调味品: '消费', 家电: '消费', 免税: '消费', 农林牧渔: '消费',
  银行: '金融', 保险: '金融', 券商: '金融',
  光伏: '新能源', 锂电: '新能源', 锂矿: '新能源', 新能源车: '新能源',
  半导体: '科技', 半导体设备: '科技', 存储: '科技', 光通信: '科技', 面板: '科技',
  消费电子: '科技', 通信设备: '科技', AI应用: '科技', AI芯片: '科技', AI算力: '科技',
  煤炭: '周期', 石油石化: '周期', 化工: '周期', 有色: '周期', 钢铁: '周期',
  军工: '制造军工', 工程机械: '制造军工', 工控机器人: '制造军工', 轨交装备: '制造军工', 交通运输: '制造军工',
  中药: '医药', 创新药: '医药', 医疗器械: '医药', 医疗服务: '医药', 疫苗: '医药', CXO: '医药',
};

/**
 * True when the utterance is only asking how / what to ask.
 * Whole-utterance anchored so real finance questions fall through.
 * Does not steal capability / farewell / page-nav phrases.
 */
export function isVoiceHowToAskIntent(text: string): boolean {
  const t = normalizeVoiceText(text);
  if (!t) return false;

  // Capability / identity stay in meta-intent (parser order also prefers them).
  if (/^(?:你是谁|你叫什么|自我介绍|介绍一下你自己|你能干什么|你有什么功能|你会做什么|你可以做什么|你能干嘛|你能做什么)$/.test(t)) {
    return false;
  }

  return (
    /^(?:我)?(?:该|应该|可以|能|要)?(?:怎么|怎样)(?:提问|问)(?:好|呢)?$/.test(t)
    || /^(?:我)?(?:该|应该)?问(?:什么|啥)(?:好|呢)?$/.test(t)
    || /^(?:可以|能|该)问(?:什么|啥)(?:好|呢)?$/.test(t)
    || /^(?:有什么|有哪些)(?:可以|能)?问的?(?:问题)?$/.test(t)
    || /^(?:不知道|不清楚)(?:该|要)?问(?:什么|啥)$/.test(t)
    || /^(?:给我|推荐|来)(?:几个|一些)?(?:示例|例子)?问题$/.test(t)
    || /^(?:示例|例子|样例)问题$/.test(t)
    || /^(?:提问)?建议$/.test(t)
    || /^(?:问点什么|问些什么|问啥好|提问一下)$/.test(t)
    || /^(?:我该怎么提问|可以问什么|问什么好|怎么提问|怎样提问)$/.test(t)
    || /^(?:教我|告诉我)(?:怎么|怎样)问$/.test(t)
    || /^(?:能问哪些|可以问哪些|该问哪些)$/.test(t)
  );
}

/** Pick 2–4 example questions for an industry label (or generic). */
export function pickHowToAskExamples(industry: string | null | undefined): {
  industryKey: string | null;
  examples: readonly string[];
} {
  const key = resolveIndustrySkillKey(industry);
  if (key && HOW_TO_ASK_BY_INDUSTRY[key]) {
    return { industryKey: key, examples: HOW_TO_ASK_BY_INDUSTRY[key].slice(0, 4) };
  }
  if (key) {
    const sector = SECTOR_OF[key];
    if (sector && HOW_TO_ASK_BY_SECTOR[sector]) {
      return { industryKey: key, examples: HOW_TO_ASK_BY_SECTOR[sector].slice(0, 4) };
    }
  }
  return { industryKey: null, examples: HOW_TO_ASK_GENERIC.slice(0, 4) };
}

const ORD = ['一', '二', '三', '四'] as const;

function formatExamplesSpeech(examples: readonly string[]): string {
  const parts = examples.slice(0, 4).map((q, i) => `${ORD[i]}，${q.replace(/[？?]$/, '')}？`);
  if (parts.length <= 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]}；${parts[1]}`;
  return `${parts.slice(0, -1).join('；')}；${parts[parts.length - 1]}`;
}

/**
 * Spoken / chat reply. Detail prefers industry examples; home nudges open a company
 * then offers the generic pool so the turn is still useful.
 */
export function voiceHowToAskSpeech(
  industry: string | null | undefined,
  surface: HowToAskSurface = 'detail',
): string {
  if (surface === 'home') {
    const generic = formatExamplesSpeech(HOW_TO_ASK_GENERIC.slice(0, 3));
    return `先打开一家公司的财报，我再按行业给你更贴的问法。也可以先这样问：${generic}`;
  }

  const { industryKey, examples } = pickHowToAskExamples(industry);
  const body = formatExamplesSpeech(examples);
  if (industryKey) {
    return `按${industryKey}视角，你可以这样问：${body}`;
  }
  return `可以这样问：${body}`;
}
