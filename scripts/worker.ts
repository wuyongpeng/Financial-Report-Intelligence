import { bootstrapLiveData, runIngestion } from '../lib/ingest';
import { closeDb } from '../lib/db';

const intervalMs = Number(process.env.INGEST_INTERVAL_MS ?? 600_000);
const days = Number(process.env.INGEST_DAYS ?? 2);
const downloadLimit = Number(process.env.INGEST_DOWNLOAD_LIMIT ?? 5);
const parseLimit = Number(process.env.INGEST_PARSE_LIMIT ?? 3);
let running = false;
let timer: NodeJS.Timeout | undefined;

async function tick() {
  if (running) return;
  running = true;
  try {
    const result = await runIngestion({ days, downloadLimit, parseLimit });
    console.info('[worker] ingestion finished', result);
  } catch (error) {
    console.error('[worker] ingestion failed', error);
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
  await bootstrapLiveData();
  await tick();
  timer = setInterval(() => void tick(), intervalMs);
  console.info(`[worker] started; interval=${intervalMs}ms, days=${days}`);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
void main();
