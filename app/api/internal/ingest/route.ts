import { runIngestion } from '@/lib/ingest';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const token = process.env.INTERNAL_INGEST_TOKEN;
  if (!token || request.headers.get('authorization') !== `Bearer ${token}`) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return Response.json(await runIngestion({ days: 2, downloadLimit: 5, parseLimit: 3 }), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
