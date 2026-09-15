import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export type IngestControl = {
  /** Discover new announcements / fill gaps into 排队下载 */
  autoCrawlEnabled: boolean;
  /** Hard stop on PDF downloads (queue kept); also blocks adding new download tasks */
  downloadPaused: boolean;
};

const DEFAULT_CONTROL: IngestControl = { autoCrawlEnabled: true, downloadPaused: false };

function controlPath() {
  return resolve(/* turbopackIgnore: true */ process.cwd(), 'data', 'ingest-control.json');
}

export async function getIngestControl(): Promise<IngestControl> {
  try {
    const raw = await readFile(controlPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<IngestControl>;
    return {
      autoCrawlEnabled: parsed.autoCrawlEnabled !== false,
      downloadPaused: parsed.downloadPaused === true,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_CONTROL };
    throw error;
  }
}

/** Merge patch with linkage: pause→auto off; auto on→pause off. */
export async function setIngestControl(patch: Partial<IngestControl>): Promise<IngestControl> {
  const cur = await getIngestControl();
  let autoCrawlEnabled = cur.autoCrawlEnabled;
  let downloadPaused = cur.downloadPaused;

  if (typeof patch.downloadPaused === 'boolean') {
    downloadPaused = patch.downloadPaused;
    if (downloadPaused) autoCrawlEnabled = false;
  }
  if (typeof patch.autoCrawlEnabled === 'boolean') {
    autoCrawlEnabled = patch.autoCrawlEnabled;
    if (autoCrawlEnabled) downloadPaused = false;
  }

  const normalized: IngestControl = { autoCrawlEnabled, downloadPaused };
  const target = controlPath();
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.part`;
  await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  await rename(temporary, target);
  return normalized;
}

export async function isAutoCrawlEnabled(): Promise<boolean> {
  const control = await getIngestControl();
  return control.autoCrawlEnabled && !control.downloadPaused;
}

export async function isDownloadPaused(): Promise<boolean> {
  const control = await getIngestControl();
  return control.downloadPaused;
}
