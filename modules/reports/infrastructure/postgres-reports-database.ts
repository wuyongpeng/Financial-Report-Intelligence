import type { getDb } from '@/lib/db';
import type {
  DatabaseMetricRow,
  DatabaseReportRow,
  ReportsDatabase,
} from './postgres-report-repository';

type Db = ReturnType<typeof getDb>;

/** SQL-only adapter. Domain/application layers never receive the postgres client. */
export function createReportsDatabase(db: Db): ReportsDatabase {
  return {
    async findLatestCompanyReports(limit) {
      return db<DatabaseReportRow[]>`SELECT a.*, c.industry, c.rank FROM companies c JOIN LATERAL (
        SELECT a.* FROM announcements a WHERE a.code=c.code AND (
          SELECT COUNT(*) FROM financial_metrics m WHERE m.announcement_id=a.id AND m.metric IN ('revenue','net_profit','eps','roe')
        )=4 ORDER BY a.published_at DESC LIMIT 1
      ) a ON true WHERE c.enabled=true ORDER BY c.rank LIMIT ${limit}`;
    },

    async findCompanyReports(code, limit) {
      return db<DatabaseReportRow[]>`SELECT a.*, c.industry, c.rank
        FROM announcements a JOIN companies c ON c.code=a.code
        WHERE a.code=${code} AND a.status <> 'auto_skipped'
        ORDER BY a.published_at DESC LIMIT ${limit}`;
    },

    async findRecentReports(limit) {
      return db<DatabaseReportRow[]>`SELECT a.*, c.industry, c.rank
        FROM announcements a JOIN companies c ON c.code=a.code
        WHERE a.status <> 'auto_skipped'
        ORDER BY a.published_at DESC LIMIT ${limit}`;
    },

    async findComparablePriorReports(currentReportIds) {
      return db<DatabaseReportRow[]>`SELECT DISTINCT ON (a.code) a.*, c.industry, c.rank
        FROM announcements a JOIN companies c ON c.code=a.code
        JOIN financial_metrics p ON p.announcement_id=a.id AND p.metric='revenue'
        JOIN financial_metrics current ON current.announcement_id IN ${db(currentReportIds)} AND current.metric='revenue'
          AND current.code=a.code AND p.period=(SUBSTRING(current.period,1,4)::int-1)::text || SUBSTRING(current.period,5)
        JOIN announcements selected ON selected.id=current.announcement_id AND selected.report_type=a.report_type
        ORDER BY a.code, a.published_at DESC`;
    },

    async findMetricsByReportIds(reportIds) {
      return db<DatabaseMetricRow[]>`SELECT announcement_id, period, metric, value, unit, source_page, source_label, confidence, verified,
          prior_value, yoy_pct, yoy_source
        FROM financial_metrics WHERE announcement_id IN ${db(reportIds)}
        ORDER BY announcement_id, metric`;
    },
  };
}
