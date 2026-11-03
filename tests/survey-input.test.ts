import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../lib/api';
import {
  isValidSurveyToken,
  parseSurveySubmission,
  randomSurveyNickname,
} from '../lib/survey';
import { POST as postSurvey } from '../app/api/survey/[token]/route';

test('isValidSurveyToken accepts url-safe tokens', () => {
  assert.equal(isValidSurveyToken('8DSFll_d3xKq'), true);
  assert.equal(isValidSurveyToken('bad*token'), false);
  assert.equal(isValidSurveyToken('short'), false);
});

test('parseSurveySubmission requires basic five', () => {
  assert.throws(
    () => parseSurveySubmission({ basic: { b1: '几乎不看' } }),
    (error: unknown) => error instanceof ApiError && error.status === 400,
  );
});

test('parseSurveySubmission accepts basic-only', () => {
  const ok = parseSurveySubmission({
    nickname: ' 悟空 ',
    basic: {
      b1: '几乎不看',
      b2: '轻松',
      b3: '大致懂',
      b4: '有帮助',
      b5: '会',
    },
    deepEnabled: false,
  });
  assert.equal(ok.nickname, '悟空');
  assert.equal(ok.basic.b2, '轻松');
  assert.equal(ok.deep, null);
});

test('parseSurveySubmission allows partial deep', () => {
  const ok = parseSurveySubmission({
    basic: {
      b1: '自己翻 PDF',
      b2: '一般',
      b3: '很清楚',
      b4: '没注意到',
      b5: '不确定',
    },
    deepEnabled: true,
    deep: {
      d1: ['三栏结论', '角标核对'],
      d3: 4,
      d5: ' 挺清楚 ',
    },
  });
  assert.deepEqual(ok.deep?.d1, ['三栏结论', '角标核对']);
  assert.equal(ok.deep?.d3, 4);
  assert.equal(ok.deep?.d5, '挺清楚');
  assert.equal(ok.deep?.d2, undefined);
});

test('parseSurveySubmission rejects invalid D4 overselect', () => {
  assert.throws(
    () => parseSurveySubmission({
      basic: {
        b1: '几乎不看', b2: '费劲', b3: '分不清', b4: '一般', b5: '不会',
      },
      deepEnabled: true,
      deep: {
        d4: { choices: ['更多公司', '数据更准', '手机更好用', '少些 AI 腔'] },
      },
    }),
    (error: unknown) => error instanceof ApiError && error.status === 400,
  );
});

test('randomSurveyNickname returns pool value', () => {
  assert.equal(typeof randomSurveyNickname(0), 'string');
  assert.ok(randomSurveyNickname(0).length > 0);
});

test('POST /api/survey/[token] rejects bad token before DB', async () => {
  const res = await postSurvey(
    new Request('http://localhost/api/survey/bad*token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        basic: {
          b1: '几乎不看', b2: '费劲', b3: '分不清', b4: '一般', b5: '不会',
        },
      }),
    }),
    { params: Promise.resolve({ token: 'bad*token' }) },
  );
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});
