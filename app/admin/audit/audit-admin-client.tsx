'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AdminHeader,
  AdminLoginForm,
  adminStyles as s,
  useAdminSession,
} from '../_components/admin-shell';

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
  const session = useAdminSession();
  const [eventType, setEventType] = useState('');
  const [companyCode, setCompanyCode] = useState('');
  const [q, setQ] = useState('');
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
        session.setAdmin(false);
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
  }, [eventType, companyCode, q, session]);

  useEffect(() => {
    if (session.admin) void load();
  }, [session.admin]); // eslint-disable-line react-hooks/exhaustive-deps -- initial load after login

  if (!session.ready) {
    return <main style={s.wrap}><p style={{ color: '#6b7a8d' }}>加载中…</p></main>;
  }

  if (!session.admin) {
    return (
      <AdminLoginForm
        title="访问审计"
        hint="需要管理员密码后才能查看访问、提问与反馈记录。"
        password={session.password}
        setPassword={session.setPassword}
        loginError={session.loginError}
        loggingIn={session.loggingIn}
        onSubmit={() => { void session.submitLogin(); }}
      />
    );
  }

  const lastId = events.length ? events[events.length - 1].id : null;

  return (
    <main style={s.wrapWide}>
      <AdminHeader
        title="访问审计"
        subtitle="/admin/audit · 时间均为 Asia/Shanghai"
        activeHref="/admin/audit"
        onLogout={() => {
          setEvents([]);
          void session.logout();
        }}
      />

      <form
        style={s.filters}
        onSubmit={(e) => { e.preventDefault(); void load(); }}
      >
        <select value={eventType} onChange={(e) => setEventType(e.target.value)} style={s.input}>
          <option value="">全部类型</option>
          <option value="visit">访问</option>
          <option value="ask">提问</option>
          <option value="answer_feedback">反馈</option>
        </select>
        <input
          style={s.input}
          placeholder="股票代码"
          value={companyCode}
          onChange={(e) => setCompanyCode(e.target.value)}
        />
        <input
          style={{ ...s.input, flex: 1, minWidth: 160 }}
          placeholder="搜问题 / IP / UA"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit" style={s.btn} disabled={loading}>{loading ? '查询中…' : '查询'}</button>
      </form>

      {error ? <p style={s.err}>{error}</p> : null}

      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>时间</th>
              <th style={s.th}>类型</th>
              <th style={s.th}>公司</th>
              <th style={s.th}>IP</th>
              <th style={s.th}>问题 / 内容</th>
              <th style={s.th}>详情</th>
              <th style={s.th}>浏览器</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && !loading ? (
              <tr><td colSpan={7} style={{ ...s.td, color: '#8b97a9' }}>暂无记录</td></tr>
            ) : null}
            {events.map((ev) => (
              <tr key={ev.id}>
                <td style={s.td}>{fmtTime(ev.created_at)}</td>
                <td style={s.td}>{EVENT_LABEL[ev.event_type] ?? ev.event_type}</td>
                <td style={s.td}>{ev.company_code || '—'}</td>
                <td style={s.td} title={ev.owner_key ?? undefined}>{ev.ip || '—'}</td>
                <td style={{ ...s.td, maxWidth: 320 }} title={ev.question ?? undefined}>{short(ev.question, 100)}</td>
                <td style={{ ...s.td, maxWidth: 220 }} title={detailSummary(ev)}>{short(detailSummary(ev), 60)}</td>
                <td style={{ ...s.td, maxWidth: 220 }} title={ev.user_agent ?? undefined}>{short(ev.user_agent, 48)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button type="button" style={s.btnGhost} disabled={loading} onClick={() => void load()}>刷新</button>
        <button
          type="button"
          style={s.btnGhost}
          disabled={loading || !lastId}
          onClick={() => void load({ append: true, beforeId: lastId })}
        >
          加载更多
        </button>
        <span style={{ ...s.muted, alignSelf: 'center' }}>已显示 {events.length} 条</span>
      </div>
    </main>
  );
}
