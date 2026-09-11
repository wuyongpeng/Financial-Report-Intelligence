'use client';

import Link from 'next/link';
import CrawlLivePanel from '../crawl-live-panel';
import './system-ops.css';

export default function SystemOps() {
  return (
    <section className="sys-ops">
      <header className="sys-ops-intro">
        <div>
          <span className="sys-ops-kicker">运维 · 数据源</span>
          <h1>数据源采集</h1>
          <p>温和并发管线、来源健康与限流参数。完整公司抓取记录请进入抓取总览。</p>
        </div>
        <Link href="/crawl" className="sys-ops-crawl-link" aria-label="查看全部抓取记录">
          查看全部抓取记录 <span aria-hidden="true">→</span>
        </Link>
      </header>

      <CrawlLivePanel />
    </section>
  );
}
