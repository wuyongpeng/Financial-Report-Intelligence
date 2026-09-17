import { apiError, ApiError } from '@/lib/api';
import { loadStoredVerdict, loadVerdictError, refreshReportVerdict, fillReportVerdict } from '@/lib/report-verdict-store';

export const dynamic = 'force-dynamic';

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function unavailable(id: string, fallback?: string | null) {
  const detail = fallback ?? await loadVerdictError(id);
  return json({ error: detail || 'AI 概览暂时无法生成，请稍后再试。' }, 503);
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const stored = await loadStoredVerdict(id);
    if (stored) return json(stored);
    const result = await fillReportVerdict(id);
    if (!result) return unavailable(id);
    return json(result);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({})) as { refresh?: boolean; fill?: boolean };
    if (body.refresh === true) {
      const result = await refreshReportVerdict(id);
      if (result.value) return json(result.value);
      return unavailable(id, result.error);
    }
    if (body.fill === true) {
      const result = await fillReportVerdict(id);
      if (!result) return unavailable(id);
      return json(result);
    }
    throw new ApiError(400, '只支持 fill=true 或 refresh=true');
  } catch (error) {
    return apiError(error);
  }
}
