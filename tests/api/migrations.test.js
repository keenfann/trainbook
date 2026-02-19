import { describe, expect, it } from 'vitest';
import { setupApiIntegrationSuite } from '../helpers/api-integration-helpers.js';

const { db } = await setupApiIntegrationSuite('migrations');

describe('API integration migrations', () => {
  it('applies migrations with checksums and reversible SQL metadata', () => {
    const rows = db
      .prepare('SELECT id, checksum, down_sql FROM schema_migrations ORDER BY id')
      .all();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const ids = rows.map((row) => row.id);
    expect(ids).toContain('0001_initial_schema.sql');
    expect(ids).toContain('0002_add_sync_operations.sql');
    expect(ids).toContain('0003_add_band_support.sql');
    expect(ids).toContain('0004_add_routine_band_label.sql');
    expect(ids).toContain('0005_add_routine_rest_time.sql');
    expect(ids).toContain('0006_add_session_progress_timestamps.sql');
    expect(ids).toContain('0007_add_routine_superset_group.sql');
    expect(ids).toContain('0008_align_exercises_to_fork_model.sql');
    expect(ids).toContain('0009_add_routine_type.sql');
    expect(ids).toContain('0010_add_session_warmup_fields.sql');
    expect(ids).toContain('0011_allow_duplicate_routine_exercises.sql');
    expect(ids).toContain('0012_preserve_session_instance_keys.sql');
    expect(rows.every((row) => typeof row.checksum === 'string' && row.checksum.length === 64)).toBe(true);
    expect(rows.every((row) => typeof row.down_sql === 'string' && row.down_sql.length > 0)).toBe(true);

    const syncColumns = db
      .prepare('PRAGMA table_info(sync_operations)')
      .all()
      .map((column) => column.name);
    expect(syncColumns).toContain('operation_id');
    expect(syncColumns).toContain('operation_type');
    expect(syncColumns).toContain('payload');

    const setColumns = db
      .prepare('PRAGMA table_info(session_sets)')
      .all()
      .map((column) => column.name);
    expect(setColumns).toContain('band_label');
    expect(setColumns).toContain('started_at');
    expect(setColumns).toContain('completed_at');

    const routineColumns = db
      .prepare('PRAGMA table_info(routine_exercises)')
      .all()
      .map((column) => column.name);
    expect(routineColumns).toContain('target_reps_range');
    expect(routineColumns).toContain('target_band_label');
    expect(routineColumns).toContain('target_rest_seconds');
    expect(routineColumns).toContain('superset_group');
    const routinesColumns = db
      .prepare('PRAGMA table_info(routines)')
      .all()
      .map((column) => column.name);
    expect(routinesColumns).toContain('routine_type');
    const sessionsColumns = db
      .prepare('PRAGMA table_info(sessions)')
      .all()
      .map((column) => column.name);
    expect(sessionsColumns).toContain('routine_type');

    const bandColumns = db
      .prepare('PRAGMA table_info(user_bands)')
      .all()
      .map((column) => column.name);
    expect(bandColumns).toContain('name');

    const progressColumns = db
      .prepare('PRAGMA table_info(session_exercise_progress)')
      .all()
      .map((column) => column.name);
    expect(progressColumns).toContain('session_id');
    expect(progressColumns).toContain('exercise_id');
    expect(progressColumns).toContain('status');

    const exerciseColumns = db
      .prepare('PRAGMA table_info(exercises)')
      .all()
      .map((column) => column.name);
    expect(exerciseColumns).toContain('fork_id');
    expect(exerciseColumns).toContain('primary_muscles_json');
    expect(exerciseColumns).not.toContain('muscle_group');
  });

});
