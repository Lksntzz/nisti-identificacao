CREATE TABLE IF NOT EXISTS recognition_daily (
  day TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  successes INTEGER NOT NULL DEFAULT 0,
  unmatched INTEGER NOT NULL DEFAULT 0,
  system_errors INTEGER NOT NULL DEFAULT 0,
  embedding_requests INTEGER NOT NULL DEFAULT 0,
  generation_requests INTEGER NOT NULL DEFAULT 0,
  total_ms INTEGER NOT NULL DEFAULT 0,
  last_success_at TEXT,
  last_unmatched_at TEXT,
  last_error_at TEXT,
  last_error_message TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
