import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_MIGRATIONS_DIR = path.resolve(__dirname, 'migrations');
const UP_MARKER = '-- migrate:up';
const DOWN_MARKER = '-- migrate:down';

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
