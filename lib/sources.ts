import type { Announcement } from './types';

const USER_AGENT = 'FinanceReportIntelligence/1.0 (+https://financial-report-intelligence.wuyongpeng.chatgpt.site)';

function dateOnly(daysAgo = 0) {
  const date = new Date(Date.now() - daysAgo * 86400000);
  return date.toISOString().slice(0, 10);
}

function classify(title: string): Announcement['reportType'] {
  if (/半年度报告(?!摘要)/.test(title)) return 'semiannual';
  if (/年度报告(?!摘要)/.test(title)) return 'annual';
  if (/(第一季度|第三季度|季度)报告(?!摘要)/.test(title)) return 'quarterly';
  return 'other';
}

function isFullFinancialReport(title: string) {
  return !/摘要|取消|英文版/.test(title) && classify(title) !== 'other';
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

export async function fetchCninfo(days = 2, page = 1, pageSize = 200): Promise<Announcement[]> {
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
  return (payload.announcements ?? []).map((item) => {
    const title = String(item.announcementTitle ?? '').replace(/<[^>]+>/g, '');
    return {
      source: 'CNINFO' as const,
      sourceId: String(item.announcementId ?? ''), code: String(item.secCode ?? ''), name: String(item.secName ?? ''), title,
      publishedAt: new Date(Number(item.announcementTime ?? Date.now())).toISOString(),
      pdfUrl: `https://static.cninfo.com.cn/${String(item.adjunctUrl ?? '').replace(/^\//, '')}`,
      reportType: classify(title),
    };
  }).filter((item) => item.sourceId && item.code && isFullFinancialReport(item.title));
}

export async function fetchSse(days = 2, pageSize = 200): Promise<Announcement[]> {
  const params = new URLSearchParams({
    isPagination: 'true', productId: '', keyWord: '报告', securityType: '0101,120100,020100,020200,120200',
    'pageHelp.pageSize': String(pageSize), 'pageHelp.pageCount': '50', 'pageHelp.pageNo': '1',
    'pageHelp.beginPage': '1', 'pageHelp.cacheSize': '1', 'pageHelp.endPage': '5', beginDate: dateOnly(days), endDate: dateOnly(),
  });
  const response = await safeFetch(`https://query.sse.com.cn/security/stock/queryCompanyBulletin.do?${params}`, {
    headers: { referer: 'https://www.sse.com.cn/', 'user-agent': USER_AGENT },
  });
  const payload = await response.json() as { result?: Array<Record<string, unknown>>; pageHelp?: { data?: Array<Record<string, unknown>> } };
  return (payload.result ?? payload.pageHelp?.data ?? []).map((item) => {
    const title = String(item.TITLE ?? '');
    const path = String(item.URL ?? '');
    return {
      source: 'SSE' as const, sourceId: path || `${item.SECURITY_CODE}-${item.SSEDATE}-${title}`,
      code: String(item.SECURITY_CODE ?? ''), name: String(item.SECURITY_NAME ?? ''), title,
      publishedAt: new Date(`${String(item.SSEDATE ?? dateOnly())}T00:00:00+08:00`).toISOString(),
      pdfUrl: `https://www.sse.com.cn${path}`, reportType: classify(title),
    };
  }).filter((item) => item.code && item.pdfUrl && isFullFinancialReport(item.title));
}

export async function fetchSzse(days = 2, pageSize = 200): Promise<Announcement[]> {
  const response = await safeFetch('https://www.szse.cn/api/disc/announcement/annList', {
    method: 'POST',
    headers: { 'content-type': 'application/json', referer: 'https://www.szse.cn/disclosure/listed/notice/index.html', 'user-agent': USER_AGENT },
    body: JSON.stringify({ seDate: [dateOnly(days), dateOnly()], channelCode: ['listedNotice_disc'], pageSize, pageNum: 1 }),
  });
  const payload = await response.json() as { data?: Array<Record<string, unknown>> };
  return (payload.data ?? []).map((item) => {
    const title = String(item.title ?? '');
    const codes = Array.isArray(item.secCode) ? item.secCode : [];
    const names = Array.isArray(item.secName) ? item.secName : [];
    const path = String(item.attachPath ?? '');
    return {
      source: 'SZSE' as const, sourceId: String(item.annId ?? item.id ?? path), code: String(codes[0] ?? ''), name: String(names[0] ?? ''), title,
      publishedAt: new Date(`${String(item.publishTime ?? '').replace(' ', 'T')}+08:00`).toISOString(),
      pdfUrl: `https://disc.static.szse.cn/download${path}`, reportType: classify(title),
    };
  }).filter((item) => item.sourceId && item.code && isFullFinancialReport(item.title));
}

export async function fetchAllSources(days = 2) {
  const results = await Promise.allSettled([fetchSse(days), fetchSzse(days), fetchCninfo(days)]);
  const announcements: Announcement[] = [];
  const health: Record<string, { ok: boolean; count: number; error?: string }> = {};
  ['SSE', 'SZSE', 'CNINFO'].forEach((source, index) => {
    const result = results[index];
    if (result.status === 'fulfilled') {
      announcements.push(...result.value);
      health[source] = { ok: true, count: result.value.length };
    } else {
      health[source] = { ok: false, count: 0, error: String(result.reason) };
    }
  });
  return { announcements, health };
}
