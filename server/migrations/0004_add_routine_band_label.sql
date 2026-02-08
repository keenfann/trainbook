-- migrate:up
ALTER TABLE routine_exercises ADD COLUMN target_band_label TEXT;

-- migrate:down
-- SQLite migrations keep this as a no-op to avoid unsafe table rebuilds.
SELECT 1;
