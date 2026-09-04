-- v8.24.3 — D1 read optimization
--
-- These indexes deliberately match the expressions already used by the
-- application (UPPER(TRIM(...))). This preserves current lookup semantics
-- while allowing SQLite/D1 to SEARCH an index instead of scanning tables.

CREATE INDEX IF NOT EXISTS idx_products_capa_normalized_id
  ON products(UPPER(TRIM(capa_code)), id);

CREATE INDEX IF NOT EXISTS idx_product_platforms_platform_normalized_product
  ON product_platforms(UPPER(TRIM(platform)), product_id, id);

CREATE INDEX IF NOT EXISTS idx_cover_visual_references_capa_normalized_active_id
  ON cover_visual_references(UPPER(TRIM(capa_code)), active, id);

CREATE INDEX IF NOT EXISTS idx_notifications_capa_normalized
  ON notifications(UPPER(TRIM(capa_code)));

-- recognition_events is append-only and its admin views order by id DESC.
-- Existing indexes use created_at; these match the actual query predicates.
CREATE INDEX IF NOT EXISTS idx_recognition_events_kind_id
  ON recognition_events(kind, id DESC);

CREATE INDEX IF NOT EXISTS idx_recognition_events_operator_name_id
  ON recognition_events(operator_name, id DESC);

CREATE INDEX IF NOT EXISTS idx_recognition_events_operator_kind_id
  ON recognition_events(operator_name, kind, id DESC);

CREATE INDEX IF NOT EXISTS idx_recognition_events_operator_id
  ON recognition_events(operator_id);

PRAGMA optimize;
