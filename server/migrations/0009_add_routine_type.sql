-- migrate:up
ALTER TABLE routines ADD COLUMN routine_type TEXT NOT NULL DEFAULT 'standard';

UPDATE routines
SET routine_type = CASE
  WHEN lower(COALESCE(routine_type, '')) = 'rehab' THEN 'rehab'
  ELSE 'standard'
END;

ALTER TABLE sessions ADD COLUMN routine_type TEXT NOT NULL DEFAULT 'standard';

UPDATE sessions
SET routine_type = COALESCE(
  (
    SELECT CASE
      WHEN lower(COALESCE(r.routine_type, '')) = 'rehab' THEN 'rehab'
      ELSE 'standard'
    END
    FROM routines r
    WHERE r.id = sessions.routine_id
  ),
  'standard'
);

UPDATE sessions
SET routine_type = CASE
  WHEN lower(COALESCE(routine_type, '')) = 'rehab' THEN 'rehab'
  ELSE 'standard'
END;

CREATE INDEX IF NOT EXISTS idx_routines_user_id_routine_type
ON routines(user_id, routine_type);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id_routine_type
ON sessions(user_id, routine_type);

-- migrate:down
-- SQLite migrations keep this as a no-op to avoid unsafe table rebuilds.
SELECT 1;
