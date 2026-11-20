'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  AdminHeader,
  AdminHelpTip,
  AdminMain,
  adminStyles as s,
} from '../_components/admin-shell';
import {
  countAdminUsers,
  filterAdminUsers,
  parseQuotaLimit,
  quotaLabel,
  statusLabel,
  type AdminUserFilter,
  type AdminUserRecord,
} from '@/lib/admin-users';

const FILTERS: Array<{ id: AdminUserFilter; label: string; countKey: 'all' | 'quotaFull' | 'disabled' }> = [
  { id: 'all', label: '全部', countKey: 'all' },
  { id: 'quota_full', label: '额度已满', countKey: 'quotaFull' },
  { id: 'disabled', label: '已停用', countKey: 'disabled' },
];

function fmtTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
}

export function UsersAdminClient() {
  const [items, setItems] = useState<AdminUserRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<AdminUserFilter>('all');
  const [editing, setEditing] = useState<AdminUserRecord | null>(null);
  const [quotaInput, setQuotaInput] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resetSecret, setResetSecret] = useState<{ username: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/users', { cache: 'no-store', credentials: 'same-origin' });
      if (res.status === 401) {
        setError('请求未授权，请刷新后重试');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || '加载失败');
      }
      const body = await res.json() as { items: AdminUserRecord[] };
      setItems(body.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => countAdminUsers(items), [items]);
  const visible = useMemo(() => filterAdminUsers(items, filter, search), [items, filter, search]);

  function startEditQuota(user: AdminUserRecord) {
    setEditing(user);
    setQuotaInput(String(user.quotaLimit));
    setError('');
    setNotice('');
  }

  async function patchUser(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
      });
      const payload = await res.json().catch(() => ({})) as { error?: string; temporaryPassword?: string; username?: string };
      if (!res.ok) throw new Error(payload.error || '保存失败');
      if (body.action === 'reset_password') {
        const password = typeof payload.temporaryPassword === 'string' ? payload.temporaryPassword : '';
        const username = payload.username || items.find((item) => item.id === id)?.username || '';
        if (!password) throw new Error('临时密码没有生成，请重试');
        setResetSecret({ username, password });
        setCopied(false);
      } else {
        setNotice('已保存');
      }
      setEditing(null);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function saveQuota() {
    if (!editing) return;
    try {
      const quotaLimit = parseQuotaLimit(quotaInput);
      await patchUser(editing.id, { action: 'set_quota', quotaLimit });
    } catch (e) {
      setError(e instanceof Error ? e.message : '额度须为正整数');
    }
  }

  async function toggleUnlimited(user: AdminUserRecord) {
    if (user.unlimitedSource === 'env') return;
    const nextUnlimited = user.unlimitedSource == null;
    await patchUser(user.id, { action: 'set_unlimited', unlimited: nextUnlimited });
  }

  async function toggleDisabled(user: AdminUserRecord) {
    if (!user.disabledAt) {
      const ok = window.confirm(`确定停用「${user.username}」吗？停用后将无法登录或发起对话。`);
      if (!ok) return;
    }
    await patchUser(user.id, { action: 'set_disabled', disabled: !user.disabledAt });
  }

  async function resetPassword(user: AdminUserRecord) {
    const ok = window.confirm(`确定为「${user.username}」重置密码吗？原密码将立即失效，临时密码只显示一次。`);
    if (!ok) return;
    await patchUser(user.id, { action: 'reset_password' });
  }

  async function copyResetPassword() {
    if (!resetSecret) return;
    try {
      await navigator.clipboard.writeText(resetSecret.password);
      setCopied(true);
    } catch {
      setError('复制失败，请手动选中后复制');
    }
  }

  return (
    <AdminMain>
      <AdminHeader title="账号管理" activeHref="/admin/users" />
      {error ? <p style={s.err}>{error}</p> : null}
      {notice ? <p style={{ ...s.muted, color: '#15803d' }}>{notice}</p> : null}

      {resetSecret ? (
        <div style={resetBox} role="status">
          <p style={{ margin: '0 0 8px', fontSize: 13, color: '#3a4d66', lineHeight: 1.55 }}>
            已为 <strong>{resetSecret.username}</strong> 重置密码。请立即复制并告知用户，关闭后将不再显示。
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <code style={resetCode}>{resetSecret.password}</code>
            <button type="button" style={s.btnGhost} onClick={() => void copyResetPassword()}>{copied ? '已复制' : '复制'}</button>
            <button type="button" style={s.btnGhost} onClick={() => { setResetSecret(null); setCopied(false); }}>关闭</button>
          </div>
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <input
          style={{ ...s.input, width: 180, flex: '0 1 220px', fontSize: 12, padding: '5px 8px' }}
          value={search}
          maxLength={80}
          placeholder="快速检索"
          onChange={(e) => setSearch(e.target.value)}
        />
        <div style={{ ...s.chipRow, marginBottom: 0 }}>
          {FILTERS.map((item) => {
            const active = filter === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                aria-pressed={active}
                style={{
                  ...s.cardCompact,
                  textAlign: 'left',
                  cursor: 'pointer',
                  font: 'inherit',
                  border: active ? '1.5px solid #3d5270' : '1px solid #e5eaf1',
                  background: active ? '#f6f8fc' : '#fff',
                  boxShadow: active ? '0 0 0 2px #3d527022' : 'none',
                }}
              >
                <p style={s.cardLabel}>{item.label}</p>
                <p style={{ ...s.cardValueCompact, color: '#3d5270' }}>{counts[item.countKey]}</p>
              </button>
            );
          })}
        </div>
        <AdminHelpTip text="仅列出已注册用户，不含访客。可调整额度、设为不限次数、停用或重置密码。时间均为 Asia/Shanghai。" />
      </div>

      {editing ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <span style={{ ...s.muted, margin: 0 }}>调整 {editing.username} 的额度</span>
          <input
            style={{ ...s.input, width: 100, fontSize: 12, padding: '5px 8px' }}
            type="number"
            min={1}
            step={1}
            value={quotaInput}
            onChange={(e) => setQuotaInput(e.target.value)}
          />
          <button type="button" style={s.btnGhost} disabled={busyId === editing.id} onClick={() => void saveQuota()}>保存</button>
          <button type="button" style={s.btnGhost} disabled={busyId === editing.id} onClick={() => setEditing(null)}>取消</button>
        </div>
      ) : null}

      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>用户名</th>
              <th style={s.th}>注册时间</th>
              <th style={s.th}>已用/额度</th>
              <th style={s.th}>状态</th>
              <th style={s.th}>最近对话</th>
              <th style={s.th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {!loading && items.length === 0 ? (
              <tr><td colSpan={6} style={{ ...s.td, color: '#8b97a9' }}>暂无注册用户</td></tr>
            ) : null}
            {!loading && items.length > 0 && visible.length === 0 ? (
              <tr><td colSpan={6} style={{ ...s.td, color: '#8b97a9' }}>暂无匹配</td></tr>
            ) : null}
            {visible.map((user) => {
              const busy = busyId === user.id;
              const envLocked = user.unlimitedSource === 'env';
              return (
                <tr key={user.id}>
                  <td style={{ ...s.td, whiteSpace: 'nowrap' }}>{user.username}</td>
                  <td style={{ ...s.td, whiteSpace: 'nowrap' }}>{user.createdAt ? fmtTime(user.createdAt) : '—'}</td>
                  <td style={{ ...s.td, whiteSpace: 'nowrap' }}>{quotaLabel(user)}</td>
                  <td style={{ ...s.td, whiteSpace: 'nowrap', color: user.disabledAt ? '#6b7a8d' : '#3a4d66' }}>
                    {statusLabel(user.disabledAt)}
                  </td>
                  <td style={{ ...s.td, whiteSpace: 'nowrap' }}>{user.lastAskAt ? fmtTime(user.lastAskAt) : '—'}</td>
                  <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                    <button type="button" style={textAct} disabled={busy} onClick={() => startEditQuota(user)}>调整额度</button>
                    <button
                      type="button"
                      style={textAct}
                      disabled={busy || envLocked}
                      title={envLocked ? '该用户在环境变量名单中，无法在此取消不限' : undefined}
                      onClick={() => void toggleUnlimited(user)}
                    >
                      {user.unlimited ? '取消不限' : '设为不限次数'}
                    </button>
                    <button type="button" style={textAct} disabled={busy} onClick={() => void toggleDisabled(user)}>
                      {user.disabledAt ? '恢复' : '停用'}
                    </button>
                    <button type="button" style={textAct} disabled={busy} onClick={() => void resetPassword(user)}>重置密码</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button type="button" style={s.btnGhost} disabled={loading} onClick={() => void load()}>刷新</button>
        <span style={{ ...s.muted, alignSelf: 'center' }}>
          已显示 {visible.length}{visible.length !== items.length ? ` / ${items.length}` : ''} 人
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

const resetBox: CSSProperties = {
  border: '1px solid #e5eaf1',
  borderRadius: 10,
  background: '#fff',
  padding: '12px 14px',
  marginBottom: 12,
};

const resetCode: CSSProperties = {
  display: 'inline-block',
  padding: '5px 10px',
  border: '1px solid #e5eaf1',
  borderRadius: 6,
  background: '#f6f8fc',
  color: '#203047',
  fontSize: 13,
  letterSpacing: '0.04em',
};
