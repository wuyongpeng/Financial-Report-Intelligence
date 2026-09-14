import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { demoAccessEnabled, isAppUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

type ReportRow = {
  at: string;
  query: string;
  code?: string;
  name?: string;
  note?: string;
};

function authorized(request: Request) {
  const token = process.env.INTERNAL_INGEST_TOKEN;
  const bearer = request.headers.get('authorization');
  if (token && bearer === `Bearer ${token}`) return true;
  if (isAppUser(request)) return true;
  if (demoAccessEnabled()) return true;
  return false;
}

function queuePath() {
  return path.join(process.cwd(), 'data', 'missing-company-reports.json');
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { query?: string; code?: string; name?: string; note?: string } = {};
  try { body = await request.json(); } catch { /* empty */ }

  const query = String(body.query ?? '').trim().slice(0, 200);
  const code = String(body.code ?? '').trim();
  const name = String(body.name ?? '').trim().slice(0, 64);
  const note = String(body.note ?? '').trim().slice(0, 300);
  if (!query && !code && !name) {
    return Response.json({ error: '请提供搜索词或代码后再上报' }, { status: 400 });
  }
  if (code && !/^\d{6}$/.test(code)) {
    return Response.json({ error: '代码须为六位数字' }, { status: 400 });
  }

  const row: ReportRow = {
    at: new Date().toISOString(),
    query: query || (code ? `代码 ${code}` : name),
    ...(code ? { code } : {}),
    ...(name ? { name } : {}),
    ...(note ? { note } : {}),
  };

  const file = queuePath();
  await mkdir(path.dirname(file), { recursive: true });
  let rows: ReportRow[] = [];
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as ReportRow[];
    if (Array.isArray(parsed)) rows = parsed;
  } catch {
    rows = [];
  }
  rows.push(row);
  // Keep the queue lightweight
  if (rows.length > 500) rows = rows.slice(-500);
  await writeFile(file, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');

  return Response.json({
    ok: true,
    note: '已上报给管理员，感谢反馈',
  }, { headers: { 'cache-control': 'no-store' } });
}
