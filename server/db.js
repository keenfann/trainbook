import { createRequire } from 'node:module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath =
  process.env.DB_PATH || path.resolve(__dirname, '..', 'db', 'trainbook.sqlite');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    muscle_group TEXT,
    notes TEXT,
    archived_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(name)
  );

  CREATE TABLE IF NOT EXISTS routines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS routine_exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    routine_id INTEGER NOT NULL,
    exercise_id INTEGER NOT NULL,
    equipment TEXT,
    position INTEGER NOT NULL,
    target_sets INTEGER,
    target_reps INTEGER,
    target_weight REAL,
    notes TEXT,
    FOREIGN KEY (routine_id) REFERENCES routines(id) ON DELETE CASCADE,
    FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    routine_id INTEGER,
    name TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    notes TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (routine_id) REFERENCES routines(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS session_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    exercise_id INTEGER NOT NULL,
    set_index INTEGER NOT NULL,
    reps INTEGER NOT NULL,
    weight REAL NOT NULL,
    rpe REAL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS bodyweight_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    weight REAL NOT NULL,
    measured_at TEXT NOT NULL,
    notes TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS sessions_store (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expires INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_session_sets_session_id ON session_sets(session_id);
  CREATE INDEX IF NOT EXISTS idx_session_sets_exercise_id ON session_sets(exercise_id);
  CREATE INDEX IF NOT EXISTS idx_routines_user_id ON routines(user_id);
  CREATE INDEX IF NOT EXISTS idx_bodyweight_user_id ON bodyweight_entries(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_store_expires ON sessions_store(expires);
`);

function getTableColumns(tableName) {
  try {
    return db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all()
      .map((column) => column.name);
  } catch (error) {
    return [];
  }
}

function ensureRoutineExerciseEquipment() {
  const columns = getTableColumns('routine_exercises');
  if (!columns.length) return;
  if (!columns.includes('equipment')) {
    db.exec('ALTER TABLE routine_exercises ADD COLUMN equipment TEXT;');
  }
  const exerciseColumns = getTableColumns('exercises');
  if (exerciseColumns.includes('equipment')) {
    db.prepare(
      `UPDATE routine_exercises
       SET equipment = (
         SELECT equipment FROM exercises WHERE exercises.id = routine_exercises.exercise_id
       )
       WHERE equipment IS NULL`
    ).run();
  }
}

function migrateExercisesSchema() {
  const columns = getTableColumns('exercises');
  if (!columns.length) return;
  if (!columns.includes('equipment') && !columns.includes('user_id')) return;

  const selectColumns = [
    'id',
    'name',
    'muscle_group',
    'notes',
    'archived_at',
    'created_at',
    'updated_at',
  ];
  if (columns.includes('equipment')) {
    selectColumns.splice(3, 0, 'equipment');
  }

  const rows = db
    .prepare(
      `SELECT ${selectColumns.join(', ')}
       FROM exercises
       ORDER BY id ASC`
    )
    .all();

  const groups = new Map();
  rows.forEach((row) => {
    if (!groups.has(row.name)) {
      groups.set(row.name, []);
    }
    groups.get(row.name).push(row);
  });

  const canonicalRows = [];
  const duplicates = [];
  groups.forEach((items) => {
    const sorted = [...items].sort((a, b) => {
      if (!!a.archived_at === !!b.archived_at) {
        return a.id - b.id;
      }
      return a.archived_at ? 1 : -1;
    });
    const canonical = sorted[0];
    canonicalRows.push(canonical);
    sorted.slice(1).forEach((row) => {
      duplicates.push({ id: row.id, canonicalId: canonical.id });
    });
  });

  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN;');
  db.exec(`
    CREATE TABLE exercises_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      muscle_group TEXT,
      notes TEXT,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(name)
    );
  `);

  const insert = db.prepare(
    `INSERT INTO exercises_new
    (id, name, muscle_group, notes, archived_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  canonicalRows.forEach((row) => {
    insert.run(
      row.id,
      row.name,
      row.muscle_group,
      row.notes,
      row.archived_at,
      row.created_at,
      row.updated_at
    );
  });

  const updateRoutine = db.prepare(
    'UPDATE routine_exercises SET exercise_id = ? WHERE exercise_id = ?'
  );
  const updateSets = db.prepare(
    'UPDATE session_sets SET exercise_id = ? WHERE exercise_id = ?'
  );
  duplicates.forEach((entry) => {
    updateRoutine.run(entry.canonicalId, entry.id);
    updateSets.run(entry.canonicalId, entry.id);
  });

  db.exec('DROP TABLE exercises;');
  db.exec('ALTER TABLE exercises_new RENAME TO exercises;');
  db.exec('COMMIT;');
  db.exec('PRAGMA foreign_keys = ON;');
}

ensureRoutineExerciseEquipment();
migrateExercisesSchema();

export default db;
