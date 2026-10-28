export type AnswerCiteToken =
  | { kind: 'text'; text: string }
  | { kind: 'mark'; raw: string; evidenceId?: string; pageWord?: number; printed?: string };


/** Strip internal evidence ids like 【E2】 / [E2] — never show these in user-facing prose. */
export function stripInternalEvidenceMarks(text: string): string {
  return text
    .replace(/【\s*E\s*\d+\s*】/gi, '')
    .replace(/\[\s*E\s*\d+\s*\]/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([，。；：！？、])/g, '$1')
    .trim();
}

/** Keep first citation per (reportId, page) so chips do not repeat [Pxx]. */
export function uniqueCitationsByPage<T extends { page: number; reportId?: string }>(citations: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const c of citations) {
    const key = `${c.reportId ?? ''}:${c.page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

export type AttributionCiteSource = { id?: string; page: number; quote?: string; reportId?: string };

const E_MARK_RE = /【\s*E\s*(\d+)\s*】|\[\s*E\s*(\d+)\s*\]/gi;
const TRAILING_E_CLUSTER_RE = /(?:\s*(?:【\s*E\s*\d+\s*】|\[\s*E\s*\d+\s*\]))+\s*$/i;

function collapseAdjacentSamePageMarks(text: string): string {
  return text.replace(/(\[P(\d+)\])(?:\s*\[P\2\])+/g, '$1');
}

function pagesPrintedInText(text: string): Set<number> {
  return new Set([...text.matchAll(/\[P(\d+)\]/g)].map((m) => Number(m[1])));
}

function quoteDigits(quote: string): string[] {
  return [...quote.matchAll(/\d+(?:\.\d+)?%?/g)]
    .map((m) => m[0])
    .filter((d) => d.replace(/%/g, '').length >= 2);
}

function quoteKeywords(quote: string): string[] {
  const keys = ['营收', '营业收入', '净利润', '归母', '毛利率', '毛利', '财务费用', '营业成本', '现金流', '发电量', '销量', '售价', '研发', '存货', '应收'];
  return keys.filter((k) => quote.includes(k));
}

/** Split into clauses keeping trailing punctuation on each piece. */
function splitAttributionClauses(text: string): string[] {
  const parts = text.split(/(?<=[，。；；、])/);
  return parts.map((p) => p).filter((p) => p.length > 0);
}

function insertMarkAfterOffset(text: string, offset: number, mark: string): string {
  if (offset < 0 || offset > text.length) return text;
  if (text.slice(offset).startsWith(mark)) return text;
  if (/^\s*\[P\d+\]/.test(text.slice(offset))) return text;
  return `${text.slice(0, offset)}${mark}${text.slice(offset)}`;
}

/**
 * Place [Pxx] after a matching number, else after a matching clause end.
 * Skips when no local anchor is found (avoids piling marks at paragraph end).
 */
function insertPageMarkNearMatch(text: string, cite: AttributionCiteSource): string {
  const page = Math.floor(cite.page);
  if (!Number.isFinite(page) || page < 1) return text;
  const mark = `[P${page}]`;
  if (pagesPrintedInText(text).has(page)) return text;

  const quote = (cite.quote ?? '').replace(/\s+/g, ' ');
  for (const dig of quoteDigits(quote)) {
    const esc = dig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${esc}(?:\\s*(?:亿千瓦时|亿元|万人|万片|万吨|万千瓦|百分点|%|亿|万|元|倍|吨|片))?`);
    const m = re.exec(text);
    if (!m || m.index === undefined) continue;
    return insertMarkAfterOffset(text, m.index + m[0].length, mark);
  }

  const keywords = quoteKeywords(quote);
  if (keywords.length) {
    const clauses = splitAttributionClauses(text);
    let bestIdx = -1;
    let bestScore = 0;
    let cursor = 0;
    const starts: number[] = [];
    for (const clause of clauses) {
      starts.push(cursor);
      cursor += clause.length;
    }
    for (let i = 0; i < clauses.length; i += 1) {
      const score = keywords.reduce((sum, key) => sum + (clauses[i].includes(key) ? key.length : 0), 0);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestScore > 0) {
      const clause = clauses[bestIdx];
      const start = starts[bestIdx];
      const punct = clause.match(/[，。；；、]$/);
      const offset = punct
        ? start + clause.length - punct[0].length
        : start + clause.length;
      return insertMarkAfterOffset(text, offset, mark);
    }
  }

  return text;
}

/**
 * Rewrite attribution prose: 【En】 → [Ppage] beside related numbers / clause ends.
 * Trailing E piles are redistributed; unresolved E marks are stripped; same page is not repeated.
 */
export function embedAttributionPageCites(
  text: string,
  citations: AttributionCiteSource[],
  /** Extra rows used only to resolve 【En】 → page (e.g. full evidence pool). */
  resolvePool?: AttributionCiteSource[],
): string {
  if (!text) return '';
  const byId = new Map<string, AttributionCiteSource>();
  for (const c of [...(resolvePool ?? []), ...citations]) {
    const id = c.id?.trim().toUpperCase();
    if (id) byId.set(id, c);
  }

  let body = text.replace(/\[\s*PDF\s*(\d+)\s*\]/gi, '[P$1]');

  const trailing = body.match(TRAILING_E_CLUSTER_RE);
  const trailingIds: string[] = [];
  if (trailing) {
    for (const m of trailing[0].matchAll(/E\s*(\d+)/gi)) {
      trailingIds.push(`E${m[1]}`);
    }
    body = body.slice(0, trailing.index).trimEnd();
  }

  body = body.replace(E_MARK_RE, (_all, a: string, b: string) => {
    const id = `E${a || b}`;
    const hit = byId.get(id.toUpperCase());
    if (!hit || !Number.isFinite(hit.page) || hit.page < 1) return '';
    return `[P${Math.floor(hit.page)}]`;
  });
  body = collapseAdjacentSamePageMarks(body);

  const present = pagesPrintedInText(body);
  const toPlace: AttributionCiteSource[] = [];
  const seenKey = new Set<string>();
  const enqueue = (c: AttributionCiteSource | undefined) => {
    if (!c || !Number.isFinite(c.page) || c.page < 1) return;
    const page = Math.floor(c.page);
    const key = `${c.reportId ?? ''}:${page}`;
    if (seenKey.has(key) || present.has(page)) return;
    seenKey.add(key);
    toPlace.push(c);
  };

  for (const id of trailingIds) enqueue(byId.get(id.toUpperCase()));
  if (!present.size && !toPlace.length) {
    for (const c of uniqueCitationsByPage(citations)) enqueue(c);
  }

  for (const c of toPlace) {
    const before = body;
    body = insertPageMarkNearMatch(body, c);
    if (body !== before) present.add(Math.floor(c.page));
  }

  return collapseAdjacentSamePageMarks(stripInternalEvidenceMarks(body));
}

export function tokenizeAnswerCites(text: string): AnswerCiteToken[] {
  // Unify legacy [PDF 20] / [PDF20] marks to [P20] before tokenizing.
  const normalized = text
    .replace(/\[\s*PDF\s*(\d+)\s*\]/gi, '[P$1]')
    .replace(/(】)(?=【)/g, '$1 ')
    .replace(/(\])(?=\[P)/g, '$1 ');
  return normalized.split(/(【(?:E\d+|第\s*\d+\s*页)】|\[P\d+\])/g).flatMap((part): AnswerCiteToken[] => {
    if (!part) return [];
    const marked = part.match(/^【(?:E(\d+)|第\s*(\d+)\s*页)】$/);
    if (marked) {
      return [{
        kind: 'mark' as const,
        raw: part,
        evidenceId: marked[1] ? `E${marked[1]}` : undefined,
        pageWord: marked[2] ? Number(marked[2]) : undefined,
      }];
    }
    const bare = part.match(/^\[P(\d+)\]$/);
    if (bare) return [{ kind: 'mark' as const, raw: part, printed: bare[1] }];
    return [{ kind: 'text' as const, text: part }];
  });
}

export const FILING_CITE_QUOTE_MAX = 180;

export type FilingCite = { page?: number; quote?: string };

export function filingPageHref(code: string, period?: string, cite?: FilingCite) {
  if (!/^\d{6}$/.test(code)) return '';
  const params = new URLSearchParams();
  const token = period?.trim();
  if (token) params.set('period', token);
  const page = cite?.page;
  if (typeof page === 'number' && Number.isFinite(page) && page >= 1) {
    params.set('page', String(Math.floor(page)));
  }
  const quote = cite?.quote?.replace(/\s+/g, ' ').trim();
  if (quote) params.set('quote', quote.slice(0, FILING_CITE_QUOTE_MAX));
  const qs = params.toString();
  return qs ? `/${code}?${qs}` : `/${code}`;
}

export function parseFilingHref(href: string) {
  try {
    const url = href.startsWith('http://') || href.startsWith('https://')
      ? new URL(href)
      : new URL(href, 'https://local.invalid');
    const match = url.pathname.match(/^\/(\d{6})\/?$/);
    if (!match) return null;
    const period = url.searchParams.get('period') || undefined;
    const pageRaw = url.searchParams.get('page');
    const page = pageRaw && /^\d+$/.test(pageRaw) ? Number(pageRaw) : undefined;
    const quote = url.searchParams.get('quote')?.replace(/\s+/g, ' ').trim() || undefined;
    return {
      code: match[1],
      period,
      ...(page && page >= 1 ? { page } : {}),
      ...(quote ? { quote } : {}),
    };
  } catch {
    return null;
  }
}

export function filingKindLabel(period?: string) {
  if (!period) return '财报';
  if (/FY/i.test(period)) return '年度报告';
  if (/H1/i.test(period)) return '半年度报告';
  if (/Q[1-4]/i.test(period)) return '季度报告';
  return '财报';
}

export function citeHoverText(source: { companyName?: string; period?: string; page: number }) {
  return [source.companyName, source.period, '财报', `(第 ${source.page} 页)`].filter(Boolean).join(' ');
}

export function citeFilingLabel(source: { companyName?: string; period?: string }) {
  return [source.companyName, source.period, filingKindLabel(source.period)].filter(Boolean).join(' ');
}

export function citeReferenceText(source: { companyName?: string; period?: string; page: number }) {
  return [citeFilingLabel(source), `(第 ${source.page} 页)`].filter(Boolean).join(' ');
}

export function matchAnswerCitation<T extends { id?: string; page: number }>(
  token: Extract<AnswerCiteToken, { kind: 'mark' }>,
  citations: T[] | undefined,
  pageLabel: (page: number) => string,
) {
  if (!citations?.length) return undefined;
  if (token.evidenceId) return citations.find(item => item.id === token.evidenceId);
  if (token.pageWord !== undefined) return citations.find(item => item.page === token.pageWord);
  if (token.printed) {
    return citations.find(item => pageLabel(item.page) === `P${token.printed}` || item.page === Number(token.printed));
  }
  return undefined;
}

function filingSourceKey(cited: { reportId?: string; code?: string; companyName?: string; period?: string; page: number }) {
  if (cited.reportId) return `id:${cited.reportId}`;
  const filing = [cited.code, cited.companyName, cited.period].filter(Boolean).join(':');
  return filing ? `filing:${filing}` : `page:${cited.page}`;
}

export function uniqueAnswerSources<T extends {
  id?: string;
  reportId?: string;
  page: number;
  code?: string;
  companyName?: string;
  period?: string;
}>(
  text: string,
  citations: T[] | undefined,
  pageLabel: (page: number) => string,
) {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const token of tokenizeAnswerCites(text)) {
    if (token.kind !== 'mark') continue;
    const cited = matchAnswerCitation(token, citations, pageLabel);
    if (!cited) continue;
    const key = filingSourceKey(cited);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cited);
  }
  return out;
}
