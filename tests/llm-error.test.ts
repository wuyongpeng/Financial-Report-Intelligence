import assert from 'node:assert/strict';
import test from 'node:test';
import { extractLlmErrorMessage, formatLlmCallError, formatLlmHttpError, publicVerdictError } from '../lib/llm-error';

test('formatLlmHttpError reads OpenAI-style error.message', () => {
  assert.equal(
    formatLlmHttpError(502, '{"error":{"message":"upstream timeout","type":"server_error"}}'),
    'AI 返回 502：upstream timeout，请稍后再试。',
  );
  assert.equal(formatLlmHttpError(503, ''), 'AI 返回 503 错误，请稍后再试。');
  assert.equal(extractLlmErrorMessage('{"message":"no upstream"}'), 'no upstream');
});

test('formatLlmCallError distinguishes timeout from other failures', () => {
  const abort = Object.assign(new Error('Aborted'), { name: 'AbortError' });
  assert.equal(formatLlmCallError(abort), 'AI 调用超时，请稍后再试。');
  assert.equal(formatLlmCallError(new Error('LLM 排队超时')), 'AI 调用失败：LLM 排队超时，请稍后再试。');
  assert.equal(publicVerdictError('unavailable'), 'unavailable');
});
