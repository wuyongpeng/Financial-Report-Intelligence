import { getDb } from './db';
import { canonicalPeriodFromTitle } from './ingest-period';

export type AuditReportMeta = {
  companyCode: string | null;
  period: string | null;
  reportType: string | null;
};

/** Best-effort company/period for audit rows; never throws. */
export async function resolveAuditReportMeta(reportId: string | null | undefined): Promise<AuditReportMeta> {
  const empty: AuditReportMeta = { companyCode: null, period: null, reportType: null };
  if (!reportId?.trim()) return empty;
  try {
    const db = getDb();
    const [row] = await db<Array<{
      code: string;
      report_type: string | null;
      title: string;
      published_at: unknown;
      metric_period: string | null;
    }>>`
      SELECT a.code, a.report_type, a.title, a.published_at,
        (SELECT m.period FROM financial_metrics m WHERE m.announcement_id = a.id ORDER BY m.metric LIMIT 1) AS metric_period
      FROM announcements a
      WHERE a.id = ${reportId}
      LIMIT 1
    `;
    if (!row) return empty;
    const period = canonicalPeriodFromTitle(row.title, row.published_at)
      ?? (row.metric_period ? String(row.metric_period) : null);
    return {
      companyCode: row.code ? String(row.code) : null,
      period,
      reportType: row.report_type == null ? null : String(row.report_type),
    };
  } catch (error) {
    console.error('[client-audit] resolve report meta failed', error instanceof Error ? error.message : error);
    return empty;
  }
}
