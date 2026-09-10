import { getDb } from '@/lib/db';
import { requireAppUser } from '@/lib/auth';
import { apiError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const denied = requireAppUser(request); if (denied) return denied;
  try {
    const db = getDb();
    const [counts] = await db`WITH reports AS (
      SELECT a.id, a.code, a.status,
        (SELECT COUNT(*) FROM financial_metrics m WHERE m.announcement_id=a.id AND m.metric IN ('revenue','net_profit','eps','roe')) AS core,
        EXISTS(SELECT 1 FROM report_chunks r WHERE r.announcement_id=a.id) AS indexed
      FROM announcements a JOIN companies c ON c.code=a.code WHERE c.enabled=true
    ) SELECT COUNT(*)::int AS reports, COUNT(*) FILTER(WHERE core>0)::int AS parsed,
      COUNT(*) FILTER(WHERE core=4 AND indexed)::int AS readable_reports,
      COUNT(DISTINCT code) FILTER(WHERE core=4 AND indexed)::int AS readable_companies,
      COUNT(*) FILTER(WHERE status IN ('discovered','downloaded','download_failed','parse_partial'))::int AS pending,
      (SELECT COUNT(*)::int FROM companies WHERE enabled=true) AS target_companies FROM reports`;
    const [health, latestRun] = await Promise.all([
      db`SELECT source, last_success_at, last_failure_at, consecutive_failures, last_count FROM source_health ORDER BY source`,
      db`SELECT id, started_at, finished_at, status, discovered_count, inserted_count, downloaded_count FROM ingest_runs ORDER BY started_at DESC LIMIT 1`,
    ]);
    return Response.json({ mode: 'live', coverage: counts.readable_companies, targetCoverage: counts.target_companies,
      health, latestRun: latestRun[0] ?? null, counts, bootstrapped: false,
      modelConfigured: Boolean(process.env.LLM_BASE_URL && process.env.LLM_MODEL),
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
