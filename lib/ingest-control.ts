import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export type IngestControl = {
  autoCrawlEnabled: boolean;
};

const DEFAULT_CONTROL: IngestControl = { autoCrawlEnabled: true };

function controlPath() {
  return resolve(/* turbopackIgnore: true */ process.cwd(), 'data', 'ingest-control.json');
}

export async function getIngestControl(): Promise<IngestControl> {
  try {
    const raw = await readFile(controlPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<IngestControl>;
    return {
      autoCrawlEnabled: parsed.autoCrawlEnabled !== false,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_CONTROL };
    throw error;
  }
}

export async function setIngestControl(next: IngestControl): Promise<IngestControl> {
  const normalized: IngestControl = {
    autoCrawlEnabled: Boolean(next.autoCrawlEnabled),
  };
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
