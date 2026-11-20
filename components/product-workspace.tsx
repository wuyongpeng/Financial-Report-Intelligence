'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { requestLoginForRestricted } from '@/lib/account-client';
import { LEGAL_PAGES, legalPath } from '@/lib/legal-content';
import type { ProductCollectStatus } from '@/lib/product-status';
import './product-workspace.css';

export function ProductFooter() {
  return (
    <footer className="pw-footer">
      {LEGAL_PAGES.map((page) => (
        <Link key={page.slug} href={legalPath(page.slug)}>{page.title}</Link>
      ))}
    </footer>
  );
}

type BellItem = { id: string; title: string; body: string; href: string | null; readAt: string | null; code: string };

export function NotificationBell() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<BellItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  async function load() {
    try {
      const response = await fetch('/api/me/notifications', { cache: 'no-store', credentials: 'same-origin' });
      if (response.status === 401) {
        setItems([]);
        setUnread(0);
        setSignedIn(false);
        setReady(true);
        return;
      }
      if (!response.ok) return;
      const payload = await response.json() as { notifications?: BellItem[]; unread?: number };
      setItems(payload.notifications ?? []);
      setUnread(payload.unread ?? 0);
      setSignedIn(true);
      setReady(true);
    } catch {
      setReady(true);
    }
  }

  useEffect(() => {
    if (pathname?.startsWith('/admin')) return;
    void load();
    const timer = window.setInterval(() => { void load(); }, 45_000);
    return () => window.clearInterval(timer);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (pathname?.startsWith('/admin') || !ready || !signedIn) return null;

  async function openItem(item: BellItem) {
    if (!item.readAt) {
      await fetch('/api/me/notifications', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: item.id }),
      });
    }
    setOpen(false);
    router.push(item.href || `/${item.code}`);
    void load();
  }

  return (
    <div className="pw-bell" ref={rootRef}>
      <button
        type="button"
        className="pw-bell-btn"
        aria-label={unread ? `通知，${unread} 条未读` : '通知'}
        title="新财报提醒"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => { setOpen((value) => !value); if (!open) void load(); }}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M18 8a6 6 0 10-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
          <path d="M10 19a2 2 0 004 0" />
        </svg>
        {unread > 0 ? <span className="pw-bell-dot">{unread > 9 ? '9+' : unread}</span> : null}
      </button>
      {open ? (
        <div className="pw-bell-panel" id={menuId} role="dialog" aria-label="通知">
          <h2>提醒</h2>
          {items.length === 0 ? (
            <p className="pw-bell-empty">暂无提醒。加入自选后，新报告准备好会通知你。</p>
          ) : items.map((item) => (
            <button key={item.id} type="button" className={`pw-bell-item${item.readAt ? ' is-read' : ''}`} onClick={() => void openItem(item)}>
              <strong>{item.title}</strong>
              <span>{item.body}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function CollectStatusNote({ status }: { status: ProductCollectStatus }) {
  if (status.kind === 'ready') return null;
  return <p className={`pw-status is-${status.kind}`} role="status">{status.label}。{status.detail}</p>;
}

export function WatchlistEmpty({ guest }: { guest: boolean }) {
  return (
    <div className="pw-empty">
      {guest
        ? '登录后可以添加自选公司。能搜到的公司都可以加入，加入后会自动抓取，完成后会通知你。'
        : '还没有自选公司。搜索公司或代码后即可加入，加入后会自动抓取，完成后会通知你，无需反复刷新。'}
    </div>
  );
}

export async function shareCurrentAnswer(input: {
  question: string;
  answer: string;
  evidence?: unknown;
  code?: string;
  companyName?: string;
  period?: string;
  reportId?: string;
  conversationId?: string | null;
}) {
  if (requestLoginForRestricted()) return null;
  const response = await fetch('/api/share', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (response.status === 401) {
    requestLoginForRestricted();
    return null;
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error || '分享失败');
  }
  const payload = await response.json() as { href: string };
  const url = new URL(payload.href, window.location.origin).toString();
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    /* still return the link */
  }
  return url;
}
