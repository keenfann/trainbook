import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import express from 'express';
import session from 'express-session';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import SqliteSessionStore from './session-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 4286;
const sessionSecret = resolveSessionSecret();
const isDevEnv = process.env.NODE_ENV !== 'production';
const devSeedPath = isDevEnv ? process.env.DEV_SEED_PATH : null;
const devAutologinEnabled = isDevEnv && process.env.DEV_AUTOLOGIN === 'true';
const devUserName = process.env.DEV_USER || 'coach';
const devPassword = process.env.DEV_PASSWORD || 'dev';
const CSRF_HEADER = 'x-csrf-token';
const CSRF_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SEED_EXERCISES_PATH = path.resolve(__dirname, 'seed-exercises.json');
const DEFAULT_EXERCISES = loadSeedExercises();
const WINDOW_PATTERNS = {
  short: ['30d', '90d'],
  medium: ['90d', '180d', '365d'],
  long: ['30d', '90d', '180d'],
};

app.use(express.json({ limit: '10mb' }));
app.use(
  session({
    secret: sessionSecret,
    store: new SqliteSessionStore(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
    },
  })
);

app.use((req, res, next) => {
  if (!CSRF_METHODS.has(req.method)) {
    return next();
  }
  const sessionToken = req.session?.csrfToken;
  const headerToken = req.get(CSRF_HEADER);
  if (!sessionToken || !headerToken || sessionToken !== headerToken) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  return next();
});

app.use((req, res, next) => {
  if (!devAutologinEnabled) {
    return next();
  }
  const forwardedFor = req.get('x-forwarded-for');
  const isLocal =
    req.ip === '127.0.0.1' ||
    req.ip === '::1' ||
    req.ip === '::ffff:127.0.0.1' ||
    (!forwardedFor && req.hostname === 'localhost');
  if (!isLocal) {
    return next();
  }
  if (!req.session?.userId) {
    const userId = getOrCreateDevUser();
    req.session.userId = userId;
  }
  return next();
});

function resolveDbPath() {
  return (
    process.env.DB_PATH || path.resolve(__dirname, '..', 'db', 'trainbook.sqlite')
  );
}

function loadSeedExercises() {
  try {
    const raw = fs.readFileSync(SEED_EXERCISES_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) {
      throw new Error('Seed list is not an array.');
    }
    return data
      .filter((item) => item && typeof item.name === 'string')
      .map((item) => ({
        name: item.name,
        muscleGroup: typeof item.muscleGroup === 'string' ? item.muscleGroup : null,
        notes: null,
      }));
  } catch (error) {
    console.warn('Failed to load seed exercises.', error);
    return [];
  }
}

function resolveSessionSecret() {
  if (process.env.SESSION_SECRET) {
    return process.env.SESSION_SECRET;
  }

  const dbPath = resolveDbPath();
  const secretPath = path.join(path.dirname(dbPath), '.trainbook-session-secret');

  try {
    const existing = fs.readFileSync(secretPath, 'utf8').trim();
    if (existing) return existing;
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('Failed to read session secret, regenerating.', error);
    }
  }

  const secret = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(path.dirname(secretPath), { recursive: true });
    fs.writeFileSync(secretPath, `${secret}\n`, { mode: 0o600 });
  } catch (error) {
    console.warn('Failed to persist session secret, using in-memory value.', error);
  }
  return secret;
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/csrf', (req, res) => {
  res.json({ csrfToken: getCsrfToken(req) });
});

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }
  return next();
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function getExerciseImpactSummary(exerciseId) {
  const routineReferences = Number(
    db
      .prepare('SELECT COUNT(*) AS count FROM routine_exercises WHERE exercise_id = ?')
      .get(exerciseId)?.count || 0
  );
  const routineUsers = Number(
    db
      .prepare(
        `SELECT COUNT(DISTINCT r.user_id) AS count
         FROM routine_exercises re
         JOIN routines r ON r.id = re.routine_id
         WHERE re.exercise_id = ?`
      )
      .get(exerciseId)?.count || 0
  );
  const setReferences = Number(
    db
      .prepare('SELECT COUNT(*) AS count FROM session_sets WHERE exercise_id = ?')
      .get(exerciseId)?.count || 0
  );
  const setUsers = Number(
    db
      .prepare(
        `SELECT COUNT(DISTINCT s.user_id) AS count
         FROM session_sets ss
         JOIN sessions s ON s.id = ss.session_id
         WHERE ss.exercise_id = ?`
      )
      .get(exerciseId)?.count || 0
  );
  return { routineReferences, routineUsers, setReferences, setUsers };
}

function parseWindowDays(rawValue, allowed) {
  const normalized = normalizeText(rawValue).toLowerCase();
  const selected = allowed.includes(normalized) ? normalized : allowed[0];
  return Number(selected.replace('d', ''));
}

function getCsrfToken(req) {
  if (!req.session?.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(16).toString('hex');
  }
  return req.session.csrfToken;
}

function getOrCreateDevUser() {
  const existing = db
    .prepare('SELECT id FROM users WHERE username = ?')
    .get(devUserName);
  if (existing?.id) {
    return existing.id;
  }
  const createdAt = nowIso();
  const passwordHash = bcrypt.hashSync(devPassword, 10);
  const result = db
    .prepare(
      'INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)'
    )
    .run(devUserName, passwordHash, createdAt);
  return Number(result.lastInsertRowid);
}

async function maybeSeedDevData() {
  if (!devSeedPath) return;
  try {
    const data = fs.readFileSync(devSeedPath, 'utf8');
    const payload = JSON.parse(data);
    const userId = getOrCreateDevUser();
    await importPayload(userId, payload);
  } catch (error) {
    console.warn('Failed to seed dev data.', error);
  }
}

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) {
    return res.json({ user: null });
  }
  const user = db
    .prepare('SELECT id, username, created_at FROM users WHERE id = ?')
    .get(req.session.userId);
  return res.json({ user: user || null });
});

app.post('/api/auth/register', async (req, res) => {
  const username = normalizeText(req.body?.username);
  const password = normalizeText(req.body?.password);

  if (username.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  const existing = db
    .prepare('SELECT id FROM users WHERE username = ?')
    .get(username);
  if (existing) {
    return res.status(409).json({ error: 'Username already exists.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const createdAt = nowIso();
  const result = db
    .prepare(
      'INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)'
    )
    .run(username, passwordHash, createdAt);
  const userId = Number(result.lastInsertRowid);
  req.session.userId = userId;
  getCsrfToken(req);
  return res.json({
    user: { id: userId, username, created_at: createdAt },
  });
});

app.post('/api/auth/login', async (req, res) => {
  const username = normalizeText(req.body?.username);
  const password = normalizeText(req.body?.password);

  const user = db
    .prepare('SELECT id, username, password_hash, created_at FROM users WHERE username = ?')
    .get(username);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  req.session.userId = user.id;
  getCsrfToken(req);
  return res.json({ user: { id: user.id, username: user.username, created_at: user.created_at } });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.post('/api/auth/password', requireAuth, async (req, res) => {
  const currentPassword = normalizeText(req.body?.currentPassword);
  const nextPassword = normalizeText(req.body?.nextPassword);

  if (nextPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  const user = db
    .prepare('SELECT id, password_hash FROM users WHERE id = ?')
    .get(req.session.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  const passwordHash = await bcrypt.hash(nextPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
    passwordHash,
    req.session.userId
  );
  return res.json({ ok: true });
});

app.get('/api/exercises', requireAuth, (req, res) => {
  const rawMode = normalizeText(req.query.mode);
  const includeArchived = req.query.includeArchived === 'true';
  const mode = rawMode || (includeArchived ? 'all' : 'active');
  const whereClause =
    mode === 'archived'
      ? 'e.archived_at IS NOT NULL'
      : mode === 'all'
        ? '1=1'
        : 'e.archived_at IS NULL';
  const rows = db
    .prepare(
      `SELECT e.id, e.name, e.muscle_group, e.notes, e.merged_into_id, e.merged_at, e.archived_at, e.created_at, e.updated_at,
              m.name AS merged_into_name
       FROM exercises e
       LEFT JOIN exercises m ON m.id = e.merged_into_id
       WHERE ${whereClause}
       ORDER BY e.name ASC`
    )
    .all();

  const setRows = db
    .prepare(
      `SELECT ss.exercise_id, ss.weight, ss.reps, s.started_at, ss.created_at
       FROM session_sets ss
       JOIN sessions s ON s.id = ss.session_id
       WHERE s.user_id = ?
       ORDER BY s.started_at DESC, ss.created_at DESC`
    )
    .all(req.session.userId);

  const lastSetByExercise = new Map();
  setRows.forEach((row) => {
    if (!lastSetByExercise.has(row.exercise_id)) {
      lastSetByExercise.set(row.exercise_id, {
        weight: row.weight,
        reps: row.reps,
        loggedAt: row.created_at,
      });
    }
  });

  const exercises = rows.map((row) => ({
    id: row.id,
    name: row.name,
    muscleGroup: row.muscle_group,
    notes: row.notes,
    mergedIntoId: row.merged_into_id,
    mergedIntoName: row.merged_into_name,
    mergedAt: row.merged_at,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSet: lastSetByExercise.get(row.id) || null,
  }));

  return res.json({ exercises });
});

app.get('/api/exercises/:id/impact', requireAuth, (req, res) => {
  const exerciseId = Number(req.params.id);
  if (!exerciseId) {
    return res.status(400).json({ error: 'Invalid exercise id.' });
  }
  const exercise = db
    .prepare(
      `SELECT id, name, merged_into_id, merged_at, archived_at, created_at, updated_at
       FROM exercises
       WHERE id = ?`
    )
    .get(exerciseId);
  if (!exercise) {
    return res.status(404).json({ error: 'Exercise not found.' });
  }

  return res.json({
    exercise: {
      id: exercise.id,
      name: exercise.name,
      mergedIntoId: exercise.merged_into_id,
      mergedAt: exercise.merged_at,
      archivedAt: exercise.archived_at,
      createdAt: exercise.created_at,
      updatedAt: exercise.updated_at,
    },
    impact: getExerciseImpactSummary(exerciseId),
  });
});

app.post('/api/exercises', requireAuth, (req, res) => {
  const name = normalizeText(req.body?.name);
  if (!name) {
    return res.status(400).json({ error: 'Exercise name is required.' });
  }
  const muscleGroup = normalizeText(req.body?.muscleGroup) || null;
  if (!muscleGroup) {
    return res.status(400).json({ error: 'Muscle group is required.' });
  }
  const notes = normalizeText(req.body?.notes) || null;
  const now = nowIso();

  try {
    const result = db
      .prepare(
        `INSERT INTO exercises
         (name, muscle_group, notes, merged_into_id, merged_at, archived_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(name, muscleGroup, notes, null, null, null, now, now);
    const id = Number(result.lastInsertRowid);
    return res.json({
      exercise: {
        id,
        name,
        muscleGroup,
        notes,
        mergedIntoId: null,
        mergedAt: null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
        lastSet: null,
      },
    });
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) {
      return res.status(409).json({ error: 'Exercise already exists.' });
    }
    return res.status(500).json({ error: 'Failed to save exercise.' });
  }
});

app.put('/api/exercises/:id', requireAuth, (req, res) => {
  const exerciseId = Number(req.params.id);
  if (!exerciseId) {
    return res.status(400).json({ error: 'Invalid exercise id.' });
  }
  const name = normalizeText(req.body?.name);
  if (!name) {
    return res.status(400).json({ error: 'Exercise name is required.' });
  }
  const muscleGroup = normalizeText(req.body?.muscleGroup) || null;
  if (!muscleGroup) {
    return res.status(400).json({ error: 'Muscle group is required.' });
  }
  const notes = normalizeText(req.body?.notes) || null;
  const now = nowIso();
  try {
    const result = db
      .prepare(
        `UPDATE exercises
         SET name = ?, muscle_group = ?, notes = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(name, muscleGroup, notes, now, exerciseId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Exercise not found.' });
    }
    return res.json({ ok: true });
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) {
      return res.status(409).json({ error: 'Exercise already exists.' });
    }
    return res.status(500).json({ error: 'Failed to update exercise.' });
  }
});

app.delete('/api/exercises/:id', requireAuth, (req, res) => {
  const exerciseId = Number(req.params.id);
  if (!exerciseId) {
    return res.status(400).json({ error: 'Invalid exercise id.' });
  }
  const exercise = db
    .prepare('SELECT id, archived_at FROM exercises WHERE id = ?')
    .get(exerciseId);
  if (!exercise) {
    return res.status(404).json({ error: 'Exercise not found.' });
  }
  if (exercise.archived_at) {
    return res.status(409).json({ error: 'Exercise is already archived.' });
  }

  const impact = getExerciseImpactSummary(exerciseId);
  const archivedAt = nowIso();

  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = db
      .prepare(
        `UPDATE exercises
         SET archived_at = ?, updated_at = ?
         WHERE id = ? AND archived_at IS NULL`
      )
      .run(archivedAt, archivedAt, exerciseId);
    if (result.changes === 0) {
      db.exec('ROLLBACK;');
      return res.status(409).json({ error: 'Exercise was archived by another request.' });
    }
    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    return res.status(500).json({ error: 'Failed to archive exercise.' });
  }

  return res.json({ ok: true, archivedAt, impact });
});

app.post('/api/exercises/:id/unarchive', requireAuth, (req, res) => {
  const exerciseId = Number(req.params.id);
  if (!exerciseId) {
    return res.status(400).json({ error: 'Invalid exercise id.' });
  }
  const existing = db
    .prepare('SELECT id, archived_at, merged_into_id FROM exercises WHERE id = ?')
    .get(exerciseId);
  if (!existing) {
    return res.status(404).json({ error: 'Exercise not found.' });
  }
  if (!existing.archived_at) {
    return res.status(409).json({ error: 'Exercise is already active.' });
  }
  if (existing.merged_into_id) {
    return res.status(409).json({ error: 'Merged exercises cannot be unarchived.' });
  }

  const now = nowIso();
  const updated = db
    .prepare(
      `UPDATE exercises
       SET archived_at = NULL, updated_at = ?
       WHERE id = ? AND archived_at IS NOT NULL`
    )
    .run(now, exerciseId);
  if (updated.changes === 0) {
    return res.status(409).json({ error: 'Exercise changed before unarchive could complete.' });
  }
  return res.json({ ok: true, updatedAt: now });
});

app.post('/api/exercises/merge', requireAuth, (req, res) => {
  const sourceId = Number(req.body?.sourceId);
  const targetId = Number(req.body?.targetId);
  if (!sourceId || !targetId || sourceId === targetId) {
    return res.status(400).json({ error: 'Provide distinct sourceId and targetId.' });
  }

  const source = db
    .prepare('SELECT id, archived_at, merged_into_id FROM exercises WHERE id = ?')
    .get(sourceId);
  const target = db
    .prepare('SELECT id, archived_at, merged_into_id FROM exercises WHERE id = ?')
    .get(targetId);
  if (!source || !target) {
    return res.status(404).json({ error: 'Exercise not found.' });
  }
  if (source.archived_at || target.archived_at) {
    return res.status(400).json({ error: 'Cannot merge archived exercises.' });
  }
  if (source.merged_into_id) {
    return res.status(409).json({ error: 'Source exercise has already been merged.' });
  }
  if (target.merged_into_id) {
    return res.status(400).json({ error: 'Cannot merge into an exercise that is itself merged.' });
  }

  const impact = getExerciseImpactSummary(sourceId);
  const now = nowIso();
  let movedRoutineLinks = 0;
  let movedSetLinks = 0;
  db.exec('BEGIN IMMEDIATE;');
  try {
    movedRoutineLinks = db
      .prepare('UPDATE routine_exercises SET exercise_id = ? WHERE exercise_id = ?')
      .run(targetId, sourceId).changes;
    movedSetLinks = db
      .prepare('UPDATE session_sets SET exercise_id = ? WHERE exercise_id = ?')
      .run(targetId, sourceId).changes;
    const archived = db
      .prepare(
        `UPDATE exercises
         SET merged_into_id = ?, merged_at = ?, archived_at = ?, updated_at = ?
         WHERE id = ? AND archived_at IS NULL AND merged_into_id IS NULL`
      )
      .run(targetId, now, now, now, sourceId);
    if (archived.changes === 0) {
      db.exec('ROLLBACK;');
      return res.status(409).json({ error: 'Source exercise changed before merge could complete.' });
    }
    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    return res.status(500).json({ error: 'Failed to merge exercises.' });
  }

  return res.json({
    ok: true,
    sourceId,
    targetId,
    mergedAt: now,
    movedRoutineLinks,
    movedSetLinks,
    impact,
  });
});

function listRoutines(userId) {
  const routines = db
    .prepare(
      `SELECT id, name, notes, created_at, updated_at
       FROM routines
       WHERE user_id = ?
       ORDER BY updated_at DESC`
    )
    .all(userId);

  if (!routines.length) {
    return [];
  }

  const routineIds = routines.map((routine) => routine.id);
  const placeholders = routineIds.map(() => '?').join(',');
  const exerciseRows = db
    .prepare(
      `SELECT re.id, re.routine_id, re.exercise_id, re.position,
              re.target_sets, re.target_reps, re.target_weight, re.notes, re.equipment,
              e.name AS exercise_name, e.muscle_group
       FROM routine_exercises re
       JOIN exercises e ON e.id = re.exercise_id
       WHERE re.routine_id IN (${placeholders})
       ORDER BY re.position ASC`
    )
    .all(...routineIds);

  const exercisesByRoutine = new Map();
  exerciseRows.forEach((row) => {
    if (!exercisesByRoutine.has(row.routine_id)) {
      exercisesByRoutine.set(row.routine_id, []);
    }
    exercisesByRoutine.get(row.routine_id).push({
      id: row.id,
      exerciseId: row.exercise_id,
      name: row.exercise_name,
      muscleGroup: row.muscle_group,
      equipment: row.equipment,
      position: row.position,
      targetSets: row.target_sets,
      targetReps: row.target_reps,
      targetWeight: row.target_weight,
      notes: row.notes,
    });
  });

  return routines.map((routine) => ({
    id: routine.id,
    name: routine.name,
    notes: routine.notes,
    createdAt: routine.created_at,
    updatedAt: routine.updated_at,
    exercises: exercisesByRoutine.get(routine.id) || [],
  }));
}

app.get('/api/routines', requireAuth, (req, res) => {
  const routines = listRoutines(req.session.userId);
  res.json({ routines });
});

app.get('/api/routines/:id', requireAuth, (req, res) => {
  const routineId = Number(req.params.id);
  if (!routineId) {
    return res.status(400).json({ error: 'Invalid routine id.' });
  }
  const routines = listRoutines(req.session.userId).filter(
    (routine) => routine.id === routineId
  );
  if (!routines.length) {
    return res.status(404).json({ error: 'Routine not found.' });
  }
  return res.json({ routine: routines[0] });
});

app.post('/api/routines', requireAuth, (req, res) => {
  const name = normalizeText(req.body?.name);
  if (!name) {
    return res.status(400).json({ error: 'Routine name is required.' });
  }
  const notes = normalizeText(req.body?.notes) || null;
  const exercises = Array.isArray(req.body?.exercises) ? req.body.exercises : [];
  const now = nowIso();
  const missingEquipment = exercises.some(
    (item) => item.exerciseId && !normalizeText(item.equipment)
  );
  if (missingEquipment) {
    return res.status(400).json({ error: 'Equipment is required for each routine exercise.' });
  }

  const result = db
    .prepare(
      `INSERT INTO routines (user_id, name, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(req.session.userId, name, notes, now, now);
  const routineId = Number(result.lastInsertRowid);

  const insertExercise = db.prepare(
    `INSERT INTO routine_exercises
     (routine_id, exercise_id, equipment, position, target_sets, target_reps, target_weight, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  exercises.forEach((item, index) => {
    const exerciseId = Number(item.exerciseId);
    if (!exerciseId) return;
    const equipment = normalizeText(item.equipment) || null;
    insertExercise.run(
      routineId,
      exerciseId,
      equipment,
      Number.isFinite(item.position) ? Number(item.position) : index,
      normalizeNumber(item.targetSets),
      normalizeNumber(item.targetReps),
      normalizeNumber(item.targetWeight),
      normalizeText(item.notes) || null
    );
  });

  const routines = listRoutines(req.session.userId).filter(
    (routine) => routine.id === routineId
  );
  return res.json({ routine: routines[0] });
});

app.put('/api/routines/:id', requireAuth, (req, res) => {
  const routineId = Number(req.params.id);
  if (!routineId) {
    return res.status(400).json({ error: 'Invalid routine id.' });
  }
  const name = normalizeText(req.body?.name);
  if (!name) {
    return res.status(400).json({ error: 'Routine name is required.' });
  }
  const notes = normalizeText(req.body?.notes) || null;
  const exercises = Array.isArray(req.body?.exercises) ? req.body.exercises : [];
  const now = nowIso();
  const missingEquipment = exercises.some(
    (item) => item.exerciseId && !normalizeText(item.equipment)
  );
  if (missingEquipment) {
    return res.status(400).json({ error: 'Equipment is required for each routine exercise.' });
  }

  const result = db
    .prepare(
      `UPDATE routines
       SET name = ?, notes = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`
    )
    .run(name, notes, now, routineId, req.session.userId);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Routine not found.' });
  }

  db.prepare('DELETE FROM routine_exercises WHERE routine_id = ?').run(routineId);
  const insertExercise = db.prepare(
    `INSERT INTO routine_exercises
     (routine_id, exercise_id, equipment, position, target_sets, target_reps, target_weight, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  exercises.forEach((item, index) => {
    const exerciseId = Number(item.exerciseId);
    if (!exerciseId) return;
    const equipment = normalizeText(item.equipment) || null;
    insertExercise.run(
      routineId,
      exerciseId,
      equipment,
      Number.isFinite(item.position) ? Number(item.position) : index,
      normalizeNumber(item.targetSets),
      normalizeNumber(item.targetReps),
      normalizeNumber(item.targetWeight),
      normalizeText(item.notes) || null
    );
  });

  const routines = listRoutines(req.session.userId).filter(
    (routine) => routine.id === routineId
  );
  return res.json({ routine: routines[0] });
});

app.post('/api/routines/:id/duplicate', requireAuth, (req, res) => {
  const routineId = Number(req.params.id);
  if (!routineId) {
    return res.status(400).json({ error: 'Invalid routine id.' });
  }

  const sourceRoutine = db
    .prepare('SELECT id, name, notes FROM routines WHERE id = ? AND user_id = ?')
    .get(routineId, req.session.userId);
  if (!sourceRoutine) {
    return res.status(404).json({ error: 'Routine not found.' });
  }

  const sourceExercises = db
    .prepare(
      `SELECT exercise_id, equipment, target_sets, target_reps, target_weight, notes, position
       FROM routine_exercises
       WHERE routine_id = ?
       ORDER BY position ASC`
    )
    .all(routineId);

  const now = nowIso();
  const duplicateName = `${sourceRoutine.name} (Copy)`;
  const created = db
    .prepare(
      `INSERT INTO routines (user_id, name, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(req.session.userId, duplicateName, sourceRoutine.notes || null, now, now);
  const duplicateId = Number(created.lastInsertRowid);

  const insertExercise = db.prepare(
    `INSERT INTO routine_exercises
     (routine_id, exercise_id, equipment, position, target_sets, target_reps, target_weight, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  sourceExercises.forEach((item, index) => {
    insertExercise.run(
      duplicateId,
      item.exercise_id,
      item.equipment || null,
      Number.isFinite(item.position) ? Number(item.position) : index,
      item.target_sets,
      item.target_reps,
      item.target_weight,
      item.notes || null
    );
  });

  const routines = listRoutines(req.session.userId).filter(
    (routine) => routine.id === duplicateId
  );
  return res.json({ routine: routines[0] });
});

app.put('/api/routines/:id/reorder', requireAuth, (req, res) => {
  const routineId = Number(req.params.id);
  if (!routineId) {
    return res.status(400).json({ error: 'Invalid routine id.' });
  }
  const exerciseOrder = Array.isArray(req.body?.exerciseOrder) ? req.body.exerciseOrder : [];
  const orderedIds = exerciseOrder
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!orderedIds.length) {
    return res.status(400).json({ error: 'exerciseOrder is required.' });
  }

  const routine = db
    .prepare('SELECT id FROM routines WHERE id = ? AND user_id = ?')
    .get(routineId, req.session.userId);
  if (!routine) {
    return res.status(404).json({ error: 'Routine not found.' });
  }

  const currentRows = db
    .prepare('SELECT id FROM routine_exercises WHERE routine_id = ? ORDER BY position ASC')
    .all(routineId);
  const currentIds = currentRows.map((row) => Number(row.id));
  if (currentIds.length !== orderedIds.length) {
    return res.status(400).json({ error: 'exerciseOrder does not match routine exercise count.' });
  }
  const expectedSet = new Set(currentIds);
  const providedSet = new Set(orderedIds);
  if (
    expectedSet.size !== providedSet.size ||
    currentIds.some((id) => !providedSet.has(id))
  ) {
    return res.status(400).json({ error: 'exerciseOrder contains invalid routine exercise ids.' });
  }

  db.exec('BEGIN IMMEDIATE;');
  try {
    const updatePosition = db.prepare(
      'UPDATE routine_exercises SET position = ? WHERE id = ? AND routine_id = ?'
    );
    orderedIds.forEach((exerciseRowId, index) => {
      updatePosition.run(index, exerciseRowId, routineId);
    });
    db.prepare('UPDATE routines SET updated_at = ? WHERE id = ?').run(nowIso(), routineId);
    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    return res.status(500).json({ error: 'Failed to reorder routine exercises.' });
  }

  const routines = listRoutines(req.session.userId).filter(
    (item) => item.id === routineId
  );
  return res.json({ routine: routines[0] });
});

app.delete('/api/routines/:id', requireAuth, (req, res) => {
  const routineId = Number(req.params.id);
  if (!routineId) {
    return res.status(400).json({ error: 'Invalid routine id.' });
  }
  const result = db
    .prepare('DELETE FROM routines WHERE id = ? AND user_id = ?')
    .run(routineId, req.session.userId);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Routine not found.' });
  }
  return res.json({ ok: true });
});

function getSessionById(sessionId, userId) {
  return db
    .prepare(
      `SELECT s.id, s.routine_id, s.name, s.started_at, s.ended_at, s.notes,
              r.name AS routine_name
       FROM sessions s
       LEFT JOIN routines r ON r.id = s.routine_id
       WHERE s.id = ? AND s.user_id = ?`
    )
    .get(sessionId, userId);
}

function getSessionDetail(sessionId, userId) {
  const session = getSessionById(sessionId, userId);
  if (!session) return null;

  const setRows = db
    .prepare(
      `SELECT ss.id, ss.exercise_id, ss.set_index, ss.reps, ss.weight, ss.rpe, ss.created_at,
              e.name AS exercise_name
       FROM session_sets ss
       JOIN exercises e ON e.id = ss.exercise_id
       WHERE ss.session_id = ?
       ORDER BY e.name ASC, ss.set_index ASC`
    )
    .all(sessionId);

  const setsByExercise = new Map();
  setRows.forEach((row) => {
    if (!setsByExercise.has(row.exercise_id)) {
      setsByExercise.set(row.exercise_id, { exerciseId: row.exercise_id, name: row.exercise_name, sets: [] });
    }
    setsByExercise.get(row.exercise_id).sets.push({
      id: row.id,
      setIndex: row.set_index,
      reps: row.reps,
      weight: row.weight,
      rpe: row.rpe,
      createdAt: row.created_at,
    });
  });

  return {
    id: session.id,
    routineId: session.routine_id,
    routineName: session.routine_name,
    name: session.name,
    startedAt: session.started_at,
    endedAt: session.ended_at,
    notes: session.notes,
    exercises: Array.from(setsByExercise.values()),
  };
}

app.get('/api/sessions', requireAuth, (req, res) => {
  const limit = Number(req.query.limit) || 20;
  const rows = db
    .prepare(
      `SELECT s.id, s.routine_id, s.name, s.started_at, s.ended_at, s.notes,
              r.name AS routine_name,
              COUNT(ss.id) AS total_sets,
              COALESCE(SUM(ss.reps), 0) AS total_reps,
              COALESCE(SUM(ss.reps * ss.weight), 0) AS total_volume
       FROM sessions s
       LEFT JOIN routines r ON r.id = s.routine_id
       LEFT JOIN session_sets ss ON ss.session_id = s.id
       WHERE s.user_id = ?
       GROUP BY s.id
       ORDER BY s.started_at DESC
       LIMIT ?`
    )
    .all(req.session.userId, limit);

  const sessions = rows.map((row) => ({
    id: row.id,
    routineId: row.routine_id,
    routineName: row.routine_name,
    name: row.name,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    notes: row.notes,
    totalSets: row.total_sets,
    totalReps: row.total_reps,
    totalVolume: row.total_volume,
  }));

  return res.json({ sessions });
});

app.get('/api/sessions/active', requireAuth, (req, res) => {
  const session = db
    .prepare(
      `SELECT id FROM sessions
       WHERE user_id = ? AND ended_at IS NULL
       ORDER BY started_at DESC
       LIMIT 1`
    )
    .get(req.session.userId);
  if (!session) {
    return res.json({ session: null });
  }
  const detail = getSessionDetail(session.id, req.session.userId);
  return res.json({ session: detail });
});

app.get('/api/sessions/:id', requireAuth, (req, res) => {
  const sessionId = Number(req.params.id);
  if (!sessionId) {
    return res.status(400).json({ error: 'Invalid session id.' });
  }
  const detail = getSessionDetail(sessionId, req.session.userId);
  if (!detail) {
    return res.status(404).json({ error: 'Session not found.' });
  }
  return res.json({ session: detail });
});

app.post('/api/sessions', requireAuth, (req, res) => {
  const routineId = normalizeNumber(req.body?.routineId);
  const name = normalizeText(req.body?.name) || null;
  const startedAt = normalizeText(req.body?.startedAt) || nowIso();
  const result = db
    .prepare(
      `INSERT INTO sessions (user_id, routine_id, name, started_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(req.session.userId, routineId, name, startedAt);

  const sessionId = Number(result.lastInsertRowid);
  const detail = getSessionDetail(sessionId, req.session.userId);
  return res.json({ session: detail });
});

app.put('/api/sessions/:id', requireAuth, (req, res) => {
  const sessionId = Number(req.params.id);
  if (!sessionId) {
    return res.status(400).json({ error: 'Invalid session id.' });
  }
  const body = req.body || {};
  const hasName = Object.prototype.hasOwnProperty.call(body, 'name');
  const hasNotes = Object.prototype.hasOwnProperty.call(body, 'notes');
  const hasEndedAt = Object.prototype.hasOwnProperty.call(body, 'endedAt');

  if (!hasName && !hasNotes && !hasEndedAt) {
    return res.status(400).json({ error: 'No session fields provided.' });
  }

  const name = hasName ? normalizeText(body.name) || null : null;
  const notes = hasNotes ? normalizeText(body.notes) || null : null;
  const endedAt = hasEndedAt ? normalizeText(body.endedAt) || null : null;

  const result = db
    .prepare(
      `UPDATE sessions
       SET name = CASE WHEN ? THEN ? ELSE name END,
           notes = CASE WHEN ? THEN ? ELSE notes END,
           ended_at = CASE WHEN ? THEN ? ELSE ended_at END
       WHERE id = ? AND user_id = ?`
    )
    .run(
      hasName ? 1 : 0,
      name,
      hasNotes ? 1 : 0,
      notes,
      hasEndedAt ? 1 : 0,
      endedAt,
      sessionId,
      req.session.userId
    );

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Session not found.' });
  }
  const detail = getSessionDetail(sessionId, req.session.userId);
  return res.json({ session: detail });
});

app.delete('/api/sessions/:id', requireAuth, (req, res) => {
  const sessionId = Number(req.params.id);
  if (!sessionId) {
    return res.status(400).json({ error: 'Invalid session id.' });
  }
  const result = db
    .prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?')
    .run(sessionId, req.session.userId);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Session not found.' });
  }
  return res.json({ ok: true });
});

app.post('/api/sessions/:id/sets', requireAuth, (req, res) => {
  const sessionId = Number(req.params.id);
  if (!sessionId) {
    return res.status(400).json({ error: 'Invalid session id.' });
  }
  const exerciseId = normalizeNumber(req.body?.exerciseId);
  const reps = normalizeNumber(req.body?.reps);
  const weight = normalizeNumber(req.body?.weight);
  const rpe = normalizeNumber(req.body?.rpe);
  if (!exerciseId || !reps || weight === null) {
    return res.status(400).json({ error: 'Exercise, reps, and weight are required.' });
  }

  const session = getSessionById(sessionId, req.session.userId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found.' });
  }

  const exercise = db
    .prepare('SELECT id FROM exercises WHERE id = ?')
    .get(exerciseId);
  if (!exercise) {
    return res.status(404).json({ error: 'Exercise not found.' });
  }

  const nextIndex = db
    .prepare(
      'SELECT COUNT(*) AS count FROM session_sets WHERE session_id = ? AND exercise_id = ?'
    )
    .get(sessionId, exerciseId)?.count;

  const createdAt = nowIso();
  const result = db
    .prepare(
      `INSERT INTO session_sets
       (session_id, exercise_id, set_index, reps, weight, rpe, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(sessionId, exerciseId, Number(nextIndex) + 1, reps, weight, rpe, createdAt);

  const id = Number(result.lastInsertRowid);
  return res.json({
    set: { id, sessionId, exerciseId, setIndex: Number(nextIndex) + 1, reps, weight, rpe, createdAt },
  });
});

app.put('/api/sets/:id', requireAuth, (req, res) => {
  const setId = Number(req.params.id);
  if (!setId) {
    return res.status(400).json({ error: 'Invalid set id.' });
  }
  const body = req.body || {};
  const hasReps = Object.prototype.hasOwnProperty.call(body, 'reps');
  const hasWeight = Object.prototype.hasOwnProperty.call(body, 'weight');
  const hasRpe = Object.prototype.hasOwnProperty.call(body, 'rpe');
  if (!hasReps && !hasWeight && !hasRpe) {
    return res.status(400).json({ error: 'No set fields provided.' });
  }
  const reps = hasReps ? normalizeNumber(body.reps) : null;
  const weight = hasWeight ? normalizeNumber(body.weight) : null;
  const rpe = hasRpe ? normalizeNumber(body.rpe) : null;

  const result = db
    .prepare(
      `UPDATE session_sets
       SET reps = CASE WHEN ? THEN ? ELSE reps END,
           weight = CASE WHEN ? THEN ? ELSE weight END,
           rpe = CASE WHEN ? THEN ? ELSE rpe END
       WHERE id = ? AND session_id IN (SELECT id FROM sessions WHERE user_id = ?)`
    )
    .run(
      hasReps ? 1 : 0,
      reps,
      hasWeight ? 1 : 0,
      weight,
      hasRpe ? 1 : 0,
      rpe,
      setId,
      req.session.userId
    );

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Set not found.' });
  }
  const updated = db
    .prepare(
      `SELECT ss.id, ss.session_id, ss.exercise_id, ss.set_index, ss.reps, ss.weight, ss.rpe, ss.created_at
       FROM session_sets ss
       WHERE ss.id = ?`
    )
    .get(setId);

  return res.json({
    set: {
      id: updated.id,
      sessionId: updated.session_id,
      exerciseId: updated.exercise_id,
      setIndex: updated.set_index,
      reps: updated.reps,
      weight: updated.weight,
      rpe: updated.rpe,
      createdAt: updated.created_at,
    },
  });
});

app.delete('/api/sets/:id', requireAuth, (req, res) => {
  const setId = Number(req.params.id);
  if (!setId) {
    return res.status(400).json({ error: 'Invalid set id.' });
  }
  const result = db
    .prepare(
      'DELETE FROM session_sets WHERE id = ? AND session_id IN (SELECT id FROM sessions WHERE user_id = ?)'
    )
    .run(setId, req.session.userId);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Set not found.' });
  }
  return res.json({ ok: true });
});

app.get('/api/weights', requireAuth, (req, res) => {
  const limit = Number(req.query.limit) || 30;
  const rows = db
    .prepare(
      `SELECT id, weight, measured_at, notes
       FROM bodyweight_entries
       WHERE user_id = ?
       ORDER BY measured_at DESC
       LIMIT ?`
    )
    .all(req.session.userId, limit);

  const weights = rows.map((row) => ({
    id: row.id,
    weight: row.weight,
    measuredAt: row.measured_at,
    notes: row.notes,
  }));

  return res.json({ weights });
});

app.post('/api/weights', requireAuth, (req, res) => {
  const weight = normalizeNumber(req.body?.weight);
  if (weight === null) {
    return res.status(400).json({ error: 'Weight is required.' });
  }
  const measuredAt = normalizeText(req.body?.measuredAt) || nowIso();
  const notes = normalizeText(req.body?.notes) || null;
  const result = db
    .prepare(
      `INSERT INTO bodyweight_entries (user_id, weight, measured_at, notes)
       VALUES (?, ?, ?, ?)`
    )
    .run(req.session.userId, weight, measuredAt, notes);

  return res.json({
    entry: {
      id: Number(result.lastInsertRowid),
      weight,
      measuredAt,
      notes,
    },
  });
});

app.put('/api/weights/:id', requireAuth, (req, res) => {
  const entryId = Number(req.params.id);
  if (!entryId) {
    return res.status(400).json({ error: 'Invalid entry id.' });
  }
  const weight = normalizeNumber(req.body?.weight);
  const measuredAt = normalizeText(req.body?.measuredAt) || null;
  const notes = normalizeText(req.body?.notes) || null;

  const result = db
    .prepare(
      `UPDATE bodyweight_entries
       SET weight = COALESCE(?, weight), measured_at = COALESCE(?, measured_at), notes = COALESCE(?, notes)
       WHERE id = ? AND user_id = ?`
    )
    .run(weight, measuredAt, notes, entryId, req.session.userId);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Entry not found.' });
  }
  return res.json({ ok: true });
});

app.delete('/api/weights/:id', requireAuth, (req, res) => {
  const entryId = Number(req.params.id);
  if (!entryId) {
    return res.status(400).json({ error: 'Invalid entry id.' });
  }
  const result = db
    .prepare('DELETE FROM bodyweight_entries WHERE id = ? AND user_id = ?')
    .run(entryId, req.session.userId);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Entry not found.' });
  }
  return res.json({ ok: true });
});

app.get('/api/stats/overview', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const totalSessions = db
    .prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?')
    .get(userId)?.count;
  const totalSets = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM session_sets ss
       JOIN sessions s ON s.id = ss.session_id
       WHERE s.user_id = ?`
    )
    .get(userId)?.count;
  const volumeWeek = db
    .prepare(
      `SELECT COALESCE(SUM(ss.reps * ss.weight), 0) AS volume
       FROM session_sets ss
       JOIN sessions s ON s.id = ss.session_id
       WHERE s.user_id = ? AND s.started_at >= ?`
    )
    .get(userId, weekAgo)?.volume;
  const volumeMonth = db
    .prepare(
      `SELECT COALESCE(SUM(ss.reps * ss.weight), 0) AS volume
       FROM session_sets ss
       JOIN sessions s ON s.id = ss.session_id
       WHERE s.user_id = ? AND s.started_at >= ?`
    )
    .get(userId, monthAgo)?.volume;
  const lastSession = db
    .prepare(
      `SELECT started_at FROM sessions
       WHERE user_id = ?
       ORDER BY started_at DESC
       LIMIT 1`
    )
    .get(userId)?.started_at;

  const prRows = db
    .prepare(
      `SELECT ss.exercise_id, MAX(ss.weight) AS max_weight, MAX(ss.reps) AS max_reps, e.name
       FROM session_sets ss
       JOIN sessions s ON s.id = ss.session_id
       JOIN exercises e ON e.id = ss.exercise_id
       WHERE s.user_id = ?
       GROUP BY ss.exercise_id
       ORDER BY max_weight DESC
       LIMIT 8`
    )
    .all(userId);

  const weeklyVolume = db
    .prepare(
      `SELECT strftime('%Y-W%W', s.started_at) AS week,
              SUM(ss.reps * ss.weight) AS volume
       FROM session_sets ss
       JOIN sessions s ON s.id = ss.session_id
       WHERE s.user_id = ?
       GROUP BY week
       ORDER BY week DESC
       LIMIT 12`
    )
    .all(userId)
    .map((row) => ({ week: row.week, volume: row.volume }));

  const summary = {
    totalSessions: Number(totalSessions || 0),
    totalSets: Number(totalSets || 0),
    volumeWeek: Number(volumeWeek || 0),
    volumeMonth: Number(volumeMonth || 0),
    lastSessionAt: lastSession || null,
  };

  const topExercises = prRows.map((row) => ({
    exerciseId: row.exercise_id,
    name: row.name,
    maxWeight: row.max_weight,
    maxReps: row.max_reps,
  }));

  res.json({ summary, topExercises, weeklyVolume });
});

app.get('/api/stats/progression', requireAuth, (req, res) => {
  const exerciseId = Number(req.query.exerciseId);
  if (!exerciseId) {
    return res.status(400).json({ error: 'exerciseId is required.' });
  }
  const windowDays = parseWindowDays(req.query.window, WINDOW_PATTERNS.medium);
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  const exercise = db
    .prepare('SELECT id, name FROM exercises WHERE id = ?')
    .get(exerciseId);
  if (!exercise) {
    return res.status(404).json({ error: 'Exercise not found.' });
  }

  const points = db
    .prepare(
      `SELECT s.id AS session_id, s.started_at,
              MAX(ss.weight) AS top_weight,
              MAX(ss.reps) AS top_reps,
              MAX(ss.reps * ss.weight) AS top_volume
       FROM session_sets ss
       JOIN sessions s ON s.id = ss.session_id
       WHERE s.user_id = ? AND ss.exercise_id = ? AND s.started_at >= ?
       GROUP BY s.id
       ORDER BY s.started_at ASC`
    )
    .all(req.session.userId, exerciseId, since)
    .map((row) => ({
      sessionId: row.session_id,
      startedAt: row.started_at,
      topWeight: Number(row.top_weight || 0),
      topReps: Number(row.top_reps || 0),
      topVolume: Number(row.top_volume || 0),
    }));

  return res.json({
    exercise: { id: exercise.id, name: exercise.name },
    windowDays,
    points,
  });
});

app.get('/api/stats/distribution', requireAuth, (req, res) => {
  const metric = normalizeText(req.query.metric).toLowerCase() === 'frequency' ? 'frequency' : 'volume';
  const windowDays = parseWindowDays(req.query.window, WINDOW_PATTERNS.short);
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  const rows = db
    .prepare(
      `SELECT COALESCE(e.muscle_group, 'Other') AS bucket,
              SUM(ss.reps * ss.weight) AS total_volume,
              COUNT(*) AS total_sets
       FROM session_sets ss
       JOIN sessions s ON s.id = ss.session_id
       JOIN exercises e ON e.id = ss.exercise_id
       WHERE s.user_id = ? AND s.started_at >= ?
       GROUP BY bucket
       ORDER BY ${metric === 'frequency' ? 'total_sets' : 'total_volume'} DESC`
    )
    .all(req.session.userId, since)
    .map((row) => ({
      bucket: row.bucket,
      value: metric === 'frequency' ? Number(row.total_sets || 0) : Number(row.total_volume || 0),
      setCount: Number(row.total_sets || 0),
      volume: Number(row.total_volume || 0),
    }));

  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const distribution = rows.map((row) => ({
    ...row,
    share: total > 0 ? row.value / total : 0,
  }));

  return res.json({ metric, windowDays, total, rows: distribution });
});

app.get('/api/stats/bodyweight-trend', requireAuth, (req, res) => {
  const windowDays = parseWindowDays(req.query.window, WINDOW_PATTERNS.long);
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  const points = db
    .prepare(
      `SELECT id, weight, measured_at
       FROM bodyweight_entries
       WHERE user_id = ? AND measured_at >= ?
       ORDER BY measured_at ASC`
    )
    .all(req.session.userId, since)
    .map((row) => ({
      id: row.id,
      weight: Number(row.weight || 0),
      measuredAt: row.measured_at,
    }));

  const startWeight = points.length ? points[0].weight : null;
  const latestWeight = points.length ? points[points.length - 1].weight : null;
  const delta =
    startWeight !== null && latestWeight !== null ? Number(latestWeight - startWeight) : null;

  return res.json({
    windowDays,
    points,
    summary: {
      startWeight,
      latestWeight,
      delta,
    },
  });
});

app.get('/api/export', requireAuth, (req, res) => {
  const payload = buildExport(req.session.userId);
  res.json(payload);
});

app.post('/api/import/validate', requireAuth, (req, res) => {
  const validation = validateImportPayload(req.session.userId, req.body);
  return res.json(validation);
});

app.post('/api/import', requireAuth, async (req, res) => {
  const validation = validateImportPayload(req.session.userId, req.body);
  if (!validation.valid) {
    return res.status(400).json({
      error: 'Invalid import file',
      validation,
    });
  }
  try {
    const importedCount = await importPayload(req.session.userId, req.body);
    return res.json({
      ok: true,
      importedCount,
      validationSummary: validation.summary,
      warnings: validation.warnings,
    });
  } catch (error) {
    if (error.message === 'Invalid import file') {
      return res.status(400).json({ error: error.message });
    }
    return res.status(500).json({ error: error.message });
  }
});

function validateImportPayload(userId, payload) {
  const errors = [];
  const warnings = [];
  const expectedVersion = 3;

  if (!payload || typeof payload !== 'object') {
    return {
      valid: false,
      errors: ['Payload must be a JSON object.'],
      warnings: [],
      summary: null,
    };
  }

  if (payload.version !== expectedVersion) {
    errors.push(`Unsupported import version. Expected ${expectedVersion}, got ${payload.version ?? 'unknown'}.`);
  }

  const exercises = Array.isArray(payload.exercises) ? payload.exercises : [];
  const routines = Array.isArray(payload.routines) ? payload.routines : [];
  const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  const weights = Array.isArray(payload.weights) ? payload.weights : [];

  const existingExerciseByKey = new Map(
    db
      .prepare('SELECT name FROM exercises')
      .all()
      .map((row) => [normalizeText(row.name).toLowerCase(), row.name])
  );
  const payloadExerciseNames = new Set();
  const duplicateExerciseNamesInPayload = [];
  const existingExerciseNameConflicts = [];
  let exercisesMissingName = 0;

  let exercisesToCreate = 0;
  let exercisesToReuse = 0;
  let exercisesSkipped = 0;

  exercises.forEach((exercise) => {
    const sourceName = normalizeText(exercise?.name);
    const name = sourceName.toLowerCase();
    if (!name) {
      exercisesMissingName += 1;
      exercisesSkipped += 1;
      return;
    }
    if (payloadExerciseNames.has(name)) {
      duplicateExerciseNamesInPayload.push(name);
      exercisesSkipped += 1;
      return;
    }
    payloadExerciseNames.add(name);

    const existingName = existingExerciseByKey.get(name);
    if (existingName) {
      existingExerciseNameConflicts.push(existingName);
      exercisesToReuse += 1;
    } else {
      exercisesToCreate += 1;
    }
  });

  if (exercisesMissingName) {
    warnings.push(`${exercisesMissingName} exercises with missing names will be skipped.`);
  }

  if (duplicateExerciseNamesInPayload.length) {
    warnings.push(
      `${duplicateExerciseNamesInPayload.length} duplicate exercise names in import payload will be skipped.`
    );
  }

  const routinesToCreate = routines.filter((routine) => normalizeText(routine?.name)).length;
  const routinesSkipped = routines.length - routinesToCreate;
  if (routinesSkipped) {
    warnings.push(`${routinesSkipped} routines with missing names will be skipped.`);
  }

  const sessionsToCreate = sessions.length;

  const validWeightCount = weights.filter(
    (entry) => normalizeNumber(entry?.weight) !== null
  ).length;
  const weightsSkipped = weights.length - validWeightCount;
  if (weightsSkipped) {
    warnings.push(`${weightsSkipped} bodyweight entries with invalid weight values will be skipped.`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: {
      payloadVersion: payload.version ?? null,
      expectedVersion,
      totals: {
        exercises: exercises.length,
        routines: routines.length,
        sessions: sessions.length,
        weights: weights.length,
      },
      toCreate: {
        exercises: exercisesToCreate,
        routines: routinesToCreate,
        sessions: sessionsToCreate,
        weights: validWeightCount,
      },
      toReuse: {
        exercises: exercisesToReuse,
      },
      skipped: {
        exercises: exercisesSkipped,
        routines: routinesSkipped,
        sessions: 0,
        weights: weightsSkipped,
      },
      conflicts: {
        existingExerciseNames: existingExerciseNameConflicts,
        duplicateExerciseNamesInPayload,
      },
    },
  };
}

function buildExport(userId) {
  const user = db
    .prepare('SELECT username, created_at FROM users WHERE id = ?')
    .get(userId);

  const exercises = db
    .prepare(
      `SELECT id, name, muscle_group, notes, merged_into_id, merged_at, archived_at, created_at, updated_at
       FROM exercises`
    )
    .all();

  const routines = listRoutines(userId);

  const sessions = db
    .prepare(
      `SELECT id, routine_id, name, started_at, ended_at, notes
       FROM sessions WHERE user_id = ?
       ORDER BY started_at ASC`
    )
    .all(userId);

  const sessionIds = sessions.map((session) => session.id);
  const sets = sessionIds.length
    ? db
        .prepare(
          `SELECT id, session_id, exercise_id, set_index, reps, weight, rpe, created_at
           FROM session_sets
           WHERE session_id IN (${sessionIds.map(() => '?').join(',')})`
        )
        .all(...sessionIds)
    : [];

  const weights = db
    .prepare(
      `SELECT id, weight, measured_at, notes
       FROM bodyweight_entries WHERE user_id = ?
       ORDER BY measured_at ASC`
    )
    .all(userId);

  return {
    version: 3,
    exportedAt: nowIso(),
    user: user ? { username: user.username, createdAt: user.created_at } : null,
    exercises: exercises.map((exercise) => ({
      id: exercise.id,
      name: exercise.name,
      muscleGroup: exercise.muscle_group,
      notes: exercise.notes,
      mergedIntoId: exercise.merged_into_id,
      mergedAt: exercise.merged_at,
      archivedAt: exercise.archived_at,
      createdAt: exercise.created_at,
      updatedAt: exercise.updated_at,
    })),
    routines: routines.map((routine) => ({
      id: routine.id,
      name: routine.name,
      notes: routine.notes,
      createdAt: routine.createdAt,
      updatedAt: routine.updatedAt,
      exercises: routine.exercises,
    })),
    sessions: sessions.map((session) => ({
      id: session.id,
      routineId: session.routine_id,
      name: session.name,
      startedAt: session.started_at,
      endedAt: session.ended_at,
      notes: session.notes,
      sets: sets
        .filter((set) => set.session_id === session.id)
        .map((set) => ({
          id: set.id,
          exerciseId: set.exercise_id,
          setIndex: set.set_index,
          reps: set.reps,
          weight: set.weight,
          rpe: set.rpe,
          createdAt: set.created_at,
        })),
    })),
    weights: weights.map((entry) => ({
      id: entry.id,
      weight: entry.weight,
      measuredAt: entry.measured_at,
      notes: entry.notes,
    })),
  };
}

function ensureDefaultExercises() {
  const now = nowIso();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO exercises
     (name, muscle_group, notes, merged_into_id, merged_at, archived_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  DEFAULT_EXERCISES.forEach((exercise) => {
    insert.run(
      exercise.name,
      exercise.muscleGroup || null,
      exercise.notes || null,
      null,
      null,
      null,
      now,
      now
    );
  });
}

async function importPayload(userId, payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid import file');
  }

  const exercises = Array.isArray(payload.exercises) ? payload.exercises : [];
  const routines = Array.isArray(payload.routines) ? payload.routines : [];
  const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  const weights = Array.isArray(payload.weights) ? payload.weights : [];

  const exerciseIdMap = new Map();
  const routineIdMap = new Map();
  const sessionIdMap = new Map();
  const importedCount = {
    exercises: 0,
    routines: 0,
    sessions: 0,
    weights: 0,
  };
  const seenExerciseNames = new Set();

  const insertExercise = db.prepare(
    `INSERT INTO exercises
     (name, muscle_group, notes, merged_into_id, merged_at, archived_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertRoutine = db.prepare(
    `INSERT INTO routines (user_id, name, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  const insertRoutineExercise = db.prepare(
    `INSERT INTO routine_exercises
     (routine_id, exercise_id, equipment, position, target_sets, target_reps, target_weight, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertSession = db.prepare(
    `INSERT INTO sessions (user_id, routine_id, name, started_at, ended_at, notes)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertSet = db.prepare(
    `INSERT INTO session_sets
     (session_id, exercise_id, set_index, reps, weight, rpe, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insertWeight = db.prepare(
    `INSERT INTO bodyweight_entries (user_id, weight, measured_at, notes)
     VALUES (?, ?, ?, ?)`
  );

  const existingExerciseByKey = new Map(
    db
      .prepare('SELECT id, name FROM exercises')
      .all()
      .map((row) => [normalizeText(row.name).toLowerCase(), row.id])
  );
  const exerciseEquipmentById = new Map(
    exercises.map((exercise) => [
      exercise.id,
      normalizeText(exercise.equipment) || null,
    ])
  );
  db.exec('BEGIN IMMEDIATE;');
  try {
    exercises.forEach((exercise) => {
      const sourceName = normalizeText(exercise?.name);
      if (!sourceName) return;
      const nameKey = sourceName.toLowerCase();
      if (seenExerciseNames.has(nameKey)) return;
      seenExerciseNames.add(nameKey);

      let exerciseId = existingExerciseByKey.get(nameKey);
      if (!exerciseId) {
        const now = nowIso();
        const result = insertExercise.run(
          sourceName,
          normalizeText(exercise.muscleGroup) || null,
          normalizeText(exercise.notes) || null,
          null,
          null,
          exercise.archivedAt || null,
          exercise.createdAt || now,
          exercise.updatedAt || now
        );
        exerciseId = Number(result.lastInsertRowid);
        existingExerciseByKey.set(nameKey, exerciseId);
        importedCount.exercises += 1;
      }
      if (exercise.id !== null && exercise.id !== undefined) {
        exerciseIdMap.set(exercise.id, exerciseId);
      }
    });

    routines.forEach((routine) => {
      const name = normalizeText(routine?.name);
      if (!name) return;
      const now = nowIso();
      const result = insertRoutine.run(
        userId,
        name,
        normalizeText(routine.notes) || null,
        routine.createdAt || now,
        routine.updatedAt || now
      );
      const routineId = Number(result.lastInsertRowid);
      importedCount.routines += 1;
      if (routine.id !== null && routine.id !== undefined) {
        routineIdMap.set(routine.id, routineId);
      }

      const items = Array.isArray(routine.exercises) ? routine.exercises : [];
      items.forEach((item, index) => {
        const mappedExerciseId = exerciseIdMap.get(item.exerciseId);
        if (!mappedExerciseId) return;
        const equipment =
          normalizeText(item.equipment) || exerciseEquipmentById.get(item.exerciseId) || null;
        insertRoutineExercise.run(
          routineId,
          mappedExerciseId,
          equipment,
          Number.isFinite(item.position) ? Number(item.position) : index,
          normalizeNumber(item.targetSets),
          normalizeNumber(item.targetReps),
          normalizeNumber(item.targetWeight),
          normalizeText(item.notes) || null
        );
      });
    });

    sessions.forEach((session) => {
      const result = insertSession.run(
        userId,
        routineIdMap.get(session.routineId) || null,
        normalizeText(session.name) || null,
        session.startedAt || nowIso(),
        session.endedAt || null,
        normalizeText(session.notes) || null
      );
      const sessionId = Number(result.lastInsertRowid);
      importedCount.sessions += 1;
      if (session.id !== null && session.id !== undefined) {
        sessionIdMap.set(session.id, sessionId);
      }

      const sets = Array.isArray(session.sets) ? session.sets : [];
      sets.forEach((set) => {
        const mappedExerciseId = exerciseIdMap.get(set.exerciseId);
        if (!mappedExerciseId) return;
        insertSet.run(
          sessionId,
          mappedExerciseId,
          Number(set.setIndex) || 1,
          normalizeNumber(set.reps) || 0,
          normalizeNumber(set.weight) || 0,
          normalizeNumber(set.rpe),
          set.createdAt || nowIso()
        );
      });
    });

    weights.forEach((entry) => {
      const weight = normalizeNumber(entry.weight);
      if (weight === null) return;
      insertWeight.run(
        userId,
        weight,
        entry.measuredAt || nowIso(),
        normalizeText(entry.notes) || null
      );
      importedCount.weights += 1;
    });

    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }

  return importedCount;
}

const distPath = path.resolve(__dirname, '..', 'dist');
const indexHtml = path.join(distPath, 'index.html');

if (fs.existsSync(indexHtml)) {
  app.use(express.static(distPath));
  app.get(/.*/, (req, res) => {
    res.sendFile(indexHtml);
  });
} else {
  console.log('No frontend build found. Run `npm run build` to generate `dist/`.');
}

function startServer() {
  app.listen(port, () => {
    console.log(`API running on http://localhost:${port}`);
  });
}

if (process.env.NODE_ENV !== 'test') {
  const start = async () => {
    await maybeSeedDevData();
    ensureDefaultExercises();
    startServer();
  };
  start();
}

export { app, startServer };
