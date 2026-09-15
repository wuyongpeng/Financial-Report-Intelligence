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

export type DownloadGate = {
  nextAt: string | null;
  pauseMs: number;
  mode: 'inter-download' | 'inter-round' | 'paused' | 'idle';
};

const GATE_FILE = join(process.cwd(), '.data', 'ingest-download-gate.json');

export function getDownloadGate(): DownloadGate {
  try {
    return JSON.parse(readFileSync(GATE_FILE, 'utf8')) as DownloadGate;
  } catch {
    return { nextAt: null, pauseMs: 1200, mode: 'idle' };
  }
}

export function setDownloadGate(gate: DownloadGate) {
  mkdirSync(dirname(GATE_FILE), { recursive: true });
  writeFileSync(GATE_FILE, JSON.stringify(gate));
}

export function clearDownloadGate() {
  setDownloadGate({ nextAt: null, pauseMs: downloadPauseDefault(), mode: 'idle' });
}

function downloadPauseDefault() {
  const base = Number(process.env.DOWNLOAD_PAUSE_MS ?? 1200);
  return Number.isFinite(base) ? Math.max(400, base) : 1200;
}
