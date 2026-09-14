import { bootstrapLiveData, fillCoverageGaps, processBacklog, runIngestion } from '../lib/ingest';
import { closeDb } from '../lib/db';
import { ensureSchema } from '../lib/migrate';
import { sendAlert } from '../lib/alerts';
import { isAutoCrawlEnabled } from '../lib/ingest-control';

const intervalMs = Number(process.env.INGEST_INTERVAL_MS ?? 600_000);
const backlogIntervalMs = Number(process.env.INGEST_BACKLOG_INTERVAL_MS ?? 45_000);
const days = Number(process.env.INGEST_DAYS ?? 2);
const downloadLimit = Number(process.env.INGEST_DOWNLOAD_LIMIT ?? 2);
const parseLimit = Number(process.env.INGEST_PARSE_LIMIT ?? 1);
const pagePauseMs = Number(process.env.PAGE_PAUSE_MS ?? 1000);
const downloadPauseMs = Number(process.env.DOWNLOAD_PAUSE_MS ?? 1200);
const maxPages = Number(process.env.INGEST_MAX_PAGES ?? 8);
let busy = false;
let discoverTimer: NodeJS.Timeout | undefined;
let backlogTimer: NodeJS.Timeout | undefined;

async function withLock(
  label: string,
  fn: () => Promise<unknown>,
  opts?: { allowWhenPaused?: boolean },
) {
  if (busy) {
    console.info(`[worker] skip ${label}: busy`);
    return;
  }
  const autoOn = await isAutoCrawlEnabled();
  if (!autoOn && !opts?.allowWhenPaused) {
    console.info(`[worker] auto crawl paused (${label})`);
    return;
  }
  busy = true;
  try {
    const result = await fn();
    console.info(`[worker] ${label} finished`, result);
  } catch (error) {
    console.error(`[worker] ${label} failed`, error);
    await sendAlert(`财报采集任务失败 (${label})`, { error: String(error) });
  } finally {
    busy = false;
  }
}

async function discoverTick() {
  // Discover hits exchanges — skip entirely while auto is paused.
  await withLock('discover', async () => {
    const feed = await runIngestion({ days, downloadLimit, parseLimit });
    // Feed only covers recent days; backfill enabled companies still missing in-window filings.
    const gaps = await fillCoverageGaps({ companyLimit: 2 });
    return { feed, gaps };
  });
}

async function backlogTick() {
  const autoOn = await isAutoCrawlEnabled();
  if (!autoOn) {
    // Paused = no new downloads; still drain 待解析 from local PDFs.
    await withLock(
      'backlog-parse',
      () => processBacklog({ downloadLimit: 0, parseLimit }),
      { allowWhenPaused: true },
    );
    return;
  }
  await withLock('backlog', async () => {
    const processed = await processBacklog({ downloadLimit, parseLimit });
    // 每轮 backlog 也补 1～2 家缺口，避免只靠 10 分钟 discover、队列长期为空
    const gaps = await fillCoverageGaps({ companyLimit: 2, downloadLimit });
    return { processed, gaps };
  });
}

async function shutdown(signal: string) {
  console.info(`[worker] received ${signal}, shutting down`);
  if (discoverTimer) clearInterval(discoverTimer);
  if (backlogTimer) clearInterval(backlogTimer);
  await closeDb();
  process.exit(0);
}

async function main() {
  await ensureSchema();
  await bootstrapLiveData();
  // Drain existing discovered PDFs immediately, then full discover.
  await backlogTick();
  await discoverTick();
  backlogTimer = setInterval(() => void backlogTick(), backlogIntervalMs);
  discoverTimer = setInterval(() => void discoverTick(), intervalMs);
  console.info(
    `[worker] started; backlog every ${backlogIntervalMs}ms, discover every ${intervalMs}ms; days=${days} downloadLimit=${downloadLimit} parseLimit=${parseLimit} pagePauseMs=${pagePauseMs} downloadPauseMs=${downloadPauseMs} maxPages=${maxPages}`,
  );
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
void main();
