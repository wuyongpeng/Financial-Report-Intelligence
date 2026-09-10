import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const base = process.env.APP_TEST_URL ?? 'http://127.0.0.1:3000';
const login = await fetch(`${base}/api/auth/login`, { method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ username:process.env.APP_USERNAME,password:process.env.APP_PASSWORD }) });
assert.equal(login.status,200,'Login must succeed');
const cookie=login.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie,'Session cookie must be set');
const headers={cookie,'content-type':'application/json'};
async function json(path) { const r=await fetch(base+path,{headers});assert.equal(r.status,200,path);return r.json(); }
assert.equal((await json('/api/auth/session')).authenticated,true);
console.log('PASS login and session');
const { reports } = await json('/api/reports?limit=100');
assert.ok(reports.length,'Report list must contain real records');
const ready=reports.filter(r=>['revenue','net_profit','eps','roe'].every(name=>r.metrics.some(m=>m.metric===name)));
assert.ok(ready.length>=4,'At least four reports must be usable');
console.log(`PASS report list: ${reports.length} reports, ${ready.length} complete`);
const truths=JSON.parse(await readFile(new URL('../data/metric-ground-truth.json',import.meta.url),'utf8'));
for(const truth of truths) {
 const report=reports.find(r=>r.id===truth.announcementId);assert.ok(report,truth.companyName);
 const outline=await json(`/api/reports/${encodeURIComponent(report.id)}/outline`);
 for(const [name,expected] of Object.entries(truth.metrics)) {
  const m=report.metrics.find(m=>m.metric===name);assert.ok(m,`${name} exists`);
  assert.ok(Math.abs(m.value-expected)<=Math.max(.0001,Math.abs(expected)*.000001),`${truth.companyName} ${name} must match source truth`);
  assert.equal(m.source_page,truth.sourcePage);
  assert.ok(outline.pages.some(p=>p.page===m.source_page&&p.content.replace(/\s/g,'').includes(m.source_label.replace(/\s/g,''))),`${name} source text must exist`);
 }
 const pdf=await fetch(`${base}/api/reports/${encodeURIComponent(report.id)}/pdf`,{headers});
 assert.equal(pdf.status,200);assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,4).toString(),'%PDF');
 assert.ok((await json(`/api/reports/${encodeURIComponent(report.id)}/analysis`)).period);
 const history=await json(`/api/reports?code=${report.code}&limit=100`);
 assert.ok(history.reports.filter(r=>['revenue','net_profit','eps','roe'].every(name=>r.metrics.some(m=>m.metric===name))).length>=2,'Company has multiple parsed periods');
 const answer=await fetch(`${base}/api/chat`,{method:'POST',headers,body:JSON.stringify({reportId:report.id,question:'营业收入是多少？',stream:true})});
 assert.equal(answer.status,200);const events=await answer.text();assert.ok(events.includes('[DONE]'));assert.ok(events.includes('evidence'));assert.ok(events.includes('90703260964.48')||report.code!=='600519','Revenue answer must use parsed amount');
 const scope=await fetch(`${base}/api/chat`,{method:'POST',headers,body:JSON.stringify({reportId:report.id,question:'2099年的营业收入是多少？'})});
 assert.match((await scope.json()).answer,/暂无法回答/);
 console.log(`PASS ${truth.companyName}: four source-verified metrics, PDF, outline, analysis, history, streaming Q&A, out-of-scope refusal`);
}
const anonymous=await fetch(`${base}/api/reports`);assert.equal(anonymous.status,401);
console.log('PASS unauthenticated data access denied');
