import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { getIngestControl } from './ingest-control';
import { llmConfigured } from './llm-providers';
import { periodFromTitle } from './ingest-period';
import { enqueuePriorityVerdict, takePriorityVerdict } from './verdict-priority';
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

/** Model call once the LLM slot is held. 1 minute is too tight for long reports and failover. */
export const VERDICT_CALL_TIMEOUT_MS = 90_000;
/** Yield quickly if chat/问答 is using the global LLM lock. */
export const VERDICT_LOCK_WAIT_MS = 20_000;
/** Rest between reports so Q&A can slip in. */
export const VERDICT_PAUSE_MS = 15_000;
export const VERDICT_IDLE_MS = 30_000;
export const VERDICT_BUSY_MS = 8_000;
export const VERDICT_FAIL_BACKOFF_MS = 30 * 60_000;
export const VERDICT_CIRCUIT_FAILURES = 5;
export const VERDICT_CIRCUIT_MS = 10 * 60_000;

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
  current: VerdictQueueItem | null;
  last: VerdictQueueItem | null;
  upcoming: VerdictQueueItem[];
  consecutiveFailures: number;
  cooldownUntil: string | null;
  nextAt: string | null;
  processedOk: number;
  processedFail: number;
  note: string;
  updatedAt: string;
};

export type VerdictQueueOutcome = 'ok' | 'fail' | 'busy' | 'empty' | 'paused' | 'cooldown' | 'unconfigured' | 'skip';

const EMPTY: VerdictQueueState = {
  enabled: true,
  status: 'idle',
  pending: 0,
  current: null,
  last: null,
  upcoming: [],
  consecutiveFailures: 0,
  cooldownUntil: null,
  nextAt: null,
  processedOk: 0,
  processedFail: 0,
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
    return {
      ...EMPTY,
      ...parsed,
      current: parsed.current ?? null,
      last: parsed.last ?? null,
      upcoming: Array.isArray(parsed.upcoming) ? parsed.upcoming : [],
      consecutiveFailures: Number(parsed.consecutiveFailures) || 0,
      processedOk: Number(parsed.processedOk) || 0,
      processedFail: Number(parsed.processedFail) || 0,
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

export function getVerdictQueueState(): VerdictQueueState {
  const state = readState();
  const started = state.current?.startedAt ? Date.parse(state.current.startedAt) : NaN;
  if (state.current && Number.isFinite(started) && Date.now() - started > 10 * 60_000) {
    const next = {
      ...state,
      status: state.enabled ? 'idle' : 'paused',
      current: null,
      note: '智析任务中断，已恢复排队',
      updatedAt: new Date().toISOString(),
    } satisfies VerdictQueueState;
    writeState(next);
    return next;
  }
  return state;
}

export function verdictQueueDelay(outcome: VerdictQueueOutcome, cooldownRemainMs = 0) {
  if (outcome === 'paused' || outcome === 'unconfigured') return VERDICT_IDLE_MS;
  if (outcome === 'cooldown') return Math.max(1_000, cooldownRemainMs);
  if (outcome === 'busy') return VERDICT_BUSY_MS;
  if (outcome === 'empty' || outcome === 'skip') return VERDICT_IDLE_MS;
  return VERDICT_PAUSE_MS;
}

export function composeVerdictQueueNote(input: {
  enabled: boolean;
  pending: number;
  due: number;
  status: string;
  storedNote: string;
  last?: VerdictQueueItem | null;
}) {
  if (!input.enabled) return '自动智析已关';
  if (input.pending <= 0) return '队列已清空';
  if (input.status === 'running' && input.storedNote.trim()) return input.storedNote.trim();
  if (input.status === 'waiting_llm') return input.storedNote.trim() || '问答占用模型，稍后继续';
  if (input.status === 'cooldown') return input.storedNote.trim() || '连续失败，冷却后再试';
  if (input.due <= 0) return `待补 ${input.pending} 份，失败后冷却中，稍后自动重试`;
  const base = input.storedNote.trim() || `待补 ${input.pending} 份，空闲单线程补齐，单份限 90 秒`;
  if (input.last && input.last.ok === false && input.last.reason) {
    return `${base} · 上次：${input.last.name} ${input.last.period} ${input.last.reason}`;
  }
  return base;
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
};

export async function loadVerdictQueueView(enabled: boolean) {
  const stored = getVerdictQueueState();
  const pending = await countReportsNeedingVerdict().catch(() => stored.pending);
  const due = await countDueVerdictJobs(VERDICT_FAIL_BACKOFF_MS).catch(() => 0);
  const preview = await listReportsNeedingVerdict(16).catch(() => [] as VerdictQueueJob[]);
  const dueJobs = await listDueVerdictJobs(16, VERDICT_FAIL_BACKOFF_MS).catch(() => [] as VerdictQueueJob[]);
  const dueIds = new Set(dueJobs.map((job) => job.id));
  const items: VerdictQueueViewItem[] = [];
  const seen = new Set<string>();
  if (stored.current) {
    seen.add(stored.current.id);
    items.push({
      id: stored.current.id,
      code: stored.current.code,
      name: stored.current.name,
      label: `${stored.current.name} ${stored.current.period}`,
      period: stored.current.period,
      status: 'running',
      stage: 'verdict',
      position: 1,
      title: stored.current.title,
      progress: stored.note || '正在智析',
      startedAt: stored.current.startedAt,
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
      status: job.verdict_status === 'failed' ? 'retry' : (dueIds.has(job.id) ? 'queued' : 'queued'),
      stage: 'verdict',
      position: items.length + 1,
      title: job.title,
      reason: jobReason(job, dueIds),
    });
  }
  const note = composeVerdictQueueNote({
    enabled,
    pending,
    due,
    status: stored.status,
    storedNote: stored.note,
    last: stored.last,
  });
  return {
    ...stored,
    enabled,
    pending,
    due,
    note,
    items,
  };
}

function nextIso(ms: number) {
  return new Date(Date.now() + ms).toISOString();
}

async function snapshot(partial: Partial<VerdictQueueState>): Promise<VerdictQueueState> {
  const prev = readState();
  const pending = partial.pending ?? await countReportsNeedingVerdict().catch(() => prev.pending);
  const upcoming = partial.upcoming ?? prev.upcoming;
  const next: VerdictQueueState = {
    ...prev,
    ...partial,
    pending,
    upcoming,
    updatedAt: new Date().toISOString(),
  };
  writeState(next);
  return next;
}

export async function tickVerdictQueue(): Promise<number> {
  const control = await getIngestControl();
  const prev = readState();
  const priorityId = takePriorityVerdict();

  if (!llmConfigured()) {
    if (priorityId) enqueuePriorityVerdict(priorityId);
    await snapshot({
      enabled: true,
      status: 'paused',
      current: null,
      nextAt: nextIso(VERDICT_IDLE_MS),
      note: '未配置 AI 接口，自动智析暂停',
    });
    return verdictQueueDelay('unconfigured');
  }

  if (!priorityId && !control.autoVerdictEnabled) {
    await snapshot({
      enabled: false,
      status: 'paused',
      current: null,
      upcoming: [],
      nextAt: null,
      note: '自动智析已关',
      pending: await countReportsNeedingVerdict().catch(() => prev.pending),
    });
    return verdictQueueDelay('paused');
  }

  const cooldownUntil = prev.cooldownUntil ? Date.parse(prev.cooldownUntil) : NaN;
  if (!priorityId && Number.isFinite(cooldownUntil) && cooldownUntil > Date.now()) {
    const remain = cooldownUntil - Date.now();
    await snapshot({
      enabled: true,
      status: 'cooldown',
      current: null,
      nextAt: prev.cooldownUntil,
      note: `连续失败，冷却 ${Math.ceil(remain / 1000)}s`,
    });
    return verdictQueueDelay('cooldown', remain);
  }
  const streak = Number.isFinite(cooldownUntil) && cooldownUntil <= Date.now() ? 0 : prev.consecutiveFailures;

  let jobs = control.autoVerdictEnabled
    ? await listDueVerdictJobs(12, VERDICT_FAIL_BACKOFF_MS)
    : [];
  let forceId: string | null = null;
  if (priorityId) {
    const peek = await peekReportVerdict(priorityId);
    if (peek.status === 'pending' && !peek.stale && peek.ageMs < 12_000) {
      enqueuePriorityVerdict(priorityId);
      if (!jobs.length) return VERDICT_BUSY_MS;
    } else if (peek.status !== 'ready') {
      const extra = await getVerdictQueueJob(priorityId);
      if (extra) {
        forceId = extra.id;
        jobs = [extra, ...jobs.filter((item) => item.id !== extra.id)];
      }
    }
  }
  const pending = await countReportsNeedingVerdict();
  if (!jobs.length) {
    await snapshot({
      enabled: true,
      status: 'idle',
      pending,
      current: null,
      upcoming: [],
      consecutiveFailures: 0,
      cooldownUntil: null,
      nextAt: nextIso(VERDICT_IDLE_MS),
      note: pending > 0 ? `有 ${pending} 份待补，失败项冷却中` : '队列已清空',
    });
    return verdictQueueDelay('empty');
  }

  const job = jobs[0];
  const upcoming = jobs.slice(1, 8).map((item) => asItem(item));
  await snapshot({
    enabled: true,
    status: 'running',
    pending,
    current: asItem(job, { startedAt: new Date().toISOString() }),
    upcoming,
    cooldownUntil: null,
    nextAt: null,
    note: `正在智析 ${job.company_name}`,
  });

  const started = Date.now();
  let outcome: VerdictQueueOutcome = 'fail';
  let error: string | null = null;
  try {
    const result = await runQueuedVerdict(job.id, {
      timeoutMs: VERDICT_CALL_TIMEOUT_MS,
      acquireTimeoutMs: VERDICT_LOCK_WAIT_MS,
      force: forceId === job.id,
    });
    outcome = result.outcome;
    error = result.error;
  } catch (caught) {
    outcome = 'fail';
    error = caught instanceof Error ? caught.message : String(caught);
    console.warn('[verdict-queue] tick failed', { id: job.id, error });
  }

  const elapsedMs = Date.now() - started;
  const last = asItem(job, {
    at: new Date().toISOString(),
    ok: outcome === 'ok',
    reason: outcome === 'ok' ? '已生成' : (error || outcome),
    elapsedMs,
  });

  if (outcome === 'busy' || outcome === 'skip') {
    const delay = verdictQueueDelay(outcome);
    await snapshot({
      enabled: true,
      status: outcome === 'busy' ? 'waiting_llm' : 'idle',
      pending,
      current: null,
      last,
      upcoming,
      nextAt: nextIso(delay),
      note: outcome === 'busy' ? '问答占用模型，稍后继续' : '本份已跳过',
    });
    return delay;
  }

  const failures = outcome === 'ok' ? 0 : streak + 1;
  const openCircuit = outcome === 'fail' && failures >= VERDICT_CIRCUIT_FAILURES;
  const delay = openCircuit ? VERDICT_CIRCUIT_MS : verdictQueueDelay(outcome);
  await snapshot({
    enabled: true,
    status: openCircuit ? 'cooldown' : 'idle',
    pending: Math.max(0, pending - (outcome === 'ok' ? 1 : 0)),
    current: null,
    last,
    upcoming: upcoming.filter((item) => item.id !== job.id),
    consecutiveFailures: failures,
    cooldownUntil: openCircuit ? nextIso(VERDICT_CIRCUIT_MS) : null,
    nextAt: nextIso(delay),
    processedOk: prev.processedOk + (outcome === 'ok' ? 1 : 0),
    processedFail: prev.processedFail + (outcome === 'fail' ? 1 : 0),
    note: openCircuit
      ? '连续失败，冷却 10 分钟后再试'
      : (outcome === 'ok' ? `已完成 ${job.company_name}` : (error || '本份失败，已跳过')),
  });
  if (outcome === 'fail') {
    console.warn('[verdict-queue] skipped', { id: job.id, code: job.code, error, elapsedMs });
  } else {
    console.info('[verdict-queue] ok', { id: job.id, code: job.code, elapsedMs });
  }
  return delay;
}
