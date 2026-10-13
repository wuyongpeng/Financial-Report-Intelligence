import { requiredText, uuid } from '@/lib/api';
import type { Evidence, StoredMessage } from '@/lib/conversations';
import {
  contractArray,
  contractNumber,
  contractObject,
  contractString,
  optionalString,
} from './common';

export type ConversationDto = {
  id: string;
  report_id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type CreateConversationRequest = { reportId: string };
export type CreateConversationResponse = { conversation: ConversationDto };
export type ConversationListResponse = { conversations: ConversationDto[] };
export type ConversationDetailResponse = { conversation: ConversationDto; messages: StoredMessage[] };
export type DeleteConversationResponse = { ok: true };

export function parseConversationListQuery(input: URL | URLSearchParams) {
  const search = input instanceof URL ? input.searchParams : input;
  const reportId = search.get('reportId');
  return reportId === null ? null : requiredText(reportId, 'reportId');
}

export function parseCreateConversationRequest(value: Record<string, unknown>): CreateConversationRequest {
  return { reportId: requiredText(value.reportId, 'reportId') };
}

export function parseConversationId(value: unknown) {
  return uuid(value, 'id');
}

export function parseConversationDto(value: unknown): ConversationDto {
  const row = contractObject(value, 'conversation');
  return {
    id: contractString(row.id, 'conversation.id'),
    report_id: contractString(row.report_id, 'conversation.report_id'),
    title: contractString(row.title, 'conversation.title'),
    created_at: contractString(row.created_at, 'conversation.created_at'),
    updated_at: contractString(row.updated_at, 'conversation.updated_at'),
  };
}

function parseEvidence(value: unknown): Evidence {
  const row = contractObject(value, 'evidence');
  return {
    id: contractString(row.id, 'evidence.id'),
    reportId: contractString(row.reportId, 'evidence.reportId'),
    companyName: contractString(row.companyName, 'evidence.companyName'),
    period: contractString(row.period, 'evidence.period'),
    page: contractNumber(row.page, 'evidence.page'),
    quote: contractString(row.quote, 'evidence.quote'),
    metric: optionalString(row.metric, 'evidence.metric'),
    code: optionalString(row.code, 'evidence.code'),
  };
}

function parseStoredMessage(value: unknown): StoredMessage {
  const row = contractObject(value, 'message');
  const role = contractString(row.role, 'message.role');
  if (role !== 'user' && role !== 'assistant') throw new Error('message.role 响应格式错误');
  return {
    id: contractString(row.id, 'message.id'),
    request_id: contractString(row.request_id, 'message.request_id'),
    role,
    content: contractString(row.content, 'message.content'),
    status: contractString(row.status, 'message.status'),
    evidence: contractArray(row.evidence ?? [], 'message.evidence').map(parseEvidence),
    mode: row.mode === null || row.mode === undefined ? null : contractString(row.mode, 'message.mode'),
  };
}

export function parseConversationListResponse(value: unknown): ConversationListResponse {
  const row = contractObject(value, 'conversation list');
  return { conversations: contractArray(row.conversations, 'conversations').map(parseConversationDto) };
}

export function parseCreateConversationResponse(value: unknown): CreateConversationResponse {
  const row = contractObject(value, 'create conversation');
  return { conversation: parseConversationDto(row.conversation) };
}

export function parseConversationDetailResponse(value: unknown): ConversationDetailResponse {
  const row = contractObject(value, 'conversation detail');
  return {
    conversation: parseConversationDto(row.conversation),
    messages: contractArray(row.messages, 'messages').map(parseStoredMessage),
  };
}

export function parseDeleteConversationResponse(value: unknown): DeleteConversationResponse {
  const row = contractObject(value, 'delete conversation');
  if (row.ok !== true) throw new Error('delete conversation 响应格式错误');
  return { ok: true };
}
