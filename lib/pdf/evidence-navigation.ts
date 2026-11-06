/** Shared quote semantics for page resolution and painted highlights. */
export const normalizePdfText = (text: string) => text.replace(/\s/g, '');

export function pdfQuoteIndex(text: string, quote: string, cite = true): number {
  const full = normalizePdfText(text);
  const needle = normalizePdfText(quote);
  if (!needle) return -1;
  let at = full.indexOf(needle);
  // A qualified opinion is not the substring inside an unqualified opinion.
  while (cite && needle === '保留意见' && at >= 0 && full[at - 1] === '无') {
    at = full.indexOf(needle, at + needle.length);
  }
  return at;
}

export async function resolvePdfQuotePage(
  requested: number, total: number, quote: string,
  readText: (page: number) => Promise<string>,
): Promise<number> {
  const page = Math.min(Math.max(1, requested), total);
  const needle = normalizePdfText(quote).slice(0, 40);
  if (needle.length < 4) return page;
  const candidates = [page, page - 1, page + 1, page - 2, page + 2]
    .filter((p) => p >= 1 && p <= total);
  for (const candidate of candidates) {
    try {
      if (pdfQuoteIndex(await readText(candidate), needle) >= 0) return candidate;
    } catch { /* unreadable page: keep looking nearby */ }
  }
  return page;
}

export type PdfPageSize = { width: number; height: number };

/** Metadata only, no canvases/text: settle every slot's aspect ratio before jumping.
 * Bounded concurrency avoids rendering hundreds of pages or flooding the worker.
 */
export async function measurePdfPages(
  total: number, readSize: (page: number) => Promise<PdfPageSize>,
  fallback: PdfPageSize = { width: 595, height: 842 },
): Promise<PdfPageSize[]> {
  const sizes = Array.from({ length: total }, () => ({ ...fallback }));
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, total) }, async () => {
    while (next < total) {
      const i = next++;
      try {
        const size = await readSize(i + 1);
        if (size.width > 0 && size.height > 0) sizes[i] = size;
      } catch { /* reserve a stable fallback even for damaged pages */ }
    }
  }));
  return sizes;
}

/** All inputs are CSS pixels (highlightY is converted from canvas pixels by caller). */
export function pdfJumpScrollTop(pageTop: number, viewportHeight: number, highlightY: number | null): number {
  return Math.max(0, highlightY === null ? pageTop - 12 : pageTop + highlightY - viewportHeight * 0.32);
}
