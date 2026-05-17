-- migrate:up
UPDATE routine_exercises
SET target_reps = CAST(trim(substr(target_reps_range, 1, instr(target_reps_range, '-') - 1)) AS INTEGER)
WHERE target_reps IS NULL
  AND target_reps_range IS NOT NULL
  AND instr(target_reps_range, '-') > 1;

ALTER TABLE routine_exercises DROP COLUMN target_reps_range;

-- migrate:down
ALTER TABLE routine_exercises ADD COLUMN target_reps_range TEXT;
