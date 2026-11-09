import assert from 'node:assert/strict';
import test from 'node:test';
import { formatReadableAnswer, formatStructuredFacts } from '../lib/answer-layout';
import { formatSpokenDirectAnswer } from '../lib/answer';
import { decideDirectAnswer } from '../modules/retrieval/application/answer-policy';
import { planQuestion } from '../modules/retrieval/application/question-planner';
import type { RetrievalMetric } from '../modules/retrieval/domain/retrieval';

function metric(partial: Partial<RetrievalMetric> & Pick<RetrievalMetric, 'reportId' | 'metric' | 'period'>): RetrievalMetric {
  return {
    value: 1,
    unit: '元',
    sourcePage: 1,
    sourceLabel: partial.metric,
    ...partial,
  };
}

test('extremely short answers stay one line', () => {
  assert.equal(formatReadableAnswer('不提供投资建议。'), '不提供投资建议。');
  assert.equal(formatReadableAnswer('利润：10【E1】'), '利润：10【E1】');
});

test('a collapsed metric dump becomes a list', () => {
  const blob = '立讯精密 2026Q3 归母净利润：52.14亿元【E1】 立讯精密 2026Q3 营业收入：1,105.07亿元【E2】 营业收入同比：同比增长 14.62%【E2】';
  const formatted = formatReadableAnswer(blob);
  assert.deepEqual(formatted.split('\n'), [
    '- 立讯精密 2026Q3 归母净利润：52.14亿元【E1】',
    '- 立讯精密 2026Q3 营业收入：1,105.07亿元【E2】',
    '- 营业收入同比：同比增长 14.62%【E2】',
  ]);
});

test('a long multi-sentence answer becomes separate paragraphs', () => {
  const text = '营业收入同比增长百分之十四点六二，归母净利润同比增长百分之六点九八。这两项都来自本份季报的同比增减列，口径是本年第三季度对上年第三季度。经营现金流没有同步改善，需要单独看附注。以上只覆盖已经解析出来的指标。';
  const formatted = formatReadableAnswer(text);
  assert.equal(formatted.split('\n\n').length, 4);
});

test('latest revenue and profit yoy is a table of the current period only', () => {
  const plan = planQuestion({
    question: '立讯精密最新营收、净利润同比多少',
    history: [],
    watched: [],
    currentCode: '002475',
  });
  const decision = decideDirectAnswer({
    plan,
    currentReportId: 'current',
    metrics: [],
    passages: [],
    factLines: [
      { metric: metric({ reportId: 'old', metric: 'revenue', period: '2025FY' }), line: '立讯精密 2025FY 营业收入：3,323.44亿元【E9】' },
      { metric: metric({ reportId: 'current', metric: 'net_profit', period: '2026Q3' }), line: '立讯精密 2026Q3 归母净利润：52.14亿元【E1】' },
      { metric: metric({ reportId: 'current', metric: 'revenue', period: '2026Q3' }), line: '立讯精密 2026Q3 营业收入：1,105.07亿元【E2】' },
      { metric: metric({ reportId: 'old', metric: 'net_profit', period: '2025Q3' }), line: '立讯精密 2025Q3 归母净利润：48.74亿元【E8】' },
    ],
    calculations: [
      '归母净利润同比：同比增长 6.98%【E1】（对比 2025Q3）',
      '营业收入同比：同比增长 14.62%【E2】（对比 2025Q3）',
    ],
  });
  const answer = decision.directAnswer ?? '';
  assert.equal(decision.mode, 'structured-query');
  assert.match(answer, /^立讯精密 2026Q3：营业收入 1,105\.07亿元【E2】，同比增长 14\.62%【E2】（对比 2025Q3）；归母净利润 52\.14亿元【E1】，同比增长 6\.98%【E1】（对比 2025Q3）。/);
  assert.match(answer, /\| 指标 \| 本期 \| 同比 \|/);
  assert.doesNotMatch(answer, /3,323\.44亿元|48\.74亿元|绝对变化|来自本份财报/);
  assert.ok(answer.indexOf('营业收入') < answer.indexOf('归母净利润'));
  assert.equal(
    formatSpokenDirectAnswer(answer),
    '立讯精密 2026Q3：营业收入 1,105.07亿元【E2】，同比增长 14.62%【E2】（对比 2025Q3）；归母净利润 52.14亿元【E1】，同比增长 6.98%【E1】（对比 2025Q3）。',
  );
});

test('an explicit history ask keeps the other periods in the table', () => {
  const plan = planQuestion({
    question: '历年营业收入多少',
    history: [],
    watched: [],
    currentCode: '002475',
  });
  const rows = formatStructuredFacts([
    { metric: metric({ reportId: 'current', metric: 'revenue', period: '2026Q3' }), line: '立讯精密 2026Q3 营业收入：1,105.07亿元【E2】' },
    { metric: metric({ reportId: 'old', metric: 'revenue', period: '2025FY' }), line: '立讯精密 2025FY 营业收入：3,323.44亿元【E9】' },
  ], [], 'current');
  assert.equal(plan.wantsStructuredValue, true);
  const decision = decideDirectAnswer({
    plan,
    currentReportId: 'current',
    metrics: [],
    passages: [],
    factLines: [
      { metric: metric({ reportId: 'current', metric: 'revenue', period: '2026Q3' }), line: '立讯精密 2026Q3 营业收入：1,105.07亿元【E2】' },
      { metric: metric({ reportId: 'old', metric: 'revenue', period: '2025FY' }), line: '立讯精密 2025FY 营业收入：3,323.44亿元【E9】' },
    ],
    calculations: [],
  });
  assert.match(decision.directAnswer ?? '', /3,323\.44亿元/);
  assert.match(rows, /\| 公司 \| 报告期 \| 指标 \| 金额 \|/);
});
