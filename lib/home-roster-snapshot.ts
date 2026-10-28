/**
 * Compact homepage company roster for home voice/chat prompts.
 * Mirrors what the user sees on the home cards/list — not a report RAG dump.
 * Home-only: never inject into company-detail /api/chat.
 */
import {
  hasDownloadedPdf,
  hasReadableMetrics,
  type CrawlCompanyCoverage,
} from './crawl-display';

export type HomeRosterRow = {
  code: string;
  name: string;
  industryGroup: string;
  reportPeriod: string | null;
  /** Objective UI signals only — never investment ranking. */
  flags: string[];
};

const MAX_CHARS = 3600;
const MAX_ROWS = 80;

function clip(text: string, max: number) {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

function objectiveFlags(
  item: CrawlCompanyCoverage,
  starred?: ReadonlySet<string>,
): string[] {
  const flags: string[] = [];
  if (starred?.has(item.code)) flags.push('已收藏');
  if (hasReadableMetrics(item)) flags.push('已可读');
  else if (hasDownloadedPdf(item) && (item.parseStatus === 'failed' || item.parseError)) {
    flags.push('解析失败');
  } else if (hasDownloadedPdf(item) && (item.parseStatus === 'parsing' || item.parseStatus === 'queued')) {
    flags.push(item.parseStatus === 'parsing' ? '解析中' : '排队解析');
  } else if (hasDownloadedPdf(item)) {
    flags.push('已下载待解析');
  } else if (item.covered) {
    flags.push('已发现待下载');
  } else {
    flags.push('等待抓取');
  }
  if (item.latestExpectedMissing) flags.push('新期待更新');
  return flags;
}

/** Map coverage cards into slim roster rows for prompts / local answers. */
export function buildHomeRosterRows(
  companies: CrawlCompanyCoverage[],
  opts?: { starred?: ReadonlySet<string>; limit?: number },
): HomeRosterRow[] {
  const limit = opts?.limit ?? MAX_ROWS;
  const out: HomeRosterRow[] = [];
  for (const item of companies) {
    if (!item?.code || !item?.name) continue;
    out.push({
      code: item.code,
      name: item.name,
      industryGroup: item.industryGroup || item.industry || '其他',
      reportPeriod: item.reportPeriod ?? null,
      flags: objectiveFlags(item, opts?.starred),
    });
    if (out.length >= limit) break;
  }
  return out;
}

export type HomeRosterSnapshotMeta = {
  /** Cards currently painted on screen (grid window or full list). */
  visibleCount: number;
  /** After search/industry filter, before grid windowing. */
  filteredCount: number;
  /** Full monitor-pool size. */
  poolCount: number;
  industry?: string;
  viewMode?: 'grid' | 'list';
};

/**
 * Build the「首页公司清单快照」block for home AI prompts.
 * Answers about「有哪些公司 / 某某在不在 / 哪些值得分析」must prefer this section.
 */
export function formatHomeRosterSnapshot(
  rows: HomeRosterRow[],
  meta?: HomeRosterSnapshotMeta,
): string {
  const header = [
    '首页公司清单快照（与用户当前首页所见一致；问「有哪些公司 / 在不在 / 监控池」时优先依据本节；',
    '「哪些值得分析」只许用客观信号如已可读、新期待更新、已收藏、解析中，禁止投资排名或买卖建议）：',
  ].join('');

  const scopeBits: string[] = [];
  if (meta) {
    scopeBits.push(`屏幕可见 ${meta.visibleCount} 家`);
    if (meta.filteredCount !== meta.visibleCount) {
      scopeBits.push(`筛选后 ${meta.filteredCount} 家`);
    }
    scopeBits.push(`监控池共 ${meta.poolCount} 家`);
    if (meta.industry && meta.industry !== '全部') scopeBits.push(`行业筛选：${meta.industry}`);
    if (meta.viewMode) scopeBits.push(meta.viewMode === 'list' ? '列表视图' : '卡片视图');
  }

  const lines: string[] = [header];
  if (scopeBits.length) lines.push(`范围：${scopeBits.join(' · ')}`);
  if (!rows.length) {
    lines.push('（当前可见清单为空）');
    return clip(lines.join('\n'), MAX_CHARS);
  }

  lines.push('【当前清单】');
  for (const row of rows) {
    const period = row.reportPeriod ? `·${row.reportPeriod}` : '';
    const flags = row.flags.length ? `·${row.flags.join('/')}` : '';
    lines.push(`- ${row.name}（${row.code}）${row.industryGroup}${period}${flags}`);
  }
  return clip(lines.join('\n'), MAX_CHARS);
}
