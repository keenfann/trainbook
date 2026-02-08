-- migrate:up
ALTER TABLE session_sets ADD COLUMN band_label TEXT;
ALTER TABLE routine_exercises ADD COLUMN target_reps_range TEXT;

CREATE TABLE IF NOT EXISTS user_bands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_bands_user_name
ON user_bands(user_id, lower(name));

CREATE INDEX IF NOT EXISTS idx_user_bands_user_id ON user_bands(user_id);

-- migrate:down
DROP INDEX IF EXISTS idx_user_bands_user_id;
DROP INDEX IF EXISTS idx_user_bands_user_name;
DROP TABLE IF EXISTS user_bands;
