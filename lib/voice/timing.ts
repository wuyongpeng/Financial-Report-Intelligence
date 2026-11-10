/** Wait this long for ASR ready + microphone before showing a connect failure. */
export const VOICE_CONNECT_TIMEOUT_MS = 8000;
export const VOICE_CONNECT_FAIL = '连接失败，请重试';
/** Voice conversation: partial text unchanged this long → arm send countdown. */
export const VOICE_ENDPOINT_MS = 1600;
/** After the utterance settles, wait this long so the user can cancel. */
export const VOICE_SEND_COUNTDOWN_MS = 1000;
/** Spoken after the user cancels an armed send. Mic stays in the session. */
export const VOICE_CANCEL_LINE = '已取消，可以继续说。';
/**
 * Nothing heard this long after the mic is open → idle exit. Resets when the user speaks.
 * A muted mic does not run this clock; opening it starts a fresh window.
 */
export const VOICE_NO_SPEECH_MS = 180_000;
/** One quiet window is enough; the window itself is 180s. */
export const VOICE_IDLE_EMPTY_TURNS = 1;
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

/**
 * Explicit user stop (composer / 「说完了」) with no transcript should end the
 * session quietly. Auto no-speech / endpoint empty turns still count toward idle.
 */
export function shouldQuietEndOnEmptyFinalize(userInitiated: boolean): boolean {
  return userInitiated;
}

