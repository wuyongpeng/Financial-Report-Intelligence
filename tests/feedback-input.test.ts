import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../lib/api';
import { parseFeedbackInput } from '../lib/feedback-input';
import { POST as postFeedback } from '../app/api/feedback/route';

test('parseFeedbackInput requires non-empty message', () => {
  assert.throws(
    () => parseFeedbackInput({ message: '  ' }),
    (error: unknown) => error instanceof ApiError && error.status === 400,
  );
  const ok = parseFeedbackInput(
    { message: ' 希望加分部收入 ', contact: '  me@example.com ', page: '/', url: 'http://localhost/', userAgent: 'jest' },
    'fallback-ua',
  );
  assert.equal(ok.message, '希望加分部收入');
  assert.equal(ok.contact, 'me@example.com');
  assert.equal(ok.page, '/');
  assert.equal(ok.userAgent, 'jest');
});

test('parseFeedbackInput allows empty contact', () => {
  const ok = parseFeedbackInput({ message: '界面很好用', contact: '   ' }, 'Mozilla/5.0');
  assert.equal(ok.contact, null);
  assert.equal(ok.userAgent, 'Mozilla/5.0');
  assert.equal(ok.page, null);
});

test('parseFeedbackInput rejects oversized contact', () => {
  assert.throws(
    () => parseFeedbackInput({ message: 'ok', contact: 'x'.repeat(121) }),
    (error: unknown) => error instanceof ApiError && error.status === 400,
  );
});

test('POST /api/feedback rejects empty message before DB work', async () => {
  const res = await postFeedback(new Request('http://localhost/api/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: '' }),
  }));
  assert.equal(res.status, 400);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json() as { error?: string };
  assert.match(String(body.error), /反馈内容/);
});
