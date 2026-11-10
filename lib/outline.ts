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
type HeadingHit = { title: string; page: number; highlight: string };

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

// A-share quarterly reports usually have no 目录. Section titles are short and
// fairly standardized; longest names are matched first against flattened text.
const knownHeadingTitles = [
  '按中国会计准则编制的季度财务报表',
  '主要会计数据和财务指标',
  '公司简介和主要财务指标',
  '管理层讨论与分析',
  '募集资金使用情况',
  '流动性覆盖率信息',
  '股份变动及股东情况',
  '其他提醒事项',
  '其他重要事项',
  '季度财务报表',
  '主要财务数据',
  '主要会计数据',
  '公司基本情况',
  '股东信息',
  '股东情况',
  '财务报表',
  '重要提示',
  '重要事项',
  '公司简介',
  '补充资料',
  '备查文件',
];

const cnOrdinals = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'] as const;
const headingBoundary = /(?:（\s*[一二三四五六七八九十]+\s*）|\(\s*[一二三四五六七八九十]+\s*\)|[□√☑■●◦\uf052]|单位\s*[:：]|需提醒投资者|公司是否需|合并资产负债表|合并利润表|合并现金流量表|合并及公司资产负债表|编制单位|未经审计)/;

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

function bareHeadingTitle(title: string) {
  return title.replace(/^[一二三四五六七八九十]+、\s*|^\d{1,2}\s+/, '').trim();
}

function extractHeadingTitle(after: string) {
  const trimmed = after.replace(/^\s+/, '');
  if (!trimmed) return '';
  for (const known of knownHeadingTitles) {
    if (trimmed.startsWith(known)) return known;
  }
  const cut = (trimmed.split(headingBoundary)[0] ?? '').replace(/\s+/g, ' ').replace(/[。；;：:,，、\s]+$/g, '').trim();
  if (!cut || /^\d/.test(cut)) return '';
  return cut;
}

function isPlausibleSectionTitle(title: string) {
  const text = bareHeadingTitle(title);
  if (text.length < 2 || text.length > 24) return false;
  if (/[。；;]/.test(text)) return false;
  if (/保证|是否存在|出席董事会|声明：|出具了|本报告书中/.test(text)) return false;
  if (/^(营业总收入|营业总成本|营业利润|净利润|综合收益|每股收益|经营活动|投资活动|筹资活动|现金及现金等价物|其他综合收益)/.test(text)) return false;
  return true;
}

function sequenceFromHeadings(found: Map<string, HeadingHit>, ordinals: readonly string[], prefix: string, chunks: ReportChunk[]) {
  const entries: HeadingHit[] = [];
  for (const ordinal of ordinals) {
    const item = found.get(ordinal);
    if (!item || !isPlausibleSectionTitle(item.title)) break;
    entries.push(item);
  }
  if (entries.length < 3) return [];
  const blob = entries.map((item) => item.title).join(' ');
  const knownHits = knownHeadingTitles.filter((title) => blob.includes(title)).length;
  if (knownHits < 2) return [];
  return entries.map((item, index) => {
    const body = chunks.find((chunk) => chunk.page === item.page);
    return {
      id: `${prefix}-${index + 1}`,
      title: item.title,
      level: 1 as const,
      page: item.page,
      endPage: item.page,
      excerpt: body ? cleanExcerpt(body.content, item.highlight) : item.title,
      highlight: item.highlight,
      source: 'detected' as const,
    };
  });
}

// CSRC quarterly format: "一、主要财务数据" / "二、股东信息" / "三、其他提醒事项" /
// "四、季度财务报表". Some SZSE reports insert "募集资金使用情况".
function fromCnNumberedHeadings(chunks: ReportChunk[]) {
  const found = new Map<string, HeadingHit>();
  const re = /(?:^|[^一二三四五六七八九十])([一二三四五六七八九十]+)、\s*/g;
  for (const chunk of chunks) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(chunk.content)) !== null) {
      const ordinal = match[1];
      if (!(cnOrdinals as readonly string[]).includes(ordinal) || found.has(ordinal)) continue;
      const title = extractHeadingTitle(chunk.content.slice(match.index + match[0].length));
      if (!isPlausibleSectionTitle(title)) continue;
      const highlight = `${ordinal}、${title}`;
      found.set(ordinal, { title: highlight, page: chunk.page, highlight });
    }
  }
  return sequenceFromHeadings(found, cnOrdinals, 'q', chunks);
}

// Bank-style quarterlies number sections in Arabic: "2 主要财务数据 2.1 …",
// "5 财务报表", "6 流动性覆盖率信息".
function fromArabicNumberedHeadings(chunks: ReportChunk[]) {
  const ordinals = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
  const found = new Map<string, HeadingHit>();
  const re = /(?<![\d.])(\d{1,2})\s+/g;
  for (const chunk of chunks) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(chunk.content)) !== null) {
      const ordinal = match[1];
      if (!ordinals.includes(ordinal) || found.has(ordinal)) continue;
      const title = extractHeadingTitle(chunk.content.slice(match.index + match[0].length));
      if (!isPlausibleSectionTitle(title)) continue;
      const highlight = `${ordinal} ${title}`;
      found.set(ordinal, { title: highlight, page: chunk.page, highlight });
    }
  }
  return sequenceFromHeadings(found, ordinals, 'qn', chunks);
}

function fromNumberedHeadings(chunks: ReportChunk[]) {
  const chinese = fromCnNumberedHeadings(chunks);
  return chinese.length ? chinese : fromArabicNumberedHeadings(chunks);
}

function isChapterCitation(content: string, at: number, rest: string) {
  const before = content.slice(Math.max(0, at - 50), at);
  return /本报告|详见|参见|请参阅|已在|见本|招股说明书/.test(before) || /^第?[一二三四五六七八九十]+部分/.test(rest.trim());
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
  // Skip mid-sentence citations such as “详见…招股说明书第五章第七部分”.
  for (const chunk of chunks) {
    if (isContents(chunk.content)) continue;
    const re = /第[一二三四五六七八九十百]+[章节]\s*([^。；;\n]{2,42})/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(chunk.content)) !== null) {
      if (isChapterCitation(chunk.content, match.index, match[1])) continue;
      const title = `第${match[0].split('第')[1]}`.replace(/\s+/g, ' ').trim();
      if (output.some((item) => item.page === chunk.page || item.title.includes(title))) continue;
      output.push({ id: `detected-${chunk.page}`, title, level: 2, page: chunk.page, endPage: chunk.page, excerpt: cleanExcerpt(chunk.content, match[0]), highlight: match[0], source: 'detected' });
      if (output.filter((item) => item.source === 'detected').length >= 12) return output;
      break;
    }
  }
  return output;
}

export function buildOutline(chunks: ReportChunk[], labels?: PageLabelLike[]): OutlineSection[] {
  const toc = fromToc(chunks, labels);
  const output = toc.length ? toc : fromNumberedHeadings(chunks);
  const resolved = output.length ? output : fromHeuristic(chunks);
  return resolved.sort((a, b) => a.page - b.page || a.level - b.level).map((item, index, all) => ({
    ...item,
    endPage: Math.max(item.page, (all[index + 1]?.page ?? item.page) - 1),
  }));
}
