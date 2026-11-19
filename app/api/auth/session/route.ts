import { isAdmin } from '@/lib/auth';
import { apiError, ApiError } from '@/lib/api';
import { peekAskQuota, sessionPayload } from '@/lib/app-account';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { state, setCookie } = await peekAskQuota(request);
    const headers = new Headers({ 'cache-control': 'no-store', 'content-type': 'application/json' });
    if (setCookie) headers.append('set-cookie', setCookie);
    return new Response(JSON.stringify({ ...sessionPayload(state), admin: isAdmin(request) }), { status: 200, headers });
  } catch (error) {
    if (error instanceof ApiError) return apiError(error);
    return apiError(error);
  }
}
