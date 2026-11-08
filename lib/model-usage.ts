export type ModelUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

function asCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
}

/** Read a provider usage object. Missing counts stay null instead of a guessed total. */
export function parseModelUsage(value: unknown): ModelUsage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const promptTokens = asCount(row.prompt_tokens) ?? asCount(row.promptTokens);
  const completionTokens = asCount(row.completion_tokens) ?? asCount(row.completionTokens);
  const totalTokens = asCount(row.total_tokens) ?? asCount(row.totalTokens);
  if (promptTokens == null && completionTokens == null && totalTokens == null) return null;
  return { promptTokens, completionTokens, totalTokens };
}

export function formatTokenUsage(value: unknown): string {
  const usage = parseModelUsage(value);
  if (!usage) return '—';
  const cell = (n: number | null) => (n == null ? '—' : String(n));
  return `输入 ${cell(usage.promptTokens)} · 输出 ${cell(usage.completionTokens)} · 合计 ${cell(usage.totalTokens)}`;
}
