import { apiError, readObject } from '@/lib/api';
import { loginRequired, jsonOk, registeredUserKey } from '@/lib/user-key';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadNotificationCount,
} from '@/lib/user-notifications';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const userKey = registeredUserKey(request);
    if (!userKey) return loginRequired();
    const unreadOnly = new URL(request.url).searchParams.get('unread') === '1';
    const notifications = await listNotifications(userKey, { unreadOnly });
    const unread = await unreadNotificationCount(userKey);
    return jsonOk({ notifications, unread });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const userKey = registeredUserKey(request);
    if (!userKey) return loginRequired();
    let body: { id?: string; all?: boolean } = {};
    try { body = await readObject(request) as { id?: string; all?: boolean }; } catch { /* empty */ }
    if (body.all) await markAllNotificationsRead(userKey);
    else if (body.id) await markNotificationRead(userKey, String(body.id));
    else return Response.json({ error: '请指定通知' }, { status: 400 });
    return jsonOk({ ok: true, unread: await unreadNotificationCount(userKey) });
  } catch (error) {
    return apiError(error);
  }
}
