import assert from 'node:assert/strict';
import test from 'node:test';
import { llmConfigured, llmModelName, parseLlmProviders } from '../lib/llm-providers';

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const keys = ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL', 'LLM_MODELS', 'LLM_PROVIDERS'];
  const prev = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    fn();
  } finally {
    for (const key of keys) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

test('legacy LLM_BASE_URL / LLM_MODEL is a single provider', () => {
  withEnv({
    LLM_BASE_URL: 'https://api.example.com/v1/',
    LLM_API_KEY: 'sk-test',
    LLM_MODEL: 'glm',
    LLM_PROVIDERS: undefined,
  }, () => {
    assert.deepEqual(parseLlmProviders(), [{
      id: 'primary',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'glm',
    }]);
    assert.equal(llmConfigured(), true);
    assert.equal(llmModelName(), 'glm');
  });
});

test('LLM_PROVIDERS appends unique fallbacks after the primary', () => {
  withEnv({
    LLM_BASE_URL: 'https://a.example/v1',
    LLM_MODEL: 'model-a',
    LLM_API_KEY: 'key-a',
    LLM_PROVIDERS: JSON.stringify([
      { name: 'b', baseUrl: 'https://b.example/v1', apiKey: 'key-b', model: 'model-b' },
      { url: 'https://a.example/v1', model: 'model-a' },
    ]),
  }, () => {
    const list = parseLlmProviders();
    assert.deepEqual(list.map((item) => item.id), ['primary', 'b']);
    assert.equal(list[1].model, 'model-b');
  });
});

test('LLM_PROVIDERS alone is enough when legacy vars are empty', () => {
  withEnv({
    LLM_BASE_URL: undefined,
    LLM_MODEL: undefined,
    LLM_API_KEY: undefined,
    LLM_PROVIDERS: JSON.stringify({ baseUrl: 'https://only.example/v1', model: 'only', name: 'only' }),
  }, () => {
    assert.equal(llmConfigured(), true);
    assert.equal(parseLlmProviders()[0].id, 'only');
  });
});

test('invalid LLM_PROVIDERS JSON is ignored', () => {
  withEnv({
    LLM_BASE_URL: undefined,
    LLM_MODEL: undefined,
    LLM_PROVIDERS: '{not-json',
  }, () => {
    assert.equal(llmConfigured(), false);
    assert.deepEqual(parseLlmProviders(), []);
  });
});

test('LLM_MODELS shares the same URL and key, keeping LLM_MODEL first', () => {
  withEnv({
    LLM_BASE_URL: 'https://gateway.example/v1',
    LLM_API_KEY: 'sk-shared',
    LLM_MODEL: 'thudm/glm-5.2',
    LLM_MODELS: 'thudm/glm-5.2, minimax/MiniMax-M2.7-highspeed, thudm/glm-5.1',
    LLM_PROVIDERS: undefined,
  }, () => {
    const list = parseLlmProviders();
    assert.deepEqual(list.map((item) => item.model), [
      'thudm/glm-5.2',
      'minimax/MiniMax-M2.7-highspeed',
      'thudm/glm-5.1',
    ]);
    assert.ok(list.every((item) => item.baseUrl === 'https://gateway.example/v1' && item.apiKey === 'sk-shared'));
    assert.equal(list[0].id, 'primary');
  });
});
