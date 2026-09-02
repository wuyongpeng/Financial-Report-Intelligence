import { appUserRole, demoAccessEnabled, isAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const role = appUserRole(request);
  return Response.json({ authenticated: Boolean(role), role, demoEnabled: demoAccessEnabled(), admin: isAdmin(request) }, { headers: { 'cache-control': 'no-store' } });
}
