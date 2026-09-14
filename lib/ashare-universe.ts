/**
 * Recognition universe (全 A 股名录) — client-safe.
 * Bundled JSON so Next/webpack can load it in the browser.
 * Nightly refresh still writes data/ashare-universe.json; restart/rebuild picks it up.
 * Server routes that need live disk reads should use ashare-universe.server.ts.
 */
import seed from '@/data/ashare-universe.json';

export type AshareRow = { code: string; name: string; exchange: 'SSE' | 'SZSE' | 'BSE' };

export function getAshareUniverse(): AshareRow[] {
  return (seed as AshareRow[]) ?? [];
}

/** No-op on client; server module clears its own cache. */
export function invalidateAshareUniverseCache() {
  /* client bundle has no fs cache */
}
