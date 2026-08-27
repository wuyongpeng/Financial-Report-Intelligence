import companies from '@/data/companies.json';
import seedReports from '@/data/seed-reports.json';
import { getBindings } from '@/lib/runtime';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50), 1), 100);
  const code = url.searchParams.get('code');
  try {
    const { DB } = getBindings();
    const query = code
      ? DB.prepare(`SELECT a.*, c.industry, c.rank FROM announcements a JOIN companies c ON c.code=a.code WHERE a.code=? ORDER BY a.published_at DESC LIMIT ?`).bind(code, limit)
      : DB.prepare(`SELECT a.*, c.industry, c.rank FROM announcements a JOIN companies c ON c.code=a.code ORDER BY a.published_at DESC LIMIT ?`).bind(limit);
    const result = await query.all<Record<string, unknown> & { id: string }>();
    if (result.results.length) {
      const placeholders = result.results.map(() => '?').join(',');
      const metricResult = await DB.prepare(`
        SELECT announcement_id, period, metric, value, unit, source_page, source_label, confidence, verified
        FROM financial_metrics
        WHERE announcement_id IN (${placeholders})
        ORDER BY announcement_id, metric
      `).bind(...result.results.map((item) => item.id)).all<Record<string, unknown> & { announcement_id: string }>();
      const metrics = new Map<string, Array<Record<string, unknown>>>();
      for (const metric of metricResult.results) {
        const values = metrics.get(metric.announcement_id) ?? [];
        values.push(metric);
        metrics.set(metric.announcement_id, values);
      }
      const reports = result.results.map((item) => ({ ...item, metrics: metrics.get(item.id) ?? [] }));
      return Response.json({ source: 'database', count: reports.length, reports }, { headers: { 'cache-control': 'no-store' } });
    }
  } catch {
    // Local previews and a brand-new deployment use the checked-in real-data snapshot until D1 is populated.
  }
  const filtered = code ? seedReports.filter((item) => item.code === code) : seedReports;
  return Response.json({
    source: 'official-snapshot', count: Math.min(filtered.length, limit), coverage: companies.length,
    reports: filtered.slice(0, limit).map((item) => ({ ...item, status: 'discovered', metrics: [] })),
  }, { headers: { 'cache-control': 'no-store' } });
}
