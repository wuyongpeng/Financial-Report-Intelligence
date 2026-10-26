import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatVoiceProbeError,
  probeVoiceEndpoint,
  probeVoiceGateways,
  resolveVoiceApiKey,
  resolveVoiceAsrUrl,
  resolveVoiceTtsUrl,
  voiceApiKeyConfigured,
  voiceApiKeyLooksLikeGatewaySk,
  voiceWsHost,
  DEFAULT_VOICE_ASR_WS_URL,
  DEFAULT_VOICE_TTS_WS_URL,
} from '../lib/voice/probe';

test('resolveVoice*Url falls back to defaults and honors overrides', () => {
  assert.equal(resolveVoiceAsrUrl({}), DEFAULT_VOICE_ASR_WS_URL);
  assert.equal(resolveVoiceTtsUrl({}), DEFAULT_VOICE_TTS_WS_URL);
  assert.equal(
    resolveVoiceAsrUrl({ VOICE_ASR_WS_URL: '  wss://asr.example/ws  ' }),
    'wss://asr.example/ws',
  );
  assert.equal(
    resolveVoiceTtsUrl({ VOICE_TTS_WS_URL: 'wss://tts.example/ws' }),
    'wss://tts.example/ws',
  );
});

test('voiceWsHost extracts host only', () => {
  assert.equal(
    voiceWsHost('wss://ai-gateway.intra.weibo.com/v1/passthrough?k=secret'),
    'ai-gateway.intra.weibo.com',
  );
  assert.equal(voiceWsHost('not a url'), 'invalid-url');
});

test('resolveVoiceApiKey prefers VOICE_API_KEY over LLM_API_KEY', () => {
  assert.deepEqual(resolveVoiceApiKey({}), { apiKey: '', apiKeySource: 'none' });
  assert.deepEqual(
    resolveVoiceApiKey({ LLM_API_KEY: '  llm-only  ' }),
    { apiKey: 'llm-only', apiKeySource: 'llm' },
  );
  assert.deepEqual(
    resolveVoiceApiKey({ VOICE_API_KEY: ' sk-voice ', LLM_API_KEY: 'llm-only' }),
    { apiKey: 'sk-voice', apiKeySource: 'voice' },
  );
  assert.equal(voiceApiKeyConfigured({ LLM_API_KEY: '' }), false);
  assert.equal(voiceApiKeyConfigured({ LLM_API_KEY: '  sk-test  ' }), true);
  assert.equal(voiceApiKeyConfigured({ VOICE_API_KEY: 'sk-v' }), true);
  assert.equal(voiceApiKeyLooksLikeGatewaySk('sk-abc'), true);
  assert.equal(voiceApiKeyLooksLikeGatewaySk('Bearer xyz'), false);
});

test('formatVoiceProbeError maps common failures and scrubs secrets', () => {
  assert.match(formatVoiceProbeError(new Error('Unexpected server response: 401')), /401/);
  assert.match(formatVoiceProbeError(new Error('Unexpected server response: 401')), /VOICE_API_KEY/);
  assert.match(formatVoiceProbeError(new Error('getaddrinfo ENOTFOUND gw')), /DNS/);
  assert.match(formatVoiceProbeError(new Error('handshakeTimeout')), /超时/);
  assert.match(formatVoiceProbeError(new Error('ECONNREFUSED')), /拒绝/);
  const scrubbed = formatVoiceProbeError(new Error('X-Api-Key: super-secret-value boom'));
  assert.equal(scrubbed.includes('super-secret-value'), false);
  assert.match(scrubbed, /\*\*\*/);
});

test('probeVoiceEndpoint reports missing key without connecting', async () => {
  let called = 0;
  const result = await probeVoiceEndpoint({
    kind: 'asr',
    url: 'wss://asr.example/ws',
    apiKey: '',
    connect: async () => {
      called += 1;
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.host, 'asr.example');
  assert.match(result.error ?? '', /VOICE_API_KEY|LLM_API_KEY/);
  assert.equal(called, 0);
});

test('probeVoiceGateways prefers VOICE_API_KEY and reports safe key shape', async () => {
  const calls: Array<{ url: string; apiKey: string }> = [];
  const voiceSecret = 'sk-voice-probe-key-xyz';
  const llmSecret = 'llm-should-not-be-used';
  const report = await probeVoiceGateways({
    env: {
      VOICE_API_KEY: voiceSecret,
      LLM_API_KEY: llmSecret,
      VOICE_ASR_WS_URL: 'wss://asr.example/a',
      VOICE_TTS_WS_URL: 'wss://tts.example/t',
    },
    connect: async ({ url, apiKey }) => {
      calls.push({ url, apiKey });
      if (url.includes('tts.example')) throw new Error('Unexpected server response: 403');
    },
  });
  assert.equal(report.apiKeyConfigured, true);
  assert.equal(report.apiKeySource, 'voice');
  assert.equal(report.apiKeyLooksLikeGatewaySk, true);
  assert.equal(report.apiKeyLength, voiceSecret.length);
  assert.equal(report.asr.ok, true);
  assert.equal(report.tts.ok, false);
  assert.match(report.tts.error ?? '', /403/);
  assert.equal(report.ok, false);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.apiKey === voiceSecret));
  assert.ok(report.entryHint.includes('WebSocket'));
  const dumped = JSON.stringify(report);
  assert.equal(dumped.includes(voiceSecret), false);
  assert.equal(dumped.includes(llmSecret), false);
});

test('probeVoiceGateways falls back to LLM_API_KEY when VOICE_API_KEY empty', async () => {
  const secret = 'not-sk-llm-key';
  const report = await probeVoiceGateways({
    env: {
      LLM_API_KEY: secret,
      VOICE_ASR_WS_URL: 'wss://asr.example/a',
      VOICE_TTS_WS_URL: 'wss://tts.example/t',
    },
    connect: async () => {},
  });
  assert.equal(report.apiKeySource, 'llm');
  assert.equal(report.apiKeyLooksLikeGatewaySk, false);
  assert.equal(report.apiKeyLength, secret.length);
  assert.equal(report.ok, true);
  assert.equal(JSON.stringify(report).includes(secret), false);
});
