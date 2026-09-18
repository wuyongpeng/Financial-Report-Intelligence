import assert from 'node:assert/strict';
import test from 'node:test';
import {
  contextualFollowups,
  extractFollowupText,
  isGenericFollowup,
  mergeFollowups,
  parseFollowupQuestions,
  topicFromQuestion,
} from '../lib/chat-followups';

test('topicFromQuestion prefers a metric name over the whole sentence', () => {
  assert.equal(topicFromQuestion('本期毛利率为什么下降？'), '毛利率');
  assert.equal(topicFromQuestion('海外收入占比有变化吗'), '海外业务');
  assert.equal(topicFromQuestion('存货周转是否变慢'), '存货');
});

test('parseFollowupQuestions reads numbered lines and drops canned 营业收入套话', () => {
  const raw = [
    '1. 毛利率下降主要受哪项成本影响？',
    '2. 本期营业收入是多少？',
    '3. 海外毛利率和国内差多少个百分点？',
    '4. 管理层对毛利率怎么解释？',
  ].join('\n');
  assert.deepEqual(parseFollowupQuestions(raw, ['本期毛利率为什么下降？']), [
    '毛利率下降主要受哪项成本影响？',
    '海外毛利率和国内差多少个百分点？',
    '管理层对毛利率怎么解释？',
  ]);
});

test('extractFollowupText keeps reasoning when content is empty', () => {
  const payload = JSON.stringify({
    choices: [{
      message: {
        content: '',
        reasoning_content: '毛利率下滑的构成是什么？\n和上年同期差多少个百分点？\n原文怎么写的？',
      },
    }],
  });
  const parsed = parseFollowupQuestions(payload, []);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0], '毛利率下滑的构成是什么？');
});

test('contextualFollowups stay tied to the asked topic instead of a global pool', () => {
  const questions = contextualFollowups('存货为什么增加？', '存货 48 亿元。', ['存货为什么增加？']);
  assert.equal(questions.length, 3);
  assert.ok(questions.every((item) => item.includes('存货') || item.includes('口径')));
  assert.ok(questions.every((item) => !isGenericFollowup(item)));
});

test('mergeFollowups fills to three without bringing back canned questions', () => {
  const merged = mergeFollowups(
    ['研发费用同比为什么上升？'],
    contextualFollowups('研发投入是否加大？', '', []),
  );
  assert.equal(merged.length, 3);
  assert.equal(merged[0], '研发费用同比为什么上升？');
  assert.ok(!merged.some(isGenericFollowup));
});
