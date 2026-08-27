import { processBacklog } from '@/lib/ingest';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const token = process.env.INTERNAL_INGEST_TOKEN;
  if (!token || request.headers.get('authorization') !== `Bearer ${token}`) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return Response.json({ ok: true, ...(await processBacklog({ downloadLimit: 1, parseLimit: 1 })) }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, error: String(error) }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}
