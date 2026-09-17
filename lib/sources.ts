import type { Announcement } from './types';
import { classifyReportTitle, isFullFinancialReport } from './ingest-period';
import { ssePdfUrlFromPath } from './pdf-download';

export type SourcePage = { items: Announcement[]; rawCount: number };

const USER_AGENT = 'FinanceReportIntelligence/1.0 (+https://financial-report-intelligence.wuyongpeng.chatgpt.site)';

import * as https from 'node:https';
import { URL } from 'node:url';

/** SZSE often closes Node undici/fetch sockets; raw HTTPS/1.1 + Connection:close is reliable. */
function httpsRequestJson(url: string, init: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}): Promise<{ status: number; json: unknown }> {
  const u = new URL(url);
  const method = init.method ?? 'GET';
  const body = init.body ?? '';
  const headers: Record<string, string> = {
    'user-agent': USER_AGENT,
    accept: 'application/json, text/plain, */*',
    connection: 'close',
    ...(init.headers ?? {}),
  };
  if (body && !headers['content-length']) headers['content-length'] = String(Buffer.byteLength(body));
  return new Promise((resolve, reject) => {
    const req = https.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || 443,
      path: `${u.pathname}${u.search}`,
      method,
      headers,
      servername: u.hostname,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          reject(new Error(`${status} ${res.statusMessage ?? ''}`.trim()));
          return;
        }
        try { resolve({ status, json: raw ? JSON.parse(raw) : null }); }
        catch { reject(new Error('Invalid JSON from source')); }
      });
    });
    req.setTimeout(init.timeoutMs ?? 15000, () => {
      req.destroy(new Error('Timeout'));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}


function dateOnly(daysAgo = 0) {
  const date = new Date(Date.now() - daysAgo * 86400000);
  return date.toISOString().slice(0, 10);
}

function classify(title: string): Announcement['reportType'] {
  return classifyReportTitle(title);
}

async function safeFetch(url: string, init: RequestInit, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchCninfo(days = 2, page = 1, pageSize = 200): Promise<SourcePage> {
  const form = new URLSearchParams({
    pageNum: String(page), pageSize: String(pageSize), column: 'szse', tabName: 'fulltext',
    plate: '', stock: '', searchkey: '', secid: '',
    category: 'category_ndbg_szsh;category_bndbg_szsh;category_yjdbg_szsh;category_sjdbg_szsh',
    trade: '', seDate: `${dateOnly(days)}~${dateOnly()}`, sortName: '', sortType: '', isHLtitle: 'true',
  });
  const response = await safeFetch('https://www.cninfo.com.cn/new/hisAnnouncement/query', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', referer: 'https://www.cninfo.com.cn/', 'user-agent': USER_AGENT }, body: form,
  });
  const payload = await response.json() as { announcements?: Array<Record<string, unknown>> };
  const raw = payload.announcements ?? [];
  const items = raw.map((item) => {
    const title = String(item.announcementTitle ?? '').replace(/<[^>]+>/g, '');
    return {
      source: 'CNINFO' as const,
      sourceId: String(item.announcementId ?? ''), code: String(item.secCode ?? ''), name: String(item.secName ?? ''), title,
      publishedAt: new Date(Number(item.announcementTime ?? Date.now())).toISOString(),
      pdfUrl: `https://static.cninfo.com.cn/${String(item.adjunctUrl ?? '').replace(/^\//, '')}`,
      reportType: classify(title),
    };
  }).filter((item) => item.sourceId && item.code && isFullFinancialReport(item.title));
  return { items, rawCount: raw.length };
}

export async function fetchSse(days = 2, page = 1, pageSize = 200, stockCode?: string): Promise<SourcePage> {
  const params = new URLSearchParams({
    isPagination: 'true',
    // 单票：productId=代码可直接拉该公司公告（含年报/中报 PDF 上交所路径）
    productId: stockCode ?? '',
    keyWord: stockCode ? '' : '报告',
    securityType: '0101,120100,020100,020200,120200',
    'pageHelp.pageSize': String(pageSize), 'pageHelp.pageCount': '50', 'pageHelp.pageNo': String(page),
    'pageHelp.beginPage': '1', 'pageHelp.cacheSize': '1', 'pageHelp.endPage': '5',
    beginDate: dateOnly(days), endDate: dateOnly(),
  });
  const response = await safeFetch(`https://query.sse.com.cn/security/stock/queryCompanyBulletin.do?${params}`, {
    headers: { referer: 'https://www.sse.com.cn/', 'user-agent': USER_AGENT },
  });
  const payload = await response.json() as { result?: Array<Record<string, unknown>>; pageHelp?: { data?: Array<Record<string, unknown>> } };
  const raw = payload.result ?? payload.pageHelp?.data ?? [];
  const items = raw.map((item) => {
    const title = String(item.TITLE ?? '');
    const path = String(item.URL ?? '');
    const code = String(item.SECURITY_CODE ?? stockCode ?? '');
    return {
      source: 'SSE' as const, sourceId: path || `${code}-${item.SSEDATE}-${title}`,
      code, name: String(item.SECURITY_NAME ?? ''), title,
      publishedAt: new Date(`${String(item.SSEDATE ?? dateOnly())}T00:00:00+08:00`).toISOString(),
      pdfUrl: ssePdfUrlFromPath(path), reportType: classify(title),
    };
  }).filter((item) => item.code && item.pdfUrl && isFullFinancialReport(item.title));
  return { items, rawCount: raw.length };
}

/** SZSE: prefer Python urllib (Node fetch/curl often hang up / empty reply). */
export async function fetchSzsePayload(body: Record<string, unknown>): Promise<{ data?: Array<Record<string, unknown>>; announceCount?: number }> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { join } = await import('node:path');
  const execFileAsync = promisify(execFile);
  const payloadJson = JSON.stringify(body);
  const candidates = [
    join(process.cwd(), 'scripts/szse-annlist.py'),
    'scripts/szse-annlist.py',
  ];
  let lastErr: unknown;
  for (const file of candidates) {
    try {
      const { stdout } = await execFileAsync('python3', [file, payloadJson], {
        maxBuffer: 12 * 1024 * 1024,
        timeout: 20000,
      });
      return JSON.parse(String(stdout)) as { data?: Array<Record<string, unknown>>; announceCount?: number };
    } catch (error) {
      lastErr = error;
    }
  }
  try {
    const { json } = await httpsRequestJson('https://www.szse.cn/api/disc/announcement/annList', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        referer: 'https://www.szse.cn/disclosure/listed/notice/index.html',
        origin: 'https://www.szse.cn',
      },
      body: payloadJson,
      timeoutMs: 18000,
    });
    return json as { data?: Array<Record<string, unknown>>; announceCount?: number };
  } catch (error) {
    throw lastErr ?? error;
  }
}

export async function fetchSzse(days = 2, page = 1, pageSize = 200, stockCode?: string): Promise<SourcePage> {
  const body: Record<string, unknown> = {
    seDate: [dateOnly(days), dateOnly()],
    channelCode: ['listedNotice_disc'],
    pageSize,
    pageNum: page,
  };
  // 单票查询必须带 stock，否则全市场列表易被网关掐断；也更符合「交易所优先」
  if (stockCode) body.stock = [stockCode];
  const payload = await fetchSzsePayload(body);
  const raw = payload.data ?? [];
  const items = raw.map((item) => {
    const title = String(item.title ?? '');
    const codes = Array.isArray(item.secCode) ? item.secCode : [];
    const names = Array.isArray(item.secName) ? item.secName : [];
    const path = String(item.attachPath ?? '');
    const code = String(codes[0] ?? stockCode ?? '');
    return {
      source: 'SZSE' as const, sourceId: String(item.annId ?? item.id ?? path), code, name: String(names[0] ?? ''), title,
      publishedAt: new Date(`${String(item.publishTime ?? '').replace(' ', 'T')}+08:00`).toISOString(),
      pdfUrl: path.startsWith('http') ? path : `https://disc.static.szse.cn/download${path}`, reportType: classify(title),
    };
  }).filter((item) => item.sourceId && item.code && item.pdfUrl && isFullFinancialReport(item.title));
  return { items, rawCount: raw.length || Number(payload.announceCount ?? 0) || items.length };
}

/** Best-effort 北交所列表；失败则记入 health，单票仍走巨潮兜底。 */
export async function fetchBse(days = 2, page = 1, pageSize = 50): Promise<SourcePage> {
  // BSE disclosure API surface changes often; keep polite empty on failure so CNINFO can cover.
  try {
    const response = await safeFetch(
      `https://www.bse.cn/articlePage/list.do?page=${page}&pageSize=${pageSize}`,
      { headers: { referer: 'https://www.bse.cn/', 'user-agent': USER_AGENT } },
      10000,
    );
    const text = await response.text();
    // If HTML/login wall, treat as no items rather than throwing the whole poll.
    if (text.trim().startsWith('<') || text.includes('登录')) {
      return { items: [], rawCount: 0 };
    }
    let payload: { data?: Array<Record<string, unknown>>; list?: Array<Record<string, unknown>> } = {};
    try { payload = JSON.parse(text); } catch { return { items: [], rawCount: 0 }; }
    const raw = payload.data ?? payload.list ?? [];
    const items = raw.map((item) => {
      const title = String(item.title ?? item.TITLE ?? '');
      const code = String(item.secCode ?? item.code ?? item.SECURITY_CODE ?? '');
      const path = String(item.attachPath ?? item.url ?? item.URL ?? '');
      return {
        source: 'BSE' as const,
        sourceId: String(item.id ?? item.annId ?? (path || `${code}-${title}`)),
        code,
        name: String(item.secName ?? item.name ?? ''),
        title,
        publishedAt: new Date().toISOString(),
        pdfUrl: path.startsWith('http') ? path : `https://www.bse.cn${path}`,
        reportType: classify(title),
      };
    }).filter((item) => item.code && item.pdfUrl && isFullFinancialReport(item.title));
    return { items, rawCount: raw.length };
  } catch {
    return { items: [], rawCount: 0 };
  }
}

function pagePauseMs() {
  const base = Number(process.env.PAGE_PAUSE_MS ?? 1000);
  return Number.isFinite(base) ? Math.max(250, base) : 1000;
}

function withJitter(ms: number) {
  const jitter = Math.floor(Math.random() * Math.min(500, Math.max(100, ms * 0.4)));
  return ms + jitter;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sequential source polling — never fan out all exchanges at once (anti-ban). */
export async function fetchAllSources(days = 2) {
  const budget = Number(process.env.INGEST_MAX_PAGES ?? 8);
  const maxPages = Number.isInteger(budget) ? Math.min(Math.max(budget, 1), 40) : 8;
  const pause = pagePauseMs();
  const announcements: Announcement[] = [];
  const health: Record<string, { ok: boolean; count: number; error?: string }> = {};
  // Exchange-first, 巨潮兜底 (anti-ban: sequential, never fan-out).
  const jobs: Array<[string, (page: number) => Promise<SourcePage>]> = [
    ['SSE', (page) => fetchSse(days, page)],
    ['SZSE', (page) => fetchSzse(days, page)],
    ['BSE', (page) => fetchBse(days, page)],
    ['CNINFO', (page) => fetchCninfo(days, page)],
  ];
  for (let i = 0; i < jobs.length; i++) {
    const [source, fetchPage] = jobs[i];
    try {
      const result = await collectPages(fetchPage, maxPages, pause);
      announcements.push(...result.items);
      health[source] = {
        ok: result.complete,
        count: result.items.length,
        ...(result.complete ? {} : { error: result.error ?? 'Pagination incomplete; retry required' }),
      };
    } catch (error) {
      health[source] = { ok: false, count: 0, error: String(error) };
    }
    if (i < jobs.length - 1) await sleep(withJitter(pause));
  }
  return { announcements, health };
}

// Do not infer completion from the filtered report count: an entire page can
// contain unrelated announcements. A page cap is reported as incomplete.
export async function collectPages(fetchPage: (page: number) => Promise<SourcePage>, maxPages = 8, pauseMs = pagePauseMs()) {
  const unique = new Map<string, Announcement>();
  for (let page = 1; page <= maxPages; page++) {
    let result: SourcePage;
    try { result = await fetchPage(page); }
    catch { return { items: [...unique.values()], complete: false, error: `Page ${page} failed` }; }
    if (!result.rawCount) return { items: [...unique.values()], complete: true };
    const before = unique.size;
    for (const item of result.items) unique.set(`${item.source}:${item.sourceId}`, item);
    if (result.items.length && unique.size === before) return { items: [...unique.values()], complete: false, error: 'Source returned a repeated page' };
    if (page < maxPages && pauseMs) await sleep(withJitter(pauseMs));
  }
  return { items: [...unique.values()], complete: false, error: 'Pagination budget reached' };
}


async function resolveCninfoOrgId(code: string): Promise<string | null> {
  try {
    const response = await safeFetch('https://www.cninfo.com.cn/new/information/topSearch/query', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        referer: 'https://www.cninfo.com.cn/',
        'user-agent': USER_AGENT,
      },
      body: new URLSearchParams({ keyWord: code, maxNum: '8', plate: '' }),
    }, 12000);
    const matches = await response.json() as Array<{ code?: string; orgId?: string }>;
    const hit = Array.isArray(matches) ? matches.find((item) => item.code === code) : null;
    return hit?.orgId ? String(hit.orgId) : null;
  } catch {
    return null;
  }
}

/** Prefer exchange hits for this code (stock-scoped APIs), then CNINFO orgId 兜底. */
async function fetchExchangeReportsForCode(code: string, days: number): Promise<Announcement[]> {
  const exchange = code.startsWith('6') || code.startsWith('9') ? 'SSE'
    : code.startsWith('8') || code.startsWith('4') ? 'BSE'
      : 'SZSE';
  try {
    const windowDays = Math.min(Math.max(days, 180), 800);
    if (exchange === 'SSE') {
      const page = await fetchSse(windowDays, 1, 50, code);
      return page.items.filter((item) => item.code === code);
    }
    if (exchange === 'SZSE') {
      const page = await fetchSzse(windowDays, 1, 50, code);
      return page.items.filter((item) => item.code === code);
    }
    const page = await fetchBse(windowDays, 1, 50);
    return page.items.filter((item) => item.code === code);
  } catch {
    return [];
  }
}

function cninfoAnnouncementFromRaw(raw: Record<string, unknown>, fallback: { code: string; name: string }): Announcement | null {
  const title = String(raw.announcementTitle ?? '').replace(/<[^>]+>/g, '');
  const item: Announcement = {
    source: 'CNINFO',
    sourceId: String(raw.announcementId ?? ''),
    code: String(raw.secCode ?? fallback.code),
    name: String(raw.secName ?? fallback.name),
    title,
    publishedAt: new Date(Number(raw.announcementTime ?? Date.now())).toISOString(),
    pdfUrl: `https://static.cninfo.com.cn/${String(raw.adjunctUrl ?? '').replace(/^\//, '')}`,
    reportType: classify(title),
  };
  if (!item.sourceId || !item.code || !item.pdfUrl.includes('cninfo') || !isFullFinancialReport(item.title)) return null;
  return item;
}

/** 巨潮按代码拉年报/中报/季报，供交易所 PDF 失败时兜底。 */
export async function fetchCninfoReportsForCode(code: string, name: string, days = 400): Promise<Announcement[]> {
  const orgId = await resolveCninfoOrgId(code);
  if (!orgId) return [];
  const column = code.startsWith('6') || code.startsWith('9') ? 'sse' : 'szse';
  const found: Announcement[] = [];
  for (const pageNum of [1, 2]) {
    const form = new URLSearchParams({
      pageNum: String(pageNum), pageSize: '50', column, tabName: 'fulltext',
      plate: '', stock: `${code},${orgId}`, searchkey: '', secid: '',
      category: 'category_ndbg_szsh;category_bndbg_szsh;category_yjdbg_szsh;category_sjdbg_szsh',
      trade: '', seDate: `${dateOnly(days)}~${dateOnly()}`, sortName: '', sortType: '', isHLtitle: 'true',
    });
    try {
      const response = await safeFetch('https://www.cninfo.com.cn/new/hisAnnouncement/query', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
          referer: 'https://www.cninfo.com.cn/',
          'user-agent': USER_AGENT,
        },
        body: form,
      }, 15000);
      const payload = await response.json() as { announcements?: Array<Record<string, unknown>> };
      const raw = payload.announcements ?? [];
      for (const row of raw) {
        const item = cninfoAnnouncementFromRaw(row, { code, name });
        if (item && item.code === code) found.push(item);
      }
      if (!raw.length) break;
    } catch {
      break;
    }
  }
  return found;
}

/**
 * Targeted discovery for one monitored code.
 * Order: exchange (SSE/SZSE/BSE) first, then 巨潮 orgId 兜底.
 * `days` is the CNINFO seDate window. Period cutoff is applied by ingest.ts.
 */
export async function fetchReportsForCode(code: string, name: string, days = 400): Promise<Announcement[]> {
  const unique = new Map<string, Announcement>();
  for (const item of await fetchExchangeReportsForCode(code, days)) {
    unique.set(`${item.source}:${item.sourceId}`, item);
  }
  for (const item of await fetchCninfoReportsForCode(code, name, days)) {
    unique.set(`${item.source}:${item.sourceId}`, item);
  }
  return [...unique.values()];
}
