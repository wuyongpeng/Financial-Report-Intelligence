import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  parseReviewReason,
  summarizeReviewLog,
  normalizeReviewIssues,
  isParseErrorReason,
} from '../lib/metrics-review-log';

test('review reason is optional and rejects unknown values', () => {
  assert.equal(parseReviewReason(undefined), null);
  assert.equal(parseReviewReason(null), null);
  assert.equal(parseReviewReason(''), null);
  assert.equal(parseReviewReason('  real_disclosure  '), 'real_disclosure');
  assert.equal(parseReviewReason('同比离谱'), 'invalid');
  assert.equal(parseReviewReason(1), 'invalid');
});

test('ack counts are clicks, split into real disclosure and three parse errors', () => {
  const summary = summarizeReviewLog([
    { action: 'acked', reason: 'real_disclosure' },
    { action: 'acked', reason: 'real_disclosure' },
    { action: 'acked', reason: 'parse_value' },
    { action: 'acked', reason: 'parse_page_unit' },
    { action: 'acked', reason: 'parse_period' },
    { action: 'acked', reason: null },
    { action: 'flagged', reason: null },
  ]);
  assert.equal(summary.ackCount, 6);
  assert.equal(summary.realDisclosure, 2);
  assert.equal(summary.parseError, 3);
  assert.equal(summary.parseValue, 1);
  assert.equal(summary.parsePageUnit, 1);
  assert.equal(summary.parsePeriod, 1);
  assert.equal(summary.unstated, 1);
  assert.equal(summary.flagCount, 1);
  assert.equal(isParseErrorReason('parse_value'), true);
  assert.equal(isParseErrorReason('real_disclosure'), false);
  assert.equal(isParseErrorReason(null), false);
});

test('stored issue snapshot keeps only known rule hits', () => {
  assert.deepEqual(
    normalizeReviewIssues(['absurd_yoy', 'no_page', 'absurd_yoy', 'made_up', 1]),
    ['absurd_yoy', 'no_page'],
  );
  assert.deepEqual(normalizeReviewIssues(null), []);
});

test('metrics review routes append events and do not rewrite the log', () => {
  const ack = readFileSync(new URL('../app/api/admin/metrics/ack/route.ts', import.meta.url), 'utf8');
  const flag = readFileSync(new URL('../app/api/admin/metrics/flag/route.ts', import.meta.url), 'utf8');
  const record = readFileSync(new URL('../lib/metrics-review-record.ts', import.meta.url), 'utf8');
  const schema = readFileSync(new URL('../lib/backend-schema.ts', import.meta.url), 'utf8');
  assert.match(ack, /writeOverviewReview/);
  assert.match(ack, /parseReviewReason/);
  assert.match(flag, /action: 'flagged'/);
  assert.match(record, /INSERT INTO metrics_overview_review_events/);
  assert.doesNotMatch(record, /UPDATE metrics_overview_review_events|DELETE FROM metrics_overview_review_events/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS metrics_overview_review_events/);
});
