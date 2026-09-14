/** Server-side live universe loader (do not import from client components). */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import seed from '@/data/ashare-universe.json';
import type { AshareRow } from '@/lib/ashare-universe';

const FILE = path.join(process.cwd(), 'data', 'ashare-universe.json');
let cache: { mtimeMs: number; rows: AshareRow[] } | null = null;

export function getAshareUniverseLive(): AshareRow[] {
  try {
    const st = statSync(FILE);
    if (cache && cache.mtimeMs === st.mtimeMs) return cache.rows;
    const rows = JSON.parse(readFileSync(FILE, 'utf8')) as AshareRow[];
    if (!Array.isArray(rows) || !rows.length) {
      cache = { mtimeMs: st.mtimeMs, rows: seed as AshareRow[] };
      return cache.rows;
    }
    cache = { mtimeMs: st.mtimeMs, rows };
    return rows;
  } catch {
    return (seed as AshareRow[]) ?? [];
  }
}

export function invalidateAshareUniverseCache() {
  cache = null;
}
