import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampAttributionTitle, ATTRIBUTION_TITLE_MAX_CHARS } from '../lib/industry-skills-ui';
import { expandAttributionModulePool } from '../lib/industry-skills-ui';

test('clampAttributionTitle cuts to 10 code points', () => {
  assert.equal(ATTRIBUTION_TITLE_MAX_CHARS, 10);
  assert.equal(clampAttributionTitle('AI收入口径'), 'AI收入口径');
  assert.equal(clampAttributionTitle('AI 相关收入若单列必须引用原文'), 'AI 相关收入若单列');
  assert.equal([...clampAttributionTitle('一二三四五六七八九十一二三')].length, 10);
});

test('expandAttributionModulePool clamps primary titles', () => {
  const pool = expandAttributionModulePool([
    { id: 'd5', title: 'AI 相关收入若单列必须引用原文', hint: 'x' },
  ]);
  const hit = pool.find((m) => m.id === 'd5')!;
  assert.ok([...hit.title].length <= 10);
});
