-- migrate:up
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
  merged_into_id INTEGER,
  merged_at TEXT,
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

-- migrate:down
DROP INDEX IF EXISTS idx_sessions_store_expires;
DROP INDEX IF EXISTS idx_bodyweight_user_id;
DROP INDEX IF EXISTS idx_routines_user_id;
DROP INDEX IF EXISTS idx_session_sets_exercise_id;
DROP INDEX IF EXISTS idx_session_sets_session_id;
DROP INDEX IF EXISTS idx_sessions_user_id;
DROP TABLE IF EXISTS sessions_store;
DROP TABLE IF EXISTS bodyweight_entries;
DROP TABLE IF EXISTS session_sets;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS routine_exercises;
DROP TABLE IF EXISTS routines;
DROP TABLE IF EXISTS exercises;
DROP TABLE IF EXISTS users;

