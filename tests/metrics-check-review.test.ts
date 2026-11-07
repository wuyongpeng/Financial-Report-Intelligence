import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildCheckCells, type ThirdPartyRow } from '../lib/metrics-check';
import { checkCellSnapshot, type CheckDbRow } from '../lib/metrics-check-server';
import { applyCheckReviews, summarizeCheckReviews, isPendingCheck, parseCheckReviewInput, findCheckReviewTarget, applyCheckProgress, summarizeCheckProgress, parseCheckProgressInput, type CheckProgress, type CheckReview } from '../lib/metrics-check-review';

const third: ThirdPartyRow = { code: '000001', period: '2026H1', revenueYi: 900, netProfitYi: 50, eps: 2, roe: 10 };
const row: CheckDbRow = { code: '000001', period: '2026H1', metric: 'revenue', value: 800, unit: '亿元', announcement_id: 'ann-1' };
function snapshot(tp = third, rows: CheckDbRow[] = [row]) {
  return buildCheckCells([tp], rows).cells.map(cell => checkCellSnapshot(cell, rows));
}
const cell = snapshot()[0];
const review = (status: CheckReview['status']): CheckReview => ({ code: cell.code, period: cell.period!, metric: cell.metric, fingerprint: cell.fingerprint, status });

test('approval removes pending count/filter, not original financial differences; flag reverses it', () => {
  assert.equal(cell.status, 'BAD');
  const before = applyCheckReviews([cell], []);
  assert.equal(summarizeCheckReviews(before).revenue.pending, 1);
  for (const status of ['approved', 'flagged', 'approved'] as const) {
    // Serializing the persisted record simulates a fresh reader, not local UI state.
    const persisted = JSON.parse(JSON.stringify([review(status)])) as CheckReview[];
    const [view] = applyCheckReviews([cell], persisted);
    assert.equal(view.reviewStatus, status);
    assert.equal(view.status, 'BAD');
    assert.equal(view.thirdParty, 900);
    assert.equal(view.dbConverted, 800);
    assert.equal(view.dbRaw, cell.dbRaw);
    assert.equal(isPendingCheck(view), status === 'flagged');
    assert.equal(summarizeCheckReviews([view]).revenue.pending, status === 'flagged' ? 1 : 0);
    assert.equal(summarizeCheckReviews([view]).revenue.approved, status === 'approved' ? 1 : 0);
  }
});

test('flagging an OK row enters pending; approving MISS clears only workflow status', () => {
  const ok = snapshot({ ...third, revenueYi: 800 })[0];
  const flag: CheckReview = { ...review('flagged'), fingerprint: ok.fingerprint };
  assert.equal(ok.status, 'OK');
  assert.equal(isPendingCheck(applyCheckReviews([ok], [flag])[0]), true);
  const miss = snapshot().find(cell => cell.metric === 'eps')!;
  const approved: CheckReview = { ...review('approved'), metric: miss.metric, fingerprint: miss.fingerprint };
  const result = applyCheckReviews([miss], [approved])[0];
  assert.equal(result.status, 'MISS');
  assert.equal(result.dbConverted, null);
  assert.equal(isPendingCheck(result), false);
  assert.equal(miss.announcementId, 'ann-1');
});

test('fresh data invalidates approval including changes below display rounding and provenance', () => {
  for (const changed of [
    snapshot(third, [{ ...row, value: 800.000001 }])[0],
    snapshot(third, [{ ...row, unit: '元' }])[0],
    snapshot(third, [{ ...row, announcement_id: 'ann-2' }])[0],
    snapshot({ ...third, revenueYi: 900.000001 })[0],
  ]) {
    assert.notEqual(changed.fingerprint, cell.fingerprint);
    const [view] = applyCheckReviews([changed], [review('approved')]);
    assert.equal(view.reviewStatus, null);
    assert.equal(view.reviewStale, true);
    assert.equal(isPendingCheck(view), true);
    assert.equal(findCheckReviewTarget([changed], review('approved')).ok, false);
  }
  assert.equal(applyCheckReviews([snapshot()[0]], [review('approved')])[0].reviewStatus, 'approved');
});

test('review keys isolate company, period and metric; removed results cannot be reviewed', () => {
  for (const changed of [{ ...cell, code: '000002' }, { ...cell, period: '2025FY' }, { ...cell, metric: 'eps' as const }]) {
    assert.equal(applyCheckReviews([changed], [review('approved')])[0].reviewStatus, null);
  }
  assert.deepEqual(findCheckReviewTarget([], review('approved')), { ok: false, status: 404, error: '核对结果不存在，请刷新' });
  assert.equal(findCheckReviewTarget([cell], review('approved')).ok, true);
});

test('Q3 fingerprint tracks exact H1 companion and aliases without invalidating on unrelated metrics', () => {
  const tp = { ...third, period: '2026Q3', revenueYi: 1500 };
  const q3 = { ...row, period: '2026Q3', value: 600 };
  const h1 = { ...row, value: 800 };
  const first = snapshot(tp, [q3, h1])[0];
  assert.equal(first.note, 'Q3单季已加H1折累计');
  assert.notEqual(snapshot(tp, [q3, { ...h1, value: 800.000001 }])[0].fingerprint, first.fingerprint);
  assert.notEqual(snapshot(tp, [q3, { ...h1, period: '2026Q2' }])[0].fingerprint, first.fingerprint);
  const unrelated = { ...row, metric: 'eps' as const, value: 20 };
  assert.equal(snapshot(tp, [q3, h1, unrelated])[0].fingerprint, first.fingerprint);
  assert.equal(snapshot(tp, [h1, q3])[0].fingerprint, first.fingerprint);
});

test('review payload whitelist rejects arbitrary state, forged snapshot and malformed keys', () => {
  assert.deepEqual(parseCheckReviewInput(review('approved')), review('approved'));
  for (const invalid of [null, [], { ...review('approved'), status: 'OK' }, { ...review('approved'), fingerprint: 'x' },
    { ...review('approved'), code: 'bad' }, { ...review('approved'), period: '../report' }, { ...review('approved'), metric: 'custom' }]) {
    assert.equal(parseCheckReviewInput(invalid), null);
  }
});

test('server persistence is independent and snapshot-validated; UI actions use existing single-report parse', () => {
  const route = readFileSync(new URL('../app/api/admin/check/route.ts', import.meta.url), 'utf8');
  const schema = readFileSync(new URL('../lib/backend-schema.ts', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../app/admin/check/check-client.tsx', import.meta.url), 'utf8');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS metrics_check_reviews/);
  assert.match(schema, /PRIMARY KEY \(code, period, metric\)/);
  assert.match(route, /findCheckReviewTarget\(snapshot.cells, input\)/);
  assert.match(route, /ON CONFLICT \(code, period, metric\) DO UPDATE SET fingerprint=EXCLUDED.fingerprint/);
  assert.match(route, /isolation level repeatable read/);
  assert.doesNotMatch(route, /metrics_overview|password|requireAdmin/);
  assert.match(client, /isPendingCheck\(cell\)/);
  const actions = client.slice(client.indexOf("display: 'inline-flex', alignItems: 'center', gap: 2"));
  assert.ok(actions.indexOf("reviewRow(cell, 'approved')") < actions.indexOf("reviewRow(cell, 'flagged')"));
  assert.ok(actions.indexOf("reviewRow(cell, 'flagged')") < actions.indexOf('parseRow(cell)'));
  assert.match(client, /fetch\('\/api\/crawl\/trigger'/);
  assert.match(client, /announcementIds: \[id\]/);
  assert.match(client, /if \(!id \|\| !lock\(`parse:\$\{id\}`\)\) return/);
  assert.match(client, /controller.abort\(\)/);
  assert.match(client, /state.parsed_at !== task.parsedAt/);
});


test('treatment progress and audit conclusions remain independent across close, approve, flag and reopen', () => {
  const progress = (status: CheckProgress['status']): CheckProgress => ({ ...review('approved'), status, note: '第三方统计口径，已核实', updatedAt: '2026-11-07T09:00:00Z' });
  for (const status of ['open', 'in_progress', 'resolved', 'open'] as const) {
    for (const audit of [[], [review('approved')], [review('flagged')]]) {
      const persisted = JSON.parse(JSON.stringify([progress(status)])) as CheckProgress[];
      const [view] = applyCheckProgress(applyCheckReviews([cell], audit), persisted);
      assert.equal(view.progressStatus, status);
      assert.equal(view.reviewStatus, audit[0]?.status ?? null);
      assert.equal(view.status, 'BAD');
      assert.equal(view.progressNote, '第三方统计口径，已核实');
      assert.equal(view.progressUpdatedAt, '2026-11-07T09:00:00Z');
      assert.equal(summarizeCheckProgress([view])[status], 1);
    }
  }
  const [resolved] = applyCheckProgress(applyCheckReviews([cell], []), [progress('resolved')]);
  assert.equal(isPendingCheck(resolved), true, 'handled does not silently mean approved');
});

test('substantive change reopens handled work and invalidates approval while preserving earlier note/time', () => {
  const persisted: CheckProgress = { ...review('approved'), status: 'resolved', note: '上轮按累计口径核对', updatedAt: '2026-11-07T09:00:00Z' };
  const changed = snapshot({ ...third, revenueYi: 950 })[0];
  const [view] = applyCheckProgress(applyCheckReviews([changed], [review('approved')]), [persisted]);
  assert.equal(view.reviewStatus, null);
  assert.equal(view.progressStatus, 'open');
  assert.equal(view.progressStale, true);
  assert.equal(view.progressNote, persisted.note);
  assert.equal(view.progressUpdatedAt, persisted.updatedAt);
  const [unchanged] = applyCheckProgress(applyCheckReviews([snapshot()[0]], [review('approved')]), [persisted]);
  assert.equal(unchanged.progressStatus, 'resolved', 'identical reparse never reopens');
  assert.equal(unchanged.progressStale, false);
  const [newItem] = applyCheckProgress(applyCheckReviews([cell], []), []);
  assert.equal(newItem.progressStatus, 'open');
  assert.equal(newItem.progressNote, '');
  assert.equal(newItem.progressUpdatedAt, null);
});

test('progress input validates action/state/short note; append-only events preserve history', () => {
  const body = { ...review('approved'), action: 'progress', status: 'in_progress', note: ' 核查中 ' };
  assert.equal(parseCheckProgressInput(body)?.note, '核查中');
  assert.equal(parseCheckReviewInput(body), null);
  for (const invalid of [{ ...body, status: 'approved' }, { ...body, note: 'a'.repeat(301) }, { ...body, action: 'delete' }, { ...body, note: null }]) {
    assert.equal(parseCheckProgressInput(invalid), null);
  }
  const route = readFileSync(new URL('../app/api/admin/check/route.ts', import.meta.url), 'utf8');
  const schema = readFileSync(new URL('../lib/backend-schema.ts', import.meta.url), 'utf8');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS metrics_check_progress/);
  assert.match(route, /INSERT INTO metrics_check_progress/);
  assert.doesNotMatch(route, /UPDATE metrics_check_progress|DELETE FROM metrics_check_progress/);
  assert.match(route, /FROM metrics_check_progress ORDER BY code, period, metric, updated_at DESC, id DESC/);
  const client = readFileSync(new URL('../app/admin/check/check-client.tsx', import.meta.url), 'utf8');
  assert.match(client, /progressFilter && cell.progressStatus !== progressFilter/);
  assert.match(client, /Asia\/Shanghai/);
  assert.ok(client.indexOf('>标记异常</button>') < client.indexOf('>已处理</button>'));
});

test('feedback admin hides browser column only and keeps feedback data API/storage unchanged', () => {
  const client = readFileSync(new URL('../app/admin/feedback/feedback-client.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(client, />浏览器<|title=\{item.user_agent/);
  assert.match(client, /colSpan=\{6\}/);
  assert.match(client, /\{item.message\}/);
  assert.match(client, /\{item.contact \|\| '—'\}/);
  const api = readFileSync(new URL('../app/api/admin/feedback/route.ts', import.meta.url), 'utf8');
  assert.match(api, /user_agent/);
});
