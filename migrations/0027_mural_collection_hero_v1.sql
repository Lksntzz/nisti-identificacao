ALTER TABLE mural_collections ADD COLUMN show_year INTEGER NOT NULL DEFAULT 1;
ALTER TABLE mural_collections ADD COLUMN hero_message TEXT;
ALTER TABLE mural_collections ADD COLUMN visual_direction TEXT NOT NULL DEFAULT 'automatic';
ALTER TABLE mural_collections ADD COLUMN theme_notes TEXT;
