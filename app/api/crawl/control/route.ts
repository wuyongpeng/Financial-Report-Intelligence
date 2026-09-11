import { demoAccessEnabled, isAppUser } from '@/lib/auth';
import { getIngestControl, setIngestControl } from '@/lib/ingest-control';

export const dynamic = 'force-dynamic';

function authorized(request: Request) {
  const token = process.env.INTERNAL_INGEST_TOKEN;
  const bearer = request.headers.get('authorization');
  if (token && bearer === `Bearer ${token}`) return 'token';
  if (isAppUser(request)) return 'session';
  if (demoAccessEnabled()) return 'demo';
  return null;
}

export async function GET() {
  const control = await getIngestControl();
  return Response.json(
    { ok: true, ...control },
    { headers: { 'cache-control': 'no-store' } },
  );
}

export async function POST(request: Request) {
  const auth = authorized(request);
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { autoCrawlEnabled?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: '请求体无效' }, { status: 400 });
  }

  if (typeof body.autoCrawlEnabled !== 'boolean') {
    return Response.json({ error: 'autoCrawlEnabled 必须为布尔值' }, { status: 400 });
  }

  const control = await setIngestControl({ autoCrawlEnabled: body.autoCrawlEnabled });
  return Response.json(
    {
      ok: true,
      auth,
      ...control,
      note: control.autoCrawlEnabled
        ? '已开启自动抓取'
        : '已暂停自动抓取；手动触发亦已拦截，避免交易所封控',
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
