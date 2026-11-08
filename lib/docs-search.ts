export type DocsSearchDoc = {
  name: string;
  title: string;
  content: string;
};

export type DocsSearchHit = {
  name: string;
  title: string;
  snippet: string;
};

function plainText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[#>*_|`~]/g, ' ')
    .replace(/\|/g, ' ');
}

/** Keyword hits across public docs. Up to three snippets per article. */
export function searchProductDocuments(
  docs: DocsSearchDoc[],
  query: string,
  options: { limit?: number; onlyName?: string | null } = {},
): DocsSearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 1) return [];
  const limit = options.limit ?? 8;
  const pool = options.onlyName ? docs.filter((doc) => doc.name === options.onlyName) : docs;
  const hits: DocsSearchHit[] = [];
  for (const doc of pool) {
    const plain = plainText(doc.content);
    const hay = plain.toLowerCase();
    let from = 0;
    let found = 0;
    while (hits.length < limit && found < 3) {
      const at = hay.indexOf(q, from);
      if (at < 0) break;
      const start = Math.max(0, at - 16);
      const end = Math.min(plain.length, at + q.length + 24);
      const snippet = (start > 0 ? '…' : '') + plain.slice(start, end).replace(/\s+/g, ' ').trim() + (end < plain.length ? '…' : '');
      hits.push({ name: doc.name, title: doc.title, snippet });
      from = at + q.length;
      found += 1;
    }
  }
  return hits;
}
