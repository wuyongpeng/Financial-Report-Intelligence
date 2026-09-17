import { getDb } from './db';
import { ensureBackendSchema } from './backend-schema';
import { acceptVerdictPayload, type ReportVerdict } from './report-verdict';
import { generateReportVerdict } from './report-verdict-llm';

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
const STALE_MS = 3 * 60 * 1000;
const WAIT_MS = 4 * 60 * 1000;

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
    VALUES (${reportId}, ${db.json(payload)}, ${process.env.LLM_MODEL ?? null}, 'ready', NULL, NOW(), NOW())
    ON CONFLICT (announcement_id) DO UPDATE SET
      payload=EXCLUDED.payload, model=EXCLUDED.model, status='ready', error=NULL,
      generated_at=EXCLUDED.generated_at, updated_at=EXCLUDED.updated_at
  `;
}

async function markFailed(reportId: string, error: string) {
  const db = getDb();
  await db`
    INSERT INTO report_verdicts (announcement_id, payload, model, status, error, generated_at, updated_at)
    VALUES (${reportId}, NULL, ${process.env.LLM_MODEL ?? null}, 'failed', ${error.slice(0, 300)}, NOW(), NOW())
    ON CONFLICT (announcement_id) DO UPDATE SET
      status='failed', error=EXCLUDED.error, model=EXCLUDED.model, updated_at=EXCLUDED.updated_at
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
      AND updated_at < NOW() - INTERVAL '3 minutes'
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
      const value = await generateReportVerdict(reportId);
      if (value) {
        await markReady(reportId, value);
        return value;
      }
      await markFailed(reportId, 'unavailable');
      return null;
    } catch (error) {
      await markFailed(reportId, String(error));
      return null;
    }
  })().finally(() => { inflight.delete(reportId); });
  inflight.set(reportId, pending);
  return pending;
}

/** Read a stored verdict. Missing/invalid/failed returns null without calling the model. */
export async function loadStoredVerdict(reportId: string): Promise<ReportVerdict | null> {
  const row = await loadRow(reportId);
  if (row?.status !== 'ready') return null;
  return asVerdict(row.payload);
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

export async function listReportsNeedingVerdict(limit = 5000) {
  await ensureBackendSchema();
  const cap = Math.min(Math.max(1, Math.floor(limit)), 5000);
  return getDb()<Array<{ id: string; code: string; company_name: string; title: string }>>`
    SELECT a.id, a.code, a.company_name, a.title
    FROM announcements a
    JOIN companies c ON c.code=a.code AND c.enabled=true
    LEFT JOIN report_verdicts v ON v.announcement_id=a.id
    WHERE a.status IN ('review', 'online', 'parse_partial')
      AND (v.announcement_id IS NULL OR v.status <> 'ready')
    ORDER BY a.published_at DESC
    LIMIT ${cap}
  `;
}

/** Force a new LLM call and overwrite the stored row on success. Keep the old ready payload if refresh fails. */
export async function refreshReportVerdict(reportId: string): Promise<ReportVerdict | null> {
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
  if (value) return value;
  if (previous) {
    await markReady(reportId, previous);
    return null;
  }
  return null;
}
