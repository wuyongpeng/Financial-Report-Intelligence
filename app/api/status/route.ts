import companies from '@/data/companies.json';
import { getBindings } from '@/lib/runtime';
import { bootstrapLiveData, runIngestion } from '@/lib/ingest';
import { waitUntil } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const bindings = getBindings();
    const { DB } = bindings;
    let [health, latestRun, counts] = await Promise.all([
      DB.prepare('SELECT * FROM source_health ORDER BY source').all(),
      DB.prepare('SELECT * FROM ingest_runs ORDER BY started_at DESC LIMIT 1').first<{ started_at: string; finished_at: string | null; status: string }>(),
      DB.prepare(`SELECT COUNT(*) AS reports, (SELECT COUNT(DISTINCT announcement_id) FROM financial_metrics) AS parsed FROM announcements`).first(),
    ]);
    let bootstrapped = false;
    if (!Number(counts?.reports ?? 0)) {
      await bootstrapLiveData(bindings);
      bootstrapped = true;
      [health, latestRun, counts] = await Promise.all([
        DB.prepare('SELECT * FROM source_health ORDER BY source').all(),
        DB.prepare('SELECT * FROM ingest_runs ORDER BY started_at DESC LIMIT 1').first<{ started_at: string; finished_at: string | null; status: string }>(),
        DB.prepare(`SELECT COUNT(*) AS reports, (SELECT COUNT(DISTINCT announcement_id) FROM financial_metrics) AS parsed FROM announcements`).first(),
      ]);
    }
    const ageMs = latestRun?.started_at ? Date.now() - Date.parse(latestRun.started_at) : Number.POSITIVE_INFINITY;
    const running = latestRun?.status === 'running' && ageMs < 30 * 60 * 1000;
    const triggered = !running && ageMs >= 10 * 60 * 1000;
    if (triggered) waitUntil(runIngestion(bindings, { days: 2, downloadLimit: 4, parseLimit: 2 }));
    return Response.json({ mode: 'live', coverage: companies.length, health: health.results, latestRun, counts, bootstrapped, triggered }, {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    return Response.json({ mode: 'unavailable', coverage: companies.length, health: [], error: String(error) }, {
      status: 503, headers: { 'cache-control': 'no-store' },
    });
  }
}
