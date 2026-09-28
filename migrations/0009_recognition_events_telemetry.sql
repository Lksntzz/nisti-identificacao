ALTER TABLE recognition_events ADD COLUMN vectorize_ms INTEGER;
ALTER TABLE recognition_events ADD COLUMN local_cv_ms INTEGER;
ALTER TABLE recognition_events ADD COLUMN reference_load_ms INTEGER;
ALTER TABLE recognition_events ADD COLUMN retrieval_source TEXT;
ALTER TABLE recognition_events ADD COLUMN reused_candidates INTEGER;
ALTER TABLE recognition_events ADD COLUMN pipeline_version TEXT;
ALTER TABLE recognition_events ADD COLUMN reference_candidate_count INTEGER;
ALTER TABLE recognition_events ADD COLUMN vector_top_k INTEGER;
