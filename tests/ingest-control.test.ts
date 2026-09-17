import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { getIngestControl, setIngestControl } from '../lib/ingest-control';

async function withRuntime(fn: () => Promise<void>) {
  const prev = process.env.RUNTIME_DIR;
  process.env.RUNTIME_DIR = mkdtempSync(join(tmpdir(), 'ingest-control-'));
  try {
    await fn();
  } finally {
    if (prev === undefined) delete process.env.RUNTIME_DIR;
    else process.env.RUNTIME_DIR = prev;
  }
}

test('missing control file defaults auto crawl and auto verdict on', async () => {
  await withRuntime(async () => {
    const control = await getIngestControl();
    assert.equal(control.autoCrawlEnabled, true);
    assert.equal(control.autoVerdictEnabled, true);
    assert.equal(control.downloadPaused, false);
  });
});

test('auto verdict toggle does not pause downloads', async () => {
  await withRuntime(async () => {
    const off = await setIngestControl({ autoVerdictEnabled: false });
    assert.equal(off.autoVerdictEnabled, false);
    assert.equal(off.autoCrawlEnabled, true);
    const on = await setIngestControl({ autoCrawlEnabled: false });
    assert.equal(on.autoCrawlEnabled, false);
    assert.equal(on.autoVerdictEnabled, false);
  });
});
