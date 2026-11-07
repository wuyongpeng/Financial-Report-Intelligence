'use client';

import { Suspense } from 'react';
import CrawlOverview from '../../crawl/crawl-overview';
import {
  AdminHeader,
  AdminMain,
  useAdminSession,
} from '../_components/admin-shell';

/** Data-collection tab inside the unified ops console. */
export function CrawlAdminClient() {
  const session = useAdminSession();

  return (
    <AdminMain style={{ maxWidth: 1600 }}>
      <AdminHeader
        title="数据采集"
        subtitle="发现 → 下载 → 解析 → 智析"
        activeHref="/admin/crawl"
        showLogout={session.admin}
        onLogout={session.admin ? () => { void session.logout(); } : undefined}
      />
      <Suspense fallback={<p style={{ color: '#6b7a8d', padding: '12px 0' }}>加载采集状态…</p>}>
        <CrawlOverview embedded />
      </Suspense>
    </AdminMain>
  );
}
