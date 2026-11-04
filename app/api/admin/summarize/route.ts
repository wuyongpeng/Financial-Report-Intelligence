import { requireAdmin } from '@/lib/auth';
import { ApiError, apiError, readObject } from '@/lib/api';
import {
  getAdminSummarizeStatus,
  isAdminSummarizeScope,
  runAdminSummarize,
  summarizeErrorMessage,
  type AdminSummarizeScope,
} from '@/lib/admin-summarize';
import { llmConfigured } from '@/lib/llm-providers';

export const dynamic = 'force-dynamic';

function parseScope(raw: unknown): AdminSummarizeScope {
  if (!isAdminSummarizeScope(raw)) throw new ApiError(400, 'scope 须为 survey / feedback / audit');
  return raw;
}

export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    const url = new URL(request.url);
    const scope = parseScope(url.searchParams.get('scope'));
    const status = await getAdminSummarizeStatus(scope);
    return Response.json({
      ok: true,
      configured: llmConfigured(),
      ...status,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    if (!llmConfigured()) throw new ApiError(503, 'LLM 未配置');
    const body = await readObject(request);
    const scope = parseScope(body.scope);
    const summary = await runAdminSummarize(scope);
    return Response.json({
      ok: true,
      summary,
      hasNewData: false,
      currentCount: summary.basedOnCount,
      currentFingerprint: summary.fingerprint,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof ApiError) return apiError(error);
    const message = summarizeErrorMessage(error);
    if (
      message.includes('暂无')
      || message.includes('无法解析')
      || message.includes('LLM 未配置')
    ) {
      return Response.json({ error: message }, { status: 400, headers: { 'cache-control': 'no-store' } });
    }
    console.error('[admin-summarize] failed', message);
    return Response.json({ error: message || '归纳失败' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
