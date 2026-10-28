/** Full-width ASCII (U+FF01–FF5E, incl. ０-９ Ｐ ｐ ＆) → half-width. */
export function toHalfWidth(text: string): string {
  return text
    .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ');
}

/** Normalize ASR / typed text for local voice-intent matching (no polite-word stripping). */
export function normalizeVoiceTextRaw(text: string): string {
  return toHalfWidth(text)
    .replace(/\s+/g, '')
    .replace(/[。！？.!?,，、；;：:""''「」『』（）()【】\[\]…—～~]/g, '')
    .trim();
}

const POLITE_PREFIX = /^(?:请你|请|麻烦你|麻烦|劳驾|帮我|帮忙)+/;
const POLITE_SUFFIX = /(?:吧|啊|呀|哦|哈|谢谢|谢啦|好吗|可以吗)+$/;

/**
 * Normalize for command matching: half-width, punctuation/space removed, and
 * light politeness stripped (请 / 麻烦你 / 帮我 … 吧 / 谢谢). Commands stay
 * whole-utterance anchored, so stripping never lets a real question through.
 */
export function normalizeVoiceText(text: string): string {
  const raw = normalizeVoiceTextRaw(text);
  const stripped = raw.replace(POLITE_PREFIX, '').replace(POLITE_SUFFIX, '');
  return stripped || raw;
}
