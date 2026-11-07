import { LEVEL_INTERVAL_MS, playbackRms } from './audio-level';
import { createVoiceLevelMeter } from './client-level';

/**
 * Decode a copy of the existing MP3, then measure PCM at audio.currentTime.
 * Does NOT reroute the audio element through an AudioContext (which can mute
 * autoplay on mobile), open a mic, or delay audio.play(). Unsupported decoding
 * leaves the meter at zero, never a synthetic animation.
 */
export function trackPlaybackLevel(audio: HTMLAudioElement, blob: Blob): () => void {
  const meter = createVoiceLevelMeter('tts');
  let disposed = false;
  let decoded: AudioBuffer | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastTime = -1;
  const reset = () => {
    clearInterval(timer);
    timer = undefined;
    lastTime = -1;
    meter.reset();
  };
  const start = () => {
    reset();
    if (disposed || !decoded || audio.paused || audio.ended) return;
    timer = setInterval(() => {
      if (!decoded || audio.paused || audio.ended || audio.readyState < 3) {
        meter.reset();
        return;
      }
      const time = audio.currentTime;
      meter.updateRms(time > lastTime && !audio.muted ? playbackRms(decoded, time) * audio.volume : 0);
      lastTime = time;
    }, LEVEL_INTERVAL_MS);
  };
  const zeroEvents = ['pause', 'ended', 'waiting', 'stalled', 'seeking', 'emptied', 'error'] as const;
  audio.addEventListener('playing', start);
  zeroEvents.forEach((event) => audio.addEventListener(event, reset));
  void (async () => {
    try {
      if (typeof OfflineAudioContext === 'undefined') return;
      const context = new OfflineAudioContext(1, 1, 44_100);
      const bytes = await blob.arrayBuffer();
      if (disposed) return;
      const buffer = await context.decodeAudioData(bytes);
      if (disposed) return;
      decoded = buffer;
      start();
    } catch {
      // Optional visual telemetry must never fail or block TTS playback.
      meter.reset();
    }
  })();
  return () => {
    disposed = true;
    reset();
    decoded = null;
    audio.removeEventListener('playing', start);
    zeroEvents.forEach((event) => audio.removeEventListener(event, reset));
    meter.stop();
  };
}
