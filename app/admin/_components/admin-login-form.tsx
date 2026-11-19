'use client';

import { type CSSProperties, type FormEvent, useState } from 'react';
import { PasswordInput } from '@/components/password-input';

export function AdminLoginForm() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!password) {
      setError('请输入密码');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const body = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        setError(body.error || '密码错误');
        return;
      }
      window.location.reload();
    } catch {
      setError('登录失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={wrap}>
      <h1 style={title}>Eva 数据运营</h1>
      <p style={muted}>请输入密码后进入</p>
      <form onSubmit={onSubmit} style={form}>
        <label htmlFor="admin-password" style={label}>密码</label>
        <PasswordInput
          id="admin-password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          style={input}
        />
        {error ? <p style={err} role="alert">{error}</p> : null}
        <button type="submit" disabled={submitting} style={btn}>
          {submitting ? '正在进入…' : '进入'}
        </button>
      </form>
    </main>
  );
}

const wrap: CSSProperties = {
  maxWidth: 420,
  margin: '12vh auto',
  padding: '0 16px',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  color: '#203047',
};
const title: CSSProperties = { margin: 0, fontSize: 22, fontWeight: 650 };
const muted: CSSProperties = { margin: '8px 0 20px', color: '#6b7789', fontSize: 14 };
const form: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
const label: CSSProperties = { fontSize: 13, color: '#4a5565' };
const input: CSSProperties = {
  height: 36,
  padding: '0 10px',
  border: '1px solid #c5d0de',
  borderRadius: 8,
  fontSize: 14,
};
const err: CSSProperties = { margin: 0, color: '#c0392b', fontSize: 13 };
const btn: CSSProperties = {
  marginTop: 8,
  height: 36,
  border: '1px solid #3064db',
  borderRadius: 8,
  background: '#3064db',
  color: '#fff',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};
