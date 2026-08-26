'use client';

import { useState } from 'react';
import companiesJson from '@/data/companies.json';
import seedReportsJson from '@/data/seed-reports.json';

type View = 'lane' | 'report';
type ReportFilter = 'all' | 'online' | 'pending';
type Evidence = { title: string; value: string; calc: string; inference: string; quote: string; page: string };
type OfficialReport = { id: string; source: string; code: string; company_name: string; title: string; published_at: string; discovered_at: string; pdf_url: string; industry: string; rank: number };

const coverageCompanies = companiesJson;
const officialReports = seedReportsJson as OfficialReport[];
const snapshotAt = officialReports[0]?.discovered_at ? new Date(officialReports[0].discovered_at).toLocaleString('zh-CN', { hour12: false }) : '等待首次回填';

function dateTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

const reports = [
  { name: '比亚迪', code: '002594', exchange: '深交所', logo: '比', color: 'red', report: '2025 年半年度报告', publish: '20:03', found: '20:05', parsed: '20:09', online: '20:11', elapsed: '8 分钟', tag: '利润增速放缓', severity: 'warn', status: '已上线', revenue: '3,712.81 亿', profit: '155.11 亿', eps: '5.32 元', roe: '11.8%' },
  { name: '宁德时代', code: '300750', exchange: '深交所', logo: '宁', color: 'navy', report: '2025 年半年度报告', publish: '19:42', found: '19:44', parsed: '19:49', online: '19:51', elapsed: '9 分钟', tag: '现金流改善', severity: 'good', status: '已上线', revenue: '1,789.04 亿', profit: '304.85 亿', eps: '6.94 元', roe: '13.7%' },
  { name: '贵州茅台', code: '600519', exchange: '上交所', logo: '茅', color: 'blue', report: '2025 年半年度报告', publish: '18:31', found: '18:33', parsed: '18:38', online: '18:40', elapsed: '9 分钟', tag: '直销增速回落', severity: 'warn', status: '已上线', revenue: '910.94 亿', profit: '454.03 亿', eps: '36.16 元', roe: '21.4%' },
  { name: '美的集团', code: '000333', exchange: '深交所', logo: '美', color: 'cyan', report: '2025 年半年度报告', publish: '17:56', found: '17:58', parsed: '18:03', online: '18:05', elapsed: '9 分钟', tag: '海外收入提速', severity: 'good', status: '已上线', revenue: '2,527.83 亿', profit: '260.14 亿', eps: '3.46 元', roe: '14.2%' },
  { name: '招商银行', code: '600036', exchange: '上交所', logo: '招', color: 'gold', report: '2025 年半年度报告', publish: '17:20', found: '17:22', parsed: '17:28', online: '17:30', elapsed: '10 分钟', tag: '净息差承压', severity: 'risk', status: '已上线', revenue: '1,691.80 亿', profit: '749.30 亿', eps: '2.93 元', roe: '8.1%' },
];

const quarterData = [
  { q: '23Q3', rev: 43, profit: 51 }, { q: '23Q4', rev: 48, profit: 54 },
  { q: '24Q1', rev: 55, profit: 61 }, { q: '24Q2', rev: 62, profit: 67 },
  { q: '24Q3', rev: 68, profit: 65 }, { q: '24Q4', rev: 76, profit: 72 },
  { q: '25Q1', rev: 84, profit: 75 }, { q: '25Q2', rev: 94, profit: 78 },
];

const alerts: Evidence[] = [
  { title: '利润增速低于营收', value: '营收 +23.3%，净利润 +13.8%', calc: '营收同比 = (3,712.81 - 3,010.27) / 3,010.27 = 23.3%；净利润同比 = 13.8%。两者增速差为 9.5pct。', inference: '主要影响线索为汽车业务毛利率下降 1.8pct，以及销售费用同比增长 31.4%。', quote: '受行业竞争加剧、产品结构变化等因素影响，公司汽车业务毛利率有所下降。', page: '第 28 页 · 经营情况讨论与分析' },
  { title: '经营现金流背离', value: '净利润增长，现金流同比 -18.6%', calc: '经营活动现金流净额 318.6 亿，上年同期 391.4 亿，同比下降 18.6%，与净利润变动方向相反。', inference: '应收与存货占用增加是主要线索，需要结合旺季备货和经销结算节奏继续验证。', quote: '经营活动产生的现金流量净额变动主要系购买商品、接受劳务支付的现金增加。', page: '第 17 页 · 主要会计数据' },
  { title: '毛利率连续回落', value: '连续 3 个季度下降，累计 -2.4pct', calc: '汽车业务毛利率由 24Q4 的 22.3%下降至 25Q2 的 19.9%，已连续三个季度回落。', inference: '价格竞争与中低价车型占比上升可能共同影响毛利率，属于需持续跟踪的盈利质量信号。', quote: '公司坚持技术创新和规模化降本，同时积极应对市场竞争和原材料价格波动。', page: '第 31 页 · 分行业经营情况' },
];

const promptAnswers: Record<string, string> = {
  '为什么净利润增速低于营收？': '结构化数据计算显示，净利润增速比营收低 9.5pct。结合原文，主要线索是汽车业务毛利率下降 1.8pct、销售费用同比增长 31.4%。管理层将毛利率变化归因于行业竞争加剧与产品结构变化。',
  '与三家同行相比表现如何？': '已对比吉利汽车、长城汽车和上汽集团。示例结果显示：比亚迪营收增速位于 4 家公司第 1 名，净利率位于第 2 名，但毛利率同比变化位于第 3 名。',
  '画出近八季度营收和利润趋势': '已生成近 8 个季度趋势。营收保持上行，但利润增速从 24Q4 开始趋缓，25Q2 的“增收不增利”信号最明显。',
};

export default function Home() {
  const [view, setView] = useState<View>('lane');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedOfficial, setSelectedOfficial] = useState<OfficialReport>(() => officialReports.find((item) => item.code === reports[0].code) ?? officialReports[0]);
  const [reportFilter, setReportFilter] = useState<ReportFilter>('all');
  const [activeTab, setActiveTab] = useState('一分钟看懂');
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<{ role: 'user' | 'ai'; text: string; compare?: boolean }[]>([]);
  const matchedDemoIndex = reports.findIndex((item) => item.code === selectedOfficial?.code);
  const hasDemoAnalysis = matchedDemoIndex >= 0;
  const baseReport = reports[hasDemoAnalysis ? matchedDemoIndex : selectedIndex];
  const selectedCompany = coverageCompanies.find((item) => item.code === selectedOfficial?.code);
  const report = selectedOfficial ? {
    ...baseReport,
    name: selectedOfficial.company_name,
    code: selectedOfficial.code,
    exchange: selectedCompany?.exchange === 'SSE' ? '上交所' : '深交所',
    report: selectedOfficial.title,
    publish: dateTime(selectedOfficial.published_at),
    revenue: hasDemoAnalysis ? baseReport.revenue : '--',
    profit: hasDemoAnalysis ? baseReport.profit : '--',
    eps: hasDemoAnalysis ? baseReport.eps : '--',
    roe: hasDemoAnalysis ? baseReport.roe : '--',
  } : baseReport;
  const filteredOfficialReports = officialReports.filter((item) => {
    const online = reports.some((demo) => demo.code === item.code);
    return reportFilter === 'all' || (reportFilter === 'online' ? online : !online);
  }).slice(0, 8);

  function openReport(index: number) {
    setSelectedIndex(index);
    setSelectedOfficial(officialReports.find((item) => item.code === reports[index].code) ?? officialReports[0]);
    setMessages([]);
    setView('report');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openOfficialReport(item: OfficialReport) {
    const demoIndex = reports.findIndex((reportItem) => reportItem.code === item.code);
    setSelectedIndex(demoIndex >= 0 ? demoIndex : 0);
    setSelectedOfficial(item);
    setMessages([]);
    setView('report');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function ask(text: string) {
    const clean = text.trim();
    if (!clean) return;
    const answer = promptAnswers[clean] ?? `已自动拆解问题：先查询${report.name}的结构化指标，再检索财报原文。Demo 中已定位到“经营情况讨论与分析”，正式版会返回精确计算、行业口径和原文页码。`;
    setMessages((items) => [...items, { role: 'user', text: clean }, { role: 'ai', text: answer, compare: clean.includes('同行') || clean.includes('趋势') }]);
    setQuestion('');
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand plain-button" onClick={() => setView('lane')}><span className="brand-mark">财</span><strong>财报智析台</strong><span className="beta">BETA</span></button>
        <nav className="main-nav"><button className={view === 'lane' ? 'active' : ''} onClick={() => setView('lane')}>财报绿色通道</button><button className={view === 'report' ? 'active' : ''} onClick={() => setView('report')}>研究工作台</button><button>数据复核</button></nav>
        <div className="top-actions"><button className="status-pill"><i />交易所 + 巨潮三源已配置</button><button className="profile">研</button></div>
      </header>

      {view === 'lane' ? (
        <section className="lane-page">
          <div className="lane-hero">
            <div className="hero-copy"><div className="kicker"><span>LIVE</span> 财报季绿色通道</div><h1>新财报发布后，<em>10 分钟内发现</em></h1><p>绕过拥堵的数据接收通路，直接从上交所、深交所发现公告，巨潮资讯交叉兜底；只处理新增公告，已抓取记录自动跳过。</p><div className="hero-actions"><button className="primary" onClick={() => openReport(0)}>体验完整分析 <span>→</span></button><button className="secondary" onClick={() => document.getElementById('latest-reports')?.scrollIntoView({ behavior: 'smooth' })}>查看 50 家真实公告</button></div></div>
            <div className="hero-proof"><div className="proof-head"><span>线上采集策略</span><b>交易所主源 · 巨潮兜底</b></div><ol className="timechain"><li className="complete"><i>✓</i><div><b>*/10 分钟</b><span>Cron 定时触发</span></div></li><li className="complete"><i>✓</i><div><b>SSE + SZSE</b><span>交易所批量轮询</span></div></li><li className="complete"><i>✓</i><div><b>CNINFO</b><span>巨潮交叉兜底</span></div></li><li className="live"><i>✓</i><div><b>增量去重</b><span>已抓取自动跳过</span></div></li></ol><div className="proof-result"><span>绿色通道覆盖</span><strong>50 家</strong><small>已回填 50 份真实最新财报</small></div></div>
          </div>

          <div className="lane-stats">
            <article><span>真实公告回填</span><strong>50 <small>份</small></strong><em>50 家全部命中官方财报</em></article>
            <article><span>公告发现频率</span><strong>10 <small>分钟</small></strong><em className="positive">增量自动轮询</em></article>
            <article><span>回填覆盖率</span><strong>100<small>%</small></strong><em>公开渠道实测 50 / 50</em></article>
            <article><span>绿色通道覆盖</span><strong>50 <small>家</small></strong><em>按关注度与代表性排序</em></article>
          </div>

          <div className="lane-grid" id="latest-reports">
            <section className="latest-card">
              <div className="section-head"><div><span className="section-kicker">LATEST REPORTS</span><h2>最新财报</h2><p>点击整行进入详情；PDF 原文使用独立入口</p></div><div className="filters"><button className={reportFilter === 'all' ? 'active' : ''} onClick={() => setReportFilter('all')}>全部</button><button className={reportFilter === 'online' ? 'active' : ''} onClick={() => setReportFilter('online')}>已上线</button><button className={reportFilter === 'pending' ? 'active' : ''} onClick={() => setReportFilter('pending')}>待解析</button></div></div>
              <div className="report-table">
                <div className="report-row table-head"><span>公司 / 报告</span><span>官方发布</span><span>发现来源</span><span>快照状态</span><span>原文</span><span>结构化</span><span /></div>
                {filteredOfficialReports.map((item, index) => { const online = reports.some((demo) => demo.code === item.code); return <div className="report-row" role="button" tabIndex={0} key={item.id} onClick={() => openOfficialReport(item)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') openOfficialReport(item); }}><span className="report-company"><i className={`company-logo ${['blue','navy','red','cyan','gold'][index % 5]}`}>{item.company_name.slice(0, 1)}</i><span><b>{item.company_name} <small>{item.code}</small></b><em>{item.title}</em></span></span><span className="time-cell"><b>{dateTime(item.published_at)}</b><small>官方公告时间</small></span><span className="time-cell"><b>{item.source}</b><small>巨潮快照</small></span><span className="time-cell"><b>已回填</b><small>{item.industry}</small></span><span className="time-cell online"><button className="pdf-link" aria-label={`打开${item.company_name}财报 PDF`} onClick={(event) => { event.stopPropagation(); window.open(item.pdf_url, '_blank', 'noopener,noreferrer'); }}>PDF ↗</button><small>官方原文</small></span><span><em className={`signal ${online ? 'good' : 'warn'}`}>{online ? '已上线' : '待解析'}</em></span><span className="row-arrow">›</span></div>; })}
                {filteredOfficialReports.length === 0 && <div className="empty-reports">当前筛选下暂无财报</div>}
              </div>
              <div className="table-note"><span><i />官方快照 · 回填于 {snapshotAt}</span><button onClick={() => document.getElementById('coverage-50')?.scrollIntoView({ behavior: 'smooth' })}>查看全部 50 家 →</button></div>
            </section>

            <aside className="lane-side">
              <article className="health-card"><div className="mini-head"><div><span className="section-kicker">PIPELINE</span><h3>数据通路配置</h3></div><span className="health-score">3源</span></div><div className="health-ring"><div><strong>50/50</strong><span>官方报告回填</span></div></div><ul><li><span>上交所公告源</span><b><i />已验证</b></li><li><span>深交所公告源</span><b><i />已验证</b></li><li><span>巨潮资讯兜底</span><b><i />已验证</b></li><li><span>定时任务</span><b className="review-count">每 10 分钟</b></li></ul></article>
              <article className="quality-card"><div className="quality-icon">盾</div><div><h3>多级校验，确定性优先</h3><p>表格规则提取、勾稽关系校验、模型复杂版式兜底。结果冲突不直接上线，自动进入人工复核。</p><button onClick={() => setView('report')}>查看一条数据如何被验证 →</button></div></article>
            </aside>
          </div>
          <section className="coverage-card" id="coverage-50"><div className="section-head"><div><span className="section-kicker">GREEN LANE COVERAGE</span><h2>50 家绿色通道名单</h2><p>按市场关注度、行业代表性与研究需求排序；每家公司已回填一份真实官方财报。</p></div><span className="coverage-count">SSE {coverageCompanies.filter((item) => item.exchange === 'SSE').length} · SZSE {coverageCompanies.filter((item) => item.exchange === 'SZSE').length}</span></div><div className="coverage-grid">{coverageCompanies.map((item) => <div className="coverage-item" key={item.code}><span>{String(item.rank).padStart(2, '0')}</span><div><b>{item.name}</b><small>{item.code} · {item.industry}</small></div><i>{item.exchange}</i></div>)}</div></section>
          <div className="demo-note">官方公告列表与 PDF 链接来自巨潮资讯真实公开数据；财务指标、异常洞察与耗时案例仍用于交互流程演示。</div>
        </section>
      ) : (
        <div className="report-layout">
          <section className="report-main">
            <button className="back-link" onClick={() => setView('lane')}>← 返回财报绿色通道</button>
            <div className="report-titlebar"><div><div className="report-label"><span>{hasDemoAnalysis ? '已上线' : '待解析'}</span> {report.exchange} · {report.report}</div><h1>{report.name} <small>{report.code}</small></h1><p>官方发布 {report.publish} · 数据源 {selectedOfficial.source} · <b>{hasDemoAnalysis ? '交互分析已就绪' : '结构化解析排队中'}</b></p></div><div><button className="secondary">☆ 关注</button><button className="primary" onClick={() => window.open(selectedOfficial.pdf_url, '_blank', 'noopener,noreferrer')}>查看原始财报 ↗</button></div></div>

            {hasDemoAnalysis ? <>
            <div className="detail-speed"><div><span>⚡ 本财报上线耗时</span><strong>08:17</strong><small>较原通路预计领先 47 分钟</small></div><ol>{['20:03 公告发布','20:05 系统发现','20:06 下载完成','20:09 解析校验','20:11 数据上线'].map((step) => <li key={step}><i>✓</i><span>{step}</span></li>)}</ol></div>

            <div className="report-tabs">{['一分钟看懂','变化雷达','多期趋势','同业对标','财报原文'].map((tab) => <button className={activeTab === tab ? 'active' : ''} key={tab} onClick={() => { setActiveTab(tab); document.getElementById(tab === '变化雷达' ? 'change-radar' : tab === '同业对标' ? 'peer-section' : 'metrics')?.scrollIntoView({ behavior: 'smooth' }); }}>{tab}</button>)}</div>

            <section id="metrics" className="minute-section">
              <div className="section-head compact"><div><span className="section-kicker">ONE-MINUTE BRIEF</span><h2>一分钟看懂</h2></div><span className="verified-badge">✓ 数据已通过勾稽校验</span></div>
              <div className="metric-grid">
                {[['营业收入', report.revenue, '+23.3%', '行业 92% 分位'],['归母净利润', report.profit, '+13.8%', '行业 86% 分位'],['每股收益', report.eps, '+12.7%', '行业 81% 分位'],['净资产收益率', report.roe, '-0.6pct', '行业 74% 分位']].map(([label,value,change,rank], index) => <button className="metric-card" key={label} onClick={() => setEvidence(index === 1 ? alerts[0] : alerts[1])}><div><span>{label}</span><i>原始数据 ↗</i></div><strong>{value}</strong><p className={change.startsWith('-') ? 'negative' : 'positive'}>{change} <small>同比</small></p><div className="rank"><span>{rank}</span><i><b style={{width:`${72 + index * 5}%`}} /></i></div></button>)}
              </div>
              <div className="brief-strip"><span className="brief-label">系统结论</span><strong>公司继续增长，但盈利增速与现金质量弱于收入表现。</strong><span className="brief-pos">2 项积极变化</span><span className="brief-risk">3 项需关注</span></div>
            </section>

            <section className="radar-section" id="change-radar">
              <div className="section-head compact"><div><span className="section-kicker">CHANGE RADAR</span><h2>变化雷达</h2><p>系统主动识别本期最值得关注的变化</p></div><button className="secondary">检测规则 12 条</button></div>
              <div className="alert-list">
                {alerts.map((alert, index) => <article className={`alert-card ${index === 0 ? 'critical' : ''}`} key={alert.title}><div className="alert-number">0{index + 1}</div><div className="alert-content"><div className="alert-title"><span>{index === 0 ? '重点' : index === 1 ? '风险' : '趋势'}</span><h3>{alert.title}</h3></div><strong>{alert.value}</strong><p>{alert.inference}</p><div className="alert-actions"><button onClick={() => setEvidence(alert)}>查看计算过程</button><button onClick={() => setEvidence(alert)}>定位原文</button><button className="ask-action" onClick={() => ask(index === 0 ? '为什么净利润增速低于营收？' : '今年最大的经营风险是什么？')}>追问原因 →</button></div></div><div className="alert-spark"><span style={{height:'38%'}}/><span style={{height:'58%'}}/><span style={{height:'64%'}}/><span style={{height:'49%'}}/><span style={{height:index === 0 ? '32%' : '43%'}}/></div></article>)}
              </div>
            </section>

            <section className="trend-peer-grid">
              <article className="trend-card">
                <div className="card-head"><div><span className="section-kicker">8-QUARTER TREND</span><h3>近 8 季度营收与利润趋势</h3></div><div className="chart-legend"><span><i className="rev-dot"/>营收</span><span><i className="profit-dot"/>净利润</span></div></div>
                <div className="quarter-chart"><div className="chart-lines"><span>800</span><span>600</span><span>400</span><span>200</span></div>{quarterData.map((item) => <button className="q-column" key={item.q} onClick={() => setEvidence(alerts[0])}><div><i className="rev-bar" style={{height:`${item.rev}%`}}/><i className="profit-bar" style={{height:`${item.profit}%`}}/></div><span>{item.q}</span></button>)}</div>
                <div className="chart-insight"><span>AI</span><p>25Q2 营收创近八季度新高，但利润柱与营收差距扩大。<button onClick={() => ask('画出近八季度营收和利润趋势')}>继续分析 →</button></p></div>
              </article>

              <article className="peer-card" id="peer-section">
                <div className="card-head"><div><span className="section-kicker">PEER POSITION</span><h3>同行位置</h3></div><button>乘用车整车 ▾</button></div>
                <div className="peer-rank"><span>营收增速</span><strong>第 1 / 4</strong><div><i style={{width:'92%'}}/><b>92%</b></div></div>
                {[['比亚迪','23.3%','100%'],['吉利汽车','18.2%','78%'],['长城汽车','11.6%','50%'],['上汽集团','-5.2%','18%']].map((peer, index) => <div className={`peer-row ${index === 0 ? 'self' : ''}`} key={peer[0]}><span>{index + 1}</span><b>{peer[0]}</b><div><i style={{width:peer[2]}}/></div><strong>{peer[1]}</strong></div>)}
                <button className="peer-query" onClick={() => ask('与三家同行相比表现如何？')}>用自然语言调整对比 →</button>
              </article>
            </section>

            <section className="trust-section">
              <div className="section-head compact"><div><span className="section-kicker">TRUST & TRACEABILITY</span><h2>一个结论，四层证据</h2><p>明确区分数据、计算与 AI 推断，避免“模型说了算”</p></div></div>
              <div className="trust-flow"><article><span>01</span><i className="raw">数</i><h3>原始数据</h3><p>财报表格中的数字与单位</p></article><b>→</b><article><span>02</span><i className="cal">算</i><h3>计算结果</h3><p>同比、趋势、行业分位</p></article><b>→</b><article><span>03</span><i className="infer">析</i><h3>AI 推断</h3><p>对变化原因的谨慎总结</p></article><b>→</b><article><span>04</span><i className="source">证</i><h3>原文证据</h3><p>章节、页码与对应段落</p></article></div>
            </section>
            </> : <section className="pending-detail"><span className="pending-icon">析</span><div><span className="section-kicker">STRUCTURING QUEUE</span><h2>公告详情已就绪，结构化分析正在排队</h2><p>这份官方财报已经进入增量队列。系统会依次完成 PDF 下载、核心指标提取、口径校验和证据定位；已抓取的公告不会重复处理。</p><div className="pending-steps"><span className="done">✓ 公告发现</span><span>PDF 下载</span><span>指标解析</span><span>校验上线</span></div><button className="primary" onClick={() => window.open(selectedOfficial.pdf_url, '_blank', 'noopener,noreferrer')}>先查看官方 PDF ↗</button></div></section>}
            <div className="demo-note">本页面为创新大赛交互 Demo，时间与财务数据用于产品流程演示。</div>
          </section>

          <aside className="ai-panel advanced-ai">
            <div className="ai-head"><div><span>✦</span><div><b>双引擎财报助手</b><small><i />结构化计算 + 原文检索</small></div></div><button onClick={() => setMessages([])}>↻</button></div>
            <div className="engine-strip"><span><i>1</i>识别问题</span><b>→</b><span><i>2</i>查询/计算</span><b>→</b><span><i>3</i>检索原文</span></div>
            <div className="chat-body">
              <div className="ai-message"><span>AI</span><div><p>{hasDemoAnalysis ? `我已完成${report.name}本期财报的结构化校验。你可以追问变化原因、同业位置，或直接让我生成对比图。` : `${report.name}的公告详情已载入，结构化数据仍在解析队列中。你可以先打开官方 PDF，解析完成后再进行指标问答。`}</p><div className="answer-types"><span>✓ 公告元数据已连接</span><span>{hasDemoAnalysis ? '✓ 分析数据可用' : '○ 指标解析中'}</span></div></div></div>
              {messages.map((message, index) => message.role === 'user' ? <div className="user-message" key={index}>{message.text}</div> : <div className="ai-answer" key={index}><div className="answer-source-tabs"><span className="data">结构化数据</span><span className="calc">计算结果</span><span className="rag">原文证据</span></div><p>{message.text}</p>{message.compare && <div className="mini-compare"><div><span>比亚迪</span><i style={{width:'92%'}}/></div><div><span>同行中位</span><i style={{width:'58%'}}/></div><div><span>行业分位</span><i style={{width:'81%'}}/></div></div>}<button onClick={() => setEvidence(alerts[0])}>查看数据与原文证据 ↗</button></div>)}
              <div className="prompt-title">建议追问</div>
              {Object.keys(promptAnswers).map((prompt) => <button className="prompt" key={prompt} onClick={() => ask(prompt)}>{prompt}<span>↗</span></button>)}
            </div>
            <div className="chat-input"><div><textarea aria-label="向财报提问" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); ask(question); } }} placeholder="例如：比较三家同行近八季度净利率…" rows={2}/><button aria-label="发送" onClick={() => ask(question)}>↑</button></div><small>答案区分数据、计算与推断，并提供原文证据</small></div>
          </aside>
        </div>
      )}

      {evidence && <div className="drawer-backdrop" onClick={() => setEvidence(null)}><aside className="evidence-drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-head"><div><span>TRACEABLE EVIDENCE</span><h2>{evidence.title}</h2></div><button onClick={() => setEvidence(null)}>×</button></div><div className="evidence-summary"><span>结论</span><strong>{evidence.value}</strong><small>✓ 通过口径与勾稽关系校验</small></div><ol className="evidence-layers"><li><i className="raw">1</i><div><span>原始数据</span><h3>来自财报合并利润表</h3><p>营业收入 3,712.81 亿元；归母净利润 155.11 亿元。单位：人民币亿元。</p><button>查看表格单元格 ↗</button></div></li><li><i className="cal">2</i><div><span>计算结果</span><h3>确定性公式计算</h3><p>{evidence.calc}</p><code>来源值 → 口径统一 → 同比计算 → 结果校验</code></div></li><li><i className="infer">3</i><div><span>AI 推断</span><h3>影响原因线索</h3><p>{evidence.inference}</p><small>AI 推断不等同于公司确认，需结合原文验证。</small></div></li><li><i className="source">4</i><div><span>原文证据</span><h3>{evidence.page}</h3><blockquote>“{evidence.quote}”</blockquote><button className="primary">在财报原文中打开 ↗</button></div></li></ol><div className="drawer-foot"><span>数据版本 v2 · 解析于 20:09 · 校验于 20:10</span><button>反馈数据问题</button></div></aside></div>}
    </main>
  );
}
