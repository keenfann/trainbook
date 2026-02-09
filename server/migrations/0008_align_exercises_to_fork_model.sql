-- migrate:up
PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS exercises_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  fork_id TEXT,
  force TEXT,
  level TEXT,
  mechanic TEXT,
  equipment TEXT,
  primary_muscles_json TEXT NOT NULL DEFAULT '[]',
  secondary_muscles_json TEXT NOT NULL DEFAULT '[]',
  instructions_json TEXT NOT NULL DEFAULT '[]',
  category TEXT,
  images_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  merged_into_id INTEGER,
  merged_at TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(name)
);

INSERT INTO exercises_next (
  id,
  name,
  fork_id,
  force,
  level,
  mechanic,
  equipment,
  primary_muscles_json,
  secondary_muscles_json,
  instructions_json,
  category,
  images_json,
  notes,
  merged_into_id,
  merged_at,
  archived_at,
  created_at,
  updated_at
)
SELECT
  id,
  name,
  NULL,
  NULL,
  'beginner',
  NULL,
  NULL,
  CASE
    WHEN lower(COALESCE(muscle_group, '')) = 'core' THEN '["abdominals"]'
    WHEN lower(COALESCE(muscle_group, '')) = 'legs' THEN '["quadriceps"]'
    WHEN lower(COALESCE(muscle_group, '')) = 'push' THEN '["chest"]'
    WHEN lower(COALESCE(muscle_group, '')) = 'pull' THEN '["lats"]'
    WHEN lower(COALESCE(muscle_group, '')) = 'corrective' THEN '["neck"]'
    ELSE '["abdominals"]'
  END,
  '[]',
  '[]',
  'strength',
  '[]',
  notes,
  merged_into_id,
  merged_at,
  archived_at,
  created_at,
  updated_at
FROM exercises;

DROP TABLE exercises;
ALTER TABLE exercises_next RENAME TO exercises;

CREATE UNIQUE INDEX IF NOT EXISTS idx_exercises_fork_id
ON exercises(fork_id)
WHERE fork_id IS NOT NULL;

PRAGMA foreign_keys = ON;

-- migrate:down
-- SQLite migrations keep this as a no-op to avoid unsafe table rebuilds.
SELECT 1;
