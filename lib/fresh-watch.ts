/** How often a full pass of the monitored companies starts. */
export const FRESH_WATCH_INTERVAL_MS = 90_000;
/** Exchange and 巨潮 window. Long enough to cover a weekend disclosure. */
export const FRESH_LOOKBACK_DAYS = 3;
/** Gap between companies. One request pair, not a burst. */
export const FRESH_QUERY_PAUSE_MS = 200;
/** Newly found PDFs should not sit behind the general 20s download gap. */
export const FRESH_DOWNLOAD_PAUSE_MS = 800;

/**
 * A filing is seen on the next pass, then downloaded.
 * Pass length is one exchange query plus one 巨潮 query per company.
 */
export function freshWatchWithinFiveMinutes(companyCount: number, requestMs = 1_600, downloadMs = 60_000) {
  const sweepMs = companyCount * (requestMs + FRESH_QUERY_PAUSE_MS);
  return sweepMs + downloadMs <= 5 * 60_000;
}
