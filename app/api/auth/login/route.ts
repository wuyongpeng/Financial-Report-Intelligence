import { appCookieHeader, createAppCookie, validAppCredentials } from '@/lib/auth';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { username?: string; password?: string };
  if (!body.username || !body.password) return Response.json({ error: '请输入账号和密码' }, { status: 400 });
  if (!validAppCredentials(body.username, body.password)) return Response.json({ error: '账号或密码错误' }, { status: 401 });
  try {
    return Response.json({ ok: true }, { headers: { 'set-cookie': appCookieHeader(createAppCookie(body.username)), 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ error: '登录会话未配置：请设置至少 24 位的 APP_SESSION_SECRET 后重启 app。' }, { status: 503 });
  }
}
