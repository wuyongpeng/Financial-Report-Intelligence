import assert from 'node:assert/strict';
import test from 'node:test';
import { BATCH_PARSE_QUEUE_CHUNK, buildBatchParseTriggerBodies } from '../lib/crawl-display';
import { sanitizeAnnouncementIds } from '../app/api/crawl/trigger/route';

test('buildBatchParseTriggerBodies uses queueOnly and never immediate', () => {
  const bodies = buildBatchParseTriggerBodies(['a', 'b', 'a', '']);
  assert.equal(bodies.length, 1);
  assert.deepEqual(bodies[0], {
    mode: 'parse',
    parseOnly: true,
    queueOnly: true,
    announcementIds: ['a', 'b'],
  });
  assert.equal('immediate' in bodies[0], false);
});

test('buildBatchParseTriggerBodies chunks at BATCH_PARSE_QUEUE_CHUNK', () => {
  const ids = Array.from({ length: BATCH_PARSE_QUEUE_CHUNK + 3 }, (_, i) => `id-${i}`);
  const bodies = buildBatchParseTriggerBodies(ids);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].announcementIds.length, BATCH_PARSE_QUEUE_CHUNK);
  assert.equal(bodies[1].announcementIds.length, 3);
  assert.ok(bodies.every((b) => b.queueOnly === true && b.parseOnly === true));
});

test('sanitizeAnnouncementIds respects queueOnly bulk limit vs immediate limit', () => {
  const many = Array.from({ length: 250 }, (_, i) => `ann-${i}`);
  assert.equal(sanitizeAnnouncementIds(many, 10).length, 10);
  assert.equal(sanitizeAnnouncementIds(many, 200).length, 200);
  assert.deepEqual(sanitizeAnnouncementIds(['  x  ', '', 1, null], 10), ['x']);
});
