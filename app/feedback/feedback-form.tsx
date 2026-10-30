'use client';

import Link from 'next/link';
import { useState } from 'react';

export default function FeedbackForm() {
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function submit() {
    const text = message.trim();
    if (!text) {
      setError('请填写反馈内容');
      return;
    }
    setSending(true);
    setError('');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: text,
          contact: contact.trim() || undefined,
          page: '/feedback',
          url: typeof window !== 'undefined' ? window.location.href : '/feedback',
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        }),
      });
      const body = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(body.error || '发送失败');
      setDone(true);
      setMessage('');
      setContact('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '发送失败');
    } finally {
      setSending(false);
    }
  }

  return (
    <main style={{
      maxWidth: 520, margin: '48px auto', padding: '0 16px',
      fontFamily: 'system-ui, -apple-system, sans-serif', color: '#203047',
    }}
    >
      <Link href="/" style={{ fontSize: 13, color: '#73849c', textDecoration: 'none' }}>← 返回首页</Link>
      <h1 style={{ fontSize: 22, margin: '18px 0 8px' }}>向 Eva 发送反馈</h1>
      {done ? (
        <p style={{ color: '#15803d', fontSize: 14 }}>感谢反馈，已收到。</p>
      ) : (
        <>
          <label style={{ display: 'block', fontSize: 13, color: '#6b7a8d', marginBottom: 6 }} htmlFor="fb-message">
            <span style={{ color: '#dc2626', marginRight: 4, fontWeight: 600 }} aria-hidden="true">*</span>
            反馈内容（必填）
          </label>
          <textarea
            id="fb-message"
            rows={8}
            value={message}
            disabled={sending}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="例如：希望支持某类指标、某处看不懂…"
            style={{
              width: '100%', border: '1px solid #d5dde8', borderRadius: 10,
              padding: 12, font: 'inherit', fontSize: 14, resize: 'vertical',
            }}
          />
          <label style={{ display: 'block', fontSize: 13, color: '#6b7a8d', margin: '14px 0 6px' }} htmlFor="fb-contact">
            <span style={{ visibility: 'hidden', marginRight: 4, fontWeight: 600 }} aria-hidden="true">*</span>
            联系方式（选填）
          </label>
          <input
            id="fb-contact"
            type="text"
            value={contact}
            disabled={sending}
            onChange={(e) => setContact(e.target.value)}
            placeholder="邮箱 / 微信 / 手机号"
            autoComplete="off"
            maxLength={120}
            style={{
              width: '100%', border: '1px solid #d5dde8', borderRadius: 10,
              padding: '10px 12px', font: 'inherit', fontSize: 14,
            }}
          />
          {error ? <p style={{ color: '#b91c1c', fontSize: 13 }}>{error}</p> : null}
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <Link href="/" style={{
              border: '1px solid #d5dde8', borderRadius: 8, background: '#fff',
              color: '#3d5270', padding: '8px 14px', fontSize: 13, textDecoration: 'none',
            }}
            >
              取消
            </Link>
            <button
              type="button"
              disabled={sending}
              onClick={() => void submit()}
              style={{
                border: 0, borderRadius: 8, background: '#3064db', color: '#fff',
                padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                opacity: sending ? 0.65 : 1,
              }}
            >
              {sending ? '发送中…' : '发送'}
            </button>
          </div>
        </>
      )}
    </main>
  );
}
