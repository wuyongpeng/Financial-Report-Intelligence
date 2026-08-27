import { processBacklog } from '@/lib/ingest';
import { getBindings } from '@/lib/runtime';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return Response.json({ error: 'Cross-origin request rejected' }, { status: 403 });
  try {
    const result = await processBacklog(getBindings(), { downloadLimit: 1, parseLimit: 1 });
    return Response.json({ ok: true, ...result }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, error: String(error) }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}
