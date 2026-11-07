import { normalizeVoiceText } from '@/lib/voice/text-normalize';

/** How to read the page, not how to interpret a metric. */
const METRIC_RE = /营收|净利润|利润|毛利|ROE|EPS|现金流|资产|负债|同比|原因|风险|分红|费用/i;

const GUIDE_RE =
  /怎么看(?:这个|这份|这篇|本份|这份儿)?(?:财报|报告|年报|季报|中报|半年报)|(?:财报|报告|年报|季报|中报)怎么(?:看|读)|怎么读(?:这个|这份|这篇)?(?:财报|报告|年报)|从哪(?:里|儿)?(?:看起|入手|开始)|先看(?:什么|哪里|哪)|该怎么看|如何看(?:这个|这份)?(?:财报|报告)|怎么入手|怎么入门/;

export const REPORT_READING_GUIDE =
  '先看中间概览的营收、归母净利、EPS 和 ROE。要核对就点页码角标，左边原文会跳过去并高亮。还有问题就在右边追问，也可以在原文里划词再问。';

export function isReportReadingGuideQuestion(text: string): boolean {
  const q = normalizeVoiceText(text);
  if (!q || q.length > 40) return false;
  if (METRIC_RE.test(q)) return false;
  return GUIDE_RE.test(q);
}
