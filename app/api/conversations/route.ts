import { ensureConversationOwner } from '@/lib/auth';
import { apiError, readObject } from '@/lib/api';
import type { Row } from 'postgres';
import {
  parseConversationListQuery,
  parseCreateConversationRequest,
  type ConversationListResponse,
  type CreateConversationResponse,
} from '@/contracts/conversations';
import { createConversation, listConversations } from '@/lib/conversations';

export const dynamic = 'force-dynamic';

function withCookie(body: unknown, status: number, setCookie?: string) {
  const headers = new Headers({ 'cache-control': 'no-store', 'content-type': 'application/json' });
  if (setCookie) headers.append('set-cookie', setCookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function conversationDto(row: Row) {
  return {
    id: String(row.id),
    report_id: String(row.report_id),
    title: String(row.title),
    created_at: new Date(row.created_at as string | Date).toISOString(),
    updated_at: new Date(row.updated_at as string | Date).toISOString(),
  };
}

export async function GET(request: Request) {
  try {
    const { owner, setCookie } = ensureConversationOwner(request);
    const reportId = parseConversationListQuery(new URL(request.url));
    const body = { conversations: (await listConversations(owner, reportId)).map(conversationDto) } satisfies ConversationListResponse;
    return withCookie(body, 200, setCookie);
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const { owner, setCookie } = ensureConversationOwner(request);
    const input = parseCreateConversationRequest(await readObject(request));
    const body = { conversation: conversationDto(await createConversation(owner, input.reportId)) } satisfies CreateConversationResponse;
    return withCookie(body, 201, setCookie);
  } catch (error) { return apiError(error); }
}
