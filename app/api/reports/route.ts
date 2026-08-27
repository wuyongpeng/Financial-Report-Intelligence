import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

type ReportRow = Record<string, unknown> & { id: string };
type MetricRow = Record<string, unknown> & { announcement_id: string };

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50), 1), 100);
  const code = url.searchParams.get('code');
  try {
    const db = getDb();
    const reports = code
      ? await db<ReportRow[]>`SELECT a.*, c.industry, c.rank FROM announcements a JOIN companies c ON c.code=a.code WHERE a.code=${code} ORDER BY a.published_at DESC LIMIT ${limit}`
      : await db<ReportRow[]>`SELECT a.*, c.industry, c.rank FROM announcements a JOIN companies c ON c.code=a.code ORDER BY a.published_at DESC LIMIT ${limit}`;
    if (reports.length) {
      const metrics = await db<MetricRow[]>`
        SELECT announcement_id, period, metric, value, unit, source_page, source_label, confidence, verified
        FROM financial_metrics WHERE announcement_id IN ${db(reports.map((item) => item.id))}
        ORDER BY announcement_id, metric
      `;
      const metricsByReport = new Map<string, MetricRow[]>();
      for (const metric of metrics) metricsByReport.set(metric.announcement_id, [...(metricsByReport.get(metric.announcement_id) ?? []), metric]);
      return Response.json({ source: 'postgresql', count: reports.length, reports: reports.map((item) => ({ ...item, metrics: metricsByReport.get(item.id) ?? [] })) }, {
        headers: { 'cache-control': 'no-store' },
      });
    }
    return Response.json({ source: 'postgresql', count: 0, reports: [] }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: `PostgreSQL unavailable: ${String(error)}` }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
