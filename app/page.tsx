'use client';

import { useEffect, useMemo, useState } from 'react';
import companiesJson from '@/data/companies.json';

type View = 'lane' | 'report';
type ReportFilter = 'all' | 'ready' | 'pending';
type MetricName = 'revenue' | 'net_profit' | 'eps' | 'roe';
type Metric = { metric: MetricName; value: number; unit: string; source_page: number | null; source_label: string | null; confidence: number; verified: number; period: string };
type LiveReport = {
  id: string; source: 'CNINFO' | 'SSE' | 'SZSE'; code: string; company_name: string; title: string; report_type: string;
  published_at: string; discovered_at: string; downloaded_at: string | null; parsed_at: string | null; online_at: string | null;
  pdf_url: string; pdf_key: string | null; status: string; parse_error: string | null; industry: string; rank: number; metrics: Metric[];
};
type Health = { source: string; last_success_at?: string; last_failure_at?: string; last_count?: number; last_error?: string };
type StatusPayload = { counts?: { reports: number; parsed: number | null }; health?: Health[]; latestRun?: { started_at: string; finished_at: string | null; status: string } | null };
type ChatMessage = { role: 'user' | 'assistant'; text: string };

const coverageCompanies = companiesJson;
const metricOrder: MetricName[] = ['revenue', 'net_profit', 'eps', 'roe'];
const metricLabels: Record<MetricName, string> = { revenue: '营业收入', net_profit: '归母净利润', eps: '基本每股收益', roe: '净资产收益率' };

function dateTime(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

function elapsed(from?: string | null, to?: string | null) {
  if (!from || !to) return '—';
  const minutes = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 60000));
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

function metricValue(metric?: Metric) {
  if (!metric) return '待解析';
  if (metric.metric === 'revenue' || metric.metric === 'net_profit') return `${(metric.value / 100000000).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 亿元`;
  if (metric.metric === 'eps') return `${metric.value.toLocaleString('zh-CN', { maximumFractionDigits: 4 })} 元/股`;
  return `${metric.value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}%`;
}

function statusMeta(status: string, metricCount: number) {
  if (status === 'online') return { label: '已上线', tone: 'good' };
  if (status === 'review' || metricCount === 4) return { label: '待复核', tone: 'good' };
  if (status === 'parse_partial' || metricCount > 0) return { label: '部分解析', tone: 'warn' };
  if (status === 'downloaded') return { label: '已下载', tone: 'warn' };
  if (status === 'download_failed') return { label: '需重试', tone: 'risk' };
  return { label: '待处理', tone: 'warn' };
}

function sourceName(source: string) {
  return source === 'SSE' ? '上交所' : source === 'SZSE' ? '深交所' : '巨潮资讯';
}

export default function Home() {
  const [view, setView] = useState<View>('lane');
  const [reports, setReports] = useState<LiveReport[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reportFilter, setReportFilter] = useState<ReportFilter>('all');
  const [status, setStatus] = useState<StatusPayload>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedMetric, setSelectedMetric] = useState<Metric | null>(null);
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const selected = reports.find((item) => item.id === selectedId) ?? reports.find((item) => item.metrics.length > 0) ?? reports[0];
  const parsedReports = reports.filter((item) => item.metrics.length > 0);
  const readyReports = reports.filter((item) => item.metrics.length === 4);
  const filteredReports = reports.filter((item) => reportFilter === 'all' || (reportFilter === 'ready' ? item.metrics.length > 0 : item.metrics.length === 0));
  const companyHistory = useMemo(() => reports.filter((item) => item.code === selected?.code && item.metrics.length > 0).sort((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at)), [reports, selected?.code]);

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const [reportsResponse, statusResponse] = await Promise.all([fetch('/api/reports?limit=100', { cache: 'no-store' }), fetch('/api/status', { cache: 'no-store' })]);
        if (!reportsResponse.ok) throw new Error(`公告接口 ${reportsResponse.status}`);
        const reportPayload = await reportsResponse.json() as { reports?: LiveReport[] };
        const statusPayload = statusResponse.ok ? await statusResponse.json() as StatusPayload : {};
        if (!active) return;
        const nextReports = reportPayload.reports ?? [];
        setReports(nextReports);
        setStatus(statusPayload);
        setSelectedId((current) => current ?? nextReports.find((item) => item.metrics.length > 0)?.id ?? nextReports[0]?.id ?? null);
        setLoadError('');
        if (nextReports.some((item) => item.metrics.length === 0 && ['discovered', 'downloaded'].includes(item.status))) {
          void fetch('/api/process', { method: 'POST', headers: { 'content-type': 'application/json' } }).then(async (response) => {
            if (!response.ok || !active) return;
            const updated = await fetch('/api/reports?limit=100', { cache: 'no-store' });
            if (updated.ok && active) {
              const payload = await updated.json() as { reports?: LiveReport[] };
              setReports(payload.reports ?? []);
            }
          }).catch(() => undefined);
        }
      } catch (error) {
        if (active) setLoadError(`真实数据暂时无法读取：${String(error)}`);
      } finally {
        if (active) setLoading(false);
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, 10 * 60 * 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  function openReport(report: LiveReport) {
    setSelectedId(report.id); setMessages([]); setView('report'); window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function answerQuestion(text: string) {
    const clean = text.trim();
    if (!clean || !selected) return;
    const matchedName = metricOrder.find((name) => clean.includes(metricLabels[name]) || (name === 'eps' && /EPS|每股/.test(clean)));
    const metric = matchedName ? selected.metrics.find((item) => item.metric === matchedName) : undefined;
    let answer: string;
    if (metric) answer = `${selected.company_name}${metric.period || '本期'}${metricLabels[metric.metric]}为 ${metricValue(metric)}。数据来自财报“${metric.source_label ?? metricLabels[metric.metric]}”字段${metric.source_page ? `，位于第 ${metric.source_page} 页` : ''}，解析置信度 ${Math.round(metric.confidence * 100)}%。`;
    else if (/指标|数据/.test(clean) && selected.metrics.length) answer = `当前已从这份财报解析 ${selected.metrics.length} 个核心指标：${selected.metrics.map((item) => `${metricLabels[item.metric]} ${metricValue(item)}`).join('；')}。`;
    else if (!selected.metrics.length) answer = '这份财报尚未完成结构化解析。目前只能查看官方公告与 PDF 原文，系统不会在没有真实指标时生成答案。';
    else answer = '当前交付版只回答已入库的结构化指标。原因归因、同行对比和原文 RAG 尚未启用，避免把推测展示成事实。';
    setMessages((items) => [...items, { role: 'user', text: clean }, { role: 'assistant', text: answer }]); setQuestion('');
  }

  const sourceHealth = status.health ?? [];
  const reportState = selected ? statusMeta(selected.status, selected.metrics.length) : null;

  return <main className="app-shell">
    <header className="topbar">
      <button className="brand plain-button" onClick={() => setView('lane')}><span className="brand-mark">财</span><strong>财报智析台</strong><span className="beta">V1</span></button>
      <nav className="main-nav"><button className={view === 'lane' ? 'active' : ''} onClick={() => setView('lane')}>财报绿色通道</button><button className={view === 'report' ? 'active' : ''} onClick={() => selected && setView('report')}>财报详情</button><button disabled>数据复核 · 下一版</button></nav>
      <div className="top-actions"><span className="status-pill"><i />{loading ? '正在读取真实数据' : `${reports.length} 份真实公告 · ${parsedReports.length} 份已解析`}</span><button className="profile">研</button></div>
    </header>

    {view === 'lane' ? <section className="lane-page">
      <div className="lane-hero">
        <div className="hero-copy"><div className="kicker"><span>LIVE DATA</span> 交易所公告绿色通道</div><h1>所有可见结果，<em>都来自线上数据管道</em></h1><p>直接轮询上交所、深交所与巨潮资讯，按公告标识增量去重。已解析指标展示真实数值和财报页码；尚未解析的数据明确标记状态，不生成演示结论。</p><div className="hero-actions"><button className="primary" disabled={!parsedReports.length} onClick={() => parsedReports[0] && openReport(parsedReports[0])}>查看已解析财报 <span>→</span></button><button className="secondary" onClick={() => document.getElementById('latest-reports')?.scrollIntoView({ behavior: 'smooth' })}>查看真实公告列表</button></div></div>
        <div className="hero-proof"><div className="proof-head"><span>线上运行状态</span><b>真实来源 · 增量处理</b></div><ol className="timechain"><li className="complete"><i>✓</i><div><b>10 分钟检查</b><span>有访问时自动触发增量任务</span></div></li><li className="complete"><i>✓</i><div><b>SSE + SZSE</b><span>交易所公告主源</span></div></li><li className="complete"><i>✓</i><div><b>CNINFO</b><span>巨潮资讯交叉兜底</span></div></li><li className="live"><i>✓</i><div><b>D1 + R2</b><span>元数据与 PDF 持久化</span></div></li></ol><div className="proof-result"><span>线上真实公告</span><strong>{reports.length || '—'} 份</strong><small>{parsedReports.length} 份已产生结构化指标</small></div></div>
      </div>
      {loadError && <div className="data-error">{loadError}</div>}
      <div className="lane-stats"><article><span>真实公告</span><strong>{reports.length || '—'} <small>份</small></strong><em>来自线上 D1</em></article><article><span>已解析财报</span><strong>{parsedReports.length} <small>份</small></strong><em>{readyReports.length} 份含四项核心指标</em></article><article><span>已提取指标</span><strong>{reports.reduce((sum, item) => sum + item.metrics.length, 0)} <small>条</small></strong><em>每条保留来源页码</em></article><article><span>绿色通道覆盖</span><strong>{coverageCompanies.length} <small>家</small></strong><em>真实公司名单</em></article></div>

      <div className="lane-grid" id="latest-reports">
        <section className="latest-card"><div className="section-head"><div><span className="section-kicker">LIVE REPORTS</span><h2>线上公告与解析状态</h2><p>点击整行进入真实详情；PDF 使用独立原文入口</p></div><div className="filters"><button className={reportFilter === 'all' ? 'active' : ''} onClick={() => setReportFilter('all')}>全部</button><button className={reportFilter === 'ready' ? 'active' : ''} onClick={() => setReportFilter('ready')}>有指标</button><button className={reportFilter === 'pending' ? 'active' : ''} onClick={() => setReportFilter('pending')}>待处理</button></div></div>
          <div className="report-table"><div className="report-row table-head"><span>公司 / 报告</span><span>官方发布</span><span>公告来源</span><span>发现时间</span><span>原文</span><span>真实状态</span><span /></div>
            {filteredReports.slice(0, 30).map((item, index) => { const meta = statusMeta(item.status, item.metrics.length); return <div className="report-row" role="button" tabIndex={0} key={item.id} onClick={() => openReport(item)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') openReport(item); }}><span className="report-company"><i className={`company-logo ${['blue','navy','red','cyan','gold'][index % 5]}`}>{item.company_name.slice(0, 1)}</i><span><b>{item.company_name} <small>{item.code}</small></b><em>{item.title}</em></span></span><span className="time-cell"><b>{dateTime(item.published_at)}</b><small>官方时间</small></span><span className="time-cell"><b>{sourceName(item.source)}</b><small>{item.source}</small></span><span className="time-cell"><b>{dateTime(item.discovered_at)}</b><small>{elapsed(item.published_at, item.discovered_at)}</small></span><span className="time-cell online"><button className="pdf-link" aria-label={`打开${item.company_name}财报 PDF`} onClick={(event) => { event.stopPropagation(); window.open(`/api/reports/${encodeURIComponent(item.id)}/pdf`, '_blank', 'noopener,noreferrer'); }}>PDF ↗</button><small>{item.pdf_key ? '已归档 R2' : '官方地址'}</small></span><span><em className={`signal ${meta.tone}`}>{meta.label} · {item.metrics.length}/4</em></span><span className="row-arrow">›</span></div>; })}
            {!loading && filteredReports.length === 0 && <div className="empty-reports">当前筛选下暂无真实记录</div>}
          </div><div className="table-note"><span><i />共 {filteredReports.length} 份，当前展示前 30 份</span><button onClick={() => document.getElementById('coverage-50')?.scrollIntoView({ behavior: 'smooth' })}>查看覆盖公司 →</button></div></section>

        <aside className="lane-side"><article className="health-card"><div className="mini-head"><div><span className="section-kicker">SOURCE HEALTH</span><h3>真实数据源状态</h3></div><span className="health-score">{sourceHealth.filter((item) => item.last_success_at).length}/3</span></div><div className="health-ring"><div><strong>{parsedReports.length}/{reports.length || 0}</strong><span>已产出指标</span></div></div><ul>{['SSE','SZSE','CNINFO'].map((source) => { const health = sourceHealth.find((item) => item.source === source); return <li key={source}><span>{sourceName(source)}</span><b className={health?.last_success_at ? '' : 'review-count'}><i />{health?.last_success_at ? `成功 · ${health.last_count ?? 0} 条` : '等待运行'}</b></li>; })}<li><span>最近任务</span><b className="review-count">{status.latestRun ? `${status.latestRun.status} · ${dateTime(status.latestRun.started_at)}` : '暂无记录'}</b></li></ul></article><article className="quality-card"><div className="quality-icon">真</div><div><h3>缺数据就显示缺数据</h3><p>本版本不再提供模拟财务数值、模拟耗时、模拟异常洞察或模拟问答。后续产品打磨可以直接围绕真实记录进行。</p></div></article></aside>
      </div>

      <section className="coverage-card" id="coverage-50"><div className="section-head"><div><span className="section-kicker">GREEN LANE COVERAGE</span><h2>50 家绿色通道名单</h2><p>覆盖配置真实存在；是否已有公告和指标，以线上公告列表状态为准。</p></div><span className="coverage-count">SSE {coverageCompanies.filter((item) => item.exchange === 'SSE').length} · SZSE {coverageCompanies.filter((item) => item.exchange === 'SZSE').length}</span></div><div className="coverage-grid">{coverageCompanies.map((item) => { const count = reports.filter((report) => report.code === item.code).length; return <div className="coverage-item" key={item.code}><span>{String(item.rank).padStart(2, '0')}</span><div><b>{item.name}</b><small>{item.code} · {item.industry}</small></div><i>{count ? `${count} 份公告` : '暂无公告'}</i></div>; })}</div></section>
    </section> : selected ? <div className="report-layout">
      <section className="report-main"><button className="back-link" onClick={() => setView('lane')}>← 返回财报绿色通道</button><div className="report-titlebar"><div><div className="report-label"><span>{reportState?.label}</span> {sourceName(selected.source)} · {selected.title}</div><h1>{selected.company_name} <small>{selected.code}</small></h1><p>官方发布 {dateTime(selected.published_at)} · 系统发现 {dateTime(selected.discovered_at)} · <b>{selected.metrics.length ? `已入库 ${selected.metrics.length} 个指标` : '尚无结构化指标'}</b></p></div><div><button className="primary" onClick={() => window.open(`/api/reports/${encodeURIComponent(selected.id)}/pdf`, '_blank', 'noopener,noreferrer')}>查看原始财报 ↗</button></div></div>
        <div className="detail-speed"><div><span>真实处理状态</span><strong>{reportState?.label}</strong><small>公告至系统发现：{elapsed(selected.published_at, selected.discovered_at)}</small></div><ol>{[['公告发布',selected.published_at],['系统发现',selected.discovered_at],['PDF 下载',selected.downloaded_at],['指标解析',selected.parsed_at],['正式上线',selected.online_at]].map(([label,time]) => <li key={label} className={time ? '' : 'pending'}><i>{time ? '✓' : '○'}</i><span>{label}<br />{dateTime(time)}</span></li>)}</ol></div>
        <section id="metrics" className="minute-section"><div className="section-head compact"><div><span className="section-kicker">REAL STRUCTURED DATA</span><h2>核心财务指标</h2><p>仅展示数据库中已经解析的值</p></div><span className="verified-badge">{selected.metrics.some((item) => item.verified) ? '✓ 已人工复核' : '机器提取 · 待复核'}</span></div><div className="metric-grid">{metricOrder.map((name) => { const metric = selected.metrics.find((item) => item.metric === name); return <button className={`metric-card ${metric ? '' : 'metric-empty'}`} disabled={!metric} key={name} onClick={() => metric && setSelectedMetric(metric)}><div><span>{metricLabels[name]}</span><i>{metric ? '查看来源 ↗' : '未提取'}</i></div><strong>{metricValue(metric)}</strong><p>{metric ? `置信度 ${Math.round(metric.confidence * 100)}%` : '等待解析任务'}</p>{metric && <div className="rank"><span>{metric.source_label ?? metricLabels[name]} · 第 {metric.source_page ?? '—'} 页</span></div>}</button>; })}</div>{!selected.metrics.length && <div className="honest-empty"><b>这份财报还没有结构化数据</b><p>官方公告与 PDF 已可用；指标解析完成前，系统不会展示任何替代数字或 AI 结论。</p></div>}</section>
        <section className="trend-card real-history"><div className="card-head"><div><span className="section-kicker">AVAILABLE HISTORY</span><h3>已入库多期数据</h3></div><span className="coverage-count">{companyHistory.length} 个报告期</span></div>{companyHistory.length > 1 ? <div className="history-table">{companyHistory.map((item) => <div key={item.id}><b>{item.metrics[0]?.period ?? item.title}</b>{metricOrder.map((name) => <span key={name}>{metricLabels[name]}：{metricValue(item.metrics.find((metric) => metric.metric === name))}</span>)}</div>)}</div> : <div className="honest-empty"><b>暂不足以生成趋势图</b><p>当前只有 {companyHistory.length} 个真实报告期。至少两个报告期入库后再展示趋势，避免用模拟序列补图。</p></div>}</section>
        <section className="trust-section"><div className="section-head compact"><div><span className="section-kicker">TRACEABILITY</span><h2>真实数据可追溯</h2></div></div><div className="trust-flow"><article><span>01</span><i className="raw">源</i><h3>官方公告</h3><p>{sourceName(selected.source)} · {selected.title}</p></article><b>→</b><article><span>02</span><i className="cal">存</i><h3>PDF 归档</h3><p>{selected.pdf_key ? '已存入 R2' : '使用官方原文地址'}</p></article><b>→</b><article><span>03</span><i className="infer">析</i><h3>规则提取</h3><p>{selected.metrics.length} 个核心指标</p></article><b>→</b><article><span>04</span><i className="source">证</i><h3>页码证据</h3><p>点击指标查看来源标签和页码</p></article></div></section>
      </section>
      <aside className="ai-panel advanced-ai"><div className="ai-head"><div><span>数</span><div><b>财报数据助手 V1</b><small><i />只查询真实结构化指标</small></div></div><button onClick={() => setMessages([])}>↻</button></div><div className="engine-strip"><span><i>1</i>识别指标</span><b>→</b><span><i>2</i>查询 D1</span><b>→</b><span><i>3</i>返回页码</span></div><div className="chat-body"><div className="ai-message"><span>V1</span><div><p>{selected.metrics.length ? `已载入${selected.company_name}这份财报的 ${selected.metrics.length} 个真实指标。可以询问营收、归母净利润、每股收益或净资产收益率。` : '这份财报尚未产出结构化指标，目前不提供模拟回答。'}</p></div></div>{messages.map((message,index) => message.role === 'user' ? <div className="user-message" key={index}>{message.text}</div> : <div className="ai-answer" key={index}><div className="answer-source-tabs"><span className="data">线上 D1 数据</span><span className="calc">确定性格式化</span></div><p>{message.text}</p></div>)}<div className="prompt-title">可查询</div>{metricOrder.map((name) => <button className="prompt" disabled={!selected.metrics.some((item) => item.metric === name)} key={name} onClick={() => answerQuestion(`${metricLabels[name]}是多少？`)}>{metricLabels[name]}是多少？<span>↗</span></button>)}</div><div className="chat-input"><div><textarea aria-label="查询财报指标" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); answerQuestion(question); } }} placeholder="例如：营业收入是多少？" rows={2}/><button aria-label="发送" onClick={() => answerQuestion(question)}>↑</button></div><small>原因分析、同行对比与 RAG 尚未启用</small></div></aside>
    </div> : <section className="lane-page"><div className="honest-empty"><b>暂无可用公告</b><p>请等待真实数据管道完成首次运行。</p></div></section>}

    {selectedMetric && selected && <div className="drawer-backdrop" onClick={() => setSelectedMetric(null)}><aside className="evidence-drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-head"><div><span>REAL DATA EVIDENCE</span><h2>{metricLabels[selectedMetric.metric]}</h2></div><button onClick={() => setSelectedMetric(null)}>×</button></div><div className="evidence-summary"><span>已入库数值</span><strong>{metricValue(selectedMetric)}</strong><small>解析置信度 {Math.round(selectedMetric.confidence * 100)}% · {selectedMetric.verified ? '已复核' : '待人工复核'}</small></div><ol className="evidence-layers"><li><i className="raw">1</i><div><span>公告来源</span><h3>{sourceName(selected.source)}官方公告</h3><p>{selected.title}</p></div></li><li><i className="cal">2</i><div><span>原始字段</span><h3>{selectedMetric.source_label ?? metricLabels[selectedMetric.metric]}</h3><p>原始入库值：{selectedMetric.value}；原始单位：{selectedMetric.unit}</p></div></li><li><i className="source">3</i><div><span>财报位置</span><h3>第 {selectedMetric.source_page ?? '—'} 页</h3><p>点击下方按钮打开归档 PDF 或官方原文进行人工核验。</p><button className="primary" onClick={() => window.open(`/api/reports/${encodeURIComponent(selected.id)}/pdf`, '_blank', 'noopener,noreferrer')}>打开财报原文 ↗</button></div></li></ol><div className="drawer-foot"><span>报告期 {selectedMetric.period} · 数据状态 {reportState?.label}</span></div></aside></div>}
  </main>;
}
