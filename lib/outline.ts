export type ReportChunk = { page: number; content: string };
export type OutlineSection = {
  id: string;
  title: string;
  level: 1 | 2;
  page: number;
  endPage: number;
  excerpt: string;
  highlight: string;
  source: 'detected' | 'standard';
};

type Rule = { id: string; title: string; terms: string[] };

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

export function buildOutline(chunks: ReportChunk[]): OutlineSection[] {
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
  return output.sort((a, b) => a.page - b.page || a.level - b.level).map((item, index, all) => ({
    ...item,
    endPage: Math.max(item.page, (all[index + 1]?.page ?? item.page) - 1),
  }));
}
