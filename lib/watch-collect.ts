/**
 * Join-monitor collect: start a 2025Q1+ crawl so the user is not stuck on「等待抓取」.
 * Used by POST /api/companies/watch and the company detail empty state.
 */
export function watchJoinCrawlOptions() {
  return {
    downloadLimit: 4,
    parseLimit: 2,
    fullHistory: true as const,
  };
}

export function watchJoinTriggerBody(code: string) {
  return {
    mode: 'manual' as const,
    codes: [code],
    fullHistory: true,
  };
}

export const WATCH_COLLECT_POLL_MS = 2500;
export const WATCH_COLLECT_TIMEOUT_MS = 3 * 60 * 1000;

export function isPendingReportId(id: string | null | undefined) {
  return Boolean(id && id.startsWith('pending:'));
}
