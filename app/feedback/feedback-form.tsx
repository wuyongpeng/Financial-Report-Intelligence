'use client';

import Link from 'next/link';
import { useState } from 'react';

export default function FeedbackForm() {
  const [message, setMessage] = useState('');
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
          page: '/feedback',
          url: typeof window !== 'undefined' ? window.location.href : '/feedback',
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        }),
      });
      const body = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(body.error || '发送失败');
      setDone(true);
      setMessage('');
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
      <p style={{ fontSize: 13, color: '#6b7a8d', lineHeight: 1.5 }}>请描述您的反馈 （必填）</p>
      {done ? (
        <p style={{ color: '#15803d', fontSize: 14 }}>感谢反馈，已收到。</p>
      ) : (
        <>
          <textarea
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
