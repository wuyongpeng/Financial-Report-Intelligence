import { speakableText } from './speakable';

function voiceWsUrl(path: string) {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${path}`;
}

type ActivePlayback = {
  audio: HTMLAudioElement | null;
  url: string | null;
  paused: boolean;
  done: boolean;
  /** True once MP3 blob is ready (even if paused before play). */
  ready: boolean;
};

let activePlayback: ActivePlayback | null = null;

function clearPlayback() {
  if (!activePlayback) return;
  const cur = activePlayback;
  activePlayback = null;
  cur.done = true;
  try {
    cur.audio?.pause();
  } catch { /* ignore */ }
  if (cur.url) {
    try { URL.revokeObjectURL(cur.url); } catch { /* ignore */ }
  }
}

/** Pause current TTS audio without ending the voice session / mic. */
export function pauseVoiceTts(): boolean {
  if (!activePlayback || activePlayback.done) return false;
  const audio = activePlayback.audio;
  if (!audio) {
    // Still buffering — mark paused so playAndFinish respects it.
    activePlayback.paused = true;
    return true;
  }
  if (!audio.paused) audio.pause();
  activePlayback.paused = true;
  return true;
}

/** Resume paused TTS. Returns false when nothing to resume. */
export function resumeVoiceTts(): boolean {
  if (!activePlayback || activePlayback.done) return false;
  if (!activePlayback.paused && activePlayback.audio && !activePlayback.audio.paused) return false;
  activePlayback.paused = false;
  const audio = activePlayback.audio;
  if (audio) {
    void audio.play().catch(() => undefined);
    return true;
  }
  // Still buffering — pause flag cleared so play starts normally when ready.
  return activePlayback.ready === false;
}

export function isVoiceTtsPaused(): boolean {
  return Boolean(activePlayback && !activePlayback.done && activePlayback.paused);
}

export function hasVoiceTtsPlayback(): boolean {
  return Boolean(activePlayback && !activePlayback.done);
}

/** Stream speakable text to TTS and play MP3 chunks as they arrive. */
export function speakAnswer(raw: string, signal?: AbortSignal): Promise<void> {
  const text = speakableText(raw);
  if (!text) return Promise.resolve();

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    // Supersede any prior playback (including a paused one).
    clearPlayback();
    const playback: ActivePlayback = { audio: null, url: null, paused: false, done: false, ready: false };
    activePlayback = playback;

    const ws = new WebSocket(voiceWsUrl('/api/voice/tts'));
    ws.binaryType = 'arraybuffer';
    const chunks: ArrayBuffer[] = [];
    let settled = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* ignore */ }
      if (activePlayback === playback) clearPlayback();
      else {
        playback.done = true;
        try { playback.audio?.pause(); } catch { /* ignore */ }
        if (playback.url) {
          try { URL.revokeObjectURL(playback.url); } catch { /* ignore */ }
        }
      }
      if (err) reject(err);
      else resolve();
    };

    const onAbort = () => {
      finish();
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    ws.onopen = () => {
      const runes = Array.from(text);
      const step = 24;
      for (let i = 0; i < runes.length; i += step) {
        ws.send(JSON.stringify({ text: runes.slice(i, i + step).join('') }));
      }
      ws.send(JSON.stringify({ type: 'end' }));
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data) as { type?: string; message?: string };
          if (msg.type === 'error') finish(new Error(msg.message || 'TTS 错误'));
          if (msg.type === 'end') playAndFinish();
        } catch { /* ignore */ }
        return;
      }
      chunks.push(event.data as ArrayBuffer);
    };

    ws.onerror = () =>
      finish(
        new Error(
          '语音朗读通道未接通：浏览器连不上本站 /api/voice/tts（入口未放行 WebSocket，或非 HTTPS）。可在「信源」设置 → AI 连接性检测上游',
        ),
      );
    ws.onclose = () => {
      if (!settled) playAndFinish();
    };

    async function playAndFinish() {
      if (!chunks.length) {
        finish();
        return;
      }
      try {
        const blob = new Blob(chunks, { type: 'audio/mpeg' });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        playback.url = url;
        playback.audio = audio;
        playback.ready = true;
        if (signal?.aborted || activePlayback !== playback) {
          finish();
          return;
        }
        const stop = () => {
          audio.pause();
        };
        signal?.addEventListener('abort', stop, { once: true });
        audio.onended = () => {
          finish();
        };
        audio.onerror = () => {
          finish(new Error('音频播放失败'));
        };
        if (playback.paused) {
          // User said 先别念了 while buffering — stay paused until 接着念.
          return;
        }
        await audio.play();
      } catch (err) {
        finish(err instanceof Error ? err : new Error('音频播放失败'));
      }
    }
  });
}
