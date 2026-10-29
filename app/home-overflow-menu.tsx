'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import './home-overflow-menu.css';

export default function HomeOverflowMenu() {
  const [open, setOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('feedback') === '1') {
      setFeedbackOpen(true);
      params.delete('feedback');
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`;
      window.history.replaceState({}, '', next);
    }
  }, []);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(''), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);

  async function submitFeedback() {
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
          page: '/',
          url: typeof window !== 'undefined' ? window.location.href : '/',
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        }),
      });
      const body = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(body.error || '发送失败');
      setMessage('');
      setFeedbackOpen(false);
      setToast('感谢反馈，已收到');
    } catch (e) {
      setError(e instanceof Error ? e.message : '发送失败');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="hom-root" ref={rootRef}>
      <button
        type="button"
        className="hom-trigger"
        aria-label="更多"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open ? (
        <div className="hom-menu" role="menu" id={menuId}>
          <button
            type="button"
            role="menuitem"
            className="hom-item"
            onClick={() => { setOpen(false); setFeedbackOpen(true); setError(''); }}
          >
            发送反馈
          </button>
          <Link
            role="menuitem"
            className="hom-item"
            href="/docs"
            onClick={() => setOpen(false)}
          >
            帮助中心
          </Link>
          <button
            type="button"
            role="menuitem"
            className="hom-item"
            onClick={() => { setOpen(false); setAboutOpen(true); }}
          >
            关于 Eva
          </button>
        </div>
      ) : null}

      {feedbackOpen ? (
        <div className="hom-drawer-backdrop" onClick={() => !sending && setFeedbackOpen(false)}>
          <aside
            className="hom-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="hom-feedback-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="hom-feedback-title">向 Eva 发送反馈</h2>
            <label className="hom-label" htmlFor="hom-feedback-message">请描述您的反馈 （必填）</label>
            <textarea
              id="hom-feedback-message"
              className="hom-textarea"
              rows={8}
              value={message}
              disabled={sending}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="例如：希望支持某类指标、某处看不懂…"
            />
            {error ? <p className="hom-error">{error}</p> : null}
            <div className="hom-drawer-actions">
              <button type="button" className="hom-btn-ghost" disabled={sending} onClick={() => setFeedbackOpen(false)}>
                取消
              </button>
              <button type="button" className="hom-btn" disabled={sending} onClick={() => void submitFeedback()}>
                {sending ? '发送中…' : '发送'}
              </button>
            </div>
          </aside>
        </div>
      ) : null}

      {aboutOpen ? (
        <div className="hom-about-backdrop" onClick={() => setAboutOpen(false)}>
          <div
            className="hom-about"
            role="dialog"
            aria-modal="true"
            aria-labelledby="hom-about-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="hom-about-title">关于 Eva</h2>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="hom-about-logo" src="/favicon.svg" alt="Eva" width={72} height={72} />
            <p className="hom-about-name">财报智析 Eva</p>
            <p className="hom-about-ver">Version 1.0</p>
            <p className="hom-about-copy">© 2026 yongpeng3@staff.sina.com</p>
            <button type="button" className="hom-btn-ghost" onClick={() => setAboutOpen(false)}>关闭</button>
          </div>
        </div>
      ) : null}

      {toast ? <div className="hom-toast" role="status" aria-live="polite">{toast}</div> : null}
    </div>
  );
}
