import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../server/migrations.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'server', 'migrations');

function hasColumn(db, tableName, columnName) {
  return db
    .prepare(`PRAGMA table_info(${tableName});`)
    .all()
    .some((column) => column.name === columnName);
}

describe('migrations', () => {
  it('applies all migrations to a fresh database and remains idempotent', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trainbook-migrations-'));
    const dbPath = path.join(tempDir, 'fresh.sqlite');
    const migrationFileCount = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith('.sql')).length;

    const db = new DatabaseSync(dbPath);
    try {
      runMigrations(db, { migrationsDir: MIGRATIONS_DIR });
      runMigrations(db, { migrationsDir: MIGRATIONS_DIR });

      const appliedMigrations = db
        .prepare('SELECT COUNT(*) AS count FROM schema_migrations')
        .get()?.count;
      expect(Number(appliedMigrations)).toBe(migrationFileCount);
      expect(hasColumn(db, 'session_sets', 'band_label')).toBe(true);
      expect(hasColumn(db, 'session_sets', 'started_at')).toBe(true);
      expect(hasColumn(db, 'session_sets', 'completed_at')).toBe(true);
      expect(hasColumn(db, 'routine_exercises', 'target_reps_range')).toBe(true);
      expect(hasColumn(db, 'routine_exercises', 'target_band_label')).toBe(true);
      expect(hasColumn(db, 'routine_exercises', 'target_rest_seconds')).toBe(true);
      expect(hasColumn(db, 'routine_exercises', 'superset_group')).toBe(true);
      expect(hasColumn(db, 'routines', 'routine_type')).toBe(true);
      expect(hasColumn(db, 'sessions', 'routine_type')).toBe(true);
      expect(hasColumn(db, 'session_exercise_progress', 'status')).toBe(true);
      expect(hasColumn(db, 'exercises', 'fork_id')).toBe(true);
      expect(hasColumn(db, 'exercises', 'primary_muscles_json')).toBe(true);
      expect(hasColumn(db, 'exercises', 'secondary_muscles_json')).toBe(true);
      expect(hasColumn(db, 'exercises', 'instructions_json')).toBe(true);
      expect(hasColumn(db, 'exercises', 'images_json')).toBe(true);
      expect(hasColumn(db, 'exercises', 'muscle_group')).toBe(false);
    } finally {
      db.close?.();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
