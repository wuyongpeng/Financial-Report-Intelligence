import companiesJson from '@/data/companies.json';
import { getDb } from '@/lib/db';
import {
  METRIC_LABELS,
  computeStats,
  mapIndustryGroup,
  parseStatusFromAnnouncement,
  companyParseStatusFromPeriods,
  reportTypeFromValue,
  sourceKindFromAnnouncement,
  pickRecentPeriods,
  periodTokenKey,
  type CrawlCompanyCoverage,
  type CrawlMetricPreview,
  type CrawlPeriodStatus,
  type HeadlineMetricName,
  type PeriodCollectState,
} from '@/lib/crawl-display';
import { getCrawlCoverage, getCrawlStats } from '@/lib/crawl-mock';
import { canonicalPeriodFromTitle, isCanonicalPeriod } from '@/lib/ingest-period';
import { expectedPeriodsThroughLatest, latestExpectedPeriod } from '@/lib/ingest-lookback';
import { classifyFromName } from '@/lib/company-classify';
import { ensureBackendSchema } from '@/lib/backend-schema';

export const dynamic = 'force-dynamic';

type CompanyMeta = {
  code: string;
  name: string;
  exchange: 'SSE' | 'SZSE';
  industry: string;
  sector?: string;
  theme?: string;
  rank: number;
  weight: number;
};

const metaByCode = new Map((companiesJson as CompanyMeta[]).map((c) => [c.code, c]));

const CORE: HeadlineMetricName[] = ['revenue', 'net_profit', 'eps', 'roe'];

function stateFromAnnouncement(
  status: string | null | undefined,
  pdfKey: string | null | undefined,
  hasMetrics: boolean,
  metricsComplete: boolean,
): PeriodCollectState {
  if (status === 'parse_parked' || status === 'parse_failed') return 'failed';
  if (status === 'parse_partial') return 'parsed_partial';
  if ((status === 'review' || status === 'online') && hasMetrics && !metricsComplete) return 'parsed_partial';
  if (hasMetrics || status === 'review' || status === 'online') return 'parsed';
  if (pdfKey || status === 'downloaded' || status === 'parsing') return 'downloaded';
  if (status) return 'discovered';
  return 'expected';
}

function buildPeriodStatuses(rows: Array<{
  period: string | null; status: string | null; pdf_key: string | null; title: string | null;
  hasMetrics: boolean; metricsComplete: boolean; missingMetrics?: CrawlPeriodStatus['missingMetrics'];
  parseError?: string | null; id?: string | null; source?: string | null;
  discoveredAt?: string | null; downloadedAt?: string | null; parsedAt?: string | null; publishedAt?: string | null;
}>): { periodStatuses: CrawlPeriodStatus[]; latestExpected: string; latestExpectedMissing: boolean } {
  const latestExpected = latestExpectedPeriod();
  const byPeriod = new Map<string, CrawlPeriodStatus>();
  const rank: Record<PeriodCollectState, number> = {
    parsed: 6, parsed_partial: 5, downloaded: 4, discovered: 3, expected: 2, failed: 1,
  };
  for (const row of rows) {
    const period = row.period;
    if (!period || period === '最新' || !isCanonicalPeriod(period)) continue;
    const state = stateFromAnnouncement(row.status, row.pdf_key, row.hasMetrics, row.metricsComplete);
    const prev = byPeriod.get(period);
    if (!prev || rank[state] > rank[prev.state]) {
      byPeriod.set(period, {
        period,
        state,
        title: row.title,
        announcementId: row.id ?? null,
        sourceApi: row.source ?? null,
        rawStatus: row.status ?? null,
        discoveredAt: row.discoveredAt ?? null,
        downloadedAt: row.downloadedAt ?? null,
        parsedAt: row.parsedAt ?? null,
        publishedAt: row.publishedAt ?? null,
        missingMetrics: row.missingMetrics,
        parseError: row.parseError ?? null,
      });
    }
  }
  for (const token of expectedPeriodsThroughLatest()) {
    if (!byPeriod.has(token)) byPeriod.set(token, { period: token, state: 'expected' });
  }
  const periodStatuses = [...byPeriod.values()].sort((a, b) => periodTokenKey(b.period) - periodTokenKey(a.period));
  const latest = byPeriod.get(latestExpected);
  const latestExpectedMissing = !latest || latest.state === 'expected' || latest.state === 'discovered';
  return { periodStatuses, latestExpected, latestExpectedMissing };
}

function priorPeriod(period: string) {
  const year = Number(period.slice(0, 4));
  if (!Number.isFinite(year)) return null;
  return `${year - 1}${period.slice(4)}`;
}

export async function GET() {
  try {
    const db = getDb();
    const companies = await db<Array<{
      code: string; name: string; exchange: 'SSE' | 'SZSE'; industry: string; rank: number; weight: number;
    }>>`
      SELECT code, name, exchange, industry, rank, weight
      FROM companies WHERE enabled=true ORDER BY rank, code
    `;
    if (!companies.length) {
      return Response.json({
        source: 'crawl-mock',
        stats: getCrawlStats(),
        companies: getCrawlCoverage(),
        generatedAt: new Date().toISOString(),
      }, { headers: { 'cache-control': 'no-store' } });
    }

    const latest = await db<Array<{
      code: string; id: string; source: string; report_type: string; published_at: string;
      discovered_at: string; downloaded_at: string | null; parsed_at: string | null;
      status: string; parse_error: string | null; title: string; pdf_key: string | null;
    }>>`
      SELECT DISTINCT ON (a.code)
        a.code, a.id, a.source, a.report_type, a.published_at, a.discovered_at,
        a.downloaded_at, a.parsed_at, a.status, a.parse_error, a.title, a.pdf_key
      FROM announcements a
      JOIN companies c ON c.code=a.code AND c.enabled=true
      WHERE a.status <> 'auto_skipped'
      ORDER BY a.code, a.published_at DESC, a.discovered_at DESC
    `;
    const latestByCode = new Map(latest.map((row) => [row.code, row]));

    const companyCodes = companies.map((c) => c.code);
    type MetricRow = { announcement_id: string; period: string; metric: string; value: number; unit: string };
    // Metrics loaded after we know all announcements (below). Placeholder maps filled later.
    let metricsByAnnouncement = new Map<string, MetricRow[]>();
    let priorLookup = new Map<string, number>();
    type AnnPeriodRow = {
      id: string; code: string; title: string; status: string; pdf_key: string | null;
      published_at: string; discovered_at: string; downloaded_at: string | null; parsed_at: string | null;
      parse_error: string | null; source: string; report_type: string; period: string | null; metric_count: number;
      has_revenue: boolean; has_net_profit: boolean; has_eps: boolean; has_roe: boolean;
    };
    const announcementPeriods: AnnPeriodRow[] = companyCodes.length
      ? await db<AnnPeriodRow[]>`
          SELECT a.id, a.code, a.title, a.status, a.pdf_key, a.published_at, a.discovered_at, a.downloaded_at, a.parsed_at,
            a.parse_error, a.source, a.report_type,
            (SELECT fm.period FROM financial_metrics fm WHERE fm.announcement_id=a.id LIMIT 1) AS period,
            (SELECT COUNT(*)::int FROM financial_metrics fm
              WHERE fm.announcement_id=a.id AND fm.metric IN ('revenue','net_profit','eps','roe')) AS metric_count,
            EXISTS (SELECT 1 FROM financial_metrics fm WHERE fm.announcement_id=a.id AND fm.metric='revenue') AS has_revenue,
            EXISTS (SELECT 1 FROM financial_metrics fm WHERE fm.announcement_id=a.id AND fm.metric='net_profit') AS has_net_profit,
            EXISTS (SELECT 1 FROM financial_metrics fm WHERE fm.announcement_id=a.id AND fm.metric='eps') AS has_eps,
            EXISTS (SELECT 1 FROM financial_metrics fm WHERE fm.announcement_id=a.id AND fm.metric='roe') AS has_roe
          FROM announcements a
          WHERE a.code = ANY(${companyCodes}::text[])
            AND a.status <> 'auto_skipped'
        `
      : [];
    const annPeriodsByCode = new Map<string, AnnPeriodRow[]>();
    for (const row of announcementPeriods) {
      const list = annPeriodsByCode.get(row.code) ?? [];
      list.push(row);
      annPeriodsByCode.set(row.code, list);
    }

    const allAnnIds = announcementPeriods.map((r) => r.id);
    const metrics: MetricRow[] = allAnnIds.length
      ? await db<MetricRow[]>`
          SELECT announcement_id, period, metric, value, unit
          FROM financial_metrics
          WHERE announcement_id IN ${db(allAnnIds)}
            AND metric IN ('revenue','net_profit','eps','roe')
        `
      : [];
    metricsByAnnouncement = new Map<string, MetricRow[]>();
    const tokenByAnn = new Map(
      announcementPeriods.map((row) => [row.id, canonicalPeriodFromTitle(row.title, row.published_at)]),
    );
    for (const metric of metrics) {
      const token = tokenByAnn.get(metric.announcement_id);
      if (token) metric.period = token;
      const list = metricsByAnnouncement.get(metric.announcement_id) ?? [];
      list.push(metric);
      metricsByAnnouncement.set(metric.announcement_id, list);
    }
    const codeToAnnouncement = new Map(announcementPeriods.map((row) => [row.id, row.code]));
    const priorPeriods = [...new Set(metrics.map((m) => priorPeriod(m.period)).filter((p): p is string => Boolean(p)))];
    const codesForPrior = [...new Set(metrics.map((m) => codeToAnnouncement.get(m.announcement_id)).filter((c): c is string => Boolean(c)))];
    const priorMetrics = priorPeriods.length && codesForPrior.length
      ? await db<Array<{ code: string; period: string; metric: string; value: number }>>`
          SELECT DISTINCT ON (code, period, metric) code, period, metric, value
          FROM financial_metrics
          WHERE code = ANY(${codesForPrior}::text[])
            AND period = ANY(${priorPeriods}::text[])
            AND metric IN ('revenue','net_profit','eps','roe')
          ORDER BY code, period, metric, created_at DESC
        `
      : [];
    priorLookup = new Map(priorMetrics.map((m) => [`${m.code}|${m.period}|${m.metric}`, Number(m.value)]));

    const verdictById = new Map<string, 'ready' | 'pending' | 'failed'>();
    try {
      await ensureBackendSchema();
      const verdictRows = allAnnIds.length
        ? await db<Array<{ announcement_id: string; status: 'ready' | 'pending' | 'failed' }>>`
            SELECT announcement_id, status FROM report_verdicts WHERE announcement_id IN ${db(allAnnIds)}
          `
        : [];
      for (const row of verdictRows) verdictById.set(row.announcement_id, row.status);
    } catch {
      /* optional: crawl page still works before verdict table exists */
    }

    const [run] = await db<Array<{ started_at: string; finished_at: string | null }>>`
      SELECT started_at, finished_at FROM ingest_runs ORDER BY started_at DESC LIMIT 1
    `;

    const coverage: CrawlCompanyCoverage[] = companies.map((company) => {
      const meta = metaByCode.get(company.code);
      const rows = annPeriodsByCode.get(company.code) ?? [];
      const periodBuilt = buildPeriodStatuses(rows.map((row) => {
        const missing = CORE.filter((m) => {
          if (m === 'revenue') return !row.has_revenue;
          if (m === 'net_profit') return !row.has_net_profit;
          if (m === 'eps') return !row.has_eps;
          return !row.has_roe;
        });
        return {
          period: canonicalPeriodFromTitle(row.title, row.published_at),
          status: row.status,
          pdf_key: row.pdf_key,
          title: row.title,
          hasMetrics: row.metric_count > 0,
          metricsComplete: missing.length === 0 && row.metric_count > 0,
          missingMetrics: missing,
          parseError: row.parse_error,
          source: row.source,
          id: row.id,
          discoveredAt: row.discovered_at,
          downloadedAt: row.downloaded_at,
          parsedAt: row.parsed_at,
          publishedAt: row.published_at,
        };
      }));

      for (const period of periodBuilt.periodStatuses) {
        if (period.announcementId) period.verdictStatus = verdictById.get(period.announcementId) ?? null;
      }

      // Homepage / company-level fields: newest *parsed* filing, not newest published announcement.
      const parsedPeriods = periodBuilt.periodStatuses.filter((p) => p.state === 'parsed' || p.state === 'parsed_partial');
      const displayPeriod = parsedPeriods.length
        ? [...parsedPeriods].sort((a, b) => periodTokenKey(b.period) - periodTokenKey(a.period))[0]
        : null;
      const displayRow = displayPeriod?.announcementId
        ? rows.find((r) => r.id === displayPeriod.announcementId) ?? null
        : null;
      const fallbackLatest = latestByCode.get(company.code) ?? null;
      const ann = displayRow ?? (fallbackLatest
        ? {
            id: fallbackLatest.id,
            code: fallbackLatest.code,
            title: fallbackLatest.title,
            status: fallbackLatest.status,
            pdf_key: fallbackLatest.pdf_key,
            published_at: fallbackLatest.published_at,
            discovered_at: fallbackLatest.discovered_at,
            downloaded_at: fallbackLatest.downloaded_at,
            parsed_at: fallbackLatest.parsed_at,
            parse_error: fallbackLatest.parse_error,
            source: fallbackLatest.source,
            report_type: fallbackLatest.report_type,
            period: null as string | null,
            metric_count: 0,
            has_revenue: false, has_net_profit: false, has_eps: false, has_roe: false,
          }
        : null);

      const metricRows = ann ? (metricsByAnnouncement.get(ann.id) ?? []) : [];
      const metricCount = metricRows.filter((m) => CORE.includes(m.metric as HeadlineMetricName)).length;
      const parseStatus = displayPeriod
        ? companyParseStatusFromPeriods(periodBuilt.periodStatuses)
        : parseStatusFromAnnouncement(ann?.status, metricCount);
      const present = new Set(metricRows.map((m) => m.metric));
      const missingMetrics = CORE.filter((m) => !present.has(m));
      const resolvedPeriod = metricRows[0]?.period ?? displayPeriod?.period ?? null;
      const preview: CrawlMetricPreview[] = [];
      for (const metric of CORE) {
        const row = metricRows.find((m) => m.metric === metric);
        if (!row) continue;
        const priorKey = resolvedPeriod ? priorPeriod(resolvedPeriod) : null;
        const prior = priorKey ? priorLookup.get(`${company.code}|${priorKey}|${metric}`) : undefined;
        preview.push({
          metric,
          label: METRIC_LABELS[metric],
          value: Number(row.value),
          ...(prior !== undefined ? { prior } : {}),
          unit: row.unit,
        });
      }

      const anyDownloaded = rows.find((r) => r.downloaded_at || r.pdf_key);
      const anyParsed = rows.find((r) => r.parsed_at);
      const lastCrawlAt = ann?.discovered_at ?? ann?.published_at ?? fallbackLatest?.discovered_at ?? null;
      const nameTags = (!company.industry || company.industry === '待分类')
        ? classifyFromName(company.name)
        : null;
      const industry = nameTags?.industry ?? company.industry;
      const industryGroup = mapIndustryGroup(industry, nameTags?.sector ?? meta?.sector);

      return {
        code: company.code,
        name: company.name,
        industry,
        industryGroup,
        theme: meta?.theme ?? meta?.industry ?? industry,
        exchange: company.exchange,
        covered: rows.length > 0 || Boolean(fallbackLatest),
        lastCrawlAt,
        source: sourceKindFromAnnouncement(ann?.source ?? fallbackLatest?.source),
        sourceApi: ann?.source ?? fallbackLatest?.source ?? null,
        reportType: reportTypeFromValue(ann?.report_type ?? fallbackLatest?.report_type),
        reportPeriod: resolvedPeriod,
        parseStatus,
        parseError: displayPeriod
          ? (displayPeriod.parseError ?? null)
          : (ann?.parse_error ?? (parseStatus === 'pending' ? '监控池内，尚未完成抓取/解析' : null)),
        announcementTitle: ann?.title ?? null,
        discoveredAt: ann?.discovered_at ?? null,
        downloadedAt: ann?.downloaded_at ?? anyDownloaded?.downloaded_at ?? null,
        parsedAt: ann?.parsed_at ?? anyParsed?.parsed_at ?? null,
        pdfKey: ann?.pdf_key ?? anyDownloaded?.pdf_key ?? null,
        rawStatus: ann?.status ?? null,
        metricsComplete: missingMetrics.length === 0 && parseStatus === 'completed' && metricCount > 0,
        missingMetrics,
        metrics: preview,
        // Home left-bottom period buttons: one per *parsed* report
        recentPeriods: pickRecentPeriods(parsedPeriods.map((p) => p.period), 3),
        periodStatuses: periodBuilt.periodStatuses,
        latestExpectedPeriod: periodBuilt.latestExpected,
        latestExpectedMissing: periodBuilt.latestExpectedMissing,
        popularity: company.weight,
        rank: company.rank,
      };
    });

    const lastPollAt = run?.finished_at ?? run?.started_at ?? null;
    const stats = computeStats(coverage, lastPollAt);

    return Response.json({
      source: 'postgresql',
      stats,
      companies: coverage,
      generatedAt: new Date().toISOString(),
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({
      source: 'crawl-mock',
      stats: getCrawlStats(),
      companies: getCrawlCoverage(),
      generatedAt: new Date().toISOString(),
      warning: `真实抓取数据暂时无法读取：${String(error)}`,
    }, { headers: { 'cache-control': 'no-store' } });
  }
}
