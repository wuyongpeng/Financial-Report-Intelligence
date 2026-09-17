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
  });
}
