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
  if (typeof patch.autoCrawlEnabled === 'boolean' || typeof patch.downloadPaused === 'boolean') {
    note = control.autoCrawlEnabled
      ? '已开启自动抓取：识别 PDF 地址并并发下载'
      : '已关闭自动抓取：下载中的任务会完成，排队任务不再自动开始下载；仍会定时扫描新公告';
  }

  return Response.json(
    { ok: true, auth, ...control, note },
    { headers: { 'cache-control': 'no-store' } },
  );
}
