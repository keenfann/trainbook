-- migrate:up
ALTER TABLE routine_exercises ADD COLUMN superset_group TEXT;

CREATE INDEX IF NOT EXISTS idx_routine_exercises_superset_group
ON routine_exercises(routine_id, superset_group);

-- migrate:down
-- SQLite migrations keep this as a no-op to avoid unsafe table rebuilds.
SELECT 1;
