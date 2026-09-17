import { apiError, ApiError } from '@/lib/api';
import { loadStoredVerdict, refreshReportVerdict, fillReportVerdict } from '@/lib/report-verdict-store';

export const dynamic = 'force-dynamic';

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const stored = await loadStoredVerdict(id);
    if (stored) return json(stored);
    const result = await fillReportVerdict(id);
    if (!result) return json({ error: 'unavailable' }, 503);
    return json(result);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({})) as { refresh?: boolean; fill?: boolean };
    let result;
    if (body.refresh === true) result = await refreshReportVerdict(id);
    else if (body.fill === true) result = await fillReportVerdict(id);
    else throw new ApiError(400, '只支持 fill=true 或 refresh=true');
    if (!result) return json({ error: 'unavailable' }, 503);
    return json(result);
  } catch (error) {
    return apiError(error);
  }
}
