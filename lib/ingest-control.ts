import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export type IngestControl = {
  /** Scan + auto-identify PDFs and start concurrent downloads */
  autoCrawlEnabled: boolean;
  /** Hold auto-started downloads (queue kept). Inverted pair of autoCrawlEnabled. */
  downloadPaused: boolean;
};

const DEFAULT_CONTROL: IngestControl = { autoCrawlEnabled: true, downloadPaused: false };

function controlPath() {
  return resolve(/* turbopackIgnore: true */ process.cwd(), 'data', 'ingest-control.json');
}

function normalize(autoCrawlEnabled: boolean, downloadPaused: boolean): IngestControl {
  const on = autoCrawlEnabled && !downloadPaused;
  return { autoCrawlEnabled: on, downloadPaused: !on };
}

export async function getIngestControl(): Promise<IngestControl> {
  try {
    const raw = await readFile(controlPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<IngestControl>;
    return normalize(parsed.autoCrawlEnabled !== false, parsed.downloadPaused === true);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_CONTROL };
    throw error;
  }
}

/** One switch: auto on ⇔ downloads run; auto off ⇔ hold queued downloads (scan continues). */
export async function setIngestControl(patch: Partial<IngestControl>): Promise<IngestControl> {
  const cur = await getIngestControl();
  let autoCrawlEnabled = cur.autoCrawlEnabled;
  let downloadPaused = cur.downloadPaused;

  if (typeof patch.downloadPaused === 'boolean') {
    downloadPaused = patch.downloadPaused;
    autoCrawlEnabled = !downloadPaused;
  }
  if (typeof patch.autoCrawlEnabled === 'boolean') {
    autoCrawlEnabled = patch.autoCrawlEnabled;
    downloadPaused = !autoCrawlEnabled;
  }

  const normalized = normalize(autoCrawlEnabled, downloadPaused);
  const target = controlPath();
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.part`;
  await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  await rename(temporary, target);
  return normalized;
}

export async function isAutoCrawlEnabled(): Promise<boolean> {
  const control = await getIngestControl();
  return control.autoCrawlEnabled;
}

export async function isDownloadPaused(): Promise<boolean> {
  const control = await getIngestControl();
  return control.downloadPaused;
}
