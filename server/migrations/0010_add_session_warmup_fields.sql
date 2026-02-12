-- migrate:up
ALTER TABLE sessions ADD COLUMN warmup_started_at TEXT;
ALTER TABLE sessions ADD COLUMN warmup_completed_at TEXT;

-- migrate:down
-- SQLite migrations keep this as a no-op to avoid unsafe table rebuilds.
SELECT 1;
