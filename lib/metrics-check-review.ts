import { CHECK_METRICS, type CheckCell, type CheckMetric } from './metrics-check';

export type CheckReviewStatus = 'approved' | 'flagged';
export type CheckReview = {
  code: string; period: string; metric: CheckMetric; fingerprint: string;
  status: CheckReviewStatus;
};
export type CheckSnapshotCell = CheckCell & {
  fingerprint: string;
  announcementId: string | null;
};
export type ReviewedCheckCell = CheckSnapshotCell & {
  reviewStatus: CheckReviewStatus | null;
  reviewStale: boolean;
};
export const checkReviewKey = (cell: Pick<CheckCell, 'code' | 'period' | 'metric'>) =>
  `${cell.code}:${cell.period}:${cell.metric}`;

/** Never change raw BAD/MISS/OK or values: review is a separate workflow state. */
export function applyCheckReviews(cells: CheckSnapshotCell[], reviews: CheckReview[]): ReviewedCheckCell[] {
  const byKey = new Map(reviews.map(review => [checkReviewKey(review), review]));
  return cells.map(cell => {
    const review = byKey.get(checkReviewKey(cell));
    const matches = review?.fingerprint === cell.fingerprint;
    return { ...cell, reviewStatus: matches ? review!.status : null, reviewStale: Boolean(review && !matches) };
  });
}

export function isPendingCheck(cell: ReviewedCheckCell): boolean {
  return cell.reviewStatus === 'flagged' || (cell.reviewStatus !== 'approved' && cell.status !== 'OK');
}

export function summarizeCheckReviews(cells: ReviewedCheckCell[]) {
  const result = Object.fromEntries(CHECK_METRICS.map(metric => [metric, { pending: 0, approved: 0, flagged: 0 }])) as
    Record<CheckMetric, { pending: number; approved: number; flagged: number }>;
  for (const cell of cells) {
    if (isPendingCheck(cell)) result[cell.metric].pending++;
    if (cell.reviewStatus === 'approved') result[cell.metric].approved++;
    if (cell.reviewStatus === 'flagged') result[cell.metric].flagged++;
  }
  return result;
}

export function parseCheckReviewInput(value: unknown): CheckReview | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (body.action !== undefined) return null;
  if (typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)
    || typeof body.period !== 'string' || !/^20\d{2}(Q[1-4]|H1|FY)$/.test(body.period)
    || !CHECK_METRICS.includes(body.metric as CheckMetric)
    || typeof body.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(body.fingerprint)
    || (body.status !== 'approved' && body.status !== 'flagged')) return null;
  return { code: body.code, period: body.period, metric: body.metric as CheckMetric,
    fingerprint: body.fingerprint, status: body.status };
}

/** No optimistic approval against a result that changed after the operator saw it. */
export function findCheckReviewTarget(cells: CheckSnapshotCell[], review: Pick<CheckReview, 'code' | 'period' | 'metric' | 'fingerprint'>) {
  const cell = cells.find(cell => checkReviewKey(cell) === checkReviewKey(review));
  if (!cell) return { ok: false as const, status: 404, error: '核对结果不存在，请刷新' };
  if (cell.fingerprint !== review.fingerprint) return { ok: false as const, status: 409, error: '核对数据已变化，请刷新后重新审核' };
  return { ok: true as const, cell };
}


export type CheckProgressStatus = 'open' | 'in_progress' | 'resolved';
export const CHECK_PROGRESS_LABEL: Record<CheckProgressStatus, string> = {
  open: '未处理', in_progress: '处理中', resolved: '已处理',
};
export type CheckProgress = Omit<CheckReview, 'status'> & {
  status: CheckProgressStatus; note: string; updatedAt?: string;
};
export type ManagedCheckCell = ReviewedCheckCell & {
  progressStatus: CheckProgressStatus;
  progressNote: string;
  progressUpdatedAt: string | null;
  progressStale: boolean;
};
export function applyCheckProgress(cells: ReviewedCheckCell[], progress: CheckProgress[]): ManagedCheckCell[] {
  // SQL reader passes only the newest event for each key, not every history event.
  const byKey = new Map(progress.map(item => [checkReviewKey(item), item]));
  return cells.map(cell => {
    const item = byKey.get(checkReviewKey(cell));
    const stale = Boolean(item && item.fingerprint !== cell.fingerprint);
    return { ...cell, progressStatus: item && !stale ? item.status : 'open',
      progressNote: item?.note ?? '', progressUpdatedAt: item?.updatedAt ?? null, progressStale: stale };
  });
}
export function summarizeCheckProgress(cells: ManagedCheckCell[]) {
  const result = { open: 0, in_progress: 0, resolved: 0 };
  for (const cell of cells) result[cell.progressStatus]++;
  return result;
}
export function parseCheckProgressInput(value: unknown): CheckProgress | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const base = parseCheckReviewInput({ ...body, action: undefined, status: 'approved' });
  if (!base || body.action !== 'progress'
    || !['open', 'in_progress', 'resolved'].includes(String(body.status))
    || typeof body.note !== 'string' || body.note.length > 300) return null;
  return { ...base, status: body.status as CheckProgressStatus, note: body.note.trim() };
}
