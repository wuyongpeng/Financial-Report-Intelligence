import { ensureConversationOwner } from '@/lib/auth';
import { apiError, ApiError, readObject, requiredText } from '@/lib/api';
import { createConversation, listConversations } from '@/lib/conversations';

export const dynamic = 'force-dynamic';

function withCookie(body: unknown, status: number, setCookie?: string) {
  const headers = new Headers({ 'cache-control': 'no-store', 'content-type': 'application/json' });
  if (setCookie) headers.append('set-cookie', setCookie);
  return new Response(JSON.stringify(body), { status, headers });
}

export async function GET(request: Request) {
  try {
    const { owner, setCookie } = ensureConversationOwner(request);
    const reportId = new URL(request.url).searchParams.get('reportId');
    return withCookie({ conversations: await listConversations(owner, reportId) }, 200, setCookie);
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const { owner, setCookie } = ensureConversationOwner(request);
    const body = await readObject(request);
    return withCookie({ conversation: await createConversation(owner, requiredText(body.reportId, 'reportId')) }, 201, setCookie);
  } catch (error) { return apiError(error); }
}
