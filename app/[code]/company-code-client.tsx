'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import CompanyDetail from '../company-detail';
import type { Report } from '@/lib/detail-model';
import companiesJson from '@/data/companies.json';

type CompanyMeta = {
  code: string;
  name: string;
  industry: string;
  exchange: string;
};

function placeholderReport(code: string, meta?: CompanyMeta | null): Report {
  return {
    id: `pending:${code}`,
    code,
    company_name: meta?.name ?? code,
    title: `${meta?.name ?? code} · 等待抓取`,
    report_type: 'annual',
    published_at: new Date().toISOString(),
    parsed_at: null,
    industry: meta?.industry ?? '',
    status: 'discovered',
    metrics: [],
  };
}

export default function CompanyCodeClient({ code }: { code: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const autoAskQuestion = useMemo(() => {
    const q = searchParams.get('q');
    return q && q.trim() ? q.trim() : null;
  }, [searchParams]);
  const preferredPeriod = useMemo(() => {
    const p = searchParams.get('period');
    return p && p.trim() ? p.trim() : null;
  }, [searchParams]);
  const meta = (companiesJson as CompanyMeta[]).find((item) => item.code === code) ?? null;
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adminDialogOpen, setAdminDialogOpen] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminError, setAdminError] = useState('');
  const [adminSubmitting, setAdminSubmitting] = useState(false);
  const [reviewReportId, setReviewReportId] = useState<string | null>(null);
  const adminMode = searchParams.get('admin') === '1';

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const response = await fetch(`/api/reports?code=${encodeURIComponent(code)}&limit=100`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`公告接口 ${response.status}`);
        const payload = await response.json() as { reports?: Report[] };
        if (!active) return;
        const reports = payload.reports ?? [];
        const preferred = reports.find((item) => item.metrics?.length)
          ?? reports[0]
          ?? placeholderReport(code, meta);
        setReport(preferred);
        setError('');
      } catch (err) {
        if (!active) return;
        setReport(placeholderReport(code, meta));
        setError(`真实财报暂时无法读取：${String(err)}`);
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [code, meta]);

  function approveReport(reportId: string) {
    setReviewReportId(reportId);
    setAdminPassword('');
    setAdminError('');
    setAdminDialogOpen(true);
  }

  async function loginAndApprove() {
    if (!reviewReportId || !adminPassword) { setAdminError('请输入管理员密码。'); return; }
    setAdminSubmitting(true); setAdminError('');
    try {
      const login = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: adminPassword }),
      });
      const loginPayload = await login.json() as { error?: string };
      if (!login.ok) { setAdminError(loginPayload.error ?? '登录失败。'); return; }
      const response = await fetch(`/api/admin/reports/${encodeURIComponent(reviewReportId)}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setAdminError(payload.error ?? '复核状态更新失败，请稍后重试。'); return; }
      setReport((current) => current && current.id === reviewReportId
        ? { ...current, status: 'online', metrics: current.metrics.map((metric) => ({ ...metric, verified: 1 })) }
        : current);
      setAdminDialogOpen(false);
    } catch {
      setAdminError('网络或服务暂时不可用，请稍后重试。');
    } finally {
      setAdminSubmitting(false);
    }
  }

  if (loading && !report) {
    return (
      <main className="app-shell">
        <section className="lane-page">
          <div className="honest-empty page-opening">
            <span className="page-opening-spin" aria-hidden="true" />
            <b>正在打开 {code}</b>
            <p>读取该公司财报与指标…</p>
          </div>
        </section>
      </main>
    );
  }

  if (!report) {
    return (
      <main className="app-shell">
        <section className="lane-page">
          <div className="honest-empty">
            <b>未找到公司 {code}</b>
            <p>请确认六位 A 股代码，或返回首页从监控池进入。</p>
            <button className="primary" onClick={() => router.push('/')}>返回首页</button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      {error && (
        <div style={{ maxWidth: 1120, margin: '12px auto 0', padding: '10px 14px', background: '#fff9ef', border: '1px solid #eddbc4', borderRadius: 8, color: '#a27743', fontSize: 13 }}>
          {error}
        </div>
      )}
      <CompanyDetail
        key={report.code}
        initialReport={report}
        onBack={() => router.push('/')}
        onSelect={() => undefined}
        onApprove={adminMode ? approveReport : undefined}
        autoAskQuestion={autoAskQuestion}
        preferredPeriod={preferredPeriod}
      />
      {adminDialogOpen && (
        <div className="drawer-backdrop" onClick={() => !adminSubmitting && setAdminDialogOpen(false)}>
          <section
            onClick={(event) => event.stopPropagation()}
            style={{ width: 'min(400px, calc(100% - 32px))', height: 'max-content', margin: 'auto', padding: 24, background: '#fff', borderRadius: 14, boxShadow: '0 20px 60px #13213b40' }}
          >
            <span className="section-kicker">ADMIN REVIEW</span>
            <h2 style={{ margin: '7px 0', fontSize: 20 }}>复核并正式上线</h2>
            <p style={{ fontSize: 12, color: '#68758a', lineHeight: 1.65 }}>请确认已核对 PDF 原文、指标数值、单位与页码。操作会记录复核事件。</p>
            <label style={{ display: 'block', fontSize: 12, marginTop: 16 }}>
              管理员密码
              <input
                autoFocus
                type="password"
                value={adminPassword}
                onChange={(event) => setAdminPassword(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void loginAndApprove(); }}
                style={{ width: '100%', marginTop: 7, padding: '10px 11px', border: '1px solid #dce2eb', borderRadius: 7 }}
              />
            </label>
            {adminError && <p style={{ margin: '10px 0 0', color: '#c94756', fontSize: 11 }}>{adminError}</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button className="secondary" disabled={adminSubmitting} onClick={() => setAdminDialogOpen(false)}>取消</button>
              <button className="primary" disabled={adminSubmitting} onClick={() => void loginAndApprove()}>
                {adminSubmitting ? '正在提交…' : '确认上线'}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
