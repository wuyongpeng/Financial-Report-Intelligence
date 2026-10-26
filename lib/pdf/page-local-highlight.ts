/**
 * Match a user question against the visible PDF page text so we can
 * highlight the relevant span *before* the model answers.
 * Pure string matching — no network.
 */

export type PageLocalMatch = {
  page: number;
  quote: string;
};

const MIN_QUOTE = 8;
const MAX_QUOTE = 120;
const LOOK_BACK = 80;
const LOOK_AHEAD = 16;

/** Question filler words that should not drive a highlight. */
const STOP_TERMS = new Set([
  '这里', '这边', '这个', '那个', '这些', '那些', '什么', '怎么', '怎样', '如何',
  '为什么', '为何', '请问', '请说', '告诉', '可以', '是否', '是不是', '有没有',
  '多少', '哪个', '哪些', '一下', '看看', '解释', '分析', '原因', '影响', '相关',
  '的话', '地方', '内容', '数据', '情况', '问题', '上面', '下面', '刚才', '目前',
  '当前', '本页', '这页', '那页', '财报', '报告', '公司', '我们', '你们', '他们',
]);

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function normalizeSpace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Strip thousand separators so "1,234.5" matches "1234.5" in OCR text. */
function numberVariants(raw: string): string[] {
  const withPct = raw.trim();
  const bare = withPct.replace(/%$/, '');
  const noComma = bare.replace(/,/g, '');
  const out = [withPct, bare, noComma];
  if (!withPct.endsWith('%')) out.push(`${bare}%`, `${noComma}%`);
  return unique(out.filter(Boolean));
}

export function extractQuestionTokens(question: string): { numbers: string[]; terms: string[] } {
  const q = normalizeSpace(question);
  const numbers: string[] = [];
  const numRe = /\d{1,3}(?:,\d{3})+(?:\.\d+)?%?|\d+(?:\.\d+)?%/g;
  let m: RegExpExecArray | null;
  while ((m = numRe.exec(q)) !== null) numbers.push(m[0]);
  // Also bare decimals / ints that look distinctive (≥3 digits or have a decimal).
  const bareRe = /(?<![.\d])\d+\.\d+(?![.\d])|(?<![.\d])\d{3,}(?![.\d%])/g;
  while ((m = bareRe.exec(q)) !== null) numbers.push(m[0]);

  // Split on particles / punctuation so "这里的应收账款的变动率是…" yields 应收账款, 变动率.
  const chunks = q
    .split(/[的是了吗呢吧在和与及对把被让给从向到为以而且或等与同并也又就都还很不没无么啥啥呀啊哦嗯\s，。！？、；：""''（）()\[\]【】《》,.!?;:]+/)
    .map(s => s.trim())
    .filter(Boolean);

  const terms: string[] = [];
  for (const chunk of chunks) {
    // Keep CJK runs of 2–12 (full 科目名 like 长期应付职工薪酬).
    // Only peel 3–4-grams from longer runs — 2-grams alone are too collision-prone
    // (长期/应付/职工 on cover/TOC) and must not drive a pre-answer jump.
    const cjk = chunk.match(/[\u4e00-\u9fff]+/g) ?? [];
    for (const run of cjk) {
      if (run.length >= 2 && run.length <= 12 && !STOP_TERMS.has(run)) terms.push(run);
      if (run.length > 4) {
        for (let len = Math.min(4, run.length); len >= 3; len--) {
          for (let i = 0; i + len <= run.length; i++) {
            const sub = run.slice(i, i + len);
            if (!STOP_TERMS.has(sub)) terms.push(sub);
          }
        }
      }
    }
  }
  // Prefer longer terms first when searching.
  terms.sort((a, b) => b.length - a.length);

  return { numbers: unique(numbers), terms: unique(terms) };
}

type Candidate = { start: number; end: number; score: number; hasNumber: boolean };

function pushCandidate(out: Candidate[], start: number, end: number, hasNumber: boolean, termHits: number) {
  const len = end - start;
  if (len < MIN_QUOTE) return;
  const score = len + termHits * 24 + (hasNumber ? 80 : 0);
  out.push({ start, end, score, hasNumber });
}

/** Best contiguous quote on a single page, or null if too weak. */
export function findQuoteOnPage(question: string, pageContent: string): string | null {
  const normalized = normalizeSpace(pageContent);
  if (normalized.length < MIN_QUOTE) return null;
  const { numbers, terms } = extractQuestionTokens(question);
  // Term-only needs ≥2 tokens and at least one ≥4-char anchor (科目名), else cover/TOC collisions.
  if (!numbers.length && (terms.length < 2 || !terms.some(t => t.length >= 4))) return null;

  const candidates: Candidate[] = [];

  for (const num of numbers) {
    for (const variant of numberVariants(num)) {
      let from = 0;
      while (from < normalized.length) {
        const at = normalized.indexOf(variant, from);
        if (at < 0) break;
        let start = at;
        let end = at + variant.length;
        let termHits = 0;
        // Prefer terms before the number (the usual "科目…47.78%" pattern).
        for (const term of terms) {
          const beforeFrom = Math.max(0, at - LOOK_BACK);
          const before = normalized.slice(beforeFrom, at);
          const bi = before.lastIndexOf(term);
          if (bi >= 0) {
            start = Math.min(start, beforeFrom + bi);
            termHits += 1;
          }
        }
        // Only peek a short distance after; stop at sentence punctuation so we
        // do not bleed into the next metric line.
        const afterLimit = (() => {
          const window = normalized.slice(end, end + LOOK_AHEAD);
          const stop = window.search(/[。；;！？\n]/);
          return stop >= 0 ? end + stop : end + LOOK_AHEAD;
        })();
        for (const term of terms) {
          const after = normalized.slice(end, afterLimit);
          const ai = after.indexOf(term);
          if (ai >= 0) {
            end = Math.max(end, end + ai + term.length);
            termHits += 1;
          }
        }
        // Include a bit of trailing context up to punctuation / percent clause end.
        const trail = normalized.slice(end, Math.min(normalized.length, end + 24));
        const trailStop = trail.search(/[。；;！？]/);
        if (trailStop > 0) end = end + trailStop;
        else if (/^[，,]/.test(trail)) {
          // keep through next short clause fragment without crossing 。
          const soft = trail.search(/[。；;]/);
          end = end + (soft > 0 ? soft : Math.min(trail.length, 12));
        }
        if (end - start < MIN_QUOTE) {
          start = Math.max(0, at - Math.ceil((MIN_QUOTE - (end - start)) / 2));
          end = Math.min(normalized.length, start + MIN_QUOTE);
        }
        const slice = normalized.slice(start, end);
        const hitTerms = terms.filter(t => slice.includes(t)).length;
        pushCandidate(candidates, start, end, true, Math.max(termHits, hitTerms));
        from = at + Math.max(1, variant.length);
      }
    }
  }

  // Multi-term window when no (or weak) number hit — never cross a sentence boundary.
  if (terms.length >= 2) {
    const positions = terms
      .map(term => {
        const at = normalized.indexOf(term);
        return at < 0 ? null : { term, at, len: term.length };
      })
      .filter((x): x is { term: string; at: number; len: number } => x != null);
    if (positions.length >= 2) {
      positions.sort((a, b) => a.at - b.at);
      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          const start = positions[i]!.at;
          const end = positions[j]!.at + positions[j]!.len;
          if (end - start > 80) break;
          const span = normalized.slice(start, end);
          if (/[。；;！？]/.test(span)) continue;
          const hitTerms = terms.filter(t => span.includes(t)).length;
          if (hitTerms >= 2) pushCandidate(candidates, start, end, /\d/.test(span), hitTerms);
        }
      }
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score || (b.end - b.start) - (a.end - a.start));
  const best = candidates[0]!;
  // Reject weak term-only hits. Require a ≥4-char anchor inside the quote.
  if (!best.hasNumber) {
    const slice = normalized.slice(best.start, best.end);
    const hasAnchor = terms.some(t => t.length >= 4 && slice.includes(t));
    if (!hasAnchor || best.score < 72) return null;
  }
  let quote = normalized.slice(best.start, best.end).trim();
  if (quote.length < MIN_QUOTE) return null;
  if (quote.length > MAX_QUOTE) quote = quote.slice(0, MAX_QUOTE);
  return quote;
}

/**
 * Prefer the current page; only fall back to ±nearbyRadius when current has no match.
 * Callers that must not yank the viewport (ask pre-highlight) should ignore hits
 * whose page !== currentPage — adjacent matches are for soft suggestion only.
 */
export function findPageLocalHighlight(
  question: string,
  pages: ReadonlyArray<{ page: number; content: string }>,
  currentPage: number,
  nearbyRadius = 1,
): PageLocalMatch | null {
  const byPage = new Map(pages.map(p => [p.page, p.content ?? '']));
  const onCurrent = findQuoteOnPage(question, byPage.get(currentPage) ?? '');
  if (onCurrent) return { page: currentPage, quote: onCurrent };

  let best: { page: number; quote: string; score: number } | null = null;
  for (let d = 1; d <= nearbyRadius; d++) {
    for (const page of [currentPage - d, currentPage + d]) {
      if (page < 1) continue;
      const content = byPage.get(page);
      if (!content) continue;
      const quote = findQuoteOnPage(question, content);
      if (!quote) continue;
      const score = quote.length + (/\d/.test(quote) ? 100 : 0);
      if (!best || score > best.score) best = { page, quote, score };
    }
  }
  return best ? { page: best.page, quote: best.quote } : null;
}
