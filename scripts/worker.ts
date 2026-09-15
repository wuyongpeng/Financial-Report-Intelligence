import { bootstrapLiveData, fillCoverageGaps, processBacklog, runIngestion } from '../lib/ingest';
import { refreshAshareUniverse } from './refresh-ashare-universe';
import { closeDb } from '../lib/db';
import { ensureSchema } from '../lib/migrate';
import { sendAlert } from '../lib/alerts';
import { getIngestControl } from '../lib/ingest-control';
import { getGapScanState, setDownloadGate } from '../lib/ingest-progress';

const intervalMs = Number(process.env.INGEST_INTERVAL_MS ?? 600_000);
const bootstrapGapMs = Number(process.env.INGEST_BOOTSTRAP_GAP_MS ?? 90_000);
const backlogIntervalMs = Number(process.env.INGEST_BACKLOG_INTERVAL_MS ?? 45_000);
const days = Number(process.env.INGEST_DAYS ?? 2);
const downloadLimit = Number(process.env.INGEST_DOWNLOAD_LIMIT ?? 2);
const parseLimit = Number(process.env.INGEST_PARSE_LIMIT ?? 1);
const pagePauseMs = Number(process.env.PAGE_PAUSE_MS ?? 1000);
const downloadPauseMs = Number(process.env.DOWNLOAD_PAUSE_MS ?? 1200);
const maxPages = Number(process.env.INGEST_MAX_PAGES ?? 8);
let busy = false;
let discoverTimer: NodeJS.Timeout | undefined;
let bootstrapTimer: NodeJS.Timeout | undefined;
let backlogTimer: NodeJS.Timeout | undefined;
let universeTimer: NodeJS.Timeout | undefined;
let lastUniverseDay = '';

async function withLock(
  label: string,
  fn: () => Promise<unknown>,
) {
  if (busy) {
    console.info(`[worker] skip ${label}: busy`);
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
  const control = await getIngestControl();
  const autoOn = control.autoCrawlEnabled;
  await withLock('discover', async () => {
    const feed = await runIngestion({
      days,
      downloadLimit: autoOn ? downloadLimit : 0,
      parseLimit,
    });
    const gaps = await fillCoverageGaps({
      companyLimit: 8,
      downloadLimit: 0,
    });
    return { feed, gaps, autoCrawlEnabled: autoOn, coverageMode: getGapScanState().mode };
  });
}

async function coverageBootstrapTick() {
  if (getGapScanState().mode === 'steady') return;
  await withLock('coverage-bootstrap', () => fillCoverageGaps({ companyLimit: 8, downloadLimit: 0 }));
}

async function backlogTick() {
  const control = await getIngestControl();
  const autoOn = control.autoCrawlEnabled;
  if (!autoOn) {
    setDownloadGate({ nextAt: null, pauseMs: Number(process.env.DOWNLOAD_PAUSE_MS ?? 1200), mode: 'paused' });
    await withLock('backlog-parse-hold-download', () => processBacklog({ downloadLimit: 0, parseLimit }));
    return;
  }
  await withLock('backlog', async () => {
    const processed = await processBacklog({ downloadLimit, parseLimit });
    return { processed };
  });
}


async function ashareUniverseTick() {
  const now = new Date();
  // Local calendar day key; fire once after 01:00
  const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  if (now.getHours() < 1) return;
  if (lastUniverseDay === day) return;
  await withLock('ashare-universe', async () => {
    const result = await refreshAshareUniverse();
    lastUniverseDay = day;
    return result;
  });
}

async function shutdown(signal: string) {
  console.info(`[worker] received ${signal}, shutting down`);
  if (discoverTimer) clearInterval(discoverTimer);
  if (bootstrapTimer) clearInterval(bootstrapTimer);
  if (backlogTimer) clearInterval(backlogTimer);
  if (universeTimer) clearInterval(universeTimer);
  await closeDb();
  process.exit(0);
}

async function main() {
  await ensureSchema();
  await bootstrapLiveData();
  // Drain existing discovered PDFs immediately, then full discover.
  await backlogTick();
  await discoverTick();
  void ashareUniverseTick();
  backlogTimer = setInterval(() => void backlogTick(), backlogIntervalMs);
  discoverTimer = setInterval(() => void discoverTick(), intervalMs);
  bootstrapTimer = setInterval(() => void coverageBootstrapTick(), bootstrapGapMs);
  universeTimer = setInterval(() => { void ashareUniverseTick(); }, 30 * 60 * 1000);
  const coverage = getGapScanState();
  console.info(
    `[worker] started; backlog every ${backlogIntervalMs}ms, discover every ${intervalMs}ms, coverage-bootstrap every ${bootstrapGapMs}ms (until steady); days=${days} downloadLimit=${downloadLimit} parseLimit=${parseLimit} pagePauseMs=${pagePauseMs} downloadPauseMs=${downloadPauseMs} maxPages=${maxPages}; coverageMode=${coverage.mode}; ashare-universe daily after 01:00`,
  );
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
void main();
