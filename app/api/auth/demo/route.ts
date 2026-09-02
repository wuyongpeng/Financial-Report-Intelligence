import { appCookieHeader, createDemoCookie, demoAccessEnabled } from '@/lib/auth';

export async function POST() {
  if (!demoAccessEnabled()) return Response.json({ error: '评委体验入口未开启' }, { status: 404 });
  try {
    return Response.json({ ok: true, role: 'guest' }, {
      headers: { 'set-cookie': appCookieHeader(createDemoCookie()), 'cache-control': 'no-store' },
    });
  } catch {
    return Response.json({ error: '体验会话尚未配置，请检查 APP_SESSION_SECRET。' }, { status: 503 });
  }
}
