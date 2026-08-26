import companies from '@/data/companies.json';
import { getBindings } from '@/lib/runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { DB } = getBindings();
    const [health, latestRun, counts] = await Promise.all([
      DB.prepare('SELECT * FROM source_health ORDER BY source').all(),
      DB.prepare('SELECT * FROM ingest_runs ORDER BY started_at DESC LIMIT 1').first(),
      DB.prepare(`SELECT COUNT(*) AS reports, SUM(CASE WHEN status IN ('review','online') THEN 1 ELSE 0 END) AS parsed FROM announcements`).first(),
    ]);
    return Response.json({ mode: 'live', coverage: companies.length, health: health.results, latestRun, counts });
  } catch {
    return Response.json({ mode: 'snapshot', coverage: companies.length, health: [
      { source: 'CNINFO', status: 'configured' }, { source: 'SSE', status: 'configured' }, { source: 'SZSE', status: 'configured' },
    ] });
  }
}
