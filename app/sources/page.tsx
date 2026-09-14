import SourcesClient from './sources-client';

export const metadata = {
  title: '数据采集｜财报智析 Eva',
  description: '公告发现管线、抓取覆盖与解析状态总览。',
};

export default function SourcesPage() {
  return <SourcesClient />;
}
