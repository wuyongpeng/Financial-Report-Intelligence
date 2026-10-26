import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCoreMetricPages, PDFJS_PARSE_MAX_BYTES, parseCoreMetrics, shouldExtractTextExternally } from '../lib/parser';

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


test('strips bare EPS footnote without parentheses before the real value', () => {
  const metrics = parseCoreMetricPages([
    '公司2026年半年度报告摘要 主要会计数据 单位：人民币千元 营业总收入 78,025,359 归属于上市公司股东的净利润 2,753,412 基本每股收益（元/股）1 0.58 加权平均净资产收益率 3.65%',
  ]);
  assert.equal(metrics.find((item) => item.metric === 'eps')?.value, 0.58);
});

test('keeps a lone integer EPS when no following numeric token exists', () => {
  const metrics = parseCoreMetricPages([
    '主要会计数据 单位：元 基本每股收益（元/股）2 加权平均净资产收益率 10%',
  ]);
  assert.equal(metrics.find((item) => item.metric === 'eps')?.value, 2);
});

test('scales 千元 summary pages and ignores EPS/ROE footnote markers', () => {
  const metrics = parseCoreMetricPages([
    '公司2026年半年度报告摘要 主要会计数据 单位：人民币千元 营业总收入 78,025,359 归属于上市公司股东的净利润 2,753,412 基本每股收益（元/股）(1) 0.58 0.75 加权平均净资产收益率 (1) 3.65% 4.12%',
  ]);
  assert.equal(metrics.find((item) => item.metric === 'revenue')?.value, 78025359000);
  assert.equal(metrics.find((item) => item.metric === 'net_profit')?.value, 2753412000);
  assert.equal(metrics.find((item) => item.metric === 'eps')?.value, 0.58);
  assert.equal(metrics.find((item) => item.metric === 'roe')?.value, 3.65);
});


test('Midea-style unit inside metric key scales 千元 to 元 without page unit', () => {
  // 美的集团等：单位写进指标名，表头不一定再写「单位：千元」。
  const metrics = parseCoreMetricPages([
    '主要会计数据 营业收入（千元） 260,042,490 250,000,000 4.02% 归属于上市公司股东的净利润（千元） 20,123,456 基本每股收益（元/股） 2.35 加权平均净资产收益率 12.50%',
  ]);
  assert.equal(metrics.find((item) => item.metric === 'revenue')?.value, 260_042_490_000);
  assert.equal(metrics.find((item) => item.metric === 'revenue')?.priorValue, 250_000_000_000);
  assert.equal(metrics.find((item) => item.metric === 'net_profit')?.value, 20_123_456_000);
  assert.equal(metrics.find((item) => item.metric === 'eps')?.value, 2.35);
  assert.equal(metrics.find((item) => item.metric === 'roe')?.value, 12.5);
});

test('metric-name unit wins over conflicting table unit and still skips EPS/ROE scale', () => {
  const metrics = parseCoreMetricPages([
    '主要会计数据 单位：人民币元 营业收入（千元） 260,042,490 归属于上市公司股东的净利润（万元） 1,234.5 基本每股收益 2.35 加权平均净资产收益率 12.50%',
  ]);
  assert.equal(metrics.find((item) => item.metric === 'revenue')?.value, 260_042_490_000);
  assert.equal(metrics.find((item) => item.metric === 'net_profit')?.value, 12_345_000);
  assert.equal(metrics.find((item) => item.metric === 'eps')?.value, 2.35);
  assert.equal(metrics.find((item) => item.metric === 'roe')?.value, 12.5);
});

test('detects 千元 inside parenthetical unit notes like bank pages', () => {
  const metrics = parseCoreMetricPages([
    '主要会计数据（人民币千元，特别注明除外）营业总收入 10,000 归属于上市公司股东的净利润 500 基本每股收益 0.12 加权平均净资产收益率 2.50%',
  ]);
  assert.equal(metrics.find((item) => item.metric === 'revenue')?.value, 10000000);
  assert.equal(metrics.find((item) => item.metric === 'net_profit')?.value, 500000);
  assert.equal(metrics.find((item) => item.metric === 'eps')?.value, 0.12);
  assert.equal(metrics.find((item) => item.metric === 'roe')?.value, 2.5);
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

test('extracts balance sheet, cash flow and cost rows with statement-aware scoring', () => {
  const metrics = parseCoreMetricPages([
    '合并资产负债表 单位：人民币百万元 资产总计 4,200,000 负债合计 3,600,000',
    '合并现金流量表 单位：人民币百万元 经营活动产生的现金流量净额 -12,500',
    '合并利润表 单位：人民币百万元 营业收入 178,181 营业总成本 120,000 营业成本 110,000',
  ]);
  assert.equal(metrics.find((item) => item.metric === 'total_assets')?.value, 4_200_000_000_000);
  assert.equal(metrics.find((item) => item.metric === 'total_liabilities')?.value, 3_600_000_000_000);
  assert.equal(metrics.find((item) => item.metric === 'operating_cash_flow')?.value, -12_500_000_000);
  assert.equal(metrics.find((item) => item.metric === 'operating_cost')?.value, 110_000_000_000);
});

test('parenthesized currency amounts do not skip to the prior-period column', () => {
  const metrics = parseCoreMetricPages(['合并现金流量表 单位：元 经营活动产生的现金流量净额 (500000) 1000000']);
  assert.equal(metrics.find(m => m.metric === 'operating_cash_flow')?.value, -500000);
  assert.equal(parseCoreMetricPages(['合并利润表 单位：元 营业总成本 80000']).some(m => m.metric === 'operating_cost'), false);
});


test('captures disclosed prior and YoY from 主要会计数据 three-column rows', () => {
  const metrics = parseCoreMetricPages([
    '经营业绩 2026 年 1-6 月 2025 年 1-6 月 同比增减 单位：人民币千元 营业收入 78,025,359 71,552,734 9.05% 归属于上市公司股东的净利润 2,752,825 5,057,571 (45.57%) 经营活动产生的现金流量净额 (126,600) 1,299,408 (109.74%)',
  ]);
  const revenue = metrics.find((item) => item.metric === 'revenue');
  assert.equal(revenue?.value, 78_025_359_000);
  assert.equal(revenue?.priorValue, 71_552_734_000);
  assert.equal(revenue?.yoyPct, 9.05);

  const profit = metrics.find((item) => item.metric === 'net_profit');
  assert.equal(profit?.value, 2_752_825_000);
  assert.equal(profit?.priorValue, 5_057_571_000);
  assert.equal(profit?.yoyPct, -45.57);

  const cash = metrics.find((item) => item.metric === 'operating_cash_flow');
  assert.equal(cash?.value, -126_600_000);
  assert.equal(cash?.priorValue, 1_299_408_000);
  assert.equal(cash?.yoyPct, -109.74);
});

test('does not scale disclosed YoY percent by page 千元 unit', () => {
  const metrics = parseCoreMetricPages([
    '主要会计数据 单位：人民币千元 营业收入 10,000 8,000 (20.00%)',
  ]);
  const revenue = metrics.find((item) => item.metric === 'revenue');
  assert.equal(revenue?.value, 10_000_000);
  assert.equal(revenue?.priorValue, 8_000_000);
  assert.equal(revenue?.yoyPct, -20);
});




test('does not label 扣除非经常性损益后…净利润 as 非经常性损益 (alias collision)', () => {
  // User-facing bug: 重点关注 showed「非经常性损益 1,464.49 亿元，占归母净利润 100.0%」
  // because short label「非经常性损益」matched inside「扣除非经常性损益后归属于母公司股东的净利润 146,449」.
  const metrics = parseCoreMetricPages([
    '报告摘要 主要会计数据 单位：人民币百万元 归属于母公司股东的净利润 146,500 扣除非经常性损益后归属于母公司股东的净利润 146,449 基本每股收益 1.20 加权平均净资产收益率 10.00%',
  ]);
  assert.equal(metrics.some((item) => item.metric === 'non_recurring_pnl'), false);
  const ex = metrics.find((item) => item.metric === 'profit_ex_non_recurring');
  assert.equal(ex?.value, 146_449_000_000); // 146,449 百万元 → 元
  assert.match(ex?.sourceLabel ?? '', /扣除非经常性损益后归属于母公司股东的净利润/);
  assert.equal(metrics.find((item) => item.metric === 'net_profit')?.value, 146_500_000_000);
});

test('maps 扣非后归母净利润 under 万元 without inventing non_recurring_pnl', () => {
  const metrics = parseCoreMetricPages([
    '主要会计数据 单位：人民币万元 归属于母公司股东的净利润 150,000 扣除非经常性损益后归属于母公司股东的净利润 146,449',
  ]);
  assert.equal(metrics.some((item) => item.metric === 'non_recurring_pnl'), false);
  const ex = metrics.find((item) => item.metric === 'profit_ex_non_recurring');
  assert.equal(ex?.value, 1_464_490_000); // 146,449 万元 → 14.6449 亿元
  assert.equal(ex?.sourceLabel, '扣除非经常性损益后归属于母公司股东的净利润');
});

test('still extracts explicit 非经常性损益合计 beside 扣非后净利润', () => {
  const metrics = parseCoreMetricPages([
    '报告摘要 主要会计数据 单位：人民币万元 归属于母公司股东的净利润 150,000 扣除非经常性损益后归属于母公司股东的净利润 146,449 非经常性损益合计 3,551',
  ]);
  assert.equal(metrics.find((item) => item.metric === 'non_recurring_pnl')?.value, 35_510_000);
  assert.equal(metrics.find((item) => item.metric === 'profit_ex_non_recurring')?.value, 1_464_490_000);
});

test('ZTE 2026H1 summary keeps 千元 scale and disclosed YoY for 归母净利润', () => {
  // Layout-normalized excerpt from 中兴通讯 000063 二〇二六年半年度报告 §1.2.3
  // (单位：千元, three columns 本期 | 上年同期 | 同比增减).
  const metrics = parseCoreMetricPages([
    [
      '1.2.3 本集团主要会计数据和财务指标',
      '单位：千元',
      '项目',
      '经营业绩 2026 年 1-6 月 2025 年 1-6 月 同比增减',
      '营业收入 78,025,359 71,552,734 9.05%',
      '归属于上市公司股东的净利润 2,752,825 5,057,571 (45.57%)',
      '归属于上市公司股东的扣除非经常性损益的净利润 2,220,797 4,103,900 (45.89%)',
      '经营活动产生的现金流量净额 (126,600) 1,299,408 (109.74%)',
      '基本每股收益注 1 0.58 1.06 (45.28%)',
      '加权平均净资产收益率注 1 3.65% 6.85%',
    ].join(' '),
  ]);
  const profit = metrics.find((item) => item.metric === 'net_profit');
  assert.equal(profit?.value, 2_752_825_000);
  assert.equal(profit?.priorValue, 5_057_571_000);
  assert.equal(profit?.yoyPct, -45.57);

  const revenue = metrics.find((item) => item.metric === 'revenue');
  assert.equal(revenue?.value, 78_025_359_000);
  assert.equal(revenue?.priorValue, 71_552_734_000);
  assert.equal(revenue?.yoyPct, 9.05);

  assert.equal(metrics.find((item) => item.metric === 'eps')?.value, 0.58);
  assert.equal(metrics.find((item) => item.metric === 'roe')?.value, 3.65);
});

test('keeps disclosed YoY when a later statement row repeats the same amount without YoY columns', () => {
  const metrics = parseCoreMetricPages([
    '报告摘要 主要会计数据 单位：人民币千元 归属于上市公司股东的净利润 2,752,825 5,057,571 (45.57%)',
    '合并利润表 单位：人民币千元 归属于母公司股东的净利润 2,752,825 5,617,745',
  ]);
  const profit = metrics.find((item) => item.metric === 'net_profit');
  assert.equal(profit?.value, 2_752_825_000);
  assert.equal(profit?.yoyPct, -45.57);
  assert.equal(profit?.priorValue, 5_057_571_000);
});

test('large PDFs skip in-memory pdf.js and use external text extract', async () => {
  assert.equal(shouldExtractTextExternally(PDFJS_PARSE_MAX_BYTES), false);
  assert.equal(shouldExtractTextExternally(PDFJS_PARSE_MAX_BYTES + 1), true);

  const { execFileSync } = await import('node:child_process');
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
  } catch {
    return;
  }

  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'fri-pdf-'));
  const filePath = join(dir, 'sample.pdf');
  await writeFile(filePath, minimalTextPdf());
  try {
    const extracted = await parseCoreMetrics(null, { filePath });
    assert.ok(Array.isArray(extracted.metrics));
    assert.ok(Array.isArray(extracted.chunks));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function minimalTextPdf() {
  const stream = 'BT /F1 12 Tf 50 700 Td (Hello) Tj ET';
  const body = [
    '1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj',
    '2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj',
    '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj',
    `4 0 obj<< /Length ${stream.length} >>stream\n${stream}\nendstream endobj`,
    '5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj',
  ].join('\n');
  return Buffer.from(`%PDF-1.1\n${body}\ntrailer<< /Root 1 0 R >>\n%%EOF\n`);
}
