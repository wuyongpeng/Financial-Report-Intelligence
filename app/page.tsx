'use client';

import { useEffect, useState } from 'react';
import ReportHome from './report-home';

export default function Home() {
  const [statusText, setStatusText] = useState('正在读取监控池');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const code = new URLSearchParams(window.location.search).get('code');
    if (code && /^\d{6}$/.test(code)) {
      window.location.replace(`/${code}`);
      return;
    }

    let active = true;
    async function refresh() {
      try {
        const response = await fetch('/api/crawl', { cache: 'no-store' });
        if (!response.ok) throw new Error(String(response.status));
        const payload = await response.json() as { stats?: { covered?: number; universe?: number } };
        if (!active) return;
        setStatusText(`监控 ${payload.stats?.covered ?? 0}/${payload.stats?.universe ?? 60} 家可读`);
      } catch {
        if (active) setStatusText('监控池同步中');
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <main className="app-shell">
      <header className="topbar home-topbar">
        <div className="home-topbar-spacer" aria-hidden="true" />
        <div className="top-actions">
          <span className="status-pill" aria-live="polite"><i />{statusText}</span>
          <a
            className="rh-system-link"
            href="/sources"
            aria-label="打开数据源采集"
          >
            ⚙️ 数据源采集
          </a>
        </div>
      </header>
      <ReportHome />
    </main>
  );
}
