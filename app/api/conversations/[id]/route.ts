import { ensureConversationOwner } from '@/lib/auth';
import { apiError, uuid } from '@/lib/api';
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
  return { owner, setCookie, id: uuid((await context.params).id, 'id') };
}

export async function GET(request: Request, context: Context) {
  try {
    const { owner, setCookie, id } = await identity(request, context);
    return withCookie(await readConversation(owner, id), 200, setCookie);
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { owner, setCookie, id } = await identity(request, context);
    await deleteConversation(owner, id);
    return withCookie({ ok: true }, 200, setCookie);
  } catch (error) { return apiError(error); }
}
