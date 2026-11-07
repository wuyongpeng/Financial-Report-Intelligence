/** Unitless display level from real PCM; no timer/random synthetic waveform. */
export const LEVEL_INTERVAL_MS = 50;
export const LEVEL_STALE_MS = 300;

export function pcmRms(samples: ArrayLike<number>, start = 0, end = samples.length): number {
  let sum = 0;
  let count = 0;
  for (let i = Math.max(0, start); i < Math.min(end, samples.length); i += 1) {
    const value = samples[i];
    if (!Number.isFinite(value)) continue;
    const sample = Math.max(-1, Math.min(1, value));
    sum += sample * sample;
    count += 1;
  }
  return count ? Math.sqrt(sum / count) : 0;
}

/** Gate below -42 dBFS; saturate at -10 dBFS (not a calibrated sound meter). */
export function rmsToLevel(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  return Math.max(0, Math.min(1, (20 * Math.log10(rms) + 42) / 32));
}

export function smoothLevel(previous: number, target: number, elapsedMs = LEVEL_INTERVAL_MS): number {
  const clean = (n: number) => Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
  const before = clean(previous);
  const next = clean(target);
  const tau = next > before ? 45 : 120;
  const alpha = 1 - Math.exp(-Math.max(0, elapsedMs) / tau);
  const value = before + (next - before) * alpha;
  return value < 0.005 ? 0 : value;
}

/** Sample the decoded PCM immediately before the real media playback cursor. */
export function playbackRms(buffer: Pick<AudioBuffer, 'length' | 'sampleRate' | 'numberOfChannels' | 'getChannelData'>, time: number): number {
  const end = Math.min(buffer.length, Math.max(0, Math.floor(time * buffer.sampleRate)));
  const start = Math.max(0, end - Math.ceil(buffer.sampleRate * 0.04));
  let squares = 0;
  const channels = Math.min(2, buffer.numberOfChannels);
  for (let channel = 0; channel < channels; channel += 1) {
    const rms = pcmRms(buffer.getChannelData(channel), start, end);
    squares += rms * rms;
  }
  return channels ? Math.sqrt(squares / channels) : 0;
}
