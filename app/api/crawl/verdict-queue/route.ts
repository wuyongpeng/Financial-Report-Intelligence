import { demoAccessEnabled, isAppUser } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { listVerdictJobsByIds } from '@/lib/report-verdict-store';
import { periodFromTitle } from '@/lib/ingest-period';
import {
  abortVerdictRun,
  clearAllVerdictSkips,
  clearVerdictSkip,
  listVerdictSkips,
  markVerdictSkipped,
  requestVerdictAbort,
} from '@/lib/verdict-abort';
import { enqueuePriorityVerdict } from '@/lib/verdict-priority';
import { getVerdictQueueState } from '@/lib/verdict-queue';

export const dynamic = 'force-dynamic';

function authorized(request: Request) {
  const token = process.env.INTERNAL_INGEST_TOKEN;
  const bearer = request.headers.get('authorization');
  if (token && bearer === 'Bearer ' + token) return 'token';
  if (isAppUser(request)) return 'session';
  if (demoAccessEnabled()) return 'demo';
  return null;
}

/** 「已跳过 N 份」entry point. */
export async function GET() {
  try {
    const skips = listVerdictSkips();
    const rows = await listVerdictJobsByIds(skips.map((item) => item.id));
    const byId = new Map(rows.map((row) => [row.id, row]));
    const items = skips.map((skip) => {
      const row = byId.get(skip.id);
      const period = row ? periodFromTitle(row.title, row.published_at) : '';
      return {
        id: skip.id,
        at: skip.at,
        reason: skip.reason,
        elapsedMs: skip.elapsedMs ?? null,
        code: row?.code ?? null,
        name: row?.company_name ?? null,
        title: row?.title ?? null,
        period,
        label: row ? `${row.company_name} ${period}` : skip.id,
      };
    });
    return Response.json(
      { ok: true, count: items.length, items },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return apiError(error);
  }
}

/**
 * action=abort  中止一份正在智析的报告。语义唯一：**跳过并标记**。
 *   该份立即从「排队智析」计数中扣除，不会在下一 tick 被重新领取；
 *   空出的槽位由排队队列最前面的任务补位。
 * action=retry  撤销跳过标记并插队，让它重新智析。
 * action=retryAll 撤销全部跳过标记。
 */
export async function POST(request: Request) {
  const auth = authorized(request);
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { action?: unknown; id?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: '请求体无效' }, { status: 400 });
  }

  const action = typeof body.action === 'string' ? body.action : 'abort';
  const id = typeof body.id === 'string' ? body.id.trim() : '';

  if (action === 'retryAll') {
    const removed = clearAllVerdictSkips();
    return Response.json(
      { ok: true, auth, action, removed, note: removed ? `已恢复 ${removed} 份到排队智析` : '没有已跳过的任务' },
      { headers: { 'cache-control': 'no-store' } },
    );
  }

  if (!id) return Response.json({ error: '需要 id' }, { status: 400 });

  if (action === 'retry') {
    const cleared = clearVerdictSkip(id);
    enqueuePriorityVerdict(id);
    return Response.json(
      { ok: true, auth, action, id, cleared, note: cleared ? '已恢复并插队，稍后重新智析' : '已插队，稍后重新智析' },
      { headers: { 'cache-control': 'no-store' } },
    );
  }

  if (action !== 'abort') return Response.json({ error: '不支持的 action' }, { status: 400 });

  const state = getVerdictQueueState();
  const running = state.running.find((item) => item.id === id);
  // Same-process (dev/next) fast path; the worker process picks up the file request on its next poll.
  const abortedNow = abortVerdictRun(id);
  requestVerdictAbort(id);
  // Persist the skip immediately so the queue view stops counting it even before the worker reacts.
  const recorded = markVerdictSkipped(id, {
    reason: '用户手动中止',
    ...(running?.startedAt ? { elapsedMs: Date.now() - Date.parse(running.startedAt) } : {}),
  });
  if (!recorded) {
    return Response.json(
      {
        ok: false,
        error: '「已跳过」列表已满，请先在采集页恢复或清理部分记录后再中止。',
      },
      { status: 409, headers: { 'cache-control': 'no-store' } },
    );
  }

  return Response.json(
    {
      ok: true,
      auth,
      action,
      id,
      abortedNow,
      wasRunning: Boolean(running),
      // worker 是独立进程，靠轮询中止请求生效，所以是「约 2 秒」而不是瞬时。
      note: running
        ? `已中止 ${running.name} ${running.period}（约 2 秒内停止模型调用），已从待办中扣除；排队队首任务补位。需要时可在「已跳过」里重新智析。`
        : '已标记跳过，该份不再自动智析；可在「已跳过」里重新智析。',
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
