export type PdfPageLabel = { page: number; label: string; printed: number | null };

/** Prefer header/footer page marks; ignore money-like trailing digits. */
function pageNumberCandidates(page: number, content: string): number[] {
  const text = content.trim();
  const head = text.slice(0, 220);
  const found: Array<string | undefined> = [
    // 宜宾五粮液…半年度报告全文 8 / …年度报告全文 12
    head.match(/全文\s*(\d{1,3})\b/)?.[1],
    // …半年度报告 8 第一节 / …年报 3 目录
    head.match(/(?:年度报告|半年度报告|季度报告|年报|半年报|季报)[^\d]{0,24}(\d{1,3})\s+(?:第|[一二三四五六七八九十]|目录|重要|公司)/)?.[1],
    head.match(/\s(\d{1,3})\s+第[一二三四五六七八九十]+节/)?.[1],
    text.match(/(?:^|\s)(\d{1,3})\s*\/\s*\d{1,4}(?:\s|$)/)?.[1],
    text.match(/^(\d{1,3})\s+[\u4e00-\u9fff]{2,}.*?公司/)?.[1],
    text.slice(0, 180).match(/公司.{0,70}?\s(\d{1,3})\s+20\d{2}\s*年/)?.[1],
  ];
  // Trailing standalone page number only when not a money fragment.
  const end = text.match(/\s(\d{1,3})$/);
  if (end) {
    const before = text.slice(-24);
    if (!/[.,，]\d+\s*$/.test(before) && !/\d{4,}/.test(before)) {
      found.push(end[1]);
    }
  }
  return [...new Set(found.filter((n): n is string => Boolean(n)).map(Number))].filter((n) => n >= 1 && n <= 500);
}

// Stored evidence uses physical PDF pages. Only infer printed numbering when
// several independent headers/footers agree; never subtract a cover blindly.
export function buildPageLabels(pages: { page: number; content: string }[]): PdfPageLabel[] {
  const votes = new Map<number, Set<number>>();
  for (const { page, content } of pages) {
    for (const n of pageNumberCandidates(page, content)) {
      const offset = page - n;
      if (offset < 0 || offset > 8) continue;
      if (!votes.has(offset)) votes.set(offset, new Set());
      votes.get(offset)!.add(page);
    }
  }
  const ranked = [...votes].sort((a, b) => b[1].size - a[1].size);
  const offset = ranked[0]?.[1].size >= 3 && ranked[0][1].size > (ranked[1]?.[1].size ?? 0) * 2
    ? ranked[0][0]
    : undefined;
  return Array.from({ length: Math.max(0, ...pages.map((p) => p.page)) }, (_, i) => {
    const page = i + 1;
    const printed = offset !== undefined && page > offset ? page - offset : null;
    return {
      page,
      printed,
      label: printed !== null
        ? String(printed)
        : offset !== undefined && page <= offset
          ? (page === 1 ? '封面' : '未编号页')
          : `PDF ${page}`,
    };
  });
}

export function resolvePageQuestion(question: string, labels: PdfPageLabel[]) {
  return question.replace(/(PDF\s*)?第\s*(\d+)\s*页/gi, (full, pdf: string | undefined, page: string) => {
    if (pdf) return full;
    const match = labels.find((p) => p.printed === Number(page));
    // An unavailable printed page must not fall back to an unrelated physical page.
    return labels.some((p) => p.printed !== null) ? `第${match?.page ?? 0}页` : full;
  });
}
