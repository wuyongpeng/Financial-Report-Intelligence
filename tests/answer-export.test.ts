import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { answerExportFilename, formatAnswerExport, formatExportCompany, formatExportPeriod, listExportSources } from '../lib/answer-export';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const citedAnswer = {
  companyName: '美的集团',
  code: '000333',
  period: '2025Q3',
  question: '营业收入变动的主要原因是什么？',
  answer: '本期营业收入同比增长 8.2%[P12]，主要来自外销改善【E2】。',
  citations: [
    { id: 'E1', reportId: 'r-midea-2025q3', page: 12, companyName: '美的集团', period: '2025Q3', code: '000333', quote: '营业收入同比增长 8.2%' },
    { id: 'E2', reportId: 'r-midea-2025q3', page: 18, companyName: '美的集团', period: '2025Q3', code: '000333', quote: '外销收入明显改善' },
  ],
};

test('formats company as name and code, and does not invent a missing period', () => {
  assert.equal(formatExportCompany('美的集团', '000333'), '美的集团（000333）');
  assert.equal(formatExportCompany('美的集团', ''), '美的集团');
  assert.equal(formatExportCompany(null, '000333'), '000333');
  assert.equal(formatExportCompany(null, null), '未提供');
  assert.equal(formatExportPeriod('2025Q3'), '2025Q3');
  assert.equal(formatExportPeriod('  '), '未提供');
  assert.equal(formatExportPeriod(null), '未提供');
});

test('export payload includes company, period, question, answer and cited sources', () => {
  const { markdown, filename } = formatAnswerExport(citedAnswer);
  assert.match(markdown, /^# Eva 回答/m);
  assert.match(markdown, /^- 公司：美的集团（000333）/m);
  assert.match(markdown, /^- 期间：2025Q3/m);
  assert.match(markdown, /营业收入变动的主要原因是什么？/);
  assert.match(markdown, /本期营业收入同比增长 8\.2%\[P12\]，主要来自外销改善\[P18\]/);
  assert.match(markdown, /美的集团（000333） 2025Q3 季度报告 \(第 12 页\)：营业收入同比增长 8\.2%/);
  assert.match(markdown, /美的集团（000333） 2025Q3 季度报告 \(第 18 页\)：外销收入明显改善/);
  assert.equal(filename, 'Eva-美的集团-000333-2025Q3.md');
  assert.equal(answerExportFilename(citedAnswer), filename);
});

test('missing period and missing citations are stated honestly', () => {
  const { markdown, filename } = formatAnswerExport({
    companyName: '美的集团',
    code: '000333',
    question: '现金流如何？',
    answer: '经营现金流保持稳定。',
  });
  assert.match(markdown, /^- 期间：未提供/m);
  assert.doesNotMatch(markdown, /2025Q3/);
  assert.match(markdown, /本文没有标注来源。/);
  assert.doesNotMatch(markdown, /第 \d+ 页/);
  assert.equal(filename, 'Eva-美的集团-000333.md');
});

test('unresolved marks stay visible and unused evidence is not invented', () => {
  const sources = listExportSources({
    answer: '利润改善【E9】，同时费用下降[P4]。',
    citations: [
      { id: 'E4', reportId: 'r-other', page: 4, companyName: '美的集团', period: '2025Q3', quote: '销售费用下降' },
      { id: 'E8', reportId: 'r-unused', page: 99, companyName: '格力电器', period: '2025Q3', quote: '不应出现在导出中' },
    ],
  });
  assert.deepEqual(sources.map((item) => item.kind), ['unresolved', 'source']);
  assert.equal(sources[0]?.text, '文中标注了 【E9】，但本轮没有对应出处。');
  assert.equal(sources[1]?.text, '美的集团 2025Q3 季度报告 (第 4 页)：销售费用下降');
  const { markdown } = formatAnswerExport({
    companyName: '美的集团',
    period: '2025Q3',
    question: '利润为何改善？',
    answer: '利润改善【E9】，同时费用下降[P4]。',
    citations: [
      { id: 'E4', reportId: 'r-other', page: 4, companyName: '美的集团', period: '2025Q3', quote: '销售费用下降' },
      { id: 'E8', reportId: 'r-unused', page: 99, companyName: '格力电器', period: '2025Q3', quote: '不应出现在导出中' },
    ],
  });
  assert.match(markdown, /利润改善【E9】（待核验），同时费用下降\[P4\]/);
  assert.match(markdown, /文中标注了 【E9】，但本轮没有对应出处。/);
  assert.doesNotMatch(markdown, /格力电器|第 99 页|不应出现在导出中/);
});

test('detail and share surfaces expose a single 导出 action that uses the helper', () => {
  const detail = source('../app/company-detail.tsx');
  const share = source('../app/share/[id]/share-view.tsx');
  assert.match(detail, /copyAndDownloadAnswerExport|formatAnswerExport/);
  assert.match(detail, /aria-label="导出"/);
  assert.match(share, /copyAndDownloadAnswerExport|formatAnswerExport/);
  assert.match(share, /aria-label="导出"|导出/);
});
