export type AsrEvent =
  | { type: 'ready' }
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }
  | { type: 'error'; message: string };

function voiceWsUrl(path: string) {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${path}`;
}

export type AsrSession = {
  sendPcm: (chunk: ArrayBuffer) => void;
  stop: () => void;
  close: () => void;
};

export function openAsrSession(onEvent: (ev: AsrEvent) => void): AsrSession {
  const ws = new WebSocket(voiceWsUrl('/api/voice/asr'));
  ws.binaryType = 'arraybuffer';

  ws.onmessage = (event) => {
    if (typeof event.data !== 'string') return;
    let msg: { type?: string; text?: string; message?: string };
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === 'ready') onEvent({ type: 'ready' });
    else if (msg.type === 'partial') onEvent({ type: 'partial', text: msg.text ?? '' });
    else if (msg.type === 'final') onEvent({ type: 'final', text: msg.text ?? '' });
    else if (msg.type === 'error') onEvent({ type: 'error', message: msg.message ?? 'ASR 错误' });
  };

  ws.onerror = () => onEvent({ type: 'error', message: '语音识别连接失败（需 HTTPS 或 localhost）' });

  return {
    sendPcm(chunk) {
      if (ws.readyState === WebSocket.OPEN) ws.send(chunk);
    },
    stop() {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action: 'stop' }));
    },
    close() {
      try { ws.close(); } catch { /* ignore */ }
    },
  };
}
