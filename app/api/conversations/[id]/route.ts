import { appSessionOwner, requireAppUser } from '@/lib/auth';
import { apiError, ApiError, uuid } from '@/lib/api';
import { deleteConversation, readConversation } from '@/lib/conversations';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

async function identity(request: Request, context: Context) {
  const owner = appSessionOwner(request);
  if (!owner) throw new ApiError(401, '请重新登录以启用独立会话记忆');
  return { owner, id: uuid((await context.params).id, 'id') };
}

export async function GET(request: Request, context: Context) {
  const denied = requireAppUser(request); if (denied) return denied;
  try {
    const { owner, id } = await identity(request, context);
    return Response.json(await readConversation(owner, id), { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, context: Context) {
  const denied = requireAppUser(request); if (denied) return denied;
  try {
    const { owner, id } = await identity(request, context);
    await deleteConversation(owner, id);
    return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
