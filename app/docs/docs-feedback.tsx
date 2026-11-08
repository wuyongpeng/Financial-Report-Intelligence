'use client';

import { useState } from 'react';

async function sendFeedback(body: { category: string; message: string; page: string }) {
  const response = await fetch('/api/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...body,
      url: window.location.href,
      userAgent: navigator.userAgent,
    }),
  });
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(payload.error || '发送失败');
}

export default function DocsFeedback({ title }: { title: string }) {
  const page = `文档中心 / ${title}`;
  const [vote, setVote] = useState<'up' | 'down' | null>(null);
  const [voteNote, setVoteNote] = useState('');
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function voteFor(next: 'up' | 'down') {
    if (vote === next) return;
    setError('');
    setVote(next);
    setVoteNote('');
    try {
      await sendFeedback({
        category: '其它',
        message: next === 'up' ? `《${title}》这篇文档有帮助` : `《${title}》这篇文档没有帮助`,
        page,
      });
      setVoteNote('已收到，感谢反馈');
    } catch (reason) {
      setVote(null);
      setError(reason instanceof Error ? reason.message : '发送失败');
    }
  }

  async function submitSuggestion() {
    const text = message.trim();
    if (!text) {
      setError('请填写问题或建议');
      return;
    }
    setSending(true);
    setError('');
    try {
      await sendFeedback({ category: '功能建议', message: text, page });
      setMessage('');
      setOpen(false);
      setSent(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '发送失败');
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="eva-docs-feedback" aria-label="文档反馈">
      <div className="eva-docs-feedback-row">
        <p>这篇文档对您有帮助吗？</p>
        <button type="button" aria-label="有帮助" aria-pressed={vote === 'up'} onClick={() => void voteFor('up')}>👍</button>
        <button type="button" aria-label="没有帮助" aria-pressed={vote === 'down'} onClick={() => void voteFor('down')}>👎</button>
        {voteNote ? <span>{voteNote}</span> : null}
        <button type="button" className="eva-docs-feedback-suggest" onClick={() => { setOpen((value) => !value); setSent(false); setError(''); }}>
          提交问题/建议
        </button>
      </div>
      {open ? (
        <div className="eva-docs-feedback-form">
          <textarea
            rows={4}
            value={message}
            maxLength={4000}
            placeholder="这篇文档哪里不清楚，或还想补充什么"
            aria-label="问题或建议"
            onChange={(event) => setMessage(event.target.value)}
          />
          <div>
            <button type="button" disabled={sending} onClick={() => setOpen(false)}>取消</button>
            <button type="button" disabled={sending} onClick={() => void submitSuggestion()}>{sending ? '发送中…' : '发送'}</button>
          </div>
        </div>
      ) : null}
      {sent ? <p className="eva-docs-feedback-note">已收到，感谢建议</p> : null}
      {error ? <p className="eva-docs-feedback-error">{error}</p> : null}
    </section>
  );
}
