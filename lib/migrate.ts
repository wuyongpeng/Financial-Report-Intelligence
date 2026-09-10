import { getDb } from './db';
import { ensureBackendSchema } from './backend-schema';

// Safe to run at every worker startup; supports a VM created before these V1.1 tables existed.
export async function ensureSchema() {
  const db = getDb();
  await db`CREATE TABLE IF NOT EXISTS report_chunks (
    id BIGSERIAL PRIMARY KEY, announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    page INTEGER NOT NULL, content TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(announcement_id, page)
  )`;
  await db`CREATE INDEX IF NOT EXISTS report_chunks_announcement_idx ON report_chunks (announcement_id, page)`;
  await db`CREATE TABLE IF NOT EXISTS review_events (
    id BIGSERIAL PRIMARY KEY, announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    action TEXT NOT NULL, reviewer TEXT NOT NULL, note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await db`CREATE INDEX IF NOT EXISTS review_events_announcement_idx ON review_events (announcement_id, created_at DESC)`;
  // Reader-level confirmations. Kept separate from admin review so that a single
  // reader can never flip a metric to verified on their own.
  await db`CREATE TABLE IF NOT EXISTS metric_feedback (
    id BIGSERIAL PRIMARY KEY, announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    metric TEXT NOT NULL, verdict TEXT NOT NULL, reporter TEXT NOT NULL, note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(announcement_id, metric, reporter)
  )`;
  await db`CREATE INDEX IF NOT EXISTS metric_feedback_announcement_idx ON metric_feedback (announcement_id, metric)`;
  await ensureBackendSchema();
}
