import assert from 'node:assert/strict';
import test from 'node:test';
import { readRequestMeta } from '@/lib/request-meta';

test('readRequestMeta prefers first x-forwarded-for hop', () => {
  const meta = readRequestMeta(new Request('http://localhost/api/audit', {
    headers: {
      'x-forwarded-for': '1.2.3.4, 10.0.0.1',
      'user-agent': 'Mozilla/5.0 Test',
      'accept-language': 'zh-CN,zh;q=0.9',
      referer: 'http://localhost/600519',
    },
  }));
  assert.equal(meta.ip, '1.2.3.4');
  assert.equal(meta.userAgent, 'Mozilla/5.0 Test');
  assert.equal(meta.acceptLanguage, 'zh-CN,zh;q=0.9');
  assert.equal(meta.referer, 'http://localhost/600519');
});

test('readRequestMeta falls back to x-real-ip', () => {
  const meta = readRequestMeta(new Request('http://localhost/x', {
    headers: { 'x-real-ip': '8.8.8.8' },
  }));
  assert.equal(meta.ip, '8.8.8.8');
});
