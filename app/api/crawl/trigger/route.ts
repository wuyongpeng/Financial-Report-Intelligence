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
  const autoOn = control.autoCrawlEnabled;
  const envDownload = Math.min(Number(process.env.INGEST_DOWNLOAD_LIMIT ?? 2), 2);
  const envParse = Math.min(Number(process.env.INGEST_PARSE_LIMIT ?? 1), 1);

  try {
    if (discover) {
      const result = await runIngestion({
        days: Number(process.env.INGEST_DAYS ?? 2),
        downloadLimit: autoOn ? envDownload : 0,
        parseLimit: envParse,
        fullHistory,
      });
      return Response.json({ mode: 'discover', auth, fullHistory, autoCrawlEnabled: autoOn, ...result, ok: true }, { headers: { 'cache-control': 'no-store' } });
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
    // Per-company crawl. Manual 抓取 still downloads even when auto crawl is off.
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
      downloadLimit: autoOn ? 1 : 0,
      parseLimit: 1,
      fullHistory,
    });
    const gaps = await fillCoverageGaps({ companyLimit: autoOn ? 8 : 4, downloadLimit: 0 });
    return Response.json({
      mode: autoOn ? 'backlog' : 'scan-hold-download',
      auth,
      paused: !autoOn,
      autoCrawlEnabled: autoOn,
      downloadPaused: !autoOn,
      note: autoOn
        ? (gaps.bootstrapComplete
          ? '已完成全量补齐，之后只扫最近 2 天公告。'
          : `全量补齐中：本轮检索 ${gaps.filled} 家缺口公司（仍缺 ${gaps.missingPeriods ?? 0} 个 2025Q1+ 期次）。`)
        : '自动抓取已关：仍扫描新公告与缺口期次；下载中的任务会完成，排队任务不再自动开始下载。',
      ...result,
      gaps,
      ok: true,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, error: String(error) }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}
