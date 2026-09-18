import companiesJson from '@/data/companies.json';
import seedReportsJson from '@/data/seed-reports.json';
import { getDb } from './db';
import { ensureBackendSchema } from './backend-schema';
import { parseCoreMetrics, shouldExtractTextExternally } from './parser';
import { fetchAllSources, fetchCninfoReportsForCode, fetchReportsForCode } from './sources';
import { putReport, readReport, reportByteLength, reportPath } from './storage';
import { sendAlert } from './alerts';
import { hasCoreMetrics } from './metric-quality';
import type { Announcement, Company } from './types';
import { asIsoDate, buildCoveredPeriodKeys, isFullFinancialReport, pendingDownloadSkipMessage, pendingDownloadSkipReason, periodCoverageKey, periodFromTitle } from './ingest-period';
import { DUPLICATE_PERIOD_KEEP_MESSAGE, duplicateIdsToSkip } from './period-dedupe';
import {
  announcementMeetsAutoCutoff,
  autoCollectSearchDays,
  expectedPeriodsThroughLatest,
  latestExpectedPeriod,
  MANUAL_HISTORY_DAYS,
  missingExpectedPeriods,
  nextCoverageBootstrapState,
  pickGapCompanyCodes,
} from './ingest-lookback';
import {
  clearIngestProgress,
  getGapScanState,
  listIngestProgress,
  patchIngestProgress,
  setDownloadGate,
  setGapScanState,
  setIngestProgress,
} from './ingest-progress';
import { getIngestSettings } from './ingest-settings';
import { PARSE_PRIORITY_MANUAL } from './parse-queue';

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
        VALUES (
          ${company.code},
          ${company.name ?? company.code},
          ${company.exchange ?? (company.code.startsWith('6') || company.code.startsWith('9') ? 'SSE' : 'SZSE')},
          ${company.industry ?? '待分类'},
          ${company.rank ?? 999},
          ${company.weight ?? 60},
          true, ${now}, ${now}
        )
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
  await ensureBackendSchema();
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
  // 待解析超时：5 分钟仍停在 parsing → 退回排队解析队尾
  await db`
    UPDATE announcements
    SET status='downloaded',
        parse_priority=0,
        parse_error='解析超时（5分钟），已排到队尾',
        updated_at=NOW()
    WHERE status='parsing'
      AND updated_at < NOW() - INTERVAL '5 minutes'
  `;
  // 体积搁置改为抽前 120 页重试，不再永久占「排队解析」
  await db`
    UPDATE announcements
    SET status='downloaded',
        parse_error='体积较大，改为抽取前 120 页后重试',
        updated_at=NOW()
    WHERE (
        (status='parse_parked' AND parse_error LIKE 'PDF 超过 50MB%')
        OR (status='parse_partial' AND parsed_at IS NULL AND parse_error ILIKE '%50%MB%')
      )
  `;
}

function downloadPauseMs() {
  const sec = getIngestSettings().downloadPauseSec;
  return Math.max(1000, sec * 1000);
}

function withDownloadJitter(ms: number) {
  return ms + Math.floor(Math.random() * Math.min(600, Math.max(150, ms * 0.35)));
}

function refererForSource(source: string) {
  if (source === 'CNINFO') return 'https://www.cninfo.com.cn/';
  if (source === 'SSE') return 'https://www.sse.com.cn/';
  if (source === 'BSE') return 'https://www.bse.cn/';
  return 'https://www.szse.cn/';
}

async function fetchPdfBytes(url: string, referer: string, signal: AbortSignal) {
  const response = await fetch(url, {
    signal,
    headers: {
      accept: 'application/pdf,*/*;q=0.8',
      referer,
      'user-agent': 'FinanceReportIntelligence/1.0 (+https://github.com/wuyongpeng/Financial-Report-Intelligence)',
    },
  });
  if (!response.ok) throw new Error(`PDF ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (isPdfBytes(bytes)) return bytes;
  if (looksLikeBlockedPdf(bytes)) throw new Error('交易所拦截了 PDF 下载（返回的不是文件）');
  throw new Error('Downloaded object is not a PDF');
}

async function retireRedundantPendingDownloads(keepIds: string[] = []) {
  const db = getDb();
  const keep = new Set(keepIds);
  const pending = await db<Array<{ id: string; code: string; title: string; published_at: string }>>`
    SELECT id, code, title, published_at
    FROM announcements ann
    WHERE status IN ('discovered', 'download_failed')
      AND EXISTS (SELECT 1 FROM companies c WHERE c.code=ann.code AND c.enabled=true)
  `;
  if (!pending.length) return { skipped: 0 };
  const codes = [...new Set(pending.map((row) => row.code))];
  const ingested = await db<Array<{ code: string; title: string; published_at: string }>>`
    SELECT code, title, published_at
    FROM announcements
    WHERE code = ANY(${codes}::text[])
      AND status IN ('downloaded', 'downloading', 'parsing', 'review', 'online', 'parse_partial', 'parse_parked')
      AND pdf_key IS NOT NULL
  `;
  const coveredKeys = buildCoveredPeriodKeys(ingested);
  const byReason = { 'not-report': [] as string[], 'duplicate-period': [] as string[] };
  for (const row of pending) {
    const reason = pendingDownloadSkipReason(row, coveredKeys, keep);
    if (reason) byReason[reason].push(row.id);
  }
  let skipped = 0;
  for (const reason of ['not-report', 'duplicate-period'] as const) {
    const ids = byReason[reason];
    if (!ids.length) continue;
    const message = pendingDownloadSkipMessage(reason);
    const result = await db`
      UPDATE announcements
      SET status='auto_skipped', parse_error=${message}, updated_at=NOW()
      WHERE id=ANY(${ids}::text[])
        AND status IN ('discovered', 'download_failed')
    `;
    skipped += result.count;
  }
  return { skipped };
}

export async function enqueueParseFront(ids: string[]) {
  await ensureBackendSchema();
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (!unique.length) return 0;
  const db = getDb();
  const result = await db`
    UPDATE announcements
    SET parse_priority=${PARSE_PRIORITY_MANUAL},
        parse_error=NULL,
        status=CASE
          WHEN pdf_key IS NOT NULL AND status NOT IN ('downloading', 'parsing') THEN 'downloaded'
          ELSE status
        END,
        updated_at=NOW()
    WHERE id=ANY(${unique}::text[])
      AND pdf_key IS NOT NULL
      AND status NOT IN ('downloading', 'parsing')
  `;
  return result.count;
}

export async function countManualParsePriority() {
  await ensureBackendSchema();
  const [row] = await getDb()<Array<{ n: number }>>`
    SELECT COUNT(*)::int AS n
    FROM announcements
    WHERE parse_priority > 0
      AND pdf_key IS NOT NULL
      AND status IN ('downloaded', 'parse_partial')
  `;
  return row?.n ?? 0;
}

async function parseStoredAnnouncement(
  record: StoredAnnouncement,
  bytes: ArrayBuffer | Uint8Array | null,
  filePath: string | undefined,
  onDiskBytes: number | null,
): Promise<'parsed' | 'parked' | 'skipped' | 'failed'> {
  const db = getDb();
  const period = periodFromTitle(record.title, record.published_at);
  const parseStarted = new Date().toISOString();
  const claimed = await db<Array<{ id: string }>>`
    UPDATE announcements
    SET status='parsing', parse_error=NULL, parse_priority=0, updated_at=${parseStarted}
    WHERE id=${record.id} AND status <> 'parsing'
    RETURNING id
  `;
  if (!claimed.length) return 'skipped';
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
  try {
    let payload = bytes;
    if (!payload && filePath && !(onDiskBytes != null && shouldExtractTextExternally(onDiskBytes))) {
      const object = record.pdf_key ? await readReport(record.pdf_key) : null;
      if (object) payload = object.buffer.slice(object.byteOffset, object.byteOffset + object.byteLength);
    }
    if (payload && filePath && shouldExtractTextExternally(payload.byteLength)) payload = null;
    if (!payload && !(filePath && onDiskBytes)) throw new Error('缺少可解析的 PDF');
    const extracted = await Promise.race([
      parseCoreMetrics(payload, { filePath }),
      new Promise<never>((_, reject) => {
        parseController.signal.addEventListener('abort', () => {
          reject(new Error('解析超时（5分钟）'));
        }, { once: true });
      }),
    ]);
    if (!extracted.metrics.length && !extracted.chunks.length) {
      clearIngestProgress(record.id);
      await db`
        UPDATE announcements
        SET status='parse_parked',
            parse_priority=0,
            parse_error='未能抽取正文（扫描件或无法读出文字），已搁置',
            updated_at=NOW()
        WHERE id=${record.id}
      `;
      return 'parked';
    }
    const createdAt = new Date().toISOString();
    const coreOk = hasCoreMetrics(extracted.metrics);
    await ensureBackendSchema();
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
      await tx`
        UPDATE announcements SET status=${coreOk ? 'review' : 'parse_partial'}, online_at=NULL,
          parsed_at=${createdAt}, parse_priority=0,
          parse_error=${coreOk ? null : '指标不完整（已解析，仅标注，不自动重试）'},
          updated_at=${createdAt}
        WHERE id=${record.id}
      `;
    });
    clearIngestProgress(record.id);
    return 'parsed';
  } catch (error) {
    clearIngestProgress(record.id);
    const message = String(error).replace(/^Error:\s*/i, '');
    const timedOut = /aborted|AbortError|超时/i.test(message);
    const parseError = timedOut ? '解析超时（5分钟），已排到队尾' : message;
    await db`
      UPDATE announcements
      SET status='downloaded', parse_priority=0, parse_error=${parseError}, updated_at=${new Date().toISOString()}
      WHERE id=${record.id}
    `;
    return 'failed';
  } finally {
    clearTimeout(parseTimer);
  }
}

export async function parseAnnouncementById(id: string): Promise<{ ok: boolean; outcome: string; error?: string }> {
  await ensureBackendSchema();
  await recoverStaleRuns();
  const db = getDb();
  const [record] = await db<StoredAnnouncement[]>`
    SELECT id, source, source_id, code, company_name, title, report_type, published_at, pdf_url, pdf_key, status
    FROM announcements WHERE id=${id}
  `;
  if (!record) return { ok: false, outcome: 'missing', error: '报告不存在' };
  if (record.status === 'parsing') return { ok: true, outcome: 'inflight' };
  if (!record.pdf_key) return { ok: false, outcome: 'no-pdf', error: '尚未下载 PDF' };
  const filePath = reportPath(record.pdf_key);
  const onDiskBytes = await reportByteLength(record.pdf_key);
  const outcome = await parseStoredAnnouncement(record, null, filePath, onDiskBytes);
  if (outcome === 'failed') {
    const [row] = await db<Array<{ parse_error: string | null }>>`SELECT parse_error FROM announcements WHERE id=${id}`;
    return { ok: false, outcome, error: row?.parse_error || '解析失败' };
  }
  return { ok: true, outcome };
}

export async function retireDuplicateIngestedReports() {
  const db = getDb();
  const rows = await db<Array<{
    id: string; code: string; title: string; status: string; published_at: string; parsed_at: string | null; core_count: number;
  }>>`
    SELECT a.id, a.code, a.title, a.status, a.published_at, a.parsed_at,
      (SELECT COUNT(*)::int FROM financial_metrics m
        WHERE m.announcement_id=a.id AND m.metric IN ('revenue','net_profit','eps','roe')) AS core_count
    FROM announcements a
    WHERE a.status NOT IN ('auto_skipped', 'discovered', 'download_failed', 'downloading', 'parsing')
      AND EXISTS (SELECT 1 FROM companies c WHERE c.code=a.code AND c.enabled=true)
  `;
  const skipIds = duplicateIdsToSkip(rows.map((row) => ({
    id: row.id,
    code: row.code,
    title: row.title,
    status: row.status,
    published_at: row.published_at,
    parsed_at: row.parsed_at,
    coreCount: row.core_count,
  })));
  if (!skipIds.length) return { skipped: 0 };
  const result = await db`
    UPDATE announcements
    SET status='auto_skipped',
        parse_error=${DUPLICATE_PERIOD_KEEP_MESSAGE},
        updated_at=NOW()
    WHERE id=ANY(${skipIds}::text[])
      AND status NOT IN ('auto_skipped', 'downloading', 'parsing')
  `;
  return { skipped: result.count };
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
  await ensureBackendSchema();
  await recoverStaleRuns();
  await retireRedundantPendingDownloads(announcementIds);
  await retireDuplicateIngestedReports();
  const cninfoFallbackByCode = new Map<string, Promise<Announcement[]>>();

  // 关键下载与解析候选，避免 LIMIT 被大量「已下载待解析」占满导致永远不下 PDF。
  const codeFilter = codes.length === 0;
  const idFilter = announcementIds.length === 0;
  // 指定公告的手动抓取：退回排队并清掉本地 PDF，才会真正重新下载。
  if (downloadLimit > 0 && announcementIds.length) {
    await db`
      UPDATE announcements
      SET status='discovered',
          pdf_key=NULL,
          pdf_sha256=NULL,
          downloaded_at=NULL,
          parse_error=NULL,
          updated_at=NOW()
      WHERE id=ANY(${announcementIds}::text[])
        AND status NOT IN ('downloading', 'parsing')
    `;
  }
  const downloadCandidates = downloadLimit > 0
    ? await db<StoredAnnouncement[]>`
        SELECT id, source, source_id, code, company_name, title, report_type, published_at, pdf_url, pdf_key, status
        FROM announcements
        WHERE (
            (status = 'discovered')
            OR (status = 'download_failed' AND (
              ${!codeFilter} OR ${!idFilter} OR updated_at < NOW() - INTERVAL '30 seconds'
            ))
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
          OR (
            ${!idFilter}
            AND pdf_key IS NOT NULL
            AND id=ANY(${announcementIds}::text[])
            AND status NOT IN ('downloading', 'parsing')
          )
        )
          AND (${codeFilter} OR code=ANY(${codes}::text[]))
          AND (${idFilter} OR id=ANY(${announcementIds}::text[]))
        ORDER BY COALESCE(parse_priority, 0) DESC,
          CASE WHEN parse_error IS NULL OR parse_error = '' THEN 0 ELSE 1 END,
          published_at DESC
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
  const claimedPeriods = new Set<string>();
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
      if (!record.pdf_key && !idSet.has(record.id) && !isFullFinancialReport(record.title)) {
        skippedCutoff += 1;
        await db`
          UPDATE announcements
          SET status='auto_skipped',
              parse_error=${pendingDownloadSkipMessage('not-report')},
              updated_at=NOW()
          WHERE id=${record.id} AND status IN ('discovered', 'download_failed')
        `;
        continue;
      }
      const coverageKey = periodCoverageKey(record.code, record.title, record.published_at);
      if (!record.pdf_key && coverageKey && claimedPeriods.has(coverageKey) && !idSet.has(record.id)) {
        skippedCutoff += 1;
        await db`
          UPDATE announcements
          SET status='auto_skipped',
              parse_error=${pendingDownloadSkipMessage('duplicate-period')},
              updated_at=NOW()
          WHERE id=${record.id} AND status IN ('discovered', 'download_failed')
        `;
        continue;
      }
      let bytes: ArrayBuffer | null = null;
      let pdfKey = record.pdf_key;
      if (!pdfKey && downloaded < downloadLimit) {
        const period = periodFromTitle(record.title, record.published_at);
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
        const timer = setTimeout(() => controller.abort(), 5 * 60 * 1000);
        let lastError = '';
        let usedUrl = record.pdf_url;
        try {
          const urls = pdfUrlCandidates(record.source, record.pdf_url);
          for (const url of urls) {
            patchIngestProgress(record.id, { detail: `请求 PDF（${record.source}）…` });
            try {
              bytes = await fetchPdfBytes(url, refererForSource(record.source), controller.signal);
              usedUrl = url;
              break;
            } catch (error) {
              lastError = String(error);
            }
          }
          if (!bytes && record.source !== 'CNINFO') {
            patchIngestProgress(record.id, { detail: '交易所失败，改从巨潮资讯下载…' });
            let pending = cninfoFallbackByCode.get(record.code);
            if (!pending) {
              pending = fetchCninfoReportsForCode(record.code, record.company_name, autoCollectSearchDays());
              cninfoFallbackByCode.set(record.code, pending);
            }
            const fallback = pickCninfoFallback(record, await pending);
            if (!fallback) {
              lastError = lastError || '交易所下载失败，巨潮未找到同期货报';
            } else {
              try {
                bytes = await fetchPdfBytes(fallback.pdfUrl, refererForSource('CNINFO'), controller.signal);
                usedUrl = fallback.pdfUrl;
              } catch (error) {
                lastError = String(error);
              }
            }
          }
        } finally {
          clearTimeout(timer);
        }
        if (!bytes) throw new Error(lastError.replace(/^Error:\s*/i, '') || 'PDF 下载结果为空');
        if (usedUrl !== record.pdf_url) {
          await db`UPDATE announcements SET pdf_url=${usedUrl}, updated_at=NOW() WHERE id=${record.id}`;
          record.pdf_url = usedUrl;
        }
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
        if (coverageKey) claimedPeriods.add(coverageKey);
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
      }

      const filePath = pdfKey ? reportPath(pdfKey) : undefined;
      const onDiskBytes = pdfKey ? await reportByteLength(pdfKey) : null;
      // Just-downloaded rows must still parse in this pass even if parseCandidates was empty at query time.
      if (!bytes && pdfKey && parsed < parseLimit && !(onDiskBytes != null && shouldExtractTextExternally(onDiskBytes))) {
        const object = await readReport(pdfKey);
        if (object) bytes = object.buffer.slice(object.byteOffset, object.byteOffset + object.byteLength);
      }
      if (bytes && filePath && shouldExtractTextExternally(bytes.byteLength)) {
        bytes = null;
      }

      if (parsed < parseLimit && (bytes || (filePath && onDiskBytes))) {
        const outcome = await parseStoredAnnouncement(record, bytes, filePath, onDiskBytes);
        if (outcome === 'parsed') parsed += 1;
        else if (outcome === 'failed') failed += 1;
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
        await db`UPDATE announcements SET status='downloaded', parse_priority=0, parse_error='解析超时（5分钟），已排到队尾', updated_at=${nowIso} WHERE id=${record.id}`;
      } else if (hasPdf || wasParsing) {
        await db`UPDATE announcements SET status='downloaded', parse_priority=0, parse_error=${message}, updated_at=${nowIso} WHERE id=${record.id}`;
      } else {
        await db`UPDATE announcements SET status='download_failed', parse_error=${message}, updated_at=${nowIso} WHERE id=${record.id}`;
      }
    }
  }
  const pendingLeft = Math.max(0, downloadCandidates.length - downloaded);
  if (pendingLeft > 0 && downloaded >= downloadLimit) {
    const wait = withDownloadJitter(pauseBetweenDownloads);
    setDownloadGate({
      nextAt: new Date(Date.now() + wait).toISOString(),
      pauseMs: pauseBetweenDownloads,
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
  const settings = getIngestSettings();
  const days = options.days ?? settings.lookbackDays;
  const downloadLimit = options.downloadLimit ?? settings.downloadLimit;
  const parseLimit = options.parseLimit ?? settings.parseLimit;
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



/** Hunt 2025Q1+ gaps until every enabled company has been scanned once, then stop. */
export async function fillCoverageGaps(options: { companyLimit?: number; downloadLimit?: number } = {}) {
  const companyLimit = Math.max(1, Math.min(options.companyLimit ?? 8, 12));
  const downloadLimit = Math.max(0, Math.min(options.downloadLimit ?? 0, 3));
  const db = getDb();
  const enabled = await db<Array<{ code: string; name: string; rank: number }>>`
    SELECT code, name, rank FROM companies WHERE enabled=true ORDER BY rank ASC, code ASC
  `;
  const currentLatest = latestExpectedPeriod();
  const prev = getGapScanState();
  if (!enabled.length) {
    setGapScanState({
      lastCode: null,
      mode: 'steady',
      expectedLatest: currentLatest,
      huntedCodes: [],
      missingPeriods: 0,
      missingCompanies: 0,
      completedAt: prev.completedAt ?? new Date().toISOString(),
    });
    return { checked: 0, filled: 0, codes: [] as string[], missingPeriods: 0, bootstrapComplete: true };
  }

  const codes = enabled.map((r) => r.code);
  const anns = await db<Array<{ code: string; title: string; published_at: string; status: string }>>`
    SELECT code, title, published_at, status FROM announcements
    WHERE code = ANY(${codes}::text[])
  `;
  const byCode = new Map<string, Array<{ title: string; published_at: string; status: string }>>();
  for (const row of anns) {
    const list = byCode.get(row.code) ?? [];
    list.push(row);
    byCode.set(row.code, list);
  }

  const expected = expectedPeriodsThroughLatest();
  const missingByCode = new Map<string, string[]>();
  let missingPeriods = 0;
  for (const company of enabled) {
    const missing = missingExpectedPeriods(byCode.get(company.code) ?? [], expected);
    if (!missing.length) continue;
    missingByCode.set(company.code, missing);
    missingPeriods += missing.length;
  }

  const decision = nextCoverageBootstrapState({
    mode: prev.mode,
    expectedLatest: prev.expectedLatest,
    currentLatest,
    missingCompanyCodes: [...missingByCode.keys()],
    huntedCodes: prev.huntedCodes,
  });

  const writeState = (mode: 'bootstrap' | 'steady', huntedCodes: string[], lastCode: string | null) => {
    setGapScanState({
      lastCode,
      mode,
      expectedLatest: currentLatest,
      huntedCodes,
      missingPeriods,
      missingCompanies: missingByCode.size,
      completedAt: mode === 'steady'
        ? (prev.completedAt && !decision.reopen ? prev.completedAt : new Date().toISOString())
        : null,
    });
  };

  if (decision.mode === 'steady') {
    writeState('steady', decision.huntedCodes, prev.lastCode);
    return { checked: enabled.length, filled: 0, codes: [] as string[], missingPeriods, bootstrapComplete: true };
  }

  const huntMap = new Map([...missingByCode.entries()].filter(([code]) => decision.remainingToHunt.includes(code)));
  const gaps = pickGapCompanyCodes(enabled, huntMap, decision.reopen ? null : prev.lastCode, companyLimit);
  if (!gaps.length) {
    writeState('steady', decision.huntedCodes, enabled[enabled.length - 1]?.code ?? null);
    return { checked: enabled.length, filled: 0, codes: [] as string[], missingPeriods, bootstrapComplete: true };
  }

  const result = await prioritizeCompanyCrawl(gaps, {
    downloadLimit,
    parseLimit: 0,
    days: autoCollectSearchDays(),
    fullHistory: false,
  });
  const nextHunted = [...new Set([...decision.huntedCodes, ...gaps])];
  const after = nextCoverageBootstrapState({
    mode: 'bootstrap',
    expectedLatest: currentLatest,
    currentLatest,
    missingCompanyCodes: [...missingByCode.keys()],
    huntedCodes: nextHunted,
  });
  writeState(after.mode, nextHunted, gaps[gaps.length - 1]);
  return {
    checked: enabled.length,
    filled: gaps.length,
    codes: gaps,
    missingPeriods,
    bootstrapComplete: after.mode === 'steady',
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
