'use client';

import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
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
type Analysis = { period?: string; industry?: string; peers?: Array<{ code: string; company_name: string; metric: string; value: number; unit: string }>; anomalies?: Array<{ level: 'risk' | 'info'; title: string; detail: string }> };
type OutlineSection = { id: string; title: string; level: 1 | 2; page: number; endPage: number; excerpt: string; highlight: string; source: 'detected' | 'standard' };
type OutlinePayload = { indexedPages: number; outline: OutlineSection[]; pages: Array<{ page: number; content: string }> };
type ChartMetric = 'revenue' | 'net_profit' | 'eps' | 'roe';

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

function compactMetric(metric: Metric | undefined) {
  if (!metric) return '—';
  if (metric.metric === 'revenue' || metric.metric === 'net_profit') return `${(metric.value / 100000000).toLocaleString('zh-CN', { maximumFractionDigits: 1 })}亿`;
  return `${metric.value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}${metric.metric === 'roe' ? '%' : ''}`;
}

function reportPeriod(report: LiveReport) {
  return report.metrics[0]?.period ?? new Date(report.published_at).toLocaleDateString('zh-CN', { year: '2-digit', month: '2-digit' });
}

function highlightedText(text: string, term?: string) {
  if (!term) return text;
  const position = text.indexOf(term);
  if (position < 0) return text;
  return <>{text.slice(0, position)}<mark>{term}</mark>{text.slice(position + term.length)}</>;
}

function evidenceParagraphs(text: string) {
  const sentences = text.match(/[^。！？；]+[。！？；]?/g)?.map((item) => item.trim()).filter(Boolean) ?? [text];
  const paragraphs: string[] = [];
  for (let index = 0; index < sentences.length; index += 2) paragraphs.push(sentences.slice(index, index + 2).join(''));
  return paragraphs.filter(Boolean);
}

export default function Home() {
  const [view, setView] = useState<View>('lane');
  const [reports, setReports] = useState<LiveReport[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reportFilter, setReportFilter] = useState<ReportFilter>('all');
  const [status, setStatus] = useState<StatusPayload>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [authState, setAuthState] = useState<'checking' | 'anonymous' | 'authenticated'>('checking');
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState<Metric | null>(null);
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [analysis, setAnalysis] = useState<Analysis>({});
  const [outlineData, setOutlineData] = useState<OutlinePayload>({ indexedPages: 0, outline: [], pages: [] });
  const [readerOpen, setReaderOpen] = useState(false);
  const [readerPage, setReaderPage] = useState<number | null>(null);
  const [readerHighlight, setReaderHighlight] = useState('');
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);
  const [trendMetric, setTrendMetric] = useState<ChartMetric>('revenue');
  const [peerMetric, setPeerMetric] = useState<'revenue' | 'net_profit' | 'roe'>('roe');
  const [adminDialogOpen, setAdminDialogOpen] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminError, setAdminError] = useState('');
  const [adminSubmitting, setAdminSubmitting] = useState(false);

  const selected = reports.find((item) => item.id === selectedId) ?? reports.find((item) => item.metrics.length > 0) ?? reports[0];
  const parsedReports = reports.filter((item) => item.metrics.length > 0);
  const readyReports = reports.filter((item) => item.metrics.length === 4);
  const filteredReports = reports.filter((item) => reportFilter === 'all' || (reportFilter === 'ready' ? item.metrics.length > 0 : item.metrics.length === 0));
  const companyHistory = useMemo(() => reports.filter((item) => item.code === selected?.code && item.metrics.length > 0).sort((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at)), [reports, selected?.code]);

  useEffect(() => {
    let active = true;
    void fetch('/api/auth/session', { cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() as Promise<{ authenticated?: boolean }> : { authenticated: false })
      .then((payload) => { if (active) setAuthState(payload.authenticated ? 'authenticated' : 'anonymous'); })
      .catch(() => { if (active) setAuthState('anonymous'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (authState !== 'authenticated') return;
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
      } catch (error) {
        if (active) setLoadError(`真实数据暂时无法读取：${String(error)}`);
      } finally {
        if (active) setLoading(false);
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, 10 * 60 * 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [authState]);

  useEffect(() => {
    if (!selectedId) return;
    void fetch(`/api/reports/${encodeURIComponent(selectedId)}/analysis`, { cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() as Promise<Analysis> : {})
      .then(setAnalysis).catch(() => setAnalysis({}));
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    setOutlineData({ indexedPages: 0, outline: [], pages: [] });
    setReaderPage(null);
    setReaderHighlight('');
    setPdfPreviewOpen(false);
    void fetch(`/api/reports/${encodeURIComponent(selectedId)}/outline`, { cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() as Promise<OutlinePayload> : { indexedPages: 0, outline: [], pages: [] })
      .then(setOutlineData).catch(() => setOutlineData({ indexedPages: 0, outline: [], pages: [] }));
  }, [selectedId]);

  function openReport(report: LiveReport) {
    setSelectedId(report.id); setMessages([]); setReaderOpen(false); setView('report'); window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function loginApp() {
    if (!loginUsername || !loginPassword) { setLoginError('请输入账号和密码。'); return; }
    setLoginSubmitting(true); setLoginError('');
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: loginUsername, password: loginPassword }) });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setLoginError(payload.error ?? '登录失败，请稍后重试。'); return; }
      setLoginPassword(''); setAuthState('authenticated');
    } catch { setLoginError('网络或服务暂时不可用，请稍后重试。'); } finally { setLoginSubmitting(false); }
  }

  async function logoutApp() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setReports([]); setSelectedId(null); setAuthState('anonymous'); setView('lane');
  }

  function approveReport() {
    if (!selected) return;
    setAdminPassword(''); setAdminError(''); setAdminDialogOpen(true);
  }

  async function loginAndApprove() {
    if (!selected || !adminPassword) { setAdminError('请输入管理员密码。'); return; }
    setAdminSubmitting(true); setAdminError('');
    const submit = () => fetch(`/api/admin/reports/${encodeURIComponent(selected.id)}/review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'approve' }) });
    try {
      const login = await fetch('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: adminPassword }) });
      const loginPayload = await login.json() as { error?: string };
      if (!login.ok) { setAdminError(loginPayload.error ?? '登录失败。'); return; }
      const response = await submit();
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setAdminError(payload.error ?? '复核状态更新失败，请稍后重试。'); return; }
      setReports((items) => items.map((item) => item.id === selected.id ? { ...item, status: 'online', online_at: new Date().toISOString(), metrics: item.metrics.map((metric) => ({ ...metric, verified: 1 })) } : item));
      setAdminDialogOpen(false);
    } catch {
      setAdminError('网络或服务暂时不可用，请稍后重试。');
    } finally {
      setAdminSubmitting(false);
    }
  }

  async function answerQuestion(text: string) {
    const clean = text.trim();
    if (!clean || !selected) return;
    setMessages((items) => [...items, { role: 'user', text: clean }, { role: 'assistant', text: '' }]); setQuestion('');
    let answer: string;
    try {
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reportId: selected.id, question: clean, stream: true }) });
      if (!response.ok || !response.body) throw new Error(`chat ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = ''; answer = '';
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const event of events) {
          const raw = event.split('\n').find((line) => line.startsWith('data: '))?.slice(6);
          if (!raw || raw === '[DONE]') continue;
          try { answer += (JSON.parse(raw) as { content?: string }).content ?? ''; } catch { /* ignore malformed event */ }
          flushSync(() => setMessages((items) => { const next = [...items]; const index = next.length - 1; if (next[index]?.role === 'assistant') next[index] = { role: 'assistant', text: answer }; return next; }));
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
        if (done) break;
      }
      if (!answer) answer = '未返回可核验答案。';
    } catch { answer = 'AI 问答暂时不可用，请稍后重试。'; }
    setMessages((items) => { const next = [...items]; const index = next.length - 1; if (next[index]?.role === 'assistant') next[index] = { role: 'assistant', text: answer }; return next; });
  }

  const sourceHealth = status.health ?? [];
  const reportState = selected ? statusMeta(selected.status, selected.metrics.length) : null;
  const currentReaderPage = readerPage ?? outlineData.outline[0]?.page ?? outlineData.pages[0]?.page ?? 1;
  const currentReaderSection = outlineData.outline.find((item) => item.page === currentReaderPage) ?? outlineData.outline.find((item) => item.page <= currentReaderPage && item.endPage >= currentReaderPage);
  const currentReaderText = outlineData.pages.find((item) => item.page === currentReaderPage)?.content;
  const effectiveHighlight = readerHighlight || currentReaderSection?.highlight || '';
  const evidenceCards = [
    ...selected?.metrics.filter((metric) => metric.source_page).map((metric) => ({ id: `metric-${metric.metric}`, title: `${metricLabels[metric.metric]}：${metricValue(metric)}`, detail: `${metric.source_label ?? metricLabels[metric.metric]} · 第 ${metric.source_page} 页`, page: metric.source_page ?? 1, highlight: metric.source_label ?? metricLabels[metric.metric] })) ?? [],
    ...outlineData.outline.filter((item) => item.level === 1).map((item) => ({ id: `section-${item.id}`, title: item.title, detail: `章节证据 · 第 ${item.page}–${item.endPage} 页`, page: item.page, highlight: item.highlight })),
  ];
  const trendPoints = companyHistory.map((report, index) => ({ report, metric: report.metrics.find((item) => item.metric === trendMetric), index }));
  const trendMax = Math.max(...trendPoints.map((item) => item.metric?.value ?? 0), 1);
  const chartWidth = 680;
  const chartHeight = 220;
  const trendLine = trendPoints.map((item, index) => {
    const x = trendPoints.length === 1 ? chartWidth / 2 : 34 + index * ((chartWidth - 68) / (trendPoints.length - 1));
    const y = 22 + (1 - ((item.metric?.value ?? 0) / trendMax)) * 148;
    return `${x},${y}`;
  }).join(' ');
  const peerRows = [...new Map(analysis.peers?.filter((item) => item.metric === peerMetric).map((item) => [item.code, item]) ?? []).values()].sort((a, b) => b.value - a.value).slice(0, 8);
  const peerMax = Math.max(...peerRows.map((item) => Math.abs(item.value)), 1);

  if (authState !== 'authenticated') return <main className="login-shell"><section className="login-card"><div className="login-mark">财</div><span className="section-kicker">FINANCIAL REPORT INTELLIGENCE</span><h1>财报智析台</h1><p>{authState === 'checking' ? '正在验证访问权限…' : '登录后访问财报绿色通道、研究分析与原文证据。'}</p>{authState === 'anonymous' && <form onSubmit={(event) => { event.preventDefault(); void loginApp(); }}><label>账号<input autoFocus autoComplete="username" value={loginUsername} onChange={(event) => setLoginUsername(event.target.value)} /></label><label>密码<input type="password" autoComplete="current-password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} /></label>{loginError && <small className="login-error">{loginError}</small>}<button className="primary login-submit" disabled={loginSubmitting} type="submit">{loginSubmitting ? '正在登录…' : '登录进入系统'}</button></form>}<small className="login-note">账号与密码由部署环境配置，不在浏览器保存。</small></section></main>;

  return <main className="app-shell">
    <header className="topbar">
      <button className="brand plain-button" onClick={() => setView('lane')}><span className="brand-mark">财</span><strong>财报智析台</strong><span className="beta">V1</span></button>
      <nav className="main-nav"><button className={view === 'lane' ? 'active' : ''} onClick={() => setView('lane')}>财报绿色通道</button><button className={view === 'report' ? 'active' : ''} onClick={() => selected && setView('report')}>财报详情</button><button disabled>数据复核 · 下一版</button></nav>
      <div className="top-actions"><span className="status-pill"><i />{loading ? '正在读取真实数据' : `${reports.length} 份真实公告 · ${parsedReports.length} 份已解析`}</span><button className="profile" title="退出登录" onClick={() => void logoutApp()}>退</button></div>
    </header>

    {view === 'lane' ? <section className="lane-page">
      <div className="lane-hero">
        <div className="hero-copy"><div className="kicker"><span>LIVE DATA</span> 交易所公告绿色通道</div><h1>所有可见结果，<em>都来自线上数据管道</em></h1><p>直接轮询上交所、深交所与巨潮资讯，按公告标识增量去重。已解析指标展示真实数值和财报页码；尚未解析的数据明确标记状态，不生成演示结论。</p><div className="hero-actions"><button className="primary" disabled={!parsedReports.length} onClick={() => { setReportFilter('ready'); document.getElementById('latest-reports')?.scrollIntoView({ behavior: 'smooth' }); }}>查看已解析财报 <span>→</span></button><button className="secondary" onClick={() => document.getElementById('latest-reports')?.scrollIntoView({ behavior: 'smooth' })}>查看真实公告列表</button></div></div>
        <div className="hero-proof"><div className="proof-head"><span>线上运行状态</span><b>真实来源 · 增量处理</b></div><ol className="timechain"><li className="complete"><i>✓</i><div><b>10 分钟检查</b><span>独立 Worker 定时执行</span></div></li><li className="complete"><i>✓</i><div><b>SSE + SZSE</b><span>交易所公告主源</span></div></li><li className="complete"><i>✓</i><div><b>CNINFO</b><span>巨潮资讯交叉兜底</span></div></li><li className="live"><i>✓</i><div><b>PostgreSQL + 磁盘</b><span>元数据与 PDF 持久化</span></div></li></ol><div className="proof-result"><span>线上真实公告</span><strong>{reports.length || '—'} 份</strong><small>{parsedReports.length} 份已产生结构化指标</small></div></div>
      </div>
      {loadError && <div className="data-error">{loadError}</div>}
      <div className="lane-stats"><article><span>真实公告</span><strong>{reports.length || '—'} <small>份</small></strong><em>来自 PostgreSQL</em></article><article><span>已解析财报</span><strong>{parsedReports.length} <small>份</small></strong><em>{readyReports.length} 份含四项核心指标</em></article><article><span>已提取指标</span><strong>{reports.reduce((sum, item) => sum + item.metrics.length, 0)} <small>条</small></strong><em>每条保留来源页码</em></article><article><span>绿色通道覆盖</span><strong>{coverageCompanies.length} <small>家</small></strong><em>真实公司名单</em></article></div>

      <div className="lane-grid" id="latest-reports">
        <section className="latest-card"><div className="section-head"><div><span className="section-kicker">LIVE REPORTS</span><h2>线上公告与解析状态</h2><p>点击整行进入真实详情；PDF 使用独立原文入口</p></div><div className="filters"><button className={reportFilter === 'all' ? 'active' : ''} onClick={() => setReportFilter('all')}>全部</button><button className={reportFilter === 'ready' ? 'active' : ''} onClick={() => setReportFilter('ready')}>有指标</button><button className={reportFilter === 'pending' ? 'active' : ''} onClick={() => setReportFilter('pending')}>待处理</button></div></div>
          <div className="report-table"><div className="report-row table-head"><span>公司 / 报告</span><span>官方发布</span><span>公告来源</span><span>发现时间</span><span>原文</span><span>真实状态</span><span /></div>
            {filteredReports.slice(0, 30).map((item, index) => { const meta = statusMeta(item.status, item.metrics.length); return <div className="report-row" role="button" tabIndex={0} key={item.id} onClick={() => openReport(item)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') openReport(item); }}><span className="report-company"><i className={`company-logo ${['blue','navy','red','cyan','gold'][index % 5]}`}>{item.company_name.slice(0, 1)}</i><span><b>{item.company_name} <small>{item.code}</small></b><em>{item.title}</em></span></span><span className="time-cell"><b>{dateTime(item.published_at)}</b><small>官方时间</small></span><span className="time-cell"><b>{sourceName(item.source)}</b><small>{item.source}</small></span><span className="time-cell"><b>{dateTime(item.discovered_at)}</b><small>{elapsed(item.published_at, item.discovered_at)}</small></span><span className="time-cell online"><button className="pdf-link" aria-label={`打开${item.company_name}财报 PDF`} onClick={(event) => { event.stopPropagation(); window.open(`/api/reports/${encodeURIComponent(item.id)}/pdf`, '_blank', 'noopener,noreferrer'); }}>PDF ↗</button><small>{item.pdf_key ? '已归档本地磁盘' : '官方地址'}</small></span><span><em className={`signal ${meta.tone}`}>{meta.label} · {item.metrics.length}/4</em></span><span className="row-arrow">›</span></div>; })}
            {!loading && filteredReports.length === 0 && <div className="empty-reports">当前筛选下暂无真实记录</div>}
          </div><div className="table-note"><span><i />共 {filteredReports.length} 份，当前展示前 30 份</span><button onClick={() => document.getElementById('coverage-50')?.scrollIntoView({ behavior: 'smooth' })}>查看覆盖公司 →</button></div></section>

        <aside className="lane-side"><article className="health-card"><div className="mini-head"><div><span className="section-kicker">SOURCE HEALTH</span><h3>真实数据源状态</h3></div><span className="health-score">{sourceHealth.filter((item) => item.last_success_at).length}/3</span></div><div className="health-ring"><div><strong>{parsedReports.length}/{reports.length || 0}</strong><span>已产出指标</span></div></div><ul>{['SSE','SZSE','CNINFO'].map((source) => { const health = sourceHealth.find((item) => item.source === source); return <li key={source}><span>{sourceName(source)}</span><b className={health?.last_success_at ? '' : 'review-count'}><i />{health?.last_success_at ? `成功 · ${health.last_count ?? 0} 条` : '等待运行'}</b></li>; })}<li><span>最近任务</span><b className="review-count">{status.latestRun ? `${status.latestRun.status} · ${dateTime(status.latestRun.started_at)}` : '暂无记录'}</b></li></ul><p className="worker-note">后台 Worker 每 10 分钟增量发现、下载并解析，无需依赖页面访问。</p></article><article className="quality-card"><div className="quality-icon">真</div><div><h3>缺数据就显示缺数据</h3><p>本版本不再提供模拟财务数值、模拟耗时、模拟异常洞察或模拟问答。后续产品打磨可以直接围绕真实记录进行。</p></div></article></aside>
      </div>

      <section className="coverage-card" id="coverage-50"><div className="section-head"><div><span className="section-kicker">GREEN LANE COVERAGE</span><h2>50 家绿色通道名单</h2><p>覆盖配置真实存在；是否已有公告和指标，以线上公告列表状态为准。</p></div><span className="coverage-count">SSE {coverageCompanies.filter((item) => item.exchange === 'SSE').length} · SZSE {coverageCompanies.filter((item) => item.exchange === 'SZSE').length}</span></div><div className="coverage-grid">{coverageCompanies.map((item) => { const count = reports.filter((report) => report.code === item.code).length; return <div className="coverage-item" key={item.code}><span>{String(item.rank).padStart(2, '0')}</span><div><b>{item.name}</b><small>{item.code} · {item.industry}</small></div><i>{count ? `${count} 份公告` : '暂无公告'}</i></div>; })}</div></section>
    </section> : selected ? <div className="report-layout">
      <section className="report-main"><button className="back-link" onClick={() => setView('lane')}>← 返回财报绿色通道</button><div className="report-titlebar"><div><div className="report-label"><span>{reportState?.label}</span> {sourceName(selected.source)} · {selected.title}</div><h1>{selected.company_name} <small>{selected.code}</small></h1><p>官方发布 {dateTime(selected.published_at)} · 系统发现 {dateTime(selected.discovered_at)} · <b>{selected.metrics.length ? `已入库 ${selected.metrics.length} 个指标` : '尚无结构化指标'}</b></p></div><div>{selected.status !== 'online' && selected.metrics.length > 0 && <button className="secondary" onClick={approveReport}>管理员复核上线</button>}<button className="secondary" onClick={() => { setReaderOpen(true); document.getElementById('report-reader')?.scrollIntoView({ behavior: 'smooth' }); }}>提纲阅读原文</button><button className="primary" onClick={() => window.open(`/api/reports/${encodeURIComponent(selected.id)}/pdf`, '_blank', 'noopener,noreferrer')}>查看原始财报 ↗</button></div></div>
        <div className="detail-speed"><div><span>真实处理状态</span><strong>{reportState?.label}</strong><small>公告至系统发现：{elapsed(selected.published_at, selected.discovered_at)}</small></div><ol>{[['公告发布',selected.published_at],['系统发现',selected.discovered_at],['PDF 下载',selected.downloaded_at],['指标解析',selected.parsed_at],['正式上线',selected.online_at]].map(([label,time]) => <li key={label} className={time ? '' : 'pending'}><i>{time ? '✓' : '○'}</i><span>{label}<br />{dateTime(time)}</span></li>)}</ol></div>
        {readerOpen && <section id="report-reader" className="report-reader">
          <div className="section-head compact"><div><span className="section-kicker">EVIDENCE READER</span><h2>结论与证据阅读</h2><p>先选关心的结论，再定位到可核验的 PDF 页与原文文本。</p></div><button className="secondary" onClick={() => setReaderOpen(false)}>收起阅读器</button></div>
          {outlineData.indexedPages ? <>
            <div className="evidence-cards" aria-label="关键结论与证据">
              {evidenceCards.map((card) => <button className={card.page === currentReaderPage ? 'active' : ''} key={card.id} onClick={() => { setReaderPage(card.page); setReaderHighlight(card.highlight); setPdfPreviewOpen(false); }}><span>证据页 P{card.page}</span><b>{card.title}</b><small>{card.detail}</small></button>)}
            </div>
            <div className="reader-grid">
              <nav className="outline-nav" aria-label="财报提纲">
                {outlineData.outline.length ? outlineData.outline.map((item) => <button className={item.page === currentReaderPage ? 'active' : ''} key={item.id} onClick={() => { setReaderPage(item.page); setReaderHighlight(item.highlight); setPdfPreviewOpen(false); }}><span>{item.level === 1 ? '章节' : '小节'} · P{item.page}{item.endPage > item.page ? `–${item.endPage}` : ''}</span><b>{item.title}</b></button>) : <p>未能从当前 PDF 文本识别标准章节；可按已解析页浏览原文。</p>}
                {outlineData.pages.slice(0, 18).map((item) => <button className={`page-jump ${item.page === currentReaderPage ? 'active' : ''}`} key={item.page} onClick={() => { setReaderPage(item.page); setReaderHighlight(''); setPdfPreviewOpen(false); }}>第 {item.page} 页</button>)}
              </nav>
              <article className="reader-content">
                <div className="reader-content-head"><div><span>当前证据 · PDF 第 {currentReaderPage} 页</span><h3>{currentReaderSection?.title ?? `PDF 第 ${currentReaderPage} 页`}</h3><small>该页已建立文本索引，可直接阅读和追问</small></div><button className="secondary" onClick={() => window.open(`/api/reports/${encodeURIComponent(selected.id)}/pdf#page=${currentReaderPage}`, '_blank', 'noopener,noreferrer')}>打开 PDF 第 {currentReaderPage} 页 ↗</button></div>
                {currentReaderSection?.excerpt && <div className="reader-excerpt"><b>命中位置</b><p>{highlightedText(currentReaderSection.excerpt, effectiveHighlight)}</p></div>}
                <section className="reader-source"><div className="reader-source-head"><span>原文证据</span><small>PDF 第 {currentReaderPage} 页 · 提取文本</small></div><div className="reader-page-text">{evidenceParagraphs(currentReaderText ?? '该页文本尚未成功提取。可打开原 PDF 查看排版原文。').map((paragraph, index) => <p key={index}>{highlightedText(paragraph, effectiveHighlight)}</p>)}</div></section>
                <div className="pdf-proof"><div><b>需要核验原始版式？</b><span>PDF 会直接定位到第 {currentReaderPage} 页。</span></div><button className="secondary" onClick={() => setPdfPreviewOpen((open) => !open)}>{pdfPreviewOpen ? '收起 PDF' : '页内查看 PDF'}</button></div>
                {pdfPreviewOpen && <iframe key={currentReaderPage} title={`${selected.title} 第 ${currentReaderPage} 页`} src={`/api/reports/${encodeURIComponent(selected.id)}/pdf#page=${currentReaderPage}&zoom=page-width`} className="pdf-frame" />}
              </article>
            </div>
          </> : <div className="honest-empty"><b>原文提纲正在建立</b><p>这份 PDF 尚未产生页文本索引。完成解析后，章节导航、页码跳转和原文摘录会自动出现；原 PDF 已可直接打开。</p></div>}
        </section>}
        <section id="metrics" className="minute-section"><div className="section-head compact"><div><span className="section-kicker">REAL STRUCTURED DATA</span><h2>核心财务指标</h2><p>仅展示数据库中已经解析的值</p></div><span className="verified-badge">{selected.metrics.some((item) => item.verified) ? '✓ 已人工复核' : '机器提取 · 待复核'}</span></div><div className="metric-grid">{metricOrder.map((name) => { const metric = selected.metrics.find((item) => item.metric === name); return <button className={`metric-card ${metric ? '' : 'metric-empty'}`} disabled={!metric} key={name} onClick={() => metric && setSelectedMetric(metric)}><div><span>{metricLabels[name]}</span><i>{metric ? '查看来源 ↗' : '未提取'}</i></div><strong>{metricValue(metric)}</strong><p>{metric ? `置信度 ${Math.round(metric.confidence * 100)}%` : '等待解析任务'}</p>{metric && <div className="rank"><span>{metric.source_label ?? metricLabels[name]} · 第 {metric.source_page ?? '—'} 页</span></div>}</button>; })}</div>{!selected.metrics.length && <div className="honest-empty"><b>这份财报还没有结构化数据</b><p>官方公告与 PDF 已可用；指标解析完成前，系统不会展示任何替代数字或 AI 结论。</p></div>}</section>
        <section className="trend-card real-history visual-card"><div className="card-head"><div><span className="section-kicker">REAL METRIC TREND</span><h3>核心指标多期趋势</h3><p>仅绘制该公司已入库的真实报告期；不同指标不混合缩放。</p></div><span className="coverage-count">{companyHistory.length} 个报告期</span></div><div className="chart-tabs">{metricOrder.map((name) => <button className={trendMetric === name ? 'active' : ''} key={name} onClick={() => setTrendMetric(name)}>{metricLabels[name]}</button>)}</div>{companyHistory.length > 1 ? <><div className="trend-figure"><svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={`${metricLabels[trendMetric]}真实多期趋势`}><line x1="34" x2={chartWidth - 34} y1="170" y2="170" className="chart-axis" /><line x1="34" x2={chartWidth - 34} y1="96" y2="96" className="chart-grid" /><polyline points={trendLine} className="trend-line" />{trendPoints.map((item, index) => { const x = 34 + index * ((chartWidth - 68) / (trendPoints.length - 1)); const y = 22 + (1 - ((item.metric?.value ?? 0) / trendMax)) * 148; return <g key={item.report.id}><circle cx={x} cy={y} r="5" className="trend-dot" /><text x={x} y={y - 11} textAnchor="middle" className="chart-value">{compactMetric(item.metric)}</text><text x={x} y="195" textAnchor="middle" className="chart-label">{reportPeriod(item.report)}</text></g>; })}</svg></div><div className="history-table">{companyHistory.map((item) => <div key={item.id}><b>{reportPeriod(item)}</b>{metricOrder.map((name) => <span key={name}>{metricLabels[name]}：{metricValue(item.metrics.find((metric) => metric.metric === name))}</span>)}</div>)}</div></> : <div className="honest-empty"><b>暂不足以生成趋势图</b><p>当前只有 {companyHistory.length} 个真实报告期。至少两个报告期入库后再展示趋势，避免用模拟序列补图。</p></div>}</section>
        <section className="trend-card real-history"><div className="card-head"><div><span className="section-kicker">CHANGE RADAR</span><h3>主动变化与同行数据</h3></div><span className="coverage-count">{analysis.industry ?? '待加载行业'}</span></div>{analysis.anomalies?.length ? <div className="history-table">{analysis.anomalies.map((item, index) => <div key={index}><b>{item.level === 'risk' ? '风险' : '提示'} · {item.title}</b><span>{item.detail}</span></div>)}</div> : <div className="honest-empty"><b>暂无可判定异常</b><p>需至少两个已入库报告期，系统才会计算增收不增利和显著利润波动。</p></div>}{analysis.peers?.length ? <div className="history-table"><div><b>{analysis.period} 同行业已入库对比</b><span>{[...new Set(analysis.peers.map((item) => item.company_name))].slice(0, 8).join('、')}</span></div></div> : null}</section>
        <section className="trend-card real-history peer-visual"><div className="card-head"><div><span className="section-kicker">PEER COMPARISON</span><h3>同行业真实数据对比</h3><p>仅比较绿色通道内、同一报告期、已入库的公司数据。</p></div><span className="coverage-count">{analysis.period ?? '暂无同报告期数据'}</span></div><div className="chart-tabs">{(['roe', 'revenue', 'net_profit'] as const).map((name) => <button className={peerMetric === name ? 'active' : ''} key={name} onClick={() => setPeerMetric(name)}>{metricLabels[name]}</button>)}</div>{peerRows.length ? <div className="peer-bars">{peerRows.map((item, index) => <div className={item.code === selected.code ? 'self' : ''} key={item.code}><span>{index + 1}</span><b>{item.company_name}<small>{item.code}{item.code === selected.code ? ' · 当前公司' : ''}</small></b><i><em style={{ width: `${Math.max(4, Math.abs(item.value) / peerMax * 100)}%` }} /></i><strong>{peerMetric === 'roe' ? `${item.value.toFixed(2)}%` : `${(item.value / 100000000).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 亿`}</strong></div>)}</div> : <div className="honest-empty"><b>暂无可比同行数据</b><p>需要同行公司在同一报告期完成结构化解析后才绘制，避免跨期或虚构对比。</p></div>}</section>
        <section className="trust-section"><div className="section-head compact"><div><span className="section-kicker">TRACEABILITY</span><h2>真实数据可追溯</h2></div></div><div className="trust-flow"><article><span>01</span><i className="raw">源</i><h3>官方公告</h3><p>{sourceName(selected.source)} · {selected.title}</p></article><b>→</b><article><span>02</span><i className="cal">存</i><h3>PDF 归档</h3><p>{selected.pdf_key ? '已存入本地磁盘' : '使用官方原文地址'}</p></article><b>→</b><article><span>03</span><i className="infer">析</i><h3>规则提取</h3><p>{selected.metrics.length} 个核心指标</p></article><b>→</b><article><span>04</span><i className="source">证</i><h3>页码证据</h3><p>点击指标查看来源标签和页码</p></article></div></section>
      </section>
      <aside className="ai-panel advanced-ai"><div className="ai-head"><div><span>数</span><div><b>财报数据助手 V1.1</b><small><i />结构化数据 + 原文证据检索</small></div></div><button onClick={() => setMessages([])}>↻</button></div><div className="engine-strip"><span><i>1</i>识别指标</span><b>→</b><span><i>2</i>检索原文</span><b>→</b><span><i>3</i>返回页码</span></div><div className="chat-body"><div className="ai-message"><span>V1</span><div><p>{selected.metrics.length ? `已载入${selected.company_name}这份财报的 ${selected.metrics.length} 个真实指标。可查询核心指标，或追问“管理层如何解释利润变化”等原文问题。` : '这份财报尚未产出结构化指标，目前不提供模拟回答。'}</p></div></div>{messages.map((message,index) => message.role === 'user' ? <div className="user-message" key={index}>{message.text}</div> : <div className="ai-answer" key={index}><div className="answer-source-tabs"><span className="data">结构化数据 / 原文证据</span><span className="calc">可追溯回答</span></div><p>{message.text}</p></div>)}<div className="prompt-title">可查询</div>{metricOrder.map((name) => <button className="prompt" disabled={!selected.metrics.some((item) => item.metric === name)} key={name} onClick={() => answerQuestion(`${metricLabels[name]}是多少？`)}>{metricLabels[name]}是多少？<span>↗</span></button>)}</div><div className="chat-input"><div><textarea aria-label="查询财报指标" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void answerQuestion(question); } }} placeholder="例如：管理层如何解释利润变化？" rows={2}/><button aria-label="发送" onClick={() => void answerQuestion(question)}>↑</button></div><small>回答仅使用数据库指标与财报原文证据，不提供投资建议</small></div></aside>
    </div> : <section className="lane-page"><div className="honest-empty"><b>暂无可用公告</b><p>请等待真实数据管道完成首次运行。</p></div></section>}

    {adminDialogOpen && <div className="drawer-backdrop" onClick={() => !adminSubmitting && setAdminDialogOpen(false)}><section onClick={(event) => event.stopPropagation()} style={{ width: 'min(400px, calc(100% - 32px))', height: 'max-content', margin: 'auto', padding: 24, background: '#fff', borderRadius: 14, boxShadow: '0 20px 60px #13213b40' }}><span className="section-kicker">ADMIN REVIEW</span><h2 style={{ margin: '7px 0', fontSize: 20 }}>复核并正式上线</h2><p style={{ fontSize: 12, color: '#68758a', lineHeight: 1.65 }}>请确认已核对 PDF 原文、指标数值、单位与页码。操作会记录复核事件。</p><label style={{ display: 'block', fontSize: 12, marginTop: 16 }}>管理员密码<input autoFocus type="password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void loginAndApprove(); }} style={{ width: '100%', marginTop: 7, padding: '10px 11px', border: '1px solid #dce2eb', borderRadius: 7 }} /></label>{adminError && <p style={{ margin: '10px 0 0', color: '#c94756', fontSize: 11 }}>{adminError}</p>}<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}><button className="secondary" disabled={adminSubmitting} onClick={() => setAdminDialogOpen(false)}>取消</button><button className="primary" disabled={adminSubmitting} onClick={() => void loginAndApprove()}>{adminSubmitting ? '正在提交…' : '确认上线'}</button></div></section></div>}
    {selectedMetric && selected && <div className="drawer-backdrop" onClick={() => setSelectedMetric(null)}><aside className="evidence-drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-head"><div><span>REAL DATA EVIDENCE</span><h2>{metricLabels[selectedMetric.metric]}</h2></div><button onClick={() => setSelectedMetric(null)}>×</button></div><div className="evidence-summary"><span>已入库数值</span><strong>{metricValue(selectedMetric)}</strong><small>解析置信度 {Math.round(selectedMetric.confidence * 100)}% · {selectedMetric.verified ? '已复核' : '待人工复核'}</small></div><ol className="evidence-layers"><li><i className="raw">1</i><div><span>公告来源</span><h3>{sourceName(selected.source)}官方公告</h3><p>{selected.title}</p></div></li><li><i className="cal">2</i><div><span>原始字段</span><h3>{selectedMetric.source_label ?? metricLabels[selectedMetric.metric]}</h3><p>原始入库值：{selectedMetric.value}；原始单位：{selectedMetric.unit}</p></div></li><li><i className="source">3</i><div><span>财报位置</span><h3>第 {selectedMetric.source_page ?? '—'} 页</h3><p>点击下方按钮打开归档 PDF 或官方原文进行人工核验。</p><button className="primary" onClick={() => window.open(`/api/reports/${encodeURIComponent(selected.id)}/pdf`, '_blank', 'noopener,noreferrer')}>打开财报原文 ↗</button></div></li></ol><div className="drawer-foot"><span>报告期 {selectedMetric.period} · 数据状态 {reportState?.label}</span></div></aside></div>}
  </main>;
}
