import { parseLlmProviders } from '@/lib/llm-providers';

export const dynamic = 'force-dynamic';

function isAutoLabel(value: string) {
  return /^(auto|automatic)$/i.test(value.trim());
}

/** Model names the reader may pin. No hosts, keys, or probe. */
export async function GET() {
  const seen = new Set<string>();
  const models = [];
  for (const item of parseLlmProviders()) {
    if (seen.has(item.id)) continue;
    if (isAutoLabel(item.id) || isAutoLabel(item.model)) continue;
    seen.add(item.id);
    models.push({ id: item.id, model: item.model });
  }
  return Response.json(
    { models },
    { headers: { 'cache-control': 'no-store' } },
  );
}
