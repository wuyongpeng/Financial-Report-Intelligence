/** Match outline / page text for TOC jump and continuous section read. */

export type OutlineLike = { id?: string; title: string; page: number; highlight?: string };
export type PageLike = { page: number; content: string };

const CN_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

/** Parse 三 / 十二 / 二十三 / 3 → number. */
export function parseChineseOrdinal(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d{1,3}$/.test(s)) {
    const n = Number(s);
    return n >= 1 && n <= 200 ? n : null;
  }
  if (s === '十') return 10;
  if (/^十[一二三四五六七八九]$/.test(s)) return 10 + (CN_DIGITS[s[1]!] ?? 0);
  if (/^[二三四五六七八九]十$/.test(s)) return (CN_DIGITS[s[0]!] ?? 0) * 10;
  if (/^[二三四五六七八九]十[一二三四五六七八九]$/.test(s)) {
    return (CN_DIGITS[s[0]!] ?? 0) * 10 + (CN_DIGITS[s[2]!] ?? 0);
  }
  if (s.length === 1 && CN_DIGITS[s] != null && CN_DIGITS[s]! >= 1) return CN_DIGITS[s]!;
  return null;
}

export function extractSectionOrdinal(query: string): number | null {
  const m = query.match(/第([一二三四五六七八九十百零〇两\d]{1,4})[章节]/);
  if (!m) return null;
  return parseChineseOrdinal(m[1]!);
}

const SECTION_ALIASES: { id: string; terms: string[] }[] = [
  { id: 'mda', terms: ['管理层讨论与分析', '管理层讨论', '经营情况讨论与分析', '经营分析', 'mda', 'md&a'] },
  { id: 'risk', terms: ['风险因素', '重大风险提示', '重大风险', '风险提示'] },
  { id: 'financials', terms: ['财务报表', '合并报表', '合并资产负债表', '合并利润表'] },
  { id: 'notes', terms: ['财务报表附注', '会计报表附注', '附注'] },
  { id: 'governance', terms: ['公司治理', '董事会报告'] },
  { id: 'summary', terms: ['报告摘要', '主要会计数据', '主要财务指标'] },
];

function norm(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase();
}

function isContentsPage(content: string): boolean {
  return /目\s*录/.test(content.slice(0, 180)) || /[.．…·]{5,}/.test(content);
}

/** Find a 目录 page among extracted pages. */
export function findTocPage(pages: PageLike[]): number | null {
  for (const p of pages) {
    if (/目\s*录/.test(p.content.slice(0, 200))) return p.page;
  }
  for (const p of pages) {
    if (isContentsPage(p.content)) return p.page;
  }
  return null;
}

export type MatchedSection = {
  title: string;
  page: number;
  highlight: string;
  /** Exclusive end page (next section start), or null if unknown. */
  endPage: number | null;
  /** Char offset into start page content where the heading begins (0 if unknown). */
  startOffset: number;
};

function nextSectionEnd(
  outline: OutlineLike[],
  index: number,
  pages: PageLike[],
  ordinal: number | null,
): number | null {
  if (index >= 0 && index + 1 < outline.length) {
    const next = outline[index + 1]!;
    if (next.page > outline[index]!.page) return next.page;
    if (next.page === outline[index]!.page) return next.page; // same page — reader truncates by heading
  }
  if (ordinal != null) {
    const nextLabel = `第${ordinal + 1}节`;
    // Also try Chinese numeral for ordinal+1 via simple 1-20 map
    const cn = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十'];
    const nextCn = ordinal + 1 <= 20 ? `第${cn[ordinal + 1]}节` : null;
    for (const p of pages) {
      if (p.page <= (outline[index]?.page ?? 0)) continue;
      if (p.content.includes(nextLabel) || (nextCn && p.content.includes(nextCn))) return p.page;
    }
  }
  return null;
}

function offsetOfHighlight(content: string, highlight: string): number {
  if (!highlight) return 0;
  const at = content.indexOf(highlight);
  if (at >= 0) return at;
  const compact = content.replace(/\s+/g, '');
  const needle = highlight.replace(/\s+/g, '');
  if (!needle) return 0;
  const cAt = compact.indexOf(needle.slice(0, Math.min(needle.length, 12)));
  if (cAt < 0) return 0;
  // Approximate: walk content until compact index reached.
  let ci = 0;
  for (let i = 0; i < content.length; i++) {
    if (/\s/.test(content[i]!)) continue;
    if (ci === cAt) return i;
    ci++;
  }
  return 0;
}

/** Resolve a spoken section query against outline + page text. */
export function matchSection(
  query: string,
  outline: OutlineLike[],
  pages: PageLike[],
): MatchedSection | null {
  const q = query.replace(/\s+/g, '');
  if (!q) return null;
  const ordinal = extractSectionOrdinal(q);
  const qn = norm(q);

  // 1) Outline title / highlight match
  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < outline.length; i++) {
    const item = outline[i]!;
    const title = norm(item.title);
    const hi = norm(item.highlight ?? '');
    let score = 0;
    if (ordinal != null && extractSectionOrdinal(item.title) === ordinal) score += 100;
    if (title.includes(qn) || qn.includes(title)) score += 40;
    if (hi && (hi.includes(qn) || qn.includes(hi))) score += 30;
    for (const alias of SECTION_ALIASES) {
      if (!alias.terms.some((term) => qn.includes(norm(term)))) continue;
      if (alias.terms.some((term) => title.includes(norm(term)) || hi.includes(norm(term)))) {
        score += 50;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  if (bestIdx >= 0 && bestScore >= 40) {
    const item = outline[bestIdx]!;
    const pageContent = pages.find((p) => p.page === item.page)?.content ?? '';
    const highlight = item.highlight || item.title;
    return {
      title: item.title,
      page: item.page,
      highlight,
      endPage: nextSectionEnd(outline, bestIdx, pages, ordinal ?? extractSectionOrdinal(item.title)),
      startOffset: offsetOfHighlight(pageContent, highlight),
    };
  }

  // 2) Page text search for 「第N节 …」 or alias terms (skip 目录 pages)
  const needles: string[] = [];
  if (ordinal != null) {
    const cn = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十'];
    if (ordinal <= 20) needles.push(`第${cn[ordinal]}节`, `第${cn[ordinal]}章`, `第${ordinal}节`);
  }
  for (const alias of SECTION_ALIASES) {
    if (alias.terms.some((term) => qn.includes(norm(term)))) {
      needles.push(...alias.terms);
    }
  }
  // bare keyword leftovers
  const stripped = q.replace(/^第[一二三四五六七八九十百零〇两\d]+[章节]/, '').replace(/^(朗读|读一下|读读|从|开始读|开始)/, '');
  if (stripped.length >= 2) needles.push(stripped);

  for (const needle of needles) {
    if (needle.length < 2) continue;
    for (const p of pages) {
      if (isContentsPage(p.content)) continue;
      const at = p.content.indexOf(needle);
      if (at < 0) continue;
      const before = p.content.slice(Math.max(0, at - 40), at);
      if (/本报告|详见|参见|请参阅|已在|见本/.test(before)) continue;
      // Find next section page for end bound
      let endPage: number | null = null;
      if (ordinal != null) {
        const cn = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十'];
        const nextCn = ordinal + 1 <= 20 ? `第${cn[ordinal + 1]}节` : `第${ordinal + 1}节`;
        for (const later of pages) {
          if (later.page < p.page) continue;
          if (later.page === p.page) {
            const nextAt = later.content.indexOf(nextCn, at + needle.length);
            if (nextAt >= 0) {
              endPage = later.page; // same page — truncate in reader
              break;
            }
            continue;
          }
          if (later.content.includes(nextCn)) {
            endPage = later.page;
            break;
          }
        }
      }
      return {
        title: needle,
        page: p.page,
        highlight: needle,
        endPage,
        startOffset: at,
      };
    }
  }

  return null;
}

/**
 * Build speakable chunks for continuous section read.
 * First page starts at startOffset; later pages full until endPage (exclusive) or next heading truncate.
 */
export function buildSectionReadChunks(
  pages: PageLike[],
  matched: MatchedSection,
  maxCharsPerPage = 900,
): { page: number; text: string }[] {
  const sorted = [...pages].sort((a, b) => a.page - b.page);
  const chunks: { page: number; text: string }[] = [];
  const endExclusive = matched.endPage;
  for (const p of sorted) {
    if (p.page < matched.page) continue;
    if (endExclusive != null && p.page > endExclusive) break;
    if (endExclusive != null && p.page === endExclusive && p.page !== matched.page) break;

    let body = p.content.replace(/\s+/g, ' ').trim();
    if (!body) continue;

    if (p.page === matched.page && matched.startOffset > 0) {
      // Use original content for offset, then collapse whitespace for TTS.
      const sliced = p.content.slice(matched.startOffset);
      body = sliced.replace(/\s+/g, ' ').trim();
    }

    if (endExclusive != null && p.page === endExclusive && p.page === matched.page) {
      // Next section on same page — cut at next 第N节 after start.
      const nextHit = body.search(/第[一二三四五六七八九十百零〇两\d]+[章节]/);
      if (nextHit > 8) body = body.slice(0, nextHit).trim();
    } else if (p.page > matched.page) {
      // Stop if this page opens with a new major section heading.
      const head = body.slice(0, 40);
      if (/^第[一二三四五六七八九十百零〇两\d]+[章节]/.test(head.replace(/\s+/g, ''))) {
        break;
      }
    }

    if (!body) continue;
    if (body.length > maxCharsPerPage) body = `${body.slice(0, maxCharsPerPage)}…`;
    chunks.push({ page: p.page, text: body });
    // If end is same page we already truncated — done.
    if (endExclusive != null && p.page === endExclusive) break;
  }
  return chunks;
}
