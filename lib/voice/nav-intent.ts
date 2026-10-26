export type VoiceNavIntent =
  | { kind: 'next' }
  | { kind: 'prev' }
  | { kind: 'goto'; page: number }
  | null;

/** Local PDF navigation from ASR text — no LLM. */
export function parseVoiceNavIntent(text: string): VoiceNavIntent {
  const t = text.replace(/\s+/g, '').replace(/[。！？.!?,，、]/g, '');
  if (!t) return null;
  if (/^(下一页|下页|往后翻|向后翻|翻下一页)$/.test(t)) return { kind: 'next' };
  if (/^(上一页|上页|往前翻|向前翻|翻上一页)$/.test(t)) return { kind: 'prev' };
  const m = t.match(/^(?:请?)?(?:跳转到?|跳到|翻到|打开|去)?第?(\d{1,4})页$/);
  if (m) {
    const page = Number(m[1]);
    if (Number.isInteger(page) && page >= 1 && page <= 10_000) return { kind: 'goto', page };
  }
  return null;
}
