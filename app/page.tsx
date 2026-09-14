'use client';

import { useEffect } from 'react';
import ReportHome from './report-home';

export default function Home() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const code = new URLSearchParams(window.location.search).get('code');
    if (code && /^\d{6}$/.test(code)) {
      window.location.replace(`/${code}`);
    }
  }, []);

  return (
    <main className="app-shell">
      <header className="topbar home-topbar">
        <div className="home-topbar-spacer" aria-hidden="true" />
        <div className="top-actions">
          <a className="rh-system-link" href="/sources" aria-label="打开数据采集">数据采集</a>
        </div>
      </header>
      <ReportHome />
    </main>
  );
}
