-- migrate:up
CREATE TABLE IF NOT EXISTS sync_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  operation_id TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  result_json TEXT,
  UNIQUE(user_id, operation_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sync_operations_user_id ON sync_operations(user_id);
CREATE INDEX IF NOT EXISTS idx_sync_operations_applied_at ON sync_operations(applied_at);

-- migrate:down
DROP INDEX IF EXISTS idx_sync_operations_applied_at;
DROP INDEX IF EXISTS idx_sync_operations_user_id;
DROP TABLE IF EXISTS sync_operations;

