import assert from 'node:assert/strict';
import test from 'node:test';
import { pcmRms, playbackRms, rmsToLevel, smoothLevel } from '../lib/voice/audio-level';
import { createVoiceLevelMeter, getVoiceLevels, resetVoiceLevels, subscribeVoiceLevels } from '../lib/voice/client-level';
import { trackPlaybackLevel } from '../lib/voice/client-playback-level';
import { startPcmCapture } from '../lib/voice/client-pcm';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('PCM RMS is actual amplitude; silence, invalid samples and clipping are safe', () => {
  assert.equal(pcmRms(new Float32Array(256)), 0);
  assert.equal(pcmRms([0.5, -0.5]), 0.5);
  assert.equal(pcmRms([2, -2, NaN, Infinity]), 1);
  assert.equal(pcmRms([]), 0);
  assert.equal(pcmRms([0, 0.25, -0.25, 0], 1, 3), 0.25);
});

test('noise gate and peak limiting do not fabricate a level', () => {
  assert.equal(rmsToLevel(0.007), 0);
  assert.equal(rmsToLevel(0), 0);
  assert.equal(rmsToLevel(NaN), 0);
  assert.equal(rmsToLevel(1), 1);
  assert.ok(rmsToLevel(0.15) > rmsToLevel(0.03));
  assert.ok(smoothLevel(0, 1) > 0 && smoothLevel(0, 1) < 1);
  assert.ok(smoothLevel(1, 0) > 0 && smoothLevel(1, 0) < 1);
  let level = 1;
  for (let i = 0; i < 20; i += 1) level = smoothLevel(level, 0);
  assert.equal(level, 0);
});

test('TTS RMS follows the real playback cursor, not future samples or text length', () => {
  const data = new Float32Array(1000);
  data.fill(0.5, 500);
  const buffer = { sampleRate: 1000, length: 1000, numberOfChannels: 1, getChannelData: () => data };
  assert.equal(playbackRms(buffer, 0.4), 0);
  assert.equal(playbackRms(buffer, 0.8), 0.5);
  assert.equal(playbackRms(buffer, 0), 0);
});

test('source leases throttle notifications, reset stale/ended input and ignore old callbacks', async () => {
  resetVoiceLevels();
  let time = 0;
  let notifications = 0;
  const unsubscribe = subscribeVoiceLevels(() => { notifications += 1; });
  const old = createVoiceLevelMeter('mic', () => time);
  old.updateRms(0.2);
  assert.ok(getVoiceLevels().mic > 0);
  const count = notifications;
  time = 10;
  old.updateRms(0.05);
  assert.equal(notifications, count);
  const next = createVoiceLevelMeter('mic', () => time);
  next.updateRms(0.1);
  const value = getVoiceLevels().mic;
  old.stop();
  old.updateRms(1);
  assert.equal(getVoiceLevels().mic, value);
  await delay(350);
  assert.equal(getVoiceLevels().mic, 0);
  next.updateRms(0.2);
  resetVoiceLevels();
  time += 100;
  next.updateRms(1);
  assert.deepEqual(getVoiceLevels(), { mic: 0, tts: 0 });
  next.stop();
  unsubscribe();
});

test('MP3 telemetry follows play/pause/resume, volume and disposal without routing audio', async () => {
  resetVoiceLevels();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'OfflineAudioContext');
  const data = new Float32Array(44100).fill(0.2);
  class Decoder {
    async decodeAudioData() {
      return { length: data.length, sampleRate: 44100, numberOfChannels: 1, getChannelData: () => data };
    }
  }
  Object.defineProperty(globalThis, 'OfflineAudioContext', { configurable: true, value: Decoder });
  const audio = Object.assign(new EventTarget(), { paused: false, ended: false, readyState: 4, currentTime: 0.2, volume: 1, muted: false });
  const stop = trackPlaybackLevel(audio as unknown as HTMLAudioElement, new Blob(['mp3']));
  try {
    await delay(80);
    assert.ok(getVoiceLevels().tts > 0);
    audio.paused = true;
    audio.dispatchEvent(new Event('pause'));
    assert.equal(getVoiceLevels().tts, 0);
    audio.paused = false;
    audio.currentTime = 0.4;
    audio.dispatchEvent(new Event('playing'));
    await delay(80);
    assert.ok(getVoiceLevels().tts > 0);
    audio.muted = true;
    audio.dispatchEvent(new Event('waiting'));
    audio.dispatchEvent(new Event('playing'));
    await delay(80);
    assert.equal(getVoiceLevels().tts, 0);
    stop();
    audio.muted = false;
    audio.dispatchEvent(new Event('playing'));
    await delay(80);
    assert.equal(getVoiceLevels().tts, 0);
  } finally {
    stop();
    if (original) Object.defineProperty(globalThis, 'OfflineAudioContext', original);
    else Reflect.deleteProperty(globalThis, 'OfflineAudioContext');
    resetVoiceLevels();
  }
});

test('unsupported TTS decoding stays at zero and does not block playback', () => {
  resetVoiceLevels();
  const audio = Object.assign(new EventTarget(), { paused: false, ended: false });
  const stop = trackPlaybackLevel(audio as unknown as HTMLAudioElement, new Blob());
  assert.equal(getVoiceLevels().tts, 0);
  stop();
});


test('mic meter reuses the ASR capture and releases levels/tracks/context on stop', async () => {
  resetVoiceLevels();
  const originalContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let requests = 0;
  let stopped = 0;
  let closed = 0;
  const processor = { connect() {}, disconnect() {}, onaudioprocess: null as null | ((event: AudioProcessingEvent) => void) };
  class CaptureContext {
    sampleRate = 48000;
    destination = {};
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor() { return processor; }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
    async close() { closed += 1; }
  }
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: CaptureContext });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    mediaDevices: { async getUserMedia() { requests += 1; return { getTracks: () => [{ stop() { stopped += 1; } }] }; } },
  } });
  let capture: Awaited<ReturnType<typeof startPcmCapture>> | undefined;
  try {
    const chunks: ArrayBuffer[] = [];
    capture = await startPcmCapture((chunk) => chunks.push(chunk));
    const samples = new Float32Array(48000).fill(0.1);
    processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => samples } } as unknown as AudioProcessingEvent);
    assert.equal(requests, 1);
    assert.ok(getVoiceLevels().mic > 0);
    assert.equal(chunks.length, 5);
    assert.equal(chunks[0].byteLength, 6400);
    assert.equal(new Int16Array(chunks[0])[0], 3276);
    capture.stop();
    capture.stop();
    assert.equal(getVoiceLevels().mic, 0);
    assert.equal(processor.onaudioprocess, null);
    assert.equal(stopped, 1);
    assert.equal(closed, 1);
  } finally {
    capture?.stop();
    if (originalContext) Object.defineProperty(globalThis, 'AudioContext', originalContext);
    else Reflect.deleteProperty(globalThis, 'AudioContext');
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else Reflect.deleteProperty(globalThis, 'navigator');
    resetVoiceLevels();
  }
});
