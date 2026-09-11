import companiesJson from '@/data/companies.json';
import { getDb } from '@/lib/db';
import {
  METRIC_LABELS,
  computeStats,
  mapIndustryGroup,
  parseStatusFromAnnouncement,
  reportTypeFromValue,
  sourceKindFromAnnouncement,
  type CrawlCompanyCoverage,
  type CrawlMetricPreview,
  type HeadlineMetricName,
} from '@/lib/crawl-display';
import { getCrawlCoverage, getCrawlStats } from '@/lib/crawl-mock';

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
      status: string; parse_error: string | null; title: string;
    }>>`
      SELECT DISTINCT ON (a.code)
        a.code, a.id, a.source, a.report_type, a.published_at, a.discovered_at,
        a.downloaded_at, a.parsed_at, a.status, a.parse_error, a.title
      FROM announcements a
      JOIN companies c ON c.code=a.code AND c.enabled=true
      ORDER BY a.code, a.published_at DESC, a.discovered_at DESC
    `;
    const latestByCode = new Map(latest.map((row) => [row.code, row]));

    const announcementIds = latest.map((row) => row.id);
    type MetricRow = { announcement_id: string; period: string; metric: string; value: number; unit: string };
    const metrics: MetricRow[] = announcementIds.length
      ? await db<MetricRow[]>`
          SELECT announcement_id, period, metric, value, unit
          FROM financial_metrics
          WHERE announcement_id IN ${db(announcementIds)}
            AND metric IN ('revenue','net_profit','eps','roe')
        `
      : [];
    const metricsByAnnouncement = new Map<string, MetricRow[]>();
    for (const metric of metrics) {
      const list = metricsByAnnouncement.get(metric.announcement_id) ?? [];
      list.push(metric);
      metricsByAnnouncement.set(metric.announcement_id, list);
    }

    const codeToAnnouncement = new Map(latest.map((row) => [row.id, row.code]));
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
    const priorLookup = new Map(priorMetrics.map((m) => [`${m.code}|${m.period}|${m.metric}`, Number(m.value)]));

    const [run] = await db<Array<{ started_at: string; finished_at: string | null }>>`
      SELECT started_at, finished_at FROM ingest_runs ORDER BY started_at DESC LIMIT 1
    `;

    const coverage: CrawlCompanyCoverage[] = companies.map((company) => {
      const meta = metaByCode.get(company.code);
      const ann = latestByCode.get(company.code);
      const metricRows = ann ? (metricsByAnnouncement.get(ann.id) ?? []) : [];
      const metricCount = metricRows.filter((m) => CORE.includes(m.metric as HeadlineMetricName)).length;
      const parseStatus = parseStatusFromAnnouncement(ann?.status, metricCount);
      const present = new Set(metricRows.map((m) => m.metric));
      const missingMetrics = CORE.filter((m) => !present.has(m));
      const resolvedPeriod = metricRows[0]?.period ?? null;
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

      const lastCrawlAt = ann?.discovered_at ?? ann?.published_at ?? null;
      return {
        code: company.code,
        name: company.name,
        industry: company.industry,
        industryGroup: mapIndustryGroup(company.industry, meta?.sector),
        theme: meta?.theme ?? meta?.industry ?? company.industry,
        exchange: company.exchange,
        covered: Boolean(ann),
        lastCrawlAt,
        source: sourceKindFromAnnouncement(ann?.source),
        sourceApi: ann?.source ?? null,
        reportType: reportTypeFromValue(ann?.report_type),
        reportPeriod: resolvedPeriod,
        parseStatus,
        parseError: ann?.parse_error ?? (parseStatus === 'pending' ? '监控池内，尚未完成抓取/解析' : null),
        announcementTitle: ann?.title ?? null,
        discoveredAt: ann?.discovered_at ?? null,
        downloadedAt: ann?.downloaded_at ?? null,
        parsedAt: ann?.parsed_at ?? null,
        rawStatus: ann?.status ?? null,
        metricsComplete: missingMetrics.length === 0 && parseStatus === 'completed',
        missingMetrics,
        metrics: preview,
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
