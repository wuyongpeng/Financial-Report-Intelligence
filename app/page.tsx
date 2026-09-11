'use client';

import { useEffect, useState } from 'react';
import CompanyDetail from './company-detail';
import ReportHome from './report-home';

type View = 'lane' | 'report';
type MetricName = 'revenue' | 'net_profit' | 'eps' | 'roe';
type Metric = { metric: MetricName; value: number; unit: string; source_page: number | null; source_label: string | null; confidence: number; verified: number; period: string };
type LiveReport = {
  id: string; source: 'CNINFO' | 'SSE' | 'SZSE'; code: string; company_name: string; title: string; report_type: string;
  published_at: string; discovered_at: string; downloaded_at: string | null; parsed_at: string | null; online_at: string | null;
  pdf_url: string; pdf_key: string | null; status: string; parse_error: string | null; industry: string; rank: number; metrics: Metric[];
};
export default function Home() {
  const [view, setView] = useState<View>('lane');
  const [reports, setReports] = useState<LiveReport[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reviewReportId, setReviewReportId] = useState<string | null>(null);
  const [adminDialogOpen, setAdminDialogOpen] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminError, setAdminError] = useState('');
  const [adminSubmitting, setAdminSubmitting] = useState(false);

  const selected = reports.find((item) => item.id === selectedId) ?? reports.find((item) => item.metrics.length > 0) ?? reports[0];
  const parsedReports = reports.filter((item) => item.metrics.length > 0);

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const reportsResponse = await fetch('/api/reports?limit=100&view=companies', { cache: 'no-store' });
        if (!reportsResponse.ok) throw new Error(`公告接口 ${reportsResponse.status}`);
        const reportPayload = await reportsResponse.json() as { reports?: LiveReport[] };
        if (!active) return;
        const nextReports = reportPayload.reports ?? [];
        setReports(nextReports);
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
  }, []);

  function openReport(report: LiveReport) { setSelectedId(report.id); setView('report'); window.scrollTo({ top: 0 }); }

  function approveReport(reportId: string) {
    setReviewReportId(reportId);
    setAdminPassword(''); setAdminError(''); setAdminDialogOpen(true);
  }

  async function loginAndApprove() {
    if (!reviewReportId || !adminPassword) { setAdminError('请输入管理员密码。'); return; }
    setAdminSubmitting(true); setAdminError('');
    const submit = () => fetch(`/api/admin/reports/${encodeURIComponent(reviewReportId)}/review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'approve' }) });
    try {
      const login = await fetch('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: adminPassword }) });
      const loginPayload = await login.json() as { error?: string };
      if (!login.ok) { setAdminError(loginPayload.error ?? '登录失败。'); return; }
      const response = await submit();
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setAdminError(payload.error ?? '复核状态更新失败，请稍后重试。'); return; }
      setReports((items) => items.map((item) => item.id === reviewReportId ? { ...item, status: 'online', online_at: new Date().toISOString(), metrics: item.metrics.map((metric) => ({ ...metric, verified: 1 })) } : item));
      setAdminDialogOpen(false);
    } catch {
      setAdminError('网络或服务暂时不可用，请稍后重试。');
    } finally {
      setAdminSubmitting(false);
    }
  }

  const adminMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('admin') === '1';

  return <main className="app-shell">
    {view === 'lane' && <header className="topbar home-topbar">
      <button className="brand plain-button" onClick={() => setView('lane')}><span className="brand-mark">财</span><strong>财报智析台</strong><span className="beta">V1</span></button>
      <div className="top-actions"><span className="status-pill"><i />{loading ? '正在读取真实数据' : `${parsedReports.length} 份财报可阅读`}</span></div>
    </header>}

    {view === 'lane' ? <ReportHome reports={reports} loading={loading} error={loadError} onOpen={openReport} /> : selected ? <CompanyDetail key={selected.code} initialReport={selected} onBack={() => setView('lane')} onSelect={setSelectedId} onApprove={adminMode ? approveReport : undefined} /> : <section className="lane-page"><div className="honest-empty"><b>暂无可用公告</b><p>请等待真实数据管道完成首次运行。</p></div></section>}

    {adminDialogOpen && <div className="drawer-backdrop" onClick={() => !adminSubmitting && setAdminDialogOpen(false)}><section onClick={(event) => event.stopPropagation()} style={{ width: 'min(400px, calc(100% - 32px))', height: 'max-content', margin: 'auto', padding: 24, background: '#fff', borderRadius: 14, boxShadow: '0 20px 60px #13213b40' }}><span className="section-kicker">ADMIN REVIEW</span><h2 style={{ margin: '7px 0', fontSize: 20 }}>复核并正式上线</h2><p style={{ fontSize: 12, color: '#68758a', lineHeight: 1.65 }}>请确认已核对 PDF 原文、指标数值、单位与页码。操作会记录复核事件。</p><label style={{ display: 'block', fontSize: 12, marginTop: 16 }}>管理员密码<input autoFocus type="password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void loginAndApprove(); }} style={{ width: '100%', marginTop: 7, padding: '10px 11px', border: '1px solid #dce2eb', borderRadius: 7 }} /></label>{adminError && <p style={{ margin: '10px 0 0', color: '#c94756', fontSize: 11 }}>{adminError}</p>}<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}><button className="secondary" disabled={adminSubmitting} onClick={() => setAdminDialogOpen(false)}>取消</button><button className="primary" disabled={adminSubmitting} onClick={() => void loginAndApprove()}>{adminSubmitting ? '正在提交…' : '确认上线'}</button></div></section></div>}
  </main>;
}
