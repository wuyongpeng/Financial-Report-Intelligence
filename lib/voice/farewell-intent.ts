/**
 * Detect user intent to end a continuous voice conversation — local, no LLM.
 * Prefer clear dismiss / farewell patterns so mid-chat 「知道了」 acknowledgments
 * do not false-trigger.
 */

const FAREWELL_LINES = [
  '知道了，再见，随时问 Eva',
  '好的，有需要再叫 Eva',
  '嗯，先这样，随时问 Eva',
] as const;

/** Normalize ASR / typed text for matching. */
function normalize(text: string): string {
  return text
    .replace(/\s+/g, '')
    .replace(/[。！？.!?,，、；;：:""''「」『』（）()【】\[\]…—～~]/g, '')
    .trim();
}

/**
 * True when the utterance is a clear request to leave / end the voice session.
 * 「知道了，退下吧」 must match; bare 「知道了」 alone must not.
 */
export function isVoiceFarewell(text: string): boolean {
  const t = normalize(text);
  if (!t) return false;

  // Explicit voice / session stop commands (may appear with light filler).
  if (/(停止|退出|关掉|关闭|结束)(实时)?(语音|对话|会话)/.test(t)) return true;
  if (/^(结束语音|退出语音|关掉语音|关闭语音|停止语音)$/.test(t)) return true;

  // Whole-utterance dismiss / farewell (short, clear).
  if (
    /^(退下吧?|你退下吧?|先退下吧?|再见|拜拜|拜了|先这样|先这样吧|先到这|先到这儿|先聊到这|先聊到这儿|没事了|没事了谢谢|结束吧|结束了|不用了|不用了谢谢|走了|我走了|那我先走了|可以了谢谢|好了谢谢|就这样|就这样吧|好的再见|那再见|那拜拜|知道了退下吧?|嗯退下吧?|好退下吧?)$/.test(
      t,
    )
  ) {
    return true;
  }

  // 「知道了/好的/嗯」 + dismiss verb (covers 「知道了，退下吧」 after normalize).
  if (/^(知道了|好的|好吧|嗯|行|可以了|没事).{0,6}(退下|再见|拜拜|结束|不用了|走了)/.test(t) && t.length <= 16) {
    return true;
  }

  // Short utterance ending with a clear dismiss verb.
  if (t.length <= 12 && /(退下吧?|再见了?|拜拜|结束吧|不用了)$/.test(t)) return true;

  return false;
}

/** Pick a short warm exit line (tiny rotation). */
export function pickVoiceFarewellLine(seed = Date.now()): string {
  return FAREWELL_LINES[Math.abs(seed) % FAREWELL_LINES.length]!;
}

export { FAREWELL_LINES };
