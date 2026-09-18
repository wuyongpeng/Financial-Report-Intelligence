import { getDb } from './db';
import { ensureBackendSchema } from './backend-schema';
import { acceptVerdictPayload, type ReportVerdict } from './report-verdict';
import { generateReportVerdict, type VerdictGenerateOptions } from './report-verdict-llm';
import { llmModelName } from './llm-providers';
import { publicVerdictError } from './llm-error';

type VerdictStatus = 'pending' | 'ready' | 'failed';
type VerdictRow = {
  announcement_id: string;
  payload: unknown;
  model: string | null;
  status: VerdictStatus;
  error: string | null;
  generated_at: string;
  updated_at: string;
};

const inflight = new Map<string, Promise<ReportVerdict | null>>();
const STALE_MS = 8 * 60 * 1000;
const WAIT_MS = 8 * 60 * 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asVerdict(payload: unknown): ReportVerdict | null {
  return acceptVerdictPayload(payload);
}

async function loadRow(reportId: string): Promise<VerdictRow | null> {
  await ensureBackendSchema();
  const [row] = await getDb()<VerdictRow[]>`
    SELECT announcement_id, payload, model, status, error, generated_at, updated_at
    FROM report_verdicts WHERE announcement_id=${reportId}
  `;
  return row ?? null;
}

function isStale(row: VerdictRow) {
  const updated = Date.parse(row.updated_at);
  return !Number.isFinite(updated) || Date.now() - updated > STALE_MS;
}

async function markReady(reportId: string, payload: ReportVerdict) {
  const db = getDb();
  await db`
    INSERT INTO report_verdicts (announcement_id, payload, model, status, error, generated_at, updated_at)
    VALUES (${reportId}, ${db.json(payload)}, ${llmModelName()}, 'ready', NULL, NOW(), NOW())
    ON CONFLICT (announcement_id) DO UPDATE SET
      payload=EXCLUDED.payload, model=EXCLUDED.model, status='ready', error=NULL,
      generated_at=EXCLUDED.generated_at, updated_at=EXCLUDED.updated_at
  `;
}

async function markFailed(reportId: string, error: string) {
  const db = getDb();
  await db`
    INSERT INTO report_verdicts (announcement_id, payload, model, status, error, generated_at, updated_at)
    VALUES (${reportId}, NULL, ${llmModelName()}, 'failed', ${error.slice(0, 300)}, NOW(), NOW())
    ON CONFLICT (announcement_id) DO UPDATE SET
      status='failed', error=EXCLUDED.error, model=EXCLUDED.model, updated_at=EXCLUDED.updated_at
    WHERE report_verdicts.status IS DISTINCT FROM 'ready'
  `;
}

async function reportExists(reportId: string) {
  const [row] = await getDb()<Array<{ id: string }>>`SELECT id FROM announcements WHERE id=${reportId}`;
  return Boolean(row);
}

async function claimGenerate(reportId: string) {
  if (!(await reportExists(reportId))) return false;
  const db = getDb();
  const inserted = await db<Array<{ announcement_id: string }>>`
    INSERT INTO report_verdicts (announcement_id, status, generated_at, updated_at)
    VALUES (${reportId}, 'pending', NOW(), NOW())
    ON CONFLICT (announcement_id) DO NOTHING
    RETURNING announcement_id
  `;
  if (inserted.length) return true;
  const reclaimed = await db<Array<{ announcement_id: string }>>`
    UPDATE report_verdicts
    SET status='pending', error=NULL, updated_at=NOW()
    WHERE announcement_id=${reportId}
      AND status='pending'
      AND updated_at < NOW() - INTERVAL '8 minutes'
    RETURNING announcement_id
  `;
  return reclaimed.length > 0;
}

async function waitForReady(reportId: string): Promise<ReportVerdict | null> {
  const started = Date.now();
  while (Date.now() - started < WAIT_MS) {
    const row = await loadRow(reportId);
    if (row?.status === 'ready') return asVerdict(row.payload);
    if (row?.status === 'failed') return null;
    if (!row || (row.status === 'pending' && isStale(row))) return runGenerate(reportId, true);
    await sleep(400);
  }
  await markFailed(reportId, 'AI 生成排队超时，请稍后再试。');
  return null;
}

async function runGenerate(reportId: string, claimed: boolean): Promise<ReportVerdict | null> {
  const existing = inflight.get(reportId);
  if (existing) return existing;
  const pending = (async () => {
    if (!claimed && !(await claimGenerate(reportId))) {
      const row = await loadRow(reportId);
      if (row?.status === 'ready') return asVerdict(row.payload);
      if (row?.status === 'pending' && !isStale(row)) return waitForReady(reportId);
    }
    const db = getDb();
    await db`
      UPDATE report_verdicts SET status='pending', error=NULL, updated_at=NOW()
      WHERE announcement_id=${reportId}
    `;
    try {
      const generated = await generateReportVerdict(reportId);
      if (generated.ok) {
        await markReady(reportId, generated.value);
        return generated.value;
      }
      await markFailed(reportId, publicVerdictError(generated.error));
      return null;
    } catch (error) {
      await markFailed(reportId, publicVerdictError(error instanceof Error ? error.message : String(error)));
      return null;
    }
  })().finally(() => { inflight.delete(reportId); });
  inflight.set(reportId, pending);
  return pending;
}

export function hasInflightVerdict(reportId: string) {
  return inflight.has(reportId);
}

/** Polling GET must not spawn a second job while pending is still owned by POST/after(). */
export function shouldKickVerdictJob(peek: VerdictPeek) {
  if (peek.status === 'ready' || peek.status === 'failed') return false;
  if (peek.status === 'pending' && !peek.stale) return false;
  return peek.status === 'absent' || peek.stale;
}

/** Claim a row as pending so GET polling sees 202 instead of a stale failed/absent state. */
export async function markVerdictPending(reportId: string, overwriteReady = false): Promise<boolean> {
  if (!(await reportExists(reportId))) return false;
  const db = getDb();
  if (overwriteReady) {
    await db`
      INSERT INTO report_verdicts (announcement_id, status, generated_at, updated_at)
      VALUES (${reportId}, 'pending', NOW(), NOW())
      ON CONFLICT (announcement_id) DO UPDATE SET status='pending', error=NULL, updated_at=NOW()
    `;
    return true;
  }
  await db`
    INSERT INTO report_verdicts (announcement_id, status, generated_at, updated_at)
    VALUES (${reportId}, 'pending', NOW(), NOW())
    ON CONFLICT (announcement_id) DO UPDATE SET status='pending', error=NULL, updated_at=NOW()
    WHERE report_verdicts.status <> 'ready'
  `;
  return true;
}

/** Run the model after pending is already claimed. Do not waitForReady. */
export async function executeReportVerdict(reportId: string): Promise<ReportVerdict | null> {
  return runGenerate(reportId, true);
}

/** Read the last failed generation message. Ready rows have no error. */
export async function loadVerdictError(reportId: string): Promise<string | null> {
  const row = await loadRow(reportId);
  if (row?.status !== 'failed' || !row.error?.trim()) return null;
  return publicVerdictError(row.error);
}
export async function loadStoredVerdict(reportId: string): Promise<ReportVerdict | null> {
  const row = await loadRow(reportId);
  if (row?.status !== 'ready') return null;
  return asVerdict(row.payload);
}

export type VerdictPeek = {
  status: 'ready' | 'pending' | 'failed' | 'absent';
  value: ReportVerdict | null;
  error: string | null;
  stale: boolean;
  ageMs: number;
};

function rowAgeMs(row: VerdictRow) {
  const updated = Date.parse(row.updated_at);
  return Number.isFinite(updated) ? Math.max(0, Date.now() - updated) : 0;
}

export async function peekReportVerdict(reportId: string): Promise<VerdictPeek> {
  const row = await loadRow(reportId);
  if (!row) return { status: 'absent', value: null, error: null, stale: false, ageMs: 0 };
  if (row.status === 'ready') {
    const value = asVerdict(row.payload);
    if (value) return { status: 'ready', value, error: null, stale: false, ageMs: rowAgeMs(row) };
    return { status: 'failed', value: null, error: 'AI 返回格式无法解析，请稍后再试。', stale: false, ageMs: rowAgeMs(row) };
  }
  if (row.status === 'failed') {
    return {
      status: 'failed',
      value: null,
      error: publicVerdictError(row.error || 'AI 概览暂时无法生成，请稍后再试。'),
      stale: false,
      ageMs: rowAgeMs(row),
    };
  }
  return { status: 'pending', value: null, error: null, stale: isStale(row), ageMs: rowAgeMs(row) };
}

/** First visit generates once and writes to DB; later visits only read. */
export async function getOrCreateReportVerdict(reportId: string): Promise<ReportVerdict | null> {
  const row = await loadRow(reportId);
  if (row?.status === 'ready') return asVerdict(row.payload);
  if (row?.status === 'failed') return null;
  if (row?.status === 'pending' && !isStale(row)) return waitForReady(reportId);
  return runGenerate(reportId, false);
}

/** Generate if missing/stale/failed; skip the model when a ready payload already exists. */
export async function fillReportVerdict(reportId: string): Promise<ReportVerdict | null> {
  const row = await loadRow(reportId);
  if (row?.status === 'ready') return asVerdict(row.payload);
  if (row?.status === 'pending' && !isStale(row)) return waitForReady(reportId);
  return runGenerate(reportId, false);
}

export type VerdictQueueJob = {
  id: string;
  code: string;
  company_name: string;
  title: string;
  published_at: string;
  verdict_status?: string | null;
  verdict_error?: string | null;
};

export async function getVerdictQueueJob(reportId: string): Promise<VerdictQueueJob | null> {
  await ensureBackendSchema();
  const [row] = await getDb()<VerdictQueueJob[]>`
    SELECT a.id, a.code, a.company_name, a.title, a.published_at
    FROM announcements a WHERE a.id=${reportId}
  `;
  return row ?? null;
}

export async function listReportsNeedingVerdict(limit = 5000) {
  await ensureBackendSchema();
  const cap = Math.min(Math.max(1, Math.floor(limit)), 5000);
  return getDb()<VerdictQueueJob[]>`
    SELECT a.id, a.code, a.company_name, a.title, a.published_at,
      v.status AS verdict_status, v.error AS verdict_error
    FROM announcements a
    JOIN companies c ON c.code=a.code AND c.enabled=true
    LEFT JOIN report_verdicts v ON v.announcement_id=a.id
    WHERE a.status IN ('review', 'online', 'parse_partial')
      AND (v.announcement_id IS NULL OR v.status <> 'ready')
    ORDER BY a.published_at DESC
    LIMIT ${cap}
  `;
}

export async function countReportsNeedingVerdict() {
  await ensureBackendSchema();
  const [row] = await getDb()<Array<{ n: number }>>`
    SELECT COUNT(*)::int AS n
    FROM announcements a
    JOIN companies c ON c.code=a.code AND c.enabled=true
    LEFT JOIN report_verdicts v ON v.announcement_id=a.id
    WHERE a.status IN ('review', 'online', 'parse_partial')
      AND (v.announcement_id IS NULL OR v.status <> 'ready')
  `;
  return row?.n ?? 0;
}

export async function countDueVerdictJobs(failBackoffMs = 30 * 60_000) {
  await ensureBackendSchema();
  const failBackoffSec = Math.max(60, Math.floor(failBackoffMs / 1000));
  const [row] = await getDb()<Array<{ n: number }>>`
    SELECT COUNT(*)::int AS n
    FROM announcements a
    JOIN companies c ON c.code=a.code AND c.enabled=true
    LEFT JOIN report_verdicts v ON v.announcement_id=a.id
    WHERE a.status IN ('review', 'online', 'parse_partial')
      AND (
        v.announcement_id IS NULL
        OR (v.status = 'failed' AND v.updated_at < NOW() - ${failBackoffSec} * INTERVAL '1 second')
        OR (v.status = 'pending' AND v.updated_at < NOW() - INTERVAL '8 minutes')
      )
  `;
  return row?.n ?? 0;
}

export async function listDueVerdictJobs(limit = 12, failBackoffMs = 30 * 60_000) {
  await ensureBackendSchema();
  const cap = Math.min(Math.max(1, Math.floor(limit)), 80);
  const failBackoffSec = Math.max(60, Math.floor(failBackoffMs / 1000));
  return getDb()<VerdictQueueJob[]>`
    SELECT a.id, a.code, a.company_name, a.title, a.published_at
    FROM announcements a
    JOIN companies c ON c.code=a.code AND c.enabled=true
    LEFT JOIN report_verdicts v ON v.announcement_id=a.id
    WHERE a.status IN ('review', 'online', 'parse_partial')
      AND (
        v.announcement_id IS NULL
        OR (v.status = 'failed' AND v.updated_at < NOW() - ${failBackoffSec} * INTERVAL '1 second')
        OR (v.status = 'pending' AND v.updated_at < NOW() - INTERVAL '8 minutes')
      )
    ORDER BY a.published_at DESC
    LIMIT ${cap}
  `;
}

async function releaseQueueClaim(reportId: string, previous: VerdictRow | null) {
  const db = getDb();
  if (previous?.status === 'failed') {
    await db`
      UPDATE report_verdicts
      SET status='failed', error=${previous.error}, model=${previous.model}, updated_at=${previous.updated_at}
      WHERE announcement_id=${reportId} AND status='pending'
    `;
    return;
  }
  await db`
    DELETE FROM report_verdicts
    WHERE announcement_id=${reportId} AND status='pending' AND payload IS NULL
  `;
}

export type QueuedVerdictOutcome = 'ok' | 'fail' | 'busy' | 'skip';

/** One background job: never wait 4 minutes for another worker; yield if the LLM slot is taken. */
export async function runQueuedVerdict(
  reportId: string,
  options: VerdictGenerateOptions & { force?: boolean } = {},
): Promise<{ outcome: QueuedVerdictOutcome; error: string | null }> {
  const previous = await loadRow(reportId);
  if (previous?.status === 'ready') return { outcome: 'skip', error: null };
  if (inflight.has(reportId)) return { outcome: 'busy', error: 'LLM 正被占用，稍后重试。' };
  if (!options.force && previous?.status === 'pending' && !isStale(previous)) return { outcome: 'skip', error: null };
  if (!(await reportExists(reportId))) return { outcome: 'skip', error: null };

  const db = getDb();
  await db`
    INSERT INTO report_verdicts (announcement_id, status, generated_at, updated_at)
    VALUES (${reportId}, 'pending', NOW(), NOW())
    ON CONFLICT (announcement_id) DO UPDATE SET status='pending', error=NULL, updated_at=NOW()
  `;
  try {
    const generated = await generateReportVerdict(reportId, options);
    if (generated.ok) {
      await markReady(reportId, generated.value);
      return { outcome: 'ok', error: null };
    }
    if (generated.retryLater) {
      await releaseQueueClaim(reportId, previous);
      return { outcome: 'busy', error: generated.error };
    }
    await markFailed(reportId, publicVerdictError(generated.error));
    return { outcome: 'fail', error: publicVerdictError(generated.error) };
  } catch (error) {
    const message = publicVerdictError(error instanceof Error ? error.message : String(error));
    await markFailed(reportId, message);
    return { outcome: 'fail', error: message };
  }
}

/** Force a new LLM call and overwrite the stored row on success. Keep the old ready payload if refresh fails. */
export async function refreshReportVerdict(reportId: string): Promise<{ value: ReportVerdict | null; error: string | null }> {
  const previous = await loadStoredVerdict(reportId);
  const db = getDb();
  if (await reportExists(reportId)) {
    await db`
      INSERT INTO report_verdicts (announcement_id, status, generated_at, updated_at)
      VALUES (${reportId}, 'pending', NOW(), NOW())
      ON CONFLICT (announcement_id) DO UPDATE SET status='pending', error=NULL, updated_at=NOW()
    `;
  }
  const value = await runGenerate(reportId, true);
  if (value) return { value, error: null };
  const error = (await loadVerdictError(reportId)) ?? 'AI 概览暂时无法生成，请稍后再试。';
  if (previous) await markReady(reportId, previous);
  return { value: null, error };
}
