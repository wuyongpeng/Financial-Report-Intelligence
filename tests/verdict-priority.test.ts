import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { enqueuePriorityVerdict, takePriorityVerdict } from '../lib/verdict-priority';

test('priority verdict queue is FIFO for newest click', () => {
  process.env.RUNTIME_DIR = mkdtempSync(join(tmpdir(), 'verdict-priority-'));
  enqueuePriorityVerdict('a');
  enqueuePriorityVerdict('b');
  enqueuePriorityVerdict('a');
  assert.equal(takePriorityVerdict(), 'a');
  assert.equal(takePriorityVerdict(), 'b');
  assert.equal(takePriorityVerdict(), null);
});
