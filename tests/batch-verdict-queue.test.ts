import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BATCH_VERDICT_QUEUE_CHUNK,
  buildBatchVerdictEnqueueBodies,
  resolveVerdictQueuedBadge,
} from '../lib/crawl-display';
import { queuedVerdictReadySkip } from '../lib/report-verdict-store';

test('buildBatchVerdictEnqueueBodies dedupes and keeps refresh', () => {
  const bodies = buildBatchVerdictEnqueueBodies([
    { id: 'a' },
    { id: 'b', refresh: true },
    { id: 'a', refresh: true },
    { id: '' },
    { id: '  c  ' },
  ]);
  assert.equal(bodies.length, 1);
  assert.deepEqual(bodies[0], {
    action: 'enqueue',
    items: [
      { id: 'a', refresh: true },
      { id: 'b', refresh: true },
      { id: 'c', refresh: false },
    ],
  });
});

test('buildBatchVerdictEnqueueBodies chunks at BATCH_VERDICT_QUEUE_CHUNK', () => {
  const items = Array.from({ length: BATCH_VERDICT_QUEUE_CHUNK + 3 }, (_, i) => ({
    id: `id-${i}`,
    refresh: i % 2 === 0,
  }));
  const bodies = buildBatchVerdictEnqueueBodies(items);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].items.length, BATCH_VERDICT_QUEUE_CHUNK);
  assert.equal(bodies[1].items.length, 3);
  assert.ok(bodies.every((b) => b.action === 'enqueue'));
});

test('queuedVerdictReadySkip only skips ready without force', () => {
  assert.equal(queuedVerdictReadySkip('ready', false), true);
  assert.equal(queuedVerdictReadySkip('ready', undefined), true);
  assert.equal(queuedVerdictReadySkip('ready', true), false);
  assert.equal(queuedVerdictReadySkip('pending', false), false);
  assert.equal(queuedVerdictReadySkip('pending', true), false);
  assert.equal(queuedVerdictReadySkip(null, false), false);
});

test('resolveVerdictQueuedBadge reflects bulk enqueue, not just needing − used', () => {
  assert.equal(resolveVerdictQueuedBadge({
    pending: 6, used: 1, bulkPending: 5, queuedItemCount: 5,
  }), 5);
  assert.equal(resolveVerdictQueuedBadge({
    pending: 2, used: 1, bulkPending: 5, queuedItemCount: 0,
  }), 5);
  assert.equal(resolveVerdictQueuedBadge({
    pending: 1, used: 1, bulkPending: 0, queuedItemCount: 0,
  }), 0);
  assert.equal(resolveVerdictQueuedBadge({
    pending: 10, used: 2, bulkPending: 0, queuedItemCount: 3,
  }), 8);
});
