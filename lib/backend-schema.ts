import { getDb } from './db';

let ready: Promise<void> | undefined;

// Additive and idempotent for existing VM installations. The transaction lock
// serializes app/worker startup, and a failure can be retried on the next call.
export function ensureBackendSchema() {
  if (!ready) ready = migrate().catch(error => { ready = undefined; throw error; });
  return ready;
}

async function migrate() {
  const db = getDb();
  await db.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(62409010)`;
    await tx`CREATE TABLE IF NOT EXISTS chat_conversations (
      id UUID PRIMARY KEY, owner_key TEXT NOT NULL,
      report_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
      title TEXT NOT NULL, active_request_id UUID, locked_until TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await tx`CREATE INDEX IF NOT EXISTS chat_conversations_owner_idx ON chat_conversations(owner_key, report_id, updated_at DESC)`;
    await tx`CREATE TABLE IF NOT EXISTS chat_messages (
      id BIGSERIAL PRIMARY KEY, conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
      request_id UUID NOT NULL, role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK (status IN ('pending','complete','interrupted','failed')),
      evidence JSONB NOT NULL DEFAULT '[]'::jsonb, mode TEXT, duration_ms INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(conversation_id, request_id, role)
    )`;
    await tx`CREATE INDEX IF NOT EXISTS chat_messages_conversation_idx ON chat_messages(conversation_id, id)`;
    await tx`CREATE TABLE IF NOT EXISTS report_verdicts (
      announcement_id TEXT PRIMARY KEY REFERENCES announcements(id) ON DELETE CASCADE,
      payload JSONB,
      model TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending','ready','failed')),
      error TEXT,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await tx`CREATE TABLE IF NOT EXISTS metric_feedback (
      id BIGSERIAL PRIMARY KEY,
      announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
      metric TEXT NOT NULL,
      verdict TEXT NOT NULL,
      reporter TEXT NOT NULL,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(announcement_id, metric, reporter)
    )`;
    await tx`CREATE INDEX IF NOT EXISTS metric_feedback_announcement_idx ON metric_feedback (announcement_id, metric)`;
    await tx`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS parse_priority INTEGER NOT NULL DEFAULT 0`;
    await tx`ALTER TABLE financial_metrics ADD COLUMN IF NOT EXISTS prior_value DOUBLE PRECISION`;
    await tx`ALTER TABLE financial_metrics ADD COLUMN IF NOT EXISTS yoy_pct DOUBLE PRECISION`;
    await tx`ALTER TABLE financial_metrics ADD COLUMN IF NOT EXISTS yoy_source TEXT`;
    await tx`CREATE TABLE IF NOT EXISTS guest_home_prompts (
      owner_key TEXT PRIMARY KEY,
      source_question TEXT NOT NULL,
      questions JSONB NOT NULL,
      industry TEXT,
      company_code TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await tx`CREATE TABLE IF NOT EXISTS client_audit_events (
      id BIGSERIAL PRIMARY KEY,
      event_type TEXT NOT NULL CHECK (event_type IN ('visit', 'ask', 'answer_feedback')),
      owner_key TEXT,
      ip TEXT,
      user_agent TEXT,
      accept_language TEXT,
      path TEXT,
      referer TEXT,
      report_id TEXT,
      company_code TEXT,
      conversation_id UUID,
      request_id UUID,
      question TEXT,
      detail JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await tx`CREATE INDEX IF NOT EXISTS client_audit_events_created_idx ON client_audit_events (created_at DESC)`;
    await tx`CREATE INDEX IF NOT EXISTS client_audit_events_owner_idx ON client_audit_events (owner_key, created_at DESC)`;
    await tx`CREATE INDEX IF NOT EXISTS client_audit_events_type_idx ON client_audit_events (event_type, created_at DESC)`;
  });
}
