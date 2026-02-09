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

function parseTargetRepsValue(value) {
  const raw = typeof value === 'number' ? String(value) : normalizeText(value);
  if (!raw) {
    return { targetReps: null, targetRepsRange: null, valid: true };
  }
  const numeric = normalizeNumber(raw);
  if (numeric !== null) {
    if (!Number.isInteger(numeric) || numeric < 1 || numeric > 20) {
      return { targetReps: null, targetRepsRange: null, valid: false };
    }
    return { targetReps: numeric, targetRepsRange: null, valid: true };
  }
  const match = raw.match(/^(\d+)\s*-\s*(\d+)$/);
  if (!match) {
    return { targetReps: null, targetRepsRange: null, valid: false };
  }
  const min = Number(match[1]);
  const max = Number(match[2]);
  if (
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    min < 1 ||
    min > 20 ||
    max > 24 ||
    min >= max
  ) {
    return { targetReps: null, targetRepsRange: null, valid: false };
  }
  return {
    targetReps: null,
    targetRepsRange: `${min}-${max}`,
    valid: true,
  };
}

function parseTargetSetsValue(value) {
  const numeric = normalizeNumber(value);
  if (numeric === null) {
    return { targetSets: null, valid: true };
  }
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 3) {
    return { targetSets: null, valid: false };
  }
  return { targetSets: numeric, valid: true };
}

function parseTargetRestSecondsValue(value) {
  const numeric = normalizeNumber(value);
  if (numeric === null) {
    return { targetRestSeconds: 0, valid: true };
  }
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 3599) {
    return { targetRestSeconds: null, valid: false };
  }
  return { targetRestSeconds: numeric, valid: true };
}

function normalizeRoutineExerciseRows(
  exercises,
  { requireEquipment = true, skipInvalidItems = false, sanitizeSupersets = false } = {}
) {
  const rows = [];
  const source = Array.isArray(exercises) ? exercises : [];

  for (const [index, item] of source.entries()) {
    const exerciseId = Number(item.exerciseId);
    if (!exerciseId) continue;

    const equipment = normalizeText(item.equipment) || null;
    if (requireEquipment && !equipment) {
      if (skipInvalidItems) continue;
      return { rows: [], error: 'Equipment is required for each routine exercise.' };
    }

    const targetSets = parseTargetSetsValue(item.targetSets);
    if (!targetSets.valid) {
      if (skipInvalidItems) continue;
      return { rows: [], error: 'Target sets must be an integer between 1 and 3.' };
    }

    const targetReps = parseTargetRepsValue(item.targetRepsRange || item.targetReps);
    if (!targetReps.valid) {
      if (skipInvalidItems) continue;
      return { rows: [], error: 'Target reps must be 1-20, with range max up to 24.' };
    }

    const targetRest = parseTargetRestSecondsValue(item.targetRestSeconds);
    if (!targetRest.valid) {
      if (skipInvalidItems) continue;
      return { rows: [], error: 'Rest time must be 0-59 minutes and 0-59 seconds.' };
    }

    const targetWeight =
      equipment === 'Bodyweight' || equipment === 'Band'
        ? null
        : normalizeNumber(item.targetWeight);
    const targetBandLabel = equipment === 'Band' ? normalizeText(item.targetBandLabel) || null : null;

    rows.push({
      exerciseId,
      equipment,
      position: Number.isFinite(item.position) ? Number(item.position) : index,
      targetSets: targetSets.targetSets,
      targetReps: targetReps.targetReps,
      targetRepsRange: targetReps.targetRepsRange,
      targetRestSeconds: targetRest.targetRestSeconds,
      targetWeight,
      targetBandLabel,
      notes: normalizeText(item.notes) || null,
      supersetGroup: normalizeText(item.supersetGroup) || null,
      originalIndex: index,
    });
  }

  const sorted = [...rows].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return a.originalIndex - b.originalIndex;
  });
  const rowsBySuperset = new Map();

  sorted.forEach((row) => {
    if (!row.supersetGroup) return;
    if (!rowsBySuperset.has(row.supersetGroup)) {
      rowsBySuperset.set(row.supersetGroup, []);
    }
    rowsBySuperset.get(row.supersetGroup).push(row);
  });

  for (const [group, members] of rowsBySuperset.entries()) {
    const inOrder = [...members].sort((a, b) => a.position - b.position);
    const hasExactlyTwo = inOrder.length === 2;
    const hasAdjacentPositions = hasExactlyTwo
      && Math.abs(inOrder[0].position - inOrder[1].position) === 1;
    const matchingTargetSets = hasExactlyTwo
      && Number.isInteger(inOrder[0].targetSets)
      && Number.isInteger(inOrder[1].targetSets)
      && inOrder[0].targetSets === inOrder[1].targetSets;

    if (hasExactlyTwo && hasAdjacentPositions && matchingTargetSets) {
      continue;
    }

    if (sanitizeSupersets) {
      members.forEach((row) => {
        row.supersetGroup = null;
      });
      continue;
    }

    if (!hasExactlyTwo) {
      return { rows: [], error: `Superset group "${group}" must contain exactly 2 exercises.` };
    }
    if (!hasAdjacentPositions) {
      return { rows: [], error: `Superset group "${group}" exercises must be adjacent.` };
    }
    return {
      rows: [],
      error: `Superset group "${group}" exercises must share the same target sets (1-3).`,
    };
  }

  return {
    rows: rows.map(({ originalIndex, ...row }) => row),
    error: null,
  };
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
              re.target_sets, re.target_reps, re.target_reps_range, re.target_rest_seconds, re.target_weight, re.target_band_label, re.notes, re.equipment, re.superset_group,
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
      targetRepsRange: row.target_reps_range,
      targetRestSeconds: row.target_rest_seconds,
      targetWeight: row.target_weight,
      targetBandLabel: row.target_band_label,
      notes: row.notes,
      supersetGroup: row.superset_group,
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
  const normalizedExercises = normalizeRoutineExerciseRows(exercises);
  if (normalizedExercises.error) {
    return res.status(400).json({ error: normalizedExercises.error });
  }
  const now = nowIso();

  const result = db
    .prepare(
      `INSERT INTO routines (user_id, name, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(req.session.userId, name, notes, now, now);
  const routineId = Number(result.lastInsertRowid);

  const insertExercise = db.prepare(
    `INSERT INTO routine_exercises
     (routine_id, exercise_id, equipment, position, target_sets, target_reps, target_reps_range, target_rest_seconds, target_weight, target_band_label, notes, superset_group)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const item of normalizedExercises.rows) {
    insertExercise.run(
      routineId,
      item.exerciseId,
      item.equipment,
      item.position,
      item.targetSets,
      item.targetReps,
      item.targetRepsRange,
      item.targetRestSeconds,
      item.targetWeight,
      item.targetBandLabel,
      item.notes,
      item.supersetGroup
    );
  }

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
  const normalizedExercises = normalizeRoutineExerciseRows(exercises);
  if (normalizedExercises.error) {
    return res.status(400).json({ error: normalizedExercises.error });
  }
  const now = nowIso();

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
     (routine_id, exercise_id, equipment, position, target_sets, target_reps, target_reps_range, target_rest_seconds, target_weight, target_band_label, notes, superset_group)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const item of normalizedExercises.rows) {
    insertExercise.run(
      routineId,
      item.exerciseId,
      item.equipment,
      item.position,
      item.targetSets,
      item.targetReps,
      item.targetRepsRange,
      item.targetRestSeconds,
      item.targetWeight,
      item.targetBandLabel,
      item.notes,
      item.supersetGroup
    );
  }

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
      `SELECT exercise_id, equipment, target_sets, target_reps, target_reps_range, target_rest_seconds, target_weight, target_band_label, notes, position, superset_group
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
     (routine_id, exercise_id, equipment, position, target_sets, target_reps, target_reps_range, target_rest_seconds, target_weight, target_band_label, notes, superset_group)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  sourceExercises.forEach((item, index) => {
    insertExercise.run(
      duplicateId,
      item.exercise_id,
      item.equipment || null,
      Number.isFinite(item.position) ? Number(item.position) : index,
      item.target_sets,
      item.target_reps,
      item.target_reps_range,
      item.target_rest_seconds,
      item.target_weight,
      item.target_band_label,
      item.notes || null,
      item.superset_group || null
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
    .prepare(
      `SELECT id, superset_group
       FROM routine_exercises
       WHERE routine_id = ?
       ORDER BY position ASC`
    )
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

  const currentById = new Map(currentRows.map((row) => [Number(row.id), row]));
  const rowsBySuperset = new Map();
  orderedIds.forEach((exerciseRowId, position) => {
    const supersetGroup = normalizeText(currentById.get(exerciseRowId)?.superset_group) || null;
    if (!supersetGroup) return;
    if (!rowsBySuperset.has(supersetGroup)) {
      rowsBySuperset.set(supersetGroup, []);
    }
    rowsBySuperset.get(supersetGroup).push(position);
  });
  for (const [group, positions] of rowsBySuperset.entries()) {
    if (positions.length !== 2 || Math.abs(positions[0] - positions[1]) !== 1) {
      return res.status(400).json({
        error: `exerciseOrder would break superset "${group}". Keep superset exercises adjacent.`,
      });
    }
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

function calculateDurationSeconds(startedAt, completedAt) {
  if (!startedAt || !completedAt) return null;
  const startMs = new Date(startedAt).getTime();
  const endMs = new Date(completedAt).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return null;
  }
  return Math.round((endMs - startMs) / 1000);
}

function getRoutineExercisePosition(routineId, exerciseId) {
  if (!routineId) return null;
  const row = db
    .prepare(
      `SELECT position
       FROM routine_exercises
       WHERE routine_id = ? AND exercise_id = ?
       ORDER BY position ASC
       LIMIT 1`
    )
    .get(routineId, exerciseId);
  if (!row) return null;
  return Number(row.position);
}

function seedSessionExerciseProgress(sessionId, routineId) {
  if (!routineId) return;
  const rows = db
    .prepare(
      `SELECT exercise_id, position
       FROM routine_exercises
       WHERE routine_id = ?
       ORDER BY position ASC`
    )
    .all(routineId);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO session_exercise_progress
     (session_id, exercise_id, position, status, started_at, completed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const now = nowIso();
  rows.forEach((row) => {
    insert.run(sessionId, row.exercise_id, row.position, 'pending', null, null, now, now);
  });
}

function getSessionExerciseProgressRow(sessionId, exerciseId) {
  return db
    .prepare(
      `SELECT id, session_id, exercise_id, position, status, started_at, completed_at, created_at, updated_at
       FROM session_exercise_progress
       WHERE session_id = ? AND exercise_id = ?`
    )
    .get(sessionId, exerciseId);
}

function buildExerciseProgressPayload(row) {
  if (!row) return null;
  return {
    exerciseId: row.exercise_id,
    position: Number(row.position),
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationSeconds: calculateDurationSeconds(row.started_at, row.completed_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function ensureSessionExerciseExists(session, exerciseId) {
  const exercise = db.prepare('SELECT id FROM exercises WHERE id = ?').get(exerciseId);
  if (!exercise) {
    throw new Error('Exercise not found.');
  }
  if (!session.routine_id) {
    return Number.MAX_SAFE_INTEGER;
  }
  if (session.routine_id) {
    const position = getRoutineExercisePosition(session.routine_id, exerciseId);
    if (position !== null) {
      return position;
    }
  }
  const existingSet = db
    .prepare('SELECT id FROM session_sets WHERE session_id = ? AND exercise_id = ? LIMIT 1')
    .get(session.id, exerciseId);
  if (existingSet) {
    return Number.MAX_SAFE_INTEGER;
  }
  throw new Error('Exercise not found in session.');
}

function upsertSessionExerciseProgressFromSet(session, exerciseId, setIndex, startedAt, completedAt) {
  const now = nowIso();
  const resolvedPosition = ensureSessionExerciseExists(session, exerciseId);
  const existing = getSessionExerciseProgressRow(session.id, exerciseId);
  if (!existing) {
    db.prepare(
      `INSERT INTO session_exercise_progress
       (session_id, exercise_id, position, status, started_at, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      session.id,
      exerciseId,
      resolvedPosition,
      'pending',
      null,
      null,
      now,
      now
    );
  }

  const targetSetsRow = session.routine_id
    ? db
        .prepare(
          `SELECT target_sets
           FROM routine_exercises
           WHERE routine_id = ? AND exercise_id = ?
           ORDER BY position ASC
           LIMIT 1`
        )
        .get(session.routine_id, exerciseId)
    : null;
  const targetSets = normalizeNumber(targetSetsRow?.target_sets);
  const shouldComplete = targetSets !== null && setIndex >= targetSets;

  const progress = getSessionExerciseProgressRow(session.id, exerciseId);
  const nextStatus = shouldComplete ? 'completed' : progress?.status === 'completed' ? 'completed' : 'in_progress';
  const startedAtValue = progress?.started_at || startedAt || completedAt || now;
  const completedAtValue = nextStatus === 'completed'
    ? progress?.completed_at || completedAt || now
    : null;

  db.prepare(
    `UPDATE session_exercise_progress
     SET status = ?,
         started_at = ?,
         completed_at = ?,
         updated_at = ?
     WHERE session_id = ? AND exercise_id = ?`
  ).run(nextStatus, startedAtValue, completedAtValue, now, session.id, exerciseId);

  return buildExerciseProgressPayload(getSessionExerciseProgressRow(session.id, exerciseId));
}

function startSessionExerciseForUser(userId, sessionId, exerciseId, payload) {
  const session = getSessionById(sessionId, userId);
  if (!session) {
    throw new Error('Session not found.');
  }
  const position = ensureSessionExerciseExists(session, exerciseId);
  const now = nowIso();
  const startedAt = normalizeText(payload?.startedAt) || now;
  const existing = getSessionExerciseProgressRow(sessionId, exerciseId);
  if (!existing) {
    db.prepare(
      `INSERT INTO session_exercise_progress
       (session_id, exercise_id, position, status, started_at, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(sessionId, exerciseId, position, 'in_progress', startedAt, null, now, now);
  } else if (existing.status !== 'completed') {
    db.prepare(
      `UPDATE session_exercise_progress
       SET status = ?, started_at = COALESCE(started_at, ?), completed_at = NULL, updated_at = ?
       WHERE session_id = ? AND exercise_id = ?`
    ).run('in_progress', startedAt, now, sessionId, exerciseId);
  }
  return buildExerciseProgressPayload(getSessionExerciseProgressRow(sessionId, exerciseId));
}

function completeSessionExerciseForUser(userId, sessionId, exerciseId, payload) {
  const session = getSessionById(sessionId, userId);
  if (!session) {
    throw new Error('Session not found.');
  }
  const position = ensureSessionExerciseExists(session, exerciseId);
  const now = nowIso();
  const completedAt = normalizeText(payload?.completedAt) || now;
  const existing = getSessionExerciseProgressRow(sessionId, exerciseId);
  if (!existing) {
    db.prepare(
      `INSERT INTO session_exercise_progress
       (session_id, exercise_id, position, status, started_at, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(sessionId, exerciseId, position, 'completed', completedAt, completedAt, now, now);
  } else {
    db.prepare(
      `UPDATE session_exercise_progress
       SET status = ?, started_at = COALESCE(started_at, ?), completed_at = ?, updated_at = ?
       WHERE session_id = ? AND exercise_id = ?`
    ).run('completed', completedAt, completedAt, now, sessionId, exerciseId);
  }
  return buildExerciseProgressPayload(getSessionExerciseProgressRow(sessionId, exerciseId));
}

function getSessionDetail(sessionId, userId) {
  const session = getSessionById(sessionId, userId);
  if (!session) return null;

  const routineRows = session.routine_id
    ? db
        .prepare(
      `SELECT re.exercise_id, re.position, re.equipment, re.target_sets, re.target_reps, re.target_reps_range,
                  re.target_rest_seconds, re.target_weight, re.target_band_label, re.superset_group, e.name AS exercise_name
           FROM routine_exercises re
           JOIN exercises e ON e.id = re.exercise_id
           WHERE re.routine_id = ?
           ORDER BY re.position ASC`
        )
        .all(session.routine_id)
    : [];

  const progressRows = db
    .prepare(
      `SELECT id, session_id, exercise_id, position, status, started_at, completed_at, created_at, updated_at
       FROM session_exercise_progress
       WHERE session_id = ?
       ORDER BY position ASC`
    )
    .all(sessionId);

  const setRows = db
    .prepare(
      `SELECT ss.id, ss.exercise_id, ss.set_index, ss.reps, ss.weight, ss.band_label, ss.started_at, ss.completed_at, ss.created_at,
              e.name AS exercise_name
       FROM session_sets ss
       JOIN exercises e ON e.id = ss.exercise_id
       WHERE ss.session_id = ?
       ORDER BY ss.created_at ASC, ss.id ASC`
    )
    .all(sessionId);

  const exercisesById = new Map();
  routineRows.forEach((row) => {
    exercisesById.set(row.exercise_id, {
      exerciseId: row.exercise_id,
      name: row.exercise_name,
      position: Number(row.position),
      status: 'pending',
      startedAt: null,
      completedAt: null,
      durationSeconds: null,
      equipment: row.equipment,
      targetSets: row.target_sets,
      targetReps: row.target_reps,
      targetRepsRange: row.target_reps_range,
      targetRestSeconds: row.target_rest_seconds,
      targetWeight: row.target_weight,
      targetBandLabel: row.target_band_label,
      supersetGroup: row.superset_group,
      sets: [],
    });
  });

  progressRows.forEach((row) => {
    const existing = exercisesById.get(row.exercise_id);
    if (!existing) {
      const exerciseName = db
        .prepare('SELECT name FROM exercises WHERE id = ?')
        .get(row.exercise_id)?.name;
      exercisesById.set(row.exercise_id, {
        exerciseId: row.exercise_id,
        name: exerciseName || 'Exercise',
        position: Number(row.position),
        status: row.status || 'pending',
        startedAt: row.started_at,
        completedAt: row.completed_at,
        durationSeconds: calculateDurationSeconds(row.started_at, row.completed_at),
        equipment: null,
        targetSets: null,
        targetReps: null,
        targetRepsRange: null,
        targetRestSeconds: null,
        targetWeight: null,
        targetBandLabel: null,
        supersetGroup: null,
        sets: [],
      });
      return;
    }
    existing.position = Number(row.position);
    existing.status = row.status || existing.status;
    existing.startedAt = row.started_at || existing.startedAt;
    existing.completedAt = row.completed_at || existing.completedAt;
    existing.durationSeconds = calculateDurationSeconds(existing.startedAt, existing.completedAt);
  });

  setRows.forEach((row) => {
    if (!exercisesById.has(row.exercise_id)) {
      exercisesById.set(row.exercise_id, {
        exerciseId: row.exercise_id,
        name: row.exercise_name,
        position: Number.MAX_SAFE_INTEGER,
        status: 'pending',
        startedAt: null,
        completedAt: null,
        durationSeconds: null,
        equipment: null,
        targetSets: null,
        targetReps: null,
        targetRepsRange: null,
        targetRestSeconds: null,
        targetWeight: null,
        targetBandLabel: null,
        supersetGroup: null,
        sets: [],
      });
    }
    exercisesById.get(row.exercise_id).sets.push({
      id: row.id,
      setIndex: row.set_index,
      reps: row.reps,
      weight: row.weight,
      bandLabel: row.band_label,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      durationSeconds: calculateDurationSeconds(row.started_at, row.completed_at),
      createdAt: row.created_at,
    });
  });

  const exercises = Array.from(exercisesById.values())
    .map((exercise) => {
      const sets = [...(exercise.sets || [])].sort((a, b) => a.setIndex - b.setIndex);
      const startedAt =
        exercise.startedAt
        || sets.find((set) => set.startedAt || set.completedAt || set.createdAt)?.startedAt
        || sets.find((set) => set.startedAt || set.completedAt || set.createdAt)?.completedAt
        || sets.find((set) => set.startedAt || set.completedAt || set.createdAt)?.createdAt
        || null;
      let completedAt = exercise.completedAt;
      let status = exercise.status || 'pending';
      if (!status || status === 'pending') {
        status = sets.length ? 'in_progress' : 'pending';
      }
      if (exercise.targetSets !== null && exercise.targetSets !== undefined && sets.length >= Number(exercise.targetSets)) {
        status = 'completed';
        if (!completedAt) {
          const lastSet = sets[sets.length - 1];
          completedAt = lastSet?.completedAt || lastSet?.createdAt || null;
        }
      }
      return {
        ...exercise,
        sets,
        status,
        startedAt,
        completedAt,
        durationSeconds: calculateDurationSeconds(startedAt, completedAt),
      };
    })
    .sort((a, b) => {
      if (a.position !== b.position) return a.position - b.position;
      return a.name.localeCompare(b.name);
    });

  return {
    id: session.id,
    routineId: session.routine_id,
    routineName: session.routine_name,
    name: session.name,
    startedAt: session.started_at,
    endedAt: session.ended_at,
    durationSeconds: calculateDurationSeconds(session.started_at, session.ended_at),
    notes: session.notes,
    exercises,
  };
}

function updateSessionForUser(userId, sessionId, payload) {
  const body = payload || {};
  const hasName = Object.prototype.hasOwnProperty.call(body, 'name');
  const hasNotes = Object.prototype.hasOwnProperty.call(body, 'notes');
  const hasEndedAt = Object.prototype.hasOwnProperty.call(body, 'endedAt');
  if (!hasName && !hasNotes && !hasEndedAt) {
    throw new Error('No session fields provided.');
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
      userId
    );
  if (result.changes === 0) {
    throw new Error('Session not found.');
  }
  return getSessionDetail(sessionId, userId);
}

function createSetForSession(userId, sessionId, payload) {
  const exerciseId = normalizeNumber(payload?.exerciseId);
  const reps = normalizeNumber(payload?.reps);
  const weight = normalizeNumber(payload?.weight);
  const bandLabel = normalizeText(payload?.bandLabel) || null;
  if (!exerciseId || !reps || weight === null) {
    throw new Error('Exercise, reps, and weight are required.');
  }

  const session = getSessionById(sessionId, userId);
  if (!session) {
    throw new Error('Session not found.');
  }

  const exercise = db.prepare('SELECT id FROM exercises WHERE id = ?').get(exerciseId);
  if (!exercise) {
    throw new Error('Exercise not found.');
  }
  ensureSessionExerciseExists(session, exerciseId);

  const nextIndex = db
    .prepare('SELECT COUNT(*) AS count FROM session_sets WHERE session_id = ? AND exercise_id = ?')
    .get(sessionId, exerciseId)?.count;
  const currentSetCount = Number(nextIndex) || 0;
  if (session.routine_id) {
    const targetSetsRow = db
      .prepare(
        `SELECT target_sets
         FROM routine_exercises
         WHERE routine_id = ? AND exercise_id = ?
         ORDER BY position ASC
         LIMIT 1`
      )
      .get(session.routine_id, exerciseId);
    const targetSets = normalizeNumber(targetSetsRow?.target_sets);
    if (targetSets !== null && currentSetCount >= targetSets) {
      throw new Error('Target set count reached for this exercise.');
    }
  }
  const startedAt = normalizeText(payload?.startedAt) || null;
  const completedAt = normalizeText(payload?.completedAt) || normalizeText(payload?.createdAt) || nowIso();
  const createdAt = completedAt;
  const result = db
    .prepare(
      `INSERT INTO session_sets
       (session_id, exercise_id, set_index, reps, weight, band_label, started_at, completed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      sessionId,
      exerciseId,
      currentSetCount + 1,
      reps,
      weight,
      bandLabel,
      startedAt,
      completedAt,
      createdAt
    );
  const setIndex = currentSetCount + 1;
  const exerciseProgress = upsertSessionExerciseProgressFromSet(
    session,
    exerciseId,
    setIndex,
    startedAt,
    completedAt
  );

  return {
    set: {
      id: Number(result.lastInsertRowid),
      sessionId,
      exerciseId,
      setIndex,
      reps,
      weight,
      bandLabel,
      startedAt,
      completedAt,
      createdAt,
    },
    exerciseProgress,
  };
}

function updateSetForUser(userId, setId, payload) {
  const body = payload || {};
  const hasReps = Object.prototype.hasOwnProperty.call(body, 'reps');
  const hasWeight = Object.prototype.hasOwnProperty.call(body, 'weight');
  const hasBandLabel = Object.prototype.hasOwnProperty.call(body, 'bandLabel');
  if (!hasReps && !hasWeight && !hasBandLabel) {
    throw new Error('No set fields provided.');
  }
  const reps = hasReps ? normalizeNumber(body.reps) : null;
  const weight = hasWeight ? normalizeNumber(body.weight) : null;
  const bandLabel = hasBandLabel ? normalizeText(body.bandLabel) || null : null;

  const result = db
    .prepare(
      `UPDATE session_sets
       SET reps = CASE WHEN ? THEN ? ELSE reps END,
           weight = CASE WHEN ? THEN ? ELSE weight END,
           band_label = CASE WHEN ? THEN ? ELSE band_label END
       WHERE id = ? AND session_id IN (SELECT id FROM sessions WHERE user_id = ?)`
    )
    .run(
      hasReps ? 1 : 0,
      reps,
      hasWeight ? 1 : 0,
      weight,
      hasBandLabel ? 1 : 0,
      bandLabel,
      setId,
      userId
    );
  if (result.changes === 0) {
    throw new Error('Set not found.');
  }
  const updated = db
    .prepare(
      `SELECT ss.id, ss.session_id, ss.exercise_id, ss.set_index, ss.reps, ss.weight, ss.band_label, ss.started_at, ss.completed_at, ss.created_at
       FROM session_sets ss
       WHERE ss.id = ?`
    )
    .get(setId);

  return {
    id: updated.id,
    sessionId: updated.session_id,
    exerciseId: updated.exercise_id,
    setIndex: updated.set_index,
    reps: updated.reps,
    weight: updated.weight,
    bandLabel: updated.band_label,
    startedAt: updated.started_at,
    completedAt: updated.completed_at,
    createdAt: updated.created_at,
  };
}

function deleteSetForUser(userId, setId) {
  const result = db
    .prepare(
      'DELETE FROM session_sets WHERE id = ? AND session_id IN (SELECT id FROM sessions WHERE user_id = ?)'
    )
    .run(setId, userId);
  if (result.changes === 0) {
    throw new Error('Set not found.');
  }
}

function createWeightForUser(userId, payload) {
  const weight = normalizeNumber(payload?.weight);
  if (weight === null) {
    throw new Error('Weight is required.');
  }
  const measuredAt = normalizeText(payload?.measuredAt) || nowIso();
  const notes = normalizeText(payload?.notes) || null;
  const result = db
    .prepare(
      `INSERT INTO bodyweight_entries (user_id, weight, measured_at, notes)
       VALUES (?, ?, ?, ?)`
    )
    .run(userId, weight, measuredAt, notes);

  return {
    id: Number(result.lastInsertRowid),
    weight,
    measuredAt,
    notes,
  };
}

function parseStoredSyncResult(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function applySyncOperation(userId, operationType, payload) {
  if (operationType === 'session_set.create') {
    const sessionId = normalizeNumber(payload?.sessionId);
    if (!sessionId) {
      throw new Error('sessionId is required for session_set.create.');
    }
    return createSetForSession(userId, sessionId, payload);
  }
  if (operationType === 'session.update') {
    const sessionId = normalizeNumber(payload?.sessionId);
    if (!sessionId) {
      throw new Error('sessionId is required for session.update.');
    }
    return { session: updateSessionForUser(userId, sessionId, payload) };
  }
  if (operationType === 'bodyweight.create') {
    return { entry: createWeightForUser(userId, payload) };
  }
  if (operationType === 'session_set.update') {
    const setId = normalizeNumber(payload?.setId);
    if (!setId) {
      throw new Error('setId is required for session_set.update.');
    }
    return { set: updateSetForUser(userId, setId, payload) };
  }
  if (operationType === 'session_set.delete') {
    const setId = normalizeNumber(payload?.setId);
    if (!setId) {
      throw new Error('setId is required for session_set.delete.');
    }
    deleteSetForUser(userId, setId);
    return { ok: true };
  }
  if (operationType === 'session_exercise.start') {
    const sessionId = normalizeNumber(payload?.sessionId);
    const exerciseId = normalizeNumber(payload?.exerciseId);
    if (!sessionId || !exerciseId) {
      throw new Error('sessionId and exerciseId are required for session_exercise.start.');
    }
    return {
      exerciseProgress: startSessionExerciseForUser(userId, sessionId, exerciseId, payload),
    };
  }
  if (operationType === 'session_exercise.complete') {
    const sessionId = normalizeNumber(payload?.sessionId);
    const exerciseId = normalizeNumber(payload?.exerciseId);
    if (!sessionId || !exerciseId) {
      throw new Error('sessionId and exerciseId are required for session_exercise.complete.');
    }
    return {
      exerciseProgress: completeSessionExerciseForUser(userId, sessionId, exerciseId, payload),
    };
  }
  throw new Error(`Unsupported operation type: ${operationType}`);
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
  if (!routineId || !Number.isInteger(routineId)) {
    return res.status(400).json({ error: 'Routine is required.' });
  }
  const routine = db
    .prepare('SELECT id FROM routines WHERE id = ? AND user_id = ?')
    .get(routineId, req.session.userId);
  if (!routine) {
    return res.status(404).json({ error: 'Routine not found.' });
  }
  const name = normalizeText(req.body?.name) || null;
  const startedAt = normalizeText(req.body?.startedAt) || nowIso();
  const result = db
    .prepare(
      `INSERT INTO sessions (user_id, routine_id, name, started_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(req.session.userId, routineId, name, startedAt);

  const sessionId = Number(result.lastInsertRowid);
  seedSessionExerciseProgress(sessionId, routineId);
  const detail = getSessionDetail(sessionId, req.session.userId);
  return res.json({ session: detail });
});

app.put('/api/sessions/:id', requireAuth, (req, res) => {
  const sessionId = Number(req.params.id);
  if (!sessionId) {
    return res.status(400).json({ error: 'Invalid session id.' });
  }
  try {
    const detail = updateSessionForUser(req.session.userId, sessionId, req.body || {});
    return res.json({ session: detail });
  } catch (error) {
    const status = error.message === 'Session not found.' ? 404 : 400;
    return res.status(status).json({ error: error.message });
  }
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

app.post('/api/sessions/:id/exercises/:exerciseId/start', requireAuth, (req, res) => {
  const sessionId = Number(req.params.id);
  const exerciseId = Number(req.params.exerciseId);
  if (!sessionId || !exerciseId) {
    return res.status(400).json({ error: 'Invalid session or exercise id.' });
  }
  try {
    const exerciseProgress = startSessionExerciseForUser(
      req.session.userId,
      sessionId,
      exerciseId,
      req.body || {}
    );
    return res.json({ exerciseProgress });
  } catch (error) {
    const notFoundErrors = new Set([
      'Session not found.',
      'Exercise not found.',
      'Exercise not found in session.',
    ]);
    return res.status(notFoundErrors.has(error.message) ? 404 : 400).json({ error: error.message });
  }
});

app.post('/api/sessions/:id/exercises/:exerciseId/complete', requireAuth, (req, res) => {
  const sessionId = Number(req.params.id);
  const exerciseId = Number(req.params.exerciseId);
  if (!sessionId || !exerciseId) {
    return res.status(400).json({ error: 'Invalid session or exercise id.' });
  }
  try {
    const exerciseProgress = completeSessionExerciseForUser(
      req.session.userId,
      sessionId,
      exerciseId,
      req.body || {}
    );
    return res.json({ exerciseProgress });
  } catch (error) {
    const notFoundErrors = new Set([
      'Session not found.',
      'Exercise not found.',
      'Exercise not found in session.',
    ]);
    return res.status(notFoundErrors.has(error.message) ? 404 : 400).json({ error: error.message });
  }
});

app.post('/api/sessions/:id/sets', requireAuth, (req, res) => {
  const sessionId = Number(req.params.id);
  if (!sessionId) {
    return res.status(400).json({ error: 'Invalid session id.' });
  }
  try {
    const result = createSetForSession(req.session.userId, sessionId, req.body || {});
    return res.json(result);
  } catch (error) {
    const status =
      error.message === 'Session not found.'
      || error.message === 'Exercise not found.'
      || error.message === 'Exercise not found in session.'
        ? 404
        : 400;
    return res.status(status).json({ error: error.message });
  }
});

app.put('/api/sets/:id', requireAuth, (req, res) => {
  const setId = Number(req.params.id);
  if (!setId) {
    return res.status(400).json({ error: 'Invalid set id.' });
  }
  try {
    const set = updateSetForUser(req.session.userId, setId, req.body || {});
    return res.json({ set });
  } catch (error) {
    const status = error.message === 'Set not found.' ? 404 : 400;
    return res.status(status).json({ error: error.message });
  }
});

app.delete('/api/sets/:id', requireAuth, (req, res) => {
  const setId = Number(req.params.id);
  if (!setId) {
    return res.status(400).json({ error: 'Invalid set id.' });
  }
  try {
    deleteSetForUser(req.session.userId, setId);
    return res.json({ ok: true });
  } catch (error) {
    if (error.message === 'Set not found.') {
      return res.status(404).json({ error: error.message });
    }
    return res.status(400).json({ error: error.message });
  }
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
  try {
    const entry = createWeightForUser(req.session.userId, req.body || {});
    return res.json({ entry });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
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

app.get('/api/bands', requireAuth, (req, res) => {
  const bands = db
    .prepare(
      `SELECT id, name, created_at
       FROM user_bands
       WHERE user_id = ?
       ORDER BY lower(name) ASC`
    )
    .all(req.session.userId)
    .map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
    }));
  return res.json({ bands });
});

app.post('/api/bands', requireAuth, (req, res) => {
  const name = normalizeText(req.body?.name);
  if (!name) {
    return res.status(400).json({ error: 'Band name is required.' });
  }
  try {
    const createdAt = nowIso();
    const result = db
      .prepare(
        `INSERT INTO user_bands (user_id, name, created_at)
         VALUES (?, ?, ?)`
      )
      .run(req.session.userId, name, createdAt);
    return res.json({
      band: {
        id: Number(result.lastInsertRowid),
        name,
        createdAt,
      },
    });
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) {
      return res.status(409).json({ error: 'Band already exists.' });
    }
    return res.status(500).json({ error: 'Failed to create band.' });
  }
});

app.delete('/api/bands/:id', requireAuth, (req, res) => {
  const bandId = Number(req.params.id);
  if (!bandId) {
    return res.status(400).json({ error: 'Invalid band id.' });
  }
  const result = db
    .prepare('DELETE FROM user_bands WHERE id = ? AND user_id = ?')
    .run(bandId, req.session.userId);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Band not found.' });
  }
  return res.json({ ok: true });
});

app.post('/api/sync/batch', requireAuth, (req, res) => {
  const operations = Array.isArray(req.body?.operations) ? req.body.operations : [];
  if (!operations.length) {
    return res.status(400).json({ error: 'operations must be a non-empty array.' });
  }
  if (operations.length > 100) {
    return res.status(400).json({ error: 'Maximum batch size is 100 operations.' });
  }

  const findOperation = db.prepare(
    `SELECT operation_type, result_json
     FROM sync_operations
     WHERE user_id = ? AND operation_id = ?`
  );
  const storeOperation = db.prepare(
    `INSERT INTO sync_operations
     (user_id, operation_id, operation_type, payload, applied_at, result_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const results = [];
  let applied = 0;
  let duplicates = 0;
  let rejected = 0;

  operations.forEach((operation) => {
    const operationId = normalizeText(operation?.operationId);
    const operationType = normalizeText(operation?.operationType);
    const payload = operation?.payload && typeof operation.payload === 'object'
      ? operation.payload
      : {};

    if (!operationId || !operationType) {
      rejected += 1;
      results.push({
        operationId: operationId || null,
        operationType: operationType || null,
        status: 'rejected',
        error: 'operationId and operationType are required.',
      });
      return;
    }

    db.exec('BEGIN IMMEDIATE;');
    try {
      const existing = findOperation.get(req.session.userId, operationId);
      if (existing) {
        db.exec('ROLLBACK;');
        duplicates += 1;
        results.push({
          operationId,
          operationType: existing.operation_type,
          status: 'duplicate',
          result: parseStoredSyncResult(existing.result_json),
        });
        return;
      }

      const result = applySyncOperation(req.session.userId, operationType, payload);
      storeOperation.run(
        req.session.userId,
        operationId,
        operationType,
        JSON.stringify(payload),
        nowIso(),
        JSON.stringify(result)
      );
      db.exec('COMMIT;');
      applied += 1;
      results.push({
        operationId,
        operationType,
        status: 'applied',
        result,
      });
    } catch (error) {
      db.exec('ROLLBACK;');
      rejected += 1;
      results.push({
        operationId,
        operationType,
        status: 'rejected',
        error: error.message || 'Failed to apply operation.',
      });
    }
  });

  return res.json({
    ok: true,
    summary: {
      received: operations.length,
      applied,
      duplicates,
      rejected,
    },
    results,
  });
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
  const expectedVersion = 5;
  const supportedVersions = new Set([3, 4, 5]);

  if (!payload || typeof payload !== 'object') {
    return {
      valid: false,
      errors: ['Payload must be a JSON object.'],
      warnings: [],
      summary: null,
    };
  }

  if (!supportedVersions.has(Number(payload.version))) {
    errors.push(`Unsupported import version. Expected one of ${Array.from(supportedVersions).join(', ')}, got ${payload.version ?? 'unknown'}.`);
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
          `SELECT id, session_id, exercise_id, set_index, reps, weight, band_label, started_at, completed_at, created_at
           FROM session_sets
           WHERE session_id IN (${sessionIds.map(() => '?').join(',')})`
        )
        .all(...sessionIds)
    : [];
  const progressRows = sessionIds.length
    ? db
        .prepare(
          `SELECT session_id, exercise_id, position, status, started_at, completed_at, created_at, updated_at
           FROM session_exercise_progress
           WHERE session_id IN (${sessionIds.map(() => '?').join(',')})
           ORDER BY position ASC`
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
    version: 5,
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
      exerciseProgress: progressRows
        .filter((progress) => progress.session_id === session.id)
        .map((progress) => ({
          exerciseId: progress.exercise_id,
          position: progress.position,
          status: progress.status,
          startedAt: progress.started_at,
          completedAt: progress.completed_at,
          createdAt: progress.created_at,
          updatedAt: progress.updated_at,
        })),
      sets: sets
        .filter((set) => set.session_id === session.id)
        .map((set) => ({
          id: set.id,
          exerciseId: set.exercise_id,
          setIndex: set.set_index,
          reps: set.reps,
          weight: set.weight,
          bandLabel: set.band_label,
          startedAt: set.started_at,
          completedAt: set.completed_at,
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
     (routine_id, exercise_id, equipment, position, target_sets, target_reps, target_reps_range, target_rest_seconds, target_weight, target_band_label, notes, superset_group)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertSession = db.prepare(
    `INSERT INTO sessions (user_id, routine_id, name, started_at, ended_at, notes)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertSet = db.prepare(
    `INSERT INTO session_sets
     (session_id, exercise_id, set_index, reps, weight, band_label, started_at, completed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertExerciseProgress = db.prepare(
    `INSERT INTO session_exercise_progress
     (session_id, exercise_id, position, status, started_at, completed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
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
      const normalizedItems = [];
      items.forEach((item, index) => {
        const mappedExerciseId = exerciseIdMap.get(item.exerciseId);
        if (!mappedExerciseId) return;
        const equipment =
          normalizeText(item.equipment) || exerciseEquipmentById.get(item.exerciseId) || null;
        normalizedItems.push({
          ...item,
          exerciseId: mappedExerciseId,
          equipment,
          position: Number.isFinite(item.position) ? Number(item.position) : index,
          supersetGroup: normalizeText(item.supersetGroup) || null,
        });
      });
      const normalized = normalizeRoutineExerciseRows(normalizedItems, {
        requireEquipment: false,
        skipInvalidItems: true,
        sanitizeSupersets: true,
      });
      normalized.rows.forEach((item) => {
        insertRoutineExercise.run(
          routineId,
          item.exerciseId,
          item.equipment,
          item.position,
          item.targetSets,
          item.targetReps,
          item.targetRepsRange,
          item.targetRestSeconds,
          item.targetWeight,
          item.targetBandLabel,
          item.notes,
          item.supersetGroup
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
        const completedAt = set.completedAt || set.createdAt || nowIso();
        insertSet.run(
          sessionId,
          mappedExerciseId,
          Number(set.setIndex) || 1,
          normalizeNumber(set.reps) || 0,
          normalizeNumber(set.weight) || 0,
          normalizeText(set.bandLabel) || null,
          set.startedAt || null,
          completedAt,
          completedAt
        );
      });

      const progressEntries = Array.isArray(session.exerciseProgress) ? session.exerciseProgress : [];
      progressEntries.forEach((progress, index) => {
        const mappedExerciseId = exerciseIdMap.get(progress.exerciseId);
        if (!mappedExerciseId) return;
        const status = normalizeText(progress.status) || 'pending';
        const safeStatus = ['pending', 'in_progress', 'completed'].includes(status)
          ? status
          : 'pending';
        const createdAt = progress.createdAt || nowIso();
        const updatedAt = progress.updatedAt || createdAt;
        insertExerciseProgress.run(
          sessionId,
          mappedExerciseId,
          Number.isFinite(progress.position) ? Number(progress.position) : index,
          safeStatus,
          progress.startedAt || null,
          progress.completedAt || null,
          createdAt,
          updatedAt
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
