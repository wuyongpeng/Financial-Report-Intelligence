'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  AdminHeader,
  AdminLoginForm,
  AdminMain,
  adminStyles as s,
  useAdminSession,
} from '../_components/admin-shell';
import type { SurveyBasic, SurveyDeep } from '@/lib/survey';

type Invite = {
  id: number;
  token: string;
  note: string | null;
  active: boolean;
  createdAt: string;
  responseCount: number;
  path: string;
};

type ResponseItem = {
  id: number;
  inviteId: number;
  token: string;
  nickname: string | null;
  basic: SurveyBasic;
  deep: SurveyDeep | null;
  createdAt: string;
};

type Summary = {
  responseCount: number;
  deepCount: number;
  b1: Record<string, number>;
  b2: Record<string, number>;
  b3: Record<string, number>;
  b4: Record<string, number>;
  b5: Record<string, number>;
  d4Top: Array<{ label: string; count: number }>;
};

function fmtTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
}

function distLine(map: Record<string, number>) {
  const entries = Object.entries(map);
  if (!entries.length) return '—';
  return entries
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ');
}

function originBase() {
  if (typeof window === 'undefined') return '';
  return window.location.origin;
}

function shortDeep(deep: SurveyDeep | null) {
  if (!deep) return '—';
  const bits: string[] = [];
  if (deep.d1?.length) bits.push(`价值:${deep.d1.join('>')}`);
  if (deep.d2?.choice) bits.push(`卡住:${deep.d2.choice}${deep.d2.note ? `(${deep.d2.note})` : ''}`);
  if (typeof deep.d3 === 'number') bits.push(`信任:${deep.d3}`);
  if (deep.d4?.choices?.length) bits.push(`再来:${deep.d4.choices.join('/')}`);
  if (deep.d5) bits.push(deep.d5);
  return bits.length ? bits.join(' · ') : '—';
}

export function SurveyAdminClient() {
  const session = useAdminSession();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [responses, setResponses] = useState<ResponseItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/survey', { cache: 'no-store', credentials: 'same-origin' });
      if (res.status === 401) {
        session.setAdmin(false);
        setError('管理员登录已失效，请重新登录');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || '加载失败');
      }
      const body = await res.json() as {
        invites: Invite[];
        responses: ResponseItem[];
        summary: Summary;
      };
      setInvites(body.invites);
      setResponses(body.responses);
      setSummary(body.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (session.admin) void load();
  }, [session.admin]); // eslint-disable-line react-hooks/exhaustive-deps

  const createInvite = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/admin/survey', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (res.status === 401) {
        session.setAdmin(false);
        setError('管理员登录已失效，请重新登录');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || '生成失败');
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败');
    } finally {
      setBusy(false);
    }
  }, [load, session]);

  const setActive = useCallback(async (token: string, active: boolean) => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/admin/survey', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, active }),
      });
      if (res.status === 401) {
        session.setAdmin(false);
        setError('管理员登录已失效，请重新登录');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || '更新失败');
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新失败');
    } finally {
      setBusy(false);
    }
  }, [load, session]);

  const copyUrl = useCallback(async (path: string, token: string) => {
    const url = `${originBase()}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(token);
      window.setTimeout(() => setCopied((cur) => (cur === token ? '' : cur)), 1600);
    } catch {
      setError('复制失败，请手动选中链接');
    }
  }, []);

  const cards = useMemo(() => {
    if (!summary) return [];
    return [
      { label: '回收份数', value: String(summary.responseCount) },
      { label: '含深入反馈', value: String(summary.deepCount) },
      { label: '上手（B2）', value: distLine(summary.b2) },
      { label: '三栏（B3）', value: distLine(summary.b3) },
      { label: '角标（B4）', value: distLine(summary.b4) },
      { label: '还会来（B5）', value: distLine(summary.b5) },
    ];
  }, [summary]);

  if (!session.ready) {
    return <AdminMain><p style={{ color: '#6b7a8d' }}>加载中…</p></AdminMain>;
  }

  if (!session.admin) {
    return (
      <AdminLoginForm
        title="用户调研"
        hint="需要管理员密码后才能查看调研结果。"
        password={session.password}
        setPassword={session.setPassword}
        loginError={session.loginError}
        loggingIn={session.loggingIn}
        onSubmit={() => { void session.submitLogin(); }}
      />
    );
  }

  return (
    <AdminMain>
      <AdminHeader
        title="用户调研"
        subtitle="/admin/survey · 时间均为 Asia/Shanghai"
        activeHref="/admin/survey"
        onLogout={() => { void session.logout(); }}
      />
      {error ? <p style={s.err}>{error}</p> : null}

      <section style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
          <button type="button" style={s.btn} disabled={busy || loading} onClick={() => void createInvite()}>
            生成邀请链接
          </button>
          <button type="button" style={s.btnGhost} disabled={loading || busy} onClick={() => void load()}>
            刷新
          </button>
        </div>
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>短码</th>
                <th style={s.th}>链接</th>
                <th style={s.th}>创建时间</th>
                <th style={s.th}>回收</th>
                <th style={s.th}>状态</th>
                <th style={s.th}>操作</th>
              </tr>
            </thead>
            <tbody>
              {!loading && invites.length === 0 ? (
                <tr><td colSpan={6} style={{ ...s.td, color: '#8b97a9' }}>暂无邀请</td></tr>
              ) : null}
              {invites.map((item) => {
                const full = `${originBase()}${item.path}`;
                return (
                  <tr key={item.id} style={item.active ? undefined : { opacity: 0.55 }}>
                    <td style={{ ...s.td, whiteSpace: 'nowrap', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                      {item.token}
                    </td>
                    <td style={{ ...s.td, maxWidth: 360 }} title={full}>
                      <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                        {item.path}
                      </span>
                    </td>
                    <td style={{ ...s.td, whiteSpace: 'nowrap' }}>{fmtTime(item.createdAt)}</td>
                    <td style={{ ...s.td, whiteSpace: 'nowrap' }}>{item.responseCount}</td>
                    <td style={{ ...s.td, whiteSpace: 'nowrap' }}>{item.active ? '有效' : '已作废'}</td>
                    <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        style={{ ...s.btnGhost, padding: '4px 8px', marginRight: 6 }}
                        disabled={busy}
                        onClick={() => void copyUrl(item.path, item.token)}
                      >
                        {copied === item.token ? '已复制' : '复制'}
                      </button>
                      {item.active ? (
                        <button
                          type="button"
                          style={{ ...s.btnGhost, padding: '4px 8px' }}
                          disabled={busy}
                          onClick={() => void setActive(item.token, false)}
                        >
                          作废
                        </button>
                      ) : (
                        <button
                          type="button"
                          style={{ ...s.btnGhost, padding: '4px 8px' }}
                          disabled={busy}
                          onClick={() => void setActive(item.token, true)}
                        >
                          恢复
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ marginBottom: 18 }}>
        <div style={s.cardRow}>
          {cards.map((card) => (
            <div key={card.label} style={s.card}>
              <p style={s.cardLabel}>{card.label}</p>
              <p style={{ ...s.cardValue, fontSize: card.value.length > 18 ? 13 : 18, lineHeight: 1.35 }}>
                {card.value}
              </p>
            </div>
          ))}
        </div>
        {summary?.d4Top?.length ? (
          <p style={{ ...s.muted, margin: '0 0 8px' }}>
            深入·更愿意再用 Top：{summary.d4Top.map((x) => `${x.label} ${x.count}`).join(' · ')}
          </p>
        ) : null}
      </section>

      <section>
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>时间</th>
                <th style={s.th}>昵称</th>
                <th style={s.th}>短码</th>
                <th style={s.th}>B1–B5</th>
                <th style={s.th}>深入</th>
              </tr>
            </thead>
            <tbody>
              {!loading && responses.length === 0 ? (
                <tr><td colSpan={5} style={{ ...s.td, color: '#8b97a9' }}>暂无回收</td></tr>
              ) : null}
              {responses.map((item) => {
                const b = item.basic;
                const basicLine = [b.b1, b.b2, b.b3, b.b4, b.b5].filter(Boolean).join(' · ');
                return (
                  <tr key={item.id}>
                    <td style={{ ...s.td, whiteSpace: 'nowrap' }}>{fmtTime(item.createdAt)}</td>
                    <td style={{ ...s.td, whiteSpace: 'nowrap' }}>{item.nickname || '—'}</td>
                    <td style={{ ...s.td, whiteSpace: 'nowrap', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                      {item.token}
                    </td>
                    <td style={{ ...s.td, maxWidth: 420 }} title={basicLine}>{basicLine || '—'}</td>
                    <td style={{ ...s.td, maxWidth: 420, whiteSpace: 'pre-wrap' } as CSSProperties}>
                      {shortDeep(item.deep)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {loading ? <p style={{ ...s.muted, marginTop: 10 }}>加载中…</p> : null}
      </section>
    </AdminMain>
  );
}
