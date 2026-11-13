import assert from 'node:assert/strict';
import test from 'node:test';
import { DISCARD_CONFIRM_PASSWORD, matchesDiscardPassword, redactDiscardPasswordCopy } from '../lib/discard-password';

test('discard password is EVA and matches only exact value', () => {
  assert.equal(DISCARD_CONFIRM_PASSWORD, 'EVA');
  assert.equal(matchesDiscardPassword('EVA'), true);
  assert.equal(matchesDiscardPassword('eva'), false);
  assert.equal(matchesDiscardPassword('Eva'), false);
  assert.equal(matchesDiscardPassword('EVA '), false);
  assert.equal(matchesDiscardPassword(''), false);
  assert.equal(matchesDiscardPassword(null), false);
  assert.equal(matchesDiscardPassword(undefined), false);
  assert.equal(matchesDiscardPassword(123), false);
});

test('acceptance copy hides the discard password and leaves the product name alone', () => {
  const secret = DISCARD_CONFIRM_PASSWORD;
  assert.equal(
    redactDiscardPasswordCopy(`删除密码是 ${secret}，区分大小写。`),
    '删除时需输入正确密码，区分大小写。',
  );
  assert.equal(
    redactDiscardPasswordCopy(`直接打开 /admin/metrics。再找一处删除，先输错密码，再输入 ${secret}。`),
    '直接打开 /admin/metrics。再找一处删除，先输错密码，再输入正确密码。',
  );
  assert.equal(
    redactDiscardPasswordCopy(`错密码删不掉，${secret} 才能删。`),
    '错密码删不掉，输入正确密码才能删。',
  );
  assert.equal(
    redactDiscardPasswordCopy(`对一条错抓报告点删除，输入 ${secret} 确认。`),
    '对一条错抓报告点删除，输入正确密码确认。',
  );
  assert.equal(redactDiscardPasswordCopy('标题为 Eva - 财报智能分析助手。'), '标题为 Eva - 财报智能分析助手。');
  assert.doesNotMatch(redactDiscardPasswordCopy(`删除密码是 ${secret}，${secret} 才能删。`), new RegExp(secret));
  assert.equal(redactDiscardPasswordCopy(''), '');
});
