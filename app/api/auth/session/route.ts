import { isAppUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return Response.json({ authenticated: isAppUser(request) }, { headers: { 'cache-control': 'no-store' } });
}
