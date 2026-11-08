'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { searchProductDocuments, type DocsSearchDoc } from '@/lib/docs-search';

function documentHref(name: string, query: string) {
  const params = new URLSearchParams();
  params.set('file', name);
  if (query.trim()) params.set('q', query.trim());
  return `/docs?${params.toString()}`;
}

function markQuery(query: string) {
  const css = CSS as unknown as { highlights?: { set: (name: string, value: unknown) => void; delete: (name: string) => void } };
  css.highlights?.delete('docs-query');
  const root = document.querySelector('.eva-docs-markdown');
  const q = query.trim().toLowerCase();
  if (!root || !q) return;
  const HighlightCtor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = node.textContent ?? '';
    const lower = text.toLowerCase();
    let from = 0;
    while (from < lower.length) {
      const at = lower.indexOf(q, from);
      if (at < 0) break;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + q.length);
      ranges.push(range);
      from = at + q.length;
    }
    node = walker.nextNode();
  }
  if (!ranges.length || !HighlightCtor || !css.highlights) return;
  css.highlights.set('docs-query', new HighlightCtor(...ranges));
  const parent = ranges[0]?.startContainer.parentElement;
  parent?.scrollIntoView({ block: 'center' });
}

export default function DocsSearch({
  documents,
  activeName,
  initialQuery = '',
}: {
  documents: DocsSearchDoc[];
  activeName: string;
  initialQuery?: string;
}) {
  const router = useRouter();
  const listId = useId();
  const [scope, setScope] = useState<'all' | 'current'>('all');
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    const id = 'eva-docs-query-highlight';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    // Custom Highlight API. Kept out of the CSS file because the production CSS parser rejects ::highlight().
    style.textContent = '::highlight(docs-query){background:#fde68a;color:#203047}';
    document.head.appendChild(style);
  }, []);

  useEffect(() => {
    markQuery(initialQuery);
    return () => {
      const css = CSS as unknown as { highlights?: { delete: (name: string) => void } };
      css.highlights?.delete('docs-query');
    };
  }, [initialQuery, activeName]);

  const hits = useMemo(
    () => searchProductDocuments(documents, query, { onlyName: scope === 'current' ? activeName : null }),
    [documents, query, scope, activeName],
  );

  function go(name: string, text: string) {
    setOpen(false);
    router.push(documentHref(name, text));
  }

  return (
    <form
      className="eva-docs-search"
      role="search"
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        setOpen(false);
      }}
      onSubmit={(event) => {
        event.preventDefault();
        const first = hits[0];
        if (first) go(first.name, query);
      }}
    >
      <select
        aria-label="搜索范围"
        value={scope}
        onChange={(event) => setScope(event.target.value === 'current' ? 'current' : 'all')}
      >
        <option value="all">全部</option>
        <option value="current">本文</option>
      </select>
      <input
        type="search"
        value={query}
        placeholder="搜索文档，如角标、追问"
        aria-label="搜索文档"
        aria-expanded={open && query.trim().length > 0}
        aria-controls={listId}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && query.trim() ? (
        <div className="eva-docs-search-list" id={listId} role="listbox" aria-label="搜索结果">
          {hits.length === 0 ? <p>没有找到相关内容</p> : hits.map((hit, index) => (
            <button
              key={`${hit.name}-${index}`}
              type="button"
              role="option"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => go(hit.name, query)}
            >
              <b>{hit.title}</b>
              <span>{hit.snippet}</span>
            </button>
          ))}
        </div>
      ) : null}
    </form>
  );
}
