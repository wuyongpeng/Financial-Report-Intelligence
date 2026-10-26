/**
 * Server-side WebSocket proxies for Volcengine ASR / TTS via Weibo AI-Gateway.
 * Browser never sees API keys (VOICE_API_KEY / LLM_API_KEY). Protocol matches Downloads/v2t-main.go & t2v-main.go.
 */
import { WebSocketServer, WebSocket } from 'ws';

const DEFAULT_ASR =
  'wss://ai-gateway.intra.weibo.com/v1/passthrough/aigc/websocket?type=volcengine&model_id=volc-asr-v2';
const DEFAULT_TTS =
  'wss://ai-gateway.intra.weibo.com/v1/passthrough/aigc/websocket?type=volcengine&model_id=seed-tts-2.0';

const ASR_SAMPLE_RATE = 16_000;
const ASR_BITS = 16;
const ASR_CHANNELS = 1;
const ASR_SEGMENT_MS = 200;
const TTS_SPEAKER = 'zh_female_vv_uranus_bigtts';
const TTS_NAMESPACE = 'BidirectionalTTS';
const TTS_FORMAT = 'mp3';
const TTS_SAMPLE_RATE = 24_000;

function apiKey() {
  // Prefer dedicated gateway sk from VOICE_API_KEY; fall back to LLM_API_KEY.
  return (process.env.VOICE_API_KEY ?? process.env.LLM_API_KEY ?? '').trim();
}

function asrUrl() {
  return (process.env.VOICE_ASR_WS_URL ?? '').trim() || DEFAULT_ASR;
}

function ttsUrl() {
  return (process.env.VOICE_TTS_WS_URL ?? '').trim() || DEFAULT_TTS;
}

function encodeAudioFrame(seq, audio) {
  if (!seq) throw new Error('audio sequence must not be 0');
  const flags = seq < 0 ? 0x03 : 0x01;
  const frame = Buffer.alloc(12 + audio.length);
  frame[0] = 0x11;
  frame[1] = 0x20 | flags;
  frame[2] = 0x00;
  frame[3] = 0x00;
  frame.writeUInt32BE(seq >>> 0, 4);
  frame.writeUInt32BE(audio.length, 8);
  audio.copy(frame, 12);
  return frame;
}

function sendJson(ws, value) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value));
}

function attachAsr(wss) {
  wss.on('connection', (client) => {
    const key = apiKey();
    if (!key) {
      sendJson(client, { type: 'error', message: 'VOICE_API_KEY / LLM_API_KEY 未配置' });
      client.close();
      return;
    }

    let upstream;
    let seq = 1;
    let closed = false;
    const pcmQueue = [];
    let configAcked = false;

    const flushPcm = () => {
      if (!configAcked || !upstream || upstream.readyState !== WebSocket.OPEN) return;
      while (pcmQueue.length) {
        const chunk = pcmQueue.shift();
        seq += 1;
        try {
          upstream.send(encodeAudioFrame(seq, chunk));
        } catch (err) {
          sendJson(client, { type: 'error', message: err instanceof Error ? err.message : '发送音频失败' });
          return;
        }
      }
    };

    try {
      upstream = new WebSocket(asrUrl(), {
        headers: { 'X-Api-Key': key },
        handshakeTimeout: 15_000,
      });
    } catch (err) {
      sendJson(client, { type: 'error', message: err instanceof Error ? err.message : 'ASR 连接失败' });
      client.close();
      return;
    }

    upstream.on('open', () => {
      const config = {
        user: { uid: 'eva-voice' },
        audio: {
          format: 'pcm',
          sample_rate: ASR_SAMPLE_RATE,
          bits: ASR_BITS,
          channel: ASR_CHANNELS,
          codec: 'raw',
        },
        request: {
          model_name: 'bigmodel',
          enable_punc: true,
        },
      };
      upstream.send(JSON.stringify(config));
    });

    upstream.on('message', (data, isBinary) => {
      if (isBinary) return;
      const body = typeof data === 'string' ? data : data.toString('utf8');
      let resp;
      try {
        resp = JSON.parse(body);
      } catch {
        return;
      }
      if (!configAcked) {
        configAcked = true;
        sendJson(client, { type: 'ready' });
        flushPcm();
        if (resp.is_last_package || (resp.code && resp.code !== 0)) {
          sendJson(client, { type: 'final', text: '', raw: resp });
          return;
        }
      }
      let text = '';
      if (resp.payload_msg) {
        try {
          const payload = typeof resp.payload_msg === 'string'
            ? JSON.parse(resp.payload_msg)
            : resp.payload_msg;
          if (payload?.error) {
            sendJson(client, { type: 'error', message: String(payload.error) });
          }
          text = payload?.result?.text ?? '';
        } catch {
          /* ignore */
        }
      }
      const done = Boolean(resp.is_last_package) || (resp.code && resp.code !== 0);
      if (text || done) {
        sendJson(client, { type: done ? 'final' : 'partial', text, code: resp.code });
      }
      if (done) {
        closed = true;
        try { client.close(); } catch { /* ignore */ }
        try { upstream.close(); } catch { /* ignore */ }
      }
    });

    upstream.on('error', (err) => {
      sendJson(client, { type: 'error', message: err.message || 'ASR 上游错误' });
    });

    upstream.on('close', () => {
      if (!closed) {
        closed = true;
        try { client.close(); } catch { /* ignore */ }
      }
    });

    client.on('message', (data, isBinary) => {
      if (closed) return;
      if (isBinary) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (!buf.length) return;
        pcmQueue.push(buf);
        flushPcm();
        return;
      }
      const raw = typeof data === 'string' ? data : data.toString('utf8');
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (msg.action === 'stop' || msg.is_last_package) {
        const finish = () => {
          if (!upstream || upstream.readyState !== WebSocket.OPEN) return;
          flushPcm();
          upstream.send(JSON.stringify({ is_last_package: 1 }));
        };
        if (!configAcked) {
          const wait = setInterval(() => {
            if (configAcked || closed) {
              clearInterval(wait);
              if (!closed) finish();
            }
          }, 20);
          setTimeout(() => clearInterval(wait), 10_000);
        } else {
          finish();
        }
      }
    });

    client.on('close', () => {
      closed = true;
      try { upstream?.close(); } catch { /* ignore */ }
    });
  });
}

function attachTts(wss) {
  wss.on('connection', (client) => {
    const key = apiKey();
    if (!key) {
      sendJson(client, { type: 'error', message: 'VOICE_API_KEY / LLM_API_KEY 未配置' });
      client.close();
      return;
    }

    let upstream;
    let sessionReady = false;
    const pending = [];
    let closed = false;

    const flushPending = () => {
      if (!sessionReady || !upstream || upstream.readyState !== WebSocket.OPEN) return;
      while (pending.length) {
        const item = pending.shift();
        upstream.send(item);
      }
    };

    try {
      upstream = new WebSocket(ttsUrl(), {
        headers: { 'X-Api-Key': key },
        handshakeTimeout: 15_000,
      });
      upstream.binaryType = 'nodebuffer';
    } catch (err) {
      sendJson(client, { type: 'error', message: err instanceof Error ? err.message : 'TTS 连接失败' });
      client.close();
      return;
    }

    upstream.on('open', () => {
      const first = {
        user: { uid: 'eva-voice' },
        namespace: TTS_NAMESPACE,
        req_params: {
          speaker: TTS_SPEAKER,
          audio_params: {
            format: TTS_FORMAT,
            sample_rate: TTS_SAMPLE_RATE,
            enable_timestamp: true,
          },
        },
      };
      upstream.send(JSON.stringify(first));
      sessionReady = true;
      sendJson(client, { type: 'ready' });
      flushPending();
    });

    upstream.on('message', (data, isBinary) => {
      if (isBinary) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (client.readyState === WebSocket.OPEN && buf.length) client.send(buf);
        return;
      }
      const body = typeof data === 'string' ? data : data.toString('utf8');
      let resp;
      try {
        resp = JSON.parse(body);
      } catch {
        return;
      }
      // Audio may arrive as base64 in text frames.
      const b64 = resp.data || (typeof resp.payload === 'string' ? null : resp.payload?.data);
      if (typeof b64 === 'string' && b64) {
        try {
          const audio = Buffer.from(b64, 'base64');
          if (client.readyState === WebSocket.OPEN && audio.length) client.send(audio);
        } catch { /* ignore */ }
      }
      if (typeof resp.payload === 'string' && resp.payload && (resp.event === 352 || resp.type === 2)) {
        try {
          const audio = Buffer.from(resp.payload, 'base64');
          if (client.readyState === WebSocket.OPEN && audio.length) client.send(audio);
        } catch { /* ignore */ }
      }
      const terminal =
        resp.type === 'end' ||
        resp.is_last_package ||
        resp.code === 20000000 ||
        resp.event === 152 ||
        resp.event === 153;
      if (terminal) {
        sendJson(client, { type: 'end' });
        closed = true;
        try { client.close(); } catch { /* ignore */ }
        try { upstream.close(); } catch { /* ignore */ }
      }
      if (resp.code > 0 && resp.code !== 200 && resp.code !== 20000000) {
        sendJson(client, { type: 'error', message: resp.message || resp.msg || `TTS code ${resp.code}` });
      }
    });

    upstream.on('error', (err) => {
      sendJson(client, { type: 'error', message: err.message || 'TTS 上游错误' });
    });

    upstream.on('close', () => {
      if (!closed) {
        closed = true;
        sendJson(client, { type: 'end' });
        try { client.close(); } catch { /* ignore */ }
      }
    });

    client.on('message', (data, isBinary) => {
      if (closed) return;
      if (isBinary) return;
      const raw = typeof data === 'string' ? data : data.toString('utf8');
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        // Treat plain text as a TTS chunk.
        pending.push(raw);
        flushPending();
        return;
      }
      if (msg.type === 'end' || msg.action === 'end') {
        pending.push(JSON.stringify({ type: 'end' }));
        flushPending();
        return;
      }
      if (typeof msg.text === 'string' && msg.text) {
        pending.push(msg.text);
        flushPending();
      }
    });

    client.on('close', () => {
      closed = true;
      try { upstream?.close(); } catch { /* ignore */ }
    });
  });
}

/**
 * Attach /api/voice/asr and /api/voice/tts upgrade handlers to an http.Server.
 */
export function attachVoiceWebSockets(server) {
  const asrWss = new WebSocketServer({ noServer: true });
  const ttsWss = new WebSocketServer({ noServer: true });
  attachAsr(asrWss);
  attachTts(ttsWss);

  server.on('upgrade', (req, socket, head) => {
    const host = req.headers.host || 'localhost';
    let pathname = '/';
    try {
      pathname = new URL(req.url || '/', `http://${host}`).pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname === '/api/voice/asr') {
      asrWss.handleUpgrade(req, socket, head, (ws) => {
        asrWss.emit('connection', ws, req);
      });
      return;
    }
    if (pathname === '/api/voice/tts') {
      ttsWss.handleUpgrade(req, socket, head, (ws) => {
        ttsWss.emit('connection', ws, req);
      });
      return;
    }
    // Let Next / other handlers deal with unknown upgrades (or drop).
  });

  return { asrWss, ttsWss };
}

export const voiceDefaults = {
  asrUrl: DEFAULT_ASR,
  ttsUrl: DEFAULT_TTS,
  asrSampleRate: ASR_SAMPLE_RATE,
  asrSegmentMs: ASR_SEGMENT_MS,
  ttsSpeaker: TTS_SPEAKER,
  ttsSampleRate: TTS_SAMPLE_RATE,
};
