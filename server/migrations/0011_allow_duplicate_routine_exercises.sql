-- migrate:up
ALTER TABLE session_sets ADD COLUMN routine_exercise_id INTEGER REFERENCES routine_exercises(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_session_sets_session_routine_exercise
ON session_sets(session_id, routine_exercise_id);

CREATE INDEX IF NOT EXISTS idx_session_sets_session_exercise
ON session_sets(session_id, exercise_id);

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS session_exercise_progress_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  exercise_id INTEGER NOT NULL,
  routine_exercise_id INTEGER,
  position INTEGER NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE,
  FOREIGN KEY (routine_exercise_id) REFERENCES routine_exercises(id) ON DELETE SET NULL
);

INSERT INTO session_exercise_progress_next (
  id,
  session_id,
  exercise_id,
  routine_exercise_id,
  position,
  status,
  started_at,
  completed_at,
  created_at,
  updated_at
)
SELECT
  id,
  session_id,
  exercise_id,
  NULL,
  position,
  status,
  started_at,
  completed_at,
  created_at,
  updated_at
FROM session_exercise_progress;

DROP TABLE session_exercise_progress;
ALTER TABLE session_exercise_progress_next RENAME TO session_exercise_progress;

CREATE INDEX IF NOT EXISTS idx_session_exercise_progress_session
ON session_exercise_progress(session_id, position);

CREATE INDEX IF NOT EXISTS idx_session_exercise_progress_status
ON session_exercise_progress(session_id, status);

CREATE INDEX IF NOT EXISTS idx_session_exercise_progress_session_routine_exercise
ON session_exercise_progress(session_id, routine_exercise_id);

CREATE INDEX IF NOT EXISTS idx_session_exercise_progress_session_exercise
ON session_exercise_progress(session_id, exercise_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_exercise_progress_unique_session_routine_exercise
ON session_exercise_progress(session_id, routine_exercise_id)
WHERE routine_exercise_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_exercise_progress_unique_session_exercise_fallback
ON session_exercise_progress(session_id, exercise_id)
WHERE routine_exercise_id IS NULL;

PRAGMA foreign_keys = ON;

-- migrate:down
-- SQLite migrations keep this as a no-op to avoid unsafe table rebuilds.
SELECT 1;
