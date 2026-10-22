import { getDb } from './db';
import { ensureBackendSchema } from './backend-schema';
import { abortVerdictRun, clearVerdictSkip, requestVerdictAbort } from './verdict-abort';

export const DISCARD_PARSE_ERROR = '运维剔除：非完整财报/错抓';

export type DiscardAnnouncementResult = {
  id: string;
  alreadySkipped: boolean;
  metricsDeleted: number;
  verdictsDeleted: number;
  chunksDeleted: number;
  note: string;
};

/**
 * Soft-discard a wrong capture: mark auto_skipped, clear metrics/verdict/chunks.
 * Keeps the announcements row for audit; PDF on disk is left alone.
 * Frees the period so coverage/crawl can pick up the real filing.
 */
export async function discardAnnouncement(announcementId: string): Promise<DiscardAnnouncementResult | null> {
  const id = announcementId.trim();
  if (!id) return null;
  await ensureBackendSchema();
  const db = getDb();

  const rows = await db<Array<{ id: string; status: string; company_name: string; title: string; parse_error: string | null }>>`
    SELECT id, status, company_name, title, parse_error
    FROM announcements
    WHERE id=${id}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;

  // Stop any in-flight verdict and drop skip-list entry so it will not re-queue.
  abortVerdictRun(id);
  requestVerdictAbort(id);
  clearVerdictSkip(id);

  const alreadySkipped = row.status === 'auto_skipped' && row.parse_error === DISCARD_PARSE_ERROR;

  const metrics = await db`
    DELETE FROM financial_metrics WHERE announcement_id=${id}
  `;
  const verdicts = await db`
    DELETE FROM report_verdicts WHERE announcement_id=${id}
  `;
  const chunks = await db`
    DELETE FROM report_chunks WHERE announcement_id=${id}
  `;

  await db`
    UPDATE announcements
    SET status='auto_skipped',
        parse_error=${DISCARD_PARSE_ERROR},
        updated_at=NOW()
    WHERE id=${id}
  `;

  return {
    id,
    alreadySkipped: Boolean(alreadySkipped),
    metricsDeleted: metrics.count,
    verdictsDeleted: verdicts.count,
    chunksDeleted: chunks.count,
    note: alreadySkipped
      ? '该份已剔除，无需重复操作'
      : `已剔除「${row.company_name}」错抓/非完整财报，该期次已释放，可重新抓取真财报`,
  };
}
