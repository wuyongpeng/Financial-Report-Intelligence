import assert from 'node:assert/strict';
import test from 'node:test';
import { citeFilingLabel, citeHoverText, citeReferenceText, filingPageHref, parseFilingHref, tokenizeAnswerCites, uniqueAnswerSources } from '../lib/answer-cite';

test('keeps a gap between glued evidence markers', () => {
  const tokens = tokenizeAnswerCites('+54.63%【E1】【E2】');
  assert.deepEqual(tokens.map(t => t.kind), ['text', 'mark', 'text', 'mark']);
  assert.equal(tokens[1].kind === 'mark' && tokens[1].evidenceId, 'E1');
  assert.equal(tokens[2].kind === 'text' && tokens[2].text, ' ');
  assert.equal(tokens[3].kind === 'mark' && tokens[3].evidenceId, 'E2');
});

test('reads page-word and bare P labels', () => {
  const tokens = tokenizeAnswerCites('原文【第 6 页】与 [P6]');
  const marks = tokens.filter(t => t.kind === 'mark');
  assert.equal(marks[0].kind === 'mark' && marks[0].pageWord, 6);
  assert.equal(marks[1].kind === 'mark' && marks[1].printed, '6');
});

test('filing page href encodes code and period', () => {
  assert.equal(filingPageHref('000333', '2026H1'), '/000333?period=2026H1');
  assert.equal(filingPageHref('bad'), '');
  assert.deepEqual(parseFilingHref('/000858?period=2025FY'), { code: '000858', period: '2025FY' });
  assert.equal(parseFilingHref('https://example.com/about'), null);
});

test('filing page href carries cite page and quote for PDF landing', () => {
  const href = filingPageHref('600519', '2025H1', { page: 5, quote: '上年同期的 36.18 元/股' });
  assert.equal(href, '/600519?period=2025H1&page=5&quote=%E4%B8%8A%E5%B9%B4%E5%90%8C%E6%9C%9F%E7%9A%84+36.18+%E5%85%83%2F%E8%82%A1');
  assert.deepEqual(parseFilingHref(href), {
    code: '600519',
    period: '2025H1',
    page: 5,
    quote: '上年同期的 36.18 元/股',
  });
  assert.equal(filingPageHref('600519', '2025H1', { page: 0, quote: '  ' }), '/600519?period=2025H1');
});

test('source labels stay short in hover and expanded in references', () => {
  const source = { companyName: '韦尔股份', period: '2025Q3', page: 1 };
  assert.equal(citeHoverText(source), '韦尔股份 2025Q3 财报 (第 1 页)');
  assert.equal(citeFilingLabel(source), '韦尔股份 2025Q3 季度报告');
  assert.equal(citeReferenceText(source), '韦尔股份 2025Q3 季度报告 (第 1 页)');
});

test('unique answer sources keep first occurrence of each filing, not each page', () => {
  const sources = uniqueAnswerSources(
    '利润率有所提升【E1】，现金流改善【E2】【E1】，同比【E3】',
    [
      { id: 'E1', reportId: 'r1', page: 1, companyName: '工业富联', period: '2026Q1' },
      { id: 'E2', reportId: 'r1', page: 8, companyName: '工业富联', period: '2026Q1' },
      { id: 'E3', reportId: 'r2', page: 1, companyName: '工业富联', period: '2025Q1' },
    ],
    page => `P${page}`,
  );
  assert.deepEqual(sources.map(s => s.id), ['E1', 'E3']);
});

test('unique answer sources fall back to company and period when reportId is missing', () => {
  const sources = uniqueAnswerSources(
    '本期【E1】与另一页【E2】',
    [
      { id: 'E1', page: 1, companyName: '工业富联', period: '2026Q1' },
      { id: 'E2', page: 2, companyName: '工业富联', period: '2026Q1' },
    ],
    page => `P${page}`,
  );
  assert.deepEqual(sources.map(s => s.id), ['E1']);
});
