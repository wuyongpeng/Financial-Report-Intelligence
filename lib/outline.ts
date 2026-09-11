export type ReportChunk = { page: number; content: string };
export type OutlineSection = {
  id: string;
  title: string;
  level: 1 | 2;
  page: number;
  endPage: number;
  excerpt: string;
  highlight: string;
  source: 'detected' | 'standard' | 'toc';
};

type Rule = { id: string; title: string; terms: string[] };
type PageLabelLike = { page: number; printed: number | null };

// The rules are deliberately deterministic. They create a useful reading map
// even when a PDF has no machine-readable table of contents.
const standardRules: Rule[] = [
  { id: 'summary', title: '报告摘要与主要会计数据', terms: ['报告摘要', '主要会计数据', '主要财务指标'] },
  { id: 'mda', title: '管理层讨论与分析', terms: ['管理层讨论与分析', '经营情况讨论与分析', '经营分析'] },
  { id: 'risk', title: '风险因素与重大风险提示', terms: ['重大风险提示', '风险因素', '风险提示'] },
  { id: 'financials', title: '财务报表', terms: ['财务报表', '合并资产负债表', '合并利润表', '合并现金流量表'] },
  { id: 'notes', title: '财务报表附注', terms: ['财务报表附注', '会计报表附注'] },
  { id: 'governance', title: '公司治理', terms: ['公司治理', '董事会报告', '监事会报告'] },
];

function cleanExcerpt(content: string, term: string) {
  const position = content.indexOf(term);
  const start = Math.max(0, position < 0 ? 0 : position - 24);
  return content.slice(start, start + 170).replace(/\s+/g, ' ').trim();
}

function isContents(content: string) {
  return /目\s*录/.test(content.slice(0, 180)) || /[.．…·]{5,}/.test(content) || (content.match(/第[一二三四五六七八九十百\d]+[章节]/g)?.length ?? 0) >= 3;
}

function sectionScore(content: string, terms: string[]) {
  if (isContents(content)) return -1;
  let best = -1;
  for (const term of terms) {
    const at = content.indexOf(term);
    if (at < 0) continue;
    const before = content.slice(Math.max(0, at - 60), at);
    if (/本报告|详见|参见|请参阅|已在|见本/.test(before)) continue;
    const heading = new RegExp(`第[一二三四五六七八九十百\\d]+[章节]\\s*${term}`).test(content);
    best = Math.max(best, (heading ? 100 : 0) + (at < 220 ? 30 : 0) + (content.length > 600 ? 5 : 0));
  }
  return best;
}

function parseTocEntries(content: string) {
  const entries: { title: string; printed: number; highlight: string }[] = [];
  // A-share 目录 lines: "第一节 释义 …… 4" / "第二节 … P4" / dotted leaders.
  const re = /(第[一二三四五六七八九十百零〇两\d]+[章节]\s*[^\n\d.…·．.]{1,42}?)\s*(?:[.．…·]{2,}|…+)\s*(?:[Pp]\s*)?(\d{1,3})\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const highlight = match[1].replace(/\s+/g, ' ').trim();
    const title = highlight.replace(/[.．…·\s]+$/g, '').trim();
    const printed = Number(match[2]);
    if (!title || printed < 1 || printed > 500) continue;
    if (entries.some((item) => item.title === title)) continue;
    entries.push({ title, printed, highlight });
  }
  return entries;
}

function resolveTocPage(title: string, printed: number, chunks: ReportChunk[], labels?: PageLabelLike[]) {
  const mapped = labels?.find((item) => item.printed === printed)?.page;
  if (mapped) return mapped;
  const key = title.replace(/^第[一二三四五六七八九十百零〇两\d]+[章节]\s*/, '').slice(0, 18);
  for (const chunk of chunks) {
    if (isContents(chunk.content)) continue;
    if (chunk.content.includes(title) || (key.length >= 2 && chunk.content.includes(key))) return chunk.page;
  }
  // Last resort: treat printed as physical only when it lands inside indexed pages.
  if (chunks.some((chunk) => chunk.page === printed)) return printed;
  return null;
}

function fromToc(chunks: ReportChunk[], labels?: PageLabelLike[]): OutlineSection[] {
  const raw: { title: string; printed: number; highlight: string }[] = [];
  for (const chunk of chunks) {
    if (!isContents(chunk.content) && !/目\s*录/.test(chunk.content.slice(0, 180))) continue;
    for (const entry of parseTocEntries(chunk.content)) {
      if (raw.some((item) => item.title === entry.title)) continue;
      raw.push(entry);
    }
  }
  if (raw.length < 3) return [];
  const output: OutlineSection[] = [];
  for (const [index, entry] of raw.entries()) {
    const page = resolveTocPage(entry.title, entry.printed, chunks, labels);
    if (page === null) continue;
    // Same printed/PDF page can host multiple sections (e.g. 第七节+第八节); keep both.
    if (output.some((item) => item.title === entry.title)) continue;
    const body = chunks.find((chunk) => chunk.page === page && !isContents(chunk.content)) ?? chunks.find((chunk) => chunk.page === page);
    output.push({
      id: `toc-${index + 1}`,
      title: entry.title,
      level: 1,
      page,
      endPage: page,
      excerpt: body ? cleanExcerpt(body.content, entry.highlight) : entry.title,
      highlight: entry.highlight,
      source: 'toc',
    });
  }
  return output.length >= 3 ? output : [];
}

function fromHeuristic(chunks: ReportChunk[]): OutlineSection[] {
  const output: OutlineSection[] = [];
  for (const rule of standardRules) {
    const hit = chunks.map(chunk => ({ ...chunk, score: sectionScore(chunk.content, rule.terms) }))
      .filter(chunk => chunk.score > 0).sort((a, b) => b.score - a.score || a.page - b.page)[0];
    if (!hit) continue;
    const term = rule.terms.find((item) => hit.content.includes(item)) ?? rule.title;
    output.push({ id: rule.id, title: rule.title, level: 1, page: hit.page, endPage: hit.page, excerpt: cleanExcerpt(hit.content, term), highlight: term, source: 'standard' });
  }
  // Annual reports commonly contain numbered "第X节" headings. Preserve a
  // limited number as a second-level navigation aid, without inventing names.
  for (const chunk of chunks) {
    if (isContents(chunk.content)) continue;
    const match = chunk.content.match(/第[一二三四五六七八九十百]+[章节]\s*([^。；;]{2,42})/);
    if (!match) continue;
    const title = `第${match[0].split('第')[1]}`.replace(/\s+/g, ' ').trim();
    if (output.some((item) => item.page === chunk.page || item.title.includes(title))) continue;
    output.push({ id: `detected-${chunk.page}`, title, level: 2, page: chunk.page, endPage: chunk.page, excerpt: cleanExcerpt(chunk.content, match[0]), highlight: match[0], source: 'detected' });
    if (output.filter((item) => item.source === 'detected').length >= 12) break;
  }
  return output;
}

export function buildOutline(chunks: ReportChunk[], labels?: PageLabelLike[]): OutlineSection[] {
  const toc = fromToc(chunks, labels);
  const output = toc.length ? toc : fromHeuristic(chunks);
  return output.sort((a, b) => a.page - b.page || a.level - b.level).map((item, index, all) => ({
    ...item,
    endPage: Math.max(item.page, (all[index + 1]?.page ?? item.page) - 1),
  }));
}
