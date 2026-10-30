'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AdminHeader,
  AdminLoginForm,
  adminStyles as s,
  useAdminSession,
} from '../_components/admin-shell';

type FeedbackItem = {
  id: number;
  category: string | null;
  message: string;
  contact: string | null;
  page: string | null;
  url: string | null;
  user_agent: string | null;
  created_at: string;
};

function fmtTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
}

export function FeedbackAdminClient() {
  const session = useAdminSession();
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (opts?: { append?: boolean; beforeId?: number | null }) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('limit', '50');
      if (opts?.beforeId) params.set('beforeId', String(opts.beforeId));
      const res = await fetch(`/api/admin/feedback?${params}`, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (res.status === 401) {
        session.setAdmin(false);
        setError('管理员登录已失效，请重新登录');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || '加载失败');
      }
      const body = await res.json() as { items: FeedbackItem[] };
      setItems((prev) => (opts?.append ? [...prev, ...body.items] : body.items));
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (session.admin) void load();
  }, [session.admin]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!session.ready) {
    return <main style={s.wrap}><p style={{ color: '#6b7a8d' }}>加载中…</p></main>;
  }

  if (!session.admin) {
    return (
      <AdminLoginForm
        title="意见收集"
        hint="需要管理员密码后才能查看用户反馈。"
        password={session.password}
        setPassword={session.setPassword}
        loginError={session.loginError}
        loggingIn={session.loggingIn}
        onSubmit={() => { void session.submitLogin(); }}
      />
    );
  }

  const lastId = items.length ? items[items.length - 1].id : null;

  return (
    <main style={s.wrapWide}>
      <AdminHeader
        title="意见收集"
        subtitle="/admin/feedback · 时间均为 Asia/Shanghai"
        activeHref="/admin/feedback"
        onLogout={() => { void session.logout(); }}
      />
      {error ? <p style={s.err}>{error}</p> : null}
      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>时间</th>
              <th style={s.th}>类型</th>
              <th style={s.th}>反馈</th>
              <th style={s.th}>联系方式</th>
              <th style={s.th}>页面</th>
              <th style={s.th}>浏览器</th>
            </tr>
          </thead>
          <tbody>
            {!loading && items.length === 0 ? (
              <tr><td colSpan={6} style={{ ...s.td, color: '#8b97a9' }}>暂无反馈</td></tr>
            ) : null}
            {items.map((item) => (
              <tr key={item.id}>
                <td style={{ ...s.td, whiteSpace: 'nowrap' }}>{fmtTime(item.created_at)}</td>
                <td style={{ ...s.td, whiteSpace: 'nowrap' }}>{item.category || '其它'}</td>
                <td style={{ ...s.td, maxWidth: 420, whiteSpace: 'pre-wrap' }}>{item.message}</td>
                <td style={{ ...s.td, whiteSpace: 'nowrap' }}>{item.contact || '—'}</td>
                <td style={s.td} title={item.url ?? undefined}>{item.page || item.url || '—'}</td>
                <td style={{ ...s.td, maxWidth: 220 }} title={item.user_agent ?? undefined}>
                  {item.user_agent ? (item.user_agent.length > 48 ? `${item.user_agent.slice(0, 48)}…` : item.user_agent) : '—'}
                </td>
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
        <span style={{ ...s.muted, alignSelf: 'center' }}>已显示 {items.length} 条</span>
      </div>
    </main>
  );
}
