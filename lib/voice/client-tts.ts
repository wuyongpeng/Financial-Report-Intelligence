import { speakableText } from './speakable';

function voiceWsUrl(path: string) {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${path}`;
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
    const ws = new WebSocket(voiceWsUrl('/api/voice/tts'));
    ws.binaryType = 'arraybuffer';
    const chunks: ArrayBuffer[] = [];
    let settled = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* ignore */ }
      if (err) reject(err);
      else resolve();
    };

    const onAbort = () => {
      finish();
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    ws.onopen = () => {
      // Send in modest chunks so BidirectionalTTS can stream.
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

    ws.onerror = () => finish(new Error('语音朗读连接失败'));
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
        if (signal?.aborted) {
          URL.revokeObjectURL(url);
          finish();
          return;
        }
        const stop = () => {
          audio.pause();
          URL.revokeObjectURL(url);
        };
        signal?.addEventListener('abort', stop, { once: true });
        audio.onended = () => {
          URL.revokeObjectURL(url);
          finish();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          finish(new Error('音频播放失败'));
        };
        await audio.play();
      } catch (err) {
        finish(err instanceof Error ? err : new Error('音频播放失败'));
      }
    }
  });
}
