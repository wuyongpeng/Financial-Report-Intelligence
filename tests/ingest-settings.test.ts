import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_INGEST_SETTINGS, ingestPollIntervalMs, normalizeIngestSettings } from '../lib/ingest-settings';

test('product defaults match the documented gentle ingest limits', () => {
  assert.equal(DEFAULT_INGEST_SETTINGS.downloadLimit, 2);
  assert.equal(DEFAULT_INGEST_SETTINGS.parseLimit, 1);
  assert.equal(DEFAULT_INGEST_SETTINGS.downloadPauseSec, 20);
});

test('normalizeIngestSettings treats missing or blank fields as product defaults', () => {
  assert.deepEqual(normalizeIngestSettings({ downloadPauseSec: undefined as unknown as number }), DEFAULT_INGEST_SETTINGS);
  assert.deepEqual(normalizeIngestSettings({ downloadPauseSec: '' as unknown as number }), DEFAULT_INGEST_SETTINGS);
});

test('normalizeIngestSettings clamps each field to the documented range', () => {
  assert.equal(normalizeIngestSettings({ downloadPauseSec: 0 }).downloadPauseSec, 1);
  assert.equal(normalizeIngestSettings({ downloadPauseSec: 20000 }).downloadPauseSec, 9999);
  assert.equal(normalizeIngestSettings({ downloadLimit: 0 }).downloadLimit, 1);
  assert.equal(normalizeIngestSettings({ downloadLimit: 120 }).downloadLimit, 99);
  assert.equal(normalizeIngestSettings({ parseLimit: 0 }).parseLimit, 1);
  assert.equal(normalizeIngestSettings({ parseLimit: 20 }).parseLimit, 9);
  assert.equal(normalizeIngestSettings({ lookbackDays: 0 }).lookbackDays, 1);
  assert.equal(normalizeIngestSettings({ lookbackDays: 200 }).lookbackDays, 99);
  assert.equal(normalizeIngestSettings({ pollIntervalMin: 0 }).pollIntervalMin, 1);
  assert.equal(normalizeIngestSettings({ pollIntervalMin: 90 }).pollIntervalMin, 60);
});

test('normalizeIngestSettings keeps in-range values and rounds', () => {
  const next = normalizeIngestSettings({
    downloadPauseSec: 20.4,
    downloadLimit: 5.6,
    parseLimit: 2,
    lookbackDays: 2,
    pollIntervalMin: 2,
  });
  assert.deepEqual(next, {
    downloadPauseSec: 20,
    downloadLimit: 6,
    parseLimit: 2,
    lookbackDays: 2,
    pollIntervalMin: 2,
  });
});

test('ingestPollIntervalMs converts minutes to milliseconds', () => {
  assert.equal(ingestPollIntervalMs({ ...DEFAULT_INGEST_SETTINGS, pollIntervalMin: 2 }), 120_000);
  assert.equal(ingestPollIntervalMs({ ...DEFAULT_INGEST_SETTINGS, pollIntervalMin: 1 }), 60_000);
  assert.equal(ingestPollIntervalMs({ ...DEFAULT_INGEST_SETTINGS, pollIntervalMin: 60 }), 3_600_000);
});
