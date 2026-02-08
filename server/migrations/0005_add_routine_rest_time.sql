-- migrate:up
ALTER TABLE routine_exercises ADD COLUMN target_rest_seconds INTEGER;

-- migrate:down
-- SQLite migrations keep this as a no-op to avoid unsafe table rebuilds.
SELECT 1;
