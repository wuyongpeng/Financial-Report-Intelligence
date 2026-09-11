import { getDb } from '@/lib/db';
import { apiError } from '@/lib/api';
import { getIngestControl } from '@/lib/ingest-control';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const [counts] = await db<Array<{
      discovered: number; downloaded: number; download_failed: number; parse_partial: number;
      review: number; online: number; pending_download: number; pending_parse: number; target_companies: number;
    }>>`
      WITH a AS (
        SELECT status FROM announcements ann
        JOIN companies c ON c.code=ann.code AND c.enabled=true
      )
      SELECT
        COUNT(*) FILTER (WHERE status='discovered')::int AS discovered,
        COUNT(*) FILTER (WHERE status='downloaded')::int AS downloaded,
        COUNT(*) FILTER (WHERE status='download_failed')::int AS download_failed,
        COUNT(*) FILTER (WHERE status='parse_partial')::int AS parse_partial,
        COUNT(*) FILTER (WHERE status='review')::int AS review,
        COUNT(*) FILTER (WHERE status='online')::int AS online,
        COUNT(*) FILTER (WHERE status IN ('discovered','download_failed'))::int AS pending_download,
        COUNT(*) FILTER (WHERE status IN ('downloaded','parse_partial'))::int AS pending_parse,
        (SELECT COUNT(*)::int FROM companies WHERE enabled=true) AS target_companies
      FROM a
    `;

    const health = await db<Array<{
      source: string; last_success_at: string | null; last_failure_at: string | null;
      consecutive_failures: number; last_count: number; last_error: string | null; updated_at: string | null;
    }>>`
      SELECT source, last_success_at, last_failure_at, consecutive_failures, last_count, last_error, updated_at
      FROM source_health ORDER BY source
    `;

    const recentRuns = await db<Array<{
      id: string; started_at: string; finished_at: string | null; status: string;
      discovered_count: number; inserted_count: number; downloaded_count: number; error: string | null;
    }>>`
      SELECT id, started_at, finished_at, status, discovered_count, inserted_count, downloaded_count, error
      FROM ingest_runs ORDER BY started_at DESC LIMIT 5
    `;

    const latestRun = recentRuns[0] ?? null;
    const running = latestRun?.status === 'running';
    const downloadSlots = {
      used: running ? 1 : 0,
      max: Number(process.env.INGEST_DOWNLOAD_LIMIT ?? 2),
    };
    const parseSlots = {
      used: running ? Math.min(1, Number(process.env.INGEST_PARSE_LIMIT ?? 1)) : 0,
      max: Number(process.env.INGEST_PARSE_LIMIT ?? 1),
    };

    const stages = [
      { id: 'discover', label: '发现公告', count: counts.discovered + counts.review + counts.online + counts.downloaded + counts.download_failed + counts.parse_partial, active: running },
      { id: 'queue', label: '排队', count: counts.pending_download, active: running && counts.pending_download > 0 },
      { id: 'download', label: '下载 PDF', count: downloadSlots.used, capacity: downloadSlots.max, active: running && downloadSlots.used > 0 },
      { id: 'parse', label: '解析入库', count: counts.pending_parse + counts.review + counts.online, active: running && counts.pending_parse > 0 },
    ];

    const ticks = recentRuns.slice(0, 5).map((run) => ({
      id: run.id,
      at: run.finished_at ?? run.started_at,
      status: run.status,
      text: run.status === 'running'
        ? '温和抓取进行中…'
        : run.status === 'success'
          ? `发现 ${run.discovered_count} · 入库 ${run.inserted_count} · 下载 ${run.downloaded_count}`
          : run.error ?? run.status,
    }));

    const control = await getIngestControl();

    return Response.json({
      mode: 'live',
      running,
      autoCrawlEnabled: control.autoCrawlEnabled,
      workerHint: running ? 'ingest_run' : 'idle',
      lastPollAt: latestRun?.finished_at ?? latestRun?.started_at ?? null,
      counts,
      downloadSlots,
      parseSlots,
      stages,
      health: ['SSE', 'SZSE', 'CNINFO'].map((source) => {
        const row = health.find((h) => h.source === source);
        return {
          source,
          ok: row ? !row.last_error && row.consecutive_failures === 0 : null,
          lastSuccessAt: row?.last_success_at ?? null,
          lastFailureAt: row?.last_failure_at ?? null,
          consecutiveFailures: row?.consecutive_failures ?? 0,
          lastCount: row?.last_count ?? 0,
          lastError: row?.last_error ?? null,
        };
      }),
      ticks,
      limits: {
        intervalMs: Number(process.env.INGEST_INTERVAL_MS ?? 600_000),
        downloadLimit: Number(process.env.INGEST_DOWNLOAD_LIMIT ?? 2),
        parseLimit: Number(process.env.INGEST_PARSE_LIMIT ?? 1),
        pagePauseMs: Number(process.env.PAGE_PAUSE_MS ?? 1000),
        downloadPauseMs: Number(process.env.DOWNLOAD_PAUSE_MS ?? 1200),
        maxPages: Number(process.env.INGEST_MAX_PAGES ?? 8),
      },
      generatedAt: new Date().toISOString(),
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
