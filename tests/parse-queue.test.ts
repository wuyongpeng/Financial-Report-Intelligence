import assert from 'node:assert/strict';
import test from 'node:test';
import { compareParseQueue, formatParseElapsed, PARSE_PRIORITY_MANUAL } from '../lib/parse-queue';

test('manual parse jumps ahead of idle filings, failures go last', () => {
  const rows = [
    { parse_priority: 0, parse_error: null, published_at: '2026-08-01' },
    { parse_priority: PARSE_PRIORITY_MANUAL, parse_error: null, published_at: '2026-07-01' },
    { parse_priority: 0, parse_error: '解析超时（5分钟），已排到队尾', published_at: '2026-09-01' },
    { parse_priority: 0, parse_error: null, published_at: '2026-09-01' },
  ].sort(compareParseQueue);
  assert.equal(rows[0].parse_priority, PARSE_PRIORITY_MANUAL);
  assert.equal(rows[1].published_at, '2026-09-01');
  assert.equal(rows[1].parse_error, null);
  assert.equal(rows[2].published_at, '2026-08-01');
  assert.match(String(rows[3].parse_error), /队尾/);
});

test('formatParseElapsed uses Chinese minutes and seconds', () => {
  assert.equal(formatParseElapsed(0), '0秒');
  assert.equal(formatParseElapsed(9_000), '9秒');
  assert.equal(formatParseElapsed(60_000), '1分钟');
  assert.equal(formatParseElapsed(72_000), '1分12秒');
});
