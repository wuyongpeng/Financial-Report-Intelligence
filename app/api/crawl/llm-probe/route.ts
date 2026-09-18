import { demoAccessEnabled, isAppUser } from '@/lib/auth';
import { probeLlmProviders } from '@/lib/llm-gate';
import { llmConfigured, parseLlmProviders, llmProviderPublicMeta } from '@/lib/llm-providers';

export const dynamic = 'force-dynamic';

function authorized(request: Request) {
  const token = process.env.INTERNAL_INGEST_TOKEN;
  const bearer = request.headers.get('authorization');
  if (token && bearer === 'Bearer ' + token) return 'token';
  if (isAppUser(request)) return 'session';
  if (demoAccessEnabled()) return 'demo';
  return null;
}

export async function GET() {
  const providers = parseLlmProviders().map(llmProviderPublicMeta);
  return Response.json(
    { ok: true, configured: llmConfigured(), providers },
    { headers: { 'cache-control': 'no-store' } },
  );
}

export async function POST(request: Request) {
  const auth = authorized(request);
  if (!auth) {
    return Response.json(
      { error: '请先登录后再检测连通性' },
      { status: 401 },
    );
  }
  if (!llmConfigured()) {
    return Response.json(
      { ok: false, auth, error: '未配置 AI 接口', results: [] },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  }
  const results = await probeLlmProviders();
  const ok = results.some((item) => item.ok);
  return Response.json(
    { ok, auth, results },
    { headers: { 'cache-control': 'no-store' } },
  );
}
