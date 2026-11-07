/** Office-safe voice cues: ≤200ms, one or two sine tones, no melody. */

let audioContext: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioContext) audioContext = new AudioContext();
  return audioContext;
}

/** Call from the mic click so the first cue is allowed to play. */
export function primeVoiceCues() {
  const audio = context();
  if (!audio) return;
  void audio.resume();
}

function tone(audio: AudioContext, frequency: number, when: number, duration: number, peak: number) {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(frequency, when);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(peak, when + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(when);
  osc.stop(when + duration + 0.02);
}

export type VoiceCue = 'ready' | 'close' | 'error';

export function playVoiceCue(kind: VoiceCue) {
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const audio = context();
  if (!audio) return;
  void audio.resume();
  const now = audio.currentTime;
  if (kind === 'ready') {
    tone(audio, 660, now, 0.07, 0.045);
    tone(audio, 880, now + 0.09, 0.08, 0.04);
    return;
  }
  if (kind === 'close') {
    tone(audio, 520, now, 0.06, 0.04);
    tone(audio, 392, now + 0.07, 0.06, 0.032);
    return;
  }
  tone(audio, 196, now, 0.12, 0.05);
}
