import type { ReportListQuery, ReportListResponse } from '@/contracts/reports';
import { classifyReportTitle, canonicalPeriodFromTitle } from '@/lib/ingest-period';
import type { Metric, Report } from '@/lib/detail-model';
import type {
  ReportMetricRecord,
  ReportRecord,
  ReportRepository,
  ReportSelection,
} from '../domain/report-repository';

export type FilingLabelObserver = (reports: ReportRecord[]) => Promise<void>;

function selectionFromQuery(query: ReportListQuery): ReportSelection {
  if (query.view === 'companies' && !query.code) {
    return { kind: 'latest-company-reports', limit: query.limit };
  }
  if (query.code) return { kind: 'company-reports', code: query.code, limit: query.limit };
  return { kind: 'recent-reports', limit: query.limit };
}

function metricDto(metric: ReportMetricRecord, period: string | null): Metric {
  return {
    metric: metric.metric,
    value: metric.value,
    unit: metric.unit,
    period: period ?? metric.period,
    source_page: metric.sourcePage,
    source_label: metric.sourceLabel,
    confidence: metric.confidence,
    verified: metric.verified,
  };
}

function reportDto(report: ReportRecord, metrics: ReportMetricRecord[]): Report {
  const canonicalPeriod = canonicalPeriodFromTitle(report.title, report.publishedAt);
  const classified = classifyReportTitle(report.title);
  return {
    id: report.id,
    code: report.code,
    company_name: report.companyName,
    title: report.title,
    report_type: classified === 'other' ? report.reportType : classified,
    published_at: report.publishedAt,
    parsed_at: report.parsedAt,
    industry: report.industry,
    status: report.status,
    metrics: metrics.map(item => metricDto(item, canonicalPeriod)),
  };
}

/**
 * Reports query use case. It owns selection and response composition, while all
 * persistence details stay behind ReportRepository.
 */
export async function listReports(
  query: ReportListQuery,
  repository: ReportRepository,
  observeFilingLabels?: FilingLabelObserver,
): Promise<ReportListResponse> {
  const primary = await repository.findReports(selectionFromQuery(query));
  if (!primary.length) return { source: 'postgresql', count: 0, reports: [] };

  // Temporary compatibility hook: the existing read path repairs old rows.
  // Keeping it outside the repository makes the side effect explicit and easy
  // to remove once the repair is moved to ingestion/maintenance.
  await observeFilingLabels?.(primary).catch(() => undefined);

  const prior = query.view === 'companies' && !query.code
    ? await repository.findComparablePriorReports(primary.map(report => report.id))
    : [];
  const seen = new Set(primary.map(report => report.id));
  const selected = [...primary, ...prior.filter(report => !seen.has(report.id))];
  const metrics = await repository.findMetricsByReportIds(selected.map(report => report.id));
  const metricsByReport = new Map<string, ReportMetricRecord[]>();
  for (const metric of metrics) {
    const rows = metricsByReport.get(metric.reportId) ?? [];
    rows.push(metric);
    metricsByReport.set(metric.reportId, rows);
  }

  const reports = selected.map(report => reportDto(report, metricsByReport.get(report.id) ?? []));
  return { source: 'postgresql', count: reports.length, reports };
}
