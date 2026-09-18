import { apiError, ApiError } from '@/lib/api';
import { after } from 'next/server';
import { enqueuePriorityVerdict } from '@/lib/verdict-priority';
import {
  peekReportVerdict,
  markVerdictPending,
  executeReportVerdict,
  refreshReportVerdict,
  hasInflightVerdict,
} from '@/lib/report-verdict-store';

export const dynamic = 'force-dynamic';

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function unavailable(detail?: string | null) {
  return json({ error: detail || 'AI 概览暂时无法生成，请稍后再试。' }, 503);
}

function pending() {
  return json({ ok: true, status: 'pending' }, 202);
}

function startVerdict(id: string, refresh: boolean) {
  enqueuePriorityVerdict(id);
  after(() => {
    const job = refresh ? refreshReportVerdict(id) : executeReportVerdict(id);
    return job.catch((error) => {
      console.error('[verdict] background generate failed', error);
    });
  });
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const peek = await peekReportVerdict(id);
    if (peek.status === 'ready' && peek.value) return json(peek.value);
    if (peek.status === 'failed') return unavailable(peek.error);
    const needsStart = peek.status === 'absent' || peek.stale || peek.ageMs > 8_000 || !hasInflightVerdict(id);
    if (needsStart) {
      if (peek.status !== 'pending' || peek.stale) {
        const claimed = await markVerdictPending(id);
        if (!claimed) return unavailable('报告不存在');
      }
      startVerdict(id, false);
    }
    return pending();
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({})) as { refresh?: boolean; fill?: boolean };
    if (body.refresh === true) {
      await markVerdictPending(id, true);
      startVerdict(id, true);
      return pending();
    }
    if (body.fill === true) {
      const peek = await peekReportVerdict(id);
      if (peek.status === 'ready' && peek.value) return json(peek.value);
      const claimed = await markVerdictPending(id);
      if (!claimed) return unavailable('报告不存在');
      startVerdict(id, false);
      return pending();
    }
    throw new ApiError(400, '只支持 fill=true 或 refresh=true');
  } catch (error) {
    return apiError(error);
  }
}
