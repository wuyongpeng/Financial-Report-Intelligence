import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseLlmProviders, type LlmProvider } from './llm-providers';

type LockPayload = { pid: number; at: number };

const STALE_MS = 3 * 60 * 1000;
const SLOT_WAIT_MS = 4 * 60 * 1000;
const MAX_RETRY_DELAY_MS = 60_000;

export class LlmSlotBusyError extends Error {
  constructor(message = 'LLM 槽位占用') {
    super(message);
    this.name = 'LlmSlotBusyError';
  }
}

export function isLlmSlotBusyError(error: unknown) {
  return error instanceof LlmSlotBusyError || (error instanceof Error && error.name === 'LlmSlotBusyError');
}

let tail: Promise<unknown> = Promise.resolve();

function lockPath() {
  return process.env.LLM_GATE_FILE || join(process.cwd(), '.data', 'llm-gate.lock');
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function pidAlive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLock(file: string): LockPayload | null {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as LockPayload;
    if (!Number.isFinite(raw.pid) || !Number.isFinite(raw.at)) return null;
    return { pid: raw.pid, at: raw.at };
  } catch {
    return null;
  }
}

function lockIsStale(file: string, now = Date.now()) {
  const lock = readLock(file);
  if (!lock) return true;
  if (now - lock.at > STALE_MS) return true;
  if (lock.pid !== process.pid && !pidAlive(lock.pid)) return true;
  return false;
}

function tryCreateLock(file: string) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ pid: process.pid, at: Date.now() })}\n`, { flag: 'wx' });
}

async function acquireFileLock(signal?: AbortSignal, maxWaitMs = SLOT_WAIT_MS) {
  const file = lockPath();
  const started = Date.now();
  const budget = Number.isFinite(maxWaitMs) && maxWaitMs > 0 ? maxWaitMs : SLOT_WAIT_MS;
  while (Date.now() - started < budget) {
    if (signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
    try {
      tryCreateLock(file);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw error;
      if (lockIsStale(file)) {
        try { unlinkSync(file); } catch { /* raced */ }
        continue;
      }
      await sleep(120 + Math.floor(Math.random() * 80), signal);
    }
  }
  if (budget < SLOT_WAIT_MS) throw new LlmSlotBusyError();
  throw new Error('LLM 排队超时');
}

function releaseFileLock() {
  const file = lockPath();
  const lock = readLock(file);
  if (lock && lock.pid !== process.pid) return;
  try { unlinkSync(file); } catch { /* already gone */ }
}

/** Delay before retrying a 429/503. attempt is 0-based. */
export function llmRetryDelayMs(attempt: number, retryAfterHeader: string | null | undefined, now = Date.now()) {
  const header = retryAfterHeader?.trim() ?? '';
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.max(seconds * 1000, 200), MAX_RETRY_DELAY_MS);
    const until = Date.parse(header);
    if (Number.isFinite(until)) return Math.min(Math.max(until - now, 200), MAX_RETRY_DELAY_MS);
  }
  const exp = Math.min(MAX_RETRY_DELAY_MS, 2000 * 2 ** Math.max(0, attempt));
  return exp;
}

export function shouldRetryLlmStatus(status: number) {
  return status === 429;
}

/** After same-provider 429 retries, switch vendor on these statuses. */
export function shouldFailoverLlmStatus(status: number) {
  return status === 401 || status === 403 || status === 408 || status === 429 || status >= 500;
}

const STICKY_MS = 3 * 60 * 1000;
let stickyId: string | null = null;
let stickyUntil = 0;

export function resetLlmProviderState() {
  stickyId = null;
  stickyUntil = 0;
}

function rememberSuccess(provider: LlmProvider) {
  stickyId = provider.id;
  stickyUntil = Date.now() + STICKY_MS;
}

function orderedProviders() {
  const all = parseLlmProviders();
  if (!stickyId || Date.now() > stickyUntil) return all;
  const index = all.findIndex((item) => item.id === stickyId);
  if (index <= 0) return all;
  return [...all.slice(index), ...all.slice(0, index)];
}

function payloadFor(provider: LlmProvider, body: unknown) {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return { ...(body as Record<string, unknown>), model: provider.model };
  }
  return { model: provider.model };
}

function providerTimeoutMs(timeoutMs: number, isLast: boolean) {
  if (isLast) return timeoutMs;
  const raw = Number(process.env.LLM_FAILOVER_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return timeoutMs;
  return Math.min(timeoutMs, Math.max(raw, 1000));
}

async function fetchFromProvider(
  provider: LlmProvider,
  body: unknown,
  options: { signal?: AbortSignal; timeoutMs: number },
): Promise<Response> {
  const url = `${provider.baseUrl}/chat/completions`;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`;
  const payload = JSON.stringify(payloadFor(provider, body));
  const maxAttempts = 5;
  let last: Response | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (options.signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      last = await fetch(url, { method: 'POST', signal: controller.signal, headers, body: payload });
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
    if (!shouldRetryLlmStatus(last.status)) return last;
    if (attempt === maxAttempts - 1) return last;
    const wait = llmRetryDelayMs(attempt, last.headers.get('retry-after')) + Math.floor(Math.random() * 400);
    console.warn('[llm] rate limited, backing off', { provider: provider.id, status: last.status, wait, attempt: attempt + 1 });
    await last.text().catch(() => '');
    await sleep(wait, options.signal);
  }
  return last!;
}

/** One in-flight LLM call across this process and other local processes sharing the lock file. */
export async function withLlmSlot<T>(
  fn: () => Promise<T>,
  signal?: AbortSignal,
  acquireTimeoutMs?: number,
): Promise<T> {
  if (signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
  const run = tail.then(async () => {
    if (signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
    await acquireFileLock(signal, acquireTimeoutMs);
    try {
      return await fn();
    } finally {
      releaseFileLock();
    }
  });
  tail = run.then(() => undefined, () => undefined);
  return run;
}

export async function fetchChatCompletions(
  body: unknown,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Response> {
  const providers = orderedProviders();
  if (!providers.length) throw new Error('LLM_BASE_URL is not configured');
  const timeoutMs = options.timeoutMs ?? 60_000;
  let last: Response | undefined;
  let lastError: unknown;
  for (let index = 0; index < providers.length; index++) {
    const provider = providers[index];
    const isLast = index === providers.length - 1;
    try {
      last = await fetchFromProvider(provider, body, {
        signal: options.signal,
        timeoutMs: providerTimeoutMs(timeoutMs, isLast),
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      lastError = error;
      console.warn('[llm] provider failed', { provider: provider.id, message: String(error) });
      if (isLast) throw error;
      continue;
    }
    if (last.ok) {
      rememberSuccess(provider);
      if (index > 0) console.warn('[llm] using fallback provider', { provider: provider.id, model: provider.model });
      return last;
    }
    if (!shouldFailoverLlmStatus(last.status) || isLast) return last;
    console.warn('[llm] failover', { from: provider.id, status: last.status, next: providers[index + 1]?.id });
    await last.text().catch(() => '');
  }
  if (last) return last;
  throw lastError ?? new Error('LLM_BASE_URL is not configured');
}
