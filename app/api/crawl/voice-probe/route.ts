import {
  probeVoiceGateways,
  resolveVoiceAsrUrl,
  resolveVoiceTtsUrl,
  voiceApiKeyConfigured,
  voiceWsHost,
} from '@/lib/voice/probe';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return Response.json(
    {
      ok: true,
      apiKeyConfigured: voiceApiKeyConfigured(),
      asr: { host: voiceWsHost(resolveVoiceAsrUrl()) },
      tts: { host: voiceWsHost(resolveVoiceTtsUrl()) },
      entryHint:
        '上游探测成功但浏览器仍失败时，多为入口（APISIX/Caddy）未放行 /api/voice/* 的 WebSocket Upgrade',
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}

export async function POST() {
  const report = await probeVoiceGateways();
  return Response.json(report, { headers: { 'cache-control': 'no-store' } });
}
