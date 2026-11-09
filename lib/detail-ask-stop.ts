/** Shown when the user stops a turn that has not produced any answer text yet. */
export const ASK_STOPPED_LINE = '已停止';

export type InFlightTurn = { role: string; text: string };

/**
 * Voice takeover removes a trailing blank answer and the question that produced it.
 * A partial answer stays, so the interrupted turn remains visible.
 */
export function dropBlankInFlightTurn<T extends InFlightTurn>(messages: T[]): T[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant' || last.text.trim()) return messages;
  const prev = messages[messages.length - 2];
  if (prev?.role === 'user') return messages.slice(0, -2);
  return messages.slice(0, -1);
}

/** One automatic retry for transport failures. User aborts and content errors are not retried. */
export function isTransientAskError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = 'name' in error ? String((error as { name?: unknown }).name ?? '') : '';
  if (name === 'AbortError') return false;
  if (name === 'TimeoutError') return true;
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message : '';
  return /超时|暂时不可用|Failed to fetch|Load failed|NetworkError|network error|ECONNRESET|EAI_AGAIN|502|503|504|gateway|fetch failed/i.test(message);
}
