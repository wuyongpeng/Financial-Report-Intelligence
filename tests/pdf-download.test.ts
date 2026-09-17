import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isPdfBytes,
  looksLikeBlockedPdf,
  pdfUrlCandidates,
  pickCninfoFallback,
  rewriteSsePdfUrl,
  ssePdfUrlFromPath,
} from '../lib/pdf-download';
import type { Announcement } from '../lib/types';

test('SSE bulletin paths are rewritten onto static.sse.com.cn', () => {
  assert.equal(
    ssePdfUrlFromPath('/disclosure/listedinfo/announcement/c/new/2026-08-21/601318_20260821_9DJ8.pdf'),
    'https://static.sse.com.cn/disclosure/listedinfo/announcement/c/new/2026-08-21/601318_20260821_9DJ8.pdf',
  );
  assert.equal(
    rewriteSsePdfUrl('https://www.sse.com.cn/disclosure/listedinfo/announcement/c/new/2026-08-21/601318_20260821_9DJ8.pdf'),
    'https://static.sse.com.cn/disclosure/listedinfo/announcement/c/new/2026-08-21/601318_20260821_9DJ8.pdf',
  );
  const urls = pdfUrlCandidates(
    'SSE',
    'https://www.sse.com.cn/disclosure/listedinfo/announcement/c/new/2026-08-21/601318_20260821_9DJ8.pdf',
  );
  assert.equal(urls[0], 'https://static.sse.com.cn/disclosure/listedinfo/announcement/c/new/2026-08-21/601318_20260821_9DJ8.pdf');
  assert.equal(urls[1], 'https://www.sse.com.cn/disclosure/listedinfo/announcement/c/new/2026-08-21/601318_20260821_9DJ8.pdf');
});

test('PDF magic and WAF HTML are distinguished', () => {
  assert.equal(isPdfBytes(new TextEncoder().encode('%PDF-1.7\n')), true);
  assert.equal(looksLikeBlockedPdf(new TextEncoder().encode('<html><script> var arg1=\'abc\';')), true);
  assert.equal(looksLikeBlockedPdf(new TextEncoder().encode('%PDF-1.4')), false);
});

test('CNINFO fallback matches 中期报告 to 半年度报告 of the same company', () => {
  const candidates: Announcement[] = [
    {
      source: 'CNINFO', sourceId: 'bank', code: '601318', name: '中国平安',
      title: '中国平安：平安银行股份有限公司2026年半年度报告',
      publishedAt: '2026-08-21T00:00:00.000Z',
      pdfUrl: 'https://static.cninfo.com.cn/bank.pdf', reportType: 'semiannual',
    },
    {
      source: 'CNINFO', sourceId: 'own', code: '601318', name: '中国平安',
      title: '中国平安2026年半年度报告',
      publishedAt: '2026-08-21T00:00:00.000Z',
      pdfUrl: 'https://static.cninfo.com.cn/own.pdf', reportType: 'semiannual',
    },
  ];
  const hit = pickCninfoFallback({
    code: '601318',
    title: '中国平安2026年中期报告',
    published_at: '2026-08-21T00:00:00.000Z',
  }, candidates);
  assert.equal(hit?.sourceId, 'own');
  assert.equal(hit?.pdfUrl, 'https://static.cninfo.com.cn/own.pdf');
});
