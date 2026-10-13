import { ApiError } from '@/lib/api';
import { allMetricNames, type Metric, type MetricName, type Report } from '@/lib/detail-model';
import {
  contractArray,
  contractNumber,
  contractObject,
  contractString,
  optionalString,
} from './common';

export type ReportListQuery = {
  limit: number;
  code: string | null;
  view: 'companies' | null;
};

export type ReportListResponse = {
  source: 'postgresql';
  count: number;
  reports: Report[];
};

const metricNames = new Set<string>(allMetricNames);

export function parseReportListQuery(input: URL | URLSearchParams): ReportListQuery {
  const search = input instanceof URL ? input.searchParams : input;
  const rawLimit = search.get('limit') ?? '50';
  const requestedLimit = Number(rawLimit);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
    throw new ApiError(400, 'limit 必须为正整数');
  }
  const code = search.get('code');
  if (code !== null && !/^\d{6}$/.test(code)) throw new ApiError(400, 'code 必须为六位股票代码');
  const rawView = search.get('view');
  if (rawView !== null && rawView !== 'companies') throw new ApiError(400, 'view 参数无效');
  return { limit: Math.min(requestedLimit, 100), code, view: rawView };
}

export function parseMetricDto(value: unknown): Metric {
  const row = contractObject(value, 'metric');
  const metric = contractString(row.metric, 'metric.metric');
  if (!metricNames.has(metric)) throw new Error('metric.metric 响应格式错误');
  const sourcePage = row.source_page === null || row.source_page === undefined
    ? null
    : contractNumber(row.source_page, 'metric.source_page');
  const sourceLabel = row.source_label === null || row.source_label === undefined
    ? null
    : contractString(row.source_label, 'metric.source_label');
  const verified = typeof row.verified === 'boolean'
    ? Number(row.verified)
    : contractNumber(row.verified, 'metric.verified');
  return {
    metric: metric as MetricName,
    value: contractNumber(row.value, 'metric.value'),
    unit: contractString(row.unit, 'metric.unit'),
    period: contractString(row.period, 'metric.period'),
    source_page: sourcePage,
    source_label: sourceLabel,
    confidence: contractNumber(row.confidence, 'metric.confidence'),
    verified,
  };
}

export function parseReportDto(value: unknown): Report {
  const row = contractObject(value, 'report');
  return {
    id: contractString(row.id, 'report.id'),
    code: contractString(row.code, 'report.code'),
    company_name: contractString(row.company_name, 'report.company_name'),
    title: contractString(row.title, 'report.title'),
    report_type: contractString(row.report_type, 'report.report_type'),
    published_at: contractString(row.published_at, 'report.published_at'),
    parsed_at: optionalString(row.parsed_at, 'report.parsed_at') ?? null,
    industry: contractString(row.industry, 'report.industry'),
    status: contractString(row.status, 'report.status'),
    metrics: contractArray(row.metrics, 'report.metrics').map(parseMetricDto),
  };
}

export function parseReportListResponse(value: unknown): ReportListResponse {
  const row = contractObject(value, 'reports');
  const source = contractString(row.source, 'reports.source');
  if (source !== 'postgresql') throw new Error('reports.source 响应格式错误');
  const reports = contractArray(row.reports, 'reports.reports').map(parseReportDto);
  const count = contractNumber(row.count, 'reports.count');
  if (!Number.isInteger(count) || count !== reports.length) throw new Error('reports.count 响应格式错误');
  return { source, count, reports };
}
