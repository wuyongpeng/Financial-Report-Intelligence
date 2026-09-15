import { periodFromTitle } from './ingest-period';

/**
 * Absolute collect floor: never discover/download filings older than 2025Q1.
 * Applies to auto worker and 数据采集 manual crawl alike.
 */
export const COLLECT_MIN_PERIOD = '2025Q1';

/** @deprecated alias — keep call sites working */
export function autoCutoffPeriod(_now = new Date()): string {
  return COLLECT_MIN_PERIOD;
}

/** Same ranking as crawl-display.periodTokenKey (H1 ≡ Q2). */
export function periodRank(token: string): number {
  const year = Number(token.match(/20\d{2}/)?.[0] ?? 0);
  const quarter = /FY/.test(token) ? 4 : /H1|Q2/.test(token) ? 2 : /Q3/.test(token) ? 3 : /Q1/.test(token) ? 1 : 0;
  return year * 10 + quarter;
}

export function periodMeetsAutoCutoff(period: string, _now = new Date()): boolean {
  return periodRank(period) >= periodRank(COLLECT_MIN_PERIOD);
}

export function announcementMeetsAutoCutoff(title: string, publishedAt: unknown, now = new Date()): boolean {
  return periodMeetsAutoCutoff(periodFromTitle(title, publishedAt), now);
}

/** Search window from 2025-01-01 (covers 2025Q1 filings). */
export function autoCollectSearchDays(now = new Date()): number {
  const start = new Date(2025, 0, 1);
  const days = Math.ceil((now.getTime() - start.getTime()) / 86400000) + 21;
  return Math.min(Math.max(days, 120), 900);
}

/** Manual history also stops at 2025Q1 — same day window as auto. */
export const MANUAL_HISTORY_DAYS = autoCollectSearchDays();

/**
 * A-share “latest expected” period for coverage UI (not a hard filing deadline).
 * Q1 from May 1, H1 from Sep 1, Q3 from Nov 1, else prior FY.
 */
export function latestExpectedPeriod(now = new Date()): string {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  if (m >= 11) return `${y}Q3`;
  if (m >= 9) return `${y}H1`;
  if (m >= 5) return `${y}Q1`;
  return `${y - 1}FY`;
}

export function expectedPeriodsThroughLatest(now = new Date()): string[] {
  const cutoff = COLLECT_MIN_PERIOD;
  const latest = latestExpectedPeriod(now);
  const tokens: string[] = [];
  const startYear = Number(cutoff.slice(0, 4));
  const endYear = Number(latest.slice(0, 4));
  const seq = ['Q1', 'H1', 'Q3', 'FY'] as const;
  for (let y = startYear; y <= endYear; y++) {
    for (const suffix of seq) {
      const token = `${y}${suffix}`;
      if (periodRank(token) < periodRank(cutoff)) continue;
      if (periodRank(token) > periodRank(latest)) continue;
      tokens.push(token);
    }
  }
  return tokens;
}
