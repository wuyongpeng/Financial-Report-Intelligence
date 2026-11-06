import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAuditOpinionPages } from '../lib/audit-opinion';
import { parseCoreMetricPages, parseAuditOpinionFromPages } from '../lib/parser';

test('standard unqualified from 重要提示', () => {
  const hit = parseAuditOpinionPages([
    '重要提示 立信会计师事务所（特殊普通合伙）为本公司出具了标准无保留意见的审计报告。',
    '财务报表附注 …',
  ]);
  assert.equal(hit.kind, 'standard');
  assert.equal(hit.type, 'unqualified');
  assert.match(hit.label, /标准无保留/);
  assert.equal(hit.page, 1);
});

test('qualified opinion is non_standard', () => {
  const hit = parseAuditOpinionPages([
    '审计报告 我们出具保留意见。形成保留意见的基础如下。',
  ]);
  assert.equal(hit.kind, 'non_standard');
  assert.equal(hit.type, 'qualified');
  assert.equal(hit.label, '保留意见');
});

test('emphasis-of-matter unqualified is non_standard', () => {
  const hit = parseAuditOpinionPages([
    '审计意见 我们出具了带强调事项段的无保留意见。',
  ]);
  assert.equal(hit.kind, 'non_standard');
  assert.equal(hit.type, 'unqualified_emphasis');
});

test('adverse and disclaimer', () => {
  assert.equal(parseAuditOpinionPages(['审计报告 否定意见']).type, 'adverse');
  assert.equal(parseAuditOpinionPages(['审计报告 无法表示意见']).type, 'disclaimer');
  assert.equal(parseAuditOpinionPages(['审计报告 无法表示意见']).kind, 'non_standard');
});

test('quarterly pages without opinion → none (no fake green)', () => {
  const hit = parseAuditOpinionPages([
    '公司2025年第三季度报告 主要会计数据 营业收入 100 净利润 10',
  ]);
  assert.equal(hit.kind, 'none');
  assert.equal(hit.type, null);
  assert.match(hit.label, /未见/);
  assert.equal(hit.page, null);
});

test('prior-year chatter loses to current 重要提示', () => {
  const hit = parseAuditOpinionPages([
    '上年审计意见为保留意见。',
    '重要提示 本期会计师事务所出具了标准无保留意见的审计报告。',
  ]);
  assert.equal(hit.kind, 'standard');
  assert.equal(hit.type, 'unqualified');
});

test('non-standard 无保留 prefix does not count as clean standard', () => {
  const hit = parseAuditOpinionPages([
    '重要提示 公司被出具非标准无保留意见。',
  ]);
  assert.equal(hit.kind, 'non_standard');
});

test('parser export still extracts metrics alongside opinion helper', () => {
  const pages = [
    '重要提示 出具了标准无保留意见的审计报告。主要会计数据 单位：元 营业收入 1,000,000 归属于上市公司股东的净利润 100,000 基本每股收益 0.10 加权平均净资产收益率 5.00%',
  ];
  const metrics = parseCoreMetricPages(pages);
  assert.ok(metrics.find((m) => m.metric === 'revenue'));
  const opinion = parseAuditOpinionFromPages(pages);
  assert.equal(opinion.kind, 'standard');
});


test('标准的无保留意见 is clean, including formal report wording beside generic templates', () => {
  const result = parseAuditOpinionPages([
    '审计报告：我们认为公司财务报表公允反映财务状况，出具标准的无保留意见。',
    '非无保留意见审计报告的说明：不适用。',
  ]);
  assert.equal(result.kind, 'standard');
  assert.equal(result.type, 'unqualified');
});
