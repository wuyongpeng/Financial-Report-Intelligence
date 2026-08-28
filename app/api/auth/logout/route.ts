import { appCookieHeader } from '@/lib/auth';

export async function POST() {
  return Response.json({ ok: true }, { headers: { 'set-cookie': appCookieHeader('', new Date(0)), 'cache-control': 'no-store' } });
}
