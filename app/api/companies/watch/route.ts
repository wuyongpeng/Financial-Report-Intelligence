import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ashareUniverse from '@/data/ashare-universe.json';
import { demoAccessEnabled, isAppUser } from '@/lib/auth';
import { classifyCompany } from '@/lib/company-classify';
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

function exchangeOf(code: string): 'SSE' | 'SZSE' {
  return code.startsWith('6') || code.startsWith('9') ? 'SSE' : 'SZSE';
}

function normalizeName(name: string) {
  return name.replace(/\s+/g, '').replace(/　/g, '').trim();
}

/** Best-effort public name lookup when user only supplies a 6-digit code. */
async function lookupName(code: string, exchange: 'SSE' | 'SZSE'): Promise<string | null> {
  try {
    if (exchange === 'SSE') {
      const url =
        'https://query.sse.com.cn/commonQuery.do'
        + `?jsonCallBack=jsonp&isPagination=false&sqlId=COMMON_SSE_ZQPZ_GP_GPLB_AG_L`
        + `&securityCodeA=${code}`;
      const res = await fetch(url, {
        headers: { 'user-agent': 'FinanceReportIntelligence/1.0', referer: 'https://www.sse.com.cn/' },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return null;
      const text = await res.text();
      const m = text.match(/"SECURITY_ABBR_A"\s*:\s*"([^"]+)"/)
        ?? text.match(/"COMPANY_ABBR"\s*:\s*"([^"]+)"/);
      return m ? normalizeName(m[1]) : null;
    }
    const url =
      `https://www.szse.cn/api/report/ShowReport/data`
      + `?SHOWTYPE=JSON&CATALOGID=1110&TABKEY=tab1&txtZqdm=${code}`;
    const res = await fetch(url, {
      headers: { 'user-agent': 'FinanceReportIntelligence/1.0', referer: 'https://www.szse.cn/' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const json = await res.json() as Array<{ data?: Array<Record<string, string>> }>;
    const rows = Array.isArray(json) ? (json[0]?.data ?? []) : [];
    const hit = rows.find((row) => String(row.agdm || row.zqdm || '').padStart(6, '0') === code);
    const name = hit?.agjc || hit?.zqjc || '';
    return name ? normalizeName(String(name)) : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { code?: string; name?: string } = {};
  try { body = await request.json(); } catch { /* empty */ }
  const code = String(body.code ?? '').trim();
  const providedName = normalizeName(String(body.name ?? ''));
  if (!/^\d{6}$/.test(code)) {
    return Response.json({ error: '请提供六位股票代码' }, { status: 400 });
  }

  const listed = (ashareUniverse as Listed[]).find((item) => item.code === code);
  const exchange = listed?.exchange ?? exchangeOf(code);

  let name = providedName || listed?.name || '';
  if (!name) {
    name = (await lookupName(code, exchange)) ?? '';
  }
  if (!name) {
    return Response.json({
      error: '该代码不在识别名录中，请同时提供公司简称（name）后再加入',
      needName: true,
      code,
    }, { status: 400 });
  }

  const now = new Date().toISOString();
  let classified: { industry: string; sector: string; source: string };
  try {
    classified = await classifyCompany({ code, name, exchange });
  } catch {
    classified = { industry: '待分类', sector: '其他', source: 'fallback' };
  }

  // Optional seed sync only. Runtime watchlist is the companies table.
  let existing: CompanyFileRow | undefined;
  let rows: CompanyFileRow[] = [];
  try {
    const filePath = companiesJsonPath();
    const raw = await readFile(filePath, 'utf8');
    rows = JSON.parse(raw) as CompanyFileRow[];
    existing = rows.find((row) => row.code === code);
    const untagged = !existing?.industry || existing.industry === '待分类';
    if (!existing) {
      const nextRank = rows.reduce((max, row) => Math.max(max, row.rank || 0), 0) + 1;
      rows.push({
        rank: nextRank,
        code,
        name,
        exchange,
        industry: classified.industry,
        sector: classified.sector,
        theme: classified.industry,
        heat: 'B',
        weight: 60,
      });
      rows.sort((a, b) => a.rank - b.rank || a.code.localeCompare(b.code));
      await writeFile(filePath, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
      existing = rows.find((row) => row.code === code);
    } else {
      let dirty = false;
      if (providedName && existing.name !== providedName) {
        existing.name = providedName;
        dirty = true;
      }
      if (untagged && classified.industry !== '待分类') {
        existing.industry = classified.industry;
        existing.sector = classified.sector;
        existing.theme = classified.industry;
        dirty = true;
      }
      if (dirty) await writeFile(filePath, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
    }
  } catch {
    /* non-fatal — Docker worker may not share this file */
  }

  // Best-effort: enrich local recognition universe for next search.
  try {
    const universePath = path.join(process.cwd(), 'data', 'ashare-universe.json');
    const universe = JSON.parse(await readFile(universePath, 'utf8')) as Listed[];
    if (!universe.some((row) => row.code === code)) {
      universe.push({ code, name, exchange });
      universe.sort((a, b) => a.code.localeCompare(b.code));
      await writeFile(universePath, `${JSON.stringify(universe, null, 2)}\n`, 'utf8');
    }
  } catch {
    /* non-fatal */
  }

  const db = getDb();
  const rank = existing?.rank ?? rows.find((row) => row.code === code)?.rank ?? 999;
  const weight = existing?.weight ?? 60;
  const untaggedDb = !existing?.industry || existing.industry === '待分类';
  const industry = untaggedDb ? classified.industry : (existing?.industry ?? classified.industry);
  const finalName = existing && !providedName ? existing.name : name;

  await db`
    INSERT INTO companies (code, name, exchange, industry, rank, weight, enabled, created_at, updated_at)
    VALUES (${code}, ${finalName}, ${exchange}, ${industry}, ${rank}, ${weight}, true, ${now}, ${now})
    ON CONFLICT (code) DO UPDATE SET
      name=EXCLUDED.name,
      exchange=EXCLUDED.exchange,
      industry=CASE
        WHEN companies.industry IS NULL OR companies.industry IN ('', '待分类') THEN EXCLUDED.industry
        ELSE companies.industry
      END,
      rank=EXCLUDED.rank,
      weight=EXCLUDED.weight,
      enabled=true,
      updated_at=EXCLUDED.updated_at
  `;

  const enabled = await db<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM companies WHERE enabled=true`;

  return Response.json({
    ok: true,
    company: {
      code,
      name: finalName,
      exchange,
      industry,
      sector: untaggedDb ? classified.sector : (existing?.sector ?? classified.sector),
      rank,
      weight,
    },
    enabledCount: enabled[0]?.n ?? null,
    fromUniverse: Boolean(listed),
    tagSource: classified.source,
    note: `已将「${finalName}」加入监控池`,
  }, { headers: { 'cache-control': 'no-store' } });
}
