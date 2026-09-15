import { fillCoverageGaps, processBacklog, prioritizeCompanyCrawl, runIngestion } from '@/lib/ingest';
import { demoAccessEnabled, isAppUser } from '@/lib/auth';
import { getIngestControl } from '@/lib/ingest-control';

export const dynamic = 'force-dynamic';

function authorized(request: Request) {
  const token = process.env.INTERNAL_INGEST_TOKEN;
  const bearer = request.headers.get('authorization');
  if (token && bearer === `Bearer ${token}`) return 'token';
  if (isAppUser(request)) return 'session';
  if (demoAccessEnabled()) return 'demo';
  // Product is open for evaluators / guests — allow soft crawl without login.
  return 'guest';
}

function sanitizeCodes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is string => typeof c === 'string' && /^\d{6}$/.test(c))
    .slice(0, 10);
}

export async function POST(request: Request) {
  const auth = authorized(request);
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: {
    mode?: string; codes?: string[]; fullHistory?: boolean; lookback?: string; parseOnly?: boolean;
    periods?: string[]; announcementIds?: string[];
  } = {};
  try { body = await request.json(); } catch { /* empty body ok */ }
  const discover = body.mode === 'discover' && auth === 'token';
  const codes = sanitizeCodes(body.codes);
  const fullHistory = body.fullHistory === true || body.lookback === 'full' || body.mode === 'manual';
  const parseOnly = body.parseOnly === true || body.mode === 'parse';
  const periods = Array.isArray(body.periods)
    ? body.periods.filter((p): p is string => typeof p === 'string' && /^20\d{2}(FY|H1|Q[1-3])$/i.test(p)).map((p) => p.toUpperCase()).slice(0, 8)
    : [];
  const announcementIds = Array.isArray(body.announcementIds)
    ? body.announcementIds.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, 10)
    : [];
  const control = await getIngestControl();
  const paused = !control.autoCrawlEnabled || control.downloadPaused;
  const downloadPaused = control.downloadPaused;

  if (downloadPaused && !parseOnly && (discover || codes.length)) {
    return Response.json(
      {
        ok: false,
        error: '下载已暂停：请先关闭「暂停抓取」后再下载；解析已下载 PDF 不受影响。',
        downloadPaused: true,
      },
      { status: 409, headers: { 'cache-control': 'no-store' } },
    );
  }

  // Auto off blocks discover / gap fill (not draining existing queue).
  if (!control.autoCrawlEnabled && !downloadPaused && !fullHistory && !parseOnly && (discover || (codes.length && body.mode === 'discover'))) {
    return Response.json(
      {
        ok: false,
        error: '自动抓取已关闭，请先开启自动抓取；已有排队仍会消化，解析已下载 PDF 不受影响。',
        paused: true,
      },
      { status: 409, headers: { 'cache-control': 'no-store' } },
    );
  }

  try {
    if (discover) {
      const result = await runIngestion({
        days: Number(process.env.INGEST_DAYS ?? 2),
        downloadLimit: Math.min(Number(process.env.INGEST_DOWNLOAD_LIMIT ?? 2), 2),
        parseLimit: Math.min(Number(process.env.INGEST_PARSE_LIMIT ?? 1), 1),
        fullHistory,
      });
      return Response.json({ mode: 'discover', auth, fullHistory, ...result, ok: true }, { headers: { 'cache-control': 'no-store' } });
    }


    // Per-company parse only (local PDFs) — used by 数据采集「解析」.
    if (parseOnly && (codes.length || announcementIds.length)) {
      const result = await processBacklog({
        downloadLimit: 0,
        parseLimit: 1,
        codes,
        fullHistory: true,
        announcementIds,
        periods,
      });
      return Response.json({ mode: 'parse', auth, codes, periods, announcementIds, ...result, ok: true }, { headers: { 'cache-control': 'no-store' } });
    }
    // Per-company crawl. Sources page passes fullHistory to reach older than last-year H1.
    if (codes.length) {
      const result = await prioritizeCompanyCrawl(codes, {
        downloadLimit: 1,
        parseLimit: 1,
        fullHistory,
        periods,
        announcementIds,
      });
      return Response.json({ mode: 'priority', auth, fullHistory, periods, ...result, ok: true }, { headers: { 'cache-control': 'no-store' } });
    }

    const result = await processBacklog({
      downloadLimit: downloadPaused ? 0 : 1,
      parseLimit: 1,
      fullHistory,
    });
    const gaps = (!control.autoCrawlEnabled || downloadPaused)
      ? { filled: 0, codes: [] as string[] }
      : await fillCoverageGaps({ companyLimit: 2, downloadLimit: 1 });
    return Response.json({
      mode: downloadPaused ? 'paused' : (!control.autoCrawlEnabled ? 'backlog-drain' : 'backlog'),
      auth,
      paused: !control.autoCrawlEnabled,
      downloadPaused,
      note: downloadPaused
        ? '下载已暂停：排队保持不变，本轮不发起新下载。'
        : (!control.autoCrawlEnabled
          ? '自动抓取已关：不发现新公告，正在消化已有排队下载/解析。'
          : `温和模式：下载/解析各限流；本轮补发现 ${gaps.filled} 家缺口公司。`),
      ...result,
      gaps,
      ok: true,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, error: String(error) }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}
