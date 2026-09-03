CREATE TABLE IF NOT EXISTS system_usage_daily (
  day TEXT PRIMARY KEY,
  gemini_embedding_calls INTEGER NOT NULL DEFAULT 0,
  gemini_generation_calls INTEGER NOT NULL DEFAULT 0,
  vectorize_queries INTEGER NOT NULL DEFAULT 0,
  vectorize_upsert_vectors INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
