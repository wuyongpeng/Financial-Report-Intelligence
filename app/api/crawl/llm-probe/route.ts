import { probeLlmProviders } from '@/lib/llm-gate';
import { llmConfigured, parseLlmProviders, llmProviderPublicMeta } from '@/lib/llm-providers';

export const dynamic = 'force-dynamic';

export async function GET() {
  const providers = parseLlmProviders().map(llmProviderPublicMeta);
  return Response.json(
    { ok: true, configured: llmConfigured(), providers },
    { headers: { 'cache-control': 'no-store' } },
  );
}

export async function POST() {
  if (!llmConfigured()) {
    return Response.json(
      { ok: false, error: '未配置 AI 接口', results: [] },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  }
  const results = await probeLlmProviders();
  const ok = results.some((item) => item.ok);
  return Response.json(
    { ok, results },
    { headers: { 'cache-control': 'no-store' } },
  );
}
