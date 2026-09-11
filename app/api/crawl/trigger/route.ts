import { processBacklog, runIngestion } from '@/lib/ingest';
import { demoAccessEnabled, isAppUser } from '@/lib/auth';
import { isAutoCrawlEnabled } from '@/lib/ingest-control';

export const dynamic = 'force-dynamic';

function authorized(request: Request) {
  const token = process.env.INTERNAL_INGEST_TOKEN;
  const bearer = request.headers.get('authorization');
  if (token && bearer === `Bearer ${token}`) return 'token';
  if (isAppUser(request)) return 'session';
  if (demoAccessEnabled()) return 'demo';
  return null;
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

  if (!(await isAutoCrawlEnabled())) {
    return Response.json(
      {
        ok: false,
        error: '自动抓取已暂停，手动触发亦已拦截，避免交易所封控。请先在「数据源采集」开启自动抓取。',
        paused: true,
      },
      { status: 409, headers: { 'cache-control': 'no-store' } },
    );
  }

  let body: { mode?: string; codes?: string[] } = {};
  try { body = await request.json(); } catch { /* empty body ok */ }
  const discover = body.mode === 'discover' && auth === 'token';
  const codes = sanitizeCodes(body.codes);

  try {
    if (discover) {
      const result = await runIngestion({
        days: Number(process.env.INGEST_DAYS ?? 2),
        downloadLimit: Math.min(Number(process.env.INGEST_DOWNLOAD_LIMIT ?? 2), 2),
        parseLimit: Math.min(Number(process.env.INGEST_PARSE_LIMIT ?? 1), 1),
      });
      return Response.json({ ok: true, mode: 'discover', auth, ...result }, { headers: { 'cache-control': 'no-store' } });
    }
    const result = await processBacklog({
      downloadLimit: 1,
      parseLimit: 1,
      ...(codes.length ? { codes } : {}),
    });
    return Response.json({
      ok: true,
      mode: 'backlog',
      auth,
      codes: codes.length ? codes : undefined,
      note: codes.length
        ? `温和模式：仅处理 ${codes.join('、')} 的积压（每次下载 1 份、解析 1 份）。`
        : '温和模式：每次仅下载 1 份 PDF、解析 1 份；不会一次冲掉监控池。',
      ...result,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, error: String(error) }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}
