CREATE TABLE IF NOT EXISTS scan_occurrences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_key TEXT NOT NULL,
  platform TEXT,
  suggested_capa_code TEXT,
  confidence REAL,
  error_reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'trained', 'dismissed')),
  trained_capa_code TEXT,
  trained_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_scan_occurrences_status_created_at
  ON scan_occurrences(status, created_at DESC);
