import { demoAccessEnabled, isAppUser } from '@/lib/auth';
import { getIngestControl, setIngestControl } from '@/lib/ingest-control';
import { setDownloadGate } from '@/lib/ingest-progress';

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

  let body: { autoCrawlEnabled?: unknown; downloadPaused?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: '请求体无效' }, { status: 400 });
  }

  const patch: { autoCrawlEnabled?: boolean; downloadPaused?: boolean } = {};
  if (typeof body.autoCrawlEnabled === 'boolean') patch.autoCrawlEnabled = body.autoCrawlEnabled;
  if (typeof body.downloadPaused === 'boolean') patch.downloadPaused = body.downloadPaused;
  if (!('autoCrawlEnabled' in patch) && !('downloadPaused' in patch)) {
    return Response.json({ error: '需要 autoCrawlEnabled 或 downloadPaused 布尔值' }, { status: 400 });
  }

  const control = await setIngestControl(patch);
  if (control.downloadPaused) {
    setDownloadGate({
      nextAt: null,
      pauseMs: Number(process.env.DOWNLOAD_PAUSE_MS ?? 1200),
      mode: 'paused',
    });
  }

  let note = '已更新';
  if (typeof patch.downloadPaused === 'boolean') {
    note = control.downloadPaused
      ? '已暂停抓取：停止新下载，排队保持不变；自动抓取已同步关闭'
      : '已恢复下载';
  } else if (typeof patch.autoCrawlEnabled === 'boolean') {
    note = control.autoCrawlEnabled
      ? '已开启自动抓取（发现新公告/补缺口）'
      : '已关闭自动抓取：不再发现新公告/补缺口；已有排队仍会下载与解析';
  }

  return Response.json(
    { ok: true, auth, ...control, note },
    { headers: { 'cache-control': 'no-store' } },
  );
}
