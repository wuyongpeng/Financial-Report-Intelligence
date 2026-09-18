import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

function priorityPath() {
  return join(process.env.RUNTIME_DIR ?? resolve(/* turbopackIgnore: true */ process.cwd(), '.data'), 'verdict-priority.json');
}

function readIds(): string[] {
  try {
    const parsed = JSON.parse(readFileSync(priorityPath(), 'utf8')) as { ids?: unknown };
    if (!Array.isArray(parsed.ids)) return [];
    return parsed.ids.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()));
  } catch {
    return [];
  }
}

function writeIds(ids: string[]) {
  const target = priorityPath();
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify({ ids })}\n`);
}

/** Manual 智析 jumps the worker queue even when auto-verdict is off. */
export function enqueuePriorityVerdict(id: string) {
  const key = id.trim();
  if (!key) return;
  const ids = readIds().filter((item) => item !== key);
  ids.unshift(key);
  writeIds(ids.slice(0, 40));
}

export function takePriorityVerdict(): string | null {
  const ids = readIds();
  const next = ids.shift() ?? null;
  writeIds(ids);
  return next;
}
