import {
  probeVoiceGateways,
  resolveVoiceApiKey,
  resolveVoiceAsrUrl,
  resolveVoiceTtsUrl,
  voiceApiKeyLooksLikeGatewaySk,
  voiceWsHost,
} from '@/lib/voice/probe';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const { apiKey, apiKeySource } = resolveVoiceApiKey();
  return Response.json(
    {
      ok: true,
      apiKeyConfigured: apiKeySource !== 'none',
      apiKeySource,
      apiKeyLooksLikeGatewaySk: voiceApiKeyLooksLikeGatewaySk(apiKey),
      apiKeyLength: apiKey.length,
      asr: { host: voiceWsHost(resolveVoiceAsrUrl()) },
      tts: { host: voiceWsHost(resolveVoiceTtsUrl()) },
      entryHint: '',
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}

export async function POST() {
  const report = await probeVoiceGateways();
  return Response.json(report, { headers: { 'cache-control': 'no-store' } });
}
