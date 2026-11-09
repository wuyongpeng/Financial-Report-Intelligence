import { METRIC_PATTERNS } from '@/modules/retrieval/domain/retrieval';

/** One structured fact line: 「公司 2026Q3 营业收入：1,105.07亿元【E1】」. */
const FACT_LINE = /^(.+?) ((?:19|20)\d{2}(?:Q[1-4]|H[12]|FY)) ([^：]+)：(.+)$/;

const METRIC_ORDER = Object.keys(METRIC_PATTERNS);

export type LayoutFact = {
  line: string;
  metric: { reportId: string; metric: string; period: string };
};

/** A one-liner the reader can take in without a list or table. */
export function isExtremelyShortAnswer(text: string) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.includes('\n')) return false;
  const colons = trimmed.match(/：/g)?.length ?? 0;
  return trimmed.length <= 60 && colons <= 1;
}

export function hasReadableStructure(text: string) {
  return /\n\n/.test(text)
    || /\n\s*[-*]\s/.test(text)
    || /\n\s*\|/.test(text)
    || /^#{1,3} /m.test(text)
    || /\n\s*\d+\.\s/.test(text);
}

/**
 * Keep a very short reply as one line. Anything longer must survive Markdown
 * (blank lines, a list, or a table) so single newlines are not collapsed into a wall of numbers.
 */
export function formatReadableAnswer(answer: string) {
  const text = answer.replace(/\r\n/g, '\n').trim();
  if (!text || isExtremelyShortAnswer(text) || hasReadableStructure(text)) return text;

  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length >= 2) {
    const [head, ...rest] = lines;
    if (isFactLike(head)) return bulletList(lines);
    return `${head}\n\n${bulletList(rest)}`;
  }

  const pieces = splitConcatenatedFacts(text);
  if (pieces.length >= 2) return bulletList(pieces);

  const sentences = text.split(/(?<=。)/).map(sentence => sentence.trim()).filter(Boolean);
  if (sentences.length >= 3 && text.length > 80) return sentences.join('\n\n');
  return text;
}

/** 「最新营收同比」stays on the open report. Only an explicit series ask lists other periods. */
export function wantsPeriodSeries(question: string) {
  return /历年|历史|趋势|过去|各期|近几年|近\d+年|逐季|逐期|每一期|每一季|所有期|各季度|各报告期/.test(question);
}

/**
 * Turn metric facts into a lead sentence plus a table.
 * One bare number stays one line. One number plus its YoY is two paragraphs.
 */
export function formatStructuredFacts(factLines: LayoutFact[], calculations: string[], currentReportId: string) {
  const facts = factLines.filter(fact => fact.line.trim());
  const calcs = calculations.map(item => item.trim()).filter(Boolean);
  if (facts.length === 1 && calcs.length === 0 && facts[0].line.trim().length <= 80) return facts[0].line.trim();

  const parsed = facts.map(fact => {
    const match = fact.line.trim().match(FACT_LINE);
    if (!match) return null;
    return {
      reportId: fact.metric.reportId,
      metric: fact.metric.metric,
      company: match[1],
      period: match[2],
      label: match[3],
      amount: match[4],
      line: fact.line.trim(),
    };
  });
  if (parsed.some(row => !row)) return formatReadableAnswer([...facts.map(fact => fact.line.trim()), ...calcs].join('\n'));

  const yoyByLabel = new Map<string, string>();
  for (const calc of calcs) {
    const match = calc.match(/^(.+?)同比：([\s\S]+)$/);
    if (match) yoyByLabel.set(match[1], match[2].trim());
  }
  const rows = (parsed as NonNullable<(typeof parsed)[number]>[]).map(row => ({
    ...row,
    yoy: row.reportId === currentReportId ? (yoyByLabel.get(row.label) ?? '') : '',
  }));
  const ordered = sortFactRows(rows, currentReportId);
  if (ordered.length === 1) {
    const row = ordered[0];
    if (!row.yoy) return row.line;
    return `${row.line}\n\n${row.label}同比：${displayYoy(row.yoy)}`;
  }

  const currentCompany = ordered.find(row => row.reportId === currentReportId)?.company ?? ordered[0].company;
  const focusPeriod = ordered.find(row => row.company === currentCompany)?.period ?? ordered[0].period;
  const focus = ordered.filter(row => row.company === currentCompany && row.period === focusPeriod);
  const lead = `${currentCompany} ${focusPeriod}：${focus.map(row => (
    `${row.label} ${row.amount}${row.yoy ? `，${displayYoy(row.yoy)}` : ''}`
  )).join('；')}。`;
  const showYoy = ordered.some(row => row.yoy);
  const sameSlot = new Set(ordered.map(row => `${row.company}\0${row.period}`)).size === 1;
  const table = sameSlot
    ? markdownTable(
      ['指标', '本期', ...(showYoy ? ['同比'] : [])],
      ordered.map(row => [row.label, row.amount, ...(showYoy ? [row.yoy ? displayYoy(row.yoy) : '—'] : [])]),
    )
    : markdownTable(
      ['公司', '报告期', '指标', '金额', ...(showYoy ? ['同比'] : [])],
      ordered.map(row => [
        row.company,
        row.period,
        row.label,
        row.amount,
        ...(showYoy ? [row.yoy ? displayYoy(row.yoy) : '—'] : []),
      ]),
    );
  return `${lead}\n\n${table}`;
}

function isFactLike(line: string) {
  return FACT_LINE.test(line) || /同比：/.test(line);
}

function bulletList(lines: string[]) {
  return lines.map(line => (line.startsWith('- ') ? line : `- ${line}`)).join('\n');
}

/** Split a Markdown-collapsed dump back into 「公司 期间 指标：」 / 「指标同比：」 pieces. */
function splitConcatenatedFacts(text: string) {
  const parts = text.split(
    /(?<=\S)\s+(?=(?:[\u4e00-\u9fa5A-Za-z0-9·]{2,40} (?:19|20)\d{2}(?:Q[1-4]|H[12]|FY) [^：\s]{2,24}：)|(?:[^：\s]{2,16}同比：))/,
  ).map(part => part.trim()).filter(Boolean);
  return parts.length >= 2 ? parts : [];
}

function displayYoy(raw: string) {
  const note = raw.match(/（([^）]*)）/)?.[1] ?? '';
  const short = raw.replace(/（[^）]*）/g, '').replace(/\s+/g, ' ').trim();
  if (!note || !/对比|较基期|N\/A|百分点/.test(note)) return short;
  return `${short}（${note}）`;
}

function periodRank(period: string) {
  const match = period.match(/^(\d{4})(?:Q([1-4])|H([12])|FY)$/);
  if (!match) return 0;
  const year = Number(match[1]);
  const sub = match[2] ? Number(match[2]) : match[3] ? Number(match[3]) * 2 : 5;
  return year * 10 + sub;
}

function metricRank(metric: string) {
  const index = METRIC_ORDER.indexOf(metric);
  return index === -1 ? METRIC_ORDER.length : index;
}

function sortFactRows<T extends { reportId: string; company: string; period: string; metric: string }>(
  rows: T[],
  currentReportId: string,
) {
  const currentCompany = rows.find(row => row.reportId === currentReportId)?.company;
  return [...rows].sort((a, b) => {
    const companyBias = Number(b.company === currentCompany) - Number(a.company === currentCompany);
    if (companyBias) return companyBias;
    const periodBias = periodRank(b.period) - periodRank(a.period);
    if (periodBias) return periodBias;
    const metricBias = metricRank(a.metric) - metricRank(b.metric);
    if (metricBias) return metricBias;
    return a.company.localeCompare(b.company, 'zh');
  });
}

function markdownTable(headers: string[], rows: string[][]) {
  const cell = (value: string) => value.replace(/\|/g, '｜').replace(/\n/g, ' ').trim() || '—';
  const head = `| ${headers.map(cell).join(' | ')} |`;
  const rule = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map(row => `| ${row.map(cell).join(' | ')} |`);
  return [head, rule, ...body].join('\n');
}
