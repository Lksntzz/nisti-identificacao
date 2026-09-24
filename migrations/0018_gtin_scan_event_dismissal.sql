ALTER TABLE gtin_scan_events ADD COLUMN dismissed_at TEXT;
ALTER TABLE gtin_scan_events ADD COLUMN dismissed_by TEXT;

CREATE INDEX IF NOT EXISTS idx_gtin_scan_events_pending
  ON gtin_scan_events(status, dismissed_at, id DESC);
