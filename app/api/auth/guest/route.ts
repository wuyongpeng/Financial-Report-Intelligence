import { ensureGuestSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Mint anonymous guest cookie for conversation memory + open product use. */
export async function POST(request: Request) {
  try {
    const { setCookie } = ensureGuestSession(request);
    const headers = new Headers({ 'cache-control': 'no-store', 'content-type': 'application/json' });
    if (setCookie) headers.append('set-cookie', setCookie);
    return new Response(JSON.stringify({ ok: true, role: 'guest' }), { status: 200, headers });
  } catch {
    return Response.json({ error: '访客会话未配置：请设置至少 24 位的 APP_SESSION_SECRET' }, { status: 503 });
  }
}
