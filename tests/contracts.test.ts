import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../lib/api';
import { readContractJson } from '../contracts/common';
import { CHAT_STREAM_DONE, encodeChatStreamEvent, parseChatRequest } from '../contracts/chat';
import {
  parseConversationDetailResponse,
  parseConversationListResponse,
  parseCreateConversationRequest,
} from '../contracts/conversations';
import { parseReportListQuery, parseReportListResponse } from '../contracts/reports';

const report = {
  id: 'report-1',
  code: '600519',
  company_name: '贵州茅台',
  title: '2025年年度报告',
  report_type: 'annual',
  published_at: '2026-03-01T00:00:00.000Z',
  parsed_at: '2026-03-01T01:00:00.000Z',
  industry: '白酒',
  status: 'online',
  metrics: [{
    metric: 'revenue',
    value: 100,
    unit: '元',
    period: '2025FY',
    source_page: 8,
    source_label: '营业收入',
    confidence: 0.99,
    verified: true,
  }],
};

const conversation = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  report_id: 'report-1',
  title: '贵州茅台 · 2025年年度报告',
  created_at: '2026-03-01T00:00:00.000Z',
  updated_at: '2026-03-01T00:00:00.000Z',
};

test('report query contract validates and normalizes public parameters', () => {
  assert.deepEqual(parseReportListQuery(new URL('http://localhost/api/reports')), {
    limit: 50,
    code: null,
    view: null,
  });
  assert.deepEqual(parseReportListQuery(new URL('http://localhost/api/reports?limit=999&code=600519&view=companies')), {
    limit: 100,
    code: '600519',
    view: 'companies',
  });
  for (const url of [
    'http://localhost/api/reports?limit=0',
    'http://localhost/api/reports?code=abc',
    'http://localhost/api/reports?view=private',
  ]) {
    assert.throws(() => parseReportListQuery(new URL(url)), (error: unknown) => error instanceof ApiError && error.status === 400);
  }
});

test('report response contract parses booleans from PostgreSQL into client DTOs', () => {
  const parsed = parseReportListResponse({ source: 'postgresql', count: 1, reports: [report] });
  assert.equal(parsed.reports[0].metrics[0].verified, 1);
  assert.equal(parsed.reports[0].metrics[0].metric, 'revenue');
  assert.throws(() => parseReportListResponse({ source: 'postgresql', count: 2, reports: [report] }), /count/);
  assert.throws(() => parseReportListResponse({ source: 'mock', count: 1, reports: [report] }), /source/);
});

test('conversation contracts validate requests and parse list/detail responses', () => {
  assert.deepEqual(parseCreateConversationRequest({ reportId: ' report-1 ' }), { reportId: 'report-1' });
  assert.throws(() => parseCreateConversationRequest({}), (error: unknown) => error instanceof ApiError && error.status === 400);
  assert.equal(parseConversationListResponse({ conversations: [conversation] }).conversations[0].id, conversation.id);
  const detail = parseConversationDetailResponse({
    conversation,
    messages: [{
      id: '1',
      request_id: 'request-1',
      role: 'assistant',
      content: '回答',
      status: 'complete',
      evidence: [],
      mode: null,
    }],
  });
  assert.equal(detail.messages[0].role, 'assistant');
  assert.throws(() => parseConversationDetailResponse({ conversation, messages: [{ role: 'system' }] }), /message/);
});

test('chat request contract owns defaults, enums, booleans, and stream framing', () => {
  const parsed = parseChatRequest({ reportId: 'report-1', question: '营业收入是多少？' });
  assert.equal(parsed.stream, false);
  assert.equal(parsed.summary, false);
  assert.equal(parsed.focus.length, 0);
  assert.match(parsed.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(parseChatRequest({ reportId: 'report-1', question: '问题', rewrite: 'brief', stream: true }).rewrite, 'brief');
  assert.throws(() => parseChatRequest({ reportId: 'report-1', question: '问题', rewrite: 'other' }), (error: unknown) => error instanceof ApiError && error.status === 400);
  assert.throws(() => parseChatRequest({ reportId: 'report-1', question: '问题', stream: 'yes' }), (error: unknown) => error instanceof ApiError && error.status === 400);
  assert.equal(encodeChatStreamEvent({ content: '片段' }), 'data: {"content":"片段"}\n\n');
  assert.equal(CHAT_STREAM_DONE, 'data: [DONE]\n\n');
});

test('client contract reader validates success and preserves API error messages', async () => {
  const ok = await readContractJson(Response.json({ source: 'postgresql', count: 1, reports: [report] }), parseReportListResponse);
  assert.equal(ok.reports[0].code, '600519');
  await assert.rejects(
    readContractJson(Response.json({ error: '报告不存在' }, { status: 404 }), parseReportListResponse),
    /报告不存在/,
  );
  await assert.rejects(
    readContractJson(new Response('not json', { status: 502 }), parseReportListResponse),
    /不是有效 JSON/,
  );
});
