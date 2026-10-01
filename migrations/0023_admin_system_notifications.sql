CREATE TABLE IF NOT EXISTS admin_system_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  source TEXT NOT NULL DEFAULT 'system',
  actor_name TEXT,
  entity_type TEXT,
  entity_id TEXT,
  request_path TEXT,
  request_method TEXT,
  http_status INTEGER,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_system_notification_reads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notification_id INTEGER NOT NULL,
  admin_id TEXT NOT NULL DEFAULT 'admin',
  read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(notification_id, admin_id),
  FOREIGN KEY (notification_id) REFERENCES admin_system_notifications(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_admin_system_notifications_created
  ON admin_system_notifications(id DESC);

CREATE INDEX IF NOT EXISTS idx_admin_system_notification_reads_admin
  ON admin_system_notification_reads(admin_id, notification_id);
