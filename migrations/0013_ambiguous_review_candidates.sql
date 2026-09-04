CREATE TABLE IF NOT EXISTS scan_occurrence_candidates (
  occurrence_id INTEGER NOT NULL,
  capa_code TEXT NOT NULL,
  candidate_rank INTEGER NOT NULL,
  retrieval_score REAL NOT NULL DEFAULT 0,
  reference_id INTEGER,
  reference_kind TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (occurrence_id, capa_code),
  FOREIGN KEY (occurrence_id) REFERENCES scan_occurrences(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_scan_occurrence_candidates_occurrence_rank
  ON scan_occurrence_candidates(occurrence_id, candidate_rank ASC);
