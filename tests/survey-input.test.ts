import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../lib/api';
import {
  formatSurveyBasicLine,
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

test('parseSurveySubmission requires basic fields', () => {
  assert.throws(
    () => parseSurveySubmission({ basic: { b1: ['几乎不看'] } }),
    (error: unknown) => error instanceof ApiError && error.status === 400,
  );
});

test('parseSurveySubmission accepts basic-only', () => {
  const ok = parseSurveySubmission({
    nickname: ' 悟空 ',
    basic: {
      b1: ['几乎不看', '自己翻 PDF'],
      b2: '很顺',
      b3: '大致懂',
      b4: '有一些',
      b5: '点过,有帮助',
      b6: { choice: '没有' },
      note: ' 想看看行业对比 ',
    },
    deepEnabled: false,
  });
  assert.equal(ok.nickname, '悟空');
  assert.deepEqual(ok.basic.b1, ['几乎不看', '自己翻 PDF']);
  assert.equal(ok.basic.b2, '很顺');
  assert.equal(ok.basic.b6.choice, '没有');
  assert.equal(ok.basic.note, '想看看行业对比');
  assert.equal(ok.deep, null);
});

test('parseSurveySubmission accepts b6 product', () => {
  const ok = parseSurveySubmission({
    basic: {
      b1: ['用过其它工具'],
      b2: '一般',
      b3: '很清楚',
      b4: '清楚很多',
      b5: '没注意到有角标',
      b6: { choice: '用过', product: ' 某某财报 ' },
    },
    deepEnabled: false,
  });
  assert.equal(ok.basic.b6.choice, '用过');
  assert.equal(ok.basic.b6.product, '某某财报');
});

test('parseSurveySubmission rejects empty b1', () => {
  assert.throws(
    () => parseSurveySubmission({
      basic: {
        b1: [],
        b2: '很顺',
        b3: '分不清',
        b4: '没变化',
        b5: '看到了,但没点',
        b6: { choice: '没有' },
      },
    }),
    (error: unknown) => error instanceof ApiError && error.status === 400,
  );
});

test('parseSurveySubmission allows partial deep', () => {
  const ok = parseSurveySubmission({
    basic: {
      b1: ['自己翻 PDF'],
      b2: '一般',
      b3: '很清楚',
      b4: '有一些',
      b5: '点过,一般',
      b6: { choice: '没有' },
    },
    deepEnabled: true,
    deep: {
      d1: ['三栏结论', '角标核对'],
      d3: 4,
      d5: ' 挺清楚 ',
      d6: '刚好',
      d9: 5,
      d10: { choice: '季报速读' },
    },
  });
  assert.deepEqual(ok.deep?.d1, ['三栏结论', '角标核对']);
  assert.equal(ok.deep?.d3, 4);
  assert.equal(ok.deep?.d5, '挺清楚');
  assert.equal(ok.deep?.d2, undefined);
  assert.equal(ok.deep?.d6, '刚好');
  assert.equal(ok.deep?.d9, 5);
  assert.equal(ok.deep?.d10?.choice, '季报速读');
});

test('parseSurveySubmission rejects invalid D4 overselect', () => {
  assert.throws(
    () => parseSurveySubmission({
      basic: {
        b1: ['几乎不看'],
        b2: '费劲',
        b3: '分不清',
        b4: '更糊涂了',
        b5: '点过,一般',
        b6: { choice: '没有' },
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

test('SURVEY_NICKNAMES has 19 names', async () => {
  const { SURVEY_NICKNAMES } = await import('../lib/survey');
  assert.equal(SURVEY_NICKNAMES.length, 19);
});

test('formatSurveyBasicLine handles new and legacy shapes', () => {
  const neu = formatSurveyBasicLine({
    b1: ['几乎不看', '自己翻 PDF'],
    b2: '很顺',
    b3: '大致懂',
    b4: '有一些',
    b5: '点过,有帮助',
    b6: { choice: '用过', product: 'X' },
    note: '补充',
  });
  assert.match(neu, /几乎不看\/自己翻 PDF/);
  assert.match(neu, /用过:X/);
  assert.match(neu, /备注:补充/);

  const legacy = formatSurveyBasicLine({
    b1: '几乎不看',
    b2: '轻松',
    b3: '大致懂',
    b4: '有帮助',
    b5: '很好',
  });
  assert.match(legacy, /几乎不看/);
  assert.match(legacy, /轻松/);
});

test('POST /api/survey/[token] rejects bad token before DB', async () => {
  const res = await postSurvey(
    new Request('http://localhost/api/survey/bad*token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        basic: {
          b1: ['几乎不看'],
          b2: '费劲',
          b3: '分不清',
          b4: '没变化',
          b5: '点过,一般',
          b6: { choice: '没有' },
        },
      }),
    }),
    { params: Promise.resolve({ token: 'bad*token' }) },
  );
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});
