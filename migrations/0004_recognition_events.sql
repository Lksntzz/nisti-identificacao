CREATE TABLE IF NOT EXISTS recognition_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  http_status INTEGER NOT NULL,
  product_id INTEGER,
  capa_code TEXT,
  sku TEXT,
  confidence REAL,
  retrieval_score REAL,
  identified_by TEXT,
  error_message TEXT,
  total_ms INTEGER NOT NULL DEFAULT 0,
  embedding_ms INTEGER,
  gemini_ms INTEGER,
  retrieval_top1 REAL,
  retrieval_top1_code TEXT,
  retrieval_top2 REAL,
  retrieval_top2_code TEXT,
  retrieval_margin REAL,
  candidate_count INTEGER,
  verification_mode TEXT,
  accepted_by TEXT,
  model TEXT
);

CREATE INDEX IF NOT EXISTS idx_recognition_events_created_at
  ON recognition_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_recognition_events_kind_created_at
  ON recognition_events(kind, created_at DESC);
