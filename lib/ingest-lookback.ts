import { periodFromTitle } from './ingest-period';

/**
 * Default auto-collect cutoff: previous calendar year’s H1 / Q2 (半年报).
 *
 * Example (today = Sep 2026): enqueue from 2025H1 / 2025Q2 onward
 * (2025Q3, 2025FY, 2026Q1, 2026H1, 2026Q3 when filed) — never 2024 or earlier.
 * 2025Q1 is before last year’s H1, so it is also excluded from auto collect.
 *
 * Manual crawl on 数据采集 (`fullHistory`) skips this filter.
 */
export function autoCutoffPeriod(now = new Date()): string {
  return `${now.getFullYear() - 1}H1`;
}

/** Same ranking as crawl-display.periodTokenKey (H1 ≡ Q2). */
export function periodRank(token: string): number {
  const year = Number(token.match(/20\d{2}/)?.[0] ?? 0);
  const quarter = /FY/.test(token) ? 4 : /H1|Q2/.test(token) ? 2 : /Q3/.test(token) ? 3 : /Q1/.test(token) ? 1 : 0;
  return year * 10 + quarter;
}

export function periodMeetsAutoCutoff(period: string, now = new Date()): boolean {
  return periodRank(period) >= periodRank(autoCutoffPeriod(now));
}

export function announcementMeetsAutoCutoff(title: string, publishedAt: unknown, now = new Date()): boolean {
  return periodMeetsAutoCutoff(periodFromTitle(title, publishedAt), now);
}

/** Search window wide enough to reach previous-year H1 filings (typically from June of that year). */
export function autoCollectSearchDays(now = new Date()): number {
  const start = new Date(now.getFullYear() - 1, 5, 1);
  const days = Math.ceil((now.getTime() - start.getTime()) / 86400000) + 21;
  return Math.min(Math.max(days, 180), 800);
}

export const MANUAL_HISTORY_DAYS = 365 * 8;

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
  const cutoff = autoCutoffPeriod(now);
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
