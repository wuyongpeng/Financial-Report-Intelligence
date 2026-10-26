/** Capture mic as 16 kHz 16-bit mono PCM chunks (~segmentMs). */

export type PcmCapture = {
  stop: () => void;
};

function floatTo16BitPCM(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const s = Math.max(-1, Math.min(1, input[i]!));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function downsample(buffer: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return buffer;
  const ratio = fromRate / toRate;
  const newLen = Math.max(1, Math.floor(buffer.length / ratio));
  const result = new Float32Array(newLen);
  for (let i = 0; i < newLen; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(buffer.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j += 1) {
      sum += buffer[j]!;
      count += 1;
    }
    result[i] = count ? sum / count : buffer[start]!;
  }
  return result;
}

export async function startPcmCapture(
  onChunk: (pcm: ArrayBuffer) => void,
  opts?: { segmentMs?: number; targetRate?: number },
): Promise<PcmCapture> {
  const segmentMs = opts?.segmentMs ?? 200;
  const targetRate = opts?.targetRate ?? 16_000;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  const processor = audioCtx.createScriptProcessor(4096, 1, 1);
  const samplesPerSegment = Math.floor((targetRate * segmentMs) / 1000);
  let pending = new Float32Array(0);

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const down = downsample(input, audioCtx.sampleRate, targetRate);
    const merged = new Float32Array(pending.length + down.length);
    merged.set(pending, 0);
    merged.set(down, pending.length);
    let offset = 0;
    while (merged.length - offset >= samplesPerSegment) {
      const slice = merged.subarray(offset, offset + samplesPerSegment);
      offset += samplesPerSegment;
      const pcm = floatTo16BitPCM(slice);
      const copy = new ArrayBuffer(pcm.byteLength);
      new Int16Array(copy).set(pcm);
      onChunk(copy);
    }
    pending = merged.slice(offset);
  };

  const mute = audioCtx.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(audioCtx.destination);

  return {
    stop: () => {
      try { processor.disconnect(); } catch { /* ignore */ }
      try { source.disconnect(); } catch { /* ignore */ }
      stream.getTracks().forEach((t) => t.stop());
      void audioCtx.close();
    },
  };
}
