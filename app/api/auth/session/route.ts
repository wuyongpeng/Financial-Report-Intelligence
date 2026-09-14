import { appUserRole, hasGuestSession, isAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const role = appUserRole(request);
  const guest = !role && hasGuestSession(request);
  return Response.json({
    authenticated: Boolean(role) || guest,
    role: role ?? (guest ? 'guest' : null),
    admin: isAdmin(request),
  }, { headers: { 'cache-control': 'no-store' } });
}
