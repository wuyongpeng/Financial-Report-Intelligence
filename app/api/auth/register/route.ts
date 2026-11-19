import { appCookieHeader, createAppCookie } from '@/lib/auth';
import { apiError, ApiError, readObject } from '@/lib/api';
import { registerAccount } from '@/lib/app-account';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await readObject(request);
    const username = typeof body.username === 'string' ? body.username : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : '';
    const created = await registerAccount(username, password, confirmPassword);
    try {
      return Response.json(
        { ok: true, message: '注册成功', username: created },
        {
          headers: {
            'set-cookie': appCookieHeader(createAppCookie(created)),
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
