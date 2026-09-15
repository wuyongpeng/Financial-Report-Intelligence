import { classifyReportTitle, canonicalPeriodFromTitle } from './ingest-period';
import { getDb } from './db';

type Db = ReturnType<typeof getDb>;

/** Rewrite stored metric periods when the announcement title is the source of truth. */
export async function healMetricPeriods(
  db: Db,
  rows: Array<{ id: string; title: string; published_at: unknown }>,
) {
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const token = canonicalPeriodFromTitle(row.title, row.published_at);
    if (!token || !row.id) continue;
    const list = groups.get(token) ?? [];
    list.push(row.id);
    groups.set(token, list);
  }
  for (const [token, ids] of groups) {
    if (!ids.length) continue;
    await db`
      UPDATE financial_metrics
      SET period=${token}
      WHERE announcement_id IN ${db(ids)}
        AND period IS DISTINCT FROM ${token}
    `;
  }
}

export async function healAnnouncementTypes(
  db: Db,
  rows: Array<{ id: string; title: string }>,
) {
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const kind = classifyReportTitle(row.title);
    if (kind === 'other' || !row.id) continue;
    const list = groups.get(kind) ?? [];
    list.push(row.id);
    groups.set(kind, list);
  }
  for (const [kind, ids] of groups) {
    if (!ids.length) continue;
    await db`
      UPDATE announcements
      SET report_type=${kind}
      WHERE id IN ${db(ids)}
        AND report_type IS DISTINCT FROM ${kind}
    `;
  }
}

export async function healFilingLabels(
  db: Db,
  rows: Array<{ id: string; title: string; published_at: unknown }>,
) {
  await healAnnouncementTypes(db, rows);
  await healMetricPeriods(db, rows);
}
