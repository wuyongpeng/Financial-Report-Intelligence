import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ashareUniverse from '@/data/ashare-universe.json';
import { demoAccessEnabled, isAppUser } from '@/lib/auth';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Listed = { code: string; name: string; exchange: 'SSE' | 'SZSE' };
type CompanyFileRow = {
  rank: number;
  code: string;
  name: string;
  exchange: 'SSE' | 'SZSE';
  industry: string;
  sector?: string;
  theme?: string;
  heat?: 'S' | 'A' | 'B';
  weight: number;
};

function authorized(request: Request) {
  const token = process.env.INTERNAL_INGEST_TOKEN;
  const bearer = request.headers.get('authorization');
  if (token && bearer === `Bearer ${token}`) return true;
  if (isAppUser(request)) return true;
  if (demoAccessEnabled()) return true;
  return false;
}

function companiesJsonPath() {
  return path.join(process.cwd(), 'data', 'companies.json');
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { code?: string } = {};
  try { body = await request.json(); } catch { /* empty */ }
  const code = String(body.code ?? '').trim();
  if (!/^\d{6}$/.test(code)) {
    return Response.json({ error: '请提供六位股票代码' }, { status: 400 });
  }

  const listed = (ashareUniverse as Listed[]).find((item) => item.code === code);
  if (!listed) {
    return Response.json({ error: '未在 A 股识别名录中找到该代码，拒绝加入' }, { status: 404 });
  }

  const exchange = listed.exchange ?? (code.startsWith('6') || code.startsWith('9') ? 'SSE' : 'SZSE');
  const now = new Date().toISOString();

  // Persist into companies.json so later seed/bootstrap does not disable it.
  const filePath = companiesJsonPath();
  const raw = await readFile(filePath, 'utf8');
  const rows = JSON.parse(raw) as CompanyFileRow[];
  const existing = rows.find((row) => row.code === code);
  if (!existing) {
    const nextRank = rows.reduce((max, row) => Math.max(max, row.rank || 0), 0) + 1;
    rows.push({
      rank: nextRank,
      code,
      name: listed.name,
      exchange,
      industry: '待分类',
      sector: '其他',
      theme: '待分类',
      heat: 'B',
      weight: 60,
    });
    rows.sort((a, b) => a.rank - b.rank || a.code.localeCompare(b.code));
    await writeFile(filePath, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
  }

  const db = getDb();
  const rank = existing?.rank ?? rows.find((row) => row.code === code)?.rank ?? 999;
  const weight = existing?.weight ?? 60;
  const industry = existing?.industry ?? '待分类';

  await db`
    INSERT INTO companies (code, name, exchange, industry, rank, weight, enabled, created_at, updated_at)
    VALUES (${code}, ${listed.name}, ${exchange}, ${industry}, ${rank}, ${weight}, true, ${now}, ${now})
    ON CONFLICT (code) DO UPDATE SET
      name=EXCLUDED.name,
      exchange=EXCLUDED.exchange,
      industry=COALESCE(companies.industry, EXCLUDED.industry),
      rank=EXCLUDED.rank,
      weight=EXCLUDED.weight,
      enabled=true,
      updated_at=EXCLUDED.updated_at
  `;

  const enabled = await db<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM companies WHERE enabled=true`;

  return Response.json({
    ok: true,
    company: { code, name: listed.name, exchange, industry, rank, weight },
    enabledCount: enabled[0]?.n ?? null,
    note: `已将「${listed.name}」加入监控池`,
  }, { headers: { 'cache-control': 'no-store' } });
}
