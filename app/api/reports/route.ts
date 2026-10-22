import { apiError } from '@/lib/api';
import { ensureBackendSchema } from '@/lib/backend-schema';
import { getDb } from '@/lib/db';
import { healFilingLabels } from '@/lib/period-heal';
import { parseReportListQuery } from '@/contracts/reports';
import { listReports } from '@/modules/reports/application/list-reports';
import { PostgresReportRepository } from '@/modules/reports/infrastructure/postgres-report-repository';
import { createReportsDatabase } from '@/modules/reports/infrastructure/postgres-reports-database';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await ensureBackendSchema();
    const query = parseReportListQuery(new URL(request.url));
    const db = getDb();
    const repository = new PostgresReportRepository(createReportsDatabase(db));
    const body = await listReports(query, repository, reports => healFilingLabels(db, reports.map(report => ({
      id: report.id,
      title: report.title,
      published_at: report.publishedAt,
    }))));
    return Response.json(body, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
