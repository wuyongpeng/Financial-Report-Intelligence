import { demoAccessEnabled, isAppUser } from '@/lib/auth';
import { getIngestControl, setIngestControl } from '@/lib/ingest-control';
import { getDownloadGate, setDownloadGate } from '@/lib/ingest-progress';
import { getIngestSettings, setIngestSettings, type IngestSettings } from '@/lib/ingest-settings';

export const dynamic = 'force-dynamic';

function authorized(request: Request) {
  const token = process.env.INTERNAL_INGEST_TOKEN;
  const bearer = request.headers.get('authorization');
  if (token && bearer === 'Bearer ' + token) return 'token';
  if (isAppUser(request)) return 'session';
  if (demoAccessEnabled()) return 'demo';
  return null;
}

function payload(control: Awaited<ReturnType<typeof getIngestControl>>, settings: IngestSettings) {
  return { ...control, settings, ...settings };
}

export async function GET() {
  const control = await getIngestControl();
  const settings = getIngestSettings();
  return Response.json(
    { ok: true, ...payload(control, settings) },
    { headers: { 'cache-control': 'no-store' } },
  );
}

export async function POST(request: Request) {
  const auth = authorized(request);
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: {
    autoCrawlEnabled?: unknown;
    downloadPaused?: unknown;
    autoVerdictEnabled?: unknown;
    downloadPauseSec?: unknown;
    downloadLimit?: unknown;
    parseLimit?: unknown;
    lookbackDays?: unknown;
    pollIntervalMin?: unknown;
  } = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: '请求体无效' }, { status: 400 });
  }

  const patch: { autoCrawlEnabled?: boolean; downloadPaused?: boolean; autoVerdictEnabled?: boolean } = {};
  if (typeof body.autoCrawlEnabled === 'boolean') patch.autoCrawlEnabled = body.autoCrawlEnabled;
  if (typeof body.downloadPaused === 'boolean') patch.downloadPaused = body.downloadPaused;
  if (typeof body.autoVerdictEnabled === 'boolean') patch.autoVerdictEnabled = body.autoVerdictEnabled;
  const settingsPatch: Partial<IngestSettings> = {};
  if (body.downloadPauseSec !== undefined) settingsPatch.downloadPauseSec = Number(body.downloadPauseSec);
  if (body.downloadLimit !== undefined) settingsPatch.downloadLimit = Number(body.downloadLimit);
  if (body.parseLimit !== undefined) settingsPatch.parseLimit = Number(body.parseLimit);
  if (body.lookbackDays !== undefined) settingsPatch.lookbackDays = Number(body.lookbackDays);
  if (body.pollIntervalMin !== undefined) settingsPatch.pollIntervalMin = Number(body.pollIntervalMin);
  const hasSettings = Object.keys(settingsPatch).length > 0;
  if (!('autoCrawlEnabled' in patch) && !('downloadPaused' in patch) && !('autoVerdictEnabled' in patch) && !hasSettings) {
    return Response.json({ error: '需要自动抓取开关、自动智析开关或采集参数' }, { status: 400 });
  }

  const control = Object.keys(patch).length ? await setIngestControl(patch) : await getIngestControl();
  const settings = hasSettings ? setIngestSettings(settingsPatch) : getIngestSettings();
  const pauseMs = settings.downloadPauseSec * 1000;
  if (control.downloadPaused) {
    setDownloadGate({ nextAt: null, pauseMs, mode: 'paused' });
  } else if (hasSettings) {
    const gate = getDownloadGate();
    setDownloadGate({ ...gate, pauseMs });
  }

  let note = '已更新';
  if (hasSettings && !('autoCrawlEnabled' in patch) && !('downloadPaused' in patch) && !('autoVerdictEnabled' in patch)) {
    note = `已保存采集参数：下载间隔 ${settings.downloadPauseSec}s · 下载并发 ${settings.downloadLimit} · 解析并发 ${settings.parseLimit} · 采集窗口近 ${settings.lookbackDays} 天 · 轮询间隔 ${settings.pollIntervalMin} 分钟`;
  } else if (typeof patch.autoVerdictEnabled === 'boolean' && !('autoCrawlEnabled' in patch) && !('downloadPaused' in patch)) {
    note = control.autoVerdictEnabled
      ? '已开启自动智析：空闲时单线程补齐未生成的概览，单份限 90 秒，失败跳过并冷却'
      : '已关闭自动智析：进行中的一份会结束，队列不再领取新任务';
  } else if (typeof patch.autoCrawlEnabled === 'boolean' || typeof patch.downloadPaused === 'boolean') {
    note = control.autoCrawlEnabled
      ? '已开启自动抓取：识别 PDF 地址并并发下载'
      : '已关闭自动抓取：下载中的任务会完成，排队任务不再自动开始下载；仍会定时扫描新公告';
  }

  return Response.json(
    { ok: true, auth, ...payload(control, settings), note },
    { headers: { 'cache-control': 'no-store' } },
  );
}
