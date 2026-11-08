import type { TransactionSql } from 'postgres';
import { getDb } from './db';
import { overviewIssuesForAnnouncement } from './metrics-overview-server';
import {
  emptyReviewLogSummary,
  normalizeReviewIssues,
  summarizeReviewLog,
  type ReviewAction,
  type ReviewLogEntry,
  type ReviewLogSummary,
  type ReviewReason,
} from './metrics-review-log';

export type OverviewReviewWrite = {
  announcementId: string;
  code: string;
  period: string;
  action: ReviewAction;
  reason: ReviewReason | null;
  note: string | null;
};

type LogRow = {
  id: number;
  announcement_id: string;
  code: string;
  name: string | null;
  period: string;
  action: string;
  reason: string | null;
  issues: unknown;
  note: string | null;
  created_at: Date | string;
};

function asIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function asReason(value: string | null): ReviewReason | null {
  if (value === 'real_disclosure' || value === 'parse_value' || value === 'parse_page_unit' || value === 'parse_period') {
    return value;
  }
  return null;
}

/**
 * Current status stays one row per announcement.
 * The event table only inserts, so a later pass does not erase the earlier reason.
 */
export async function writeOverviewReview(
  db: ReturnType<typeof getDb>,
  input: OverviewReviewWrite,
): Promise<{ issues: ReturnType<typeof normalizeReviewIssues> }> {
  return db.begin(async (tx) => {
    const issues = await overviewIssuesForAnnouncement(tx, input.announcementId);
    if (input.action === 'acked') {
      await tx`
        INSERT INTO metrics_overview_reviews (announcement_id, code, period, status, note, updated_at)
        VALUES (${input.announcementId}, ${input.code}, ${input.period}, 'acked', ${input.note}, NOW())
        ON CONFLICT (announcement_id) DO UPDATE
        SET code=EXCLUDED.code,
            period=EXCLUDED.period,
            status='acked',
            note=COALESCE(EXCLUDED.note, metrics_overview_reviews.note),
            updated_at=NOW()
      `;
      await tx`
        INSERT INTO metrics_overview_acks (announcement_id, code, period, note, acked_at)
        VALUES (${input.announcementId}, ${input.code}, ${input.period}, ${input.note}, NOW())
        ON CONFLICT (announcement_id) DO UPDATE
        SET code=EXCLUDED.code,
            period=EXCLUDED.period,
            note=COALESCE(EXCLUDED.note, metrics_overview_acks.note),
            acked_at=NOW()
      `;
    } else {
      await tx`
        INSERT INTO metrics_overview_reviews (announcement_id, code, period, status, note, updated_at)
        VALUES (${input.announcementId}, ${input.code}, ${input.period}, 'flagged', ${input.note}, NOW())
        ON CONFLICT (announcement_id) DO UPDATE
        SET code=EXCLUDED.code,
            period=EXCLUDED.period,
            status='flagged',
            note=COALESCE(EXCLUDED.note, metrics_overview_reviews.note),
            updated_at=NOW()
      `;
      await tx`DELETE FROM metrics_overview_acks WHERE announcement_id=${input.announcementId}`;
    }
    await tx`
      INSERT INTO metrics_overview_review_events
        (announcement_id, code, period, action, reason, issues, note, created_at)
      VALUES (
        ${input.announcementId},
        ${input.code},
        ${input.period},
        ${input.action},
        ${input.reason},
        ${tx.json(issues)},
        ${input.note},
        NOW()
      )
    `;
    return { issues };
  });
}

export async function loadReviewLog(db: ReturnType<typeof getDb> | TransactionSql = getDb()): Promise<{
  summary: ReviewLogSummary;
  recent: ReviewLogEntry[];
  latestAckReason: Map<string, ReviewReason | null>;
}> {
  const counted = await db<Array<{ action: string; reason: string | null }>>`
    SELECT action, reason FROM metrics_overview_review_events
  `;
  const summary = summarizeReviewLog(counted.flatMap((row) => (
    row.action === 'acked' || row.action === 'flagged'
      ? [{ action: row.action, reason: asReason(row.reason) }]
      : []
  )));

  const latest = await db<Array<{ announcement_id: string; reason: string | null }>>`
    SELECT DISTINCT ON (announcement_id) announcement_id, reason
    FROM metrics_overview_review_events
    WHERE action='acked'
    ORDER BY announcement_id, created_at DESC, id DESC
  `;
  const latestAckReason = new Map<string, ReviewReason | null>();
  for (const row of latest) latestAckReason.set(row.announcement_id, asReason(row.reason));

  const recentRows = await db<LogRow[]>`
    SELECT e.id, e.announcement_id, e.code, c.name, e.period, e.action, e.reason, e.issues, e.note, e.created_at
    FROM metrics_overview_review_events e
    LEFT JOIN companies c ON c.code = e.code
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT 20
  `;
  const recent: ReviewLogEntry[] = recentRows.map((row) => ({
    id: Number(row.id),
    announcementId: row.announcement_id,
    code: row.code,
    name: row.name?.trim() || '',
    period: row.period,
    action: row.action === 'flagged' ? 'flagged' : 'acked',
    reason: asReason(row.reason),
    issues: normalizeReviewIssues(row.issues),
    note: row.note?.trim() || null,
    createdAt: asIso(row.created_at),
  }));

  return { summary: counted.length ? summary : emptyReviewLogSummary(), recent, latestAckReason };
}
