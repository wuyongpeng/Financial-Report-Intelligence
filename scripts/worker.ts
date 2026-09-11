import { bootstrapLiveData, runIngestion } from '../lib/ingest';
import { closeDb } from '../lib/db';
import { ensureSchema } from '../lib/migrate';
import { sendAlert } from '../lib/alerts';
import { isAutoCrawlEnabled } from '../lib/ingest-control';

const intervalMs = Number(process.env.INGEST_INTERVAL_MS ?? 600_000);
const days = Number(process.env.INGEST_DAYS ?? 2);
const downloadLimit = Number(process.env.INGEST_DOWNLOAD_LIMIT ?? 2);
const parseLimit = Number(process.env.INGEST_PARSE_LIMIT ?? 1);
const pagePauseMs = Number(process.env.PAGE_PAUSE_MS ?? 1000);
const downloadPauseMs = Number(process.env.DOWNLOAD_PAUSE_MS ?? 1200);
const maxPages = Number(process.env.INGEST_MAX_PAGES ?? 8);
let running = false;
let timer: NodeJS.Timeout | undefined;

async function tick() {
  if (running) return;
  if (!(await isAutoCrawlEnabled())) {
    console.info('[worker] auto crawl paused');
    return;
  }
  running = true;
  try {
    const result = await runIngestion({ days, downloadLimit, parseLimit });
    console.info('[worker] ingestion finished', result);
  } catch (error) {
    console.error('[worker] ingestion failed', error);
    await sendAlert('财报采集任务失败', { error: String(error) });
  } finally {
    running = false;
  }
}

async function shutdown(signal: string) {
  console.info(`[worker] received ${signal}, shutting down`);
  if (timer) clearInterval(timer);
  await closeDb();
  process.exit(0);
}

async function main() {
  await ensureSchema();
  await bootstrapLiveData();
  await tick();
  timer = setInterval(() => void tick(), intervalMs);
  console.info(
    `[worker] started gently; interval=${intervalMs}ms days=${days} downloadLimit=${downloadLimit} parseLimit=${parseLimit} pagePauseMs=${pagePauseMs} downloadPauseMs=${downloadPauseMs} maxPages=${maxPages}`,
  );
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
void main();
