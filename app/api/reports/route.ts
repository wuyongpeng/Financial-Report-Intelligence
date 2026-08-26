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
    const result = await query.all();
    if (result.results.length) return Response.json({ source: 'database', count: result.results.length, reports: result.results });
  } catch {
    // Local previews and a brand-new deployment use the checked-in real-data snapshot until D1 is populated.
  }
  const filtered = code ? seedReports.filter((item) => item.code === code) : seedReports;
  return Response.json({ source: 'official-snapshot', count: Math.min(filtered.length, limit), reports: filtered.slice(0, limit), coverage: companies.length });
}
