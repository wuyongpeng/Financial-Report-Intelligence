import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { getIngestControl } from './ingest-control';
import { getIngestSettings, llmTotalSlots } from './ingest-settings';
import { llmConfigured } from './llm-providers';
import { periodFromTitle } from './ingest-period';
import { enqueuePriorityVerdict, takePriorityVerdict } from './verdict-priority';
import {
  consumeVerdictAbort,
  countVerdictSkips,
  markVerdictSkipped,
  registerVerdictRun,
  releaseVerdictRun,
  skippedVerdictIds,
} from './verdict-abort';
import {
  countDueVerdictJobs,
  countReportsNeedingVerdict,
  getVerdictQueueJob,
  listDueVerdictJobs,
  listReportsNeedingVerdict,
  peekReportVerdict,
  runQueuedVerdict,
  type VerdictQueueJob,
} from './report-verdict-store';

/** Model call: 30s for first token, 5 minutes to finish. */
export const VERDICT_CALL_TIMEOUT_MS = 300_000;
/** Yield quickly if chat/问答 is using the global LLM lock. */
export const VERDICT_LOCK_WAIT_MS = 20_000;
/** Rest between reports so Q&A can slip in. */
export const VERDICT_PAUSE_MS = 15_000;
export const VERDICT_IDLE_MS = 30_000;
export const VERDICT_BUSY_MS = 8_000;
export const VERDICT_FAIL_BACKOFF_MS = 30 * 60_000;
/** Legacy consecutive-failure threshold. Kept for the 并发=1 path and existing callers. */
export const VERDICT_CIRCUIT_FAILURES = 5;
export const VERDICT_CIRCUIT_MS = 10 * 60_000;
/** How often a running job checks for a cross-process 中止 request. */
export const VERDICT_ABORT_POLL_MS = 1_500;

/**
 * Sliding-window circuit breaker.
 * 「连续失败 N 次」assumes a single-threaded timeline; with 并发 3 three simultaneous failures
 * would trip it instantly and stall the whole queue. A failure *rate* over the last N outcomes
 * is concurrency-safe: it needs a real sustained problem, not one unlucky batch.
 */
export const VERDICT_WINDOW_SIZE = 20;
export const VERDICT_WINDOW_MIN_SAMPLES = 6;
export const VERDICT_WINDOW_FAIL_RATE = 0.6;

export type VerdictQueueStatus = 'idle' | 'running' | 'paused' | 'cooldown' | 'waiting_llm';

export type VerdictQueueItem = {
  id: string;
  code: string;
  name: string;
  period: string;
  title: string;
  startedAt?: string;
  at?: string;
  ok?: boolean;
  reason?: string;
  elapsedMs?: number;
};

export type VerdictQueueState = {
  enabled: boolean;
  status: VerdictQueueStatus;
  pending: number;
  /** Newest running job. Kept for backwards compatibility with existing readers. */
  current: VerdictQueueItem | null;
  /** All in-flight jobs (length ≤ verdictLimit). */
  running: VerdictQueueItem[];
  last: VerdictQueueItem | null;
  upcoming: VerdictQueueItem[];
  consecutiveFailures: number;
  /** Recent outcomes, newest last, capped at VERDICT_WINDOW_SIZE. */
  window: Array<'ok' | 'fail'>;
  cooldownUntil: string | null;
  nextAt: string | null;
  processedOk: number;
  processedFail: number;
  processedAborted: number;
  note: string;
  updatedAt: string;
};

export type VerdictQueueOutcome =
  | 'ok' | 'fail' | 'busy' | 'empty' | 'paused' | 'cooldown' | 'unconfigured' | 'skip' | 'aborted';

const EMPTY: VerdictQueueState = {
  enabled: true,
  status: 'idle',
  pending: 0,
  current: null,
  running: [],
  last: null,
  upcoming: [],
  consecutiveFailures: 0,
  window: [],
  cooldownUntil: null,
  nextAt: null,
  processedOk: 0,
  processedFail: 0,
  processedAborted: 0,
  note: '',
  updatedAt: new Date(0).toISOString(),
};

function statePath() {
  return join(process.env.RUNTIME_DIR ?? resolve(/* turbopackIgnore: true */ process.cwd(), '.data'), 'verdict-queue.json');
}

function asItem(job: VerdictQueueJob, extra: Partial<VerdictQueueItem> = {}): VerdictQueueItem {
  return {
    id: job.id,
    code: job.code,
    name: job.company_name,
    period: periodFromTitle(job.title, job.published_at),
    title: job.title,
    ...extra,
  };
}

function readState(): VerdictQueueState {
  try {
    const parsed = JSON.parse(readFileSync(statePath(), 'utf8')) as Partial<VerdictQueueState>;
    const running = Array.isArray(parsed.running)
      ? parsed.running
      : (parsed.current ? [parsed.current] : []);
    return {
      ...EMPTY,
      ...parsed,
      current: parsed.current ?? running[0] ?? null,
      running,
      last: parsed.last ?? null,
      upcoming: Array.isArray(parsed.upcoming) ? parsed.upcoming : [],
      window: Array.isArray(parsed.window)
        ? parsed.window.filter((item): item is 'ok' | 'fail' => item === 'ok' || item === 'fail')
        : [],
      consecutiveFailures: Number(parsed.consecutiveFailures) || 0,
      processedOk: Number(parsed.processedOk) || 0,
      processedFail: Number(parsed.processedFail) || 0,
      processedAborted: Number(parsed.processedAborted) || 0,
    };
  } catch {
    return { ...EMPTY, updatedAt: new Date().toISOString() };
  }
}

function writeState(state: VerdictQueueState) {
  const target = statePath();
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(state)}\n`);
}

/** Drop running entries whose worker died mid-flight so the UI does not show a phantom 智析中. */
export function pruneStuckRunning(running: VerdictQueueItem[], now = Date.now(), maxAgeMs = 10 * 60_000) {
  return running.filter((item) => {
    const started = item.startedAt ? Date.parse(item.startedAt) : NaN;
    if (!Number.isFinite(started)) return false;
    return now - started <= maxAgeMs;
  });
}

export function getVerdictQueueState(): VerdictQueueState {
  const state = readState();
  const alive = pruneStuckRunning(state.running);
  if (alive.length === state.running.length) return state;
  const next = {
    ...state,
    status: state.enabled ? (alive.length ? 'running' : 'idle') : 'paused',
    running: alive,
    current: alive[0] ?? null,
    note: alive.length ? state.note : '智析任务中断，已恢复排队',
    updatedAt: new Date().toISOString(),
  } satisfies VerdictQueueState;
  writeState(next);
  return next;
}

export function verdictQueueDelay(outcome: VerdictQueueOutcome, cooldownRemainMs = 0) {
  if (outcome === 'paused' || outcome === 'unconfigured') return VERDICT_IDLE_MS;
  if (outcome === 'cooldown') return Math.max(1_000, cooldownRemainMs);
  if (outcome === 'busy') return VERDICT_BUSY_MS;
  if (outcome === 'empty' || outcome === 'skip') return VERDICT_IDLE_MS;
  // 中止后要立刻补位，让排队队列最前面的顶上来，不能等 15 秒。
  if (outcome === 'aborted') return 1_000;
  return VERDICT_PAUSE_MS;
}

/** Newest-last window. */
export function pushVerdictWindow(window: Array<'ok' | 'fail'>, outcome: 'ok' | 'fail') {
  return [...window, outcome].slice(-VERDICT_WINDOW_SIZE);
}

/** Sustained failure rate, not a single unlucky concurrent batch. */
export function shouldOpenVerdictCircuit(window: Array<'ok' | 'fail'>) {
  if (window.length < VERDICT_WINDOW_MIN_SAMPLES) return false;
  const fails = window.filter((item) => item === 'fail').length;
  return fails / window.length >= VERDICT_WINDOW_FAIL_RATE;
}

export function verdictWindowFailRate(window: Array<'ok' | 'fail'>) {
  if (!window.length) return 0;
  return window.filter((item) => item === 'fail').length / window.length;
}

export function composeVerdictQueueNote(input: {
  enabled: boolean;
  pending: number;
  due: number;
  status: string;
  storedNote: string;
  last?: VerdictQueueItem | null;
  runningCount?: number;
  limit?: number;
  skipped?: number;
}) {
  if (!input.enabled) return '自动智析已关';
  const skipTail = input.skipped && input.skipped > 0 ? ` · 已跳过 ${input.skipped} 份可重新智析` : '';
  if (input.pending <= 0) return `队列已清空${skipTail}`;
  if (input.status === 'running' && input.storedNote.trim()) return `${input.storedNote.trim()}${skipTail}`;
  if (input.status === 'waiting_llm') return `${input.storedNote.trim() || '问答占用模型，稍后继续'}${skipTail}`;
  if (input.status === 'cooldown') return `${input.storedNote.trim() || '失败率过高，冷却后再试'}${skipTail}`;
  if (input.due <= 0) return `待补 ${input.pending} 份，失败后冷却中，稍后自动重试${skipTail}`;
  const limit = input.limit ?? 1;
  const base = input.storedNote.trim()
    || `待补 ${input.pending} 份，并发 ${limit} 补齐，首字 30 秒，整段 5 分钟`;
  if (input.last && input.last.ok === false && input.last.reason) {
    return `${base} · 上次：${input.last.name} ${input.last.period} ${input.last.reason}${skipTail}`;
  }
  return `${base}${skipTail}`;
}

function jobReason(job: VerdictQueueJob, dueIds: Set<string>) {
  if (job.verdict_status === 'pending') return '生成中';
  if (job.verdict_status === 'failed') return job.verdict_error?.trim() || '失败冷却中';
  if (dueIds.has(job.id)) return '等待自动智析';
  return '尚未生成';
}

export type VerdictQueueViewItem = {
  id: string;
  code: string;
  name: string;
  label: string;
  period: string;
  status: string;
  stage: 'verdict';
  position: number;
  title: string;
  reason?: string;
  progress?: string;
  startedAt?: string;
  /** Running jobs can be aborted; queued ones cannot. */
  abortable?: boolean;
};

export async function loadVerdictQueueView(enabled: boolean) {
  const stored = getVerdictQueueState();
  const settings = getIngestSettings();
  const skipped = skippedVerdictIds();
  const pending = await countReportsNeedingVerdict(skipped).catch(() => stored.pending);
  const due = await countDueVerdictJobs(VERDICT_FAIL_BACKOFF_MS, skipped).catch(() => 0);
  const preview = await listReportsNeedingVerdict(16, skipped).catch(() => [] as VerdictQueueJob[]);
  const dueJobs = await listDueVerdictJobs(16, VERDICT_FAIL_BACKOFF_MS, skipped).catch(() => [] as VerdictQueueJob[]);
  const dueIds = new Set(dueJobs.map((job) => job.id));
  const items: VerdictQueueViewItem[] = [];
  const seen = new Set<string>();
  for (const active of stored.running) {
    if (seen.has(active.id)) continue;
    seen.add(active.id);
    items.push({
      id: active.id,
      code: active.code,
      name: active.name,
      label: `${active.name} ${active.period}`,
      period: active.period,
      status: 'running',
      stage: 'verdict',
      position: items.length + 1,
      title: active.title,
      progress: stored.note || '正在智析',
      startedAt: active.startedAt,
      abortable: true,
    });
  }
  for (const job of preview) {
    if (seen.has(job.id)) continue;
    seen.add(job.id);
    const item = asItem(job);
    items.push({
      id: job.id,
      code: job.code,
      name: job.company_name,
      label: `${item.name} ${item.period}`,
      period: item.period,
      status: job.verdict_status === 'failed' ? 'retry' : 'queued',
      stage: 'verdict',
      position: items.length + 1,
      title: job.title,
      reason: jobReason(job, dueIds),
      abortable: false,
    });
  }
  const skippedCount = countVerdictSkips();
  const note = composeVerdictQueueNote({
    enabled,
    pending,
    due,
    status: stored.status,
    storedNote: stored.note,
    last: stored.last,
    runningCount: stored.running.length,
    limit: settings.verdictLimit,
    skipped: skippedCount,
  });
  return {
    ...stored,
    enabled,
    pending,
    due,
    note,
    items,
    /** 智析中(x/N) */
    slots: { used: stored.running.length, max: settings.verdictLimit },
    skippedCount,
    failRate: verdictWindowFailRate(stored.window),
  };
}

function nextIso(ms: number) {
  return new Date(Date.now() + ms).toISOString();
}

async function snapshot(partial: Partial<VerdictQueueState>): Promise<VerdictQueueState> {
  const prev = readState();
  const pending = partial.pending
    ?? await countReportsNeedingVerdict(skippedVerdictIds()).catch(() => prev.pending);
  const upcoming = partial.upcoming ?? prev.upcoming;
  const running = partial.running ?? prev.running;
  const next: VerdictQueueState = {
    ...prev,
    ...partial,
    pending,
    upcoming,
    running,
    current: 'current' in partial ? (partial.current ?? null) : (running[0] ?? null),
    updatedAt: new Date().toISOString(),
  };
  writeState(next);
  return next;
}

/** Mark one job as started without clobbering sibling concurrent jobs. */
async function addRunning(item: VerdictQueueItem, note: string, pending: number, upcoming: VerdictQueueItem[]) {
  const prev = readState();
  const running = [...prev.running.filter((row) => row.id !== item.id), item];
  return snapshot({
    enabled: true,
    status: 'running',
    pending,
    running,
    current: item,
    upcoming: upcoming.filter((row) => !running.some((active) => active.id === row.id)),
    cooldownUntil: null,
    nextAt: null,
    note,
  });
}

async function removeRunning(id: string, partial: Partial<VerdictQueueState>) {
  const prev = readState();
  const running = prev.running.filter((row) => row.id !== id);
  return snapshot({ ...partial, running, current: running[0] ?? null });
}

/** Abort the model call as soon as a 中止 request lands, even from another process. */
function watchAbort(id: string, controller: AbortController) {
  const timer = setInterval(() => {
    if (controller.signal.aborted) return;
    if (consumeVerdictAbort(id)) controller.abort();
  }, VERDICT_ABORT_POLL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

/**
 * Run exactly one job to completion. The caller decides how many of these to run in parallel.
 * Returns the delay the scheduler should honour before the next pick.
 */
export async function runVerdictJob(job: VerdictQueueJob, options: { force?: boolean; slots?: number } = {}) {
  const controller = registerVerdictRun(job.id);
  const stopWatch = watchAbort(job.id, controller);
  const started = Date.now();
  let outcome: VerdictQueueOutcome = 'fail';
  let error: string | null = null;
  try {
    const result = await runQueuedVerdict(job.id, {
      timeoutMs: VERDICT_CALL_TIMEOUT_MS,
      acquireTimeoutMs: VERDICT_LOCK_WAIT_MS,
      force: options.force,
      signal: controller.signal,
      slots: options.slots,
      lane: 'background',
    });
    outcome = result.outcome;
    error = result.error;
  } catch (caught) {
    if (controller.signal.aborted) {
      outcome = 'aborted';
      error = '已手动中止';
    } else {
      outcome = 'fail';
      error = caught instanceof Error ? caught.message : String(caught);
      console.warn('[verdict-queue] job failed', { id: job.id, error });
    }
  } finally {
    stopWatch();
    releaseVerdictRun(job.id);
  }

  const elapsedMs = Date.now() - started;
  const last = asItem(job, {
    at: new Date().toISOString(),
    ok: outcome === 'ok',
    reason: outcome === 'ok' ? '已生成' : (outcome === 'aborted' ? '已手动中止' : (error || outcome)),
    elapsedMs,
  });

  // 中止的确定性归属：落 skip 标记，从待办里扣除，绝不在下个 tick 被重新捡起。
  if (outcome === 'aborted') {
    markVerdictSkipped(job.id, { reason: '用户手动中止', elapsedMs });
    const prev = readState();
    await removeRunning(job.id, {
      enabled: true,
      last,
      processedAborted: prev.processedAborted + 1,
      nextAt: nextIso(verdictQueueDelay('aborted')),
      note: `已中止 ${job.company_name}，队首任务补位`,
    });
    console.info('[verdict-queue] aborted', { id: job.id, code: job.code, elapsedMs });
    return { outcome, delay: verdictQueueDelay('aborted'), error };
  }

  if (outcome === 'busy' || outcome === 'skip') {
    const delay = verdictQueueDelay(outcome);
    await removeRunning(job.id, {
      enabled: true,
      status: outcome === 'busy' ? 'waiting_llm' : 'idle',
      last,
      nextAt: nextIso(delay),
      note: outcome === 'busy' ? '问答占用模型，稍后继续' : '本份已跳过',
    });
    return { outcome, delay, error };
  }

  const prev = readState();
  const window = pushVerdictWindow(prev.window, outcome === 'ok' ? 'ok' : 'fail');
  const failures = outcome === 'ok' ? 0 : prev.consecutiveFailures + 1;
  const openCircuit = outcome === 'fail' && shouldOpenVerdictCircuit(window);
  const delay = openCircuit ? VERDICT_CIRCUIT_MS : verdictQueueDelay(outcome);
  await removeRunning(job.id, {
    enabled: true,
    status: openCircuit ? 'cooldown' : 'idle',
    last,
    window: openCircuit ? [] : window,
    consecutiveFailures: failures,
    cooldownUntil: openCircuit ? nextIso(VERDICT_CIRCUIT_MS) : null,
    nextAt: nextIso(delay),
    processedOk: prev.processedOk + (outcome === 'ok' ? 1 : 0),
    processedFail: prev.processedFail + (outcome === 'fail' ? 1 : 0),
    note: openCircuit
      ? `最近 ${window.length} 次失败率过高，冷却 10 分钟后再试`
      : (outcome === 'ok' ? `已完成 ${job.company_name}` : (error || '本份失败，已跳过')),
  });
  if (outcome === 'fail') {
    console.warn('[verdict-queue] skipped', { id: job.id, code: job.code, error, elapsedMs });
  } else {
    console.info('[verdict-queue] ok', { id: job.id, code: job.code, elapsedMs });
  }
  return { outcome, delay, error };
}

export type VerdictClaim = { job: VerdictQueueJob; force: boolean };

/**
 * Pick up to `want` jobs, honouring pause / cooldown / manual priority.
 * `busyIds` are the ones this process already has in flight.
 */
export async function claimVerdictJobs(want: number, busyIds: Iterable<string> = []): Promise<
  { claims: VerdictClaim[]; delay: number; reason: VerdictQueueOutcome | 'ready' }
> {
  const control = await getIngestControl();
  const prev = readState();
  const busy = new Set([...busyIds]);
  const skipped = skippedVerdictIds();

  if (!llmConfigured()) {
    await snapshot({
      enabled: true,
      status: 'paused',
      running: [],
      current: null,
      nextAt: nextIso(VERDICT_IDLE_MS),
      note: '未配置 AI 接口，自动智析暂停',
    });
    return { claims: [], delay: verdictQueueDelay('unconfigured'), reason: 'unconfigured' };
  }

  const priorityId = takePriorityVerdict();
  if (!priorityId && !control.autoVerdictEnabled) {
    await snapshot({
      enabled: false,
      status: 'paused',
      running: [],
      current: null,
      upcoming: [],
      nextAt: null,
      note: '自动智析已关',
      pending: await countReportsNeedingVerdict(skipped).catch(() => prev.pending),
    });
    return { claims: [], delay: verdictQueueDelay('paused'), reason: 'paused' };
  }

  const cooldownUntil = prev.cooldownUntil ? Date.parse(prev.cooldownUntil) : NaN;
  if (!priorityId && Number.isFinite(cooldownUntil) && cooldownUntil > Date.now()) {
    if (priorityId) enqueuePriorityVerdict(priorityId);
    const remain = cooldownUntil - Date.now();
    await snapshot({
      enabled: true,
      status: 'cooldown',
      nextAt: prev.cooldownUntil,
      note: `失败率过高，冷却 ${Math.ceil(remain / 1000)}s`,
    });
    return { claims: [], delay: verdictQueueDelay('cooldown', remain), reason: 'cooldown' };
  }

  const cap = Math.max(1, Math.floor(want));
  let jobs: VerdictQueueJob[] = control.autoVerdictEnabled
    ? await listDueVerdictJobs(Math.max(12, cap * 4), VERDICT_FAIL_BACKOFF_MS, skipped)
    : [];
  const forceIds = new Set<string>();
  if (priorityId) {
    const peek = await peekReportVerdict(priorityId);
    if (peek.status === 'pending' && !peek.stale) {
      enqueuePriorityVerdict(priorityId);
    } else if (peek.status !== 'ready') {
      const extra = await getVerdictQueueJob(priorityId);
      if (extra) {
        forceIds.add(extra.id);
        jobs = [extra, ...jobs.filter((item) => item.id !== extra.id)];
      }
    }
  }

  const claims: VerdictClaim[] = [];
  for (const job of jobs) {
    if (claims.length >= cap) break;
    if (busy.has(job.id)) continue;
    claims.push({ job, force: forceIds.has(job.id) });
  }

  const pending = await countReportsNeedingVerdict(skipped);
  if (!claims.length) {
    await snapshot({
      enabled: true,
      status: busy.size ? 'running' : 'idle',
      pending,
      upcoming: [],
      cooldownUntil: null,
      nextAt: nextIso(VERDICT_IDLE_MS),
      note: pending > 0 ? `有 ${pending} 份待补，失败项冷却中` : '队列已清空',
    });
    return { claims: [], delay: verdictQueueDelay('empty'), reason: 'empty' };
  }

  const upcoming = jobs
    .filter((item) => !claims.some((claim) => claim.job.id === item.id))
    .slice(0, 8)
    .map((item) => asItem(item));
  for (const claim of claims) {
    await addRunning(
      asItem(claim.job, { startedAt: new Date().toISOString() }),
      `正在智析 ${claim.job.company_name}`,
      pending,
      upcoming,
    );
  }
  return { claims, delay: VERDICT_PAUSE_MS, reason: 'ready' };
}

/**
 * Legacy single-job tick. Kept so any existing caller (and 并发=1) behaves exactly as before.
 * The worker now uses claimVerdictJobs + runVerdictJob for real concurrency.
 */
export async function tickVerdictQueue(): Promise<number> {
  const slots = llmTotalSlots();
  const picked = await claimVerdictJobs(1);
  if (!picked.claims.length) return picked.delay;
  const claim = picked.claims[0];
  const result = await runVerdictJob(claim.job, { force: claim.force, slots });
  return result.delay;
}
