import { parseLlmProviders } from '@/lib/llm-providers';

export const dynamic = 'force-dynamic';

/** Model names the reader may pin. No hosts, keys, or probe. */
export async function GET() {
  const seen = new Set<string>();
  const models = [];
  for (const item of parseLlmProviders()) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    models.push({ id: item.id, model: item.model });
  }
  return Response.json(
    { models },
    { headers: { 'cache-control': 'no-store' } },
  );
}
