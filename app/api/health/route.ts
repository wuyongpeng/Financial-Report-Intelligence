import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [row] = await getDb()`SELECT to_regclass('announcements') IS NOT NULL AS initialized`;
    return Response.json({ status: row.initialized ? 'ok' : 'not-initialized', database: 'connected', version: 'backend-v1' }, {
      status: row.initialized ? 200 : 503, headers: { 'cache-control': 'no-store' },
    });
  } catch {
    return Response.json({ status: 'unavailable', database: 'unavailable', version: 'backend-v1' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
