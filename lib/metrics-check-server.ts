import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { TransactionSql } from 'postgres';
import { getDb } from './db';
import { buildCheckCells, CHECK_METRICS, ADDITIVE_CHECK_METRICS, h1PeriodForQ3, pickCanonicalCheckRows,
  type CheckMetric, type CheckFilingMetric, type ThirdPartyRow, type CheckCell } from './metrics-check';
import type { CheckSnapshotCell } from './metrics-check-review';

export type CheckDbRow = CheckFilingMetric;

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


/** Fixed raw inputs, not rounded display text; H1 companions invalidate Q3 approval. */
export function checkCellSnapshot(cell: CheckCell, rows: CheckDbRow[]): CheckSnapshotCell {
  const equivalent = (period: string) => period.replace(/Q2$/, 'H1');
  const current = rows.filter(row => row.code === cell.code && equivalent(row.period) === equivalent(cell.period ?? ''));
  const own = current.find(row => row.period === cell.period && row.metric === cell.metric)
    ?? current.find(row => row.metric === cell.metric);
  const companionPeriod = h1PeriodForQ3(cell.period ?? '');
  const companion = companionPeriod && ADDITIVE_CHECK_METRICS.has(cell.metric)
    ? rows.find(row => row.code === cell.code && row.metric === cell.metric && row.period === companionPeriod)
      ?? rows.find(row => row.code === cell.code && row.metric === cell.metric && row.period === companionPeriod.replace(/H1$/, 'Q2'))
    : undefined;
  const raw = (row: CheckDbRow | undefined) => row
    ? [row.period, row.metric, row.value, row.unit, row.announcement_id] : null;
  const announcementId = own?.announcement_id ?? current.find(row => row.announcement_id)?.announcement_id ?? null;
  const fingerprint = createHash('sha256').update(JSON.stringify([
    'check-v1', cell.code, cell.period, cell.metric, cell.thirdParty,
    raw(own), raw(companion), cell.dbConverted, cell.status, cell.relDiff, cell.note, announcementId,
  ])).digest('hex');
  return { ...cell, fingerprint, announcementId };
}

export async function loadCheckSnapshot(db: ReturnType<typeof getDb> | TransactionSql = getDb()) {
  const thirdParty = await loadThirdParty();
  const codes = [...new Set(thirdParty.map((row) => row.code))];
  const periodSet = new Set(thirdParty.map((row) => row.period));
  // Q3 YTD fold needs companion H1/Q2 rows even if that period is absent from third-party.
  for (const period of [...periodSet]) {
    if (/H1$/i.test(period)) periodSet.add(period.replace(/H1$/i, 'Q2'));
    if (/Q2$/i.test(period)) periodSet.add(period.replace(/Q2$/i, 'H1'));
    const m = period.match(/^(20\d{2})Q3$/i);
    if (m) {
      periodSet.add(`${m[1]}H1`);
      periodSet.add(`${m[1]}Q2`);
    }
  }
  const periods = [...periodSet];
  const dbRows = codes.length === 0 ? [] : await db<CheckDbRow[]>`
    SELECT m.code, c.name, m.period, m.metric, m.value, m.unit, m.announcement_id,
           a.title, a.status, a.published_at, a.parsed_at
    FROM financial_metrics m
    JOIN announcements a ON a.id = m.announcement_id
    LEFT JOIN companies c ON c.code = m.code
    WHERE m.code IN ${db(codes)}
      AND m.period IN ${db(periods)}
      AND m.metric IN ${db(CHECK_METRICS)}
      AND a.status <> 'auto_skipped'
  `;
  const normalized: CheckDbRow[] = pickCanonicalCheckRows(dbRows
    .filter((row): row is CheckDbRow => CHECK_METRICS.includes(row.metric as CheckMetric) && Boolean(row.announcement_id))
    .map((row) => ({
      ...row,
      code: row.code,
      name: row.name,
      period: row.period,
      metric: row.metric as CheckMetric,
      value: Number(row.value),
      unit: row.unit,
      title: row.title ?? '',
      announcement_id: row.announcement_id,
    })));
  const { cells, summary, periodNote } = buildCheckCells(thirdParty, normalized);

  return { cells: cells.map(cell => checkCellSnapshot(cell, normalized)), summary, periodNote, thirdPartyCount: thirdParty.length };
}
