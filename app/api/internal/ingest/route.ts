import { runIngestion } from '@/lib/ingest';
import { getBindings } from '@/lib/runtime';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const bindings = getBindings();
  if (!bindings.CRON_SECRET) return Response.json({ error: 'CRON_SECRET is not configured; use the scheduled trigger.' }, { status: 503 });
  if (request.headers.get('authorization') !== `Bearer ${bindings.CRON_SECRET}`) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const result = await runIngestion(bindings, { days: 2, downloadLimit: 4, parseLimit: 1 });
  return Response.json(result);
}
