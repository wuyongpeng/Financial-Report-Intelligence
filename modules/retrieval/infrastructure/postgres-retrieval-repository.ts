import type { getDb } from '@/lib/db';
import { asIsoDate } from '@/lib/ingest-period';
import type { RetrievalRepository } from '../domain/retrieval-repository';
import type {
  RetrievalChunk,
  RetrievalMetric,
  RetrievalReport,
  WatchedCompany,
} from '../domain/retrieval';

type Db = ReturnType<typeof getDb>;
type ReportRow = {
  id: string;
  code: string;
  company_name: string;
  industry: string;
  report_type: string;
  title: string;
  published_at: unknown;
};
type MetricRow = {
  announcement_id: string;
  metric: string;
  value: number;
  unit: string;
  period: string;
  source_page: number | null;
  source_label: string | null;
  prior_value?: number | null;
  yoy_pct?: number | null;
};
type ChunkRow = { announcement_id: string; page: number; content: string };

export function mapRetrievalReport(row: ReportRow): RetrievalReport {
  return {
    id: String(row.id),
    code: String(row.code),
    companyName: String(row.company_name),
    industry: String(row.industry),
    reportType: String(row.report_type),
    title: String(row.title),
    publishedAt: asIsoDate(row.published_at),
  };
}

function mapMetric(row: MetricRow): RetrievalMetric {
  const priorValue = row.prior_value == null || row.prior_value === undefined ? null : Number(row.prior_value);
  const yoyPct = row.yoy_pct == null || row.yoy_pct === undefined ? null : Number(row.yoy_pct);
  return {
    reportId: String(row.announcement_id),
    metric: String(row.metric),
    value: Number(row.value),
    unit: String(row.unit),
    period: String(row.period),
    sourcePage: row.source_page == null ? null : Number(row.source_page),
    sourceLabel: row.source_label == null ? null : String(row.source_label),
    priorValue: priorValue != null && Number.isFinite(priorValue) ? priorValue : null,
    yoyPct: yoyPct != null && Number.isFinite(yoyPct) ? yoyPct : null,
  };
}

function mapChunk(row: ChunkRow): RetrievalChunk {
  return { reportId: String(row.announcement_id), page: Number(row.page), content: String(row.content) };
}

export class PostgresRetrievalRepository implements RetrievalRepository {
  constructor(private readonly db: Db) {}

  async findReport(reportId: string) {
    const [row] = await this.db<ReportRow[]>`SELECT a.id, a.code, a.company_name, a.report_type, a.title, a.published_at, c.industry
      FROM announcements a JOIN companies c ON c.code=a.code WHERE a.id=${reportId}`;
    return row ? mapRetrievalReport(row) : null;
  }

  async findMetrics(reportIds: string[]) {
    if (!reportIds.length) return [];
    const rows = await this.db<MetricRow[]>`SELECT announcement_id, metric, value, unit, period, source_page, source_label, prior_value, yoy_pct
      FROM financial_metrics WHERE announcement_id IN ${this.db(reportIds)} ORDER BY metric`;
    return rows.map(mapMetric);
  }

  async listWatchedCompanies(): Promise<WatchedCompany[]> {
    const rows = await this.db<Array<{ code: string; company_name: string }>>`SELECT code, name AS company_name FROM companies WHERE enabled=true`;
    return rows.map(row => ({ code: String(row.code), companyName: String(row.company_name) }));
  }

  async findCompanyHistory(input: { code: string; excludeReportId: string; periodSuffix: string; limit: number }) {
    const rows = await this.db<ReportRow[]>`SELECT a.id, a.code, a.company_name, a.report_type, a.title, a.published_at, c.industry FROM announcements a
      JOIN companies c ON c.code=a.code
      WHERE a.code=${input.code} AND a.id<>${input.excludeReportId} AND a.status <> 'auto_skipped'
        AND EXISTS (SELECT 1 FROM financial_metrics m WHERE m.announcement_id=a.id)
      ORDER BY CASE
        WHEN EXISTS (
          SELECT 1 FROM financial_metrics m
          WHERE m.announcement_id=a.id AND m.period LIKE ${`%${input.periodSuffix || '%'}`}
        ) THEN 0
        ELSE 1
      END, a.published_at DESC
      LIMIT ${input.limit}`;
    return rows.map(mapRetrievalReport);
  }

  async findNamedPeerReports(input: { codes: string[]; preferredPeriod: string }) {
    if (!input.codes.length) return [];
    const rows = await this.db<ReportRow[]>`SELECT DISTINCT ON (a.code) a.id, a.code, a.company_name, a.report_type, a.title, a.published_at, c.industry
      FROM announcements a JOIN companies c ON c.code=a.code
      WHERE a.code IN ${this.db(input.codes)} AND a.status <> 'auto_skipped'
        AND EXISTS (SELECT 1 FROM financial_metrics m WHERE m.announcement_id=a.id)
      ORDER BY a.code,
        CASE WHEN EXISTS (SELECT 1 FROM financial_metrics m WHERE m.announcement_id=a.id AND m.period=${input.preferredPeriod}) THEN 0 ELSE 1 END,
        a.published_at DESC`;
    return rows.map(mapRetrievalReport);
  }

  async findIndustryPeerReports(input: { industry: string; excludeCode: string; preferredPeriod: string; limit: number }) {
    const rows = await this.db<ReportRow[]>`SELECT DISTINCT ON (a.code) a.id, a.code, a.company_name, a.report_type, a.title, a.published_at, c.industry
      FROM announcements a JOIN companies c ON c.code=a.code
      WHERE c.industry=${input.industry} AND c.enabled=true AND a.code<>${input.excludeCode} AND a.status <> 'auto_skipped'
        AND EXISTS (SELECT 1 FROM financial_metrics m WHERE m.announcement_id=a.id)
      ORDER BY a.code,
        CASE WHEN EXISTS (SELECT 1 FROM financial_metrics m WHERE m.announcement_id=a.id AND m.period=${input.preferredPeriod}) THEN 0 ELSE 1 END,
        a.published_at DESC
      LIMIT ${input.limit}`;
    return rows.map(mapRetrievalReport);
  }

  async findChunks(reportIds: string[], limit: number) {
    if (!reportIds.length) return [];
    const rows = await this.db<ChunkRow[]>`SELECT announcement_id, page, content FROM report_chunks
      WHERE announcement_id IN ${this.db(reportIds)} ORDER BY page LIMIT ${limit}`;
    return rows.map(mapChunk);
  }
}
