CREATE TABLE IF NOT EXISTS cover_visual_signatures (
  capa_code TEXT PRIMARY KEY,
  reference_id INTEGER,
  signature_model TEXT NOT NULL,
  signature_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reference_id) REFERENCES cover_visual_references(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_cover_visual_signatures_reference
  ON cover_visual_signatures(reference_id);
