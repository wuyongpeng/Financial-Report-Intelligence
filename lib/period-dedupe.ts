import { isFullFinancialReport, periodFromTitle } from './ingest-period';

const CORE = new Set(['revenue', 'net_profit', 'eps', 'roe']);
const STATUS_RANK: Record<string, number> = {
  online: 6,
  review: 5,
  parse_partial: 4,
  downloaded: 3,
  parsing: 2,
  parse_parked: 1,
};

export type DedupeCandidate = {
  id: string;
  code?: string;
  title: string;
  status?: string | null;
  published_at: unknown;
  parsed_at?: string | Date | null;
  coreCount?: number;
  metrics?: Array<{ metric: string }>;
};

function publishedKey(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? '');
}

function coreMetricCount(row: DedupeCandidate) {
  if (typeof row.coreCount === 'number') return row.coreCount;
  if (!row.metrics?.length) return 0;
  return row.metrics.filter((item) => CORE.has(item.metric)).length;
}

/** Higher score wins: A-share full report with complete metrics beats H-share stubs. */
export function reportKeepScore(row: DedupeCandidate) {
  const full = isFullFinancialReport(row.title) ? 1_000_000 : 0;
  const core = coreMetricCount(row);
  const status = STATUS_RANK[row.status ?? ''] ?? 0;
  const parsed = row.parsed_at ? 100 : 0;
  const corrected = /更正|修订/.test(row.title) ? 50 : 0;
  return full + core * 10_000 + status * 1_000 + parsed + corrected;
}

export function compareKeepOrder(a: DedupeCandidate, b: DedupeCandidate) {
  const score = reportKeepScore(b) - reportKeepScore(a);
  if (score) return score;
  const published = publishedKey(b.published_at).localeCompare(publishedKey(a.published_at));
  if (published) return published;
  return a.id.localeCompare(b.id);
}

export function betterKeepCandidate<T extends DedupeCandidate>(current: T | undefined, next: T) {
  if (!current) return next;
  return compareKeepOrder(current, next) > 0 ? next : current;
}

export function duplicateIdsToSkip<T extends DedupeCandidate & { code: string }>(
  rows: T[],
  periodOf: (row: T) => string | null = (row) => periodFromTitle(row.title, row.published_at),
) {
  const best = new Map<string, T>();
  for (const row of rows) {
    const period = periodOf(row);
    if (!period || !row.code) continue;
    const key = `${row.code}:${period}`;
    best.set(key, betterKeepCandidate(best.get(key), row));
  }
  const keep = new Set([...best.values()].map((row) => row.id));
  return rows.filter((row) => {
    const period = periodOf(row);
    if (!period) return false;
    return best.has(`${row.code}:${period}`) && !keep.has(row.id);
  }).map((row) => row.id);
}

export const DUPLICATE_PERIOD_KEEP_MESSAGE = '同期货报已保留更完整版本，本条不参与对比';
