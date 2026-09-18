import { apiError, ApiError } from '@/lib/api';
import { peekReportVerdict, fillReportVerdict, refreshReportVerdict } from '@/lib/report-verdict-store';

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

function kick(job: Promise<unknown>) {
  void job.catch((error) => {
    console.error('[verdict]', error);
  });
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const peek = await peekReportVerdict(id);
    if (peek.status === 'ready' && peek.value) return json(peek.value);
    if (peek.status === 'failed') return unavailable(peek.error);
    if (peek.status === 'absent' || peek.stale) kick(fillReportVerdict(id));
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
      kick(refreshReportVerdict(id));
      return pending();
    }
    if (body.fill === true) {
      const peek = await peekReportVerdict(id);
      if (peek.status === 'ready' && peek.value) return json(peek.value);
      kick(fillReportVerdict(id));
      return pending();
    }
    throw new ApiError(400, '只支持 fill=true 或 refresh=true');
  } catch (error) {
    return apiError(error);
  }
}
