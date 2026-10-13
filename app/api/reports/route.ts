import { getDb } from '@/lib/db';
import { apiError } from '@/lib/api';
import { parseReportListQuery, type ReportListResponse } from '@/contracts/reports';
import { classifyReportTitle, canonicalPeriodFromTitle } from '@/lib/ingest-period';
import { healFilingLabels } from '@/lib/period-heal';

export const dynamic = 'force-dynamic';

type ReportRow = {
  id: string;
  code: string;
  company_name: string;
  title: string;
  report_type: string;
  published_at: string;
  parsed_at: string | null;
  industry: string;
  status: string;
  [key: string]: unknown;
};
type MetricRow = {
  announcement_id: string;
  metric: import('@/lib/detail-model').MetricName;
  value: number;
  unit: string;
  period: string;
  source_page: number | null;
  source_label: string | null;
  confidence: number;
  verified: number;
};

export async function GET(request: Request) {
  try {
    const query = parseReportListQuery(new URL(request.url));
    const { limit, code } = query;
    const byCompany = query.view === 'companies';
    const db = getDb();
    const reports = byCompany && !code
      ? await db<ReportRow[]>`SELECT a.*, c.industry, c.rank FROM companies c JOIN LATERAL (
          SELECT a.* FROM announcements a WHERE a.code=c.code AND (
            SELECT COUNT(*) FROM financial_metrics m WHERE m.announcement_id=a.id AND m.metric IN ('revenue','net_profit','eps','roe')
          )=4 ORDER BY a.published_at DESC LIMIT 1
        ) a ON true WHERE c.enabled=true ORDER BY c.rank LIMIT ${limit}`
      : code
      ? await db<ReportRow[]>`SELECT a.*, c.industry, c.rank FROM announcements a JOIN companies c ON c.code=a.code WHERE a.code=${code} AND a.status <> 'auto_skipped' ORDER BY a.published_at DESC LIMIT ${limit}`
      : await db<ReportRow[]>`SELECT a.*, c.industry, c.rank FROM announcements a JOIN companies c ON c.code=a.code WHERE a.status <> 'auto_skipped' ORDER BY a.published_at DESC LIMIT ${limit}`;
    if (reports.length) {
      await healFilingLabels(db, reports.map((item) => ({
        id: item.id,
        title: String(item.title ?? ''),
        published_at: item.published_at,
      }))).catch(() => undefined);
      // Company previews still need the prior-year value for their delta cards.
      // Fetch it explicitly rather than relying on a global recent-report limit.
      if (byCompany && !code) {
        const prior = await db<ReportRow[]>`SELECT DISTINCT ON (a.code) a.*, c.industry, c.rank
          FROM announcements a JOIN companies c ON c.code=a.code
          JOIN financial_metrics p ON p.announcement_id=a.id AND p.metric='revenue'
          JOIN financial_metrics current ON current.announcement_id IN ${db(reports.map(r => r.id))} AND current.metric='revenue'
            AND current.code=a.code AND p.period=(SUBSTRING(current.period,1,4)::int-1)::text || SUBSTRING(current.period,5)
          JOIN announcements selected ON selected.id=current.announcement_id AND selected.report_type=a.report_type
          ORDER BY a.code, a.published_at DESC`;
        reports.push(...prior.filter(p => !reports.some(r => r.id === p.id)));
      }
      const metrics = await db<MetricRow[]>`
        SELECT announcement_id, period, metric, value, unit, source_page, source_label, confidence, verified
        FROM financial_metrics WHERE announcement_id IN ${db(reports.map((item) => item.id))}
        ORDER BY announcement_id, metric
      `;
      const metricsByReport = new Map<string, MetricRow[]>();
      for (const metric of metrics) metricsByReport.set(metric.announcement_id, [...(metricsByReport.get(metric.announcement_id) ?? []), metric]);
      const body = {
        source: 'postgresql',
        count: reports.length,
        reports: reports.map((item) => {
          const token = canonicalPeriodFromTitle(String(item.title ?? ''), item.published_at);
          const kind = classifyReportTitle(String(item.title ?? ''));
          const raw = metricsByReport.get(item.id) ?? [];
          const healed = token ? raw.map((metric) => ({ ...metric, period: token })) : raw;
          return {
            ...item,
            report_type: kind === 'other' ? item.report_type : kind,
            metrics: healed,
          };
        }),
      } satisfies ReportListResponse;
      return Response.json(body, { headers: { 'cache-control': 'no-store' } });
    }
    const empty = { source: 'postgresql', count: 0, reports: [] } satisfies ReportListResponse;
    return Response.json(empty, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
