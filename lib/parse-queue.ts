export const PARSE_PRIORITY_MANUAL = 100;

export type ParseQueueRow = {
  parse_priority?: number | null;
  parse_error?: string | null;
  published_at: string;
};

/** Idle parse queue: manual jumps first, failed/timeout go last, then newer filings. */
export function compareParseQueue(a: ParseQueueRow, b: ParseQueueRow) {
  const pa = a.parse_priority ?? 0;
  const pb = b.parse_priority ?? 0;
  if (pb !== pa) return pb - pa;
  const fa = a.parse_error?.trim() ? 1 : 0;
  const fb = b.parse_error?.trim() ? 1 : 0;
  if (fa !== fb) return fa - fb;
  return Date.parse(b.published_at) - Date.parse(a.published_at);
}

export function formatParseElapsed(ms: number) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}秒`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem ? `${min}分${rem}秒` : `${min}分钟`;
}
