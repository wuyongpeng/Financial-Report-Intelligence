import { LEVEL_INTERVAL_MS, LEVEL_STALE_MS, rmsToLevel, smoothLevel } from './audio-level';

type Source = 'mic' | 'tts';
type Levels = Readonly<Record<Source, number>>;
const ZERO: Levels = { mic: 0, tts: 0 };
let levels = ZERO;
const owners: Record<Source, symbol | null> = { mic: null, tts: null };
const listeners = new Set<() => void>();

export const getVoiceLevels = () => levels;
export const getServerVoiceLevels = () => ZERO;
export function subscribeVoiceLevels(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function publish(source: Source, value: number) {
  if (levels[source] === value) return;
  levels = { ...levels, [source]: value };
  listeners.forEach((listener) => listener());
}

/** Per-audio-source lease: late callbacks/cleanup cannot overwrite a newer source. */
export function createVoiceLevelMeter(source: Source, now = () => performance.now()) {
  const owner = Symbol(source);
  owners[source] = owner;
  publish(source, 0);
  let previous = 0;
  let last = -Infinity;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const reset = () => {
    clearTimeout(watchdog);
    watchdog = undefined;
    previous = 0;
    last = -Infinity;
    if (owners[source] === owner) publish(source, 0);
  };
  return {
    updateRms(rms: number) {
      if (owners[source] !== owner) return;
      const time = now();
      if (time - last < LEVEL_INTERVAL_MS) return;
      previous = smoothLevel(previous, rmsToLevel(rms), Number.isFinite(last) ? time - last : LEVEL_INTERVAL_MS);
      last = time;
      publish(source, previous);
      clearTimeout(watchdog);
      watchdog = setTimeout(reset, LEVEL_STALE_MS);
    },
    reset,
    stop() {
      reset();
      if (owners[source] === owner) owners[source] = null;
    },
  };
}

/** Ending a session invalidates any late audio callbacks without touching playback. */
export function resetVoiceLevels() {
  owners.mic = null;
  owners.tts = null;
  if (levels === ZERO) return;
  levels = ZERO;
  listeners.forEach((listener) => listener());
}
