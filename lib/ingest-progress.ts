/** Shared crawl/parse progress for live UI — file-backed so worker + Next API see the same state. */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type IngestProgressPhase = 'download' | 'parse';

export type IngestProgressItem = {
  id: string;
  code: string;
  name: string;
  title: string;
  period: string;
  source: string;
  phase: IngestProgressPhase;
  detail: string;
  startedAt: string;
};

const FILE = join(process.cwd(), '.data', 'ingest-progress.json');

function readAll(): Record<string, IngestProgressItem> {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, IngestProgressItem>;
  } catch {
    return {};
  }
}

function writeAll(map: Record<string, IngestProgressItem>) {
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(map));
}

export function setIngestProgress(item: IngestProgressItem) {
  const all = readAll();
  all[item.id] = item;
  writeAll(all);
}

export function patchIngestProgress(id: string, patch: Partial<IngestProgressItem>) {
  const all = readAll();
  const cur = all[id];
  if (!cur) return;
  all[id] = { ...cur, ...patch };
  writeAll(all);
}

export function clearIngestProgress(id: string) {
  const all = readAll();
  if (!(id in all)) return;
  delete all[id];
  writeAll(all);
}

export function listIngestProgress(): IngestProgressItem[] {
  const all = readAll();
  // Drop stale entries (>10 min) so UI never sticks forever if process crashed.
  const cutoff = Date.now() - 10 * 60 * 1000;
  let dirty = false;
  for (const [id, item] of Object.entries(all)) {
    if (new Date(item.startedAt).getTime() < cutoff) {
      delete all[id];
      dirty = true;
    }
  }
  if (dirty) writeAll(all);
  return Object.values(all).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
