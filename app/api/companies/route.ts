import companies from '@/data/companies.json';
import { getDb } from '@/lib/db';
import { requireAppUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const denied = requireAppUser(request);
  if (denied) return denied;
  try {
    const db = getDb();
    const rows = await db`
      SELECT c.*, COUNT(a.id)::int AS report_count,
        COUNT(DISTINCT m.announcement_id)::int AS parsed_count
      FROM companies c
      LEFT JOIN announcements a ON a.code=c.code
      LEFT JOIN financial_metrics m ON m.announcement_id=a.id
      WHERE c.enabled=true GROUP BY c.code ORDER BY c.rank
    `;
    if (rows.length) return Response.json({ source: 'postgresql', count: rows.length, companies: rows }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    // Local development fallback.
  }
  return Response.json({ source: 'coverage-config', count: companies.length, companies, generatedAt: new Date().toISOString() });
}
