CREATE TABLE IF NOT EXISTS gtin_scan_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gtin TEXT NOT NULL,
  status TEXT NOT NULL,
  product_id INTEGER,
  operator_name TEXT,
  operator_id TEXT,
  response_ms INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
  CHECK (length(gtin) = 13 AND gtin NOT GLOB '*[^0-9]*'),
  CHECK (status IN ('identified','not_found','system_error'))
);

CREATE INDEX IF NOT EXISTS idx_gtin_scan_events_created_at
  ON gtin_scan_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gtin_scan_events_status_created_at
  ON gtin_scan_events(status,created_at DESC);
