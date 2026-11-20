'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import AnswerMarkdown from '../../answer-markdown';
import { copyAndDownloadAnswerExport } from '@/lib/answer-export';
import { ProductFooter } from '@/components/product-workspace';
import '@/components/product-workspace.css';

type SharePayload = {
  id: string;
  code: string | null;
  companyName: string | null;
  period: string | null;
  question: string;
  answer: string;
  evidence: Array<{ page?: number; quote?: string; companyName?: string; period?: string }>;
  createdAt: string;
};

export default function ShareView({ id }: { id: string }) {
  const [share, setShare] = useState<SharePayload | null>(null);
  const [error, setError] = useState('');
  const [exported, setExported] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/share/${id}`, { cache: 'no-store' });
        if (!response.ok) {
          if (active) setError('分享不存在或已删除');
          return;
        }
        const payload = await response.json() as SharePayload;
        if (active) setShare(payload);
      } catch {
        if (active) setError('分享暂时无法打开');
      }
    })();
    return () => { active = false; };
  }, [id]);

  if (error) {
    return (
      <main className="pw-share">
        <p>{error}</p>
        <ProductFooter />
      </main>
    );
  }
  if (!share) {
    return <main className="pw-share"><p>正在打开分享…</p></main>;
  }
  const current = share;
  const kicker = [current.companyName, current.code, current.period].filter(Boolean).join(' · ');
  const href = current.code ? `/${current.code}${current.period ? `?period=${encodeURIComponent(current.period)}` : ''}` : '/';
  async function exportShare() {
    const result = await copyAndDownloadAnswerExport({
      companyName: current.companyName,
      code: current.code,
      period: current.period,
      question: current.question,
      answer: current.answer,
      citations: current.evidence.map((item) => ({
        page: item.page ?? 0,
        quote: item.quote,
        companyName: item.companyName,
        period: item.period,
      })).filter((item) => item.page >= 1),
    });
    if (result !== 'exported') return;
    setExported(true);
    window.setTimeout(() => setExported(false), 2000);
  }
  return (
    <main className="pw-share">
      <p className="pw-kicker">{kicker || 'Eva 问答分享'}</p>
      <h1>{share.question}</h1>
      <article className="pw-share-answer">
        <AnswerMarkdown text={share.answer} renderCites={(chunk) => chunk} />
      </article>
      <div className="pw-share-tools">
        <button type="button" className="pw-share-export" aria-label="导出" title="导出" onClick={() => void exportShare()}>导出</button>
        {exported ? <span className="pw-share-status" role="status">已导出</span> : null}
      </div>
      {share.evidence.length ? (
        <section className="pw-share-sources">
          <h2>出处</h2>
          <ol>
            {share.evidence.map((item, index) => (
              <li key={`${item.page}-${index}`}>
                {[item.companyName, item.period, item.page ? `第${item.page}页` : ''].filter(Boolean).join(' · ')}
                {item.quote ? `：${item.quote}` : ''}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      <p className="pw-disclaimer">以上内容只陈述财报事实，不构成投资建议。数据以公告原文为准。</p>
      <p><Link href={href}>在 Eva 中打开本期分析</Link></p>
      <ProductFooter />
    </main>
  );
}
