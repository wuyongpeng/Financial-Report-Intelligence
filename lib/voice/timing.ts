/** Voice conversation: partial text unchanged this long → end of utterance. */
export const VOICE_ENDPOINT_MS = 1600;
/** Voice conversation: nothing heard this long after listen start → empty turn. */
export const VOICE_NO_SPEECH_MS = 8000;
/** Consecutive empty listen turns before idle-exit toast. */
export const VOICE_IDLE_EMPTY_TURNS = 2;
export const VOICE_IDLE_EXIT_TOAST = '长时间未互动，语音交互已退出';
