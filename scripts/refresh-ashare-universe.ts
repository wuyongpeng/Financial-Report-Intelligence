/**
 * Refresh data/ashare-universe.json from public exchange lists when reachable,
 * otherwise merge the existing seed with a small hard-coded essentials set.
 *
 * Usage:
 *   npx tsx scripts/refresh-ashare-universe.ts
 *   npm run refresh:ashare
 *
 * Row shape:
 *   code, name, short_name, exchange, board, list_date
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type Exchange = 'SSE' | 'SZSE' | 'BSE';
type Row = {
  code: string;
  name: string;
  short_name: string;
  exchange: Exchange;
  board: string;
  list_date: string;
};

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'data', 'ashare-universe.json');
const UA = 'FinanceReportIntelligence/1.0 (+ashare-universe-refresh)';

function boardOf(code: string): string {
  if (code.startsWith('688') || code.startsWith('689')) return '科创板';
  if (code.startsWith('60')) return '主板';
  if (code.startsWith('00')) return '主板';
  if (code.startsWith('30')) return '创业板';
  if (code.startsWith('8') || code.startsWith('4') || code.startsWith('92')) return '北交所';
  return '';
}

function shortNameOf(name: string): string {
  const n = name.replace(/[\s\u3000]+/g, '').trim();
  return n.replace(/[AaＡａBbＢｂHhＨｈ]$/, '');
}

function fmtListDate(value: unknown): string {
  if (value == null) return '';
  let s = String(value).trim();
  if (!s || s === '-' || s === 'None' || s === 'null') return '';
  s = s.split(' ')[0]!.replace(/\//g, '-');
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return '';
}

function enrich(row: Partial<Row> & { code: string; name: string; exchange: Exchange }): Row {
  const code = row.code.trim().padStart(6, '0');
  const name = row.name.replace(/[\s\u3000]+/g, '').trim();
  return {
    code,
    name,
    short_name: row.short_name?.trim() || shortNameOf(name),
    exchange: row.exchange,
    board: row.board?.trim() || boardOf(code),
    list_date: fmtListDate(row.list_date),
  };
}

const ESSENTIALS: Row[] = [
  enrich({ code: '600031', name: '三一重工', exchange: 'SSE' }),
  enrich({ code: '600519', name: '贵州茅台', exchange: 'SSE' }),
  enrich({ code: '601318', name: '中国平安', exchange: 'SSE' }),
  enrich({ code: '600036', name: '招商银行', exchange: 'SSE' }),
  enrich({ code: '000001', name: '平安银行', exchange: 'SZSE' }),
  enrich({ code: '000002', name: '万科A', exchange: 'SZSE' }),
  enrich({ code: '300750', name: '宁德时代', exchange: 'SZSE' }),
  enrich({ code: '002714', name: '牧原股份', exchange: 'SZSE' }),
  enrich({ code: '688802', name: '沐曦股份', exchange: 'SSE' }),
  enrich({ code: '688801', name: '燧原科技', exchange: 'SSE' }),
];

function exchangeOf(code: string): Exchange {
  // 北交所：920/821/83x/87x/43x 等；不可把 9 开头一律当沪市 B 股。
  if (code.startsWith('92') || code.startsWith('8') || code.startsWith('4')) return 'BSE';
  if (code.startsWith('6') || code.startsWith('9')) return 'SSE';
  return 'SZSE';
}

function upsert(map: Map<string, Row>, raw: Partial<Row> & { code: string; name: string; exchange?: Exchange }) {
  const code = raw.code.trim();
  if (!/^\d{6}$/.test(code)) return;
  const exchange = raw.exchange || exchangeOf(code);
  const next = enrich({ ...raw, code, exchange });
  if (!next.name) return;
  const prev = map.get(code);
  if (!prev) {
    map.set(code, next);
    return;
  }
  const prevUgly = /^C.+-U$/.test(prev.name);
  const nextUgly = /^C.+-U$/.test(next.name);
  const name =
    (prevUgly && !nextUgly) || (!nextUgly && next.name.length >= prev.name.length && next.name !== code)
      ? next.name
      : prev.name;
  map.set(code, {
    code,
    name,
    short_name: shortNameOf(name),
    exchange: prev.exchange || next.exchange,
    board: prev.board || next.board || boardOf(code),
    list_date: prev.list_date || next.list_date,
  });
}

async function loadExisting(): Promise<Row[]> {
  try {
    const raw = await readFile(OUT, 'utf8');
    const parsed = JSON.parse(raw) as Array<Partial<Row>>;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r) => r?.code && r?.name)
      .map((r) =>
        enrich({
          code: String(r.code),
          name: String(r.name),
          exchange: (r.exchange as Exchange) || exchangeOf(String(r.code)),
          short_name: r.short_name,
          board: r.board,
          list_date: r.list_date,
        }),
      );
  } catch {
    return [];
  }
}

async function fetchSse(): Promise<Row[]> {
  const out: Row[] = [];
  const seen = new Set<string>();
  for (const stockType of ['1', '8']) {
    const url =
      'https://query.sse.com.cn/security/stock/getStockListData2.do'
      + `?pageHelp.pageSize=5000&pageHelp.pageNo=1&stockType=${stockType}`;
    const res = await fetch(url, {
      headers: { 'user-agent': UA, referer: 'https://www.sse.com.cn/' },
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`SSE HTTP ${res.status} (stockType=${stockType})`);
    const json = await res.json() as {
      pageHelp?: { data?: Array<Record<string, string>> };
    };
    for (const row of json.pageHelp?.data ?? []) {
      const code = (row.SECURITY_CODE_A || row.SECURITY_CODE || '').trim();
      const name = row.SECURITY_ABBR_A || row.COMPANY_ABBR || row.SECURITY_ABBR || '';
      const list_date = row.LISTING_DATE || '';
      if (!code || seen.has(code)) continue;
      seen.add(code);
      out.push(enrich({ code, name, exchange: 'SSE', list_date }));
    }
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
      let name = row.agjc || row.A股简称 || row.zqjc || '';
      name = String(name).replace(/<[^>]+>/g, '').trim();
      const list_date = row.agssrq || '';
      if (code) {
        out.push(
          enrich({
            code: String(code).padStart(6, '0'),
            name: String(name),
            exchange: 'SZSE',
            list_date,
          }),
        );
      }
    }
    const total = Number(block?.metadata?.recordcount ?? 0);
    if (page * 20 >= total || page > 200) break;
    page += 1;
    await new Promise((r) => setTimeout(r, 250));
  }
  return out;
}

export async function refreshAshareUniverse() {
  const map = new Map<string, Row>();
  for (const row of await loadExisting()) upsert(map, row);

  const notes: string[] = [];
  // Prefer Python urllib + 东方财富（本机 Node fetch 常被交易所网关掐断）
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { join } = await import('node:path');
    const execFileAsync = promisify(execFile);
    const script = join(ROOT, 'scripts/ashare-list.py');
    let stdout = '';
    let pyExit = 0;
    try {
      const res = await execFileAsync('python3', [script], {
        maxBuffer: 32 * 1024 * 1024,
        timeout: 300_000,
      });
      stdout = String(res.stdout ?? '');
    } catch (err) {
      // Validation failure returns exit 1 but still prints JSON on stdout — keep the rows.
      const e = err as { stdout?: string | Buffer; code?: number; message?: string };
      stdout = String(e.stdout ?? '');
      pyExit = typeof e.code === 'number' ? e.code : 1;
      if (!stdout) {
        notes.push(`python-list skipped: ${e.message ?? String(err)}`);
      }
    }
    if (stdout) {
      const payload = JSON.parse(stdout) as { notes?: string[]; rows?: Row[] };
      for (const row of payload.rows ?? []) upsert(map, row);
      notes.push(
        `python-list(exit=${pyExit}): ${(payload.notes ?? []).join('; ')} → ${payload.rows?.length ?? 0}`,
      );
    }
  } catch (err) {
    notes.push(`python-list skipped: ${String(err)}`);
  }

  if ([...map.keys()].length < 1000) {
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
  }

  // Essentials last so preferred short names win over exchange "Cxxx-U" tickers.
  for (const row of ESSENTIALS) upsert(map, row);
  for (const row of map.values()) {
    if (/^C.+-U$/.test(row.name) && !ESSENTIALS.some((e) => e.code === row.code)) {
      row.name = row.name.replace(/^C/, '').replace(/-U$/, '');
      row.short_name = shortNameOf(row.name);
    }
    // Ensure derived fields always present
    row.board = row.board || boardOf(row.code);
    row.short_name = row.short_name || shortNameOf(row.name);
    row.list_date = fmtListDate(row.list_date);
  }

  const list = [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
  await writeFile(OUT, `${JSON.stringify(list, null, 2)}\n`, 'utf8');

  const byEx = { SSE: 0, SZSE: 0, BSE: 0 };
  const byBoard: Record<string, number> = {};
  let dated = 0;
  for (const r of list) {
    byEx[r.exchange] += 1;
    byBoard[r.board || '(empty)'] = (byBoard[r.board || '(empty)'] || 0) + 1;
    if (r.list_date) dated += 1;
  }
  const sample = list.find((r) => r.code === '000725');
  const summary = {
    out: OUT,
    count: list.length,
    byEx,
    byBoard,
    list_date_filled: `${dated}/${list.length}`,
    sample_000725: sample,
    notes,
  };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

const isDirect = process.argv[1]?.includes('refresh-ashare-universe');
if (isDirect) {
  refreshAshareUniverse().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
