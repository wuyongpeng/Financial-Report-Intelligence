import { getDb } from '@/lib/db';
import { apiError } from '@/lib/api';
import { getIngestControl } from '@/lib/ingest-control';
import { periodFromTitle } from '@/lib/ingest-period';
import { getDownloadGate, getGapScanState, listIngestProgress } from '@/lib/ingest-progress';

export const dynamic = 'force-dynamic';

function queueLabel(name: string, title: string, publishedAt: string) {
  const period = periodFromTitle(title, publishedAt);
  return { period, label: `${name} ${period}` };
}

export async function GET() {
  try {
    const db = getDb();
    const [counts] = await db<Array<{
      discovered: number; downloaded: number; download_failed: number; parse_partial: number; downloading: number;
      parsing: number; parse_parked: number;
      review: number; online: number; pending_download: number; pending_parse: number; ingested: number; target_companies: number;
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
        COUNT(*) FILTER (WHERE status='downloading')::int AS downloading,
        COUNT(*) FILTER (WHERE status='parsing')::int AS parsing,
        COUNT(*) FILTER (WHERE status='parse_parked')::int AS parse_parked,
        COUNT(*) FILTER (WHERE status='review')::int AS review,
        COUNT(*) FILTER (WHERE status='online')::int AS online,
        -- 排队下载：待领任务；正在下载单独计入 downloading / downloadSlots
        COUNT(*) FILTER (WHERE status IN ('discovered','download_failed'))::int AS pending_download,
        -- 排队解析：已下载待排 + 可重试 partial；不含正在解析、不含搁置
        COUNT(*) FILTER (WHERE status='downloaded')::int AS pending_parse,
        -- 已入库：解析成功（review 待审 / online 已上线）
        COUNT(*) FILTER (WHERE status IN ('review','online'))::int AS ingested,
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
    const control = await getIngestControl();
    const progress = listIngestProgress();
    const downloadSlots = {
      used: Math.max(counts.downloading, progress.filter((p) => p.phase === 'download').length),
      max: Number(process.env.INGEST_DOWNLOAD_LIMIT ?? 2),
    };
    const parseSlots = {
      used: Math.max(counts.parsing, progress.filter((p) => p.phase === 'parse').length),
      max: Number(process.env.INGEST_PARSE_LIMIT ?? 1),
    };

    const stages = [
      { id: 'discover', label: '发现公告', count: counts.discovered + counts.review + counts.online + counts.downloaded + counts.download_failed + counts.parse_partial + counts.downloading, active: running },
      { id: 'queue', label: '排队', count: counts.pending_download, active: running && counts.pending_download > 0 },
      { id: 'download', label: '下载 PDF', count: downloadSlots.used, capacity: downloadSlots.max, active: downloadSlots.used > 0 },
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

    const downloadQueue = await db<Array<{
      code: string; company_name: string; status: string; title: string; published_at: string; source: string; updated_at: string;
    }>>`
      SELECT code, company_name, status, title, published_at, source, updated_at
      FROM announcements ann
      WHERE status IN ('discovered', 'download_failed')
        AND EXISTS (SELECT 1 FROM companies c WHERE c.code=ann.code AND c.enabled=true)
      ORDER BY CASE WHEN status='discovered' THEN 0 ELSE 1 END, published_at DESC
      LIMIT 80
    `;
    const parseQueue = await db<Array<{
      code: string; company_name: string; status: string; title: string; published_at: string;
      parse_error: string | null; pdf_key: string | null; parsed_at: string | null; source: string; updated_at: string;
    }>>`
      SELECT code, company_name, status, title, published_at, parse_error, pdf_key, parsed_at, source, updated_at
      FROM announcements ann
      WHERE status='downloaded'
        AND EXISTS (SELECT 1 FROM companies c WHERE c.code=ann.code AND c.enabled=true)
      ORDER BY published_at DESC
      LIMIT 40
    `;
    const parseParked = await db<Array<{
      code: string; company_name: string; status: string; title: string; published_at: string;
      parse_error: string | null; pdf_key: string | null; source: string;
    }>>`
      SELECT code, company_name, status, title, published_at, parse_error, pdf_key, source
      FROM announcements ann
      WHERE status = 'parse_parked'
        AND EXISTS (SELECT 1 FROM companies c WHERE c.code=ann.code AND c.enabled=true)
      ORDER BY updated_at DESC
      LIMIT 20
    `;
    const parsingRows = await db<Array<{
      id: string; code: string; company_name: string; status: string; title: string; published_at: string;
      source: string; updated_at: string; parse_error: string | null;
    }>>`
      SELECT id, code, company_name, status, title, published_at, source, updated_at, parse_error
      FROM announcements ann
      WHERE status='parsing'
        AND EXISTS (SELECT 1 FROM companies c WHERE c.code=ann.code AND c.enabled=true)
      ORDER BY updated_at ASC
      LIMIT 12
    `;

    const downloadingRows = await db<Array<{
      id: string; code: string; company_name: string; status: string; title: string; published_at: string;
      source: string; updated_at: string; parse_error: string | null;
    }>>`
      SELECT id, code, company_name, status, title, published_at, source, updated_at, parse_error
      FROM announcements ann
      WHERE status='downloading'
        AND EXISTS (SELECT 1 FROM companies c WHERE c.code=ann.code AND c.enabled=true)
      ORDER BY updated_at ASC
      LIMIT 12
    `;

    const recentDownloads = await db<Array<{
      code: string; company_name: string; title: string; published_at: string; source: string; downloaded_at: string;
    }>>`
      SELECT code, company_name, title, published_at, source, downloaded_at
      FROM announcements ann
      WHERE downloaded_at IS NOT NULL
        AND downloaded_at > NOW() - INTERVAL '3 minutes'
        AND EXISTS (SELECT 1 FROM companies c WHERE c.code=ann.code AND c.enabled=true)
      ORDER BY downloaded_at DESC
      LIMIT 8
    `;

    const downloadGate = getDownloadGate();
    const gateWaitSec = downloadGate.nextAt
      ? Math.max(0, Math.ceil((new Date(downloadGate.nextAt).getTime() - Date.now()) / 1000))
      : 0;
    const pauseMs = downloadGate.pauseMs || Number(process.env.DOWNLOAD_PAUSE_MS ?? 1200);

    const queueItems = [
      ...downloadQueue.map((row, i) => {
        const { period, label } = queueLabel(row.company_name, row.title, row.published_at);
        let reason = '';
        let waitSec: number | undefined;
        if (!control.autoCrawlEnabled || control.downloadPaused) {
          reason = '自动抓取已关：排队任务暂不开始下载';
        } else if (row.status === 'download_failed') {
          const failedAt = new Date(row.updated_at).getTime();
          const cooldownMs = Math.max(pauseMs * 15, 30_000);
          const remain = Number.isFinite(failedAt)
            ? Math.max(0, Math.ceil((failedAt + cooldownMs - Date.now()) / 1000))
            : 0;
          const unit = Math.max(1, Math.ceil(pauseMs / 1000));
          const gated = gateWaitSec > 0 ? gateWaitSec : 0;
          waitSec = Math.max(remain, gated) + i * unit;
          reason = waitSec > 0 ? `上次失败，${waitSec}s 后重试` : '上次失败，即将重试';
        } else if (downloadSlots.used >= downloadSlots.max) {
          reason = i === 0 ? '等待下载槽空闲' : `排队第 ${i + 1} 位`;
        } else {
          const unit = Math.max(1, Math.ceil(pauseMs / 1000));
          const base = gateWaitSec > 0 ? gateWaitSec : (downloadGate.mode === 'inter-round' || downloadGate.mode === 'inter-download' ? unit : 0);
          waitSec = base + i * unit;
          reason = waitSec > 0 ? `约 ${waitSec}s 后可下载` : (i === 0 ? '即将领取' : `排队第 ${i + 1} 位`);
        }
        return {
          code: row.code,
          name: row.company_name,
          label,
          period,
          status: row.status === 'download_failed' ? 'retry' : 'queued',
          stage: 'download' as const,
          position: i + 1,
          title: row.title,
          source: row.source,
          reason,
          waitSec,
        };
      }),
      ...parseQueue.map((row, i) => {
        const { period, label } = queueLabel(row.company_name, row.title, row.published_at);
        let reason = '';
        if (!row.pdf_key) reason = '缺少 PDF';
        else if (row.parse_error) reason = row.parse_error;
        else if (row.status === 'parse_partial') reason = '解析不完整，等待重试';
        else if (!control.autoCrawlEnabled || control.downloadPaused) reason = i === 0 ? '自动抓取已关：已下载 PDF 仍会解析' : `排队第 ${i + 1} 位`;
        else if (i === 0) reason = '即将解析';
        else reason = `排队第 ${i + 1} 位`;
        return {
          code: row.code,
          name: row.company_name,
          label,
          period,
          status: row.parse_error ? 'retry' : 'queued',
          stage: 'parse' as const,
          position: i + 1,
          title: row.title,
          parseError: row.parse_error,
          pdfKey: row.pdf_key,
          reason,
          rawStatus: row.status,
          source: row.source,
        };
      }),
      ...parseParked.map((row, i) => {
        const { period, label } = queueLabel(row.company_name, row.title, row.published_at);
        return {
          code: row.code,
          name: row.company_name,
          label,
          period,
          status: 'parked',
          stage: 'parse' as const,
          position: parseQueue.length + i + 1,
          title: row.title,
          parseError: row.parse_error,
          pdfKey: row.pdf_key,
          reason: row.parse_error ?? '已搁置，不占用待解析',
          rawStatus: row.status,
          source: row.source,
        };
      }),
    ];

    const progressById = new Map(progress.map((p) => [p.id, p]));
    const activeDownload = downloadingRows.map((row, i) => {
      const { period, label } = queueLabel(row.company_name, row.title, row.published_at);
      const mem = progressById.get(row.id);
      const ageMs = Math.max(0, Date.now() - new Date(row.updated_at).getTime());
      return {
        code: row.code,
        name: row.company_name,
        label,
        period,
        status: 'downloading',
        stage: 'download' as const,
        position: i + 1,
        title: row.title,
        source: row.source,
        progress: mem?.detail ?? `下载中 · ${row.source} · 已 ${Math.round(ageMs / 1000)}s / 限 5min`,
        startedAt: mem?.startedAt ?? row.updated_at,
        ageMs,
      };
    });
    const activeParseFromDb = parsingRows.map((row, i) => {
      const { period, label } = queueLabel(row.company_name, row.title, row.published_at);
      const mem = progressById.get(row.id);
      const ageMs = Math.max(0, Date.now() - new Date(row.updated_at).getTime());
      return {
        code: row.code,
        name: row.company_name,
        label,
        period,
        status: 'parsing',
        stage: 'parse' as const,
        position: i + 1,
        title: row.title,
        source: row.source,
        progress: mem?.detail ?? `解析中 · 已 ${Math.round(ageMs / 1000)}s / 限 5min`,
        startedAt: mem?.startedAt ?? row.updated_at,
        ageMs,
      };
    });
    const activeParseIds = new Set(parsingRows.map((r) => r.id));
    const activeParseFromMem = progress
      .filter((p) => p.phase === 'parse' && !activeParseIds.has(p.id))
      .map((p, i) => ({
        code: p.code,
        name: p.name,
        label: `${p.name} ${p.period}`,
        period: p.period,
        status: 'parsing',
        stage: 'parse' as const,
        position: activeParseFromDb.length + i + 1,
        title: p.title,
        source: p.source,
        progress: p.detail,
        startedAt: p.startedAt,
        ageMs: Math.max(0, Date.now() - new Date(p.startedAt).getTime()),
      }));
    const activeItems = [...activeDownload, ...activeParseFromDb, ...activeParseFromMem];
    const pendingParseItems = queueItems.filter((q) => q.stage === 'parse');
    const activeParseItems = [...activeParseFromDb, ...activeParseFromMem];

    const coverageBootstrap = getGapScanState();
    return Response.json({
      mode: 'live',
      running,
      autoCrawlEnabled: control.autoCrawlEnabled,
      downloadPaused: control.downloadPaused,
      coverageBootstrap: {
        mode: coverageBootstrap.mode,
        missingPeriods: coverageBootstrap.missingPeriods,
        missingCompanies: coverageBootstrap.missingCompanies,
        hunted: coverageBootstrap.huntedCodes.length,
        completedAt: coverageBootstrap.completedAt,
      },
      downloadGate,
      workerHint: running ? 'ingest_run' : 'idle',
      lastPollAt: latestRun?.finished_at ?? latestRun?.started_at ?? null,
      counts,
      downloadSlots,
      parseSlots,
      queueItems,
      activeItems,
      recentDownloads: recentDownloads.map((row, i) => {
        const { period, label } = queueLabel(row.company_name, row.title, row.published_at);
        return {
          code: row.code,
          name: row.company_name,
          label,
          period,
          status: 'done',
          stage: 'download' as const,
          position: i + 1,
          title: row.title,
          source: row.source,
          progress: `刚下完 · ${row.downloaded_at}`,
          startedAt: row.downloaded_at,
        };
      }),
      queueTotal: counts.pending_download,
      queueShown: downloadQueue.length,
      pendingParseItems,
      activeParseItems,
      stages,
      health: ['SSE', 'SZSE', 'BSE', 'CNINFO'].map((source) => {
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
        downloadTimeoutMs: 5 * 60 * 1000,
        parseTimeoutMs: 5 * 60 * 1000,
        queueMax: null,
      },
      generatedAt: new Date().toISOString(),
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
