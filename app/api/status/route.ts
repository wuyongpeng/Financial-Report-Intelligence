import companies from '@/data/companies.json';
import { getDb } from '@/lib/db';
import { bootstrapLiveData } from '@/lib/ingest';
import { requireAppUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const denied = requireAppUser(request);
  if (denied) return denied;
  try {
    const db = getDb();
    let [counts] = await db<Array<{ reports: number; parsed: number }>>`
      SELECT COUNT(*)::int AS reports, (SELECT COUNT(DISTINCT announcement_id)::int FROM financial_metrics) AS parsed FROM announcements
    `;
    let bootstrapped = false;
    if (!counts?.reports) {
      await bootstrapLiveData();
      bootstrapped = true;
      [counts] = await db<Array<{ reports: number; parsed: number }>>`
        SELECT COUNT(*)::int AS reports, (SELECT COUNT(DISTINCT announcement_id)::int FROM financial_metrics) AS parsed FROM announcements
      `;
    }
    const [health, latestRun] = await Promise.all([
      db`SELECT * FROM source_health ORDER BY source`,
      db`SELECT * FROM ingest_runs ORDER BY started_at DESC LIMIT 1`,
    ]);
    return Response.json({ mode: 'live', coverage: companies.length, health, latestRun: latestRun[0] ?? null, counts, bootstrapped }, {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    return Response.json({ mode: 'unavailable', coverage: companies.length, health: [], error: String(error) }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
