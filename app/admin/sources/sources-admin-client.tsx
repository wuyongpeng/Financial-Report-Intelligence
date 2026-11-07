'use client';

import { Suspense } from 'react';
import CrawlOverview from '../../crawl/crawl-overview';
import {
  AdminHeader,
  AdminMain,
} from '../_components/admin-shell';

/** Data-collection tab inside the unified ops console. */
export function SourcesAdminClient() {
  return (
    <AdminMain>
      <AdminHeader
        title="数据采集"
        activeHref="/admin/sources"
      />
      <Suspense fallback={<p style={{ color: '#6b7a8d', padding: '12px 0' }}>加载采集状态…</p>}>
        <CrawlOverview embedded />
      </Suspense>
    </AdminMain>
  );
}
