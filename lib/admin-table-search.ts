/**
 * Admin table quick search — match against joined visible cell text.
 * Case-insensitive; empty query matches all.
 */

export function matchesQuickSearch(
  query: string,
  parts: Array<string | number | boolean | null | undefined>,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return rowSearchHaystack(parts).includes(q);
}

export function rowSearchHaystack(
  parts: Array<string | number | boolean | null | undefined>,
): string {
  return parts
    .map((p) => {
      if (p == null) return '';
      if (typeof p === 'string') return p;
      if (typeof p === 'number' || typeof p === 'boolean') return String(p);
      return '';
    })
    .join(' ')
    .toLowerCase();
}
