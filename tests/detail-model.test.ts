import { test } from 'node:test';
import assert from 'node:assert/strict';
import { change, comparableHistory, keyFindings, moduleForQuestion, priorYear, profitBridge, sourceRange, type Report } from '../lib/detail-model';
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
