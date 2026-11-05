import SourcesClient from './sources-client';

export const metadata = {
  title: 'Eva - 财报智能分析助手',
  description: '公告发现管线、抓取覆盖与解析状态总览。',
};

export default function SourcesPage() {
  return <SourcesClient />;
}
