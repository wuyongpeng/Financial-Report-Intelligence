import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { requireAdmin } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { ensureBackendSchema } from '@/lib/backend-schema';
import { getDb } from '@/lib/db';
import {
  buildCheckCells,
  CHECK_METRICS,
  type CheckMetric,
  type DbMetricRow,
  type ThirdPartyRow,
} from '@/lib/metrics-check';

export const dynamic = 'force-dynamic';

function isFiniteOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isThirdPartyRow(value: unknown): value is ThirdPartyRow {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.code === 'string'
    && /^\d{6}$/.test(row.code)
    && typeof row.period === 'string'
    && row.period.length > 0
    && isFiniteOrNull(row.revenueYi)
    && isFiniteOrNull(row.netProfitYi)
    && isFiniteOrNull(row.eps)
    && isFiniteOrNull(row.roe)
    && (row.name === undefined || typeof row.name === 'string');
}

async function loadThirdParty(): Promise<ThirdPartyRow[]> {
  const raw = await readFile(resolve(process.cwd(), 'data/third-party-metrics.json'), 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error('third-party-metrics.json must be an array');
  const rows = parsed.filter(isThirdPartyRow);
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.code}:${row.period}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    await ensureBackendSchema();
    const thirdParty = await loadThirdParty();
    const codes = [...new Set(thirdParty.map((row) => row.code))];
    const periods = [...new Set(thirdParty.map((row) => row.period))];
    const db = getDb();
    const dbRows = codes.length === 0 ? [] : await db<DbMetricRow[]>`
      SELECT m.code, c.name, m.period, m.metric, m.value, m.unit
      FROM financial_metrics m
      LEFT JOIN companies c ON c.code = m.code
      WHERE m.code IN ${db(codes)}
        AND m.period IN ${db(periods)}
        AND m.metric IN ${db(CHECK_METRICS)}
    `;
    const normalized: DbMetricRow[] = dbRows
      .filter((row): row is DbMetricRow => CHECK_METRICS.includes(row.metric as CheckMetric))
      .map((row) => ({
        code: row.code,
        name: row.name,
        period: row.period,
        metric: row.metric as CheckMetric,
        value: Number(row.value),
        unit: row.unit,
      }));
    const { cells, summary, periodNote } = buildCheckCells(thirdParty, normalized);
    return Response.json({
      periodNote,
      summary,
      cells,
      thirdPartyCount: thirdParty.length,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
