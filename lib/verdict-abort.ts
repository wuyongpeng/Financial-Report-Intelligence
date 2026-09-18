import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * 中止(跳过)自动智析。
 *
 * 两个职责，缺一个「中止」就会失效：
 * 1. 跨进程中止请求：Next 的 API 进程写请求文件，独立的 worker 进程在跑任务时轮询并 abort 掉模型调用。
 * 2. 跳过标记持久化：中止后必须落一个 skip 标记，否则 listDueVerdictJobs 下一 tick 会立刻把它重新捡起来，
 *    表现为「点了中止、几秒后它又在跑」。skip 后该份从待办数里扣除，需要用户显式「重新智析」才回队列。
 */

export type VerdictSkip = {
  id: string;
  at: string;
  /** 中止时它已经跑了多久，用于「已跳过」列表展示 */
  elapsedMs?: number;
  reason: string;
};

const SKIP_CAP = 500;
const ABORT_REQUEST_CAP = 100;
/** 中止请求超过这个时长仍未被 worker 消费就作废，避免僵尸请求误杀后来的任务。 */
export const ABORT_REQUEST_TTL_MS = 5 * 60_000;

function runtimeFile(name: string) {
  return join(process.env.RUNTIME_DIR ?? resolve(/* turbopackIgnore: true */ process.cwd(), '.data'), name);
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value)}\n`);
}

/* ------------------------------------------------------------------ *
 * 1. 跨进程中止请求
 * ------------------------------------------------------------------ */

type AbortRequest = { id: string; at: number };

function abortRequestPath() {
  return runtimeFile('verdict-aborts.json');
}

function readAbortRequests(now = Date.now()): AbortRequest[] {
  const parsed = readJson<{ items?: unknown }>(abortRequestPath(), {});
  if (!Array.isArray(parsed.items)) return [];
  return parsed.items
    .filter((item): item is AbortRequest => {
      if (!item || typeof item !== 'object') return false;
      const row = item as AbortRequest;
      return typeof row.id === 'string' && Boolean(row.id.trim()) && Number.isFinite(row.at);
    })
    .filter((item) => now - item.at <= ABORT_REQUEST_TTL_MS);
}

/** API 侧调用：请求中止某份正在智析的报告。worker 在下一次轮询时真正 abort。 */
export function requestVerdictAbort(id: string) {
  const key = id.trim();
  if (!key) return;
  const items = readAbortRequests().filter((item) => item.id !== key);
  items.unshift({ id: key, at: Date.now() });
  writeJson(abortRequestPath(), { items: items.slice(0, ABORT_REQUEST_CAP) });
}

export function hasVerdictAbortRequest(id: string, now = Date.now()) {
  return readAbortRequests(now).some((item) => item.id === id);
}

/** worker 侧调用：消费掉某份的中止请求（消费后不再重复触发）。 */
export function consumeVerdictAbort(id: string, now = Date.now()): boolean {
  const items = readAbortRequests(now);
  if (!items.some((item) => item.id === id)) return false;
  writeJson(abortRequestPath(), { items: items.filter((item) => item.id !== id) });
  return true;
}

export function clearVerdictAbortRequests() {
  writeJson(abortRequestPath(), { items: [] });
}

/* ------------------------------------------------------------------ *
 * 2. 进程内 AbortController 注册表
 * ------------------------------------------------------------------ */

const controllers = new Map<string, AbortController>();

export function registerVerdictRun(id: string): AbortController {
  const controller = new AbortController();
  controllers.set(id, controller);
  return controller;
}

export function releaseVerdictRun(id: string) {
  controllers.delete(id);
}

/** 同进程内立即中止（worker 轮询命中中止请求时用）。 */
export function abortVerdictRun(id: string): boolean {
  const controller = controllers.get(id);
  if (!controller || controller.signal.aborted) return false;
  controller.abort();
  return true;
}

export function listVerdictRunIds() {
  return [...controllers.keys()];
}

/* ------------------------------------------------------------------ *
 * 3. 跳过标记（中止的确定性归属）
 * ------------------------------------------------------------------ */

function skipPath() {
  return runtimeFile('verdict-skips.json');
}

export function listVerdictSkips(): VerdictSkip[] {
  const parsed = readJson<{ items?: unknown }>(skipPath(), {});
  if (!Array.isArray(parsed.items)) return [];
  return parsed.items.filter((item): item is VerdictSkip => {
    if (!item || typeof item !== 'object') return false;
    const row = item as VerdictSkip;
    return typeof row.id === 'string' && Boolean(row.id.trim());
  });
}

export function skippedVerdictIds(): Set<string> {
  return new Set(listVerdictSkips().map((item) => item.id));
}

export function isVerdictSkipped(id: string) {
  return skippedVerdictIds().has(id);
}

export function countVerdictSkips() {
  return listVerdictSkips().length;
}

/** 中止后落标记：该份不再被自动队列领取，也从「排队智析」计数里扣除。 */
export function markVerdictSkipped(id: string, input: { reason?: string; elapsedMs?: number } = {}) {
  const key = id.trim();
  if (!key) return;
  const rest = listVerdictSkips().filter((item) => item.id !== key);
  const entry: VerdictSkip = {
    id: key,
    at: new Date().toISOString(),
    reason: input.reason?.trim() || '用户手动中止',
    ...(Number.isFinite(input.elapsedMs) ? { elapsedMs: Math.max(0, Math.round(input.elapsedMs as number)) } : {}),
  };
  writeJson(skipPath(), { items: [entry, ...rest].slice(0, SKIP_CAP) });
}

/** 「重新智析」：撤销跳过标记，让它重新进入自动队列。 */
export function clearVerdictSkip(id: string): boolean {
  const key = id.trim();
  if (!key) return false;
  const items = listVerdictSkips();
  const next = items.filter((item) => item.id !== key);
  if (next.length === items.length) return false;
  writeJson(skipPath(), { items: next });
  return true;
}

export function clearAllVerdictSkips(): number {
  const removed = listVerdictSkips().length;
  writeJson(skipPath(), { items: [] });
  return removed;
}
