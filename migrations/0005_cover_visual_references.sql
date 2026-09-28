CREATE TABLE IF NOT EXISTS cover_visual_references (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  capa_code TEXT NOT NULL,
  image_key TEXT NOT NULL,
  source_product_id INTEGER,
  reference_kind TEXT NOT NULL DEFAULT 'product',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (capa_code, image_key),
  FOREIGN KEY (source_product_id) REFERENCES products(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_cover_visual_references_cover_active
  ON cover_visual_references(capa_code, active);

CREATE INDEX IF NOT EXISTS idx_cover_visual_references_product
  ON cover_visual_references(source_product_id);

CREATE TABLE IF NOT EXISTS cover_reference_embeddings (
  reference_id INTEGER PRIMARY KEY,
  embedding_model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  embedding_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reference_id) REFERENCES cover_visual_references(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cover_reference_embeddings_updated_at
  ON cover_reference_embeddings(updated_at);

-- Seed every current product mockup as an active visual reference. This is
-- intentionally broader than the legacy one-row-per-capa table.
INSERT OR IGNORE INTO cover_visual_references (
  capa_code,
  image_key,
  source_product_id,
  reference_kind,
  active,
  created_at,
  updated_at
)
SELECT
  UPPER(TRIM(p.capa_code)),
  p.image_key,
  p.id,
  'product',
  1,
  COALESCE(p.created_at, CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP
FROM products p
WHERE p.image_key IS NOT NULL
  AND TRIM(COALESCE(p.capa_code, '')) <> '';

-- Preserve the existing embedding when its image is still a current product
-- reference. Remaining references are filled by the reindex endpoint.
INSERT OR REPLACE INTO cover_reference_embeddings (
  reference_id,
  embedding_model,
  dimensions,
  embedding_json,
  updated_at
)
SELECT
  r.id,
  ce.embedding_model,
  ce.dimensions,
  ce.embedding_json,
  ce.updated_at
FROM cover_embeddings ce
JOIN cover_visual_references r
  ON r.capa_code = UPPER(TRIM(ce.capa_code))
 AND r.image_key = ce.image_key
WHERE r.active = 1;
