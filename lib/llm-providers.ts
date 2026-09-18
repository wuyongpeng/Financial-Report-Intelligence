export type LlmProvider = {
  id: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
};

function normalizeBaseUrl(url: string) {
  return url.trim().replace(/\/$/, '');
}

function asProvider(raw: unknown, fallbackId: string): LlmProvider | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const baseUrl = normalizeBaseUrl(String(item.baseUrl ?? item.url ?? ''));
  const model = String(item.model ?? '').trim();
  if (!/^https?:\/\//i.test(baseUrl) || !model) return null;
  const apiKey = String(item.apiKey ?? item.key ?? '').trim() || undefined;
  const id = String(item.name ?? item.id ?? fallbackId).trim() || fallbackId;
  return { id, baseUrl, apiKey, model };
}

function legacyProvider(env: NodeJS.ProcessEnv): LlmProvider | null {
  const baseUrl = normalizeBaseUrl(env.LLM_BASE_URL ?? '');
  const model = (env.LLM_MODEL ?? '').trim();
  if (!baseUrl || !model) return null;
  const apiKey = (env.LLM_API_KEY ?? '').trim() || undefined;
  return { id: 'primary', baseUrl, apiKey, model };
}

function providerKey(item: LlmProvider) {
  return `${item.baseUrl}|${item.model}`;
}

function modelsFromSharedEndpoint(env: NodeJS.ProcessEnv): LlmProvider[] {
  const baseUrl = normalizeBaseUrl(env.LLM_BASE_URL ?? '');
  if (!baseUrl) return [];
  const apiKey = (env.LLM_API_KEY ?? '').trim() || undefined;
  const names = (env.LLM_MODELS ?? '')
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return names.map((model) => ({ id: model, baseUrl, apiKey, model }));
}

/** Ordered OpenAI-compatible providers: `LLM_MODEL`, then `LLM_MODELS`, then `LLM_PROVIDERS` JSON. */
export function parseLlmProviders(env: NodeJS.ProcessEnv = process.env): LlmProvider[] {
  const primary = legacyProvider(env);
  const shared = modelsFromSharedEndpoint(env);
  const raw = env.LLM_PROVIDERS?.trim();
  let extras: LlmProvider[] = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      const list = Array.isArray(parsed) ? parsed : [parsed];
      extras = list
        .map((item, index) => asProvider(item, `provider-${index + 1}`))
        .filter((item): item is LlmProvider => Boolean(item));
    } catch {
      console.warn('[llm] LLM_PROVIDERS is not valid JSON, ignored');
    }
  }
  const out: LlmProvider[] = [];
  const seen = new Set<string>();
  for (const item of [...(primary ? [primary] : []), ...shared, ...extras]) {
    const key = providerKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function llmConfigured(env: NodeJS.ProcessEnv = process.env) {
  return parseLlmProviders(env).length > 0;
}

export function llmModelName(env: NodeJS.ProcessEnv = process.env) {
  return parseLlmProviders(env)[0]?.model ?? env.LLM_MODEL?.trim() ?? null;
}

export function llmProviderPublicMeta(item: LlmProvider) {
  let host = item.baseUrl;
  try {
    host = new URL(item.baseUrl).host;
  } catch {
    /* keep raw */
  }
  return { id: item.id, model: item.model, host };
}
