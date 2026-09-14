/**
 * Refresh data/ashare-universe.json from public exchange lists when reachable,
 * otherwise merge the existing seed with a small hard-coded essentials set.
 *
 * Usage:
 *   npx tsx scripts/refresh-ashare-universe.ts
 *   npm run refresh:ashare   # if wired in package.json
 *
 * Notes:
 * - SSE list: query.sse.com.cn (A shares, stockType=1; STAR/科创板 688xxx merged via essentials + refresh)
 * - SZSE list: www.szse.cn report API (best-effort; may fail behind some networks)
 * - Always preserves existing entries and ensures essentials (e.g. 三一重工/600031)
 * - Recognition universe ≠ monitor pool (companies.json). Home search uses this file
 *   only to identify listed names/codes; watch/join still goes through /api/companies/watch.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type Row = { code: string; name: string; exchange: 'SSE' | 'SZSE' };

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'data', 'ashare-universe.json');
const UA = 'FinanceReportIntelligence/1.0 (+ashare-universe-refresh)';

const ESSENTIALS: Row[] = [
  { code: '600031', name: '三一重工', exchange: 'SSE' },
  { code: '600519', name: '贵州茅台', exchange: 'SSE' },
  { code: '601318', name: '中国平安', exchange: 'SSE' },
  { code: '600036', name: '招商银行', exchange: 'SSE' },
  { code: '000001', name: '平安银行', exchange: 'SZSE' },
  { code: '000002', name: '万科A', exchange: 'SZSE' },
  { code: '300750', name: '宁德时代', exchange: 'SZSE' },
  { code: '002714', name: '牧原股份', exchange: 'SZSE' },
  { code: '688802', name: '沐曦股份', exchange: 'SSE' }, // STAR / 科创板 newly listed
];

function exchangeOf(code: string): 'SSE' | 'SZSE' {
  return code.startsWith('6') || code.startsWith('9') ? 'SSE' : 'SZSE';
}

function normalizeName(name: string) {
  return name.replace(/\s+/g, '').replace(/　/g, '').trim();
}

function upsert(map: Map<string, Row>, row: Row) {
  const code = row.code.trim();
  if (!/^\d{6}$/.test(code)) return;
  const name = normalizeName(row.name);
  if (!name) return;
  const exchange = row.exchange || exchangeOf(code);
  const prev = map.get(code);
  if (!prev || (name.length >= prev.name.length && name !== code)) {
    map.set(code, { code, name, exchange });
  }
}

async function loadExisting(): Promise<Row[]> {
  try {
    const raw = await readFile(OUT, 'utf8');
    const parsed = JSON.parse(raw) as Row[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function fetchSse(): Promise<Row[]> {
  const url =
    'https://query.sse.com.cn/security/stock/getStockListData2.do'
    + '?pageHelp.pageSize=5000&pageHelp.pageNo=1&stockType=1';
  const res = await fetch(url, {
    headers: { 'user-agent': UA, referer: 'https://www.sse.com.cn/' },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`SSE HTTP ${res.status}`);
  const json = await res.json() as {
    pageHelp?: { total?: number; data?: Array<Record<string, string>> };
  };
  const rows = json.pageHelp?.data ?? [];
  const out: Row[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const code = (row.SECURITY_CODE_A || row.SECURITY_CODE || '').trim();
    const name = row.SECURITY_ABBR_A || row.COMPANY_ABBR || row.SECURITY_ABBR || '';
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push({ code, name, exchange: 'SSE' });
  }
  return out;
}

async function fetchSzse(): Promise<Row[]> {
  const out: Row[] = [];
  let page = 1;
  for (;;) {
    const url =
      `https://www.szse.cn/api/report/ShowReport/data`
      + `?SHOWTYPE=JSON&CATALOGID=1110&TABKEY=tab1&PAGENO=${page}`;
    const res = await fetch(url, {
      headers: { 'user-agent': UA, referer: 'https://www.szse.cn/' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) throw new Error(`SZSE HTTP ${res.status}`);
    const json = await res.json() as Array<{
      data?: Array<Record<string, string>>;
      metadata?: { recordcount?: number };
    }>;
    const block = Array.isArray(json) ? json[0] : null;
    const rows = block?.data ?? [];
    if (!rows.length) break;
    for (const row of rows) {
      const code = row.agdm || row.A股代码 || row.zqdm || '';
      const name = row.agjc || row.A股简称 || row.zqjc || '';
      if (code) out.push({ code: String(code).padStart(6, '0'), name: String(name), exchange: 'SZSE' });
    }
    const total = Number(block?.metadata?.recordcount ?? 0);
    if (page * 20 >= total || page > 200) break;
    page += 1;
    await new Promise((r) => setTimeout(r, 250));
  }
  return out;
}

async function main() {
  const map = new Map<string, Row>();
  for (const row of await loadExisting()) upsert(map, row);
  for (const row of ESSENTIALS) upsert(map, row);

  const notes: string[] = [];
  try {
    const sse = await fetchSse();
    for (const row of sse) upsert(map, row);
    notes.push(`SSE fetched ${sse.length}`);
  } catch (err) {
    notes.push(`SSE skipped: ${String(err)}`);
  }

  try {
    const szse = await fetchSzse();
    for (const row of szse) upsert(map, row);
    notes.push(`SZSE fetched ${szse.length}`);
  } catch (err) {
    notes.push(`SZSE skipped: ${String(err)}`);
  }

  const list = [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
  await writeFile(OUT, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
  const sanyi = list.find((r) => r.code === '600031');
  console.log(JSON.stringify({
    out: OUT,
    count: list.length,
    notes,
    sanyi,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
