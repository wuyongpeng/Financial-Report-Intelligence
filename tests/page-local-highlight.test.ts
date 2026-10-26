import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractQuestionTokens,
  findQuoteOnPage,
  findPageLocalHighlight,
} from '../lib/pdf/page-local-highlight';

const PAGE3 = normalize(`
  合并资产负债表主要项目变动分析
  应收账款本期期末余额较上期增长 47.78%，主要系本报告期信用政策放宽、
  下游客户回款周期延长所致。存货变动率 12.3%。货币资金减少 3.1%。
`);

function normalize(s: string) {
  return s.replace(/\s+/g, ' ').trim();
}

test('extractQuestionTokens picks % numbers and Chinese terms', () => {
  const { numbers, terms } = extractQuestionTokens(
    '这里的应收账款的变动率是47.78%是什么影响的',
  );
  assert.ok(numbers.some(n => n.includes('47.78')));
  assert.ok(terms.includes('应收账款'));
  assert.ok(terms.includes('变动率'));
  assert.ok(!terms.includes('这里'));
  assert.ok(!terms.includes('什么'));
});

test('findQuoteOnPage highlights 47.78% with 应收账款 context', () => {
  const quote = findQuoteOnPage(
    '这里的应收账款的变动率是47.78%是什么影响的',
    PAGE3,
  );
  assert.ok(quote, 'expected a quote');
  assert.match(quote!, /47\.78%/);
  assert.match(quote!, /应收账款/);
  assert.ok(quote!.length >= 8);
});

test('findQuoteOnPage returns null on unrelated page', () => {
  const quote = findQuoteOnPage(
    '这里的应收账款的变动率是47.78%是什么影响的',
    '公司治理结构完善，独立董事出席率 100%。',
  );
  assert.equal(quote, null);
});

test('findPageLocalHighlight prefers current page', () => {
  const pages = [
    { page: 2, content: '应收账款无关说明，变动率 1.00%。' },
    { page: 3, content: PAGE3 },
    { page: 4, content: '附注：应收账款坏账准备计提政策。' },
  ];
  const hit = findPageLocalHighlight(
    '这里的应收账款的变动率是47.78%是什么影响的',
    pages,
    3,
  );
  assert.ok(hit);
  assert.equal(hit!.page, 3);
  assert.match(hit!.quote, /47\.78%/);
});

test('findPageLocalHighlight falls back to adjacent page', () => {
  const pages = [
    { page: 2, content: '前言' },
    { page: 3, content: '本页无应收账款数字。' },
    { page: 4, content: PAGE3 },
  ];
  const hit = findPageLocalHighlight(
    '这里的应收账款的变动率是47.78%是什么影响的',
    pages,
    3,
  );
  assert.ok(hit);
  assert.equal(hit!.page, 4);
  assert.match(hit!.quote, /47\.78%/);
});

test('findQuoteOnPage multi-term without number still works when strong', () => {
  const quote = findQuoteOnPage(
    '请看应收账款和坏账准备',
    '本节披露应收账款坏账准备的计提方法与比例。',
  );
  assert.ok(quote);
  assert.match(quote!, /应收账款/);
  assert.match(quote!, /坏账准备/);
});
