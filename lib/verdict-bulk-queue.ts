import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { clearVerdictSkip } from './verdict-abort';
import { markVerdictPending } from './report-verdict-store';

/** Bulk 批量智析 file queue: worker-owned, not Next after(). */
export const VERDICT_BULK_CAP = 5000;

export type BulkVerdictItem = {
  id: string;
  /** worker 领取时传给 runQueuedVerdict；批量入队一律 true，避免 pending 被当成 after() 而 skip */
  force: boolean;
};

function bulkPath() {
  return join(process.env.RUNTIME_DIR ?? resolve(/* turbopackIgnore: true */ process.cwd(), '.data'), 'verdict-bulk-queue.json');
}

function readItems(): BulkVerdictItem[] {
  try {
    const parsed = JSON.parse(readFileSync(bulkPath(), 'utf8')) as { items?: unknown };
    if (!Array.isArray(parsed.items)) return [];
    return parsed.items
      .map((item): BulkVerdictItem | null => {
        if (!item || typeof item !== 'object') return null;
        const row = item as { id?: unknown; force?: unknown };
        const id = typeof row.id === 'string' ? row.id.trim() : '';
        if (!id) return null;
        return { id, force: row.force === true };
      })
      .filter((item): item is BulkVerdictItem => Boolean(item));
  } catch {
    return [];
  }
}

function writeItems(items: BulkVerdictItem[]) {
  const target = bulkPath();
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.part`;
  writeFileSync(temporary, `${JSON.stringify({ items })}\n`);
  renameSync(temporary, target);
}

export function countBulkVerdicts() {
  return readItems().length;
}

/** Read-only snapshot of the bulk file queue (does not claim / take). */
export function listBulkVerdicts(): BulkVerdictItem[] {
  return readItems().map((item) => ({ id: item.id, force: item.force }));
}

/** Append (dedupe by id: re-add moves to end; force sticks if either side is true). Cap drops oldest. */
export function enqueueBulkVerdicts(items: Array<{ id: string; force?: boolean }>) {
  if (!items.length) return;
  const incoming: BulkVerdictItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const id = item.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    incoming.push({ id, force: item.force === true });
  }
  if (!incoming.length) return;
  const current = readItems();
  const incomingIds = new Set(incoming.map((item) => item.id));
  const previousForce = new Map(
    current.filter((item) => incomingIds.has(item.id)).map((item) => [item.id, item.force]),
  );
  const kept = current.filter((item) => !incomingIds.has(item.id));
  const merged = incoming.map((item) => ({
    id: item.id,
    force: item.force || previousForce.get(item.id) === true,
  }));
  writeItems([...kept, ...merged].slice(0, VERDICT_BULK_CAP));
}

/** Put items back at the front (busy / partial claim). */
export function requeueBulkVerdictsFront(items: BulkVerdictItem[]) {
  if (!items.length) return;
  const incomingIds = new Set(items.map((item) => item.id));
  const kept = readItems().filter((item) => !incomingIds.has(item.id));
  writeItems([...items, ...kept].slice(0, VERDICT_BULK_CAP));
}

export function takeBulkVerdicts(n: number): BulkVerdictItem[] {
  const want = Math.max(0, Math.floor(n));
  if (want <= 0) return [];
  const items = readItems();
  if (!items.length) return [];
  const taken = items.slice(0, want);
  writeItems(items.slice(want));
  return taken;
}

export type BulkVerdictEnqueueInput = { id: string; refresh?: boolean };

/**
 * Mark pending in DB (refresh → overwriteReady) and push onto the worker bulk queue.
 * Does not start Next after() — worker claimVerdictJobs drains this queue.
 */
export async function enqueueBulkReportVerdicts(inputs: BulkVerdictEnqueueInput[]) {
  let queued = 0;
  let skipped = 0;
  const toQueue: BulkVerdictItem[] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    if (!id || seen.has(id)) {
      if (!id) skipped += 1;
      continue;
    }
    seen.add(id);
    clearVerdictSkip(id);
    const refresh = input.refresh === true;
    const ok = await markVerdictPending(id, refresh);
    if (!ok) {
      skipped += 1;
      continue;
    }
    // force 一律 true：worker 自有 pending，避免 runQueuedVerdict 把未过期 pending 当成 after() 而 skip。
    // refresh 只影响 markVerdictPending(overwriteReady) 与失败时 retainReady。
    toQueue.push({ id, force: true });
    queued += 1;
  }
  enqueueBulkVerdicts(toQueue);
  return { queued, skipped };
}
