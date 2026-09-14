import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Probe = {
  source: 'SSE' | 'SZSE' | 'BSE' | 'CNINFO';
  ok: boolean;
  latencyMs: number | null;
  detail: string;
  lastError: string | null;
};

async function timed(label: string, fn: () => Promise<string>): Promise<{ ok: boolean; latencyMs: number; detail: string; error: string | null }> {
  const started = Date.now();
  try {
    const detail = await fn();
    return { ok: true, latencyMs: Date.now() - started, detail, error: null };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, detail: `${label} 不可达`, error: String(error) };
  }
}

async function probeCninfo() {
  const form = new URLSearchParams({
    pageNum: '1', pageSize: '1', column: 'szse', tabName: 'fulltext',
    plate: '', stock: '', searchkey: '', secid: '',
    category: 'category_ndbg_szsh;category_bndbg_szsh;category_yjdbg_szsh;category_sjdbg_szsh',
    trade: '', seDate: '', sortName: '', sortType: '', isHLtitle: 'true',
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch('https://www.cninfo.com.cn/new/hisAnnouncement/query', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        referer: 'https://www.cninfo.com.cn/',
        'user-agent': 'FinanceReportIntelligence/1.0',
      },
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json() as { totalAnnouncement?: number };
    return `已连通，公告总量约 ${payload.totalAnnouncement ?? '—'}`;
  } finally {
    clearTimeout(timer);
  }
}

async function probeSse() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const url = 'https://query.sse.com.cn/security/stock/queryCompanyBulletin.do?isPagination=true&pageHelp.pageSize=1&pageHelp.pageNo=1&pageHelp.beginPage=1&pageHelp.endPage=1&beginDate=&endDate=&keyWord=%E6%8A%A5%E5%91%8A';
    const response = await fetch(url, {
      headers: { referer: 'https://www.sse.com.cn/', 'user-agent': 'FinanceReportIntelligence/1.0' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await response.text();
    return '已连通上交所公告接口';
  } finally {
    clearTimeout(timer);
  }
}

async function probeSzse() {
  // Same transport as crawl: Python urllib first (Node fetch gets hang-up / empty reply).
  const { fetchSzse } = await import('@/lib/sources');
  const page = await fetchSzse(30, 1, 1, '000001');
  return `已连通深交所公告接口（样本 ${page.rawCount || page.items.length} 条）`;
}

async function probeBse() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch('https://www.bse.cn/', {
      headers: { 'user-agent': 'FinanceReportIntelligence/1.0', referer: 'https://www.bse.cn/' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await response.text();
    return '已连通北交所官网';
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  const [sse, szse, bse, cninfo] = await Promise.all([
    timed('SSE', probeSse),
    timed('SZSE', probeSzse),
    timed('BSE', probeBse),
    timed('CNINFO', probeCninfo),
  ]);

  const probes: Probe[] = [
    { source: 'SSE', ok: sse.ok, latencyMs: sse.latencyMs, detail: sse.detail, lastError: sse.error },
    { source: 'SZSE', ok: szse.ok, latencyMs: szse.latencyMs, detail: szse.detail, lastError: szse.error },
    { source: 'BSE', ok: bse.ok, latencyMs: bse.latencyMs, detail: bse.detail, lastError: bse.error },
    { source: 'CNINFO', ok: cninfo.ok, latencyMs: cninfo.latencyMs, detail: cninfo.detail, lastError: cninfo.error },
  ];

  // Persist into source_health so the discover card stays useful after refresh.
  try {
    const db = getDb();
    const now = new Date().toISOString();
    for (const row of probes) {
      await db`
        INSERT INTO source_health (source, last_success_at, last_failure_at, consecutive_failures, last_count, last_error, updated_at)
        VALUES (
          ${row.source},
          ${row.ok ? now : null},
          ${row.ok ? null : now},
          ${row.ok ? 0 : 1},
          ${row.ok ? 1 : 0},
          ${row.lastError},
          ${now}
        )
        ON CONFLICT (source) DO UPDATE SET
          last_success_at=CASE WHEN EXCLUDED.last_error IS NULL THEN EXCLUDED.last_success_at ELSE source_health.last_success_at END,
          last_failure_at=CASE WHEN EXCLUDED.last_error IS NOT NULL THEN EXCLUDED.last_failure_at ELSE source_health.last_failure_at END,
          consecutive_failures=CASE WHEN EXCLUDED.last_error IS NULL THEN 0 ELSE source_health.consecutive_failures + 1 END,
          last_count=EXCLUDED.last_count,
          last_error=EXCLUDED.last_error,
          updated_at=EXCLUDED.updated_at
      `;
    }
  } catch {
    /* probing still returns even if DB write fails */
  }

  return Response.json({
    ok: true,
    probedAt: new Date().toISOString(),
    sources: probes,
  }, { headers: { 'cache-control': 'no-store' } });
}
