import { bootstrapLiveData, countManualParsePriority, fillCoverageGaps, processBacklog, runIngestion } from '../lib/ingest';
import { refreshAshareUniverse } from './refresh-ashare-universe';
import { closeDb } from '../lib/db';
import { ensureSchema } from '../lib/migrate';
import { sendAlert } from '../lib/alerts';
import { getIngestControl } from '../lib/ingest-control';
import { getGapScanState, setDownloadGate } from '../lib/ingest-progress';
import { getIngestSettings, ingestPollIntervalMs, llmTotalSlots } from '../lib/ingest-settings';
import { claimVerdictJobs, runVerdictJob } from '../lib/verdict-queue';

const DISCOVER_WATCH_MS = 15_000;
const bootstrapGapMs = Number(process.env.INGEST_BOOTSTRAP_GAP_MS ?? 90_000);
const backlogIntervalMs = Number(process.env.INGEST_BACKLOG_INTERVAL_MS ?? 45_000);
const MANUAL_PARSE_BOOST_MS = 8_000;
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
let verdictScheduling = false;
/** Jobs this process currently has in flight; size is capped by settings.verdictLimit. */
const verdictInflight = new Map<string, Promise<unknown>>();

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

function scheduleBacklog(delayMs = backlogIntervalMs) {
  if (backlogTimer) clearTimeout(backlogTimer);
  backlogTimer = setTimeout(() => void backlogTick(), Math.max(1_000, delayMs));
}

async function nextBacklogDelay() {
  try {
    if (await countManualParsePriority() > 0) return MANUAL_PARSE_BOOST_MS;
  } catch (error) {
    console.error('[worker] count manual parse priority failed', error);
  }
  return backlogIntervalMs;
}

async function backlogTick() {
  try {
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
  } catch (error) {
    console.error('[worker] backlog tick failed', error);
  } finally {
    scheduleBacklog(await nextBacklogDelay());
  }
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

/**
 * Concurrent 智析 scheduler.
 * Each tick tops the in-flight set back up to settings.verdictLimit, so a 中止 (or any finish)
 * immediately frees a slot and the head of 排队智析 moves in on the next short tick.
 */
async function verdictTick() {
  if (verdictScheduling) {
    scheduleVerdict(2_000);
    return;
  }
  verdictScheduling = true;
  try {
    const settings = getIngestSettings();
    const slots = llmTotalSlots(settings);
    const free = Math.max(0, settings.verdictLimit - verdictInflight.size);
    if (free <= 0) {
      scheduleVerdict(2_000);
      return;
    }
    const picked = await claimVerdictJobs(free, verdictInflight.keys());
    if (!picked.claims.length) {
      scheduleVerdict(verdictInflight.size ? 3_000 : picked.delay);
      return;
    }
    for (const claim of picked.claims) {
      const task = runVerdictJob(claim.job, { force: claim.force, slots })
        .catch(async (error) => {
          console.error('[worker] verdict job failed', error);
          await sendAlert('自动智析任务失败', { id: claim.job.id, error: String(error) });
          return null;
        })
        .finally(() => {
          verdictInflight.delete(claim.job.id);
          // A finished/aborted job frees a slot: refill promptly instead of idling.
          scheduleVerdict(1_000);
        });
      verdictInflight.set(claim.job.id, task);
    }
    // Keep filling remaining slots without waiting for the current batch to finish.
    scheduleVerdict(verdictInflight.size < settings.verdictLimit ? 1_000 : 3_000);
  } catch (error) {
    console.error('[worker] verdict-queue failed', error);
    await sendAlert('自动智析队列失败', { error: String(error) });
    scheduleVerdict(30_000);
  } finally {
    verdictScheduling = false;
  }
}

async function shutdown(signal: string) {
  console.info(`[worker] received ${signal}, shutting down`);
  if (discoverTimer) clearInterval(discoverTimer);
  if (bootstrapTimer) clearInterval(bootstrapTimer);
  if (backlogTimer) clearTimeout(backlogTimer);
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
  discoverTimer = setInterval(() => maybeDiscover(), DISCOVER_WATCH_MS);
  bootstrapTimer = setInterval(() => void coverageBootstrapTick(), bootstrapGapMs);
  universeTimer = setInterval(() => { void ashareUniverseTick(); }, 30 * 60 * 1000);
  scheduleVerdict(5_000);
  const coverage = getGapScanState();
  const settings = getIngestSettings();
  const intervalMs = ingestPollIntervalMs(settings);
  console.info(
    `[worker] started; backlog every ${backlogIntervalMs}ms, discover every ${intervalMs}ms, coverage-bootstrap every ${bootstrapGapMs}ms (until steady); days=${settings.lookbackDays} downloadLimit=${settings.downloadLimit} parseLimit=${settings.parseLimit} pagePauseMs=${pagePauseMs} downloadPauseMs=${settings.downloadPauseSec * 1000} pollIntervalMin=${settings.pollIntervalMin} maxPages=${maxPages}; coverageMode=${coverage.mode}; ashare-universe daily after 01:00; auto-verdict concurrency=${settings.verdictLimit} (+1 reserved chat slot)`,
  );
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
void main().catch((error) => {
  console.error('[worker] fatal startup', error);
  process.exit(1);
});
