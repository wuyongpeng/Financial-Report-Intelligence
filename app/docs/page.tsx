import Link from 'next/link';
import { notFound } from 'next/navigation';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { documentHref, listProductDocuments, productDocumentLink, readProductDocument } from '@/lib/product-documents';
import './docs.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: '文档中心｜财报智析 Eva' };

export default async function DocumentsPage({ searchParams }: {
  searchParams: Promise<{ file?: string | string[] }>;
}) {
  const params = await searchParams;
  const selected = Array.isArray(params.file) ? params.file[0] : params.file;
  const documents = await listProductDocuments();
  const document = selected ? documents.find(item => item.name === selected) : undefined;
  if (selected && !document) notFound();
  const content = document ? await readProductDocument(document.name) : null;
  const names = documents.map(item => item.name);

  return (
    <main className="eva-docs">
      <header className="eva-docs-header">
        <Link href="/" className="eva-docs-back">← 返回首页</Link>
        <h1>文档中心</h1>
        <p>产品说明、技术架构与分析标准</p>
      </header>
      <div className={`eva-docs-layout${document ? ' is-reading' : ''}`}>
        <nav className="eva-docs-nav" aria-label="文档列表">
          <div className="eva-docs-nav-title">全部文档 <span>{documents.length} 篇</span></div>
          {documents.length ? documents.map(item => (
            <Link key={item.name} href={documentHref(item.name)} aria-current={document?.name === item.name ? 'page' : undefined}>
              {item.title}
            </Link>
          )) : <p className="eva-docs-empty">暂无文档，请确认部署包含文档目录。</p>}
        </nav>
        {document && content != null ? (
          <article className="eva-docs-content" aria-label={document.title}>
            <Link href="/docs" className="eva-docs-list-back">← 全部文档</Link>
            <Markdown remarkPlugins={[remarkGfm]} urlTransform={url => productDocumentLink(url, names)} components={{
              a: ({ href, children }) => href ? <a href={href}>{children}</a> : <span>{children}</span>,
              table: ({ children }) => <div className="eva-docs-table"><table>{children}</table></div>,
            }}>{content}</Markdown>
          </article>
        ) : (
          <section className="eva-docs-welcome">
            <span className="eva-docs-symbol" aria-hidden="true">▤</span>
            <h2>从这里了解 Eva</h2>
            <p>选择一篇文档阅读。分析标准与候选目录会明确区分已实现能力和后续规划。</p>
            <Link href={documentHref('产品介绍.md')}>阅读产品介绍 →</Link>
          </section>
        )}
      </div>
    </main>
  );
}
