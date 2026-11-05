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

test('Xinyisheng-style restated prior: prefer 调整后 and keep disclosed YoY%', () => {
  // 新易盛 2025Q3 主要会计数据：上年同期下分「调整前」「调整后」，同比按调整后。
  // Bug: first prior column ate YoY (归母净利丢 205.38%)；EPS/ROE 取了调整前 (1.1 / 12.45)。
  const metrics = parseCoreMetricPages([
    '主要会计数据和财务指标 公司是否需追溯调整或重述以前年度会计数据 是 本报告期 上年同期 本报告期比上年同期增减 年初至报告期末 上年同期 年初至报告期末比上年同期增减 调整前 调整后 调整后 调整前 调整后 调整后 '
    + '营业收入（元） 6,067,620,945.86 2,402,761,037.13 2,402,761,037.13 152.53% 16,504,791,211.36 5,130,435,808.52 5,130,435,808.52 221.70% '
    + '归属于上市公司股东的净利润（元） 2,384,798,239.47 780,930,777.06 780,930,777.06 205.38% 6,327,092,507.84 1,646,072,871.21 1,646,072,871.21 284.37% '
    + '归属于上市公司股东的扣除非经常性损益的净利润（元） 2,367,461,846.13 779,361,105.73 779,361,105.73 203.77% 6,301,361,138.70 1,644,089,751.00 1,644,089,751.00 283.27% '
    + '基本每股收益（元/股） 2.4 1.1 0.79 203.80% 6.37 2.33 1.66 283.73% '
    + '加权平均净资产收益率 20.81% 12.45% 6.81% 14.00% 55.20% 26.29% 14.36% 40.84%',
  ]);
  const revenue = metrics.find((item) => item.metric === 'revenue');
  assert.equal(revenue?.value, 6_067_620_945.86);
  assert.equal(revenue?.priorValue, 2_402_761_037.13);
  assert.equal(revenue?.yoyPct, 152.53);

  const profit = metrics.find((item) => item.metric === 'net_profit');
  assert.equal(profit?.value, 2_384_798_239.47);
  assert.equal(profit?.priorValue, 780_930_777.06);
  assert.equal(profit?.yoyPct, 205.38);

  const eps = metrics.find((item) => item.metric === 'eps');
  assert.equal(eps?.value, 2.4);
  assert.equal(eps?.priorValue, 0.79);
  assert.equal(eps?.yoyPct, 203.80);

  const roe = metrics.find((item) => item.metric === 'roe');
  assert.equal(roe?.value, 20.81);
  assert.equal(roe?.priorValue, 6.81);
  assert.equal(roe?.yoyPct, undefined);
});

test('Shaanxi Coal restated prior: bare YoY% without % sign prefers 调整后; ROE dual before ppThenYtd', () => {
  // 陕西煤业 2025Q3：上年同期分调整前/后，增减列常无 %；ROE 5.72|5.60|5.25|0.48。
  // Bug: dualPrior 要 % 号→金额/EPS 吃调整前；ppThenYtd 把 5.60|5.25 当增减|YTD→ROE 无 prior。
  const metrics = parseCoreMetricPages([
    '主要会计数据和财务指标 单位：万元 币种：人民币 项目 本报告期 上年同期 本报告期比上年同期增减变动幅度(%) 年初至报告期末 上年同期 年初至报告期末比上年同期增减变动幅度(%) 调整前 调整后 调整后 调整前 调整后 调整后 '
    + '营业收入 4,010,041.08 3,455,176.54 5,070,045.48 -20.91 11,808,310.93 12,542,720.08 13,543,717.80 -12.81 '
    + '归属于上市公司股东的净利润 507,454.60 484,454.78 691,272.05 -26.59 1,271,300.40 1,594,315.68 1,746,862.34 -27.22 '
    + '基本每股收益（元/股） 0.52 0.55 0.71 -26.77 1.31 1.64 1.80 -27.22 '
    + '加权平均净资产收益（%） 5.72 5.60 5.25 0.48 13.74 16.92 16.57 减少 2.82 个百分点',
  ]);
  const revenue = metrics.find((item) => item.metric === 'revenue');
  assert.equal(revenue?.value, 40_100_410_800);
  assert.equal(revenue?.priorValue, 50_700_454_800);
  assert.equal(revenue?.yoyPct, -20.91);

  const profit = metrics.find((item) => item.metric === 'net_profit');
  assert.equal(profit?.value, 5_074_546_000);
  assert.equal(profit?.priorValue, 6_912_720_500);
  assert.equal(profit?.yoyPct, -26.59);

  const eps = metrics.find((item) => item.metric === 'eps');
  assert.equal(eps?.value, 0.52);
  assert.equal(eps?.priorValue, 0.71);
  assert.equal(eps?.yoyPct, -26.77);

  const roe = metrics.find((item) => item.metric === 'roe');
  assert.equal(roe?.value, 5.72);
  assert.equal(roe?.priorValue, 5.25);
  assert.equal(roe?.yoyPct, undefined);
});

test('Maotai-style Q3 row: bare YoY% then YTD must not become amount prior', () => {
  // 贵州茅台三季报：本报告期 | 比上年同期增减变动幅度(%) | 年初至报告期末 | …
  // Cells often omit the % sign on the YoY column (3.78 not 3.78%).
  // Bug: 3.78 was stored as prior_value → UI computed 同比 +527792210484%.
  const metrics = parseCoreMetricPages([
    '主要会计数据 项目 本报告期 本报告期比上年同期增减变动幅度(%) 年初至报告期末 年初至报告期末比上年同期增减变动幅度(%) 营业收入 40,267,482,684.56 3.08 130,970,743,649.04 1.96 归属于上市公司股东的净利润 19,950,545,560.09 3.78 64,467,425,981.95 -0.25 基本每股收益（元/股） 15.96 3.78 51.53 -0.25 加权平均净资产收益率（%） 7.64 0.12 个百分点',
  ]);
  const revenue = metrics.find((item) => item.metric === 'revenue');
  assert.equal(revenue?.value, 40_267_482_684.56);
  assert.equal(revenue?.yoyPct, 3.08);
  assert.equal(revenue?.priorValue, undefined);

  const profit = metrics.find((item) => item.metric === 'net_profit');
  assert.equal(profit?.value, 19_950_545_560.09);
  assert.equal(profit?.yoyPct, 3.78);
  assert.equal(profit?.priorValue, undefined);

  const eps = metrics.find((item) => item.metric === 'eps');
  assert.equal(eps?.value, 15.96);
  assert.equal(eps?.yoyPct, 3.78);
  assert.equal(eps?.priorValue, undefined);
});

test('Maotai 2025Q3 EPS: bare 0.77 YoY% must not become prior (1893% bug)', () => {
  // Live PDF.js line from 贵州茅台 2025 年第三季度报告 p2.
  // Bug: prior_value=0.77 + yoy null → UI (15.35-0.77)/0.77 = +1893.51%.
  const metrics = parseCoreMetricPages([
    '主要会计数据 量净额 基本每股收益（元/股） 15.35 0.77 51.53 6.43 稀释每股收益（元/股） 15.35 0.77 51.53 6.43 加权平均净资产收益率（%） 7.75 减少 0.64 个百分点 24.64',
  ]);
  const eps = metrics.find((item) => item.metric === 'eps');
  assert.equal(eps?.value, 15.35);
  assert.equal(eps?.yoyPct, 0.77);
  assert.equal(eps?.priorValue, undefined);
});

test('agreeing EPS hits: keep yoyPct, do not borrow bare-YoY prior from sibling hit', () => {
  // Summary hit has disclosed YoY; a scrambled sibling may store the same bare % as prior.
  const metrics = parseCoreMetricPages([
    '主要会计数据 基本每股收益（元/股） 15.35 0.77 51.53 6.43',
    '基本每股收益（元/股） 15.35 0.77',
  ]);
  const eps = metrics.find((item) => item.metric === 'eps');
  assert.equal(eps?.value, 15.35);
  assert.equal(eps?.yoyPct, 0.77);
  assert.equal(eps?.priorValue, undefined);
});

test('CATL-style row: current then YoY% (no prior amount) must not split 58.58%', () => {
  // 宁德时代季报摘要：本报告期 | 本报告期比上年同期增减 | 年初至报告期末 | …
  // Bug: regex backtracked "58.58%" into prior=58.5 (+千元→58500≈0亿) and yoy=8%.
  const metrics = parseCoreMetricPages([
    '主要会计数据 项目 本报告期 本报告期比上年同期增减 年初至报告期末 年初至报告期末比上年同期增减 营业收入（千元） 165,220,844 58.58% 442,137,424 56.19% 归属于上市公司股东的净利润（千元） 12,345,678 20.50% 30,000,000 15.00% 基本每股收益（元/股） 1.23 8.00% 3.21 10.00% 加权平均净资产收益率 5.60% 1.20 个百分点 12.30% 0.80 个百分点',
  ]);
  const revenue = metrics.find((item) => item.metric === 'revenue');
  assert.equal(revenue?.value, 165_220_844_000);
  assert.equal(revenue?.yoyPct, 58.58);
  assert.equal(revenue?.priorValue, undefined);

  const profit = metrics.find((item) => item.metric === 'net_profit');
  assert.equal(profit?.value, 12_345_678_000);
  assert.equal(profit?.yoyPct, 20.5);
  assert.equal(profit?.priorValue, undefined);

  const eps = metrics.find((item) => item.metric === 'eps');
  assert.equal(eps?.value, 1.23);
  assert.equal(eps?.yoyPct, 8);
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

test('bank wording: 扣除非经常性损益后归属于本行股东的净利润 is profit_ex, not non_recurring/net_profit alias', () => {
  // 平安银行式：单位百万元；短标签「非经常性损益」/「归属于本行股东的净利润」都是扣非后行的子串。
  const metrics = parseCoreMetricPages([
    '报告摘要 主要会计数据 单位：人民币百万元 归属于本行股东的净利润 13,500 扣除非经常性损益后归属于本行股东的净利润 13,491 同比增 1.1%',
  ]);
  assert.equal(metrics.some((item) => item.metric === 'non_recurring_pnl'), false);
  assert.equal(metrics.find((item) => item.metric === 'net_profit')?.value, 13_500_000_000);
  const ex = metrics.find((item) => item.metric === 'profit_ex_non_recurring');
  assert.equal(ex?.value, 13_491_000_000);
  assert.match(ex?.sourceLabel ?? '', /本行/);
});

test('does not take calendar year as amount after 扣非后本行净利润 label', () => {
  const metrics = parseCoreMetricPages([
    '主要会计数据（人民币百万元）扣除非经常性损益后归属于本行股东的净利润 2026 年 7-9 月 13,491 同比增 1.1%',
  ]);
  assert.equal(metrics.some((item) => item.metric === 'non_recurring_pnl'), false);
  // net_profit must not bind the embedded「归属于本行股东的净利润」to year 2026.
  assert.equal(metrics.some((item) => item.metric === 'net_profit' && item.value === 2_026_000_000), false);
  assert.equal(metrics.find((item) => item.metric === 'profit_ex_non_recurring')?.value, 13_491_000_000);
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


test('Ping An / CMB Q3: 本期|同比%|YTD keeps disclosed YoY, not percent-as-prior', () => {
  const metrics = parseCoreMetricPages([
    '（货币单位：人民币百万元）项 目 2026 年 7-9 月 同比增减 2026 年 1-9 月 同比增减 营业收入 32,483 3.8% 103,100 2.4% 归属于本行股东的净利润 13,490 0.2% 39,186 2.2% 基本/稀释每股收益（元/股） 0.70 1.4% 1.94 3.7% 加权平均净资产收益率（未年化） 2.85% -0.18 个百分点 8.07% -0.21 个百分点',
  ]);
  const revenue = metrics.find((item) => item.metric === 'revenue');
  assert.equal(revenue?.value, 32_483_000_000);
  assert.equal(revenue?.yoyPct, 3.8);
  assert.equal(revenue?.priorValue, undefined);

  const profit = metrics.find((item) => item.metric === 'net_profit');
  assert.equal(profit?.value, 13_490_000_000);
  assert.equal(profit?.yoyPct, 0.2);
  assert.equal(profit?.priorValue, undefined);

  const roe = metrics.find((item) => item.metric === 'roe');
  assert.equal(roe?.value, 2.85);
  assert.equal(roe?.priorValue, undefined);
});

test('Baosteel Q3 bare signed YoY% then YTD is not scaled prior', () => {
  const metrics = parseCoreMetricPages([
    '主要会计数据 单位：人民币百万元 营业收入 84,916 4.75 245,648 5.68 归属于上市公司股东的净利润 2,167 -29.67 6,739 -15.33 基本每股收益（元/股） 0.10 -28.57 0.31 -16.22',
  ]);
  const revenue = metrics.find((item) => item.metric === 'revenue');
  assert.equal(revenue?.yoyPct, 4.75);
  assert.equal(revenue?.priorValue, undefined);

  const profit = metrics.find((item) => item.metric === 'net_profit');
  assert.equal(profit?.value, 2_167_000_000);
  assert.equal(profit?.yoyPct, -29.67);
  assert.equal(profit?.priorValue, undefined);

  const eps = metrics.find((item) => item.metric === 'eps');
  assert.equal(eps?.value, 0.1);
  assert.equal(eps?.yoyPct, -28.57);
  assert.equal(eps?.priorValue, undefined);
});

test('Shaanxi coal EPS: bare YoY then YTD EPS, not prior=15.13', () => {
  const metrics = parseCoreMetricPages([
    '主要会计数据 单位：人民币万元 营业收入 4,387,179.48 9.40 12,276,630.88 3.97 归属于上市公司股东的净利润 579,262.21 14.15 1,706,504.42 34.23 基本每股收益（元/股） 0.60 15.13 1.76 34.23',
  ]);
  const eps = metrics.find((item) => item.metric === 'eps');
  assert.equal(eps?.value, 0.6);
  assert.equal(eps?.yoyPct, 15.13);
  assert.equal(eps?.priorValue, undefined);

  const revenue = metrics.find((item) => item.metric === 'revenue');
  assert.equal(revenue?.yoyPct, 9.4);
});


test('CMB Q3 EPS: bare YoY then YTD EPS (1.59 3.25 4.57)', () => {
  const metrics = parseCoreMetricPages([
    '主要会计数据 归属于本行普通股股东的基本每股收益（人民币元） 1.59 3.25 4.57 3.16',
  ]);
  const eps = metrics.find((item) => item.metric === 'eps');
  assert.equal(eps?.value, 1.59);
  assert.equal(eps?.yoyPct, 3.25);
  assert.equal(eps?.priorValue, undefined);
});

test('Shaanxi coal ROE: pp-change then YTD is not prior=0.07', () => {
  const metrics = parseCoreMetricPages([
    '主要会计数据 加权平均净资产收益率（%） 5.80 0.07 16.70 2.95',
  ]);
  const roe = metrics.find((item) => item.metric === 'roe');
  assert.equal(roe?.value, 5.8);
  assert.equal(roe?.priorValue, undefined);
});

test('fullwidth percent ％ is treated as YoY token', () => {
  const metrics = parseCoreMetricPages([
    '主要会计数据 单位：人民币百万元 营业收入 32,483 3.8％ 103,100 2.4％',
  ]);
  const revenue = metrics.find((item) => item.metric === 'revenue');
  assert.equal(revenue?.yoyPct, 3.8);
  assert.equal(revenue?.priorValue, undefined);
});

test('Muxi-style ROE: label unit （%） with bare period number, not later YoY %', () => {
  // 沐曦股份 688802 2026H1: 加权平均净资产收益率（%）4.53，后文营收同比 44.67% 不得误抽。
  const metrics = parseCoreMetricPages([
    [
      '主要财务指标 本报告期（1－6月） 上年同期 本报告期比上年同期增减(%)',
      '加权平均净资产收益率（%） 4.53 -2.62 增加7.15个百分点',
      '扣除非经常性损益后的加权平均净资产收益率（%） 4.40 -2.80 增加7.20个百分点',
      // Misleading YoY % inside the 220-char window after the ROE label (old bug picked 44.67).
      '同比增长 44.67% 说明详见附注',
    ].join(' '),
  ]);
  const roe = metrics.find((item) => item.metric === 'roe');
  assert.equal(roe?.value, 4.53);
  assert.equal(roe?.priorValue, -2.62);
  assert.equal(roe?.sourceLabel, '加权平均净资产收益率');
});

test('ROE with explicit trailing % still prefers the period percent token', () => {
  const metrics = parseCoreMetricPages([
    '报告摘要 主要财务指标 加权平均净资产收益率 12.08% 10.50%',
  ]);
  assert.equal(metrics.find((item) => item.metric === 'roe')?.value, 12.08);
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


test('stitches PDF line-broken amounts (Inspur-style wrap)', () => {
  // 浪潮 000977: "40,476,58\\n5,676.17" and "683,401,8\\n93.00"
  const page = [
    '主要会计数据',
    '营业收入',
    '（元）',
    '40,476,58',
    '5,676.17',
    '41,062,20',
    '7,706.33 -1.55%',
    '归属于上市公司股东的净利润',
    '（元）',
    '683,401,8',
    '93.00',
    '697,255,6',
    '48.40 -1.34%',
    '基本每股收益（元/股） 0.46',
    '加权平均净资产收益率 3.25%',
  ].join('\n');
  const metrics = parseCoreMetricPages([page]);
  assert.equal(metrics.find((item) => item.metric === 'revenue')?.value, 40_476_585_676.17);
  assert.equal(metrics.find((item) => item.metric === 'net_profit')?.value, 683_401_893);
});

test('stitches amount when next line starts with a thousands comma', () => {
  const page = [
    '主要会计数据 单位：元',
    '营业收入',
    '25,936,555,',
    '155.04',
    '28,644,269,964.50 -9.76%',
    '归属于上市公司股东的净利润 1,781,199,495.31',
    '基本每股收益 0.45',
    '加权平均净资产收益率 4.10%',
  ].join('\n');
  const metrics = parseCoreMetricPages([page]);
  assert.equal(metrics.find((item) => item.metric === 'revenue')?.value, 25_936_555_155.04);
});

test('BOC-style 单位：百万元人民币 is not overridden by （人民币元）', () => {
  const metrics = parseCoreMetricPages([
    [
      '主要会计数据 单位：百万元人民币（另有说明者除外）',
      '营业收入 169,462 4.48 526,365 7.16',
      '归属于母公司所有者的净利润 63,888 6.36 187,482 5.53',
      '基本和稀释每股收益（人民币元） 0.19 3.98 0.55 0.27',
      '加权平均净资产收益率（%，年化） 8.90 上升 0.18 个百分点',
    ].join(' '),
  ]);
  assert.equal(metrics.find((item) => item.metric === 'revenue')?.value, 169_462_000_000);
  assert.equal(metrics.find((item) => item.metric === 'net_profit')?.value, 63_888_000_000);
  assert.equal(metrics.find((item) => item.metric === 'eps')?.value, 0.19);
  assert.equal(metrics.find((item) => item.metric === 'roe')?.value, 8.9);
});

test('CCB-style 基本和稀释每股收益 alias', () => {
  const metrics = parseCoreMetricPages([
    '主要会计数据 单位：人民币百万元 营业收入 202,410 12.81% 归属于本行股东的净利润 104,662 9.84% 基本和稀释每股收益（人民币元） 0.38 8.57% 年化加权平均净资产收益率(%) 11.18',
  ]);
  assert.equal(metrics.find((item) => item.metric === 'eps')?.value, 0.38);
  assert.equal(metrics.find((item) => item.metric === 'net_profit')?.value, 104_662_000_000);
});

test('ZTE-style 归属于上市公司普通股股东的净利润', () => {
  const metrics = parseCoreMetricPages([
    '主要会计数据 单位：人民币千元 营业收入 62,487,098 归属于上市公司普通股股东的净利润 5,057,571 基本每股收益 1.06 加权平均净资产收益率 6.85%',
  ]);
  assert.equal(metrics.find((item) => item.metric === 'net_profit')?.value, 5_057_571_000);
});

test('Vanke-style 净资产收益率（加权平均）', () => {
  const metrics = parseCoreMetricPages([
    '主要财务指标 基本每股收益 (1.0075) 净资产收益率（全面摊薄） -6.24% 净资产收益率（加权平均） -6.07% -4.00% 下降 2.16 个百分点',
  ]);
  assert.equal(metrics.find((item) => item.metric === 'roe')?.value, -6.07);
});

test('Shaanxi Coal-style 加权平均净资产收益（%） without 率', () => {
  const metrics = parseCoreMetricPages([
    '主要财务指标 加权平均净资产收益（%） 5.72 5.60 5.25 0.48 13.74 16.92 16.57 减少 2.82 个百分点',
  ]);
  assert.equal(metrics.find((item) => item.metric === 'roe')?.value, 5.72);
});


test('CCB 2026H1 财务摘要: 基本和稀释每股收益 footnote + dash YoY', () => {
  // 建设银行 601939 2026H1 P7：脚注「2」、变动列「-」、小节名是「财务摘要」而非「报告摘要」。
  const page = [
    '1 财务摘要',
    '（除特别注明外，以人民币百万元列示）截至2026年6月30日止六个月 截至2025年6月30日止六个月 变化(%) 截至2024年6月30日止六个月',
    '营业收入 436,529 394,273 10.72 385,965',
    '归属于本行股东的净利润 169,564 162,076 4.62 164,326',
    '每股计（人民币元）',
    '基本和稀释每股收益 2 0.65 0.65 - 0.66',
    '扣除非经常性损益后的基本和稀释每股收益 1 0.64 0.65 (1.54) 0.66',
    '年化加权平均净资产收益率 2 9.52 10.08 (0.56) 10.82',
  ].join(' ');
  const metrics = parseCoreMetricPages([page]);
  const eps = metrics.find((item) => item.metric === 'eps');
  assert.equal(eps?.value, 0.65);
  assert.equal(eps?.sourceLabel, '基本和稀释每股收益');
  assert.equal(eps?.priorValue, 0.65);
  const roe = metrics.find((item) => item.metric === 'roe');
  assert.equal(roe?.value, 9.52);
});


test('BOC EPS three-year columns 0.36|0.36|0.36 keep prior not yoy%', () => {
  const metrics = parseCoreMetricPages([
    '财务摘要 单位：百万元人民币 基本每股收益（元） 0.36 0.36 0.36 净资产收益率（%） 5 8.66 9.11 9.58',
  ]);
  const eps = metrics.find((item) => item.metric === 'eps');
  assert.equal(eps?.value, 0.36);
  assert.equal(eps?.priorValue, 0.36);
  assert.equal(eps?.yoyPct, undefined);
});

test('bank P&L 上年同期|变动额|变动比率% does not take 变动额 as restated prior', () => {
  const metrics = parseCoreMetricPages([
    '利润表主要项目 单位：百万元人民币 营业收入 356,903 329,003 27,900 8.48% 归属于母公司所有者的净利润 123,594 117,591 6,003 5.10%',
  ]);
  const revenue = metrics.find((item) => item.metric === 'revenue');
  assert.equal(revenue?.value, 356903000000);
  assert.equal(revenue?.priorValue, 329003000000);
  assert.ok(revenue?.yoyPct != null && Math.abs(revenue.yoyPct - 8.48) < 0.01);
});

test('BOC 2026H1 财务摘要: 净资产收益率（%） takes 2026年1-6月 column', () => {
  // 中国银行 601988 2026H1 P6：无「加权平均」字样；注释列「5」后是本期 8.66，不是上年 9.11。
  const page = [
    '财务摘要 单位：百万元人民币',
    '注释 2026年1-6月 2025年1-6月 2024年1-6月',
    '营业收入 356,903 329,003 317,076',
    '归属于母公司所有者的净利润 123,594 117,591 118,601',
    '基本每股收益（元） 0.36 0.36 0.36',
    '主要财务比率',
    '平均总资产回报率（%） 4 0.67 0.70 0.76',
    '净资产收益率（%） 5 8.66 9.11 9.58',
    '净息差（%） 6 1.27 1.26 1.44',
  ].join(' ');
  const metrics = parseCoreMetricPages([page]);
  const roe = metrics.find((item) => item.metric === 'roe');
  assert.equal(roe?.value, 8.66);
  assert.equal(roe?.priorValue, 9.11);
  assert.equal(roe?.sourceLabel, '净资产收益率');
  assert.equal(metrics.find((item) => item.metric === 'eps')?.value, 0.36);
});

test('bare 净资产收益率 skips 全面摊薄 row', () => {
  const metrics = parseCoreMetricPages([
    '主要财务指标 基本每股收益 (1.0075) 净资产收益率（全面摊薄） -6.24% 净资产收益率（加权平均） -6.07% -4.00% 下降 2.16 个百分点',
  ]);
  assert.equal(metrics.find((item) => item.metric === 'roe')?.value, -6.07);
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
