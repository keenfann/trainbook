-- migrate:up
ALTER TABLE routine_exercises ADD COLUMN archived_at TEXT;

CREATE TABLE IF NOT EXISTS routine_exercise_set_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  routine_exercise_id INTEGER NOT NULL,
  set_index INTEGER NOT NULL,
  target_reps INTEGER NOT NULL,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (routine_exercise_id) REFERENCES routine_exercises(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_routine_exercise_set_targets_active
ON routine_exercise_set_targets(routine_exercise_id, set_index)
WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_routine_exercises_active_position
ON routine_exercises(routine_id, archived_at, position);

INSERT INTO routine_exercise_set_targets
  (routine_exercise_id, set_index, target_reps, archived_at, created_at, updated_at)
SELECT id, 1, target_reps, NULL, datetime('now'), datetime('now')
FROM routine_exercises
WHERE target_sets >= 1 AND target_reps IS NOT NULL
UNION ALL
SELECT id, 2, target_reps, NULL, datetime('now'), datetime('now')
FROM routine_exercises
WHERE target_sets >= 2 AND target_reps IS NOT NULL
UNION ALL
SELECT id, 3, target_reps, NULL, datetime('now'), datetime('now')
FROM routine_exercises
WHERE target_sets >= 3 AND target_reps IS NOT NULL;

ALTER TABLE session_exercise_progress ADD COLUMN snapshot_name TEXT;
ALTER TABLE session_exercise_progress ADD COLUMN snapshot_equipment TEXT;
ALTER TABLE session_exercise_progress ADD COLUMN snapshot_target_sets INTEGER;
ALTER TABLE session_exercise_progress ADD COLUMN snapshot_target_reps INTEGER;
ALTER TABLE session_exercise_progress ADD COLUMN snapshot_target_rest_seconds INTEGER;
ALTER TABLE session_exercise_progress ADD COLUMN snapshot_target_weight REAL;
ALTER TABLE session_exercise_progress ADD COLUMN snapshot_target_band_label TEXT;
ALTER TABLE session_exercise_progress ADD COLUMN snapshot_notes TEXT;
ALTER TABLE session_exercise_progress ADD COLUMN snapshot_superset_group TEXT;

UPDATE session_exercise_progress
SET
  snapshot_name = COALESCE(
    (
      SELECT e.name
      FROM exercises e
      WHERE e.id = session_exercise_progress.exercise_id
      LIMIT 1
    ),
    snapshot_name
  ),
  snapshot_equipment = COALESCE(
    (
      SELECT re.equipment
      FROM routine_exercises re
      WHERE re.id = session_exercise_progress.routine_exercise_id
      LIMIT 1
    ),
    snapshot_equipment
  ),
  snapshot_target_sets = COALESCE(
    (
      SELECT re.target_sets
      FROM routine_exercises re
      WHERE re.id = session_exercise_progress.routine_exercise_id
      LIMIT 1
    ),
    snapshot_target_sets
  ),
  snapshot_target_reps = COALESCE(
    (
      SELECT re.target_reps
      FROM routine_exercises re
      WHERE re.id = session_exercise_progress.routine_exercise_id
      LIMIT 1
    ),
    snapshot_target_reps
  ),
  snapshot_target_rest_seconds = COALESCE(
    (
      SELECT re.target_rest_seconds
      FROM routine_exercises re
      WHERE re.id = session_exercise_progress.routine_exercise_id
      LIMIT 1
    ),
    snapshot_target_rest_seconds
  ),
  snapshot_target_weight = COALESCE(
    (
      SELECT re.target_weight
      FROM routine_exercises re
      WHERE re.id = session_exercise_progress.routine_exercise_id
      LIMIT 1
    ),
    snapshot_target_weight
  ),
  snapshot_target_band_label = COALESCE(
    (
      SELECT re.target_band_label
      FROM routine_exercises re
      WHERE re.id = session_exercise_progress.routine_exercise_id
      LIMIT 1
    ),
    snapshot_target_band_label
  ),
  snapshot_notes = COALESCE(
    (
      SELECT re.notes
      FROM routine_exercises re
      WHERE re.id = session_exercise_progress.routine_exercise_id
      LIMIT 1
    ),
    snapshot_notes
  ),
  snapshot_superset_group = COALESCE(
    (
      SELECT re.superset_group
      FROM routine_exercises re
      WHERE re.id = session_exercise_progress.routine_exercise_id
      LIMIT 1
    ),
    snapshot_superset_group
  );

CREATE TABLE IF NOT EXISTS session_exercise_set_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  exercise_id INTEGER NOT NULL,
  routine_exercise_id INTEGER,
  set_index INTEGER NOT NULL,
  target_reps INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_exercise_set_targets_instance
ON session_exercise_set_targets(session_id, routine_exercise_id, set_index)
WHERE routine_exercise_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_exercise_set_targets_fallback
ON session_exercise_set_targets(session_id, exercise_id, set_index)
WHERE routine_exercise_id IS NULL;

INSERT OR IGNORE INTO session_exercise_set_targets
  (session_id, exercise_id, routine_exercise_id, set_index, target_reps, created_at)
SELECT
  sep.session_id,
  sep.exercise_id,
  sep.routine_exercise_id,
  rest.set_index,
  rest.target_reps,
  COALESCE(sep.created_at, datetime('now'))
FROM session_exercise_progress sep
JOIN routine_exercise_set_targets rest
  ON rest.routine_exercise_id = sep.routine_exercise_id
WHERE rest.archived_at IS NULL;

-- migrate:down
-- SQLite migrations keep this as a no-op to avoid unsafe table rebuilds.
SELECT 1;
