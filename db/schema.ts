import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const companies = sqliteTable('companies', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  exchange: text('exchange').notNull(),
  industry: text('industry').notNull(),
  rank: integer('rank').notNull(),
  weight: integer('weight').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [index('idx_companies_enabled_rank').on(table.enabled, table.rank)]);

export const announcements = sqliteTable('announcements', {
  id: text('id').primaryKey(),
  source: text('source').notNull(),
  sourceId: text('source_id').notNull(),
  code: text('code').notNull(),
  companyName: text('company_name').notNull(),
  title: text('title').notNull(),
  reportType: text('report_type').notNull(),
  publishedAt: text('published_at').notNull(),
  discoveredAt: text('discovered_at').notNull(),
  downloadedAt: text('downloaded_at'),
  parsedAt: text('parsed_at'),
  onlineAt: text('online_at'),
  pdfUrl: text('pdf_url').notNull(),
  pdfKey: text('pdf_key'),
  pdfSha256: text('pdf_sha256'),
  status: text('status').notNull().default('discovered'),
  parseError: text('parse_error'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_announcements_source_id').on(table.source, table.sourceId),
  index('idx_announcements_code_published').on(table.code, table.publishedAt),
  index('idx_announcements_status').on(table.status),
]);

export const financialMetrics = sqliteTable('financial_metrics', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  announcementId: text('announcement_id').notNull(),
  code: text('code').notNull(),
  period: text('period').notNull(),
  metric: text('metric').notNull(),
  value: real('value').notNull(),
  unit: text('unit').notNull(),
  sourcePage: integer('source_page'),
  sourceLabel: text('source_label'),
  confidence: real('confidence').notNull().default(1),
  verified: integer('verified', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('idx_metrics_announcement_metric').on(table.announcementId, table.metric),
  index('idx_metrics_code_period').on(table.code, table.period),
]);

export const ingestRuns = sqliteTable('ingest_runs', {
  id: text('id').primaryKey(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  status: text('status').notNull(),
  discoveredCount: integer('discovered_count').notNull().default(0),
  insertedCount: integer('inserted_count').notNull().default(0),
  downloadedCount: integer('downloaded_count').notNull().default(0),
  sourceHealth: text('source_health').notNull().default('{}'),
  error: text('error'),
});

export const sourceHealth = sqliteTable('source_health', {
  source: text('source').primaryKey(),
  lastSuccessAt: text('last_success_at'),
  lastFailureAt: text('last_failure_at'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  circuitOpenUntil: text('circuit_open_until'),
  lastCount: integer('last_count').notNull().default(0),
  lastError: text('last_error'),
  updatedAt: text('updated_at').notNull(),
});
