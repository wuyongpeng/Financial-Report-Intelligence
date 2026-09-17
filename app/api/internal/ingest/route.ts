import { runIngestion } from '@/lib/ingest';
import { getIngestSettings } from '@/lib/ingest-settings';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const token = process.env.INTERNAL_INGEST_TOKEN;
  if (!token || request.headers.get('authorization') !== `Bearer ${token}`) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const settings = getIngestSettings();
    return Response.json(await runIngestion({
      days: settings.lookbackDays,
      downloadLimit: settings.downloadLimit,
      parseLimit: settings.parseLimit,
    }), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
