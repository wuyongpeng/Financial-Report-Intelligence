export type AnswerCiteToken =
  | { kind: 'text'; text: string }
  | { kind: 'mark'; raw: string; evidenceId?: string; pageWord?: number; printed?: string };

export function tokenizeAnswerCites(text: string): AnswerCiteToken[] {
  const normalized = text.replace(/(】)(?=【)/g, '$1 ').replace(/(\])(?=\[P)/g, '$1 ');
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

export function filingPageHref(code: string, period?: string) {
  if (!/^\d{6}$/.test(code)) return '';
  const token = period?.trim();
  return token ? `/${code}?period=${encodeURIComponent(token)}` : `/${code}`;
}

export function parseFilingHref(href: string) {
  try {
    const url = href.startsWith('http://') || href.startsWith('https://')
      ? new URL(href)
      : new URL(href, 'https://local.invalid');
    const match = url.pathname.match(/^\/(\d{6})\/?$/);
    if (!match) return null;
    return { code: match[1], period: url.searchParams.get('period') || undefined };
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

export function citeReferenceText(source: { companyName?: string; period?: string; page: number }) {
  return [source.companyName, source.period, filingKindLabel(source.period), `(第 ${source.page} 页)`].filter(Boolean).join(' ');
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

export function uniqueAnswerSources<T extends { id?: string; reportId?: string; page: number }>(
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
    const key = `${cited.reportId ?? ''}:${cited.page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cited);
  }
  return out;
}
