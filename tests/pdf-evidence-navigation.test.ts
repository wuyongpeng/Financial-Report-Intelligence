import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { measurePdfPages, pdfJumpScrollTop, pdfQuoteIndex, resolvePdfQuotePage } from '../lib/pdf/evidence-navigation';

test('quote resolution checks requested, nearest neighbours, then distance two before selecting the final page', async () => {
  const visited: number[] = [];
  const page = await resolvePdfQuotePage(123, 268, '真实 引用原文', async p => {
    visited.push(p);
    return p === 121 ? '这里是真实引用原文' : '其他内容';
  });
  assert.equal(page, 121);
  assert.deepEqual(visited, [123, 122, 124, 121]);
});

test('requested page wins, failed pages and absent quotes fall back safely, boundaries are clamped', async () => {
  assert.equal(await resolvePdfQuotePage(2, 3, '引用原文', async () => '引用原文'), 2);
  assert.equal(await resolvePdfQuotePage(1, 3, '引用原文', async p => {
    if (p === 1) throw Error('bad page');
    return p === 2 ? '引用原文' : '';
  }), 2);
  assert.equal(await resolvePdfQuotePage(268, 268, '不存在的原文', async () => ''), 268);
  assert.equal(await resolvePdfQuotePage(999, 268, '', async () => { throw Error('must not read'); }), 268);
  assert.equal(await resolvePdfQuotePage(0, 268, '短', async () => { throw Error('must not read'); }), 1);
});

test('a new request never inherits a previous quote-corrected page', async () => {
  assert.equal(await resolvePdfQuotePage(123, 268, '引用原文', async p => p === 121 ? '引用原文' : ''), 121);
  assert.equal(await resolvePdfQuotePage(200, 268, '', async () => ''), 200);
  assert.equal(await resolvePdfQuotePage(123, 268, '引用原文', async p => p === 123 ? '引用原文' : ''), 123);
});

test('qualified cite cannot match inside 无保留意见 / 非无保留意见; literal search still can', async () => {
  assert.equal(pdfQuoteIndex('标准的无保留意见', '保留意见'), -1);
  assert.equal(pdfQuoteIndex('非无保留意见', '保留意见'), -1);
  assert.equal(pdfQuoteIndex('无保留意见，另有保留意见', '保留意见'), 8);
  assert.equal(pdfQuoteIndex('无保留意见', '保留意见', false), 1);
  assert.equal(await resolvePdfQuotePage(121, 268, '保留意见', async p => p === 121 ? '非无保留意见' : p === 120 ? '出具了保留意见' : ''), 120);
});

test('metadata measures all 268 pages, not just cover; mount/unmount uses identical CSS aspect ratios at any zoom', async () => {
  const called: number[] = [];
  const sizes = await measurePdfPages(268, async p => {
    called.push(p);
    return p === 1 ? { width: 900, height: 900 } : p === 120 ? { width: 842, height: 595 } : { width: 595, height: 842 };
  });
  assert.equal(new Set(called).size, 268);
  for (const width of [180, 400, 800]) {
    const before = sizes.slice(0, 120).reduce((y, s) => y + width * s.height / s.width + 34, 0);
    // Every placeholder and mounted stage reserves its metadata aspect; rendering
    // completion and zoomed canvas pixel sizes cannot alter the target's offset.
    const after = sizes.slice(0, 120).reduce((y, s) => y + width * (s.height * 2) / (s.width * 2) + 34, 0);
    assert.equal(before, after);
  }
  assert.notEqual(sizes[0].height / sizes[0].width, sizes[120].height / sizes[120].width);
});

test('damaged metadata retains a fixed fallback size', async () => {
  const sizes = await measurePdfPages(2, async p => {
    if (p === 1) throw Error('bad');
    return { width: 0, height: 0 };
  });
  assert.deepEqual(sizes, [{ width: 595, height: 842 }, { width: 595, height: 842 }]);
});

test('scroll offsets use final geometry and center highlight on first jump', () => {
  assert.equal(pdfJumpScrollTop(60000, 600, null), 59988);
  assert.equal(pdfJumpScrollTop(60000, 600, 500), 60308);
  assert.equal(pdfJumpScrollTop(10, 600, 0), 0);
});

test('viewer gates scrolling on final-page paint for current jump, not timer/shift or toolbar follow', () => {
  const viewer = readFileSync(new URL('../app/pdf-evidence.tsx', import.meta.url), 'utf8');
  assert.match(viewer, /slot\.paintKey !== paintKey/);
  assert.match(viewer, /pendingJump\.nonce !== jumpNonce/);
  assert.match(viewer, /behavior: 'auto'/);
  assert.doesNotMatch(viewer, /behavior: 'smooth'|scrollShiftRef|citeKey|}, 60\)/);
  assert.match(viewer, /renderTask\?\.cancel\(\)/);
  assert.match(viewer, /aspectRatio: `\$\{w} \/ \$\{h}`/);
  assert.match(viewer, /minHeight: 0/);
  const parent = readFileSync(new URL('../app/company-detail.tsx', import.meta.url), 'utf8');
  assert.match(parent, /onResolvePage=\{\(p\)=>\{ sourcePageRef\.current = p; setSourcePage\(p\);/);
});
