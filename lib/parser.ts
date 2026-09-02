export type ParsedMetric = {
  metric: 'revenue' | 'net_profit' | 'eps' | 'roe';
  value: number;
  unit: string;
  page: number;
  sourceLabel: string;
  confidence: number;
};

type MetricDefinition = {
  metric: ParsedMetric['metric'];
  labels: string[];
  unit: string;
  minAbs: number;
  maxAbs: number;
};

type Candidate = ParsedMetric & { score: number };

const LABELS: MetricDefinition[] = [
  { metric: 'revenue', labels: ['营业总收入', '营业收入'], unit: '元', minAbs: 1000, maxAbs: 1e15 },
  { metric: 'net_profit', labels: ['归属于上市公司股东的净利润', '归属于母公司股东的净利润', '归属于本行股东的净利润', '归属于本公司股东的净利润'], unit: '元', minAbs: 1, maxAbs: 1e15 },
  { metric: 'eps', labels: ['基本每股收益'], unit: '元/股', minAbs: 0, maxAbs: 1000 },
  { metric: 'roe', labels: ['归属于本行普通股股东的加权平均净资产收益率', '归属于本公司普通股股东的加权平均净资产收益率', '加权平均净资产收益率'], unit: '%', minAbs: 0, maxAbs: 1000 },
];

function pageCurrencyUnit(text: string) {
  return text.match(/(?:单位\s*[：:]\s*)?人民币\s*(亿元|百万元|万元|元)/)?.[1]
    ?? text.match(/单位\s*[：:]\s*(亿元|百万元|万元|元)/)?.[1]
    ?? '';
}

function scaleCurrency(value: number, unit: string) {
  const scaled = unit === '亿元' ? value * 100000000 : unit === '百万元' ? value * 1000000 : unit === '万元' ? value * 10000 : value;
  return Math.round(scaled * 100) / 100;
}

function normalizePageText(text: string) {
  return text.replace(/\s+/g, ' ').replace(/([\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/g, '$1').trim();
}

function candidateAfterLabel(pageText: string, label: string, definition: MetricDefinition, fallbackCurrencyUnit = '') {
  const index = pageText.indexOf(label);
  if (index < 0) return null;
  const nearby = pageText.slice(index + label.length, index + label.length + 180).replace(/[,，]/g, '').replace(/^\s*\(\d+\)\s*/, '');
  const valueMatch = nearby.match(/(?:人民币)?\s*\(?\s*(-?\d+(?:\.\d+)?)\s*\)?\s*(%|亿元|百万元|万元|元\/股|元)?/);
  if (!valueMatch) return null;
  let value = Number(valueMatch[1]);
  if (!Number.isFinite(value)) return null;
  const detectedUnit = valueMatch[2] ?? '';

  if (definition.metric === 'revenue' || definition.metric === 'net_profit') {
    value = scaleCurrency(value, detectedUnit || fallbackCurrencyUnit || pageCurrencyUnit(pageText) || '元');
  }
  if (Math.abs(value) < definition.minAbs || Math.abs(value) > definition.maxAbs) return null;
  return { value, detectedUnit };
}

function allLabelPositions(text: string, label: string) {
  const positions: number[] = [];
  let from = 0;
  while (from < text.length) {
    const position = text.indexOf(label, from);
    if (position < 0) break;
    positions.push(position);
    from = position + label.length;
  }
  return positions;
}

function metricCandidates(pages: string[], definition: MetricDefinition) {
  const candidates: Candidate[] = [];
  for (let pageIndex = 0; pageIndex < Math.min(pages.length, 120); pageIndex += 1) {
    const page = normalizePageText(pages[pageIndex]);
    const isSummary = /主要会计数据|主要财务指标|报告摘要/.test(page);
    const isPrimaryStatement = /合并利润表|利润表/.test(page);
    const hasPageUnit = Boolean(pageCurrencyUnit(page));
    for (const [labelIndex, label] of definition.labels.entries()) {
      for (const position of allLabelPositions(page, label)) {
        const scopedPage = `${page.slice(Math.max(0, position - 90), position)}${page.slice(position)}`;
        const parsed = candidateAfterLabel(scopedPage, label, definition, pageCurrencyUnit(page));
        if (!parsed) continue;
        let score = 0.68;
        if (isSummary) score += 0.14;
        if (isPrimaryStatement && definition.metric !== 'roe') score += 0.08;
        if (parsed.detectedUnit || hasPageUnit) score += 0.06;
        if (pageIndex < 30) score += 0.03;
        if (labelIndex === 0) score += 0.03;
        candidates.push({
          metric: definition.metric,
          value: parsed.value,
          unit: definition.unit,
          page: pageIndex + 1,
          sourceLabel: label,
          confidence: 0,
          score,
        });
      }
    }
  }
  return candidates;
}

function chooseCandidate(candidates: Candidate[]) {
  if (!candidates.length) return null;
  const sorted = [...candidates].sort((a, b) => b.score - a.score || a.page - b.page);
  const selected = sorted[0];
  const agreeing = candidates.filter((candidate) => {
    const tolerance = Math.max(0.0001, Math.abs(selected.value) * 0.001);
    return Math.abs(candidate.value - selected.value) <= tolerance;
  }).length;
  const conflicting = candidates.some((candidate) => candidate.value !== selected.value && candidate.score >= selected.score - 0.16);
  const confidence = Math.max(0.55, Math.min(0.96, selected.score + (agreeing > 1 ? 0.05 : 0) - (conflicting ? 0.12 : 0)));
  return {
    metric: selected.metric,
    value: selected.value,
    unit: selected.unit,
    page: selected.page,
    sourceLabel: selected.sourceLabel,
    confidence: Number(confidence.toFixed(2)),
  };
}

export function parseCoreMetricPages(pages: string[]) {
  return LABELS.map((definition) => chooseCandidate(metricCandidates(pages, definition))).filter((metric): metric is ParsedMetric => Boolean(metric));
}

async function extractWithPoppler(bytes: ArrayBuffer) {
  try {
    const { execFileSync } = await import('node:child_process');
    const output = execFileSync('pdftotext', ['-layout', '-f', '1', '-l', '120', '-', '-'], {
      input: Buffer.from(bytes),
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: 60_000,
    });
    return output.split('\f').map((page) => page.trim()).filter(Boolean);
  } catch (error) {
    console.warn('[parser] Poppler fallback unavailable', { message: String(error) });
    return [];
  }
}

export async function parseCoreMetrics(bytes: ArrayBuffer) {
  const { extractText, getDocumentProxy } = await import('unpdf');
  // PDF.js may transfer/detach its input buffer. Keep an independent copy for
  // the Poppler fallback before handing bytes to PDF.js.
  const fallbackBytes = bytes.slice(0);
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const extracted = await extractText(pdf, { mergePages: false });
  const primaryPages = Array.isArray(extracted.text) ? extracted.text : [extracted.text];
  let pages = primaryPages;
  let metrics = parseCoreMetricPages(pages);
  if (metrics.length < 4) {
    const fallbackPages = await extractWithPoppler(fallbackBytes);
    const fallbackMetrics = parseCoreMetricPages(fallbackPages);
    if (fallbackMetrics.length > metrics.length) {
      pages = fallbackPages;
      metrics = fallbackMetrics;
    }
  }
  const chunks = pages.slice(0, 120).map((content, index) => ({
    page: index + 1,
    content: content.replace(/\s+/g, ' ').trim().slice(0, 5000),
  })).filter((chunk) => chunk.content.length >= 40);
  return { totalPages: pages.length, metrics, chunks };
}
