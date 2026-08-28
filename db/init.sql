CREATE TABLE IF NOT EXISTS companies (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  exchange TEXT NOT NULL,
  industry TEXT NOT NULL,
  rank INTEGER NOT NULL,
  weight INTEGER NOT NULL DEFAULT 1,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  code TEXT NOT NULL REFERENCES companies(code),
  company_name TEXT NOT NULL,
  title TEXT NOT NULL,
  report_type TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  discovered_at TIMESTAMPTZ NOT NULL,
  pdf_url TEXT NOT NULL,
  pdf_key TEXT,
  pdf_sha256 TEXT,
  downloaded_at TIMESTAMPTZ,
  parsed_at TIMESTAMPTZ,
  online_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'discovered',
  parse_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS announcements_code_published_idx ON announcements (code, published_at DESC);
CREATE INDEX IF NOT EXISTS announcements_status_idx ON announcements (status, published_at DESC);

CREATE TABLE IF NOT EXISTS financial_metrics (
  id BIGSERIAL PRIMARY KEY,
  announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  code TEXT NOT NULL REFERENCES companies(code),
  metric TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  unit TEXT NOT NULL,
  period TEXT NOT NULL,
  source_page INTEGER,
  source_label TEXT,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (announcement_id, metric)
);
CREATE INDEX IF NOT EXISTS financial_metrics_announcement_idx ON financial_metrics (announcement_id);
CREATE INDEX IF NOT EXISTS financial_metrics_code_period_idx ON financial_metrics (code, period);

CREATE TABLE IF NOT EXISTS ingest_runs (
  id TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  discovered_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  downloaded_count INTEGER NOT NULL DEFAULT 0,
  source_health JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT
);

CREATE TABLE IF NOT EXISTS source_health (
  source TEXT PRIMARY KEY,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_count INTEGER,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS report_chunks (
  id BIGSERIAL PRIMARY KEY,
  announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  page INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (announcement_id, page)
);
CREATE INDEX IF NOT EXISTS report_chunks_announcement_idx ON report_chunks (announcement_id, page);

CREATE TABLE IF NOT EXISTS review_events (
  id BIGSERIAL PRIMARY KEY,
  announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS review_events_announcement_idx ON review_events (announcement_id, created_at DESC);
