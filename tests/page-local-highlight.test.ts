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

test('长期应付职工薪酬 matches balance-sheet page, not cover boilerplate', () => {
  const q = '这一页的长期应付职工薪酬，为什么是空的';
  const cover = '宁德时代新能源科技股份有限公司 2025年第三季度报告 重要内容提示 公司董事会保证报告内容真实准确完整。';
  const sheet = '非流动负债：长期借款 应付债券 租赁负债 长期应付款 长期应付职工薪酬 预计负债 递延收益';
  assert.equal(findQuoteOnPage(q, cover), null);
  const quote = findQuoteOnPage(q, sheet);
  assert.ok(quote);
  assert.match(quote!, /长期应付职工薪酬/);

  const hit = findPageLocalHighlight(q, [
    { page: 1, content: cover },
    { page: 7, content: sheet },
  ], 7, 1);
  assert.ok(hit);
  assert.equal(hit!.page, 7);

  // Stale toolbar on p.1 must not invent a cover hit that would yank the reader.
  assert.equal(
    findPageLocalHighlight(q, [
      { page: 1, content: cover },
      { page: 2, content: '目录 第一节 重要提示 第二节 公司基本情况' },
      { page: 7, content: sheet },
    ], 1, 1),
    null,
  );
});

test('term-only match requires a ≥4-char anchor', () => {
  const quote = findQuoteOnPage(
    '请看长期和职工',
    '本段讨论长期发展战略与职工培训计划，与薪酬表无关。',
  );
  assert.equal(quote, null);
});

test('营收是多少 expands to 营业收入 for page highlight', () => {
  const { terms } = extractQuestionTokens('营收是多少？');
  assert.ok(terms.includes('营业收入'));
  const page = '一、营业总收入 其中：营业收入 90,703,260,964.48元 营业成本…';
  const quote = findQuoteOnPage('营收是多少？', page);
  assert.ok(quote && /营业收入/.test(quote));
  const hit = findPageLocalHighlight('营收是多少？', [{ page: 2, content: page }], 2, 1);
  assert.ok(hit && hit.page === 2 && /营业收入/.test(hit.quote));
});
