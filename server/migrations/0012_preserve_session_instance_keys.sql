-- migrate:up
CREATE TABLE IF NOT EXISTS session_sets_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  exercise_id INTEGER NOT NULL,
  set_index INTEGER NOT NULL,
  reps INTEGER NOT NULL,
  weight REAL NOT NULL,
  rpe REAL,
  created_at TEXT NOT NULL,
  band_label TEXT,
  started_at TEXT,
  completed_at TEXT,
  routine_exercise_id INTEGER,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE
);

INSERT INTO session_sets_next (
  id,
  session_id,
  exercise_id,
  set_index,
  reps,
  weight,
  rpe,
  created_at,
  band_label,
  started_at,
  completed_at,
  routine_exercise_id
)
SELECT
  id,
  session_id,
  exercise_id,
  set_index,
  reps,
  weight,
  rpe,
  created_at,
  band_label,
  started_at,
  completed_at,
  routine_exercise_id
FROM session_sets;

DROP TABLE session_sets;
ALTER TABLE session_sets_next RENAME TO session_sets;

CREATE INDEX IF NOT EXISTS idx_session_sets_session_id
ON session_sets(session_id);

CREATE INDEX IF NOT EXISTS idx_session_sets_exercise_id
ON session_sets(exercise_id);

CREATE INDEX IF NOT EXISTS idx_session_sets_session_routine_exercise
ON session_sets(session_id, routine_exercise_id);

CREATE INDEX IF NOT EXISTS idx_session_sets_session_exercise
ON session_sets(session_id, exercise_id);

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
  FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE
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
  routine_exercise_id,
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

-- migrate:down
-- SQLite migrations keep this as a no-op to avoid unsafe table rebuilds.
SELECT 1;
