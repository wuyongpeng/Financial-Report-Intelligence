import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCoreMetricPages } from '../lib/parser';

test('extracts and scales the four core metrics from a summary page', () => {
  const metrics = parseCoreMetricPages([
    '公司2026年半年度报告摘要 主要会计数据 单位：人民币万元 营业收入 1,234,567.89 上年同期 1,100,000 归属于上市公司股东的净利润 123,456.78 基本每股收益 2.35 加权平均净资产收益率 18.42%',
  ]);
  assert.equal(metrics.find((item) => item.metric === 'revenue')?.value, 12_345_678_900);
  assert.equal(metrics.find((item) => item.metric === 'net_profit')?.value, 1_234_567_800);
  assert.equal(metrics.find((item) => item.metric === 'eps')?.value, 2.35);
  assert.equal(metrics.find((item) => item.metric === 'roe')?.value, 18.42);
});

test('prefers the summary value over a conflicting note value and lowers confidence', () => {
  const metrics = parseCoreMetricPages([
    '财务报表附注 单位：元 营业收入 88888888',
    '报告摘要 主要财务指标 单位：元 营业收入 99999999',
  ]);
  const revenue = metrics.find((item) => item.metric === 'revenue');
  assert.equal(revenue?.value, 99_999_999);
  assert.ok((revenue?.confidence ?? 1) < 0.9);
});

test('rejects implausible EPS values instead of publishing a likely page or year number', () => {
  const metrics = parseCoreMetricPages(['主要会计数据 基本每股收益 2026']);
  assert.equal(metrics.some((item) => item.metric === 'eps'), false);
});

test('handles bank-specific labels, footnotes and RMB million units', () => {
  const metrics = parseCoreMetricPages([
    '本集团主要会计数据和财务指标（人民币百万元，特别注明除外）营业收入 178,181 169,969 归属于本行股东的净利润 76,445 74,930 归属于本行普通股股东的基本每股收益 (1) 2.98 2.89 归属于本行普通股股东的加权平均净资产收益率 (1) 13.42 13.85 扣除非经常性损益后加权平均净资产收益率 13.40',
  ]);
  assert.equal(metrics.find((item) => item.metric === 'revenue')?.value, 178_181_000_000);
  assert.equal(metrics.find((item) => item.metric === 'net_profit')?.value, 76_445_000_000);
  assert.equal(metrics.find((item) => item.metric === 'eps')?.value, 2.98);
  assert.equal(metrics.find((item) => item.metric === 'roe')?.value, 13.42);
});
