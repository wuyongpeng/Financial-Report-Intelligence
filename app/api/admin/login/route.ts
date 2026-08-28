import { adminCookieHeader, createAdminCookie, validAdminPassword } from '@/lib/auth';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { password?: string };
  if (!body.password || !validAdminPassword(body.password)) return Response.json({ error: '账号或密码错误' }, { status: 401 });
  try {
    return Response.json({ ok: true, role: 'admin' }, { headers: { 'set-cookie': adminCookieHeader(createAdminCookie()), 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ error: '管理员会话未配置：请设置至少 24 位的 ADMIN_SESSION_SECRET 后重启 app。' }, { status: 503 });
  }
}

export async function DELETE() {
  return Response.json({ ok: true }, { headers: { 'set-cookie': adminCookieHeader('', new Date(0)) } });
}
