import { bootstrapLiveData, fillCoverageGaps, processBacklog, runIngestion } from '../lib/ingest';
import { refreshAshareUniverse } from './refresh-ashare-universe';
import { closeDb } from '../lib/db';
import { ensureSchema } from '../lib/migrate';
import { sendAlert } from '../lib/alerts';
import { getIngestControl } from '../lib/ingest-control';
import { getGapScanState, setDownloadGate } from '../lib/ingest-progress';
import { getIngestSettings, ingestPollIntervalMs } from '../lib/ingest-settings';
import { tickVerdictQueue } from '../lib/verdict-queue';

const DISCOVER_WATCH_MS = 15_000;
const bootstrapGapMs = Number(process.env.INGEST_BOOTSTRAP_GAP_MS ?? 90_000);
const backlogIntervalMs = Number(process.env.INGEST_BACKLOG_INTERVAL_MS ?? 45_000);
const pagePauseMs = Number(process.env.PAGE_PAUSE_MS ?? 1000);
const maxPages = Number(process.env.INGEST_MAX_PAGES ?? 8);
let busy = false;
let lastDiscoverAt = 0;
let discoverTimer: NodeJS.Timeout | undefined;
let bootstrapTimer: NodeJS.Timeout | undefined;
let backlogTimer: NodeJS.Timeout | undefined;
let universeTimer: NodeJS.Timeout | undefined;
let verdictTimer: NodeJS.Timeout | undefined;
let lastUniverseDay = '';
let verdictBusy = false;

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
  const settings = getIngestSettings();
  const autoOn = control.autoCrawlEnabled;
  await withLock('discover', async () => {
    const feed = await runIngestion({
      days: settings.lookbackDays,
      downloadLimit: autoOn ? settings.downloadLimit : 0,
      parseLimit: settings.parseLimit,
    });
    const gaps = await fillCoverageGaps({
      companyLimit: 8,
      downloadLimit: 0,
    });
    return { feed, gaps, autoCrawlEnabled: autoOn, coverageMode: getGapScanState().mode };
  });
}

function maybeDiscover() {
  const intervalMs = ingestPollIntervalMs();
  if (Date.now() - lastDiscoverAt < intervalMs) return;
  lastDiscoverAt = Date.now();
  void discoverTick();
}

async function coverageBootstrapTick() {
  if (getGapScanState().mode === 'steady') return;
  await withLock('coverage-bootstrap', () => fillCoverageGaps({ companyLimit: 8, downloadLimit: 0 }));
}

async function backlogTick() {
  const control = await getIngestControl();
  const settings = getIngestSettings();
  const autoOn = control.autoCrawlEnabled;
  if (!autoOn) {
    setDownloadGate({ nextAt: null, pauseMs: settings.downloadPauseSec * 1000, mode: 'paused' });
    await withLock('backlog-parse-hold-download', () => processBacklog({ downloadLimit: 0, parseLimit: settings.parseLimit }));
    return;
  }
  await withLock('backlog', async () => {
    const processed = await processBacklog({ downloadLimit: settings.downloadLimit, parseLimit: settings.parseLimit });
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

function scheduleVerdict(delayMs: number) {
  if (verdictTimer) clearTimeout(verdictTimer);
  verdictTimer = setTimeout(() => void verdictTick(), Math.max(1_000, delayMs));
}

async function verdictTick() {
  if (verdictBusy) {
    scheduleVerdict(5_000);
    return;
  }
  verdictBusy = true;
  try {
    const delay = await tickVerdictQueue();
    scheduleVerdict(delay);
  } catch (error) {
    console.error('[worker] verdict-queue failed', error);
    await sendAlert('自动智析队列失败', { error: String(error) });
    scheduleVerdict(30_000);
  } finally {
    verdictBusy = false;
  }
}

async function shutdown(signal: string) {
  console.info(`[worker] received ${signal}, shutting down`);
  if (discoverTimer) clearInterval(discoverTimer);
  if (bootstrapTimer) clearInterval(bootstrapTimer);
  if (backlogTimer) clearInterval(backlogTimer);
  if (universeTimer) clearInterval(universeTimer);
  if (verdictTimer) clearTimeout(verdictTimer);
  await closeDb();
  process.exit(0);
}

async function main() {
  await ensureSchema();
  await bootstrapLiveData();
  // Drain existing discovered PDFs immediately, then full discover.
  await backlogTick();
  await discoverTick();
  lastDiscoverAt = Date.now();
  void ashareUniverseTick();
  backlogTimer = setInterval(() => void backlogTick(), backlogIntervalMs);
  discoverTimer = setInterval(() => maybeDiscover(), DISCOVER_WATCH_MS);
  bootstrapTimer = setInterval(() => void coverageBootstrapTick(), bootstrapGapMs);
  universeTimer = setInterval(() => { void ashareUniverseTick(); }, 30 * 60 * 1000);
  scheduleVerdict(5_000);
  const coverage = getGapScanState();
  const settings = getIngestSettings();
  const intervalMs = ingestPollIntervalMs(settings);
  console.info(
    `[worker] started; backlog every ${backlogIntervalMs}ms, discover every ${intervalMs}ms, coverage-bootstrap every ${bootstrapGapMs}ms (until steady); days=${settings.lookbackDays} downloadLimit=${settings.downloadLimit} parseLimit=${settings.parseLimit} pagePauseMs=${pagePauseMs} downloadPauseMs=${settings.downloadPauseSec * 1000} pollIntervalMin=${settings.pollIntervalMin} maxPages=${maxPages}; coverageMode=${coverage.mode}; ashare-universe daily after 01:00; auto-verdict queue on`,
  );
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
void main();
