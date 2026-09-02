CREATE TABLE IF NOT EXISTS geometric_shadow_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evidence_token TEXT NOT NULL UNIQUE,
  photo_sha256 TEXT NOT NULL,
  platform TEXT NOT NULL,
  operator_id TEXT,
  operator_name TEXT,
  occurrence_id INTEGER,
  shadow_version TEXT NOT NULL DEFAULT 'v8.18',
  gate_version TEXT NOT NULL DEFAULT 'strict_core_v816',
  retrieval_fastpath_eligible INTEGER NOT NULL DEFAULT 0,
  retrieval_capa_code TEXT,
  geometric_evaluated INTEGER NOT NULL DEFAULT 0,
  geometric_eligible INTEGER NOT NULL DEFAULT 0,
  geometric_capa_code TEXT,
  evidence_json TEXT NOT NULL,
  confirmed_capa_code TEXT,
  confirmation_source TEXT,
  confirmed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_geometric_shadow_evidence_photo
  ON geometric_shadow_evidence(platform, photo_sha256);

CREATE INDEX IF NOT EXISTS idx_geometric_shadow_evidence_occurrence
  ON geometric_shadow_evidence(occurrence_id);

CREATE INDEX IF NOT EXISTS idx_geometric_shadow_evidence_confirmed
  ON geometric_shadow_evidence(confirmed_capa_code, confirmed_at);
