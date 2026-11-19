import { apiError, readObject } from '@/lib/api';
import { getAccountProfile, updateAccountEmail, validateEmail } from '@/lib/account-profile';
import { jsonOk, loginRequired, registeredUserKey } from '@/lib/user-key';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const userKey = registeredUserKey(request);
    if (!userKey) return loginRequired();
    return jsonOk(await getAccountProfile(userKey));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const userKey = registeredUserKey(request);
    if (!userKey) return loginRequired();
    const body = await readObject(request) as { email?: string; emailNotify?: boolean };
    const checked = validateEmail(String(body.email ?? ''));
    if (!checked.ok) return Response.json({ error: checked.error }, { status: 400 });
    const updated = await updateAccountEmail(userKey, checked.email, body.emailNotify !== false);
    if (!updated) return Response.json({ error: '当前账号不能绑定邮箱' }, { status: 400 });
    return jsonOk(await getAccountProfile(userKey));
  } catch (error) {
    return apiError(error);
  }
}
