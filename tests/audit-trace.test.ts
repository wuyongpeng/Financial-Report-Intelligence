import assert from 'node:assert/strict';
import test from 'node:test';
import { auditTraceRows, auditTraceText, formatAuditDuration } from '../lib/audit-trace';
import { formatTokenUsage, parseModelUsage } from '../lib/model-usage';

const sample = {
  eventType: 'ask',
  eventLabel: '提问',
  createdAt: '2026/11/8 17:40:00',
  company: '002475 · 2025FY',
  ip: '1.2.3.4',
  ownerKey: 'guest-1',
  path: '/api/chat',
  referer: 'https://eva.example/002475',
  userAgent: 'Mozilla',
  acceptLanguage: 'zh-CN',
  reportId: 'report-1',
  conversationId: 'conv-1',
  requestId: 'trace-1',
  prompt: '立讯精密ROE是多少',
  reply: 'ROE 为 18%。',
  detail: {
    usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
    errorStack: 'Error: boom\n    at chat',
    period: '2025FY',
  },
  durationMs: 1800,
};

test('audit detail table keeps the full prompt, reply, tokens, duration, and stack', () => {
  const rows = Object.fromEntries(auditTraceRows(sample).map((row) => [row.label, row.value]));
  assert.equal(rows['Trace ID'], 'trace-1');
  assert.equal(rows['用户 Prompt'], '立讯精密ROE是多少');
  assert.equal(rows['AI 回复'], 'ROE 为 18%。');
  assert.equal(rows['消耗 Token'], '输入 120 · 输出 40 · 合计 160');
  assert.equal(rows['耗时'], '1.8 秒');
  assert.match(rows['报错 Stack Trace'], /boom/);
  assert.equal(rows['其它'], undefined);
});

test('copy text is one block a bug report can paste', () => {
  const text = auditTraceText(sample);
  assert.match(text, /Trace ID: trace-1/);
  assert.match(text, /IP: 1\.2\.3\.4/);
  assert.match(text, /用户 Prompt: 立讯精密ROE是多少/);
  assert.match(text, /Stack Trace:\nError: boom/);
});

test('missing model usage and duration stay blank', () => {
  assert.equal(parseModelUsage(null), null);
  assert.equal(formatTokenUsage({}), '—');
  assert.equal(formatAuditDuration(null), '—');
  assert.equal(formatAuditDuration(850), '850 毫秒');
});
