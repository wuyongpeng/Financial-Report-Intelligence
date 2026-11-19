import { apiError, readObject } from '@/lib/api';
import { deleteRegisteredAccount } from '@/lib/account-profile';
import { appCookieHeader } from '@/lib/auth';

export const dynamic = 'force-dynamic';

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
