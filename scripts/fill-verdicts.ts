import { closeDb } from '../lib/db';
import { fillReportVerdict, listReportsNeedingVerdict } from '../lib/report-verdict-store';

function arg(name: string, fallback: number) {
  const raw = process.argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
  const value = Number(raw ?? process.env[name.replace(/^--/, '').replace(/-/g, '_').toUpperCase()] ?? fallback);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

async function pool<T>(items: T[], size: number, worker: (item: T, index: number) => Promise<void>) {
  let cursor = 0;
  async function next() {
    const index = cursor;
    cursor += 1;
    const item = items[index];
    if (!item) return;
    await worker(item, index);
    await next();
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, () => next()));
}

async function main() {
  if (!process.env.LLM_BASE_URL || !process.env.LLM_MODEL) {
    throw new Error('未配置 LLM_BASE_URL / LLM_MODEL，无法生成财报速览');
  }
  const limit = arg('--limit', 5000);
  const concurrency = Math.min(arg('--concurrency', 2), 4);
  const rows = await listReportsNeedingVerdict(limit);
  console.info(`[fill-verdicts] ${rows.length} reports need overview, concurrency=${concurrency}`);
  let ok = 0;
  let failed = 0;
  await pool(rows, concurrency, async (row, index) => {
    const label = `${index + 1}/${rows.length} ${row.company_name} ${row.code} ${row.title.slice(0, 24)}`;
    try {
      const result = await fillReportVerdict(row.id);
      if (result) {
        ok += 1;
        console.info(`[fill-verdicts] ok ${label} · ${result.verdict.label}`);
      } else {
        failed += 1;
        console.warn(`[fill-verdicts] fail ${label}`);
      }
    } catch (error) {
      failed += 1;
      console.warn(`[fill-verdicts] error ${label}`, String(error));
    }
  });
  console.info(`[fill-verdicts] done ok=${ok} fail=${failed} remaining_input=${rows.length}`);
}

main()
  .catch((error) => {
    console.error('[fill-verdicts] aborted', error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
