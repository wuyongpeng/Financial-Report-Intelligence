import { randomUUID } from 'node:crypto';
import { ApiError, requiredText, uuid } from '@/lib/api';
import { parseAnswerRewrite, type AnswerRewrite } from '@/lib/answer';
import type { AnswerResult, Evidence } from '@/lib/conversations';
import { parseFocus, QUESTION_MAX, type FocusItem } from '@/lib/focus-prompt';
import { optionalBoolean } from './common';

export type ChatRequest = {
  reportId: string;
  question: string;
  focus: FocusItem[];
  stream: boolean;
  summary: boolean;
  requestId: string;
  conversationId?: string;
  rewrite?: AnswerRewrite;
  /** Realtime voice / spoken TTS path — answers must stay very short. */
  spoken?: boolean;
};

export type ChatResponse = AnswerResult & {
  requestId: string;
  conversationId?: string;
  metrics?: unknown[];
  peers?: Array<{ code: string; company_name: string }>;
};

export type ChatStreamEvent =
  | { requestId: string; conversationId?: string; status: 'retrieving'; evidence: Evidence[] }
  | { status: 'reasoning' }
  | { content: string }
  | { result: AnswerResult; evidence: Evidence[]; status: AnswerResult['status'] }
  | { error: string; status: 'failed' };

export function parseChatRequest(body: Record<string, unknown>): ChatRequest {
  const reportId = requiredText(body.reportId, 'reportId');
  const question = requiredText(body.question, 'question', QUESTION_MAX);
  const focus = parseFocus(body.focus ?? body.pendingItems);
  const stream = optionalBoolean(body.stream, 'stream') ?? false;
  const summary = optionalBoolean(body.summary, 'summary') ?? false;
  const requestId = body.requestId === undefined ? randomUUID() : uuid(body.requestId, 'requestId');
  const conversationId = body.conversationId === undefined ? undefined : uuid(body.conversationId, 'conversationId');
  if (body.rewrite !== undefined && parseAnswerRewrite(body.rewrite) === undefined) {
    throw new ApiError(400, 'rewrite 参数无效');
  }
  return {
    reportId,
    question,
    focus,
    stream,
    summary,
    requestId,
    conversationId,
    rewrite: parseAnswerRewrite(body.rewrite),
    spoken: optionalBoolean(body.spoken, 'spoken') ?? false,
  };
}

export function encodeChatStreamEvent(event: ChatStreamEvent) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export const CHAT_STREAM_DONE = 'data: [DONE]\n\n';
