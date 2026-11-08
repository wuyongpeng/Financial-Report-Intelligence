import assert from 'node:assert/strict';
import test from 'node:test';
import { feedbackFilingLink } from '../lib/feedback-page-link';

test('a company period in the page label links to that filing', () => {
  const link = feedbackFilingLink(
    '立讯精密 2025FY',
    'https://eva.nevis.sina.com.cn/002475?period=2025FY',
  );
  assert.ok(link);
  assert.equal(link.href, '/002475?period=2025FY');
  assert.equal('立讯精密 2025FY'.slice(link.start, link.end), '2025FY');
});

test('a Chinese period label still opens the canonical filing', () => {
  const link = feedbackFilingLink('贵州茅台 2025年报', 'https://eva.example/600519');
  assert.ok(link);
  assert.equal(link.href, '/600519?period=2025FY');
  assert.equal('贵州茅台 2025年报'.slice(link.start, link.end), '2025年报');
});

test('homepage and company-only labels are not links', () => {
  assert.equal(feedbackFilingLink('/', 'https://eva.example/'), null);
  assert.equal(feedbackFilingLink('立讯精密', 'https://eva.example/002475'), null);
  assert.equal(feedbackFilingLink('立讯精密 2025FY', null), null);
});
