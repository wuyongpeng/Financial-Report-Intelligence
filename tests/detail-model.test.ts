import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anomaliesConclusion, attributionConclusion, change, comparableHistory, sequentialHistory, historyConclusion, keyFindings, moduleForQuestion, peersConclusion, period, periodConclusion, priorYear, profitBridge, sourceRange, type Report } from '../lib/detail-model';
import { rankEvidence, unsupportedYears } from '../lib/chat-evidence';
function report(id: string, period: string, value: number, type='annual', published='2026-04-01'): Report { return { id, code:'1',company_name:'测试',title:period,report_type:type,published_at:published,parsed_at:published,industry:'测试',status:'online',metrics:[{metric:'revenue',value,unit:'元',source_page:2,source_label:'营业收入',confidence:1,verified:1,period}] }; }
test('history excludes later periods and other fiscal durations, deduplicates corrected filings',()=>{
 const current=report('current','2025FY',10); const old=report('old','2024FY',10);
 assert.deepEqual(comparableHistory([current,old,report('future','2026FY',20),report('half','2025H1',5,'semiannual')],current).map(r=>r.id),['old','current']);
 assert.equal(priorYear([old,current],current)?.id,'old');
 assert.equal(change(10,10),0); assert.equal(change(10,0),undefined); assert.equal(change(-5,-10),50);
 const q=report('q','2025Q3',3,'quarterly');
 assert.deepEqual(comparableHistory([q,report('q1','2025Q1',1,'quarterly')],q).map(r=>r.id),['q']);
 const corrected=report('corrected','2024FY',11,'annual','2026-05-01');
 assert.equal(comparableHistory([old,corrected,current],current)[0].id,'corrected');
});
test('YoY history prefers the complete A-share filing over an H-share stub',()=>{
 const ashare=report('a','2026Q1',10,'quarterly','2026-04-30');
 ashare.title='工商银行2026年第一季度报告';
 ashare.status='review';
 ashare.metrics.push({metric:'net_profit',value:1,unit:'元',source_page:1,source_label:'净利润',confidence:1,verified:1,period:'2026Q1'});
 const hshare=report('h','2026Q1',99,'quarterly','2026-04-30');
 hshare.title='工商银行H股公告-2026年第一季度报告';
 hshare.status='parse_partial';
 const prior=report('p','2025Q1',8,'quarterly','2025-04-30');
 prior.title='工商银行2025年第一季度报告';
 assert.equal(comparableHistory([hshare,ashare,prior],ashare).map(r=>r.id).join(','),'p,a');
 assert.equal(priorYear([hshare,ashare,prior],ashare)?.id,'p');
});
test('sequential history plots Q1/H1/Q3/FY in time order up to the selected period',()=>{
 const q1=report('q1','2025Q1',1,'quarterly','2025-04-01');
 const h1=report('h1','2025H1',5,'semiannual','2025-08-01');
 const q3=report('q3','2025Q3',8,'quarterly','2025-10-01');
 const fy=report('fy','2025FY',12,'annual','2026-04-01');
 const h126=report('h126','2026H1',6,'semiannual','2026-08-01');
 assert.deepEqual(sequentialHistory([q1,h1,q3,fy,h126],h126).map(r=>r.id),['q1','h1','q3','fy','h126']);
 assert.deepEqual(comparableHistory([q1,h1,q3,fy,h126],h126).map(r=>r.id),['h1','h126']);
});
test('period prefers 一季度 title over stale FY metric', () => {
  const r = report('q1', '2026FY', 1, 'quarterly', '2026-04-29');
  r.title = '美的集团2026年一季度报告';
  r.metrics[0].period = '2026FY';
  assert.equal(period(r), '2026Q1');
});
test('profit bridge reconciles positive and loss periods without fabricated allocation',()=>{
 for(const [r,p,pr,pp] of [[120,8,100,10],[80,-4,100,-10],[100,0,100,5]]) {
  const b=profitBridge(r,p,pr,pp)!; assert.ok(Math.abs(b.revenueEffect+b.marginEffect-(p-pp))<1e-8);
 }
 assert.equal(profitBridge(0,5,10,1),null);
});
test('questions route to the existing dashboard modules',()=>{
 assert.equal(moduleForQuestion('净利润下降的主要原因是什么？'),'attribution');
 assert.equal(moduleForQuestion('和同行比处于什么水位？'),'peers');
 assert.equal(moduleForQuestion('主营业务收入如何构成？'),'business');
 assert.equal(moduleForQuestion('营业收入是多少？'),null);
});
test('Chinese retrieval matches natural questions and honors explicit page queries',()=>{
 const pages=[{page:2,content:'公司营业收入为100元，净利润有所下降。'},{page:3,content:'经营情况：利润变动原因是费用增加。'},{page:8,content:'董事会名单。'}];
 assert.equal(rankEvidence('营业收入是多少？',pages)[0].page,2);
 assert.equal(rankEvidence('请解释第8页的核心信息。',pages)[0].page,8);
 assert.deepEqual(rankEvidence('第100页',pages),[]);
 assert.deepEqual(unsupportedYears('2020和2025年收入是多少','2025FY'),['2020']);
});

test('source ranges retain actual text coordinates across PDF line breaks',()=>{
 const text='前文 加权平均净资产 收益率 13.42'; const range=sourceRange(text,'加权平均净资产收益率');
 assert.ok(range); assert.equal(text.slice(...range),'加权平均净资产 收益率');
 assert.equal(sourceRange(text,'不存在的字段'),null);
});

test('key findings rank flagged moves first and never invent a comparison', () => {
  const metric = (name: string, value: number, page = 6) => ({ metric: name as never, value, unit: '元', source_page: page, source_label: name, confidence: 0.9, verified: 0, period: '' });
  const build = (period: string, revenue: number, profit: number, extra: ReturnType<typeof metric>[] = []) => ({
    id: period, code: '600000', company_name: '示例', title: period, report_type: 'annual', published_at: `${period.slice(0,4)}-04-01`,
    parsed_at: '2026-01-01', industry: '银行', status: 'online',
    metrics: [{ ...metric('revenue', revenue), period }, { ...metric('net_profit', profit), period }, ...extra.map(m => ({ ...m, period }))],
  });
  const previous = build('2025FY', 1e10, 1e9);
  const current = build('2026FY', 1.05e10, 4e8, [metric('total_assets', 1e11), metric('total_liabilities', 9e10)]);
  const findings = keyFindings([previous, current], current);
  assert.ok(findings.length > 0 && findings.length <= 3);
  assert.equal(findings[0].severity, 'watch');
  assert.ok(findings.some((f) => f.headline.includes('归母净利润同比')));
  assert.ok(findings.some((f) => f.headline.includes('资产负债率')));
  // Without a prior period there is nothing comparable to report.
  assert.deepEqual(keyFindings([current], current).filter((f) => f.headline.includes('同比')), []);
});

test('YoY headline uses two decimal places (Maotai-like revenue)', () => {
  const metric = (name: string, value: number) => ({ metric: name as never, value, unit: '元', source_page: 6, source_label: name, confidence: 0.9, verified: 0, period: '' });
  const build = (id: string, period: string, revenue: number) => ({
    id, code: '600519', company_name: '贵州茅台', title: period, report_type: 'annual', published_at: `${period.slice(0, 4)}-04-01`,
    parsed_at: '2026-01-01', industry: '白酒', status: 'online',
    metrics: [{ ...metric('revenue', revenue), period }],
  });
  const previous = build('prev', '2024FY', 89389354416.84);
  const current = build('curr', '2025FY', 90703260964.48);
  assert.ok(Math.abs(change(90703260964.48, 89389354416.84)! - 1.469) < 0.01);
  const findings = keyFindings([previous, current], current);
  const rev = findings.find((f) => f.metric === 'revenue');
  assert.ok(rev);
  assert.ok(rev!.headline.includes('1.47'), `expected 1.47 in ${rev!.headline}`);
  assert.ok(!rev!.headline.includes('+1.5%'));
});

test('period conclusion stays within 50 characters', () => {
  const metric = (name: string, value: number) => ({ metric: name as never, value, unit: '元', source_page: 6, source_label: name, confidence: 0.9, verified: 0, period: '' });
  const build = (id: string, period: string, revenue: number, profit: number) => ({
    id, code: '600000', company_name: '示例', title: period, report_type: 'annual', published_at: `${period.slice(0, 4)}-04-01`,
    parsed_at: '2026-01-01', industry: '银行', status: 'online',
    metrics: [{ ...metric('revenue', revenue), period }, { ...metric('net_profit', profit), period }],
  });
  const previous = build('prev', '2025FY', 1e10, 1e9);
  const current = build('curr', '2026FY', 1.05e10, 4e8);
  const text = periodConclusion([previous, current], current);
  assert.ok([...text].length <= 50);
  assert.ok(text.includes('归母净利润') || text.includes('营收'));
});

test('module conclusions stay number-backed and omit empty claims', () => {
  const metric = (name: string, value: number) => ({ metric: name as never, value, unit: '元', source_page: 6, source_label: name, confidence: 0.9, verified: 0, period: '' });
  const build = (id: string, period: string, revenue: number, profit: number) => ({
    id, code: '600000', company_name: '示例', title: period, report_type: 'annual', published_at: `${period.slice(0, 4)}-04-01`,
    parsed_at: '2026-01-01', industry: '银行', status: 'online',
    metrics: [{ ...metric('revenue', revenue), period }, { ...metric('net_profit', profit), period }],
  });
  const previous = build('prev', '2025FY', 1e10, 1e9);
  const current = build('curr', '2026FY', 1.2e10, 8e8);
  const bridge = profitBridge(1.2e10, 8e8, 1e10, 1e9)!;
  assert.match(attributionConclusion(bridge), /归母净利同比减少.*收入贡献/);
  assert.match(anomaliesConclusion([{ metric: 'net_profit', amount: -20 }], 4), /归母净利润同比 -20.00%/);
  assert.equal(anomaliesConclusion([], 4), '核心指标同比波动均未超过 30%');
  assert.equal(anomaliesConclusion([], 0), '');
  assert.match(historyConclusion([previous, current]), /近2期营收/);
  assert.equal(historyConclusion([current]), '');
  assert.match(peersConclusion([{ rank: 2, total: 5, label: 'ROE' }]), /ROE第 2\/5 家/);
  assert.equal(peersConclusion([{ rank: 1, total: 1, label: 'ROE' }]), '');
});
