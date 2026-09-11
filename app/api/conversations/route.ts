import { appSessionOwner, requireAppUser } from '@/lib/auth';
import { apiError, ApiError, readObject, requiredText } from '@/lib/api';
import { createConversation, listConversations } from '@/lib/conversations';

export const dynamic = 'force-dynamic';

function owner(request: Request) {
  const key = appSessionOwner(request);
  if (!key) throw new ApiError(401, '请重新登录以启用独立会话记忆');
  return key;
}

export async function GET(request: Request) {
  try {
    // Anonymous / demo visitors get an empty list (200) so the Network panel is clean;
    // chat still works without conversationId. Logged-in memory stays behind a session owner.
    const key = appSessionOwner(request);
    if (!key) {
      return Response.json({ conversations: [] }, { headers: { 'cache-control': 'no-store' } });
    }
    const reportId = new URL(request.url).searchParams.get('reportId');
    return Response.json({ conversations: await listConversations(key, reportId) }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  const denied = requireAppUser(request); if (denied) return denied;
  try {
    const body = await readObject(request);
    return Response.json({ conversation: await createConversation(owner(request), requiredText(body.reportId, 'reportId')) }, { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
