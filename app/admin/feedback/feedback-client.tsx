'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AdminHeader,
  AdminHelpTip,
  AdminMain,
  adminStyles as s,
} from '../_components/admin-shell';
import { AiSummarizePanel } from '../_components/ai-summarize-card';
import { matchesQuickSearch } from '@/lib/admin-table-search';

type FeedbackItem = {
  id: number;
  category: string | null;
  message: string;
  contact: string | null;
  page: string | null;
  url: string | null;
  user_agent: string | null;
  handling_status: string | null;
  created_at: string;
};

const STATUS_LABEL: Record<string, string> = {
  open: '未处理',
  in_progress: '处理中',
  resolved: '已处理',
};

function fmtTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
}

export function FeedbackAdminClient() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

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
        setError('请求未授权，请刷新后重试');
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
  }, []);

  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredItems = useMemo(() => {
    const q = search.trim();
    if (!q) return items;
    return items.filter((item) => matchesQuickSearch(q, [
      fmtTime(item.created_at),
      item.category || '其它',
      item.message,
      item.contact,
      item.page,
      item.url,
      item.user_agent,
    ]));
  }, [items, search]);

  const lastId = items.length ? items[items.length - 1].id : null;

  async function setStatus(id: number, status: 'in_progress' | 'resolved' | 'open') {
    setError('');
    try {
      const res = await fetch('/api/admin/feedback', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      const body = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(body.error || '状态没有保存');
      setItems((prev) => prev.map((item) => item.id === id ? { ...item, handling_status: status } : item));
    } catch (e) {
      setError(e instanceof Error ? e.message : '状态没有保存');
    }
  }

  return (
    <AdminMain>
      <AdminHeader
        title="反馈收集"
        activeHref="/admin/feedback"
      />
      {error ? <p style={s.err}>{error}</p> : null}
      <AiSummarizePanel
        scope="feedback"
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <input
          style={{ ...s.input, width: 180, flex: '0 1 220px', fontSize: 12, padding: '5px 8px' }}
          value={search}
          maxLength={80}
          placeholder="快速检索"
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>时间</th>
              <th style={s.th}>类型</th>
              <th style={s.th}>反馈</th>
              <th style={s.th}>联系方式</th>
              <th style={s.th}>页面</th>
              <th style={s.th}>状态</th>
            </tr>
          </thead>
          <tbody>
            {!loading && items.length === 0 ? (
              <tr><td colSpan={6} style={{ ...s.td, color: '#8b97a9' }}>暂无反馈</td></tr>
            ) : null}
            {!loading && items.length > 0 && filteredItems.length === 0 ? (
              <tr><td colSpan={6} style={{ ...s.td, color: '#8b97a9' }}>暂无匹配</td></tr>
            ) : null}
            {filteredItems.map((item) => (
              <tr key={item.id}>
                <td style={{ ...s.td, whiteSpace: 'nowrap' }}>{fmtTime(item.created_at)}</td>
                <td style={{ ...s.td, whiteSpace: 'nowrap' }}>{item.category || '其它'}</td>
                <td style={{ ...s.td, maxWidth: 420, whiteSpace: 'pre-wrap' }}>{item.message}</td>
                <td style={{ ...s.td, whiteSpace: 'nowrap' }}>{item.contact || '—'}</td>
                <td style={s.td} title={item.url ?? undefined}>{item.page || item.url || '—'}</td>
                <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                  <span style={{
                    fontWeight: 650,
                    color: item.handling_status === 'resolved' ? '#15803d' : item.handling_status === 'in_progress' ? '#b45309' : '#6b7a8d',
                  }}
                  >
                    {STATUS_LABEL[item.handling_status || 'open'] || '未处理'}
                  </span>
                  <button type="button" style={textAct} disabled={item.handling_status === 'in_progress'} onClick={() => void setStatus(item.id, 'in_progress')}>处理中</button>
                  <button type="button" style={textAct} disabled={item.handling_status === 'resolved'} onClick={() => void setStatus(item.id, 'resolved')}>已处理</button>
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
        <span style={{ ...s.muted, alignSelf: 'center', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          已显示 {filteredItems.length}{filteredItems.length !== items.length ? ` / ${items.length}` : ''} 条
          <AdminHelpTip text="产品内用户反馈；时间均为 Asia/Shanghai" />
        </span>
      </div>
    </AdminMain>
  );
}

const textAct = {
  border: 0,
  background: 'transparent',
  padding: '0 6px',
  fontSize: 12,
  fontWeight: 600,
  color: '#1f4fad',
  cursor: 'pointer',
} as const;
