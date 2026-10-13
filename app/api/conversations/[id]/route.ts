import { ensureConversationOwner } from '@/lib/auth';
import type { Row } from 'postgres';
import { apiError } from '@/lib/api';
import {
  parseConversationId,
  type ConversationDetailResponse,
  type DeleteConversationResponse,
} from '@/contracts/conversations';
import { deleteConversation, readConversation } from '@/lib/conversations';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

function withCookie(body: unknown, status: number, setCookie?: string) {
  const headers = new Headers({ 'cache-control': 'no-store', 'content-type': 'application/json' });
  if (setCookie) headers.append('set-cookie', setCookie);
  return new Response(JSON.stringify(body), { status, headers });
}

async function identity(request: Request, context: Context) {
  const { owner, setCookie } = ensureConversationOwner(request);
  return { owner, setCookie, id: parseConversationId((await context.params).id) };
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

export async function GET(request: Request, context: Context) {
  try {
    const { owner, setCookie, id } = await identity(request, context);
    const result = await readConversation(owner, id);
    const body = {
      conversation: conversationDto(result.conversation),
      messages: [...result.messages],
    } satisfies ConversationDetailResponse;
    return withCookie(body, 200, setCookie);
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { owner, setCookie, id } = await identity(request, context);
    await deleteConversation(owner, id);
    const body = { ok: true } satisfies DeleteConversationResponse;
    return withCookie(body, 200, setCookie);
  } catch (error) { return apiError(error); }
}
