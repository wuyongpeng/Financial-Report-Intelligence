import { apiError, ApiError, readObject } from '@/lib/api';
import { deleteRegisteredAccount } from '@/lib/account-profile';
import { changeAccountPassword } from '@/lib/app-account';
import { appCookieHeader } from '@/lib/auth';

export const dynamic = 'force-dynamic';


export async function PATCH(request: Request) {
  try {
    const body = await readObject(request);
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : '';
    await changeAccountPassword(request, currentPassword, newPassword, confirmPassword);
    return Response.json({ ok: true, message: '密码已更新' }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof ApiError) return apiError(error);
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await readObject(request) as { password?: string };
    const result = await deleteRegisteredAccount(request, String(body.password ?? ''));
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ ok: true }, {
      status: 200,
      headers: { 'cache-control': 'no-store', 'set-cookie': appCookieHeader('deleted', new Date(0)) },
    });
  } catch (error) {
    return apiError(error);
  }
}
