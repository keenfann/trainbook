-- migrate:up
ALTER TABLE session_sets ADD COLUMN started_at TEXT;
ALTER TABLE session_sets ADD COLUMN completed_at TEXT;

CREATE TABLE IF NOT EXISTS session_exercise_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  exercise_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE,
  UNIQUE(session_id, exercise_id)
);

CREATE INDEX IF NOT EXISTS idx_session_exercise_progress_session
ON session_exercise_progress(session_id, position);

CREATE INDEX IF NOT EXISTS idx_session_exercise_progress_status
ON session_exercise_progress(session_id, status);

-- migrate:down
-- SQLite migrations keep this as a no-op to avoid unsafe table rebuilds.
SELECT 1;
