import { appCookieHeader, createAppCookie } from '@/lib/auth';
import { apiError, ApiError, readObject } from '@/lib/api';
import { authenticateAccount } from '@/lib/app-account';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await readObject(request);
    const username = typeof body.username === 'string' ? body.username : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username.trim() || !password) return Response.json({ error: '请输入账号和密码' }, { status: 400 });
    const account = await authenticateAccount(username, password);
    if (!account) return Response.json({ error: '账号或密码错误' }, { status: 401 });
    try {
      return Response.json(
        { ok: true, username: account },
        {
          headers: {
            'set-cookie': appCookieHeader(createAppCookie(account)),
            'cache-control': 'no-store',
          },
        },
      );
    } catch {
      return Response.json({ error: '登录会话未配置：请设置至少 24 位的 APP_SESSION_SECRET 后重启 app。' }, { status: 503 });
    }
  } catch (error) {
    if (error instanceof ApiError) return apiError(error);
    return apiError(error);
  }
}
