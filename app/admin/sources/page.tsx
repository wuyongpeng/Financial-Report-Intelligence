import { SourcesAdminClient } from './sources-admin-client';

export const metadata = {
  title: '数据采集 · Eva 数据运营',
  description: '公告发现、抓取覆盖与解析/智析队列。',
};

export default function AdminSourcesPage() {
  return <SourcesAdminClient />;
}
