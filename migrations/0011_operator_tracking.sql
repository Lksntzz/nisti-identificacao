ALTER TABLE recognition_events ADD COLUMN operator_name TEXT;
ALTER TABLE recognition_events ADD COLUMN operator_id TEXT;

CREATE INDEX IF NOT EXISTS idx_recognition_events_operator_name
  ON recognition_events(operator_name, created_at DESC);
