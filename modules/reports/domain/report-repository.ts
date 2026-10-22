import type { MetricName } from '@/lib/detail-model';

export type ReportRecord = {
  id: string;
  code: string;
  companyName: string;
  title: string;
  reportType: string;
  publishedAt: string;
  parsedAt: string | null;
  industry: string;
  status: string;
};

export type ReportMetricRecord = {
  reportId: string;
  metric: MetricName;
  value: number;
  unit: string;
  period: string;
  sourcePage: number | null;
  sourceLabel: string | null;
  confidence: number;
  verified: number;
  priorValue?: number | null;
  yoyPct?: number | null;
  yoySource?: 'disclosed' | 'computed' | null;
};

export type ReportSelection =
  | { kind: 'latest-company-reports'; limit: number }
  | { kind: 'company-reports'; code: string; limit: number }
  | { kind: 'recent-reports'; limit: number };

export interface ReportRepository {
  findReports(selection: ReportSelection): Promise<ReportRecord[]>;
  findComparablePriorReports(currentReportIds: string[]): Promise<ReportRecord[]>;
  findMetricsByReportIds(reportIds: string[]): Promise<ReportMetricRecord[]>;
}
