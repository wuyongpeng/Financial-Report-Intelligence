'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  AdminHeader,
  AdminHelpTip,
  AdminMain,
  adminStyles as s,
} from '../_components/admin-shell';
import { AiSummarizePanel } from '../_components/ai-summarize-card';
import { matchesQuickSearch } from '@/lib/admin-table-search';
import { auditTraceRows, auditTraceText, type AuditTraceInput } from '@/lib/audit-trace';

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

function companyCell(ev: AuditEvent) {
  const d = ev.detail || {};
  const period = typeof d.period === 'string' && d.period.trim() ? d.period.trim() : '';
  if (ev.company_code && period) return `${ev.company_code} · ${period}`;
  if (ev.company_code) return ev.company_code;
  if (period) return period;
  return '—';
}

type AuditTurn = {
  prompt: string | null;
  reply: string | null;
  durationMs: number | null;
  status: string | null;
  mode: string | null;
};

function traceInput(ev: AuditEvent, turn?: AuditTurn | null): AuditTraceInput {
  const assembled = typeof ev.detail?.assembled === 'string' ? ev.detail.assembled.trim() : '';
  return {
    eventType: ev.event_type,
    eventLabel: EVENT_LABEL[ev.event_type] ?? ev.event_type,
    createdAt: fmtTime(ev.created_at),
    company: companyCell(ev),
    ip: ev.ip,
    ownerKey: ev.owner_key,
    path: ev.path,
    referer: ev.referer,
    userAgent: ev.user_agent,
    acceptLanguage: ev.accept_language,
    reportId: ev.report_id,
    conversationId: ev.conversation_id,
    requestId: ev.request_id,
    prompt: assembled || turn?.prompt || ev.question,
    reply: turn?.reply ?? null,
    detail: ev.detail || {},
    durationMs: turn?.durationMs ?? null,
  };
}

export function AuditAdminClient() {
  const [eventType, setEventType] = useState('');
  const [q, setQ] = useState('');
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detailTurn, setDetailTurn] = useState<AuditTurn | null>(null);
  const [detailEvent, setDetailEvent] = useState<AuditEvent | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [menu, setMenu] = useState<{ id: number; top: number; left: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AuditEvent | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async (opts?: { append?: boolean; beforeId?: number | null }) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('limit', '50');
      if (eventType) params.set('eventType', eventType);
      if (q.trim()) params.set('q', q.trim());
      if (opts?.beforeId) params.set('beforeId', String(opts.beforeId));
      const res = await fetch(`/api/admin/audit?${params}`, { cache: 'no-store', credentials: 'same-origin' });
      if (res.status === 401) {
        setError('请求未授权，请刷新后重试');
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
  }, [eventType, q]);

  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- initial load

  const filteredEvents = useMemo(() => {
    const query = q.trim();
    if (!query) return events;
    return events.filter((ev) => matchesQuickSearch(query, [
      fmtTime(ev.created_at),
      EVENT_LABEL[ev.event_type] ?? ev.event_type,
      ev.event_type,
      companyCell(ev),
      ev.company_code,
      ev.ip,
      ev.owner_key,
      ev.question,
      detailSummary(ev),
      ev.user_agent,
      ev.path,
      ev.referer,
      ev.report_id,
      ev.conversation_id,
      ev.request_id,
      JSON.stringify(ev.detail ?? {}),
    ]));
  }, [events, q]);

  const lastId = events.length ? events[events.length - 1].id : null;
  const openEvent = detailEvent ?? events.find((ev) => ev.id === detailId) ?? null;

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [menu]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function loadDetail(ev: AuditEvent) {
    setDetailId(ev.id);
    setDetailEvent(ev);
    setDetailTurn(null);
    setDetailLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/audit/${ev.id}`, { cache: 'no-store', credentials: 'same-origin' });
      const body = await res.json().catch(() => ({})) as { error?: string; event?: AuditEvent; turn?: AuditTurn };
      if (!res.ok) throw new Error(body.error || '详情加载失败');
      if (body.event) setDetailEvent(body.event);
      setDetailTurn(body.turn ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '详情加载失败');
    } finally {
      setDetailLoading(false);
    }
  }

  async function copyTrace(ev: AuditEvent) {
    setMenu(null);
    setError('');
    try {
      let turn = detailId === ev.id ? detailTurn : null;
      let event = ev;
      if (!turn) {
        const res = await fetch(`/api/admin/audit/${ev.id}`, { cache: 'no-store', credentials: 'same-origin' });
        const body = await res.json().catch(() => ({})) as { error?: string; event?: AuditEvent; turn?: AuditTurn };
        if (!res.ok) throw new Error(body.error || '复制失败');
        if (body.event) event = body.event;
        turn = body.turn ?? null;
      }
      await navigator.clipboard.writeText(auditTraceText(traceInput(event, turn)));
      setCopied(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '复制失败');
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/audit/${pendingDelete.id}`, { method: 'DELETE', credentials: 'same-origin' });
      const body = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(body.error || '删除失败');
      setEvents((prev) => prev.filter((item) => item.id !== pendingDelete.id));
      if (detailId === pendingDelete.id) {
        setDetailId(null);
        setDetailEvent(null);
        setDetailTurn(null);
      }
      setPendingDelete(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AdminMain>
      <AdminHeader
        title="访问审计"
        activeHref="/admin/audit"
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <form
          style={{ ...s.filters, marginBottom: 0, flex: '1 1 auto' }}
          onSubmit={(e) => { e.preventDefault(); void load(); }}
        >
          <select value={eventType} onChange={(e) => setEventType(e.target.value)} style={s.input}>
            <option value="">全部类型</option>
            <option value="visit">访问</option>
            <option value="ask">提问</option>
            <option value="answer_feedback">反馈</option>
          </select>
          <input
            style={{ ...s.input, width: 180, flex: '0 1 220px', fontSize: 12, padding: '5px 8px' }}
            placeholder="快速检索"
            value={q}
            maxLength={80}
            onChange={(e) => setQ(e.target.value)}
          />
          <button type="submit" style={s.btn} disabled={loading}>{loading ? '查询中…' : '查询'}</button>
          <AdminHelpTip text="时间均为 Asia/Shanghai" />
        </form>

        <AiSummarizePanel
          scope="audit"
          inline
        />
      </div>

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
              <th style={s.th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredEvents.length === 0 && !loading ? (
              <tr><td colSpan={8} style={{ ...s.td, color: '#8b97a9' }}>暂无记录</td></tr>
            ) : null}
            {filteredEvents.map((ev) => (
              <tr key={ev.id}>
                <td style={s.td}>{fmtTime(ev.created_at)}</td>
                <td style={s.td}>{EVENT_LABEL[ev.event_type] ?? ev.event_type}</td>
                <td style={s.td}>{companyCell(ev)}</td>
                <td style={s.td} title={ev.owner_key ?? undefined}>{ev.ip || '—'}</td>
                <td style={{ ...s.td, maxWidth: 320 }} title={ev.question ?? undefined}>{short(ev.question, 100)}</td>
                <td style={{ ...s.td, maxWidth: 220 }} title={detailSummary(ev)}>{short(detailSummary(ev), 60)}</td>
                <td style={{ ...s.td, maxWidth: 220 }} title={ev.user_agent ?? undefined}>{short(ev.user_agent, 48)}</td>
                <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                  <button type="button" style={textAct} onClick={() => void loadDetail(ev)}>详情</button>
                  <button
                    type="button"
                    style={textAct}
                    aria-label="更多操作"
                    aria-expanded={menu?.id === ev.id}
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      setMenu((current) => current?.id === ev.id ? null : { id: ev.id, top: rect.bottom + 4, left: rect.right });
                    }}
                  >
                    •••
                  </button>
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
        <span style={{ ...s.muted, alignSelf: 'center' }}>已显示 {filteredEvents.length}{filteredEvents.length !== events.length ? ` / ${events.length}` : ''} 条</span>
      </div>
      {copied ? <p style={{ ...s.muted, marginTop: 8 }}>已复制这条记录，可直接贴到 Bug 单。</p> : null}
      {menu ? (
        <>
          <button type="button" aria-label="关闭操作菜单" style={menuBackdrop} onClick={() => setMenu(null)} />
          <div role="menu" style={{ ...opsMenu, top: menu.top, left: menu.left }}>
            <button
              type="button"
              style={menuItem}
              onClick={() => {
                const ev = events.find((item) => item.id === menu.id);
                if (ev) void copyTrace(ev);
              }}
            >
              复制
            </button>
            <button
              type="button"
              style={{ ...menuItem, color: '#b91c1c' }}
              onClick={() => {
                const ev = events.find((item) => item.id === menu.id);
                setMenu(null);
                if (ev) setPendingDelete(ev);
              }}
            >
              删除
            </button>
          </div>
        </>
      ) : null}
      {openEvent ? (
        <div style={overlay} onClick={() => { setDetailId(null); setDetailEvent(null); }}>
          <div role="dialog" aria-label="访问记录详情" style={dialog} onClick={(event) => event.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>访问记录详情</h3>
              <button type="button" style={textAct} onClick={() => { setDetailId(null); setDetailEvent(null); }}>关闭</button>
            </div>
            {detailLoading ? <p style={{ ...s.muted, margin: '12px 0 0' }}>正在读取回复和耗时…</p> : null}
            <table style={{ ...s.table, marginTop: 12 }}>
              <tbody>
                {auditTraceRows(traceInput(openEvent, detailTurn)).map((row) => (
                  <tr key={row.label}>
                    <th style={{ ...s.th, width: 132, whiteSpace: 'nowrap' }}>{row.label}</th>
                    <td style={traceCell}>{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      {pendingDelete ? (
        <div style={overlay} onClick={() => { if (!deleting) setPendingDelete(null); }}>
          <div role="dialog" aria-label="确认删除访问记录" style={confirmBox} onClick={(event) => event.stopPropagation()}>
            <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>删除这条访问记录？</h3>
            <p style={{ ...s.muted, margin: 0 }}>{fmtTime(pendingDelete.created_at)} · {EVENT_LABEL[pendingDelete.event_type] ?? pendingDelete.event_type} · {pendingDelete.ip || '无 IP'}</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button type="button" style={textAct} disabled={deleting} onClick={() => setPendingDelete(null)}>取消</button>
              <button type="button" style={{ ...textAct, color: '#b91c1c' }} disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? '删除中…' : '删除'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </AdminMain>
  );
}

const textAct: CSSProperties = {
  border: 0,
  background: 'transparent',
  padding: '0 6px',
  fontSize: 12,
  fontWeight: 600,
  color: '#1f4fad',
  cursor: 'pointer',
};

const menuItem: CSSProperties = {
  border: 0,
  background: 'transparent',
  textAlign: 'left',
  padding: '7px 12px',
  fontSize: 12,
  color: '#31465f',
  cursor: 'pointer',
};

const menuBackdrop: CSSProperties = {
  position: 'fixed',
  inset: 0,
  border: 0,
  background: 'transparent',
  zIndex: 30,
};

const opsMenu: CSSProperties = {
  position: 'fixed',
  transform: 'translateX(-100%)',
  zIndex: 31,
  minWidth: 88,
  display: 'flex',
  flexDirection: 'column',
  background: '#fff',
  border: '1px solid #e6ebf2',
  borderRadius: 8,
  boxShadow: '0 8px 20px #13213b14',
  padding: 4,
};

const overlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: '#12213f66',
  display: 'grid',
  placeItems: 'center',
  zIndex: 40,
  padding: 16,
};

const dialog: CSSProperties = {
  width: 'min(760px, 100%)',
  maxHeight: 'min(80vh, 720px)',
  overflow: 'auto',
  background: '#fff',
  borderRadius: 12,
  padding: 16,
};

const confirmBox: CSSProperties = {
  width: 360,
  background: '#fff',
  borderRadius: 12,
  padding: 16,
};

const traceCell: CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid #eef2f6',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  verticalAlign: 'top',
  fontSize: 12,
  lineHeight: 1.5,
  maxWidth: 560,
};
