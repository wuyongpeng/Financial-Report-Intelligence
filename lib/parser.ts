export const parsedMetricNames = ['revenue', 'net_profit', 'eps', 'roe', 'total_assets', 'total_liabilities', 'operating_cash_flow', 'operating_cost'] as const;
export const PARSE_PAGE_LIMIT = 120;
/** pdf.js loads the whole file; above this, extract the first pages from disk instead. */
export const PDFJS_PARSE_MAX_BYTES = 50 * 1024 * 1024;

export function shouldExtractTextExternally(byteLength: number) {
  return byteLength > PDFJS_PARSE_MAX_BYTES;
}
// Currency rows share one scaling path; ratios and per-share values must not be scaled.
const currencyMetrics = new Set(['revenue', 'net_profit', 'total_assets', 'total_liabilities', 'operating_cash_flow', 'operating_cost']);

export type ParsedMetric = {
  metric: typeof parsedMetricNames[number];
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
  { metric: 'total_assets', labels: ['资产总计', '资产总额', '总资产'], unit: '元', minAbs: 1000, maxAbs: 1e16 },
  { metric: 'total_liabilities', labels: ['负债合计', '负债总额'], unit: '元', minAbs: 1000, maxAbs: 1e16 },
  // Operating cash flow is legitimately negative, so no lower bound on magnitude.
  { metric: 'operating_cash_flow', labels: ['经营活动产生的现金流量净额', '经营活动现金流量净额'], unit: '元', minAbs: 0, maxAbs: 1e16 },
  { metric: 'operating_cost', labels: ['营业成本'], unit: '元', minAbs: 1000, maxAbs: 1e16 },
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
  let nearby = pageText.slice(index + label.length, index + label.length + 180).replace(/[,，]/g, '').replace(/（/g, '(').replace(/）/g, ')');
  // Only ratio/per-share summary rows use the small footnote markers handled
  // here. Parenthesized currency amounts are values, not footnotes.
  if (!currencyMetrics.has(definition.metric)) nearby = nearby.replace(/^\s*\([1-9]\)\s+(?=-?\d)/, '');
  const valueMatch = nearby.match(/(?:人民币)?\s*(\()?\s*(-?\d+(?:\.\d+)?)\s*(\))?\s*(%|亿元|百万元|万元|元\/股|元)?/);
  if (!valueMatch) return null;
  let value = Number(valueMatch[2]);
  if (valueMatch[1] && valueMatch[3]) value = -Math.abs(value);
  if (!Number.isFinite(value)) return null;
  const detectedUnit = valueMatch[4] ?? '';

  if (currencyMetrics.has(definition.metric)) {
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
  for (let pageIndex = 0; pageIndex < Math.min(pages.length, PARSE_PAGE_LIMIT); pageIndex += 1) {
    const page = normalizePageText(pages[pageIndex]);
    const isSummary = /主要会计数据|主要财务指标|报告摘要/.test(page);
    const statement = definition.metric === 'total_assets' || definition.metric === 'total_liabilities' ? /合并资产负债表|资产负债表/
      : definition.metric === 'operating_cash_flow' ? /合并现金流量表|现金流量表/
      : /合并利润表|利润表/;
    const isPrimaryStatement = statement.test(page);
    const hasPageUnit = Boolean(pageCurrencyUnit(page));
    for (const [labelIndex, label] of definition.labels.entries()) {
      for (const position of allLabelPositions(page, label)) {
        const scopedPage = page.slice(position);
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

function splitPdfToTextPages(output: string) {
  const pages = output.split('\f').map((page) => page.trim());
  if (pages.at(-1) === '') pages.pop();
  return pages;
}

async function extractWithPoppler(bytes: ArrayBuffer | null, filePath?: string) {
  try {
    const { execFileSync } = await import('node:child_process');
    const args = ['-layout', '-f', '1', '-l', String(PARSE_PAGE_LIMIT)];
    const output = filePath
      ? execFileSync('pdftotext', [...args, filePath, '-'], {
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        timeout: 120_000,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      : execFileSync('pdftotext', [...args, '-', '-'], {
        input: Buffer.from(bytes ?? new ArrayBuffer(0)),
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        timeout: 120_000,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    return splitPdfToTextPages(output);
  } catch (error) {
    console.warn('[parser] Poppler fallback unavailable', { message: String(error) });
    return [];
  }
}

function toChunks(pages: string[]) {
  return pages.slice(0, PARSE_PAGE_LIMIT).map((content, index) => ({
    page: index + 1,
    content: content.replace(/\s+/g, ' ').trim().slice(0, 5000),
  })).filter((chunk) => chunk.content.length >= 40);
}

export async function parseCoreMetrics(bytes: ArrayBuffer | null, options?: { filePath?: string }) {
  const filePath = options?.filePath;
  const size = bytes?.byteLength ?? 0;
  const usePdfJs = Boolean(bytes && size > 0 && !shouldExtractTextExternally(size));

  if (!usePdfJs) {
    const pages = await extractWithPoppler(bytes, filePath);
    return { totalPages: pages.length, metrics: parseCoreMetricPages(pages), chunks: toChunks(pages) };
  }

  const { extractText, getDocumentProxy } = await import('unpdf');
  // PDF.js may transfer/detach its input buffer. Keep an independent copy for
  // the Poppler fallback before handing bytes to PDF.js.
  const fallbackBytes = bytes!.slice(0);
  const pdf = await getDocumentProxy(new Uint8Array(bytes!));
  const extracted = await extractText(pdf, { mergePages: false }).finally(() => pdf.loadingTask.destroy());
  const primaryPages = Array.isArray(extracted.text) ? extracted.text : [extracted.text];
  let pages = primaryPages;
  let metrics = parseCoreMetricPages(pages);
  if (metrics.length < LABELS.length) {
    const fallbackPages = await extractWithPoppler(fallbackBytes, filePath);
    const fallbackMetrics = parseCoreMetricPages(fallbackPages);
    if (fallbackMetrics.length > metrics.length) {
      pages = fallbackPages;
      metrics = fallbackMetrics;
    }
  }
  return { totalPages: pages.length, metrics, chunks: toChunks(pages) };
}
