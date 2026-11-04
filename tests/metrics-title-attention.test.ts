import assert from 'node:assert/strict';
import test from 'node:test';
import {
  METRICS_TITLE_ATTENTION_KEYWORDS,
  splitTitleAttention,
  titleHasAttentionKeyword,
} from '../lib/metrics-title-attention';

test('keywords include 预告 and suggested list', () => {
  const set = new Set(METRICS_TITLE_ATTENTION_KEYWORDS);
  for (const k of [
    '预告',
    '更正',
    '修订',
    '补充',
    '取消',
    '摘要',
    '问询函',
    '关注函',
    '风险提示',
    '业绩快报',
  ]) {
    assert.ok(set.has(k as (typeof METRICS_TITLE_ATTENTION_KEYWORDS)[number]), k);
  }
});

test('splitTitleAttention marks only 预告 substring in 业绩预告 title', () => {
  const title = '青海盐湖工业股份有限公司2026年前三季度业绩预告';
  const segs = splitTitleAttention(title);
  assert.ok(titleHasAttentionKeyword(title));
  const hits = segs.filter((s) => s.kind === 'hit');
  assert.deepEqual(hits.map((h) => h.text), ['预告']);
  assert.equal(segs.map((s) => s.text).join(''), title);
});

test('splitTitleAttention prefers 业绩快报 over shorter tokens', () => {
  const title = '某某股份2026年第一季度业绩快报';
  const hits = splitTitleAttention(title).filter((s) => s.kind === 'hit');
  assert.deepEqual(hits.map((h) => h.text), ['业绩快报']);
});

test('plain formal report title has no hits', () => {
  const title = '中国建设银行股份有限公司2026年第三季度报告';
  assert.equal(titleHasAttentionKeyword(title), false);
  assert.deepEqual(splitTitleAttention(title), [{ kind: 'text', text: title }]);
});

test('multiple distinct keywords are each marked', () => {
  const title = '关于对某某的问询函暨更正公告';
  const hits = splitTitleAttention(title).filter((s) => s.kind === 'hit').map((h) => h.text);
  assert.deepEqual(hits, ['问询函', '更正']);
});
