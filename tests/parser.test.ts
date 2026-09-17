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
