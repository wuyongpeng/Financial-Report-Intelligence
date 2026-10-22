import { asIsoDate } from '@/lib/ingest-period';
import type { MetricName } from '@/lib/detail-model';
import type {
  ReportMetricRecord,
  ReportRecord,
  ReportRepository,
  ReportSelection,
} from '../domain/report-repository';

export type DatabaseReportRow = {
  id: string;
  code: string;
  company_name: string;
  title: string;
  report_type: string;
  published_at: unknown;
  parsed_at: unknown;
  industry: string;
  status: string;
};

export type DatabaseMetricRow = {
  announcement_id: string;
  metric: MetricName;
  value: number;
  unit: string;
  period: string;
  source_page: number | null;
  source_label: string | null;
  confidence: number;
  verified: boolean | number;
  prior_value?: number | null;
  yoy_pct?: number | null;
  yoy_source?: string | null;
};

export type ReportsDatabase = {
  findLatestCompanyReports(limit: number): Promise<DatabaseReportRow[]>;
  findCompanyReports(code: string, limit: number): Promise<DatabaseReportRow[]>;
  findRecentReports(limit: number): Promise<DatabaseReportRow[]>;
  findComparablePriorReports(currentReportIds: string[]): Promise<DatabaseReportRow[]>;
  findMetricsByReportIds(reportIds: string[]): Promise<DatabaseMetricRow[]>;
};

export function mapReportRow(row: DatabaseReportRow): ReportRecord {
  return {
    id: String(row.id),
    code: String(row.code),
    companyName: String(row.company_name),
    title: String(row.title),
    reportType: String(row.report_type),
    publishedAt: asIsoDate(row.published_at),
    parsedAt: row.parsed_at == null ? null : asIsoDate(row.parsed_at),
    industry: String(row.industry),
    status: String(row.status),
  };
}

export function mapMetricRow(row: DatabaseMetricRow): ReportMetricRecord {
  const priorValue = row.prior_value == null || row.prior_value === undefined ? null : Number(row.prior_value);
  const yoyPct = row.yoy_pct == null || row.yoy_pct === undefined ? null : Number(row.yoy_pct);
  const rawSource = row.yoy_source == null || row.yoy_source === undefined ? null : String(row.yoy_source);
  const yoySource = rawSource === 'disclosed' || rawSource === 'computed' ? rawSource : null;
  return {
    reportId: String(row.announcement_id),
    metric: row.metric,
    value: Number(row.value),
    unit: String(row.unit),
    period: String(row.period),
    sourcePage: row.source_page == null ? null : Number(row.source_page),
    sourceLabel: row.source_label == null ? null : String(row.source_label),
    confidence: Number(row.confidence),
    verified: Number(row.verified),
    priorValue: priorValue != null && Number.isFinite(priorValue) ? priorValue : null,
    yoyPct: yoyPct != null && Number.isFinite(yoyPct) ? yoyPct : null,
    yoySource,
  };
}

export class PostgresReportRepository implements ReportRepository {
  constructor(private readonly database: ReportsDatabase) {}

  async findReports(selection: ReportSelection): Promise<ReportRecord[]> {
    const rows = selection.kind === 'latest-company-reports'
      ? await this.database.findLatestCompanyReports(selection.limit)
      : selection.kind === 'company-reports'
        ? await this.database.findCompanyReports(selection.code, selection.limit)
        : await this.database.findRecentReports(selection.limit);
    return rows.map(mapReportRow);
  }

  async findComparablePriorReports(currentReportIds: string[]): Promise<ReportRecord[]> {
    if (!currentReportIds.length) return [];
    return (await this.database.findComparablePriorReports(currentReportIds)).map(mapReportRow);
  }

  async findMetricsByReportIds(reportIds: string[]): Promise<ReportMetricRecord[]> {
    if (!reportIds.length) return [];
    return (await this.database.findMetricsByReportIds(reportIds)).map(mapMetricRow);
  }
}
