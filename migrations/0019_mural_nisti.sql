CREATE TABLE IF NOT EXISTS mural_collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  year INTEGER,
  description TEXT,
  image_key TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','archived')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mural_collection_products (
  collection_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, product_id),
  FOREIGN KEY (collection_id) REFERENCES mural_collections(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mural_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL
    CHECK (kind IN ('product','collection','notice')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','archived')),
  title TEXT NOT NULL,
  subtitle TEXT,
  body TEXT,
  badge TEXT,
  badge_tone TEXT,
  image_key TEXT,
  product_id INTEGER,
  collection_id INTEGER,
  notice_level TEXT
    CHECK (notice_level IS NULL OR notice_level IN ('important','attention','info')),
  featured INTEGER NOT NULL DEFAULT 0
    CHECK (featured IN (0,1)),
  priority INTEGER NOT NULL DEFAULT 0
    CHECK (priority BETWEEN 0 AND 100),
  published_at TEXT,
  expires_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
  FOREIGN KEY (collection_id) REFERENCES mural_collections(id) ON DELETE SET NULL,
  CHECK (
    (kind='product' AND product_id IS NOT NULL AND collection_id IS NULL AND notice_level IS NULL)
    OR (kind='collection' AND collection_id IS NOT NULL AND product_id IS NULL AND notice_level IS NULL)
    OR (kind='notice' AND product_id IS NULL AND collection_id IS NULL AND notice_level IS NOT NULL)
  ),
  CHECK (expires_at IS NULL OR published_at IS NULL OR datetime(expires_at) > datetime(published_at))
);

CREATE TABLE IF NOT EXISTS mural_post_reads (
  post_id INTEGER NOT NULL,
  user_id TEXT NOT NULL CHECK (length(user_id) BETWEEN 1 AND 100),
  read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, user_id),
  FOREIGN KEY (post_id) REFERENCES mural_posts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mural_posts_feed
  ON mural_posts(status, featured DESC, priority DESC, published_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_mural_posts_kind_date
  ON mural_posts(kind, status, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_mural_posts_product_id
  ON mural_posts(product_id);

CREATE INDEX IF NOT EXISTS idx_mural_posts_collection_id
  ON mural_posts(collection_id);

CREATE INDEX IF NOT EXISTS idx_mural_reads_user
  ON mural_post_reads(user_id, post_id);

CREATE INDEX IF NOT EXISTS idx_mural_collection_products_product_id
  ON mural_collection_products(product_id);

CREATE INDEX IF NOT EXISTS idx_mural_collection_products_order
  ON mural_collection_products(collection_id, sort_order, product_id);
