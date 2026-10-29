'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';

const NAV = [
  { href: '/admin/audit', label: '访问审计' },
  { href: '/admin/check', label: '指标核对' },
  { href: '/admin/survey', label: '用户调研' },
  { href: '/admin/feedback', label: '意见收集' },
] as const;

export function useAdminSession() {
  const [ready, setReady] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [password, setPassword] = useState('');

  const refreshSession = useCallback(async () => {
    const res = await fetch('/api/auth/session', { cache: 'no-store', credentials: 'same-origin' });
    const body = await res.json().catch(() => ({})) as { admin?: boolean };
    setAdmin(Boolean(body.admin));
    setReady(true);
  }, []);

  useEffect(() => { void refreshSession(); }, [refreshSession]);

  const loginWithPassword = useCallback(async (pwd: string) => {
    setLoggingIn(true);
    setLoginError('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: pwd }),
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

  const logout = useCallback(async () => {
    await fetch('/api/admin/login', { method: 'DELETE', credentials: 'same-origin' });
    setAdmin(false);
    setPassword('');
  }, []);

  return {
    ready, admin, loginError, loggingIn, password, setPassword,
    submitLogin, logout, setAdmin,
  };
}

export function AdminLoginForm({
  title,
  hint,
  password,
  setPassword,
  loginError,
  loggingIn,
  onSubmit,
}: {
  title: string;
  hint: string;
  password: string;
  setPassword: (v: string) => void;
  loginError: string;
  loggingIn: boolean;
  onSubmit: () => void;
}) {
  return (
    <main style={wrap}>
      <h1 style={h1}>{title}</h1>
      <p style={muted}>{hint}</p>
      {loginError ? <p style={err}>{loginError}</p> : null}
      <form
        style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}
        onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
      >
        <label style={{ ...muted, margin: 0 }} htmlFor="admin-gate-password">管理员密码</label>
        <input
          id="admin-gate-password"
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

export function AdminHeader({
  title,
  subtitle,
  activeHref,
  onLogout,
  children,
}: {
  title: string;
  subtitle?: string;
  activeHref: string;
  onLogout: () => void;
  children?: ReactNode;
}) {
  return (
    <header style={head}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <h1 style={{ ...h1, margin: 0 }}>{title}</h1>
        {subtitle ? <p style={{ ...muted, margin: '6px 0 0' }}>{subtitle}</p> : null}
        <nav style={nav} aria-label="管理页">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              style={{
                ...navLink,
                ...(item.href === activeHref ? navLinkActive : null),
              }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        {children}
      </div>
      <button type="button" style={btnGhost} onClick={onLogout}>退出</button>
    </header>
  );
}

export const adminStyles = {
  wrap,
  wrapWide,
  h1,
  muted,
  input,
  btn,
  btnGhost,
  err,
  head,
  filters,
  tableWrap,
  table,
  th,
  td,
  cardRow,
  card,
  cardLabel,
  cardValue,
} as const;

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
const filters: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, alignItems: 'center' };
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
const nav: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 };
const navLink: CSSProperties = {
  fontSize: 12, color: '#5b6d86', textDecoration: 'none',
  padding: '5px 10px', borderRadius: 999, border: '1px solid #d5dde8', background: '#fff',
};
const navLinkActive: CSSProperties = {
  color: '#1f4fad', borderColor: '#aec4ef', background: '#edf3ff', fontWeight: 600,
};
const cardRow: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 14,
};
const card: CSSProperties = {
  border: '1px solid #e5eaf1', borderRadius: 12, background: '#fff', padding: '12px 14px',
};
const cardLabel: CSSProperties = { fontSize: 12, color: '#6b7a8d', margin: 0 };
const cardValue: CSSProperties = { fontSize: 18, fontWeight: 650, margin: '6px 0 0', fontVariantNumeric: 'tabular-nums' };
