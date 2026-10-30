'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import './home-overflow-menu.css';

export type HomeOverflowMenuProps = {
  /** Home shows 数据采集; detail hides it. Default true. */
  showSources?: boolean;
  /** Short context for feedback, e.g. 「贵州茅台 2025H1」. Falls back to pathname. */
  pageLabel?: string;
};

export default function HomeOverflowMenu({
  showSources = true,
  pageLabel,
}: HomeOverflowMenuProps) {
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
  const [contact, setContact] = useState('');
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
      const href = typeof window !== 'undefined' ? window.location.href : '/';
      const page = (pageLabel?.trim() || (typeof window !== 'undefined' ? window.location.pathname : '/') || '/').slice(0, 200);
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: text,
          contact: contact.trim() || undefined,
          page,
          url: href,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        }),
      });
      const body = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(body.error || '发送失败');
      setMessage('');
      setContact('');
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
          {showSources ? (
            <Link
              role="menuitem"
              className="hom-item"
              href="/sources"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
            >
              数据采集
            </Link>
          ) : null}
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
            target="_blank"
            rel="noopener noreferrer"
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
            <h2 id="hom-feedback-title">发送反馈</h2>
            {pageLabel?.trim() ? (
              <p className="hom-context">关于：{pageLabel.trim()}</p>
            ) : null}
            <label className="hom-label" htmlFor="hom-feedback-message">
              <span className="hom-req" aria-hidden="true">*</span>
              反馈内容（必填）
            </label>
            <textarea
              id="hom-feedback-message"
              className="hom-textarea"
              rows={7}
              value={message}
              disabled={sending}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="例如：希望支持某类指标、某处看不懂…"
            />
            <label className="hom-label" htmlFor="hom-feedback-contact">
              <span className="hom-req-spacer" aria-hidden="true">*</span>
              联系方式（选填）
            </label>
            <input
              id="hom-feedback-contact"
              className="hom-input"
              type="text"
              value={contact}
              disabled={sending}
              onChange={(e) => setContact(e.target.value)}
              placeholder="邮箱 / 微信 / 手机号"
              autoComplete="off"
              maxLength={120}
            />
            {error ? <p className="hom-error">{error}</p> : null}
            <div className="hom-admin-row">
              <a
                className="hom-admin-link"
                href="dingtalk://dingtalkclient/page/profile?corp_id=dingd0e3f5f70ceb88d2ee0f45d8e4f7c288&staff_id=222444"
              >
                联系管理员
              </a>
              <span className="hom-admin-help">
                <button type="button" className="hom-admin-q" aria-label="打不开钉钉时的帮助" aria-describedby="hom-admin-tip">
                  ?
                </button>
                <span id="hom-admin-tip" className="hom-admin-tip" role="tooltip">
                  打不开钉钉？
                  <a href="mailto:yongpeng3@staff.sina.com">发邮件给管理员</a>
                </span>
              </span>
            </div>
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
            aria-label="关于 Eva"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="hom-about-logo" src="/favicon.svg" alt="Eva" width={72} height={72} />
            <p className="hom-about-name" id="hom-about-title">财报智析 Eva</p>
            <p className="hom-about-ver">Version 0.1</p>
            <p className="hom-about-copy">© 2026 Sina Eva. All rights reserved.</p>
            <button type="button" className="hom-btn-ghost" onClick={() => setAboutOpen(false)}>关闭</button>
          </div>
        </div>
      ) : null}

      {toast ? <div className="hom-toast" role="status" aria-live="polite">{toast}</div> : null}
    </div>
  );
}
