'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  AdminHeader,
  AdminLoginForm,
  AdminMain,
  adminStyles as s,
  useAdminSession,
} from '../_components/admin-shell';
import { formatSurveyBasicLine, formatSurveyDeepLine, type SurveyBasic, type SurveyDeep } from '@/lib/survey';

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
  inviteNote: string | null;
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
  b6: Record<string, number>;
  d4Top: Array<{ label: string; count: number }>;
};

type TabKey = 'invites' | 'results';
type FeedbackFilter = 'all' | 'done' | 'pending';

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

function inviteUrl(pathOrToken: string) {
  const path = pathOrToken.startsWith('/') ? pathOrToken : `/survey/${pathOrToken}`;
  return `${originBase()}${path}`;
}

async function copyTextReliable(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Non-secure contexts (plain http LAN) often reject clipboard API.
    }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

const tabBtn = (active: boolean): CSSProperties => ({
  fontSize: 13,
  color: active ? '#1f4fad' : '#5b6d86',
  background: active ? '#edf3ff' : '#fff',
  border: active ? '1px solid #aec4ef' : '1px solid #d5dde8',
  borderRadius: 999,
  padding: '6px 14px',
  fontWeight: active ? 600 : 500,
  cursor: 'pointer',
});

const noteInput: CSSProperties = {
  ...s.input,
  fontSize: 12,
  padding: '5px 8px',
  minWidth: 120,
  maxWidth: 220,
  width: '100%',
};

export function SurveyAdminClient() {
  const session = useAdminSession();
  const [tab, setTab] = useState<TabKey>('invites');
  const [invites, setInvites] = useState<Invite[]>([]);
  const [responses, setResponses] = useState<ResponseItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [createNote, setCreateNote] = useState('');
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [savingNote, setSavingNote] = useState('');
  const [inviteFeedbackFilter, setInviteFeedbackFilter] = useState<FeedbackFilter>('all');

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
      setNoteDrafts((prev) => {
        const next: Record<string, string> = {};
        for (const item of body.invites) {
          next[item.token] = Object.prototype.hasOwnProperty.call(prev, item.token)
            ? prev[item.token]!
            : (item.note ?? '');
        }
        return next;
      });
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
      const note = createNote.trim();
      const res = await fetch('/api/admin/survey', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(note ? { note } : {}),
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
      setCreateNote('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败');
    } finally {
      setBusy(false);
    }
  }, [createNote, load, session]);

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

  const saveNote = useCallback(async (token: string) => {
    const note = (noteDrafts[token] ?? '').trim();
    setSavingNote(token);
    setError('');
    try {
      const res = await fetch('/api/admin/survey', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, note }),
      });
      if (res.status === 401) {
        session.setAdmin(false);
        setError('管理员登录已失效，请重新登录');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || '保存备注失败');
      }
      const body = await res.json() as { invite?: Invite };
      const saved = body.invite?.note ?? null;
      setInvites((cur) => cur.map((item) => (
        item.token === token ? { ...item, note: saved } : item
      )));
      setNoteDrafts((cur) => ({ ...cur, [token]: saved ?? '' }));
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存备注失败');
    } finally {
      setSavingNote('');
    }
  }, [noteDrafts, session]);

  const copyUrl = useCallback(async (path: string, token: string) => {
    const url = inviteUrl(path);
    const ok = await copyTextReliable(url);
    if (ok) {
      setCopied(token);
      window.setTimeout(() => setCopied((cur) => (cur === token ? '' : cur)), 1600);
      return;
    }
    setError('复制失败，请手动选中链接');
  }, []);

  const cards = useMemo(() => {
    if (!summary) return [];
    return [
      { label: '已反馈', value: String(summary.responseCount) },
      { label: '含深入反馈', value: String(summary.deepCount) },
      { label: '体验（B2）', value: distLine(summary.b2) },
      { label: '三栏（B3）', value: distLine(summary.b3) },
      { label: '认识（B4）', value: distLine(summary.b4) },
      { label: '角标（B5）', value: distLine(summary.b5) },
      { label: '类似产品（B6）', value: distLine(summary.b6) },
    ];
  }, [summary]);

  const filteredInvites = useMemo(() => {
    if (inviteFeedbackFilter === 'done') return invites.filter((item) => item.responseCount > 0);
    if (inviteFeedbackFilter === 'pending') return invites.filter((item) => item.responseCount <= 0);
    return invites;
  }, [invites, inviteFeedbackFilter]);

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

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <button type="button" style={tabBtn(tab === 'invites')} onClick={() => setTab('invites')}>
          邀请链接
        </button>
        <button type="button" style={tabBtn(tab === 'results')} onClick={() => setTab('results')}>
          调研结果
        </button>
        <button type="button" style={{ ...s.btnGhost, marginLeft: 'auto' }} disabled={loading || busy} onClick={() => void load()}>
          刷新
        </button>
      </div>

      {tab === 'invites' ? (
        <section>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
            <input
              style={{ ...s.input, width: 160, flex: '0 0 auto' }}
              value={createNote}
              maxLength={120}
              placeholder="备注（可选）"
              onChange={(e) => setCreateNote(e.target.value)}
            />
            <button type="button" style={s.btn} disabled={busy || loading} onClick={() => void createInvite()}>
              生成邀请链接
            </button>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto', flexWrap: 'wrap' }}>
              {([
                ['all', '全部'],
                ['done', '已反馈'],
                ['pending', '未反馈'],
              ] as Array<[FeedbackFilter, string]>).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  style={tabBtn(inviteFeedbackFilter === key)}
                  onClick={() => setInviteFeedbackFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>短码</th>
                  <th style={s.th}>链接</th>
                  <th style={s.th}>备注</th>
                  <th style={s.th}>创建时间</th>
                  <th style={s.th}>反馈</th>
                  <th style={s.th}>状态</th>
                  <th style={s.th}>操作</th>
                </tr>
              </thead>
              <tbody>
                {!loading && invites.length === 0 ? (
                  <tr><td colSpan={7} style={{ ...s.td, color: '#8b97a9' }}>暂无邀请</td></tr>
                ) : null}
                {!loading && invites.length > 0 && filteredInvites.length === 0 ? (
                  <tr><td colSpan={7} style={{ ...s.td, color: '#8b97a9' }}>暂无匹配</td></tr>
                ) : null}
                {filteredInvites.map((item) => {
                  const full = inviteUrl(item.path);
                  const draft = noteDrafts[item.token] ?? '';
                  const dirty = draft.trim() !== (item.note ?? '').trim();
                  return (
                    <tr key={item.id} style={item.active ? undefined : { opacity: 0.55 }}>
                      <td style={{ ...s.td, whiteSpace: 'nowrap', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                        {item.token}
                      </td>
                      <td style={{ ...s.td, maxWidth: 360 }} title={full}>
                        <a
                          href={full}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                            wordBreak: 'break-all',
                            color: '#1f4fad',
                            textDecoration: 'underline',
                          }}
                        >
                          {full}
                        </a>
                      </td>
                      <td style={{ ...s.td, minWidth: 200 }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input
                            style={noteInput}
                            value={draft}
                            maxLength={120}
                            placeholder="备注"
                            disabled={busy || savingNote === item.token}
                            onChange={(e) => setNoteDrafts((cur) => ({ ...cur, [item.token]: e.target.value }))}
                          />
                          <button
                            type="button"
                            style={{ ...s.btnGhost, padding: '4px 8px', flexShrink: 0 }}
                            disabled={busy || savingNote === item.token || !dirty}
                            onClick={() => void saveNote(item.token)}
                          >
                            {savingNote === item.token ? '保存中' : '保存'}
                          </button>
                        </div>
                      </td>
                      <td style={{ ...s.td, whiteSpace: 'nowrap' }}>{fmtTime(item.createdAt)}</td>
                      <td style={{ ...s.td, whiteSpace: 'nowrap' }}>{item.responseCount > 0 ? '已反馈' : '未反馈'}</td>
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
          {loading ? <p style={{ ...s.muted, marginTop: 10 }}>加载中…</p> : null}
        </section>
      ) : (
        <>
          <section style={{ marginBottom: 18 }}>
            <div style={s.cardRow}>
              {cards.map((card) => (
                <div key={card.label} style={{ ...s.card, padding: '10px 12px' }}>
                  <p style={{ ...s.cardLabel, fontSize: 11 }}>{card.label}</p>
                  <p style={{
                    ...s.cardValue,
                    margin: '4px 0 0',
                    fontSize: card.value.length > 18 ? 12 : 15,
                    fontWeight: 600,
                    lineHeight: 1.35,
                  }}>
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
                    <th style={s.th}>邀请备注</th>
                    <th style={s.th}>反馈</th>
                    <th style={s.th}>基础题</th>
                    <th style={s.th}>深入</th>
                  </tr>
                </thead>
                <tbody>
                  {!loading && responses.length === 0 ? (
                    <tr><td colSpan={7} style={{ ...s.td, color: '#8b97a9' }}>暂无反馈</td></tr>
                  ) : null}
                  {responses.map((item) => {
                    const basicLine = formatSurveyBasicLine(item.basic as unknown as Record<string, unknown>);
                    return (
                      <tr key={item.id}>
                        <td style={{ ...s.td, whiteSpace: 'nowrap' }}>{fmtTime(item.createdAt)}</td>
                        <td style={{ ...s.td, whiteSpace: 'nowrap' }}>{item.nickname || '—'}</td>
                        <td style={{ ...s.td, whiteSpace: 'nowrap', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                          {item.token}
                        </td>
                        <td style={{ ...s.td, maxWidth: 180 }} title={item.inviteNote || undefined}>
                          {item.inviteNote || '—'}
                        </td>
                        <td style={{ ...s.td, whiteSpace: 'nowrap' }}>已反馈</td>
                        <td style={{ ...s.td, maxWidth: 420 }} title={basicLine}>{basicLine || '—'}</td>
                        <td style={{ ...s.td, maxWidth: 420, whiteSpace: 'pre-wrap' } as CSSProperties}>
                          {formatSurveyDeepLine(item.deep) || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {loading ? <p style={{ ...s.muted, marginTop: 10 }}>加载中…</p> : null}
          </section>
        </>
      )}
    </AdminMain>
  );
}
