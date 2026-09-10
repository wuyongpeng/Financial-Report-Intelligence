export type PdfPageLabel = { page: number; label: string; printed: number | null };

// Stored evidence uses physical PDF pages. Only infer printed numbering when
// several independent headers/footers agree; never subtract a cover blindly.
export function buildPageLabels(pages: { page: number; content: string }[]): PdfPageLabel[] {
  const votes = new Map<number, Set<number>>();
  for (const { page, content } of pages) {
    const text = content.trim();
    const candidates = [
      text.match(/(?:^|\s)(\d{1,3})\s*\/\s*\d{1,4}(?:\s|$)/)?.[1],
      text.match(/^(\d{1,3})\s+[\u4e00-\u9fff]{2,}.*?公司/)?.[1],
      text.slice(0,180).match(/公司.{0,70}?\s(\d{1,3})\s+20\d{2}\s*年/)?.[1],
      text.match(/\s(\d{1,3})$/)?.[1],
    ].filter((n): n is string => n !== undefined);
    for (const n of new Set(candidates.map(Number))) {
      const offset = page - n;
      if (n < 1 || offset < 0 || offset > 8) continue;
      if (!votes.has(offset)) votes.set(offset, new Set());
      votes.get(offset)!.add(page);
    }
  }
  const ranked = [...votes].sort((a,b)=>b[1].size-a[1].size);
  const offset = ranked[0]?.[1].size >= 3 && ranked[0][1].size > (ranked[1]?.[1].size ?? 0) * 2 ? ranked[0][0] : undefined;
  return Array.from({ length: Math.max(0,...pages.map(p=>p.page)) }, (_, i) => {
    const page = i + 1;
    const printed = offset !== undefined && page > offset ? page - offset : null;
    return { page, printed, label: printed !== null ? String(printed) : offset !== undefined && page <= offset ? (page === 1 ? '封面' : '未编号页') : `PDF ${page}` };
  });
}

export function resolvePageQuestion(question: string, labels: PdfPageLabel[]) {
  return question.replace(/(PDF\s*)?第\s*(\d+)\s*页/gi, (full, pdf: string | undefined, page: string) => {
    if (pdf) return full;
    const match = labels.find(p=>p.printed === Number(page));
    // An unavailable printed page must not fall back to an unrelated physical page.
    return labels.some(p=>p.printed !== null) ? `第${match?.page ?? 0}页` : full;
  });
}
