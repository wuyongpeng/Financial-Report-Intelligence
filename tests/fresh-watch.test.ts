import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { freshWatchWithinFiveMinutes } from '../lib/fresh-watch';

test('a full pass of the monitor pool plus one PDF stays inside five minutes', () => {
  assert.equal(freshWatchWithinFiveMinutes(64), true);
  assert.equal(freshWatchWithinFiveMinutes(80, 1_600, 90_000), true);
});

test('recent company lookup does not stretch a 3-day check into a 180-day history scan', () => {
  const source = readFileSync(new URL('../lib/sources.ts', import.meta.url), 'utf8');
  const recent = source.slice(source.indexOf('export async function fetchRecentReportsForCode'), source.indexOf('export async function fetchReportsForCode'));
  assert.match(recent, /fetchExchangeReportsInWindow/);
  assert.doesNotMatch(recent, /Math\.max\(days, 180\)/);
  const history = source.slice(source.indexOf('async function fetchExchangeReportsForCode'));
  assert.match(history, /Math\.max\(days, 180\)/);
});
