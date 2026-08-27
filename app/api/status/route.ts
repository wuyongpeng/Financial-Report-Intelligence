import companies from '@/data/companies.json';
import { getBindings } from '@/lib/runtime';
import { runIngestion } from '@/lib/ingest';
import { waitUntil } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const bindings = getBindings();
    const { DB } = bindings;
    const [health, latestRun, counts] = await Promise.all([
      DB.prepare('SELECT * FROM source_health ORDER BY source').all(),
      DB.prepare('SELECT * FROM ingest_runs ORDER BY started_at DESC LIMIT 1').first<{ started_at: string; status: string }>(),
      DB.prepare(`SELECT COUNT(*) AS reports, SUM(CASE WHEN status IN ('review','online') THEN 1 ELSE 0 END) AS parsed FROM announcements`).first(),
    ]);
    const ageMs = latestRun?.started_at ? Date.now() - Date.parse(latestRun.started_at) : Number.POSITIVE_INFINITY;
    const running = latestRun?.status === 'running' && ageMs < 30 * 60 * 1000;
    const triggered = !running && ageMs >= 10 * 60 * 1000;
    if (triggered) waitUntil(runIngestion(bindings, { days: 2, downloadLimit: 4, parseLimit: 2 }));
    return Response.json({ mode: 'live', coverage: companies.length, health: health.results, latestRun, counts, triggered }, {
      headers: { 'cache-control': 'no-store' },
    });
  } catch {
    return Response.json({ mode: 'snapshot', coverage: companies.length, health: [
      { source: 'CNINFO', status: 'configured' }, { source: 'SSE', status: 'configured' }, { source: 'SZSE', status: 'configured' },
    ] }, { headers: { 'cache-control': 'no-store' } });
  }
}
