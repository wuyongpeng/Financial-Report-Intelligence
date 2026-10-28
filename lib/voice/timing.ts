/** Voice conversation: partial text unchanged this long → end of utterance. */
export const VOICE_ENDPOINT_MS = 1600;
/** Voice conversation: nothing heard this long after listen start → empty turn. */
export const VOICE_NO_SPEECH_MS = 8000;
/** Consecutive empty listen turns before idle-exit toast. */
export const VOICE_IDLE_EMPTY_TURNS = 2;
export const VOICE_IDLE_EXIT_TOAST = '长时间未互动，语音交互已退出';
/**
 * Barge-in while TTS / ask: first ASR partial at least this many chars
 * interrupts playback (echoCancellation + length gate vs TTS bleed).
 */
export const VOICE_BARGE_MIN_CHARS = 2;

/** True when a partial is long enough to treat as user barge-in (not TTS echo). */
export function isMeaningfulBargePartial(
  text: string,
  minChars: number = VOICE_BARGE_MIN_CHARS,
): boolean {
  return text.trim().length >= minChars;
}
