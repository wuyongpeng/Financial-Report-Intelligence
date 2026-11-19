import { apiError } from '@/lib/api';
import { ensureConversationOwner } from '@/lib/auth';
import { listOwnerConversations } from '@/lib/conversations';
import { jsonOk, loginRequired, registeredUserKey } from '@/lib/user-key';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    if (!registeredUserKey(request)) return loginRequired();
    const { owner, setCookie } = ensureConversationOwner(request);
    return jsonOk({ conversations: await listOwnerConversations(owner) }, 200, setCookie);
  } catch (error) {
    return apiError(error);
  }
}
