import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type IngestSettings = {
  /** Seconds between queued PDF downloads. */
  downloadPauseSec: number;
  downloadLimit: number;
  parseLimit: number;
  /** Incremental announcement lookback after coverage is ready. */
  lookbackDays: number;
  /** Minutes between announcement / gap discovery ticks. */
  pollIntervalMin: number;
  /**
   * Concurrent 自动智析 jobs. 问答 always keeps its own dedicated LLM slot on top of this,
   * so raising it never blocks chat. Keep ≤3 so a single provider is not rate limited.
   */
  verdictLimit: number;
};

export const INGEST_SETTING_BOUNDS = {
  downloadPauseSec: { min: 1, max: 9999, fallback: 20 },
  downloadLimit: { min: 1, max: 99, fallback: 2 },
  parseLimit: { min: 1, max: 9, fallback: 1 },
  lookbackDays: { min: 1, max: 99, fallback: 2 },
  pollIntervalMin: { min: 1, max: 60, fallback: 2 },
  verdictLimit: { min: 1, max: 3, fallback: 3 },
} as const;

export const DEFAULT_INGEST_SETTINGS: IngestSettings = {
  downloadPauseSec: INGEST_SETTING_BOUNDS.downloadPauseSec.fallback,
  downloadLimit: INGEST_SETTING_BOUNDS.downloadLimit.fallback,
  parseLimit: INGEST_SETTING_BOUNDS.parseLimit.fallback,
  lookbackDays: INGEST_SETTING_BOUNDS.lookbackDays.fallback,
  pollIntervalMin: INGEST_SETTING_BOUNDS.pollIntervalMin.fallback,
  verdictLimit: INGEST_SETTING_BOUNDS.verdictLimit.fallback,
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function normalizeIngestSettings(raw: Partial<IngestSettings> | null | undefined): IngestSettings {
  return {
    downloadPauseSec: clampInt(raw?.downloadPauseSec, INGEST_SETTING_BOUNDS.downloadPauseSec.min, INGEST_SETTING_BOUNDS.downloadPauseSec.max, INGEST_SETTING_BOUNDS.downloadPauseSec.fallback),
    downloadLimit: clampInt(raw?.downloadLimit, INGEST_SETTING_BOUNDS.downloadLimit.min, INGEST_SETTING_BOUNDS.downloadLimit.max, INGEST_SETTING_BOUNDS.downloadLimit.fallback),
    parseLimit: clampInt(raw?.parseLimit, INGEST_SETTING_BOUNDS.parseLimit.min, INGEST_SETTING_BOUNDS.parseLimit.max, INGEST_SETTING_BOUNDS.parseLimit.fallback),
    lookbackDays: clampInt(raw?.lookbackDays, INGEST_SETTING_BOUNDS.lookbackDays.min, INGEST_SETTING_BOUNDS.lookbackDays.max, INGEST_SETTING_BOUNDS.lookbackDays.fallback),
    pollIntervalMin: clampInt(raw?.pollIntervalMin, INGEST_SETTING_BOUNDS.pollIntervalMin.min, INGEST_SETTING_BOUNDS.pollIntervalMin.max, INGEST_SETTING_BOUNDS.pollIntervalMin.fallback),
    verdictLimit: clampInt(raw?.verdictLimit, INGEST_SETTING_BOUNDS.verdictLimit.min, INGEST_SETTING_BOUNDS.verdictLimit.max, INGEST_SETTING_BOUNDS.verdictLimit.fallback),
  };
}

function settingsPath() {
  return resolve(process.env.RUNTIME_DIR ?? resolve(/* turbopackIgnore: true */ process.cwd(), '.data'), 'ingest-settings.json');
}

function envSeed(): Partial<IngestSettings> {
  const pauseMs = Number(process.env.DOWNLOAD_PAUSE_MS);
  const downloadLimit = Number(process.env.INGEST_DOWNLOAD_LIMIT);
  const parseLimit = Number(process.env.INGEST_PARSE_LIMIT);
  const lookbackDays = Number(process.env.INGEST_DAYS);
  const verdictLimit = Number(process.env.VERDICT_CONCURRENCY);
  return {
    ...(Number.isFinite(pauseMs) && pauseMs > 0 ? { downloadPauseSec: Math.round(pauseMs / 1000) } : {}),
    ...(Number.isFinite(downloadLimit) ? { downloadLimit } : {}),
    ...(Number.isFinite(parseLimit) ? { parseLimit } : {}),
    ...(Number.isFinite(lookbackDays) ? { lookbackDays } : {}),
    ...(Number.isFinite(verdictLimit) ? { verdictLimit } : {}),
  };
}

/** Total LLM slots = 智析 concurrency + 1 reserved interactive slot for 问答. */
export function llmTotalSlots(settings: IngestSettings = getIngestSettings()) {
  return settings.verdictLimit + 1;
}

export function ingestPollIntervalMs(settings: IngestSettings = getIngestSettings()) {
  return settings.pollIntervalMin * 60_000;
}

export function getIngestSettings(): IngestSettings {
  try {
    const parsed = JSON.parse(readFileSync(settingsPath(), 'utf8')) as Partial<IngestSettings>;
    return normalizeIngestSettings({ ...envSeed(), ...parsed });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return normalizeIngestSettings(envSeed());
    }
    throw error;
  }
}

export function setIngestSettings(patch: Partial<IngestSettings>): IngestSettings {
  const next = normalizeIngestSettings({ ...getIngestSettings(), ...patch });
  const target = settingsPath();
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.part`;
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  renameSync(temporary, target);
  return next;
}
