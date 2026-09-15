import companiesJson from '@/data/companies.json';
import seedReportsJson from '@/data/seed-reports.json';
import { getDb } from './db';
import { parseCoreMetrics } from './parser';
import { fetchAllSources, fetchReportsForCode } from './sources';
import { putReport, readReport } from './storage';
import { sendAlert } from './alerts';
import { hasCoreMetrics } from './metric-quality';
import type { Announcement, Company } from './types';
import { asIsoDate, periodFromTitle } from './ingest-period';
import {
  announcementMeetsAutoCutoff,
  autoCollectSearchDays,
  MANUAL_HISTORY_DAYS,
} from './ingest-lookback';
import {
  clearIngestProgress,
  listIngestProgress,
  patchIngestProgress,
  setDownloadGate,
  setIngestProgress,
} from './ingest-progress';

const companies = companiesJson as Company[];
const companyByCode = new Map(companies.map((company) => [company.code, company]));
const seedReports = seedReportsJson as Array<{
  id: string; source: Announcement['source']; source_id: string; code: string; company_name: string;
  title: string; report_type: Announcement['reportType']; published_at: string; discovered_at: string; pdf_url: string;
}>;

type StoredAnnouncement = {
  id: string; source: Announcement['source']; source_id: string; code: string; company_name: string;
  title: string; report_type: Announcement['reportType']; published_at: string; pdf_url: string; pdf_key: string | null; status: string;
};

function normalizeTitle(title: string, companyName: string) {
  return title.replace(companyName, '').replace(/[：:（）()\s·—-]/g, '').replace(/更正后|修订版|更新后/g, '更正');
}

async function sha256(value: string | ArrayBuffer) {
  const input = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const hash = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function logicalId(item: Announcement) {
  return sha256(`${item.code}|${asIsoDate(item.publishedAt).slice(0, 10)}|${normalizeTitle(item.title, item.name)}`);
}


/** Insert discovered row; ignore both id and (source, source_id) duplicates without aborting the batch. */
async function insertDiscoveredAnnouncement(row: {
  id: string;
  source: string;
  sourceId: string;
  code: string;
  companyName: string;
  title: string;
  reportType: string;
  publishedAt: string;
  discoveredAt: string;
  pdfUrl: string;
}) {
  const db = getDb();
  // Pre-check natural key — ON CONFLICT (id) alone still throws on source_id uniqueness.
  const existing = await db<Array<{ id: string }>>`
    SELECT id FROM announcements
    WHERE id=${row.id} OR (source=${row.source} AND source_id=${row.sourceId})
    LIMIT 1
  `;
  if (existing.length) return 0;
  try {
    const result = await db`
      INSERT INTO announcements
        (id, source, source_id, code, company_name, title, report_type, published_at, discovered_at, pdf_url, status, created_at, updated_at)
      VALUES (${row.id}, ${row.source}, ${row.sourceId}, ${row.code}, ${row.companyName}, ${row.title}, ${row.reportType},
        ${row.publishedAt}, ${row.discoveredAt}, ${row.pdfUrl}, 'discovered', ${row.discoveredAt}, ${row.discoveredAt})
      ON CONFLICT (id) DO NOTHING
    `;
    return result.count;
  } catch (error) {
    const msg = String(error);
    if (/announcements_source_source_id_key|duplicate key/i.test(msg)) return 0;
    throw error;
  }
}



async function seedCompanies(now: string) {
  const db = getDb();
  const codes = companies.map((company) => company.code);
  await db.begin(async (tx) => {
    for (const company of companies) {
      await tx`
        INSERT INTO companies (code, name, exchange, industry, rank, weight, enabled, created_at, updated_at)
        VALUES (${company.code}, ${company.name}, ${company.exchange}, ${company.industry}, ${company.rank}, ${company.weight}, true, ${now}, ${now})
        ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, exchange=EXCLUDED.exchange,
          industry=EXCLUDED.industry, rank=EXCLUDED.rank, weight=EXCLUDED.weight, enabled=true, updated_at=EXCLUDED.updated_at
      `;
    }
    // Runtime watchlist is DB-owned; JSON seed only upserts/enables. Never mass-disable.
  });
}

async function seedSnapshotAnnouncements(now: string) {
  const db = getDb();
  let seeded = 0;
  await db.begin(async (tx) => {
    for (const item of seedReports) {
      const result = await tx`
        INSERT INTO announcements
          (id, source, source_id, code, company_name, title, report_type, published_at, discovered_at, pdf_url, status, created_at, updated_at)
        VALUES (${item.id}, ${item.source}, ${item.source_id}, ${item.code}, ${item.company_name}, ${item.title}, ${item.report_type},
          ${item.published_at}, ${item.discovered_at || now}, ${item.pdf_url}, 'discovered', ${now}, ${now})
        ON CONFLICT (id) DO NOTHING
      `;
      seeded += result.count;
    }
  });
  return seeded;
}

export async function bootstrapLiveData() {
  const now = new Date().toISOString();
  await seedCompanies(now);
  const seeded = await seedSnapshotAnnouncements(now);
  return { companies: companies.length, announcements: seedReports.length, seeded, at: now };
}

async function updateSourceHealth(health: Record<string, { ok: boolean; count: number; error?: string }>, now: string) {
  const db = getDb();
  await db.begin(async (tx) => {
    for (const [source, state] of Object.entries(health)) {
      await tx`
        INSERT INTO source_health (source, last_success_at, last_failure_at, consecutive_failures, last_count, last_error, updated_at)
        VALUES (${source}, ${state.ok ? now : null}, ${state.ok ? null : now}, ${state.ok ? 0 : 1}, ${state.count}, ${state.error ?? null}, ${now})
        ON CONFLICT (source) DO UPDATE SET
          last_success_at=CASE WHEN EXCLUDED.last_error IS NULL THEN EXCLUDED.last_success_at ELSE source_health.last_success_at END,
          last_failure_at=CASE WHEN EXCLUDED.last_error IS NOT NULL THEN EXCLUDED.last_failure_at ELSE source_health.last_failure_at END,
          consecutive_failures=CASE WHEN EXCLUDED.last_error IS NULL THEN 0 ELSE source_health.consecutive_failures + 1 END,
          last_count=EXCLUDED.last_count, last_error=EXCLUDED.last_error, updated_at=EXCLUDED.updated_at
      `;
    }
  });
}


async function loadEnabledCompanyMap() {
  const db = getDb();
  const rows = await db<Array<{ code: string; name: string }>>`
    SELECT code, name FROM companies WHERE enabled=true
  `;
  return new Map(rows.map((row) => [row.code, row]));
}

export async function recoverStaleRuns() {
  const db = getDb();
  await db`
    UPDATE ingest_runs SET status='interrupted', finished_at=NOW(), error='Worker restarted before the run completed'
    WHERE status='running' AND started_at < NOW() - INTERVAL '15 minutes'
  `;
  // 抓取中超时：5 分钟仍停在 downloading → 退回排队下载
  await db`
    UPDATE announcements
    SET status='discovered',
        parse_error='下载超时（5分钟），已退回排队下载',
        updated_at=NOW()
    WHERE status='downloading'
      AND updated_at < NOW() - INTERVAL '5 minutes'
  `;
  // 待解析超时：5 分钟仍停在 parsing → 退回排队解析（可再排）
  await db`
    UPDATE announcements
    SET status='downloaded',
        parse_error='解析超时（5分钟），已退回排队解析',
        updated_at=NOW()
    WHERE status='parsing'
      AND updated_at < NOW() - INTERVAL '5 minutes'
  `;
}

function downloadPauseMs() {
  const base = Number(process.env.DOWNLOAD_PAUSE_MS ?? 1200);
  return Number.isFinite(base) ? Math.max(400, base) : 1200;
}

function withDownloadJitter(ms: number) {
  return ms + Math.floor(Math.random() * Math.min(600, Math.max(150, ms * 0.35)));
}

export async function processBacklog(options: {
  downloadLimit?: number; parseLimit?: number; codes?: string[]; fullHistory?: boolean;
  announcementIds?: string[]; periods?: string[];
} = {}) {
  const db = getDb();
  const downloadLimit = options.downloadLimit ?? 1;
  const parseLimit = options.parseLimit ?? 1;
  const codes = options.codes ?? [];
  const announcementIds = options.announcementIds ?? [];
  const periodFilter = new Set((options.periods ?? []).map((p) => p.toUpperCase()));
  const fullHistory = Boolean(options.fullHistory);
  // 手动点「解析」才重试指标不完整；自动流水线只解析一次并标注
  const retryPartial = announcementIds.length > 0 || (codes.length > 0 && fullHistory);
  const pauseBetweenDownloads = downloadPauseMs();
  await recoverStaleRuns();

  // 关键下载与解析候选，避免 LIMIT 被大量「已下载待解析」占满导致永远不下 PDF。
  const codeFilter = codes.length === 0;
  const idFilter = announcementIds.length === 0;
  const downloadCandidates = downloadLimit > 0
    ? await db<StoredAnnouncement[]>`
        SELECT id, source, source_id, code, company_name, title, report_type, published_at, pdf_url, pdf_key, status
        FROM announcements
        WHERE (
            status IN ('discovered', 'download_failed')
            OR (${fullHistory} AND status = 'auto_skipped')
          )
          AND (${codeFilter} OR code=ANY(${codes}::text[]))
          AND (${idFilter} OR id=ANY(${announcementIds}::text[]))
        ORDER BY CASE WHEN status='discovered' THEN 0 WHEN status='download_failed' THEN 1 ELSE 2 END, published_at DESC
        LIMIT 40
      `
    : [];
  const parseCandidates = parseLimit > 0
    ? await db<StoredAnnouncement[]>`
        SELECT id, source, source_id, code, company_name, title, report_type, published_at, pdf_url, pdf_key, status
        FROM announcements
        WHERE (
          status IN ('downloaded')
          OR (${retryPartial} AND status = 'parse_partial' AND pdf_key IS NOT NULL)
          OR (status IN ('review', 'online') AND pdf_key IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM report_chunks WHERE report_chunks.announcement_id=announcements.id))
        )
          AND (${codeFilter} OR code=ANY(${codes}::text[]))
          AND (${idFilter} OR id=ANY(${announcementIds}::text[]))
        ORDER BY CASE WHEN status='downloaded' THEN 0 ELSE 1 END, published_at DESC
        LIMIT 20
      `
    : [];
  // 先下载再解析：下载槽不被解析队列饿死
  const backlog = [...downloadCandidates, ...parseCandidates];

  let downloaded = 0;
  let parsed = 0;
  let failed = 0;
  let skippedCutoff = 0;
  const idSet = new Set(announcementIds);
  for (const record of backlog) {
    if (downloaded >= downloadLimit && parsed >= parseLimit) break;
    try {
      // announcementIds 精确命中时不再用期次过滤（避免标题期次识别偏差导致排队解析空转）
      if (periodFilter.size && !idSet.has(record.id)) {
        const token = periodFromTitle(record.title, record.published_at).toUpperCase();
        if (!periodFilter.has(token)) continue;
      }
      // Never download filings older than 2025Q1 (auto + manual).
      // Already-downloaded PDFs may still be parsed.
      if (!record.pdf_key && !announcementMeetsAutoCutoff(record.title, record.published_at)) {
        skippedCutoff += 1;
        // 离开自动排队：否则会永远显示在「排队下载」却从不下载
        await db`
          UPDATE announcements
          SET status='auto_skipped',
              parse_error='早于采集窗口（最早 2025Q1），跳过下载',
              updated_at=NOW()
          WHERE id=${record.id} AND status IN ('discovered', 'download_failed')
        `;
        continue;
      }
      let bytes: ArrayBuffer | null = null;
      let pdfKey = record.pdf_key;
      if (!pdfKey && downloaded < downloadLimit) {
        const period = periodFromTitle(record.title, record.published_at);
        const referer = record.source === 'CNINFO' ? 'https://www.cninfo.com.cn/'
          : record.source === 'SSE' ? 'https://www.sse.com.cn/'
            : record.source === 'BSE' ? 'https://www.bse.cn/'
              : 'https://www.szse.cn/';
        const startedAt = new Date().toISOString();
        await db`
          UPDATE announcements SET status='downloading', parse_error=NULL, updated_at=${startedAt}
          WHERE id=${record.id}
        `;
        setIngestProgress({
          id: record.id,
          code: record.code,
          name: record.company_name,
          title: record.title,
          period,
          source: record.source,
          phase: 'download',
          detail: `连接 ${record.source}…`,
          startedAt,
        });
        const controller = new AbortController();
        // Hard cap: abort hung body read; recoverStaleRuns also resets downloading > 5min.
        const timer = setTimeout(() => controller.abort(), 5 * 60 * 1000);
        let response: Response;
        try {
          patchIngestProgress(record.id, { detail: `请求 PDF（${record.source}）…` });
          response = await fetch(record.pdf_url, { signal: controller.signal, headers: {
            accept: 'application/pdf,*/*;q=0.8', referer,
            'user-agent': 'FinanceReportIntelligence/1.0 (+https://github.com/wuyongpeng/Financial-Report-Intelligence)',
          } });
          if (!response.ok) throw new Error(`PDF ${response.status}`);
          patchIngestProgress(record.id, { detail: '下载 PDF 字节…' });
          bytes = await response.arrayBuffer();
        } finally {
          clearTimeout(timer);
        }
        if (!bytes) throw new Error('PDF 下载结果为空');
        if (new TextDecoder().decode(bytes.slice(0, 4)) !== '%PDF') throw new Error('Downloaded object is not a PDF');
        patchIngestProgress(record.id, { detail: `写入存储（${Math.round(bytes.byteLength / 1024)} KB）…` });
        const digest = await sha256(bytes);
        pdfKey = `reports/${record.code}/${record.id}.pdf`;
        await putReport(pdfKey, bytes);
        const downloadedAt = new Date().toISOString();
        await db`
          UPDATE announcements SET status='downloaded', downloaded_at=${downloadedAt}, pdf_key=${pdfKey}, pdf_sha256=${digest}, parse_error=NULL, updated_at=${downloadedAt}
          WHERE id=${record.id}
        `;
        // Keep progress visible briefly so live UI can show 「刚下完 → 排队解析」
        patchIngestProgress(record.id, { detail: '下载完成，准备解析…' });
        downloaded += 1;
        if (downloaded < downloadLimit) {
          const wait = withDownloadJitter(pauseBetweenDownloads);
          setDownloadGate({
            nextAt: new Date(Date.now() + wait).toISOString(),
            pauseMs: pauseBetweenDownloads,
            mode: 'inter-download',
          });
          await new Promise((resolve) => setTimeout(resolve, wait));
        }
        // Fall through: same-tick parse when parseLimit allows (bytes already in memory).
      } else if (pdfKey && parsed < parseLimit) {
        const object = await readReport(pdfKey);
        if (object) bytes = object.buffer.slice(object.byteOffset, object.byteOffset + object.byteLength);
      }

      // Just-downloaded rows must still parse in this pass even if parseCandidates was empty at query time.
      if (!bytes && pdfKey && parsed < parseLimit) {
        const object = await readReport(pdfKey);
        if (object) bytes = object.buffer.slice(object.byteOffset, object.byteOffset + object.byteLength);
      }

      if (bytes && bytes.byteLength > 50 * 1024 * 1024) {
        clearIngestProgress(record.id);
        // 永久搁置：出现在「排队解析」但不占待解析、也不自动再排
        await db`UPDATE announcements SET status='parse_parked', parse_error='PDF 超过 50MB，已搁置（不占用待解析）', updated_at=NOW() WHERE id=${record.id}`;
        continue;
      }
      if (bytes && parsed < parseLimit) {
        const period = periodFromTitle(record.title, record.published_at);
        const parseStarted = new Date().toISOString();
        await db`
          UPDATE announcements SET status='parsing', parse_error=NULL, updated_at=${parseStarted}
          WHERE id=${record.id}
        `;
        setIngestProgress({
          id: record.id,
          code: record.code,
          name: record.company_name,
          title: record.title,
          period,
          source: record.source,
          phase: 'parse',
          detail: '解析正文与指标…',
          startedAt: parseStarted,
        });
        const parseController = new AbortController();
        const parseTimer = setTimeout(() => parseController.abort(), 5 * 60 * 1000);
        let extracted: Awaited<ReturnType<typeof parseCoreMetrics>>;
        try {
          // parseCoreMetrics 本身不接 abort；用竞态实现硬超时，recoverStaleRuns 兜底
          extracted = await Promise.race([
            parseCoreMetrics(bytes),
            new Promise<never>((_, reject) => {
              parseController.signal.addEventListener('abort', () => {
                reject(new Error('解析超时（5分钟）'));
              }, { once: true });
            }),
          ]);
        } finally {
          clearTimeout(parseTimer);
        }
        const createdAt = new Date().toISOString();
        await db.begin(async (tx) => {
          for (const metric of extracted.metrics) {
            await tx`
              INSERT INTO financial_metrics (announcement_id, code, period, metric, value, unit, source_page, source_label, confidence, verified, created_at)
              VALUES (${record.id}, ${record.code}, ${period}, ${metric.metric}, ${metric.value}, ${metric.unit}, ${metric.page}, ${metric.sourceLabel}, ${metric.confidence}, false, ${createdAt})
              ON CONFLICT (announcement_id, metric) DO UPDATE SET value=EXCLUDED.value, unit=EXCLUDED.unit,
                source_page=EXCLUDED.source_page, source_label=EXCLUDED.source_label, confidence=EXCLUDED.confidence,
                verified=CASE WHEN financial_metrics.value=EXCLUDED.value AND financial_metrics.unit=EXCLUDED.unit
                  AND financial_metrics.source_page IS NOT DISTINCT FROM EXCLUDED.source_page
                  AND financial_metrics.source_label IS NOT DISTINCT FROM EXCLUDED.source_label
                  THEN financial_metrics.verified ELSE false END
            `;
          }
          await tx`DELETE FROM report_chunks WHERE announcement_id=${record.id}`;
          for (const chunk of extracted.chunks) {
            await tx`
              INSERT INTO report_chunks (announcement_id, page, content, created_at)
              VALUES (${record.id}, ${chunk.page}, ${chunk.content}, ${createdAt})
              ON CONFLICT (announcement_id, page) DO UPDATE SET content=EXCLUDED.content, created_at=EXCLUDED.created_at
            `;
          }
          const coreOk = hasCoreMetrics(extracted.metrics);
          await tx`
            UPDATE announcements SET status=${coreOk ? 'review' : 'parse_partial'}, online_at=NULL,
              parsed_at=${createdAt},
              parse_error=${coreOk ? null : '指标不完整（已解析，仅标注，不自动重试）'},
              updated_at=${createdAt}
            WHERE id=${record.id}
          `;
        });
        clearIngestProgress(record.id);
        parsed += 1;
      }
    } catch (error) {
      failed += 1;
      clearIngestProgress(record.id);
      const message = String(error);
      const nowIso = new Date().toISOString();
      const timedOut = /aborted|AbortError|超时/i.test(message);
      // Re-read pdf_key: same-tick download may have written it after record was loaded.
      const [fresh] = await db<Array<{ pdf_key: string | null; status: string }>>`
        SELECT pdf_key, status FROM announcements WHERE id=${record.id}
      `;
      const hasPdf = Boolean(fresh?.pdf_key || record.pdf_key);
      const wasParsing = fresh?.status === 'parsing' || record.status === 'parsing' || /解析超时/.test(message);
      if (timedOut && !hasPdf) {
        await db`UPDATE announcements SET status='discovered', parse_error='下载超时（5分钟），已退回排队下载', updated_at=${nowIso} WHERE id=${record.id}`;
      } else if (timedOut && hasPdf) {
        await db`UPDATE announcements SET status='downloaded', parse_error='解析超时（5分钟），已退回排队解析', updated_at=${nowIso} WHERE id=${record.id}`;
      } else if (hasPdf || wasParsing) {
        await db`UPDATE announcements SET status='downloaded', parse_error=${message}, updated_at=${nowIso} WHERE id=${record.id}`;
      } else {
        await db`UPDATE announcements SET status='download_failed', parse_error=${message}, updated_at=${nowIso} WHERE id=${record.id}`;
      }
    }
  }
  const pendingLeft = Math.max(0, downloadCandidates.length - downloaded);
  if (pendingLeft > 0 && downloaded >= downloadLimit) {
    const roundMs = Number(process.env.INGEST_BACKLOG_INTERVAL_MS ?? 45_000);
    const softMs = 20_000;
    const wait = Math.max(pauseBetweenDownloads, Math.min(roundMs, softMs));
    setDownloadGate({
      nextAt: new Date(Date.now() + wait).toISOString(),
      pauseMs: wait,
      mode: 'inter-round',
    });
  } else if (downloaded > 0 || parsed > 0) {
    setDownloadGate({ nextAt: null, pauseMs: pauseBetweenDownloads, mode: 'idle' });
  }
  return { backlog: backlog.length, downloaded, parsed, failed, skippedCutoff, downloadCandidates: downloadCandidates.length, parseCandidates: parseCandidates.length };
}

export async function runIngestion(options: {
  days?: number; downloadLimit?: number; parseLimit?: number; fullHistory?: boolean;
} = {}) {
  const db = getDb();
  await recoverStaleRuns();
  const startedAt = new Date().toISOString();
  const runId = crypto.randomUUID();
  const days = options.days ?? 2;
  // Gentle defaults: never blast the monitored pool in one tick.
  const downloadLimit = options.downloadLimit ?? Number(process.env.INGEST_DOWNLOAD_LIMIT ?? 2);
  const parseLimit = options.parseLimit ?? Number(process.env.INGEST_PARSE_LIMIT ?? 1);
  await db`INSERT INTO ingest_runs (id, started_at, status) VALUES (${runId}, ${startedAt}, 'running')`;

  try {
    const bootstrap = await bootstrapLiveData();
    const enabledCompanies = await loadEnabledCompanyMap();
    const fetched = await fetchAllSources(days);
    await updateSourceHealth(fetched.health, startedAt);
    const failedSources = Object.entries(fetched.health).filter(([, state]) => !state.ok);
    if (failedSources.length) await sendAlert('财报公告源采集异常', { sources: failedSources.map(([source, state]) => ({ source, error: state.error })) });
    // Collect from 2025Q1 onward only (auto + manual).
    const relevant = fetched.announcements.filter((item) => {
      if (!enabledCompanies.has(item.code)) return false;
      return announcementMeetsAutoCutoff(item.title, item.publishedAt);
    });
    const cutoff = new Date(Date.now() - (days + 1) * 86400000).toISOString();
    const existing = await db<Array<{ id: string; source: string; source_id: string }>>`
      SELECT id, source, source_id FROM announcements WHERE published_at >= ${cutoff}
    `;
    const existingIds = new Set(existing.map((item) => item.id));
    const existingSourceIds = new Set(existing.map((item) => `${item.source}:${item.source_id}`));
    relevant.sort((a, b) => {
      const rank = (s: string) => (s === 'SSE' || s === 'SZSE' || s === 'BSE' ? 0 : 1);
      return rank(a.source) - rank(b.source);
    });
    const logical = new Map<string, Announcement>();
    let skipped = 0;
    for (const item of relevant) {
      const id = await logicalId(item);
      if (existingIds.has(id) || existingSourceIds.has(`${item.source}:${item.sourceId}`)) { skipped += 1; continue; }
      if (!logical.has(id)) logical.set(id, item);
    }
    let inserted = 0;
    for (const [id, item] of logical) {
      inserted += await insertDiscoveredAnnouncement({
        id,
        source: item.source,
        sourceId: item.sourceId,
        code: item.code,
        companyName: enabledCompanies.get(item.code)?.name ?? companyByCode.get(item.code)?.name ?? item.name,
        title: item.title,
        reportType: item.reportType,
        publishedAt: item.publishedAt,
        discoveredAt: startedAt,
        pdfUrl: item.pdfUrl,
      });
    }
    const processed = await processBacklog({ downloadLimit, parseLimit });
    const finishedAt = new Date().toISOString();
    await db`
      UPDATE ingest_runs SET finished_at=${finishedAt}, status='success', discovered_count=${relevant.length}, inserted_count=${inserted},
        downloaded_count=${processed.downloaded}, source_health=${JSON.stringify(fetched.health)}::jsonb WHERE id=${runId}
    `;
    return { runId, startedAt, finishedAt, seeded: bootstrap.seeded, fetched: fetched.announcements.length, relevant: relevant.length, skipped, inserted, ...processed };
  } catch (error) {
    await db`UPDATE ingest_runs SET finished_at=${new Date().toISOString()}, status='failed', error=${String(error)} WHERE id=${runId}`;
    throw error;
  }
}



/** Auto: discover (+ light download) for enabled companies still missing in-window filings. */
export async function fillCoverageGaps(options: { companyLimit?: number; downloadLimit?: number } = {}) {
  const companyLimit = Math.max(1, Math.min(options.companyLimit ?? 3, 8));
  const downloadLimit = Math.max(0, Math.min(options.downloadLimit ?? 2, 3));
  const db = getDb();
  const enabled = await db<Array<{ code: string; name: string; rank: number }>>`
    SELECT code, name, rank FROM companies WHERE enabled=true ORDER BY rank ASC, code ASC
  `;
  if (!enabled.length) return { checked: 0, filled: 0, codes: [] as string[] };

  const codes = enabled.map((r) => r.code);
  const anns = await db<Array<{ code: string; title: string; published_at: string; status: string; pdf_key: string | null }>>`
    SELECT code, title, published_at, status, pdf_key FROM announcements
    WHERE code = ANY(${codes}::text[])
  `;
  const byCode = new Map<string, Array<{ title: string; published_at: string; status: string; pdf_key: string | null }>>();
  for (const row of anns) {
    const list = byCode.get(row.code) ?? [];
    list.push(row);
    byCode.set(row.code, list);
  }

  const gaps: string[] = [];
  for (const company of enabled) {
    const rows = byCode.get(company.code) ?? [];
    // 窗口内至少有一份有效公告（含已发现待下）即不算缺口；纯无公告 / 仅搁置才补发现
    const hasInWindow = rows.some((r) =>
      r.status !== 'parse_parked'
      && announcementMeetsAutoCutoff(r.title, r.published_at),
    );
    if (!hasInWindow) gaps.push(company.code);
    if (gaps.length >= companyLimit) break;
  }
  if (!gaps.length) return { checked: enabled.length, filled: 0, codes: [] as string[] };

  // Discover and start downloading so 排队下载立刻有货，而不是空等下一轮 backlog
  const result = await prioritizeCompanyCrawl(gaps, {
    downloadLimit,
    parseLimit: 0,
    days: autoCollectSearchDays(),
    fullHistory: false,
  });
  return {
    checked: enabled.length,
    filled: gaps.length,
    codes: gaps,
    discovered: 'discovered' in result ? result.discovered : 0,
    inserted: 'inserted' in result ? result.inserted : 0,
    downloaded: 'downloaded' in result ? result.downloaded : 0,
  };
}

/** Manual "立即抓取": discover for codes if needed, then process backlog inside an ingest_run. */
export async function prioritizeCompanyCrawl(codes: string[], options: {
  downloadLimit?: number; parseLimit?: number; days?: number; fullHistory?: boolean;
  periods?: string[]; announcementIds?: string[];
} = {}) {
  const unique = [...new Set(codes.filter((c) => /^\d{6}$/.test(c)))].slice(0, 10);
  if (!unique.length) return { ok: false as const, error: '缺少有效股票代码' };

  const db = getDb();
  await recoverStaleRuns();
  const startedAt = new Date().toISOString();
  const runId = crypto.randomUUID();
  const fullHistory = Boolean(options.fullHistory);
  const days = options.days ?? (fullHistory ? MANUAL_HISTORY_DAYS : autoCollectSearchDays());
  const downloadLimit = options.downloadLimit ?? 1;
  const parseLimit = options.parseLimit ?? 1;
  await db`INSERT INTO ingest_runs (id, started_at, status) VALUES (${runId}, ${startedAt}, 'running')`;

  try {
    const enabled = await loadEnabledCompanyMap();
    const names = await db<Array<{ code: string; name: string }>>`
      SELECT code, name FROM companies WHERE code = ANY(${unique}::text[])
    `;
    const nameByCode = new Map(names.map((r) => [r.code, r.name]));

    let inserted = 0;
    let discovered = 0;
    for (const code of unique) {
      const name = nameByCode.get(code) ?? enabled.get(code)?.name ?? code;
      if (!enabled.has(code) && !nameByCode.has(code)) {
        // ensure enabled so live queue joins companies
        await db`
          INSERT INTO companies (code, name, exchange, industry, rank, weight, enabled, created_at, updated_at)
          VALUES (${code}, ${name}, ${code.startsWith('6') || code.startsWith('9') ? 'SSE' : 'SZSE'}, '待分类', 999, 60, true, ${startedAt}, ${startedAt})
          ON CONFLICT (code) DO UPDATE SET enabled=true, updated_at=${startedAt}
        `;
      } else {
        await db`UPDATE companies SET enabled=true, updated_at=${startedAt} WHERE code=${code}`;
      }

      const foundRaw = await fetchReportsForCode(code, name, days);
      const periodWanted = new Set((options.periods ?? []).map((p) => p.toUpperCase()));
      // Skip periods before 2025Q1; if user picked specific periods, only enqueue those.
      const found = foundRaw.filter((item) => {
        if (!announcementMeetsAutoCutoff(item.title, item.publishedAt)) return false;
        if (!periodWanted.size) return true;
        const token = periodFromTitle(item.title, item.publishedAt).toUpperCase();
        return periodWanted.has(token);
      });
      discovered += found.length;
      for (const item of found) {
        const id = await logicalId(item);
        inserted += await insertDiscoveredAnnouncement({
          id,
          source: item.source,
          sourceId: item.sourceId,
          code: item.code,
          companyName: name,
          title: item.title,
          reportType: item.reportType,
          publishedAt: item.publishedAt,
          discoveredAt: startedAt,
          pdfUrl: item.pdfUrl,
        });
      }
    }

    let processed = await processBacklog({
      downloadLimit,
      parseLimit,
      codes: unique,
      // Period-scoped crawl must not revive other auto_skipped filings for this code.
      fullHistory: fullHistory && !(options.periods?.length),
      periods: options.periods,
      announcementIds: options.announcementIds,
    });
    // 手动抓取：下载完成后若本轮未解析到，再单独消化「排队解析」，保证用户能看到解析过程
    if (processed.downloaded > 0 && processed.parsed === 0 && parseLimit > 0) {
      const parsePass = await processBacklog({
        downloadLimit: 0,
        parseLimit: Math.max(parseLimit, processed.downloaded),
        codes: unique,
        fullHistory: true,
        periods: options.periods,
        announcementIds: options.announcementIds,
      });
      processed = {
        ...processed,
        parsed: processed.parsed + parsePass.parsed,
        failed: processed.failed + parsePass.failed,
        parseCandidates: processed.parseCandidates + parsePass.parseCandidates,
      };
    }
    const finishedAt = new Date().toISOString();
    await db`
      UPDATE ingest_runs SET finished_at=${finishedAt}, status='success',
        discovered_count=${discovered}, inserted_count=${inserted}, downloaded_count=${processed.downloaded}
      WHERE id=${runId}
    `;
    const periodNote = options.periods?.length ? `（期次 ${options.periods.join('、')}）` : '';
    return {
      ok: true as const,
      runId,
      codes: unique,
      discovered,
      inserted,
      ...processed,
      note: `已为 ${unique.join('、')}${periodNote} 发现 ${discovered} 条、新入库 ${inserted}、下载 ${processed.downloaded}、解析 ${processed.parsed}`,
    };
  } catch (error) {
    await db`UPDATE ingest_runs SET finished_at=${new Date().toISOString()}, status='failed', error=${String(error)} WHERE id=${runId}`;
    throw error;
  }
}
