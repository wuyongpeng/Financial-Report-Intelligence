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
  let ready = false;
  let reported = false;
  let closedByClient = false;
  const reportError = (message: string) => {
    if (reported) return;
    reported = true;
    onEvent({ type: 'error', message });
  };

  ws.onmessage = (event) => {
    if (typeof event.data !== 'string') return;
    let msg: { type?: string; text?: string; message?: string };
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === 'ready') {
      ready = true;
      onEvent({ type: 'ready' });
    } else if (msg.type === 'partial') onEvent({ type: 'partial', text: msg.text ?? '' });
    else if (msg.type === 'final') onEvent({ type: 'final', text: msg.text ?? '' });
    else if (msg.type === 'error') reportError(msg.message ?? 'ASR 错误');
  };

  ws.onerror = () =>
    reportError(
      '语音通道未接通：浏览器连不上本站 /api/voice/asr（入口未放行 WebSocket，或非 HTTPS）。可在「信源」设置 → AI 连接性检测上游网关',
    );

  ws.onclose = (ev) => {
    if (reported || closedByClient) return;
    if (!ready) {
      reportError(
        `语音通道关闭（code ${ev.code}）。若「信源」里 ASR 上游正常，多半是入口网关未 Upgrade WebSocket`,
      );
      return;
    }
    // Dropped after ready (upstream / network) — surface so float is not silently dead.
    reportError(`语音识别中断（code ${ev.code}），请重新点语音`);
  };

  return {
    sendPcm(chunk) {
      if (ws.readyState === WebSocket.OPEN) ws.send(chunk);
    },
    stop() {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action: 'stop' }));
    },
    close() {
      closedByClient = true;
      try { ws.close(); } catch { /* ignore */ }
    },
  };
}
