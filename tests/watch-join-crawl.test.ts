import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  isPendingReportId,
  watchJoinCrawlOptions,
  watchJoinTriggerBody,
} from '../lib/watch-collect';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('join-monitor crawl uses full history so new companies are not limited to recent lookback days', () => {
  const options = watchJoinCrawlOptions();
  assert.equal(options.fullHistory, true);
  assert.ok(options.downloadLimit >= 1);
  assert.ok(options.parseLimit >= 1);
  const body = watchJoinTriggerBody('603019');
  assert.equal(body.mode, 'manual');
  assert.deepEqual(body.codes, ['603019']);
  assert.equal(body.fullHistory, true);
  assert.equal(isPendingReportId('pending:603019'), true);
  assert.equal(isPendingReportId('ann-1'), false);
});

test('watch API starts prioritizeCompanyCrawl after enabling the company', () => {
  const src = readFileSync(join(root, 'app/api/companies/watch/route.ts'), 'utf8');
  assert.match(src, /prioritizeCompanyCrawl\(\[code\], watchJoinCrawlOptions\(\)\)/);
  assert.match(src, /after\(async \(\) => \{/);
  assert.match(src, /crawlStarted: true/);
});

test('company detail empty state triggers collect and polls instead of sitting on 等待抓取', () => {
  const src = readFileSync(join(root, 'app/[code]/company-code-client.tsx'), 'utf8');
  assert.match(src, /watchJoinTriggerBody\(code\)/);
  assert.match(src, /WATCH_COLLECT_POLL_MS/);
  assert.match(src, /正在抓取并解析/);
  assert.doesNotMatch(src, /等待抓取(?![\s\S]*正在抓取并解析)/);
  // Placeholder title may still say 等待抓取 internally, but the visible empty state must be collecting.
  assert.match(src, /collecting && \(!report \|\| isPendingReportId\(report\.id\)\)/);
});

test('home immediate crawl opens the company page, not the ops sources page', () => {
  const src = readFileSync(join(root, 'app/report-home.tsx'), 'utf8');
  assert.match(src, /function triggerHomeCrawl/);
  const fn = src.slice(src.indexOf('async function triggerHomeCrawl'));
  const body = fn.slice(0, fn.indexOf('\n  async function reportCurrentSearchMissing'));
  assert.match(body, /watchJoinTriggerBody\(item\.code\)/);
  assert.match(body, /router\.push\(`\/\$\{item\.code\}`\)/);
  assert.doesNotMatch(body, /admin\/sources/);
  assert.match(src, /router\.push\(`\/\$\{company\.code\}`\)/);
});
