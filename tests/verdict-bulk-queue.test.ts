import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  VERDICT_BULK_CAP,
  countBulkVerdicts,
  enqueueBulkVerdicts,
  listBulkVerdicts,
  requeueBulkVerdictsFront,
  takeBulkVerdicts,
} from '../lib/verdict-bulk-queue';

function freshRuntime() {
  process.env.RUNTIME_DIR = mkdtempSync(join(tmpdir(), 'verdict-bulk-'));
}

test('bulk verdict queue is FIFO and preserves force', () => {
  freshRuntime();
  enqueueBulkVerdicts([{ id: 'a' }, { id: 'b', force: true }, { id: 'c' }]);
  assert.equal(countBulkVerdicts(), 3);
  assert.deepEqual(takeBulkVerdicts(1), [{ id: 'a', force: false }]);
  assert.deepEqual(takeBulkVerdicts(2), [
    { id: 'b', force: true },
    { id: 'c', force: false },
  ]);
  assert.equal(takeBulkVerdicts(1).length, 0);
});

test('re-enqueue dedupes and keeps force sticky', () => {
  freshRuntime();
  enqueueBulkVerdicts([{ id: 'a' }, { id: 'b' }]);
  enqueueBulkVerdicts([{ id: 'a', force: true }, { id: 'c' }]);
  assert.deepEqual(takeBulkVerdicts(10), [
    { id: 'b', force: false },
    { id: 'a', force: true },
    { id: 'c', force: false },
  ]);
});

test('cap drops oldest when over VERDICT_BULK_CAP', () => {
  freshRuntime();
  const items = Array.from({ length: VERDICT_BULK_CAP + 5 }, (_, i) => ({ id: `id-${i}` }));
  enqueueBulkVerdicts(items);
  assert.equal(countBulkVerdicts(), VERDICT_BULK_CAP);
  assert.equal(takeBulkVerdicts(1)[0]?.id, 'id-0');
});

test('requeueBulkVerdictsFront puts busy items back ahead of the rest', () => {
  freshRuntime();
  enqueueBulkVerdicts([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  const [first] = takeBulkVerdicts(1);
  assert.equal(first.id, 'a');
  requeueBulkVerdictsFront([{ id: 'a', force: true }]);
  assert.deepEqual(takeBulkVerdicts(2), [
    { id: 'a', force: true },
    { id: 'b', force: false },
  ]);
});

test('listBulkVerdicts is read-only and does not take', () => {
  freshRuntime();
  enqueueBulkVerdicts([{ id: 'a' }, { id: 'b', force: true }]);
  assert.deepEqual(listBulkVerdicts(), [
    { id: 'a', force: false },
    { id: 'b', force: true },
  ]);
  assert.equal(countBulkVerdicts(), 2);
  assert.deepEqual(listBulkVerdicts(), listBulkVerdicts());
});
