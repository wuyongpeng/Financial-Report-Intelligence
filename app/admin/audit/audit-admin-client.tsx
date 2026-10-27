'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';

type AuditEvent = {
  id: number;
  event_type: string;
  owner_key: string | null;
  ip: string | null;
  user_agent: string | null;
  accept_language: string | null;
  path: string | null;
  referer: string | null;
  report_id: string | null;
  company_code: string | null;
  conversation_id: string | null;
  request_id: string | null;
  question: string | null;
  detail: Record<string, unknown>;
  created_at: string;
};

const EVENT_LABEL: Record<string, string> = {
  visit: '访问',
  ask: '提问',
  answer_feedback: '反馈',
};

function fmtTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
}

function short(text: string | null | undefined, n = 80) {
  if (!text) return '—';
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function detailSummary(ev: AuditEvent) {
  const d = ev.detail || {};
  const bits: string[] = [];
  if (typeof d.vote === 'string') bits.push(d.vote === 'up' ? '赞' : d.vote === 'down' ? '踩' : d.vote);
  if (Array.isArray(d.tags) && d.tags.length) bits.push(`标签:${d.tags.join(',')}`);
  if (typeof d.note === 'string' && d.note.trim()) bits.push(`备注:${d.note}`);
  if (typeof d.period === 'string') bits.push(`期:${d.period}`);
  return bits.length ? bits.join(' · ') : '—';
}

export function AuditAdminClient() {
  const [ready, setReady] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [password, setPassword] = useState('');
  const [eventType, setEventType] = useState('');
  const [companyCode, setCompanyCode] = useState('');
  const [q, setQ] = useState('');
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refreshSession = useCallback(async () => {
    const res = await fetch('/api/auth/session', { cache: 'no-store', credentials: 'same-origin' });
    const body = await res.json().catch(() => ({})) as { admin?: boolean };
    setAdmin(Boolean(body.admin));
    setReady(true);
  }, []);

  useEffect(() => { void refreshSession(); }, [refreshSession]);

  const loginWithPassword = useCallback(async (password: string) => {
    setLoggingIn(true);
    setLoginError('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const body = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        setLoginError(body.error || '登录失败');
        return false;
      }
      setAdmin(true);
      return true;
    } catch {
      setLoginError('登录失败');
      return false;
    } finally {
      setLoggingIn(false);
    }
  }, []);

  const submitLogin = useCallback(async () => {
    if (!password.trim()) {
      setLoginError('请输入管理员密码');
      return;
    }
    const ok = await loginWithPassword(password);
    if (ok) setPassword('');
  }, [loginWithPassword, password]);

  const load = useCallback(async (opts?: { append?: boolean; beforeId?: number | null }) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('limit', '50');
      if (eventType) params.set('eventType', eventType);
      if (companyCode.trim()) params.set('companyCode', companyCode.trim());
      if (q.trim()) params.set('q', q.trim());
      if (opts?.beforeId) params.set('beforeId', String(opts.beforeId));
      const res = await fetch(`/api/admin/audit?${params}`, { cache: 'no-store', credentials: 'same-origin' });
      if (res.status === 401) {
        setAdmin(false);
        setPassword('');
        setError('管理员登录已失效，请重新登录');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || '加载失败');
      }
      const body = await res.json() as { events: AuditEvent[] };
      setEvents((prev) => (opts?.append ? [...prev, ...body.events] : body.events));
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [eventType, companyCode, q]);

  useEffect(() => {
    if (admin) void load();
  }, [admin]); // eslint-disable-line react-hooks/exhaustive-deps -- initial load after login

  async function logout() {
    await fetch('/api/admin/login', { method: 'DELETE', credentials: 'same-origin' });
    setAdmin(false);
    setEvents([]);
    setPassword('');
  }

  if (!ready) {
    return <main style={wrap}><p style={{ color: '#6b7a8d' }}>加载中…</p></main>;
  }

  if (!admin) {
    return (
      <main style={wrap}>
        <h1 style={h1}>访问审计</h1>
        <p style={muted}>需要管理员密码后才能查看访问、提问与反馈记录。</p>
        {loginError ? <p style={err}>{loginError}</p> : null}
        <form
          style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}
          onSubmit={(e) => { e.preventDefault(); void submitLogin(); }}
        >
          <label style={{ ...muted, margin: 0 }} htmlFor="admin-audit-password">管理员密码</label>
          <input
            id="admin-audit-password"
            type="password"
            name="password"
            autoComplete="current-password"
            autoFocus
            style={input}
            value={password}
            disabled={loggingIn}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="请输入密码"
          />
          <button type="submit" style={btn} disabled={loggingIn}>
            {loggingIn ? '登录中…' : '登录'}
          </button>
        </form>
      </main>
    );
  }

  const lastId = events.length ? events[events.length - 1].id : null;

  return (
    <main style={wrapWide}>
      <header style={head}>
        <div>
          <h1 style={{ ...h1, margin: 0 }}>访问审计</h1>
          <p style={{ ...muted, margin: '6px 0 0' }}>/admin/audit · 时间均为 Asia/Shanghai</p>
        </div>
        <button type="button" style={btnGhost} onClick={() => void logout()}>退出</button>
      </header>

      <form
        style={filters}
        onSubmit={(e) => { e.preventDefault(); void load(); }}
      >
        <select value={eventType} onChange={(e) => setEventType(e.target.value)} style={input}>
          <option value="">全部类型</option>
          <option value="visit">访问</option>
          <option value="ask">提问</option>
          <option value="answer_feedback">反馈</option>
        </select>
        <input
          style={input}
          placeholder="股票代码"
          value={companyCode}
          onChange={(e) => setCompanyCode(e.target.value)}
        />
        <input
          style={{ ...input, flex: 1, minWidth: 160 }}
          placeholder="搜问题 / IP / UA"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit" style={btn} disabled={loading}>{loading ? '查询中…' : '查询'}</button>
      </form>

      {error ? <p style={err}>{error}</p> : null}

      <div style={tableWrap}>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>时间</th>
              <th style={th}>类型</th>
              <th style={th}>公司</th>
              <th style={th}>IP</th>
              <th style={th}>问题 / 内容</th>
              <th style={th}>详情</th>
              <th style={th}>浏览器</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && !loading ? (
              <tr><td colSpan={7} style={{ ...td, color: '#8b97a9' }}>暂无记录</td></tr>
            ) : null}
            {events.map((ev) => (
              <tr key={ev.id}>
                <td style={td}>{fmtTime(ev.created_at)}</td>
                <td style={td}>{EVENT_LABEL[ev.event_type] ?? ev.event_type}</td>
                <td style={td}>{ev.company_code || '—'}</td>
                <td style={td} title={ev.owner_key ?? undefined}>{ev.ip || '—'}</td>
                <td style={{ ...td, maxWidth: 320 }} title={ev.question ?? undefined}>{short(ev.question, 100)}</td>
                <td style={{ ...td, maxWidth: 220 }} title={detailSummary(ev)}>{short(detailSummary(ev), 60)}</td>
                <td style={{ ...td, maxWidth: 220 }} title={ev.user_agent ?? undefined}>{short(ev.user_agent, 48)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button type="button" style={btnGhost} disabled={loading} onClick={() => void load()}>刷新</button>
        <button
          type="button"
          style={btnGhost}
          disabled={loading || !lastId}
          onClick={() => void load({ append: true, beforeId: lastId })}
        >
          加载更多
        </button>
        <span style={{ ...muted, alignSelf: 'center' }}>已显示 {events.length} 条</span>
      </div>
    </main>
  );
}

const wrap: CSSProperties = {
  maxWidth: 480, margin: '48px auto', padding: '0 16px',
  fontFamily: 'system-ui, -apple-system, sans-serif', color: '#203047',
};
const wrapWide: CSSProperties = {
  maxWidth: 1200, margin: '24px auto 48px', padding: '0 16px',
  fontFamily: 'system-ui, -apple-system, sans-serif', color: '#203047',
};
const h1: CSSProperties = { fontSize: 22, fontWeight: 650, margin: '0 0 8px' };
const muted: CSSProperties = { fontSize: 13, color: '#6b7a8d', lineHeight: 1.5 };
const input: CSSProperties = {
  border: '1px solid #d5dde8', borderRadius: 8, padding: '8px 10px', fontSize: 14, color: '#203047', background: '#fff',
};
const btn: CSSProperties = {
  border: 0, borderRadius: 8, background: '#3064db', color: '#fff', padding: '8px 14px',
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
const btnGhost: CSSProperties = {
  border: '1px solid #d5dde8', borderRadius: 8, background: '#fff', color: '#3d5270',
  padding: '7px 12px', fontSize: 13, cursor: 'pointer',
};
const err: CSSProperties = { color: '#b91c1c', fontSize: 13, margin: '0 0 12px' };
const head: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16 };
const filters: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 };
const tableWrap: CSSProperties = { overflow: 'auto', border: '1px solid #e5eaf1', borderRadius: 12, background: '#fff' };
const table: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12 };
const th: CSSProperties = {
  textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #e5eaf1',
  background: '#f6f8fc', color: '#5b6d86', fontWeight: 600, whiteSpace: 'nowrap',
};
const td: CSSProperties = {
  padding: '9px 12px', borderBottom: '1px solid #eef1f5', verticalAlign: 'top',
  color: '#3a4d66', overflowWrap: 'anywhere',
};
