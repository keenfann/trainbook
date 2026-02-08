import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_MIGRATIONS_DIR = path.resolve(__dirname, 'migrations');
const UP_MARKER = '-- migrate:up';
const DOWN_MARKER = '-- migrate:down';
const LEGACY_0003_CHECKSUM =
  '178db5b60f011bb6ba908fa23a13309934c840f476c41b195c4e34c4696ca53a';

function parseMigration(content, id) {
  const upIndex = content.indexOf(UP_MARKER);
  if (upIndex === -1) {
    throw new Error(`Migration ${id} is missing "${UP_MARKER}" marker.`);
  }
  const downIndex = content.indexOf(DOWN_MARKER);
  const upSql = content
    .slice(upIndex + UP_MARKER.length, downIndex === -1 ? undefined : downIndex)
    .trim();
  const downSql = downIndex === -1 ? '' : content.slice(downIndex + DOWN_MARKER.length).trim();

  if (!upSql) {
    throw new Error(`Migration ${id} has empty up SQL.`);
  }

  return { upSql, downSql };
}

function migrationChecksum(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      down_sql TEXT NOT NULL
    );
  `);
}

function tableHasColumn(db, tableName, columnName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName});`).all();
  return columns.some((column) => column.name === columnName);
}

function ensureColumn(db, tableName, columnName, statement) {
  if (!tableHasColumn(db, tableName, columnName)) {
    db.exec(statement);
  }
}

function repairLegacyBandSupportMigration(db) {
  ensureColumn(
    db,
    'session_sets',
    'band_label',
    'ALTER TABLE session_sets ADD COLUMN band_label TEXT;'
  );
  ensureColumn(
    db,
    'routine_exercises',
    'target_reps_range',
    'ALTER TABLE routine_exercises ADD COLUMN target_reps_range TEXT;'
  );
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_bands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_bands_user_name
    ON user_bands(user_id, lower(name));
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_user_bands_user_id ON user_bands(user_id);');
}

function tryRepairLegacyMigration(db, migrationId, existingChecksum, nextChecksum) {
  if (
    migrationId !== '0003_add_band_support.sql' ||
    existingChecksum !== LEGACY_0003_CHECKSUM
  ) {
    return false;
  }

  const updateChecksum = db.prepare(
    'UPDATE schema_migrations SET checksum = ?, applied_at = ? WHERE id = ?'
  );
  db.exec('BEGIN;');
  try {
    repairLegacyBandSupportMigration(db);
    updateChecksum.run(nextChecksum, new Date().toISOString(), migrationId);
    db.exec('COMMIT;');
    return true;
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

export function runMigrations(db, { migrationsDir = DEFAULT_MIGRATIONS_DIR } = {}) {
  ensureMigrationsTable(db);

  const files = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const appliedRows = db
    .prepare('SELECT id, checksum FROM schema_migrations')
    .all();
  const appliedById = new Map(appliedRows.map((row) => [row.id, row]));
  const insertMigration = db.prepare(
    'INSERT INTO schema_migrations (id, checksum, applied_at, down_sql) VALUES (?, ?, ?, ?)'
  );

  files.forEach((file) => {
    const migrationPath = path.join(migrationsDir, file);
    const content = fs.readFileSync(migrationPath, 'utf8');
    const checksum = migrationChecksum(content);
    const existing = appliedById.get(file);

    if (existing) {
      if (existing.checksum !== checksum) {
        if (tryRepairLegacyMigration(db, file, existing.checksum, checksum)) {
          return;
        }
        throw new Error(
          `Migration checksum mismatch for ${file}. Expected ${existing.checksum}, got ${checksum}.`
        );
      }
      return;
    }

    const { upSql, downSql } = parseMigration(content, file);
    const appliedAt = new Date().toISOString();

    db.exec('BEGIN;');
    try {
      db.exec(upSql);
      insertMigration.run(file, checksum, appliedAt, downSql);
      db.exec('COMMIT;');
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  });
}
