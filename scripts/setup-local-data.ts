import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readReport } from '../lib/storage';
import { getDb, closeDb } from '../lib/db';
import { bootstrapLiveData, processBacklog } from '../lib/ingest';

// Real snapshot import only: every metric is extracted from its downloaded PDF.
async function main() {
  const db = getDb();
  await db.unsafe(await readFile(new URL('../db/init.sql', import.meta.url), 'utf8'));
  console.log('Snapshot:', await bootstrapLiveData());
  const pending = await db<Array<{ id: string; code: string }>>`SELECT id, code FROM announcements WHERE pdf_key IS NULL`;
  for (const report of pending) {
    const key = `reports/${report.code}/${report.id}.pdf`;
    const cached = await readReport(key);
    if (!cached || cached.subarray(0,4).toString() !== '%PDF') continue;
    const hash = createHash('sha256').update(cached).digest('hex');
    await db`UPDATE announcements SET pdf_key=${key}, pdf_sha256=${hash}, status='downloaded', downloaded_at=NOW(), updated_at=NOW() WHERE id=${report.id}`;
  }
  for (let batch = 1; batch <= 20; batch++) {
    const result = await processBacklog({ downloadLimit: 5, parseLimit: 5, codes: process.env.LOCAL_SAMPLE_ONLY === 'true' ? ['600519', '600036', '000858', '601166'] : undefined });
    console.log(`Batch ${batch}:`, result);
    if (!result.backlog || (!result.downloaded && !result.parsed)) break;
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
  const rows = await db`SELECT status, COUNT(*)::int AS reports FROM announcements GROUP BY status`;
  console.log('Report status:', rows);
  const [ready] = await db`SELECT COUNT(*)::int AS count FROM (SELECT announcement_id FROM financial_metrics
    WHERE metric IN ('revenue','net_profit','eps','roe') GROUP BY announcement_id HAVING COUNT(*)=4) x`;
  if (!ready.count) throw new Error('No report contains all four real metrics');
  console.log('Reports with four metrics:', ready.count);
}
void main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => closeDb());
