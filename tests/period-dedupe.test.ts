import assert from 'node:assert/strict';
import test from 'node:test';
import { compareKeepOrder, duplicateIdsToSkip, reportKeepScore } from '../lib/period-dedupe';

test('A-share full report beats H-share stub of the same period', () => {
  const ashare = {
    id: 'a',
    code: '601398',
    title: '工商银行2026年第一季度报告',
    status: 'review',
    published_at: '2026-04-30',
    parsed_at: '2026-04-30',
    coreCount: 4,
  };
  const hshare = {
    id: 'h',
    code: '601398',
    title: '工商银行H股公告-2026年第一季度报告',
    status: 'parse_partial',
    published_at: '2026-04-30',
    parsed_at: '2026-04-30',
    coreCount: 1,
  };
  assert.ok(reportKeepScore(ashare) > reportKeepScore(hshare));
  assert.ok(compareKeepOrder(ashare, hshare) < 0);
  assert.deepEqual(duplicateIdsToSkip([hshare, ashare]), ['h']);
});

test('keeps the more complete filing when two A-share copies exist', () => {
  const complete = {
    id: 'cninfo',
    code: '601398',
    title: '工商银行2026半年度报告',
    status: 'review',
    published_at: '2026-08-29',
    parsed_at: '2026-08-29',
    coreCount: 4,
  };
  const partial = {
    id: 'sse',
    code: '601398',
    title: '工商银行2026半年度报告',
    status: 'parse_partial',
    published_at: '2026-08-29',
    parsed_at: '2026-08-29',
    coreCount: 2,
  };
  assert.deepEqual(duplicateIdsToSkip([partial, complete]), ['sse']);
});

test('does not skip a singleton period even if it is an H-share filing', () => {
  assert.deepEqual(duplicateIdsToSkip([{
    id: 'only',
    code: '601398',
    title: '工商银行H股公告-2025年第一季度报告',
    status: 'parse_partial',
    published_at: '2025-04-30',
    coreCount: 1,
  }]), []);
});
