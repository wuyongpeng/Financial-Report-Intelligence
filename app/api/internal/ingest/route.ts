import { runIngestion } from '@/lib/ingest';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const token = process.env.INTERNAL_INGEST_TOKEN;
  if (!token || request.headers.get('authorization') !== `Bearer ${token}`) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const downloadLimit = Math.min(Number(process.env.INGEST_DOWNLOAD_LIMIT ?? 2), 3);
    const parseLimit = Math.min(Number(process.env.INGEST_PARSE_LIMIT ?? 1), 2);
    return Response.json(await runIngestion({ days: Number(process.env.INGEST_DAYS ?? 2), downloadLimit, parseLimit }), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
