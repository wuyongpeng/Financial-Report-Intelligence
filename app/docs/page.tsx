import Link from 'next/link';
import { isValidElement, type ReactNode } from 'react';
import { notFound, redirect } from 'next/navigation';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { documentHref, listProductDocuments, productDocumentLink, readProductDocument } from '@/lib/product-documents';
import MermaidBlock from './mermaid-block';
import './docs.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: '文档中心｜财报智析 Eva' };

const DEFAULT_DOC = '产品介绍.md';

function extractMermaidSource(node: ReactNode): string | null {
  if (!isValidElement(node)) return null;
  const props = node.props as { className?: string; children?: ReactNode };
  const className = props.className ?? '';
  if (!className.includes('language-mermaid')) return null;
  return String(props.children ?? '').replace(/\n$/, '');
}

export default async function DocumentsPage({ searchParams }: {
  searchParams: Promise<{ file?: string | string[] }>;
}) {
  const params = await searchParams;
  const selected = Array.isArray(params.file) ? params.file[0] : params.file;
  if (!selected) redirect(documentHref(DEFAULT_DOC));

  const documents = await listProductDocuments();
  const document = documents.find(item => item.name === selected);
  if (!document) notFound();
  const content = await readProductDocument(document.name);
  if (content == null) notFound();
  const names = documents.map(item => item.name);

  return (
    <main className="eva-docs">
      <header className="eva-docs-header">
        <Link href="/" className="eva-docs-back">← 返回首页</Link>
        <h1>文档中心</h1>
        <p>产品介绍 · 财报分析说明 · 功能评测 · 用户调研 · 技术架构</p>
      </header>
      <div className="eva-docs-layout is-reading">
        <nav className="eva-docs-nav" aria-label="文档列表">
          <div className="eva-docs-nav-title">对外文档 <span>{documents.length} 篇</span></div>
          {documents.length ? documents.map(item => (
            <Link key={item.name} href={documentHref(item.name)} aria-current={document.name === item.name ? 'page' : undefined}>
              {item.title}
            </Link>
          )) : <p className="eva-docs-empty">暂无文档，请确认部署包含文档目录。</p>}
        </nav>
        <article className="eva-docs-content" aria-label={document.title}>
          <Markdown remarkPlugins={[remarkGfm]} urlTransform={url => productDocumentLink(url, names)} components={{
            a: ({ href, children }) => href ? <a href={href}>{children}</a> : <span>{children}</span>,
            table: ({ children }) => <div className="eva-docs-table"><table>{children}</table></div>,
            pre: ({ children }) => {
              const chart = extractMermaidSource(children);
              if (chart != null) return <MermaidBlock chart={chart} />;
              return <pre>{children}</pre>;
            },
          }}>{content}</Markdown>
        </article>
      </div>
    </main>
  );
}
