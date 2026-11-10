export const ACCEPTANCE_STATUSES = ['pending', 'pass', 'fail', 'blocked'] as const;

export type AcceptanceStatus = (typeof ACCEPTANCE_STATUSES)[number];

export const ACCEPTANCE_STATUS_LABEL: Record<AcceptanceStatus, string> = {
  pending: '未测',
  pass: '通过',
  fail: '未通过',
  blocked: '阻塞',
};

export type RunPhase = 'ready' | 'running' | 'done';

export const RUN_PHASE_LABEL: Record<RunPhase, string> = {
  ready: '未开始',
  running: '测试中',
  done: '已结束',
};

export const RUN_PHASE_ACTION: Record<RunPhase, string> = {
  ready: '开始测试',
  running: '继续测试',
  done: '查看',
};

/** Outer-table state: nothing recorded yet, some recorded, or every row has a result. */
export function runPhase(counts: { total: number; pending: number }): RunPhase {
  const total = Math.max(0, counts.total);
  const pending = Math.max(0, counts.pending);
  if (total === 0 || pending >= total) return 'ready';
  if (pending === 0) return 'done';
  return 'running';
}

export function acceptanceStatus(value: unknown): AcceptanceStatus | null {
  return typeof value === 'string' && (ACCEPTANCE_STATUSES as readonly string[]).includes(value)
    ? value as AcceptanceStatus
    : null;
}

/** Default run name in Asia/Shanghai, e.g. 11-10 11:14 测试. */
export function defaultRunTitle(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute} 测试`;
}
