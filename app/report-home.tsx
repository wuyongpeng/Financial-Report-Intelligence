'use client';
import { useState } from 'react';
import { change, format, period, periodKey, priorYear, value, type Report } from '@/lib/detail-model';
import companies from '@/data/companies.json';
import { hasCoreMetrics } from '@/lib/metric-quality';
import './report-home.css';

type HomeReport = Report & { rank: number };
function periodLabel(report: Report) {
  return period(report).replace('FY', ' 年报').replace('H1', ' 中报').replace('Q1', ' 一季报').replace('Q3', '三季报');
}
function deltaLabel(n: number | undefined) { return n === undefined ? '暂无同期比较' : `同比 ${n >= 0 ? '+' : ''}${n.toFixed(1)}%`; }

export default function ReportHome<T extends HomeReport>({ reports, loading, error, onOpen }: { reports: T[]; loading: boolean; error: string; onOpen: (report: T) => void }) {
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(8);
  const latest = new Map<string, T>();
  for (const report of [...reports].filter(r => hasCoreMetrics(r.metrics)).sort((a,b) => periodKey(b)-periodKey(a) || b.published_at.localeCompare(a.published_at))) {
    if (!latest.has(report.code)) latest.set(report.code, report);
  }
  const available = [...latest.values()].sort((a,b) => a.rank-b.rank);
  const keyword = search.trim().toLowerCase();
  const matches = available.filter(r => `${r.company_name} ${r.code} ${r.industry}`.toLowerCase().includes(keyword));
  const pending = keyword ? companies.filter(c => !latest.has(c.code) && `${c.name} ${c.code} ${c.industry}`.toLowerCase().includes(keyword)) : [];
  const recommendations = available.slice(0, 2);
  return <section className="rh-home">
    <header className="rh-intro"><h1>你想了解哪家公司？</h1><p>先看经营表现，再带着问题读财报。</p></header>
    <form className="rh-search" role="search" onSubmit={e => { e.preventDefault(); document.getElementById('rh-companies')?.scrollIntoView({behavior:'smooth',block:'start'}); }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>
      <input aria-label="搜索公司、股票代码或行业" placeholder="搜索公司、股票代码或行业" value={search} onChange={e => {setSearch(e.target.value);setLimit(8);}}/>
      {search && <button className="rh-clear" type="button" aria-label="清空搜索" onClick={()=>setSearch('')}>×</button>}
      <button className="rh-search-submit" type="submit">查找财报 <span aria-hidden="true">→</span></button>
    </form>
    {error && <div className="rh-error" role="alert">财报暂时无法加载，请稍后刷新重试。</div>}
    {!keyword && recommendations.length > 0 && <section className="rh-recommendations" aria-labelledby="rh-rec-title">
      <div className="rh-section-heading"><h2 id="rh-rec-title">从这两份财报开始</h2><span>最新报告 · 快速了解</span></div>
      <div className="rh-card-grid">{recommendations.map(report => {
        const previous = priorYear(reports.filter(r=>r.code===report.code), report);
        return <button key={report.id} className="rh-company-card" onClick={()=>onOpen(report)} aria-label={`阅读${report.company_name}${periodLabel(report)}`}>
          <div className="rh-card-top"><span className="rh-monogram">{report.company_name.slice(0,1)}</span><div><h3>{report.company_name}</h3><p>{report.code}<span>·</span>{report.industry}</p></div><span className="rh-period">{periodLabel(report)}</span></div>
          <div className="rh-card-metrics">{(['revenue','net_profit'] as const).map(metric => {
            const delta=change(value(report,metric),value(previous,metric));
            return <div key={metric}><span>{metric==='revenue'?'营业收入':'归母净利润'}</span><strong>{format(value(report,metric),metric)}</strong><small className={delta===undefined?'':delta<0?'rh-down':'rh-up'}>{deltaLabel(delta)}</small></div>;
          })}</div>
          <div className="rh-card-bottom"><span>趋势、同业对比与原文</span><b>阅读财报 <span aria-hidden="true">↗</span></b></div>
        </button>;
      })}</div>
    </section>}
    <section className="rh-companies" id="rh-companies" aria-labelledby="rh-list-title">
      <div className="rh-section-heading"><h2 id="rh-list-title">{keyword?'搜索结果':'找一家你关心的公司'}</h2><span aria-live="polite">{loading?'正在加载…':`${matches.length} 家可阅读`}</span></div>
      <div className="rh-company-list">
        {matches.slice(0,limit).map(report => <button className="rh-company-row" key={report.code} onClick={()=>onOpen(report)} aria-label={`查看${report.company_name}最新财报`}>
          <span className="rh-row-monogram">{report.company_name.slice(0,1)}</span><div className="rh-row-name"><h3>{report.company_name}</h3><p>{report.code}<span>·</span>{report.industry}</p></div><span className="rh-row-period">{periodLabel(report)}</span><span className="rh-row-action">查看财报 <span aria-hidden="true">→</span></span>
        </button>)}
        {pending.slice(0,8).map(company=><div className="rh-company-row rh-pending" key={company.code}><span className="rh-row-monogram">{company.name.slice(0,1)}</span><div className="rh-row-name"><h3>{company.name}</h3><p>{company.code}<span>·</span>{company.industry}</p></div><span className="rh-row-period">财报准备中</span></div>)}
        {loading && !available.length && <div className="rh-empty" role="status">正在加载可阅读的财报…</div>}
        {!loading && !matches.length && !pending.length && <div className="rh-empty"><b>{keyword?'没有找到这家公司':'财报正在准备中'}</b><p>{keyword?'试试公司简称或六位股票代码。':'报告准备好后会出现在这里。'}</p>{keyword&&<button onClick={()=>setSearch('')}>查看可阅读的公司</button>}</div>}
      </div>
      {matches.length>limit && <button className="rh-more" onClick={()=>setLimit(n=>n+8)}>查看更多公司 ↓</button>}
    </section>
    <footer className="rh-footnote">数据来自公开财报，关键数字可定位原文。内容仅供研究参考。</footer>
  </section>;
}
