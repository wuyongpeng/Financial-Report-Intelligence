import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export type ProductDocument = { name: string; title: string };

/** Public /docs catalog order. Only these top-level Markdown files are listed. */
export const PUBLIC_DOCUMENT_ORDER = [
  '产品介绍.md',
  '设计理念.md',
  '财报分析说明.md',
  '功能评测.md',
  '用户调研.md',
  '技术架构.md',
] as const;

export function documentHref(name: string) {
  return `/docs?file=${encodeURIComponent(name)}`;
}

/** Only whitelisted Markdown files directly inside the public documentation directory. */
export async function listProductDocuments(directory = resolve(process.cwd(), 'docs')): Promise<ProductDocument[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const available = new Set(
      entries.filter(entry => entry.isFile() && entry.name.endsWith('.md')).map(entry => entry.name),
    );
    return PUBLIC_DOCUMENT_ORDER
      .filter(name => available.has(name))
      .map(name => ({ name, title: name.slice(0, -3) }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function readProductDocument(name: string, directory = resolve(process.cwd(), 'docs')) {
  const documents = await listProductDocuments(directory);
  if (!documents.some(document => document.name === name)) return null;
  return readFile(resolve(directory, name), 'utf8');
}

/** Keep document navigation local, preserve anchors, and reject unsafe URL protocols. */
export function productDocumentLink(url: string, names: string[]) {
  if (url.startsWith('#')) return url;
  if (/^https?:\/\//i.test(url)) return url;
  let decoded: string;
  try { decoded = decodeURIComponent(url); } catch { return ''; }
  const [path, anchor] = decoded.split('#', 2);
  const name = path.replace(/^(?:\.\/|\.\.\/docs\/|docs\/)/, '');
  if (!names.includes(name)) return '';
  return `${documentHref(name)}${anchor ? `#${encodeURIComponent(anchor)}` : ''}`;
}
