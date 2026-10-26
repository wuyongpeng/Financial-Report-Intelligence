/**
 * Server-side voice (ASR/TTS) upstream connectivity probe.
 * Browser never sees API keys; this only reports ok/host/error and safe key shape.
 *
 * Note for ops: if upstream probe is ok but the browser still gets
 * 「语音服务未连通」, the entry proxy (APISIX/Caddy) likely does not
 * Upgrade WebSocket for /api/voice/asr|/api/voice/tts.
 */
import WebSocket from 'ws';

export const DEFAULT_VOICE_ASR_WS_URL =
  'wss://ai-gateway.intra.weibo.com/v1/passthrough/aigc/websocket?type=volcengine&model_id=volc-asr-v2';

export const DEFAULT_VOICE_TTS_WS_URL =
  'wss://ai-gateway.intra.weibo.com/v1/passthrough/aigc/websocket?type=volcengine&model_id=seed-tts-2.0';

export type VoiceEndpointKind = 'asr' | 'tts';

export type VoiceApiKeySource = 'voice' | 'llm' | 'none';

export type VoiceEndpointProbeResult = {
  ok: boolean;
  ms: number;
  host: string;
  error?: string;
};

export type VoiceProbeReport = {
  ok: boolean;
  apiKeyConfigured: boolean;
  /** Which env supplied the key used for the probe (never the key itself). */
  apiKeySource: VoiceApiKeySource;
  /** True when the active key starts with `sk-` (AI-Gateway Dashboard shape). */
  apiKeyLooksLikeGatewaySk: boolean;
  /** Length of the active key after trim; 0 when none. */
  apiKeyLength: number;
  asr: VoiceEndpointProbeResult;
  tts: VoiceEndpointProbeResult;
  /** Hint when upstream is fine but browser WS still fails. */
  entryHint: string;
};

type EnvLike = Record<string, string | undefined>;

export function resolveVoiceAsrUrl(env: EnvLike = process.env): string {
  return (env.VOICE_ASR_WS_URL ?? '').trim() || DEFAULT_VOICE_ASR_WS_URL;
}

export function resolveVoiceTtsUrl(env: EnvLike = process.env): string {
  return (env.VOICE_TTS_WS_URL ?? '').trim() || DEFAULT_VOICE_TTS_WS_URL;
}

/** Prefer VOICE_API_KEY; fall back to LLM_API_KEY. Never return secrets to clients. */
export function resolveVoiceApiKey(env: EnvLike = process.env): {
  apiKey: string;
  apiKeySource: VoiceApiKeySource;
} {
  const voice = (env.VOICE_API_KEY ?? '').trim();
  if (voice) return { apiKey: voice, apiKeySource: 'voice' };
  const llm = (env.LLM_API_KEY ?? '').trim();
  if (llm) return { apiKey: llm, apiKeySource: 'llm' };
  return { apiKey: '', apiKeySource: 'none' };
}

export function voiceApiKeyLooksLikeGatewaySk(apiKey: string): boolean {
  return apiKey.trim().startsWith('sk-');
}

export function voiceApiKeyConfigured(env: EnvLike = process.env): boolean {
  return resolveVoiceApiKey(env).apiKeySource !== 'none';
}

/** Host only — never return query/key material. */
export function voiceWsHost(url: string): string {
  try {
    return new URL(url).host || 'unknown';
  } catch {
    return 'invalid-url';
  }
}

/** Map ws/network errors to short Chinese reasons; strip accidental secrets. */
export function formatVoiceProbeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? 'unknown');
  const scrubbed = raw
    .replace(/X-Api-Key[:\s]*\S+/gi, 'X-Api-Key:***')
    .replace(/api[_-]?key[=:]\s*\S+/gi, 'api_key=***')
    .slice(0, 200);

  if (/Unexpected server response:\s*401/i.test(scrubbed)) {
    return '鉴权失败（401，检查 VOICE_API_KEY 或 LLM_API_KEY）';
  }
  if (/Unexpected server response:\s*403/i.test(scrubbed)) return '拒绝访问（403）';
  if (/Unexpected server response:\s*404/i.test(scrubbed)) return '上游路径不存在（404）';
  if (/Unexpected server response:\s*(\d{3})/i.test(scrubbed)) {
    const code = scrubbed.match(/Unexpected server response:\s*(\d{3})/i)?.[1];
    return `上游握手被拒（HTTP ${code}）`;
  }
  if (/ENOTFOUND|getaddrinfo|EAI_AGAIN/i.test(scrubbed)) return 'DNS 解析失败（网关主机不可达）';
  if (/ETIMEDOUT|handshakeTimeout|timed out|Timeout/i.test(scrubbed)) return '连接超时';
  if (/ECONNREFUSED/i.test(scrubbed)) return '连接被拒绝';
  if (/CERT_|UNABLE_TO_VERIFY|SSL|TLS/i.test(scrubbed)) return '证书/TLS 错误';
  if (/ECONNRESET/i.test(scrubbed)) return '连接被重置';
  if (!scrubbed.trim()) return '未知错误';
  return scrubbed;
}

export type VoiceWsConnector = (opts: {
  url: string;
  apiKey: string;
  timeoutMs: number;
}) => Promise<void>;

/** Real short-lived WS open+close against the upstream gateway. */
export const connectVoiceUpstream: VoiceWsConnector = ({ url, apiKey, timeoutMs }) =>
  new Promise((resolve, reject) => {
    let settled = false;
    let socket: WebSocket | null = null;
    const done = (err?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket?.close(); } catch { /* ignore */ }
      if (err) reject(err instanceof Error ? err : new Error(String(err)));
      else resolve();
    };

    const timer = setTimeout(() => done(new Error('handshakeTimeout')), timeoutMs);

    try {
      socket = new WebSocket(url, {
        headers: { 'X-Api-Key': apiKey },
        handshakeTimeout: timeoutMs,
      });
    } catch (err) {
      done(err);
      return;
    }

    socket.once('open', () => done());
    socket.once('unexpected-response', (_req, res) => {
      done(new Error(`Unexpected server response: ${res.statusCode ?? 0}`));
    });
    socket.once('error', (err) => done(err));
  });

export async function probeVoiceEndpoint(opts: {
  kind: VoiceEndpointKind;
  url: string;
  apiKey: string;
  timeoutMs?: number;
  connect?: VoiceWsConnector;
}): Promise<VoiceEndpointProbeResult> {
  const host = voiceWsHost(opts.url);
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const connect = opts.connect ?? connectVoiceUpstream;
  const started = Date.now();

  if (!opts.url || host === 'invalid-url') {
    return { ok: false, ms: 0, host, error: '语音上游 URL 无效' };
  }
  if (!opts.apiKey.trim()) {
    return { ok: false, ms: 0, host, error: 'VOICE_API_KEY / LLM_API_KEY 未配置' };
  }

  try {
    await connect({ url: opts.url, apiKey: opts.apiKey, timeoutMs });
    return { ok: true, ms: Date.now() - started, host };
  } catch (err) {
    return {
      ok: false,
      ms: Date.now() - started,
      host,
      error: formatVoiceProbeError(err),
    };
  }
}

export async function probeVoiceGateways(opts?: {
  env?: EnvLike;
  timeoutMs?: number;
  connect?: VoiceWsConnector;
}): Promise<VoiceProbeReport> {
  const env = opts?.env ?? process.env;
  const { apiKey, apiKeySource } = resolveVoiceApiKey(env);
  const apiKeyConfigured = apiKeySource !== 'none';
  const apiKeyLooksLikeGatewaySk = voiceApiKeyLooksLikeGatewaySk(apiKey);
  const apiKeyLength = apiKey.length;
  const asrUrl = resolveVoiceAsrUrl(env);
  const ttsUrl = resolveVoiceTtsUrl(env);
  const timeoutMs = opts?.timeoutMs ?? 8_000;
  const connect = opts?.connect;

  const [asr, tts] = await Promise.all([
    probeVoiceEndpoint({ kind: 'asr', url: asrUrl, apiKey, timeoutMs, connect }),
    probeVoiceEndpoint({ kind: 'tts', url: ttsUrl, apiKey, timeoutMs, connect }),
  ]);

  return {
    ok: asr.ok && tts.ok,
    apiKeyConfigured,
    apiKeySource,
    apiKeyLooksLikeGatewaySk,
    apiKeyLength,
    asr,
    tts,
    entryHint:
      '上游探测成功但浏览器仍失败时，多为入口（APISIX/Caddy）未放行 /api/voice/* 的 WebSocket Upgrade',
  };
}
