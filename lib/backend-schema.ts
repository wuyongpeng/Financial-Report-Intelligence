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
    await tx`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS audit_opinion_kind TEXT`;
    await tx`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS audit_opinion_type TEXT`;
    await tx`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS audit_opinion_label TEXT`;
    await tx`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS audit_opinion_page INTEGER`;
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
    await tx`CREATE TABLE IF NOT EXISTS user_feedback (
      id BIGSERIAL PRIMARY KEY,
      message TEXT NOT NULL,
      contact TEXT,
      page TEXT,
      url TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await tx`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS contact TEXT`;
    await tx`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS category TEXT`;
    await tx`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS handling_status TEXT NOT NULL DEFAULT 'open'`;
    await tx`UPDATE user_feedback SET category = '其它' WHERE category IS NULL OR category = ''`;
    await tx`UPDATE user_feedback SET handling_status = 'open' WHERE handling_status IS NULL OR handling_status = ''`;
    await tx`CREATE INDEX IF NOT EXISTS user_feedback_created_idx ON user_feedback (created_at DESC)`;
    await tx`CREATE TABLE IF NOT EXISTS survey_invites (
      id BIGSERIAL PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      note TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await tx`CREATE INDEX IF NOT EXISTS survey_invites_created_idx ON survey_invites (created_at DESC)`;
    await tx`CREATE TABLE IF NOT EXISTS survey_responses (
      id BIGSERIAL PRIMARY KEY,
      invite_id BIGINT NOT NULL REFERENCES survey_invites(id) ON DELETE CASCADE,
      nickname TEXT,
      basic JSONB NOT NULL,
      deep JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await tx`CREATE INDEX IF NOT EXISTS survey_responses_invite_idx ON survey_responses (invite_id, created_at DESC)`;
    await tx`CREATE INDEX IF NOT EXISTS survey_responses_created_idx ON survey_responses (created_at DESC)`;
    await tx`CREATE TABLE IF NOT EXISTS metrics_overview_acks (
      announcement_id TEXT PRIMARY KEY REFERENCES announcements(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      period TEXT NOT NULL,
      note TEXT,
      acked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await tx`CREATE INDEX IF NOT EXISTS metrics_overview_acks_code_period_idx
      ON metrics_overview_acks (code, period)`;
    // Independent cross-check review, scoped to a company/period/metric snapshot.
    await tx`CREATE TABLE IF NOT EXISTS metrics_check_reviews (
      code TEXT NOT NULL,
      period TEXT NOT NULL,
      metric TEXT NOT NULL CHECK (metric IN ('revenue','net_profit','eps','roe')),
      fingerprint TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('approved','flagged')),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (code, period, metric)
    )`;
    // Append-only treatment notes: changing data never erases earlier handling history.
    await tx`CREATE TABLE IF NOT EXISTS metrics_check_progress (
      id BIGSERIAL PRIMARY KEY,
      code TEXT NOT NULL,
      period TEXT NOT NULL,
      metric TEXT NOT NULL CHECK (metric IN ('revenue','net_profit','eps','roe')),
      fingerprint TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('open','in_progress','resolved')),
      note TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await tx`CREATE INDEX IF NOT EXISTS metrics_check_progress_latest_idx
      ON metrics_check_progress (code, period, metric, updated_at DESC, id DESC)`;
    /* Human review state for /admin/metrics: acked ↔ flagged (mutual exclusive). */
    await tx`CREATE TABLE IF NOT EXISTS metrics_overview_reviews (
      announcement_id TEXT PRIMARY KEY REFERENCES announcements(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      period TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('acked', 'flagged')),
      note TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await tx`CREATE INDEX IF NOT EXISTS metrics_overview_reviews_code_period_idx
      ON metrics_overview_reviews (code, period)`;
    await tx`CREATE INDEX IF NOT EXISTS metrics_overview_reviews_status_idx
      ON metrics_overview_reviews (status)`;
    await tx`CREATE TABLE IF NOT EXISTS metrics_overview_review_events (
      id BIGSERIAL PRIMARY KEY,
      announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      period TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('acked', 'flagged')),
      reason TEXT CHECK (
        reason IS NULL OR reason IN ('real_disclosure', 'parse_value', 'parse_page_unit', 'parse_period')
      ),
      issues JSONB NOT NULL DEFAULT '[]'::jsonb,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await tx`CREATE INDEX IF NOT EXISTS metrics_overview_review_events_created_idx
      ON metrics_overview_review_events (created_at DESC, id DESC)`;
    await tx`
      INSERT INTO metrics_overview_reviews (announcement_id, code, period, status, note, updated_at)
      SELECT announcement_id, code, period, 'acked', note, acked_at
      FROM metrics_overview_acks
      ON CONFLICT (announcement_id) DO NOTHING
    `;
  });
}
