CREATE TABLE IF NOT EXISTS cover_embeddings (
  capa_code TEXT PRIMARY KEY,
  image_key TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  embedding_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cover_embeddings_updated_at
  ON cover_embeddings(updated_at);
