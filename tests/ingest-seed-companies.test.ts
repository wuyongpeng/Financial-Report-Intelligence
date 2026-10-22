import assert from 'node:assert/strict';
import test from 'node:test';
import companiesJson from '../data/companies.json';
import seedReportsJson from '../data/seed-reports.json';
import {
  companyFieldsFromSeedReport,
  exchangeFromCode,
  isAnnouncementCodeForeignKeyError,
} from '../lib/ingest';
import type { Company } from '../lib/types';

const companies = companiesJson as Company[];
const seedReports = seedReportsJson as Array<{
  code: string;
  company_name: string;
  industry?: string;
  rank?: number;
}>;

test('exchangeFromCode maps SSE / SZSE / BSE prefixes', () => {
  assert.equal(exchangeFromCode('600900'), 'SSE');
  assert.equal(exchangeFromCode('601288'), 'SSE');
  assert.equal(exchangeFromCode('000001'), 'SZSE');
  assert.equal(exchangeFromCode('300750'), 'SZSE');
  assert.equal(exchangeFromCode('688981'), 'SSE');
  assert.equal(exchangeFromCode('830799'), 'BSE');
});

test('companyFieldsFromSeedReport covers every seed-reports code (incl. outside monitor pool)', () => {
  const poolCodes = new Set(companies.map((c) => c.code));
  const byCode = new Map<string, ReturnType<typeof companyFieldsFromSeedReport>>();
  for (const item of seedReports) {
    if (!byCode.has(item.code)) byCode.set(item.code, companyFieldsFromSeedReport(item));
  }
  assert.ok(byCode.has('600900'), '长江电力 600900 must be ensured from seed-reports');
  assert.equal(byCode.get('600900')?.name, '长江电力');
  assert.equal(byCode.get('600900')?.exchange, 'SSE');
  assert.equal(byCode.get('600900')?.industry, '公用事业');

  const missingFromPool = [...byCode.keys()].filter((code) => !poolCodes.has(code));
  assert.ok(missingFromPool.length >= 1, 'fixture expects at least one seed-only code');
  for (const fields of byCode.values()) {
    assert.ok(fields.code);
    assert.ok(fields.name);
    assert.match(fields.exchange, /^(SSE|SZSE|BSE)$/);
    assert.ok(fields.industry);
    assert.equal(typeof fields.rank, 'number');
  }
});

test('isAnnouncementCodeForeignKeyError matches Postgres 23503 on announcements_code_fkey', () => {
  assert.equal(
    isAnnouncementCodeForeignKeyError({
      code: '23503',
      constraint_name: 'announcements_code_fkey',
      message: 'Key (code)=(600900) is not present in table "companies".',
    }),
    true,
  );
  assert.equal(
    isAnnouncementCodeForeignKeyError({
      code: '23503',
      constraint: 'announcements_code_fkey',
    }),
    true,
  );
  assert.equal(
    isAnnouncementCodeForeignKeyError(
      'PostgresError: insert or update on table "announcements" violates foreign key constraint "announcements_code_fkey"',
    ),
    true,
  );
  assert.equal(
    isAnnouncementCodeForeignKeyError({ code: '23505', message: 'duplicate key' }),
    false,
  );
  assert.equal(isAnnouncementCodeForeignKeyError(new Error('network down')), false);
});
