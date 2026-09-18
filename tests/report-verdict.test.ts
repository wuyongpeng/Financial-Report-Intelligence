import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptVerdictPayload, followupFromTitle, followupQuestions, parseReportVerdict, parseReportVerdictJson, targetedFollowups, unwrapModelJson, verdictTone, type ReportVerdict } from '../lib/report-verdict';
import type { Citation } from '../lib/detail-model';

const evidence: Citation[] = [
  { id: 'E1', reportId: 'r1', companyName: '示例', period: '2025FY', page: 12, quote: '海外市场收入同比增长32%', code: '600000' },
  { id: 'E2', reportId: 'r1', companyName: '示例', period: '2025FY', page: 18, quote: '经营现金流同比下降24%', code: '600000' },
];

function valid(): unknown {
  return {
    verdict: { label: '稳健增长', summary: '主营业务保持增长，盈利能力同步改善。' },
    changes: [
      { type: '收入', direction: '利好', title: '主营业务增长', description: '海外市场收入同比增长32%，成为本期收入增长的主要来源。', sourceRef: ['E1'] },
      { type: '现金流', direction: '风险', title: '现金流承压', description: '经营现金流同比下降24%，与净利润增长形成背离。', sourceRef: [{ id: 'E2' }] },
    ],
  };
}

test('parses a valid verdict and resolves sourceRef by evidence id', () => {
  const parsed = parseReportVerdict(valid(), evidence);
  assert.ok(parsed);
  assert.equal(parsed!.verdict.label, '稳健增长');
  assert.equal(parsed!.changes.length, 2);
  assert.equal(parsed!.changes[0].sourceRef[0].page, 12);
  assert.equal(parsed!.changes[1].direction, '风险');
  assert.equal(verdictTone('稳健增长'), 'up');
  assert.equal(verdictTone('经营分化'), 'mid');
  assert.equal(verdictTone('增收不增利'), 'down');
});

test('rejects labels, types, and English directions outside the enums', () => {
  const raw = valid() as { verdict: { label: string }; changes: Array<Record<string, unknown>> };
  raw.verdict.label = '超级牛市';
  assert.equal(parseReportVerdict(raw, evidence), null);
  const typed = valid() as { changes: Array<Record<string, unknown>> };
  typed.changes[0].type = '驱动';
  typed.changes[0].direction = 'positive';
  const parsed = parseReportVerdict(typed, evidence);
  assert.ok(parsed);
  assert.equal(parsed!.changes.length, 1);
  assert.equal(parsed!.changes[0].title, '现金流承压');
});

test('drops changes without resolvable sourceRef and keeps a valid verdict', () => {
  const raw = valid() as { changes: Array<Record<string, unknown>> };
  raw.changes[0].sourceRef = [];
  raw.changes[1].sourceRef = ['E99'];
  const parsed = parseReportVerdict(raw, evidence);
  assert.ok(parsed);
  assert.equal(parsed!.changes.length, 0);
});

test('caps changes at three and ignores extra items', () => {
  const extra = {
    type: '其他', direction: '中性', title: '口径调整', description: '会计口径有所变化，影响跨期比较。', sourceRef: ['E1'],
  };
  const raw = valid() as { changes: unknown[] };
  raw.changes.push(extra, { ...extra, title: '第四条不应出现' });
  const parsed = parseReportVerdict(raw, evidence);
  assert.equal(parsed?.changes.length, 3);
  assert.ok(parsed!.changes.every((item) => item.title !== '第四条不应出现'));
});

test('JSON parser does not repair fenced or partial model output', () => {
  const ok = JSON.stringify(valid());
  assert.equal(parseReportVerdictJson(ok, evidence)?.verdict.label, '稳健增长');
  assert.equal(parseReportVerdictJson(`\`\`\`json\n${ok}\n\`\`\``, evidence), null);
  assert.equal(parseReportVerdictJson(`${ok.slice(0, 40)}`, evidence), null);
  assert.equal(parseReportVerdictJson('undefined', evidence), null);
});

test('unwrapModelJson strips think tags and fences then keeps the JSON object', () => {
  const ok = JSON.stringify(valid());
  assert.equal(unwrapModelJson(`<think>先推理</think>\n${ok}`), ok);
  assert.equal(unwrapModelJson(`\`\`\`json\n${ok}\n\`\`\``), ok);
  assert.equal(unwrapModelJson('<think>还在想'), null);
});

test('accepts API payloads whose sourceRef is already hydrated citations', () => {
  const parsed = acceptVerdictPayload({
    verdict: { label: '表现平稳', summary: '经营节奏平稳。' },
    changes: [{
      type: '其他', direction: '中性', title: '口径调整', description: '会计口径有所变化。',
      sourceRef: [{ id: 'E1', reportId: 'r1', page: 12, quote: '口径', companyName: '示例', period: '2025FY' }],
    }],
  });
  assert.equal(parsed?.verdict.label, '表现平稳');
  assert.equal(parsed?.changes[0].sourceRef[0].page, 12);
  assert.equal(acceptVerdictPayload({ verdict: { label: '超级牛市', summary: '不好' }, changes: [] }), null);
});

test('follow-ups come from change titles without a model call', () => {
  const changes: ReportVerdict['changes'] = [
    { type: '收入', direction: '利好', title: '主营业务增长', description: 'x', sourceRef: [evidence[0]] },
    { type: '现金流', direction: '风险', title: '现金流承压', description: 'x', sourceRef: [evidence[1]] },
    { type: '盈利', direction: '利空', title: '毛利率下降', description: 'x', sourceRef: [evidence[0]] },
  ];
  assert.equal(followupFromTitle('主营业务增长'), '主营业务增长的主要原因是什么？');
  assert.equal(followupFromTitle('现金流承压'), '经营现金流为什么下降？');
  assert.equal(followupFromTitle('毛利率下降'), '毛利率下降的主要原因是什么？');
  assert.deepEqual(followupQuestions(changes), [
    '主营业务增长的主要原因是什么？',
    '经营现金流为什么下降？',
    '毛利率下降的主要原因是什么？',
  ]);
  assert.equal(followupQuestions(changes.slice(0, 1)).length, 1);
});

test('parses modules with evidence and drops invalid or duplicate ones', () => {
  const raw = {
    verdict: { label: '稳健增长', summary: '主营业务保持增长，盈利能力同步改善。' },
    changes: [],
    modules: [
      { id: 'business', conclusion: '海外收入同比增长32%，占比继续提升。', sourceRef: ['E1'] },
      { id: 'anomalies', conclusion: '经营质量有所波动，需持续观察。', sourceRef: ['E1'] },
      { id: 'anomalies', conclusion: '没有证据的条目应被丢掉。', sourceRef: ['E99'] },
      { id: 'unknown', conclusion: '非法模块。', sourceRef: ['E1'] },
      { id: 'business', conclusion: '重复模块应被丢掉。', sourceRef: ['E2'] },
      { id: 'peers', conclusion: 'ROE第2/5家，非全行业排名。', sourceRef: ['E2'] },
    ],
  };
  const parsed = parseReportVerdict(raw, evidence);
  assert.ok(parsed);
  assert.equal(parsed!.modules.length, 2);
  assert.equal(parsed!.modules[0].id, 'business');
  assert.equal(parsed!.modules[0].sourceRef[0].page, 12);
  assert.equal(parsed!.modules[1].id, 'peers');
});

test('accepts API payloads that include hydrated module citations', () => {
  const parsed = acceptVerdictPayload({
    verdict: { label: '表现平稳', summary: '经营节奏平稳。' },
    changes: [],
    modules: [{
      id: 'attribution',
      conclusion: '收入贡献 +2.1亿，净利率贡献 -1.4亿。',
      sourceRef: [{ id: 'E1', reportId: 'r1', page: 12, quote: '收入', companyName: '示例', period: '2025FY' }],
    }],
  });
  assert.equal(parsed?.modules[0].id, 'attribution');
  assert.equal(parsed?.modules[0].sourceRef[0].page, 12);
});

test('targeted follow-ups prefer changes then fill from modules', () => {
  assert.deepEqual(targetedFollowups(
    [{ title: '主营业务增长' }],
    [{ id: 'anomalies' }, { id: 'peers' }],
  ), [
    '主营业务增长的主要原因是什么？',
    '本期哪些指标波动最大？原因是什么？',
    '和已覆盖同行比，我们处在什么位置？',
  ]);
});

test('stored verdict JSON round-trips without calling the model', () => {
  const stored = acceptVerdictPayload({
    verdict: { label: '增收不增利', summary: '收入微增但扣非利润下降。' },
    changes: [{
      type: '盈利', direction: '利空', title: '扣非净利下降', description: '扣非归母净利润同比下降25.31%。',
      sourceRef: [{ id: 'E1', reportId: 'r1', page: 7, quote: '同比下降25.31%', companyName: '示例', period: '2026H1', code: '000333' }],
    }],
    modules: [{
      id: 'business',
      conclusion: '海外收入同比增长32%。',
      sourceRef: [{ id: 'E2', reportId: 'r1', page: 12, quote: '海外收入同比增长32%', companyName: '示例', period: '2026H1' }],
    }],
  });
  assert.ok(stored);
  const again = acceptVerdictPayload(JSON.parse(JSON.stringify(stored)));
  assert.equal(again?.verdict.label, '增收不增利');
  assert.equal(again?.changes[0].sourceRef[0].page, 7);
  assert.equal(again?.modules[0].conclusion, '海外收入同比增长32%。');
});
