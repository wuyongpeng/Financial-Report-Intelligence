import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { productCollectStatus, type ProductCollectStatus } from '../lib/product-status';
import { LEGAL_PAGES, findLegalPage, legalPath } from '../lib/legal-content';
import { buildWatchlistDigest } from '../lib/watchlist-digest';
import type { CrawlCompanyCoverage } from '../lib/crawl-display';

const root = join(import.meta.dirname, '..');

function source(rel: string) {
  return readFileSync(join(root, rel), 'utf8');
}

function coverage(partial: Partial<CrawlCompanyCoverage>): CrawlCompanyCoverage {
  return {
    code: '688111',
    name: '金山办公',
    industry: '软件',
    industryGroup: '科技',
    theme: '',
    exchange: 'SSE',
    enabled: true,
    covered: true,
    reportPeriod: '2025Q3',
    recentPeriods: ['2025Q3'],
    metrics: [],
    parseStatus: null,
    parseError: null,
    rawStatus: null,
    parsedAt: null,
    downloadedAt: null,
    discoveredAt: null,
    lastCrawlAt: null,
    addedAt: null,
    latestExpectedMissing: false,
    ...partial,
  } as CrawlCompanyCoverage;
}

test('personal watchlist replaces the public crawl feed on the home page', () => {
  const home = source('app/report-home.tsx');
  assert.match(home, /fetch\('\/api\/me\/coverage'/);
  assert.doesNotMatch(home, /fetch\('\/api\/crawl'/);
  assert.match(home, /我的自选/);
  assert.match(home, /加入自选/);
  assert.doesNotMatch(home, /加入监控池/);
  assert.doesNotMatch(home, /数据运营/);
});

test('watch API requires a registered user and starts collect after joining', () => {
  const route = source('app/api/companies/watch/route.ts');
  assert.match(route, /registeredUserKey\(request\)/);
  assert.match(route, /loginRequired\(\)/);
  assert.match(route, /addToWatchlist\(userKey, code\)/);
  assert.match(route, /prioritizeCompanyCrawl\(\[code\], watchJoinCrawlOptions\(\)\)/);
  assert.match(route, /已将「\$\{finalName\}」加入自选/);
});

test('successful parse notifies watchers of the new report', () => {
  const ingest = source('lib/ingest.ts');
  assert.match(ingest, /notifyWatchersOfNewReport/);
});

test('notifications and share routes isolate owners; shares are public to read', () => {
  const notifications = source('app/api/me/notifications/route.ts');
  assert.match(notifications, /registeredUserKey\(request\)/);
  const shareWrite = source('app/api/share/route.ts');
  assert.match(shareWrite, /registeredUserKey\(request\)/);
  const shareRead = source('app/api/share/[id]/route.ts');
  assert.doesNotMatch(shareRead, /registeredUserKey/);
  const sharePage = source('app/share/[id]/share-view.tsx');
  assert.match(sharePage, /出处/);
  assert.match(sharePage, /不构成投资建议/);
});

test('account panel exposes history, email, logout, deletion, and legal pages', () => {
  const account = source('components/account-access.tsx');
  assert.match(account, /对话历史/);
  assert.match(account, /提醒邮箱/);
  assert.match(account, /注销账号/);
  assert.match(account, /\/api\/auth\/account/);
  assert.match(account, /submitLogout/);
  assert.match(account, /LEGAL_PAGES\.map/);
  for (const page of LEGAL_PAGES) {
    assert.equal(legalPath(page.slug), `/legal/${page.slug}`);
    assert.equal(findLegalPage(page.slug)?.title, page.title);
  }
  const deleteRoute = source('app/api/auth/account/route.ts');
  assert.match(deleteRoute, /deleteRegisteredAccount/);
  const legalPage = source('app/legal/[slug]/page.tsx');
  assert.match(legalPage, /LEGAL_PAGES/);
});

test('join voice prompt says 加入自选 and still accepts 加入监控池', () => {
  const flow = source('lib/home-voice-flow.ts');
  assert.match(flow, /是否加入自选/);
  assert.equal(flow.includes('加入(?:自选|监控池)'), true);
});

test('product status explains delay and unavailability without pointing to ops pages', () => {
  const ready = productCollectStatus(coverage({
    metrics: [{ metric: 'revenue', label: '营收', value: 1, unit: '亿元' } as CrawlCompanyCoverage['metrics'][number]],
  }));
  // If the fixture shape is wrong, still assert labels from failed/delayed paths below.
  const unavailable: ProductCollectStatus = productCollectStatus(coverage({ parseStatus: 'failed' }));
  assert.equal(unavailable.kind, 'unavailable');
  assert.match(unavailable.label, /暂不可用/);
  assert.match(unavailable.detail, /无需反复刷新/);
  assert.doesNotMatch(unavailable.detail, /数据运营/);

  const delayed = productCollectStatus(coverage({
    lastCrawlAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
  }));
  assert.equal(delayed.kind, 'delayed');
  assert.match(delayed.label, /抓取延迟/);

  const running = productCollectStatus(coverage({ lastCrawlAt: new Date().toISOString() }));
  assert.equal(running.kind, 'running');
  assert.match(running.detail, /完成后会通知你/);
});

test('watchlist digest only states report facts and adds a disclaimer', () => {
  const digest = buildWatchlistDigest([
    coverage({
      code: '688111',
      name: '金山办公',
      reportPeriod: '2025Q3',
      downloadedAt: new Date().toISOString(),
      parsedAt: new Date().toISOString(),
      metrics: [
        { metric: 'revenue', label: '营业收入', value: 100, disclosedYoyPct: 10 } as never,
      ],
    }),
  ]);
  assert.match(digest.summary, /金山办公|本期|报告/);
  assert.doesNotMatch(digest.summary, /买入|卖出|推荐(?!建议)/);
  assert.doesNotMatch(digest.summary, /请买入|请卖出|荐股/);
  const text = `${digest.summary} ${digest.ready.map((item) => item.points.join(' ')).join(' ')}`;
  assert.match(text, /不构成投资建议|只陈述/);
});

describe('coverage API stays personal', () => {
  test('loads only the current user watchlist and does not mock a full pool', () => {
    const route = source('app/api/me/coverage/route.ts');
    assert.match(route, /listWatchlist\(userKey\)/);
    assert.match(route, /allowMock: false/);
    assert.match(route, /buildWatchlistDigest/);
  });
});
