import { normalizeVoiceText } from '@/lib/voice/text-normalize';

const METRIC_RE = /营收|净利润|利润|毛利|ROE|EPS|现金流|资产|负债|同比|原因|风险|分红|费用/i;

const GUIDE_RE =
  /怎么看(?:这个|这份|这篇|本份|这份儿)?(?:财报|报告|年报|季报|中报|半年报)|(?:财报|报告|年报|季报|中报)怎么(?:看|读)|怎么读(?:这个|这份|这篇)?(?:财报|报告|年报)|从哪(?:里|儿)?(?:看起|入手|开始)|先看(?:什么|哪里|哪)|该怎么看|如何看(?:这个|这份)?(?:财报|报告)|怎么入手|怎么入门/;

export const REPORT_READING_GUIDE =
  '先看中间概览的营收、归母净利、EPS 和 ROE。要核对就点页码角标，左边原文会跳过去并高亮。还有问题就在右边追问，也可以在原文里划词再问。';

/** Compare without naming the other company. Industry-wide 「同行」can still use the pool. */
export function isUnnamedPeerCompare(text: string): boolean {
  const q = normalizeVoiceText(text);
  if (!q || q.length > 40) return false;
  if (/上期|去年|同期|上年|前年|同比|环比/.test(q)) return false;
  if (/同行|同业|全行业/.test(q)) return false;
  if (/^(比较一下|对比一下|比一下|比较下|帮我比一下)$/.test(q)) return true;
  if (!/(?:和|与|跟).{0,12}比|比较|对比/.test(q)) return false;
  const mid = q.match(/(?:和|与|跟)([^比]{0,12})比/)?.[1] ?? '';
  if (mid.replace(/一下|他们|它们|其他|其它|别的|别人|的|公司|股票/g, '').trim()) return false;
  const residue = q.replace(/比较|对比|相比|一下|和|与|跟|他们|别的|别人|其他|其它|公司|股票|营收|净利润|利润|毛利|的|呢|吗/g, '');
  return residue.length < 2;
}

export const UNNAMED_PEER_REPLY = '要和哪家比？说公司名或代码。';

/** Doubt about a displayed number, not a request to explain why it changed. */
export function isDataDoubtQuestion(text: string): boolean {
  const q = normalizeVoiceText(text);
  if (!q || q.length > 40) return false;
  if (/为什么|为何|原因|怎么变|同比|环比/.test(q)) return false;
  return /数据不对|数字不对|数不对|数据有误|数字有误|数据有问题|数字有问题|数据不准|好像错了|是不是错了|这个数不对|这个数有问题|这个数有误|怀疑.{0,6}错/.test(q);
}

export const DATA_DOUBT_REPLY = '这个数以左边原文为准，点页码角标可以核对。如果页面和披露不一致，直接说我要反馈。';

export function isReportReadingGuideQuestion(text: string): boolean {
  const q = normalizeVoiceText(text);
  if (!q || q.length > 40) return false;
  if (METRIC_RE.test(q)) return false;
  return GUIDE_RE.test(q);
}
