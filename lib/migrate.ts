import { getDb } from './db';

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
}
