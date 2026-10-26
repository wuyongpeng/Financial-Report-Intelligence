export type AsrEvent =
  | { type: 'ready' }
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }
  | { type: 'error'; message: string };

function isLoopbackHost() {
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
}

/** Mic needs a secure context unless the page is on loopback. */
export function micSecureContextError(): string | null {
  if (typeof window === 'undefined') return null;
  if (window.isSecureContext || isLoopbackHost()) return null;
  return '麦克风需要 HTTPS 或 localhost（当前用 HTTP 访问非本机地址时浏览器会拒绝）';
}

function voiceWsUrl(path: string) {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${path}`;
}

export type AsrSession = {
  sendPcm: (chunk: ArrayBuffer) => void;
  stop: () => void;
  close: () => void;
};

const noopSession: AsrSession = {
  sendPcm() {},
  stop() {},
  close() {},
};

export function openAsrSession(onEvent: (ev: AsrEvent) => void): AsrSession {
  const secureErr = micSecureContextError();
  if (secureErr) {
    queueMicrotask(() => onEvent({ type: 'error', message: secureErr }));
    return noopSession;
  }

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

  ws.onerror = () =>
    onEvent({
      type: 'error',
      message: '语音服务未连通（服务器未启用语音通道或网关不可达）',
    });

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
