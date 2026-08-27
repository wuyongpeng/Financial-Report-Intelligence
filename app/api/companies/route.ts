import companies from '@/data/companies.json';
import { getBindings } from '@/lib/runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { DB } = getBindings();
    const result = await DB.prepare(`
      SELECT c.*, COUNT(a.id) AS report_count,
        SUM(CASE WHEN a.status IN ('review','online','parse_partial') THEN 1 ELSE 0 END) AS parsed_count
      FROM companies c LEFT JOIN announcements a ON a.code=c.code
      WHERE c.enabled=1 GROUP BY c.code ORDER BY c.rank
    `).all();
    if (result.results.length) return Response.json({ source: 'database', count: result.results.length, companies: result.results }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    // The checked-in coverage configuration is the local-development fallback.
  }
  return Response.json({ source: 'coverage-config', count: companies.length, companies, generatedAt: new Date().toISOString() });
}
