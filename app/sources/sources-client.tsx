'use client';

import { Suspense } from 'react';
import CrawlOverview from '../crawl/crawl-overview';

/** Unified data-source page: ops pipeline + crawl table. */
export default function SourcesClient() {
  return (
    <Suspense fallback={<main className="app-shell co-shell"><p style={{ padding: 24 }}>加载采集状态…</p></main>}>
      <CrawlOverview />
    </Suspense>
  );
}
