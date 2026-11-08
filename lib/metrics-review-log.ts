/**
 * Append-only reasons for /admin/metrics 审核通过.
 * Counts are click events, not unique companies.
 */

import type { OverviewIssue } from './metrics-overview';

export const REVIEW_REASONS = [
  'real_disclosure',
  'parse_value',
  'parse_page_unit',
  'parse_period',
  'reparsed_match',
] as const;

export type ReviewReason = (typeof REVIEW_REASONS)[number];
export type ReviewAction = 'acked' | 'flagged';

export const REVIEW_REASON_LABEL: Record<ReviewReason, string> = {
  real_disclosure: '不是错误，披露就是这样',
  parse_value: '解析错了：抽错数',
  parse_page_unit: '解析错了：页码或单位错',
  parse_period: '解析错了：报告或期次抓错',
  reparsed_match: '重新解析后数据一致',
};

const REASON_SET = new Set<string>(REVIEW_REASONS);
const ISSUE_SET = new Set<OverviewIssue>(['missing', 'no_page', 'absurd_yoy', 'period_mismatch']);

export type ReviewLogEvent = {
  action: ReviewAction;
  reason: ReviewReason | null;
};

export type ReviewLogSummary = {
  ackCount: number;
  realDisclosure: number;
  parseError: number;
  parseValue: number;
  parsePageUnit: number;
  parsePeriod: number;
  reparsedMatch: number;
  unstated: number;
  flagCount: number;
};

export type ReviewLogEntry = {
  id: number;
  announcementId: string;
  code: string;
  name: string;
  period: string;
  action: ReviewAction;
  reason: ReviewReason | null;
  issues: OverviewIssue[];
  note: string | null;
  createdAt: string;
};

/** null = 没选；'invalid' = 客户端传了认不出的值。 */
export function parseReviewReason(value: unknown): ReviewReason | null | 'invalid' {
  if (value == null) return null;
  if (typeof value !== 'string') return 'invalid';
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!REASON_SET.has(trimmed)) return 'invalid';
  return trimmed as ReviewReason;
}

export function isParseErrorReason(reason: ReviewReason | null): boolean {
  return reason === 'parse_value' || reason === 'parse_page_unit' || reason === 'parse_period';
}

export function normalizeReviewIssues(raw: unknown): OverviewIssue[] {
  if (!Array.isArray(raw)) return [];
  const out: OverviewIssue[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !ISSUE_SET.has(item as OverviewIssue)) continue;
    if (!out.includes(item as OverviewIssue)) out.push(item as OverviewIssue);
  }
  return out;
}

export function emptyReviewLogSummary(): ReviewLogSummary {
  return {
    ackCount: 0,
    realDisclosure: 0,
    parseError: 0,
    parseValue: 0,
    parsePageUnit: 0,
    parsePeriod: 0,
    reparsedMatch: 0,
    unstated: 0,
    flagCount: 0,
  };
}

/** Each 审核通过 click counts once, including repeated passes on the same row. */
export function summarizeReviewLog(events: readonly ReviewLogEvent[]): ReviewLogSummary {
  const summary = emptyReviewLogSummary();
  for (const event of events) {
    if (event.action === 'flagged') {
      summary.flagCount += 1;
      continue;
    }
    if (event.action !== 'acked') continue;
    summary.ackCount += 1;
    if (event.reason === 'real_disclosure') summary.realDisclosure += 1;
    else if (event.reason === 'parse_value') {
      summary.parseError += 1;
      summary.parseValue += 1;
    } else if (event.reason === 'parse_page_unit') {
      summary.parseError += 1;
      summary.parsePageUnit += 1;
    } else if (event.reason === 'parse_period') {
      summary.parseError += 1;
      summary.parsePeriod += 1;
    } else if (event.reason === 'reparsed_match') summary.reparsedMatch += 1;
    else summary.unstated += 1;
  }
  return summary;
}
