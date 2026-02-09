import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../server/migrations.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

const LEGACY_0003_CHECKSUM =
  '178db5b60f011bb6ba908fa23a13309934c840f476c41b195c4e34c4696ca53a';
const MIGRATIONS_DIR = path.resolve(process.cwd(), 'server', 'migrations');

function hasColumn(db, tableName, columnName) {
  return db
    .prepare(`PRAGMA table_info(${tableName});`)
    .all()
    .some((column) => column.name === columnName);
}

describe('migration compatibility', () => {
  it('repairs legacy 0003 checksum and backfills missing target_reps_range', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trainbook-migrations-'));
    const dbPath = path.join(tempDir, 'legacy.sqlite');
    const legacyMigrationsDir = path.join(tempDir, 'legacy-migrations');
    fs.mkdirSync(legacyMigrationsDir, { recursive: true });
    fs.copyFileSync(
      path.join(MIGRATIONS_DIR, '0001_initial_schema.sql'),
      path.join(legacyMigrationsDir, '0001_initial_schema.sql')
    );
    fs.copyFileSync(
      path.join(MIGRATIONS_DIR, '0002_add_sync_operations.sql'),
      path.join(legacyMigrationsDir, '0002_add_sync_operations.sql')
    );

    const db = new DatabaseSync(dbPath);
    try {
      runMigrations(db, { migrationsDir: legacyMigrationsDir });
      db.exec(`
        ALTER TABLE session_sets ADD COLUMN band_label TEXT;
        CREATE TABLE IF NOT EXISTS user_bands (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_user_bands_user_name
        ON user_bands(user_id, lower(name));
        CREATE INDEX IF NOT EXISTS idx_user_bands_user_id ON user_bands(user_id);
      `);
      db.prepare(
        'INSERT INTO schema_migrations (id, checksum, applied_at, down_sql) VALUES (?, ?, ?, ?)'
      ).run(
        '0003_add_band_support.sql',
        LEGACY_0003_CHECKSUM,
        new Date().toISOString(),
        'legacy'
      );

      runMigrations(db, { migrationsDir: MIGRATIONS_DIR });

      const migrationRow = db
        .prepare('SELECT checksum FROM schema_migrations WHERE id = ?')
        .get('0003_add_band_support.sql');
      const currentChecksum = crypto
        .createHash('sha256')
        .update(
          fs.readFileSync(path.join(MIGRATIONS_DIR, '0003_add_band_support.sql'), 'utf8'),
          'utf8'
        )
        .digest('hex');

      expect(migrationRow.checksum).toBe(currentChecksum);
      expect(hasColumn(db, 'session_sets', 'band_label')).toBe(true);
      expect(hasColumn(db, 'session_sets', 'started_at')).toBe(true);
      expect(hasColumn(db, 'session_sets', 'completed_at')).toBe(true);
      expect(hasColumn(db, 'routine_exercises', 'target_reps_range')).toBe(true);
      expect(hasColumn(db, 'routine_exercises', 'target_band_label')).toBe(true);
      expect(hasColumn(db, 'routine_exercises', 'target_rest_seconds')).toBe(true);
      expect(hasColumn(db, 'routine_exercises', 'superset_group')).toBe(true);
      expect(hasColumn(db, 'session_exercise_progress', 'status')).toBe(true);
    } finally {
      db.close?.();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
