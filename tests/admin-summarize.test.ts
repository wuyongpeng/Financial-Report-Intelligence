import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADMIN_SUMMARIZE_SYSTEM_PROMPT,
  buildSummarizeUserPrompt,
  fingerprintItems,
  formatSummaryStamp,
  isAdminSummarizeScope,
  parseSummarizeThemes,
} from '../lib/admin-summarize';

test('isAdminSummarizeScope accepts survey/feedback/audit only', () => {
  assert.equal(isAdminSummarizeScope('survey'), true);
  assert.equal(isAdminSummarizeScope('feedback'), true);
  assert.equal(isAdminSummarizeScope('audit'), true);
  assert.equal(isAdminSummarizeScope('metrics'), false);
  assert.equal(isAdminSummarizeScope(''), false);
});

test('parseSummarizeThemes counts valid 1-based ids and drops junk', () => {
  const raw = `\`\`\`json
{"themes":[{"title":"入口不明显","ids":[1,2,2,9]},{"title":"","ids":[1]},{"title":"字体偏小","ids":[3,4,5]},{"title":"空","count":0}]}
\`\`\``;
  const themes = parseSummarizeThemes(raw, 5);
  assert.deepEqual(themes, [
    { title: '字体偏小', count: 3 },
    { title: '入口不明显', count: 2 },
  ]);
});

test('parseSummarizeThemes falls back to count when ids missing', () => {
  const themes = parseSummarizeThemes('{"themes":[{"title":"常问净利润","count":7}]}', 20);
  assert.deepEqual(themes, [{ title: '常问净利润', count: 7 }]);
});

test('parseSummarizeThemes returns empty on garbage', () => {
  assert.deepEqual(parseSummarizeThemes('not json', 3), []);
  assert.deepEqual(parseSummarizeThemes('{"themes":"x"}', 3), []);
});

test('fingerprint changes when content or count changes', () => {
  const a = fingerprintItems([{ id: 1, text: '问净利润' }, { id: 2, text: '看茅台' }]);
  const b = fingerprintItems([{ id: 1, text: '问净利润' }, { id: 2, text: '看五粮液' }]);
  const c = fingerprintItems([{ id: 1, text: '问净利润' }]);
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.equal(a, fingerprintItems([{ id: 1, text: '问净利润' }, { id: 2, text: '看茅台' }]));
});

test('buildSummarizeUserPrompt includes audit focus', () => {
  const prompt = buildSummarizeUserPrompt('audit', [{ id: 10, text: '类型:提问；公司:600519；问题:净利润怎样' }]);
  assert.match(prompt, /访问审计/);
  assert.match(prompt, /访问偏好/);
  assert.match(prompt, /常问问题类型/);
  assert.match(prompt, /禁止逐公司/);
  assert.match(prompt, /#1 \(id=10\)/);
  assert.match(ADMIN_SUMMARIZE_SYSTEM_PROMPT, /themes/);
  assert.match(ADMIN_SUMMARIZE_SYSTEM_PROMPT, /禁止逐条\/逐公司流水账/);
});

test('formatSummaryStamp uses Asia/Shanghai MM-DD HH:mm', () => {
  // 2026-11-04 07:20:00Z = 15:20 Asia/Shanghai
  assert.equal(formatSummaryStamp('2026-11-04T07:20:00.000Z'), '11-04 15:20');
});
