export type ParsedMetric = {
  metric: 'revenue' | 'net_profit' | 'eps' | 'roe';
  value: number;
  unit: string;
  page: number;
  sourceLabel: string;
  confidence: number;
};

const LABELS: Array<{ metric: ParsedMetric['metric']; labels: string[]; unit: string }> = [
  { metric: 'revenue', labels: ['营业收入'], unit: '元' },
  { metric: 'net_profit', labels: ['归属于上市公司股东的净利润', '归属于母公司股东的净利润'], unit: '元' },
  { metric: 'eps', labels: ['基本每股收益'], unit: '元/股' },
  { metric: 'roe', labels: ['加权平均净资产收益率'], unit: '%' },
];

function numberAfterLabel(text: string, label: string) {
  const index = text.indexOf(label);
  if (index < 0) return null;
  const nearby = text.slice(index + label.length, index + label.length + 180).replace(/[,，]/g, '');
  const match = nearby.match(/(?:人民币)?\s*(-?\d+(?:\.\d+)?)\s*(%|亿元|万元|元)?/);
  if (!match) return null;
  let value = Number(match[1]);
  const detectedUnit = match[2] ?? '';
  if (!Number.isFinite(value)) return null;
  if (detectedUnit === '亿元') value *= 100000000;
  if (detectedUnit === '万元') value *= 10000;
  return { value, detectedUnit };
}

export async function parseCoreMetrics(bytes: ArrayBuffer) {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const extracted = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(extracted.text) ? extracted.text : [extracted.text];
  const results: ParsedMetric[] = [];

  for (const definition of LABELS) {
    let found: ParsedMetric | null = null;
    for (let pageIndex = 0; pageIndex < Math.min(pages.length, 80); pageIndex += 1) {
      const page = pages[pageIndex].replace(/\s+/g, ' ');
      for (const label of definition.labels) {
        const parsed = numberAfterLabel(page, label);
        if (!parsed) continue;
        found = {
          metric: definition.metric,
          value: parsed.value,
          unit: parsed.detectedUnit || definition.unit,
          page: pageIndex + 1,
          sourceLabel: label,
          confidence: pageIndex < 20 ? 0.88 : 0.76,
        };
        break;
      }
      if (found) break;
    }
    if (found) results.push(found);
  }
  return { totalPages: pages.length, metrics: results };
}
