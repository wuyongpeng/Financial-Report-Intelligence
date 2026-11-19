import { ensureBackendSchema } from './backend-schema';
import { getDb } from './db';

export type WatchlistRow = { code: string; created_at: string };

export async function listWatchlist(userKey: string): Promise<WatchlistRow[]> {
  await ensureBackendSchema();
  const rows = await getDb()<Array<{ code: string; created_at: string | Date }>>`
    SELECT code, created_at FROM user_watchlist WHERE user_key=${userKey} ORDER BY created_at DESC, code ASC
  `;
  return rows.map((row) => ({ code: row.code, created_at: new Date(row.created_at).toISOString() }));
}

export async function watchlistCodes(userKey: string) {
  return (await listWatchlist(userKey)).map((row) => row.code);
}

export async function isWatched(userKey: string, code: string) {
  await ensureBackendSchema();
  const rows = await getDb()`SELECT 1 FROM user_watchlist WHERE user_key=${userKey} AND code=${code} LIMIT 1`;
  return rows.length > 0;
}

export async function addToWatchlist(userKey: string, code: string) {
  await ensureBackendSchema();
  await getDb()`
    INSERT INTO user_watchlist (user_key, code) VALUES (${userKey}, ${code})
    ON CONFLICT (user_key, code) DO NOTHING
  `;
}

export async function removeFromWatchlist(userKey: string, code: string) {
  await ensureBackendSchema();
  const rows = await getDb()`DELETE FROM user_watchlist WHERE user_key=${userKey} AND code=${code} RETURNING code`;
  return rows.length > 0;
}

export async function deleteUserWatchlist(userKey: string) {
  await ensureBackendSchema();
  await getDb()`DELETE FROM user_watchlist WHERE user_key=${userKey}`;
}

export async function watchersForCode(code: string): Promise<string[]> {
  await ensureBackendSchema();
  const rows = await getDb()<Array<{ user_key: string }>>`SELECT user_key FROM user_watchlist WHERE code=${code}`;
  return rows.map((row) => row.user_key);
}

export async function markNotifiedPeriod(userKey: string, code: string, period: string) {
  await ensureBackendSchema();
  await getDb()`UPDATE user_watchlist SET last_notified_period=${period} WHERE user_key=${userKey} AND code=${code}`;
}
