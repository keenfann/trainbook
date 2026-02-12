import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import express from 'express';
import session from 'express-session';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import { shouldApplyDevAutologin } from './dev-autologin.js';
import SqliteSessionStore from './session-store.js';
import {
  resolveAutomaticExportConfig,
  startAutomaticExports,
} from './auto-export.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 4286;
const host = process.env.HOST || '0.0.0.0';
const sessionSecret = resolveSessionSecret();
const isDevEnv = process.env.NODE_ENV !== 'production';
const devSeedPath = isDevEnv ? process.env.DEV_SEED_PATH : null;
const devAutologinEnabled = isDevEnv && process.env.DEV_AUTOLOGIN === 'true';
const devAutologinAllowRemote =
  isDevEnv && process.env.DEV_AUTOLOGIN_ALLOW_REMOTE === 'true';
const devUserName = process.env.DEV_USER || 'coach';
const devPassword = process.env.DEV_PASSWORD || 'dev';
const CSRF_HEADER = 'x-csrf-token';
const CSRF_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SEED_EXERCISES_PATH = path.resolve(__dirname, 'seed-exercises.json');
const EXERCISE_LIBRARY_PATH = path.resolve(__dirname, 'resources', 'exercisedb-library.json');
const EXERCISE_LIBRARY_PROVIDER = 'keenfann/free-exercise-db';
const EXERCISE_IMAGE_BASE_URL =
  'https://raw.githubusercontent.com/keenfann/free-exercise-db/main/exercises/';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const WINDOW_PATTERNS = {
  short: ['30d', '90d'],
  medium: ['90d', '180d', '365d'],
  long: ['30d', '90d', '180d'],
  timeseries: ['90d', '180d', '365d'],
};
const ROUTINE_TYPE_VALUES = new Set(['standard', 'rehab']);
const FORCE_VALUES = new Set(['pull', 'push', 'static']);
const LEVEL_VALUES = new Set(['beginner', 'intermediate', 'expert']);
const MECHANIC_VALUES = new Set(['isolation', 'compound']);
const EQUIPMENT_VALUES = new Set([
  'medicine ball',
  'dumbbell',
  'body only',
  'bands',
  'kettlebells',
  'foam roll',
  'cable',
  'machine',
  'barbell',
  'exercise ball',
  'e-z curl bar',
  'other',
]);
const MUSCLE_VALUES = new Set([
  'abdominals',
  'abductors',
  'adductors',
  'biceps',
  'calves',
  'chest',
  'forearms',
  'glutes',
  'hamstrings',
  'lats',
  'lower back',
  'middle back',
  'neck',
  'quadriceps',
  'shoulders',
  'traps',
  'triceps',
]);
const CATEGORY_VALUES = new Set([
  'powerlifting',
  'strength',
  'stretching',
  'cardio',
  'olympic weightlifting',
  'strongman',
  'plyometrics',
]);
const DEFAULT_EXERCISES = loadSeedExercises();
const EXERCISE_LIBRARY = loadExerciseLibrary();
let automaticExportHandle = null;

app.use(express.json({ limit: '10mb' }));
app.use(
  session({
    secret: sessionSecret,
    store: new SqliteSessionStore(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: SESSION_MAX_AGE_MS,
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
  const shouldAutologin = shouldApplyDevAutologin(req, {
    enabled: devAutologinEnabled,
    allowRemote: devAutologinAllowRemote,
  });
  if (!shouldAutologin) {
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
      .map((item) => {
        const normalized = normalizeExercisePayload(
          item,
          { requirePrimary: false }
        ).exercise;

        return {
          name: normalized.name || item.name,
          primaryMuscles: normalized.primaryMuscles.length
            ? normalized.primaryMuscles
            : ['abdominals'],
          secondaryMuscles: normalized.secondaryMuscles,
          instructions: normalized.instructions,
          images: normalized.images,
          level: normalized.level || 'beginner',
          category: normalized.category || 'strength',
          force: normalized.force,
          mechanic: normalized.mechanic,
          equipment: normalized.equipment,
          forkId: normalized.forkId,
          notes: normalized.notes,
        };
      });
  } catch (error) {
    console.warn('Failed to load seed exercises.', error);
    return [];
  }
}

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function stringifyJsonArray(value) {
  return JSON.stringify(Array.isArray(value) ? value : []);
}

function normalizeEnum(value, allowed) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return null;
  return allowed.has(normalized) ? normalized : null;
}

function normalizeRoutineType(value, { fallback = null } = {}) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return fallback;
  return ROUTINE_TYPE_VALUES.has(normalized) ? normalized : null;
}

function normalizeRoutineTypeFilter(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return 'all';
  if (normalized === 'all') return 'all';
  if (ROUTINE_TYPE_VALUES.has(normalized)) return normalized;
  return 'all';
}

function normalizeStringArray(values, { allowed = null, maxLength = 50, lowercase = true } = {}) {
  const source = Array.isArray(values) ? values : [];
  const deduped = new Set();
  const result = [];
  source.forEach((item) => {
    const raw = normalizeText(item);
    if (!raw) return;
    const normalized = lowercase ? raw.toLowerCase() : raw;
    const allowedValue = lowercase ? normalized : raw.toLowerCase();
    if (allowed && !allowed.has(allowedValue)) return;
    if (deduped.has(normalized)) return;
    deduped.add(normalized);
    result.push(normalized.slice(0, maxLength));
  });
  return result;
}

function resolvePrimaryMuscles(body) {
  const primaryMuscles = normalizeStringArray(body?.primaryMuscles, {
    allowed: MUSCLE_VALUES,
  });
  if (primaryMuscles.length) return primaryMuscles;
  const singlePrimary = normalizeEnum(body?.primaryMuscle, MUSCLE_VALUES);
  if (singlePrimary) return [singlePrimary];
  return [];
}

function normalizeExercisePayload(body = {}, { requireName = true, requirePrimary = true } = {}) {
  const name = normalizeText(body.name);
  if (requireName && !name) {
    return { error: 'Exercise name is required.' };
  }
  const primaryMuscles = resolvePrimaryMuscles(body);
  if (requirePrimary && !primaryMuscles.length) {
    return { error: 'Primary muscle is required.' };
  }
  return {
    error: null,
    exercise: {
      name,
      forkId: normalizeText(body.forkId) || null,
      force: normalizeEnum(body.force, FORCE_VALUES),
      level: normalizeEnum(body.level, LEVEL_VALUES) || 'beginner',
      mechanic: normalizeEnum(body.mechanic, MECHANIC_VALUES),
      equipment: normalizeEnum(body.equipment, EQUIPMENT_VALUES),
      category: normalizeEnum(body.category, CATEGORY_VALUES) || 'strength',
      primaryMuscles,
      secondaryMuscles: normalizeStringArray(body.secondaryMuscles, {
        allowed: MUSCLE_VALUES,
      }),
      instructions: normalizeStringArray(body.instructions, {
        maxLength: 1000,
        lowercase: false,
      }),
      images: normalizeStringArray(body.images, {
        maxLength: 2048,
        lowercase: false,
      }),
      notes: normalizeText(body.notes) || null,
    },
  };
}

function firstPrimaryMuscle(value) {
  return parseJsonArray(value)[0] || null;
}

function exerciseRowToApi(row, lastSetByExercise = new Map()) {
  return {
    id: row.id,
    forkId: row.fork_id,
    name: row.name,
    force: row.force,
    level: row.level,
    mechanic: row.mechanic,
    equipment: row.equipment,
    primaryMuscles: parseJsonArray(row.primary_muscles_json),
    secondaryMuscles: parseJsonArray(row.secondary_muscles_json),
    instructions: parseJsonArray(row.instructions_json),
    category: row.category,
    images: parseJsonArray(row.images_json),
    notes: row.notes,
    mergedIntoId: row.merged_into_id,
    mergedIntoName: row.merged_into_name,
    mergedAt: row.merged_at,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSet: lastSetByExercise.get(row.id) || null,
  };
}

function getExerciseLibraryItemImageUrls(item) {
  return (item.images || []).map((relativePath) => `${EXERCISE_IMAGE_BASE_URL}${relativePath}`);
}

function loadExerciseLibrary() {
  try {
    const raw = fs.readFileSync(EXERCISE_LIBRARY_PATH, 'utf8');
    const payload = JSON.parse(raw);
    const exercises = Array.isArray(payload?.exercises)
      ? payload.exercises
      : Array.isArray(payload)
        ? payload
        : [];
    const byId = new Map();
    const byName = new Map();
    exercises.forEach((exercise) => {
      const id = normalizeText(exercise?.id);
      const name = normalizeText(exercise?.name).toLowerCase();
      if (!id || !name) return;
      byId.set(id, exercise);
      if (!byName.has(name)) {
        byName.set(name, exercise);
      }
    });
    return { exercises, byId, byName };
  } catch (error) {
    console.warn('Failed to load exercise library snapshot.', error);
    return { exercises: [], byId: new Map(), byName: new Map() };
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

function startOfUtcDay(value) {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUtcWeek(value) {
  const date = startOfUtcDay(value);
  const day = date.getUTCDay();
  const offset = (day + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date;
}

function startOfUtcMonth(value) {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addUtcWeeks(value, weeks = 1) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + weeks * 7);
  return date;
}

function addUtcMonths(value, months = 1) {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function getIsoWeekParts(value) {
  const date = startOfUtcDay(value);
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const isoYear = date.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const weekOneStart = startOfUtcWeek(jan4);
  const weekNumber = Math.floor((startOfUtcDay(value) - weekOneStart) / (7 * 24 * 60 * 60 * 1000)) + 1;
  return { year: isoYear, week: weekNumber };
}

function normalizeTimeseriesBucket(rawValue) {
  return normalizeText(rawValue).toLowerCase() === 'month' ? 'month' : 'week';
}

function resolveTimeseriesBucketStart(bucket, value) {
  return bucket === 'month' ? startOfUtcMonth(value) : startOfUtcWeek(value);
}

function incrementTimeseriesBucket(bucket, value) {
  return bucket === 'month' ? addUtcMonths(value, 1) : addUtcWeeks(value, 1);
}

function formatTimeseriesBucketKey(bucket, value) {
  if (bucket === 'month') {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }
  const { year, week } = getIsoWeekParts(value);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function formatTimeseriesBucketLabel(bucket, value) {
  if (bucket === 'month') {
    return value.toLocaleDateString('en-US', {
      month: 'short',
      year: '2-digit',
      timeZone: 'UTC',
    });
  }
  const { week } = getIsoWeekParts(value);
  return `W${String(week).padStart(2, '0')}`;
}

function toFixedNumber(value, digits = 1) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
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
      `SELECT e.id, e.fork_id, e.name, e.force, e.level, e.mechanic, e.equipment,
              e.primary_muscles_json, e.secondary_muscles_json, e.instructions_json, e.category, e.images_json,
              e.notes, e.merged_into_id, e.merged_at, e.archived_at, e.created_at, e.updated_at,
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

  const exercises = rows.map((row) => exerciseRowToApi(row, lastSetByExercise));

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
  const normalized = normalizeExercisePayload(req.body);
  if (normalized.error) {
    return res.status(400).json({ error: normalized.error });
  }
  const exercise = normalized.exercise;
  const now = nowIso();

  try {
    const result = db
      .prepare(
        `INSERT INTO exercises
         (fork_id, name, force, level, mechanic, equipment, primary_muscles_json, secondary_muscles_json, instructions_json, category, images_json, notes, merged_into_id, merged_at, archived_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        exercise.forkId,
        exercise.name,
        exercise.force,
        exercise.level,
        exercise.mechanic,
        exercise.equipment,
        stringifyJsonArray(exercise.primaryMuscles),
        stringifyJsonArray(exercise.secondaryMuscles),
        stringifyJsonArray(exercise.instructions),
        exercise.category,
        stringifyJsonArray(exercise.images),
        exercise.notes,
        null,
        null,
        null,
        now,
        now
      );
    const id = Number(result.lastInsertRowid);
    return res.json({
      exercise: exerciseRowToApi({
        id,
        fork_id: exercise.forkId,
        name: exercise.name,
        force: exercise.force,
        level: exercise.level,
        mechanic: exercise.mechanic,
        equipment: exercise.equipment,
        primary_muscles_json: stringifyJsonArray(exercise.primaryMuscles),
        secondary_muscles_json: stringifyJsonArray(exercise.secondaryMuscles),
        instructions_json: stringifyJsonArray(exercise.instructions),
        category: exercise.category,
        images_json: stringifyJsonArray(exercise.images),
        notes: exercise.notes,
        merged_into_id: null,
        merged_into_name: null,
        merged_at: null,
        archived_at: null,
        created_at: now,
        updated_at: now,
      }),
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
  const normalized = normalizeExercisePayload(req.body);
  if (normalized.error) {
    return res.status(400).json({ error: normalized.error });
  }
  const exercise = normalized.exercise;
  const now = nowIso();
  try {
    const result = db
      .prepare(
        `UPDATE exercises
         SET fork_id = ?, name = ?, force = ?, level = ?, mechanic = ?, equipment = ?,
             primary_muscles_json = ?, secondary_muscles_json = ?, instructions_json = ?,
             category = ?, images_json = ?, notes = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        exercise.forkId,
        exercise.name,
        exercise.force,
        exercise.level,
        exercise.mechanic,
        exercise.equipment,
        stringifyJsonArray(exercise.primaryMuscles),
        stringifyJsonArray(exercise.secondaryMuscles),
        stringifyJsonArray(exercise.instructions),
        exercise.category,
        stringifyJsonArray(exercise.images),
        exercise.notes,
        now,
        exerciseId
      );

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

app.get('/api/exercise-library', requireAuth, (req, res) => {
  const query = normalizeText(req.query.q).toLowerCase();
  const primaryMuscle = normalizeEnum(req.query.primaryMuscle, MUSCLE_VALUES);
  const category = normalizeEnum(req.query.category, CATEGORY_VALUES);
  const level = normalizeEnum(req.query.level, LEVEL_VALUES);
  const equipment = normalizeEnum(req.query.equipment, EQUIPMENT_VALUES);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const offset = Math.max(0, Number(req.query.offset) || 0);

  const filtered = EXERCISE_LIBRARY.exercises.filter((item) => {
    const name = normalizeText(item?.name).toLowerCase();
    if (query && !name.includes(query)) return false;
    if (primaryMuscle && !normalizeStringArray(item?.primaryMuscles, { allowed: MUSCLE_VALUES }).includes(primaryMuscle)) {
      return false;
    }
    if (category && normalizeEnum(item?.category, CATEGORY_VALUES) !== category) return false;
    if (level && normalizeEnum(item?.level, LEVEL_VALUES) !== level) return false;
    if (equipment && normalizeEnum(item?.equipment, EQUIPMENT_VALUES) !== equipment) return false;
    return true;
  });

  const page = filtered.slice(offset, offset + limit);
  const forkIds = page.map((item) => normalizeText(item.id)).filter(Boolean);
  const existingForkIds = new Set();
  if (forkIds.length) {
    const placeholders = forkIds.map(() => '?').join(',');
    db.prepare(
      `SELECT fork_id
       FROM exercises
       WHERE fork_id IN (${placeholders})`
    )
      .all(...forkIds)
      .forEach((row) => {
        existingForkIds.add(row.fork_id);
      });
  }

  return res.json({
    sourceProvider: EXERCISE_LIBRARY_PROVIDER,
    total: filtered.length,
    limit,
    offset,
    results: page.map((item) => ({
      forkId: item.id,
      name: item.name,
      force: item.force || null,
      level: item.level || null,
      mechanic: item.mechanic || null,
      equipment: item.equipment || null,
      primaryMuscles: normalizeStringArray(item.primaryMuscles, { allowed: MUSCLE_VALUES }),
      secondaryMuscles: normalizeStringArray(item.secondaryMuscles, { allowed: MUSCLE_VALUES }),
      instructions: normalizeStringArray(item.instructions, { maxLength: 1000, lowercase: false }),
      category: normalizeEnum(item.category, CATEGORY_VALUES),
      images: normalizeStringArray(item.images, { maxLength: 2048, lowercase: false }),
      imageUrls: getExerciseLibraryItemImageUrls(item),
      alreadyAdded: existingForkIds.has(item.id),
    })),
  });
});

app.post('/api/exercise-library/:forkId/add', requireAuth, (req, res) => {
  const forkId = normalizeText(req.params.forkId);
  if (!forkId) {
    return res.status(400).json({ error: 'Invalid fork exercise id.' });
  }
  const libraryItem = EXERCISE_LIBRARY.byId.get(forkId);
  if (!libraryItem) {
    return res.status(404).json({ error: 'Library exercise not found.' });
  }

  const existingByForkId = db
    .prepare(
      `SELECT id, fork_id, name, force, level, mechanic, equipment, primary_muscles_json, secondary_muscles_json, instructions_json, category, images_json,
              notes, merged_into_id, merged_at, archived_at, created_at, updated_at
       FROM exercises
       WHERE fork_id = ?`
    )
    .get(forkId);
  if (existingByForkId) {
    return res.json({ exercise: exerciseRowToApi(existingByForkId), existing: true });
  }

  const now = nowIso();
  const normalized = normalizeExercisePayload(
    {
      forkId: libraryItem.id,
      name: libraryItem.name,
      force: libraryItem.force,
      level: libraryItem.level,
      mechanic: libraryItem.mechanic,
      equipment: libraryItem.equipment,
      primaryMuscles: libraryItem.primaryMuscles,
      secondaryMuscles: libraryItem.secondaryMuscles,
      instructions: libraryItem.instructions,
      category: libraryItem.category,
      images: libraryItem.images,
      notes: '',
    },
    { requirePrimary: false }
  );
  const exercise = normalized.exercise;
  if (!exercise.primaryMuscles.length) {
    exercise.primaryMuscles = ['abdominals'];
  }

  const existingByName = db
    .prepare(
      `SELECT id, fork_id, force, level, mechanic, equipment, primary_muscles_json, secondary_muscles_json, instructions_json, category, images_json
       FROM exercises
       WHERE lower(name) = lower(?)
       LIMIT 1`
    )
    .get(exercise.name);
  if (existingByName?.id) {
    const nextPrimaryMuscles =
      parseJsonArray(existingByName.primary_muscles_json).length > 0
        ? existingByName.primary_muscles_json
        : stringifyJsonArray(exercise.primaryMuscles);
    const nextSecondaryMuscles =
      parseJsonArray(existingByName.secondary_muscles_json).length > 0
        ? existingByName.secondary_muscles_json
        : stringifyJsonArray(exercise.secondaryMuscles);
    const nextInstructions =
      parseJsonArray(existingByName.instructions_json).length > 0
        ? existingByName.instructions_json
        : stringifyJsonArray(exercise.instructions);
    const nextImages =
      parseJsonArray(existingByName.images_json).length > 0
        ? existingByName.images_json
        : stringifyJsonArray(exercise.images);

    db.prepare(
      `UPDATE exercises
       SET fork_id = ?,
           force = ?,
           level = ?,
           mechanic = ?,
           equipment = ?,
           primary_muscles_json = ?,
           secondary_muscles_json = ?,
           instructions_json = ?,
           category = ?,
           images_json = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(
      existingByName.fork_id || exercise.forkId,
      existingByName.force || exercise.force,
      existingByName.level || exercise.level,
      existingByName.mechanic || exercise.mechanic,
      existingByName.equipment || exercise.equipment,
      nextPrimaryMuscles,
      nextSecondaryMuscles,
      nextInstructions,
      existingByName.category || exercise.category,
      nextImages,
      now,
      existingByName.id
    );

    const updated = db
      .prepare(
        `SELECT id, fork_id, name, force, level, mechanic, equipment, primary_muscles_json, secondary_muscles_json, instructions_json, category, images_json,
                notes, merged_into_id, merged_at, archived_at, created_at, updated_at
         FROM exercises
         WHERE id = ?`
      )
      .get(existingByName.id);
    return res.json({ exercise: exerciseRowToApi(updated), existing: true });
  }

  const result = db
    .prepare(
      `INSERT INTO exercises
       (fork_id, name, force, level, mechanic, equipment, primary_muscles_json, secondary_muscles_json, instructions_json, category, images_json, notes, merged_into_id, merged_at, archived_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      exercise.forkId,
      exercise.name,
      exercise.force,
      exercise.level,
      exercise.mechanic,
      exercise.equipment,
      stringifyJsonArray(exercise.primaryMuscles),
      stringifyJsonArray(exercise.secondaryMuscles),
      stringifyJsonArray(exercise.instructions),
      exercise.category,
      stringifyJsonArray(exercise.images),
      null,
      null,
      null,
      null,
      now,
      now
    );

  return res.json({
    exercise: exerciseRowToApi({
      id: Number(result.lastInsertRowid),
      fork_id: exercise.forkId,
      name: exercise.name,
      force: exercise.force,
      level: exercise.level,
      mechanic: exercise.mechanic,
      equipment: exercise.equipment,
      primary_muscles_json: stringifyJsonArray(exercise.primaryMuscles),
      secondary_muscles_json: stringifyJsonArray(exercise.secondaryMuscles),
      instructions_json: stringifyJsonArray(exercise.instructions),
      category: exercise.category,
      images_json: stringifyJsonArray(exercise.images),
      notes: null,
      merged_into_id: null,
      merged_into_name: null,
      merged_at: null,
      archived_at: null,
      created_at: now,
      updated_at: now,
    }),
    existing: false,
  });
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
    .prepare(
      `SELECT id, fork_id, force, level, mechanic, equipment, primary_muscles_json, secondary_muscles_json, instructions_json, category, images_json,
              archived_at, merged_into_id
       FROM exercises
       WHERE id = ?`
    )
    .get(sourceId);
  const target = db
    .prepare(
      `SELECT id, fork_id, force, level, mechanic, equipment, primary_muscles_json, secondary_muscles_json, instructions_json, category, images_json,
              archived_at, merged_into_id
       FROM exercises
       WHERE id = ?`
    )
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
  const sourcePrimary = parseJsonArray(source.primary_muscles_json);
  const sourceSecondary = parseJsonArray(source.secondary_muscles_json);
  const sourceInstructions = parseJsonArray(source.instructions_json);
  const sourceImages = parseJsonArray(source.images_json);
  const targetPrimary = parseJsonArray(target.primary_muscles_json);
  const targetSecondary = parseJsonArray(target.secondary_muscles_json);
  const targetInstructions = parseJsonArray(target.instructions_json);
  const targetImages = parseJsonArray(target.images_json);
  const shouldTransferForkId = !target.fork_id && !!source.fork_id;

  db.exec('BEGIN IMMEDIATE;');
  try {
    if (shouldTransferForkId) {
      const releasedForkId = db
        .prepare(
          `UPDATE exercises
           SET fork_id = NULL, updated_at = ?
           WHERE id = ? AND archived_at IS NULL AND merged_into_id IS NULL`
        )
        .run(now, sourceId);
      if (releasedForkId.changes === 0) {
        db.exec('ROLLBACK;');
        return res.status(409).json({ error: 'Source exercise changed before merge could complete.' });
      }
    }
    movedRoutineLinks = db
      .prepare('UPDATE routine_exercises SET exercise_id = ? WHERE exercise_id = ?')
      .run(targetId, sourceId).changes;
    movedSetLinks = db
      .prepare('UPDATE session_sets SET exercise_id = ? WHERE exercise_id = ?')
      .run(targetId, sourceId).changes;
    db.prepare(
      `UPDATE exercises
       SET fork_id = ?, force = ?, level = ?, mechanic = ?, equipment = ?,
           primary_muscles_json = ?, secondary_muscles_json = ?, instructions_json = ?,
           category = ?, images_json = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      shouldTransferForkId ? source.fork_id : target.fork_id,
      target.force || source.force || null,
      target.level || source.level || 'beginner',
      target.mechanic || source.mechanic || null,
      target.equipment || source.equipment || null,
      stringifyJsonArray(targetPrimary.length ? targetPrimary : sourcePrimary),
      stringifyJsonArray(targetSecondary.length ? targetSecondary : sourceSecondary),
      stringifyJsonArray(targetInstructions.length ? targetInstructions : sourceInstructions),
      target.category || source.category || 'strength',
      stringifyJsonArray(targetImages.length ? targetImages : sourceImages),
      now,
      targetId
    );
    const archived = db
      .prepare(
        `UPDATE exercises
         SET fork_id = CASE WHEN ? THEN NULL ELSE fork_id END,
             merged_into_id = ?, merged_at = ?, archived_at = ?, updated_at = ?
         WHERE id = ? AND archived_at IS NULL AND merged_into_id IS NULL`
      )
      .run(shouldTransferForkId ? 1 : 0, targetId, now, now, now, sourceId);
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
      `SELECT id, name, notes, routine_type, created_at, updated_at
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
  const lastUsedRows = db
    .prepare(
      `SELECT s.routine_id, MAX(s.started_at) AS last_used_at
       FROM sessions s
       WHERE s.user_id = ? AND s.routine_id IN (${placeholders})
         AND EXISTS (
           SELECT 1
           FROM session_sets ss
           WHERE ss.session_id = s.id
         )
       GROUP BY s.routine_id`
    )
    .all(userId, ...routineIds);
  const lastUsedByRoutine = new Map(
    lastUsedRows.map((row) => [row.routine_id, row.last_used_at || null])
  );
  const exerciseRows = db
    .prepare(
      `SELECT re.id, re.routine_id, re.exercise_id, re.position,
              re.target_sets, re.target_reps, re.target_reps_range, re.target_rest_seconds, re.target_weight, re.target_band_label, re.notes, re.equipment, re.superset_group,
              e.name AS exercise_name, e.primary_muscles_json
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
      primaryMuscles: parseJsonArray(row.primary_muscles_json),
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
    routineType: normalizeRoutineType(routine.routine_type, { fallback: 'standard' }),
    createdAt: routine.created_at,
    updatedAt: routine.updated_at,
    lastUsedAt: lastUsedByRoutine.get(routine.id) || null,
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
  const routineType = normalizeRoutineType(req.body?.routineType, { fallback: 'standard' });
  if (!routineType) {
    return res.status(400).json({ error: 'Routine type must be "standard" or "rehab".' });
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
      `INSERT INTO routines (user_id, name, notes, routine_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(req.session.userId, name, notes, routineType, now, now);
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
  const existingRoutine = db
    .prepare('SELECT id, routine_type FROM routines WHERE id = ? AND user_id = ?')
    .get(routineId, req.session.userId);
  if (!existingRoutine) {
    return res.status(404).json({ error: 'Routine not found.' });
  }
  const hasRoutineTypeInput = Object.prototype.hasOwnProperty.call(req.body || {}, 'routineType');
  const routineType = normalizeRoutineType(
    hasRoutineTypeInput ? req.body?.routineType : existingRoutine.routine_type,
    { fallback: 'standard' }
  );
  if (!routineType) {
    return res.status(400).json({ error: 'Routine type must be "standard" or "rehab".' });
  }
  const now = nowIso();

  const result = db
    .prepare(
      `UPDATE routines
       SET name = ?, notes = ?, routine_type = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`
    )
    .run(name, notes, routineType, now, routineId, req.session.userId);

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
    .prepare('SELECT id, name, notes, routine_type FROM routines WHERE id = ? AND user_id = ?')
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
      `INSERT INTO routines (user_id, name, notes, routine_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.session.userId,
      duplicateName,
      sourceRoutine.notes || null,
      normalizeRoutineType(sourceRoutine.routine_type, { fallback: 'standard' }),
      now,
      now
    );
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
      `SELECT s.id, s.routine_id, s.routine_type, s.name, s.started_at, s.ended_at, s.notes,
              s.warmup_started_at, s.warmup_completed_at,
              r.name AS routine_name,
              r.notes AS routine_notes
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
  throw new Error('Exercise not found in workout.');
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
    throw new Error('Workout not found.');
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
    throw new Error('Workout not found.');
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

  const toSessionExerciseMetadata = (row = {}) => ({
    force: row.force || null,
    level: row.level || null,
    mechanic: row.mechanic || null,
    category: row.category || null,
    primaryMuscles: parseJsonArray(row.primary_muscles_json),
    secondaryMuscles: parseJsonArray(row.secondary_muscles_json),
    instructions: parseJsonArray(row.instructions_json),
    images: parseJsonArray(row.images_json),
  });

  const routineRows = session.routine_id
    ? db
        .prepare(
      `SELECT re.exercise_id, re.position, re.equipment, re.target_sets, re.target_reps, re.target_reps_range,
                  re.target_rest_seconds, re.target_weight, re.target_band_label, re.superset_group, e.name AS exercise_name,
                  e.force, e.level, e.mechanic, e.category,
                  e.primary_muscles_json, e.secondary_muscles_json, e.instructions_json, e.images_json
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
              e.name AS exercise_name, e.force, e.level, e.mechanic, e.category,
              e.primary_muscles_json, e.secondary_muscles_json, e.instructions_json, e.images_json
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
      ...toSessionExerciseMetadata(row),
      sets: [],
    });
  });

  progressRows.forEach((row) => {
    const existing = exercisesById.get(row.exercise_id);
    if (!existing) {
      const exerciseRow = db
        .prepare(
          `SELECT name, force, level, mechanic, category,
                  primary_muscles_json, secondary_muscles_json, instructions_json, images_json
           FROM exercises
           WHERE id = ?`
        )
        .get(row.exercise_id);
      exercisesById.set(row.exercise_id, {
        exerciseId: row.exercise_id,
        name: exerciseRow?.name || 'Exercise',
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
        ...toSessionExerciseMetadata(exerciseRow),
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
        ...toSessionExerciseMetadata(row),
        sets: [],
      });
    }
    const targetExercise = exercisesById.get(row.exercise_id);
    if (!targetExercise.force && row.force) targetExercise.force = row.force;
    if (!targetExercise.level && row.level) targetExercise.level = row.level;
    if (!targetExercise.mechanic && row.mechanic) targetExercise.mechanic = row.mechanic;
    if (!targetExercise.category && row.category) targetExercise.category = row.category;
    if (!targetExercise.primaryMuscles?.length) {
      targetExercise.primaryMuscles = parseJsonArray(row.primary_muscles_json);
    }
    if (!targetExercise.secondaryMuscles?.length) {
      targetExercise.secondaryMuscles = parseJsonArray(row.secondary_muscles_json);
    }
    if (!targetExercise.instructions?.length) {
      targetExercise.instructions = parseJsonArray(row.instructions_json);
    }
    if (!targetExercise.images?.length) {
      targetExercise.images = parseJsonArray(row.images_json);
    }
    targetExercise.sets.push({
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
    routineType: normalizeRoutineType(session.routine_type, { fallback: 'standard' }),
    routineName: session.routine_name,
    routineNotes: session.routine_notes,
    name: session.name,
    startedAt: session.started_at,
    endedAt: session.ended_at,
    warmupStartedAt: session.warmup_started_at || null,
    warmupCompletedAt: session.warmup_completed_at || null,
    warmupDurationSeconds: calculateDurationSeconds(session.warmup_started_at, session.warmup_completed_at),
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
  const hasWarmupStartedAt = Object.prototype.hasOwnProperty.call(body, 'warmupStartedAt');
  const hasWarmupCompletedAt = Object.prototype.hasOwnProperty.call(body, 'warmupCompletedAt');
  if (!hasName && !hasNotes && !hasEndedAt && !hasWarmupStartedAt && !hasWarmupCompletedAt) {
    throw new Error('No session fields provided.');
  }

  const name = hasName ? normalizeText(body.name) || null : null;
  const notes = hasNotes ? normalizeText(body.notes) || null : null;
  const endedAt = hasEndedAt ? normalizeText(body.endedAt) || null : null;
  const warmupStartedAt = hasWarmupStartedAt ? normalizeText(body.warmupStartedAt) || null : null;
  const warmupCompletedAt = hasWarmupCompletedAt ? normalizeText(body.warmupCompletedAt) || null : null;

  if (hasEndedAt && endedAt) {
    const setCount = Number(
      db.prepare('SELECT COUNT(*) AS count FROM session_sets WHERE session_id = ?').get(sessionId)?.count || 0
    );
    if (setCount === 0) {
      const deleteResult = db
        .prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?')
        .run(sessionId, userId);
      if (deleteResult.changes === 0) {
        throw new Error('Workout not found.');
      }
      return null;
    }
  }

  const result = db
    .prepare(
      `UPDATE sessions
       SET name = CASE WHEN ? THEN ? ELSE name END,
           notes = CASE WHEN ? THEN ? ELSE notes END,
           ended_at = CASE WHEN ? THEN ? ELSE ended_at END,
           warmup_started_at = CASE WHEN ? THEN ? ELSE warmup_started_at END,
           warmup_completed_at = CASE WHEN ? THEN ? ELSE warmup_completed_at END
       WHERE id = ? AND user_id = ?`
    )
    .run(
      hasName ? 1 : 0,
      name,
      hasNotes ? 1 : 0,
      notes,
      hasEndedAt ? 1 : 0,
      endedAt,
      hasWarmupStartedAt ? 1 : 0,
      warmupStartedAt,
      hasWarmupCompletedAt ? 1 : 0,
      warmupCompletedAt,
      sessionId,
      userId
    );
  if (result.changes === 0) {
    throw new Error('Workout not found.');
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
    throw new Error('Workout not found.');
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
              s.routine_type,
              r.name AS routine_name,
              r.notes AS routine_notes,
              COUNT(ss.id) AS total_sets,
              COALESCE(SUM(ss.reps), 0) AS total_reps,
              COALESCE(SUM(ss.reps * ss.weight), 0) AS total_volume
       FROM sessions s
       LEFT JOIN routines r ON r.id = s.routine_id
       LEFT JOIN session_sets ss ON ss.session_id = s.id
       WHERE s.user_id = ?
       GROUP BY s.id
       HAVING COUNT(ss.id) > 0
       ORDER BY s.started_at DESC
       LIMIT ?`
    )
    .all(req.session.userId, limit);

  const sessions = rows.map((row) => ({
    id: row.id,
    routineId: row.routine_id,
    routineType: normalizeRoutineType(row.routine_type, { fallback: 'standard' }),
    routineName: row.routine_name,
    routineNotes: row.routine_notes,
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
    return res.status(400).json({ error: 'Invalid workout id.' });
  }
  const detail = getSessionDetail(sessionId, req.session.userId);
  if (!detail) {
    return res.status(404).json({ error: 'Workout not found.' });
  }
  return res.json({ session: detail });
});

app.post('/api/sessions', requireAuth, (req, res) => {
  const routineId = normalizeNumber(req.body?.routineId);
  if (!routineId || !Number.isInteger(routineId)) {
    return res.status(400).json({ error: 'Routine is required.' });
  }
  const routine = db
    .prepare('SELECT id, routine_type FROM routines WHERE id = ? AND user_id = ?')
    .get(routineId, req.session.userId);
  if (!routine) {
    return res.status(404).json({ error: 'Routine not found.' });
  }
  const name = normalizeText(req.body?.name) || null;
  const startedAt = normalizeText(req.body?.startedAt) || nowIso();
  const result = db
    .prepare(
      `INSERT INTO sessions (user_id, routine_id, routine_type, name, started_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      req.session.userId,
      routineId,
      normalizeRoutineType(routine.routine_type, { fallback: 'standard' }),
      name,
      startedAt
    );

  const sessionId = Number(result.lastInsertRowid);
  seedSessionExerciseProgress(sessionId, routineId);
  const detail = getSessionDetail(sessionId, req.session.userId);
  return res.json({ session: detail });
});

app.put('/api/sessions/:id', requireAuth, (req, res) => {
  const sessionId = Number(req.params.id);
  if (!sessionId) {
    return res.status(400).json({ error: 'Invalid workout id.' });
  }
  try {
    const detail = updateSessionForUser(req.session.userId, sessionId, req.body || {});
    if (!detail) {
      return res.json({ session: null, discarded: true });
    }
    return res.json({ session: detail });
  } catch (error) {
    const status = error.message === 'Workout not found.' ? 404 : 400;
    return res.status(status).json({ error: error.message });
  }
});

app.delete('/api/sessions/:id', requireAuth, (req, res) => {
  const sessionId = Number(req.params.id);
  if (!sessionId) {
    return res.status(400).json({ error: 'Invalid workout id.' });
  }
  const result = db
    .prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?')
    .run(sessionId, req.session.userId);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Workout not found.' });
  }
  return res.json({ ok: true });
});

app.post('/api/sessions/:id/exercises/:exerciseId/start', requireAuth, (req, res) => {
  const sessionId = Number(req.params.id);
  const exerciseId = Number(req.params.exerciseId);
  if (!sessionId || !exerciseId) {
    return res.status(400).json({ error: 'Invalid workout or exercise id.' });
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
      'Workout not found.',
      'Exercise not found.',
      'Exercise not found in workout.',
    ]);
    return res.status(notFoundErrors.has(error.message) ? 404 : 400).json({ error: error.message });
  }
});

app.post('/api/sessions/:id/exercises/:exerciseId/complete', requireAuth, (req, res) => {
  const sessionId = Number(req.params.id);
  const exerciseId = Number(req.params.exerciseId);
  if (!sessionId || !exerciseId) {
    return res.status(400).json({ error: 'Invalid workout or exercise id.' });
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
      'Workout not found.',
      'Exercise not found.',
      'Exercise not found in workout.',
    ]);
    return res.status(notFoundErrors.has(error.message) ? 404 : 400).json({ error: error.message });
  }
});

app.post('/api/sessions/:id/sets', requireAuth, (req, res) => {
  const sessionId = Number(req.params.id);
  if (!sessionId) {
    return res.status(400).json({ error: 'Invalid workout id.' });
  }
  try {
    const result = createSetForSession(req.session.userId, sessionId, req.body || {});
    return res.json(result);
  } catch (error) {
    const status =
      error.message === 'Workout not found.'
      || error.message === 'Exercise not found.'
      || error.message === 'Exercise not found in workout.'
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
  const ninetyAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const setTimestampSql = "COALESCE(ss.completed_at, ss.created_at, s.started_at)";
  const routineTypeFilter = normalizeRoutineTypeFilter(req.query.routineType);
  const routineFilterSql = routineTypeFilter === 'all' ? '' : ' AND routine_type = ?';
  const routineFilterParams = routineTypeFilter === 'all' ? [] : [routineTypeFilter];
  const setRoutineFilterSql = routineTypeFilter === 'all' ? '' : ' AND s.routine_type = ?';
  const setRoutineFilterParams = routineTypeFilter === 'all' ? [] : [routineTypeFilter];

  const totalSessions = db
    .prepare(`SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?${routineFilterSql}`)
    .get(userId, ...routineFilterParams)?.count;
  const warmupWeekMinutes = db
    .prepare(
      `SELECT COALESCE(
          SUM(
            CASE
              WHEN warmup_started_at IS NOT NULL AND warmup_completed_at IS NOT NULL
                THEN MAX(0, (julianday(warmup_completed_at) - julianday(warmup_started_at)) * 24 * 60)
              ELSE 0
            END
          ),
          0
        ) AS minutes
       FROM sessions
       WHERE user_id = ? AND started_at >= ?${routineFilterSql}`
    )
    .get(userId, weekAgo, ...routineFilterParams)?.minutes;
  const totalSets = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM session_sets ss
       JOIN sessions s ON s.id = ss.session_id
       WHERE s.user_id = ?${setRoutineFilterSql}`
    )
    .get(userId, ...setRoutineFilterParams)?.count;
  const setsWeek = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM session_sets ss
       JOIN sessions s ON s.id = ss.session_id
       WHERE s.user_id = ? AND ${setTimestampSql} >= ?${setRoutineFilterSql}`
    )
    .get(userId, weekAgo, ...setRoutineFilterParams)?.count;
  const setsMonth = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM session_sets ss
       JOIN sessions s ON s.id = ss.session_id
       WHERE s.user_id = ? AND ${setTimestampSql} >= ?${setRoutineFilterSql}`
    )
    .get(userId, monthAgo, ...setRoutineFilterParams)?.count;
  const volumeWeek = db
    .prepare(
      `SELECT COALESCE(SUM(ss.reps * ss.weight), 0) AS volume
       FROM session_sets ss
       JOIN sessions s ON s.id = ss.session_id
       WHERE s.user_id = ? AND ${setTimestampSql} >= ?${setRoutineFilterSql}`
    )
    .get(userId, weekAgo, ...setRoutineFilterParams)?.volume;
  const volumeMonth = db
    .prepare(
      `SELECT COALESCE(SUM(ss.reps * ss.weight), 0) AS volume
       FROM session_sets ss
       JOIN sessions s ON s.id = ss.session_id
       WHERE s.user_id = ? AND ${setTimestampSql} >= ?${setRoutineFilterSql}`
    )
    .get(userId, monthAgo, ...setRoutineFilterParams)?.volume;
  const sessionsWeek = db
    .prepare(
      `SELECT COUNT(DISTINCT s.id) AS count
       FROM session_sets ss
       JOIN sessions s ON s.id = ss.session_id
       WHERE s.user_id = ? AND ${setTimestampSql} >= ?${setRoutineFilterSql}`
    )
    .get(userId, weekAgo, ...setRoutineFilterParams)?.count;
  const sessionsMonth = db
    .prepare(
      `SELECT COUNT(DISTINCT s.id) AS count
       FROM session_sets ss
       JOIN sessions s ON s.id = ss.session_id
       WHERE s.user_id = ? AND ${setTimestampSql} >= ?${setRoutineFilterSql}`
    )
    .get(userId, monthAgo, ...setRoutineFilterParams)?.count;
  const uniqueExercisesWeek = db
    .prepare(
      `SELECT COUNT(DISTINCT ss.exercise_id) AS count
       FROM session_sets ss
       JOIN sessions s ON s.id = ss.session_id
       WHERE s.user_id = ? AND ${setTimestampSql} >= ?${setRoutineFilterSql}`
    )
    .get(userId, weekAgo, ...setRoutineFilterParams)?.count;
  const uniqueExercisesMonth = db
    .prepare(
      `SELECT COUNT(DISTINCT ss.exercise_id) AS count
       FROM session_sets ss
       JOIN sessions s ON s.id = ss.session_id
       WHERE s.user_id = ? AND ${setTimestampSql} >= ?${setRoutineFilterSql}`
    )
    .get(userId, monthAgo, ...setRoutineFilterParams)?.count;
  const avgSetWeightWeek = db
    .prepare(
      `SELECT COALESCE(AVG(ss.weight), 0) AS average
       FROM session_sets ss
       JOIN sessions s ON s.id = ss.session_id
       WHERE s.user_id = ? AND ${setTimestampSql} >= ?${setRoutineFilterSql}`
    )
    .get(userId, weekAgo, ...setRoutineFilterParams)?.average;
  const avgSetWeightMonth = db
    .prepare(
      `SELECT COALESCE(AVG(ss.weight), 0) AS average
       FROM session_sets ss
       JOIN sessions s ON s.id = ss.session_id
       WHERE s.user_id = ? AND ${setTimestampSql} >= ?${setRoutineFilterSql}`
    )
    .get(userId, monthAgo, ...setRoutineFilterParams)?.average;
  const sessionsNinety = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM sessions
       WHERE user_id = ? AND started_at >= ?${routineFilterSql}`
    )
    .get(userId, ninetyAgo, ...routineFilterParams)?.count;
  const timeSpentWeekMinutes = db
    .prepare(
      `SELECT COALESCE(
          SUM(
            CASE
              WHEN started_at IS NOT NULL AND ended_at IS NOT NULL
                THEN MAX(0, (julianday(ended_at) - julianday(started_at)) * 24 * 60)
              ELSE 0
            END
          ),
          0
        ) AS minutes
       FROM sessions
       WHERE user_id = ? AND started_at >= ?${routineFilterSql}`
    )
    .get(userId, weekAgo, ...routineFilterParams)?.minutes;
  const avgSessionTimeMinutes = db
    .prepare(
      `SELECT COALESCE(
          AVG(
            CASE
              WHEN started_at IS NOT NULL AND ended_at IS NOT NULL
                THEN MAX(0, (julianday(ended_at) - julianday(started_at)) * 24 * 60)
              ELSE NULL
            END
          ),
          0
        ) AS minutes
       FROM sessions
       WHERE user_id = ? AND started_at >= ?${routineFilterSql}`
    )
    .get(userId, monthAgo, ...routineFilterParams)?.minutes;
  const lastSession = db
    .prepare(
      `SELECT started_at FROM sessions
       WHERE user_id = ?${routineFilterSql}
       ORDER BY started_at DESC
       LIMIT 1`
    )
    .get(userId, ...routineFilterParams)?.started_at;

  const prRows = db
    .prepare(
      `SELECT ss.exercise_id, MAX(ss.weight) AS max_weight, MAX(ss.reps) AS max_reps, e.name
       FROM session_sets ss
       JOIN sessions s ON s.id = ss.session_id
       JOIN exercises e ON e.id = ss.exercise_id
       WHERE s.user_id = ?${setRoutineFilterSql}
       GROUP BY ss.exercise_id
       ORDER BY max_weight DESC
       LIMIT 8`
    )
    .all(userId, ...setRoutineFilterParams);

  const weeklyVolume = db
    .prepare(
      `SELECT strftime('%Y-W%W', ${setTimestampSql}) AS week,
              SUM(ss.reps * ss.weight) AS volume
       FROM session_sets ss
       JOIN sessions s ON s.id = ss.session_id
       WHERE s.user_id = ?${setRoutineFilterSql}
       GROUP BY week
       ORDER BY week DESC
       LIMIT 12`
    )
    .all(userId, ...setRoutineFilterParams)
    .map((row) => ({ week: row.week, volume: row.volume }));
  const weeklySets = db
    .prepare(
      `SELECT strftime('%Y-W%W', ${setTimestampSql}) AS week,
              COUNT(*) AS set_count
       FROM session_sets ss
       JOIN sessions s ON s.id = ss.session_id
       WHERE s.user_id = ?${setRoutineFilterSql}
       GROUP BY week
       ORDER BY week DESC
       LIMIT 12`
    )
    .all(userId, ...setRoutineFilterParams)
    .map((row) => ({ week: row.week, sets: Number(row.set_count || 0) }));

  const summary = {
    totalSessions: Number(totalSessions || 0),
    totalSets: Number(totalSets || 0),
    setsWeek: Number(setsWeek || 0),
    setsMonth: Number(setsMonth || 0),
    volumeWeek: Number(volumeWeek || 0),
    volumeMonth: Number(volumeMonth || 0),
    sessionsWeek: Number(sessionsWeek || 0),
    sessionsMonth: Number(sessionsMonth || 0),
    uniqueExercisesWeek: Number(uniqueExercisesWeek || 0),
    uniqueExercisesMonth: Number(uniqueExercisesMonth || 0),
    avgSetWeightWeek: toFixedNumber(Number(avgSetWeightWeek || 0)),
    avgSetWeightMonth: toFixedNumber(Number(avgSetWeightMonth || 0)),
    avgSessionsPerWeek: toFixedNumber((Number(sessionsNinety || 0) * 7) / 90),
    timeSpentWeekMinutes: toFixedNumber(Number(timeSpentWeekMinutes || 0)),
    warmupWeekMinutes: toFixedNumber(Number(warmupWeekMinutes || 0)),
    avgSessionTimeMinutes: toFixedNumber(Number(avgSessionTimeMinutes || 0)),
    lastSessionAt: lastSession || null,
  };

  const topExercises = prRows.map((row) => ({
    exerciseId: row.exercise_id,
    name: row.name,
    maxWeight: row.max_weight,
    maxReps: row.max_reps,
  }));

  res.json({ routineType: routineTypeFilter, summary, topExercises, weeklyVolume, weeklySets });
});

app.get('/api/stats/timeseries', requireAuth, (req, res) => {
  const bucket = normalizeTimeseriesBucket(req.query.bucket);
  const windowDays = parseWindowDays(req.query.window, WINDOW_PATTERNS.timeseries);
  const routineTypeFilter = normalizeRoutineTypeFilter(req.query.routineType);
  const now = new Date();
  const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const sinceIso = since.toISOString();
  const setTimestampSql = "COALESCE(ss.completed_at, ss.created_at, s.started_at)";
  const setRoutineFilterSql = routineTypeFilter === 'all' ? '' : ' AND s.routine_type = ?';
  const setRoutineFilterParams = routineTypeFilter === 'all' ? [] : [routineTypeFilter];

  const rows = db
    .prepare(
      `SELECT ss.exercise_id, ss.reps, ss.weight, ss.session_id,
              ${setTimestampSql} AS set_timestamp
       FROM session_sets ss
       JOIN sessions s ON s.id = ss.session_id
       WHERE s.user_id = ? AND ${setTimestampSql} >= ?${setRoutineFilterSql}
       ORDER BY set_timestamp ASC`
    )
    .all(req.session.userId, sinceIso, ...setRoutineFilterParams);

  const firstBucketStart = resolveTimeseriesBucketStart(bucket, since);
  const lastBucketStart = resolveTimeseriesBucketStart(bucket, now);
  const bucketMap = new Map();

  for (
    let cursor = firstBucketStart;
    cursor <= lastBucketStart;
    cursor = incrementTimeseriesBucket(bucket, cursor)
  ) {
    const startAt = new Date(cursor);
    const bucketKey = formatTimeseriesBucketKey(bucket, startAt);
    bucketMap.set(bucketKey, {
      bucketKey,
      label: formatTimeseriesBucketLabel(bucket, startAt),
      startAt: startAt.toISOString(),
      sets: 0,
      volume: 0,
      sessionIds: new Set(),
      exerciseIds: new Set(),
      weightSum: 0,
      weightCount: 0,
    });
  }

  rows.forEach((row) => {
    const timestamp = row.set_timestamp ? new Date(row.set_timestamp) : null;
    if (!timestamp || Number.isNaN(timestamp.getTime())) {
      return;
    }
    const bucketStart = resolveTimeseriesBucketStart(bucket, timestamp);
    const bucketKey = formatTimeseriesBucketKey(bucket, bucketStart);
    const target = bucketMap.get(bucketKey);
    if (!target) return;

    const reps = Number(row.reps || 0);
    const weight = Number(row.weight || 0);
    target.sets += 1;
    target.volume += reps * weight;
    target.sessionIds.add(row.session_id);
    target.exerciseIds.add(row.exercise_id);
    if (Number.isFinite(weight)) {
      target.weightSum += weight;
      target.weightCount += 1;
    }
  });

  const points = Array.from(bucketMap.values()).map((row) => ({
    bucketKey: row.bucketKey,
    label: row.label,
    startAt: row.startAt,
    sets: Number(row.sets || 0),
    volume: Number(row.volume || 0),
    sessions: row.sessionIds.size,
    uniqueExercises: row.exerciseIds.size,
    avgSetWeight: row.weightCount ? toFixedNumber(row.weightSum / row.weightCount) : 0,
  }));

  const summarySessionIds = new Set();
  points.forEach((point) => {
    const row = bucketMap.get(point.bucketKey);
    if (!row) return;
    row.sessionIds.forEach((sessionId) => summarySessionIds.add(sessionId));
  });

  const totalSets = points.reduce((sum, point) => sum + point.sets, 0);
  const totalVolume = points.reduce((sum, point) => sum + point.volume, 0);

  return res.json({
    bucket,
    windowDays,
    routineType: routineTypeFilter,
    points,
    summary: {
      totalSets,
      totalVolume,
      totalSessions: summarySessionIds.size,
      avgSetsPerBucket: points.length ? toFixedNumber(totalSets / points.length) : 0,
    },
  });
});

app.get('/api/stats/progression', requireAuth, (req, res) => {
  const exerciseId = Number(req.query.exerciseId);
  if (!exerciseId) {
    return res.status(400).json({ error: 'exerciseId is required.' });
  }
  const windowDays = parseWindowDays(req.query.window, WINDOW_PATTERNS.medium);
  const routineTypeFilter = normalizeRoutineTypeFilter(req.query.routineType);
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const sessionRoutineFilterSql = routineTypeFilter === 'all' ? '' : ' AND s.routine_type = ?';
  const sessionRoutineFilterParams = routineTypeFilter === 'all' ? [] : [routineTypeFilter];

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
       WHERE s.user_id = ? AND ss.exercise_id = ? AND s.started_at >= ?${sessionRoutineFilterSql}
       GROUP BY s.id
       ORDER BY s.started_at ASC`
    )
    .all(req.session.userId, exerciseId, since, ...sessionRoutineFilterParams)
    .map((row) => ({
      sessionId: row.session_id,
      startedAt: row.started_at,
      topWeight: Number(row.top_weight || 0),
      topReps: Number(row.top_reps || 0),
      topVolume: Number(row.top_volume || 0),
    }));

  return res.json({
    routineType: routineTypeFilter,
    exercise: { id: exercise.id, name: exercise.name },
    windowDays,
    points,
  });
});

app.get('/api/stats/distribution', requireAuth, (req, res) => {
  const metric = normalizeText(req.query.metric).toLowerCase() === 'frequency' ? 'frequency' : 'volume';
  const windowDays = parseWindowDays(req.query.window, WINDOW_PATTERNS.short);
  const routineTypeFilter = normalizeRoutineTypeFilter(req.query.routineType);
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const sessionRoutineFilterSql = routineTypeFilter === 'all' ? '' : ' AND s.routine_type = ?';
  const sessionRoutineFilterParams = routineTypeFilter === 'all' ? [] : [routineTypeFilter];

  const rawRows = db
    .prepare(
      `SELECT ss.reps, ss.weight, e.primary_muscles_json
       FROM session_sets ss
       JOIN sessions s ON s.id = ss.session_id
       JOIN exercises e ON e.id = ss.exercise_id
       WHERE s.user_id = ? AND s.started_at >= ?${sessionRoutineFilterSql}`
    )
    .all(req.session.userId, since, ...sessionRoutineFilterParams);

  const bucketMap = new Map();
  rawRows.forEach((row) => {
    const bucket = parseJsonArray(row.primary_muscles_json)[0] || 'other';
    if (!bucketMap.has(bucket)) {
      bucketMap.set(bucket, { bucket, setCount: 0, volume: 0 });
    }
    const target = bucketMap.get(bucket);
    target.setCount += 1;
    target.volume += Number(row.reps || 0) * Number(row.weight || 0);
  });
  const rows = Array.from(bucketMap.values())
    .map((row) => ({
      ...row,
      value: metric === 'frequency' ? row.setCount : row.volume,
    }))
    .sort((a, b) => b.value - a.value);

  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const distribution = rows.map((row) => ({
    ...row,
    share: total > 0 ? row.value / total : 0,
  }));

  return res.json({ routineType: routineTypeFilter, metric, windowDays, total, rows: distribution });
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

function setImportMapping(map, sourceId, targetValue) {
  if (sourceId === null || sourceId === undefined) return;
  map.set(sourceId, targetValue);
  const numericId = Number(sourceId);
  if (Number.isFinite(numericId)) {
    map.set(numericId, targetValue);
  }
}

function getImportMapping(map, sourceId) {
  if (!map) return undefined;
  if (map.has(sourceId)) return map.get(sourceId);
  const numericId = Number(sourceId);
  if (Number.isFinite(numericId) && map.has(numericId)) {
    return map.get(numericId);
  }
  return undefined;
}

function resolveImportMappedId(sourceId, map) {
  if (map) {
    const mapped = getImportMapping(map, sourceId);
    if (mapped === undefined || mapped === null) return null;
    const numericMapped = Number(mapped);
    return Number.isFinite(numericMapped) ? numericMapped : null;
  }
  const numericId = Number(sourceId);
  if (!Number.isFinite(numericId) || numericId <= 0) return null;
  return numericId;
}

function compareImportSignatureValues(left, right) {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  const leftValue = left === null || left === undefined ? '' : String(left);
  const rightValue = right === null || right === undefined ? '' : String(right);
  if (leftValue < rightValue) return -1;
  if (leftValue > rightValue) return 1;
  return 0;
}

function buildRoutineSignaturePayload(
  routine,
  { exerciseIdMap = null, exerciseEquipmentById = null } = {}
) {
  const name = normalizeText(routine?.name);
  if (!name) return null;
  const routineType = normalizeRoutineType(routine?.routineType ?? routine?.routine_type, {
    fallback: 'standard',
  });

  const items = Array.isArray(routine?.exercises) ? routine.exercises : [];
  const normalizedItems = [];
  items.forEach((item, index) => {
    const mappedExerciseId = resolveImportMappedId(item?.exerciseId, exerciseIdMap);
    if (!mappedExerciseId) return;
    const mappedEquipment = getImportMapping(exerciseEquipmentById, item?.exerciseId);
    const equipment = normalizeText(item?.equipment) || mappedEquipment || null;
    normalizedItems.push({
      ...item,
      exerciseId: mappedExerciseId,
      equipment,
      position: Number.isFinite(item?.position) ? Number(item.position) : index,
      supersetGroup: normalizeText(item?.supersetGroup) || null,
    });
  });

  const normalized = normalizeRoutineExerciseRows(normalizedItems, {
    requireEquipment: false,
    skipInvalidItems: true,
    sanitizeSupersets: true,
  });

  return {
    name,
    notes: normalizeText(routine?.notes) || null,
    routineType,
    exercises: normalized.rows.map((item) => ({
      exerciseId: item.exerciseId,
      equipment: normalizeText(item.equipment) || null,
      position: Number.isFinite(item.position) ? Number(item.position) : 0,
      targetSets: item.targetSets ?? null,
      targetReps: item.targetReps ?? null,
      targetRepsRange: item.targetRepsRange ?? null,
      targetRestSeconds: item.targetRestSeconds ?? 0,
      targetWeight: item.targetWeight ?? null,
      targetBandLabel: normalizeText(item.targetBandLabel) || null,
      notes: normalizeText(item.notes) || null,
      supersetGroup: normalizeText(item.supersetGroup) || null,
    })),
  };
}

function buildSessionSignaturePayload(session, { exerciseIdMap = null, routineIdMap = null } = {}) {
  const sets = Array.isArray(session?.sets) ? session.sets : [];
  const exerciseProgress = Array.isArray(session?.exerciseProgress) ? session.exerciseProgress : [];
  const normalizedSets = [];

  sets.forEach((set) => {
    const mappedExerciseId = resolveImportMappedId(set?.exerciseId, exerciseIdMap);
    if (!mappedExerciseId) return;
    const completedAt = normalizeText(set?.completedAt) || normalizeText(set?.createdAt) || null;
    normalizedSets.push({
      exerciseId: mappedExerciseId,
      setIndex: Number(set?.setIndex) || 1,
      reps: normalizeNumber(set?.reps) || 0,
      weight: normalizeNumber(set?.weight) || 0,
      bandLabel: normalizeText(set?.bandLabel) || null,
      startedAt: normalizeText(set?.startedAt) || null,
      completedAt,
      createdAt: completedAt,
    });
  });

  normalizedSets.sort((left, right) => {
    const comparisons = [
      compareImportSignatureValues(left.createdAt, right.createdAt),
      compareImportSignatureValues(left.exerciseId, right.exerciseId),
      compareImportSignatureValues(left.setIndex, right.setIndex),
      compareImportSignatureValues(left.reps, right.reps),
      compareImportSignatureValues(left.weight, right.weight),
      compareImportSignatureValues(left.bandLabel, right.bandLabel),
      compareImportSignatureValues(left.startedAt, right.startedAt),
      compareImportSignatureValues(left.completedAt, right.completedAt),
    ];
    return comparisons.find((value) => value !== 0) || 0;
  });

  const normalizedProgress = [];
  exerciseProgress.forEach((entry, index) => {
    const mappedExerciseId = resolveImportMappedId(entry?.exerciseId, exerciseIdMap);
    if (!mappedExerciseId) return;
    const status = normalizeText(entry?.status) || 'pending';
    const safeStatus = ['pending', 'in_progress', 'completed'].includes(status)
      ? status
      : 'pending';
    const createdAt = normalizeText(entry?.createdAt) || null;
    normalizedProgress.push({
      exerciseId: mappedExerciseId,
      position: Number.isFinite(entry?.position) ? Number(entry.position) : index,
      status: safeStatus,
      startedAt: normalizeText(entry?.startedAt) || null,
      completedAt: normalizeText(entry?.completedAt) || null,
      createdAt,
      updatedAt: normalizeText(entry?.updatedAt) || createdAt,
    });
  });

  normalizedProgress.sort((left, right) => {
    const comparisons = [
      compareImportSignatureValues(left.position, right.position),
      compareImportSignatureValues(left.exerciseId, right.exerciseId),
      compareImportSignatureValues(left.status, right.status),
      compareImportSignatureValues(left.startedAt, right.startedAt),
      compareImportSignatureValues(left.completedAt, right.completedAt),
      compareImportSignatureValues(left.createdAt, right.createdAt),
      compareImportSignatureValues(left.updatedAt, right.updatedAt),
    ];
    return comparisons.find((value) => value !== 0) || 0;
  });

  const mappedRoutineId = resolveImportMappedId(session?.routineId, routineIdMap);
  const routineType = normalizeRoutineType(session?.routineType ?? session?.routine_type, {
    fallback: 'standard',
  });
  return {
    routineId: mappedRoutineId || null,
    routineType,
    name: normalizeText(session?.name) || null,
    startedAt: normalizeText(session?.startedAt) || null,
    endedAt: normalizeText(session?.endedAt) || null,
    warmupStartedAt: normalizeText(session?.warmupStartedAt) || null,
    warmupCompletedAt: normalizeText(session?.warmupCompletedAt) || null,
    notes: normalizeText(session?.notes) || null,
    exerciseProgress: normalizedProgress,
    sets: normalizedSets,
  };
}

function buildWeightSignaturePayload(entry) {
  const weight = normalizeNumber(entry?.weight);
  if (weight === null) return null;
  return {
    weight,
    measuredAt: normalizeText(entry?.measuredAt) || null,
    notes: normalizeText(entry?.notes) || null,
  };
}

function buildExistingImportSignatureIndexes(userId) {
  const existingRoutineBySignature = new Map();
  listRoutines(userId).forEach((routine) => {
    const signaturePayload = buildRoutineSignaturePayload(routine);
    if (!signaturePayload) return;
    existingRoutineBySignature.set(JSON.stringify(signaturePayload), routine.id);
  });

  const sessionRows = db
    .prepare(
      `SELECT id, routine_id, routine_type, name, started_at, ended_at, notes,
              warmup_started_at, warmup_completed_at
       FROM sessions
       WHERE user_id = ?`
    )
    .all(userId);
  const sessionIds = sessionRows.map((row) => row.id);
  const setsBySession = new Map();
  const progressBySession = new Map();

  if (sessionIds.length) {
    const placeholders = sessionIds.map(() => '?').join(',');
    const setRows = db
      .prepare(
        `SELECT session_id, exercise_id, set_index, reps, weight, band_label, started_at, completed_at, created_at
         FROM session_sets
         WHERE session_id IN (${placeholders})`
      )
      .all(...sessionIds);
    setRows.forEach((row) => {
      if (!setsBySession.has(row.session_id)) {
        setsBySession.set(row.session_id, []);
      }
      setsBySession.get(row.session_id).push({
        exerciseId: row.exercise_id,
        setIndex: row.set_index,
        reps: row.reps,
        weight: row.weight,
        bandLabel: row.band_label,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        createdAt: row.created_at,
      });
    });

    const progressRows = db
      .prepare(
        `SELECT session_id, exercise_id, position, status, started_at, completed_at, created_at, updated_at
         FROM session_exercise_progress
         WHERE session_id IN (${placeholders})`
      )
      .all(...sessionIds);
    progressRows.forEach((row) => {
      if (!progressBySession.has(row.session_id)) {
        progressBySession.set(row.session_id, []);
      }
      progressBySession.get(row.session_id).push({
        exerciseId: row.exercise_id,
        position: row.position,
        status: row.status,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    });
  }

  const existingSessionBySignature = new Map();
  sessionRows.forEach((row) => {
    const signaturePayload = buildSessionSignaturePayload({
      routineId: row.routine_id,
      routineType: row.routine_type,
      name: row.name,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      notes: row.notes,
      warmupStartedAt: row.warmup_started_at,
      warmupCompletedAt: row.warmup_completed_at,
      sets: setsBySession.get(row.id) || [],
      exerciseProgress: progressBySession.get(row.id) || [],
    });
    existingSessionBySignature.set(JSON.stringify(signaturePayload), row.id);
  });

  const existingWeightSignatures = new Set();
  db
    .prepare(
      `SELECT weight, measured_at, notes
       FROM bodyweight_entries
       WHERE user_id = ?`
    )
    .all(userId)
    .forEach((row) => {
      const signaturePayload = buildWeightSignaturePayload({
        weight: row.weight,
        measuredAt: row.measured_at,
        notes: row.notes,
      });
      if (!signaturePayload) return;
      existingWeightSignatures.add(JSON.stringify(signaturePayload));
    });

  return {
    existingRoutineBySignature,
    existingSessionBySignature,
    existingWeightSignatures,
  };
}

function validateImportPayload(userId, payload) {
  const errors = [];
  const warnings = [];
  const expectedVersion = 8;
  const supportedVersions = new Set([3, 4, 5, 6, 7, 8]);

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
      .prepare('SELECT id, name FROM exercises')
      .all()
      .map((row) => [normalizeText(row.name).toLowerCase(), { id: Number(row.id), name: row.name }])
  );
  const payloadExerciseNames = new Set();
  const duplicateExerciseNamesInPayload = [];
  const existingExerciseNameConflicts = [];
  let exercisesMissingName = 0;

  let exercisesToCreate = 0;
  let exercisesToReuse = 0;
  let exercisesSkipped = 0;
  let nextExercisePlaceholderId = -1;
  const payloadExerciseIdMap = new Map();

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

    const existingExercise = existingExerciseByKey.get(name);
    if (existingExercise) {
      existingExerciseNameConflicts.push(existingExercise.name);
      exercisesToReuse += 1;
      setImportMapping(payloadExerciseIdMap, exercise?.id, existingExercise.id);
    } else {
      exercisesToCreate += 1;
      setImportMapping(payloadExerciseIdMap, exercise?.id, nextExercisePlaceholderId);
      nextExercisePlaceholderId -= 1;
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

  const {
    existingRoutineBySignature,
    existingSessionBySignature,
    existingWeightSignatures,
  } = buildExistingImportSignatureIndexes(userId);

  let routinesToCreate = 0;
  let routinesToReuse = 0;
  let routinesSkipped = 0;
  let nextRoutinePlaceholderId = -1;
  const payloadRoutineIdMap = new Map();
  routines.forEach((routine) => {
    const signaturePayload = buildRoutineSignaturePayload(routine, {
      exerciseIdMap: payloadExerciseIdMap,
    });
    if (!signaturePayload) {
      routinesSkipped += 1;
      return;
    }
    const signature = JSON.stringify(signaturePayload);
    const existingRoutineId = existingRoutineBySignature.get(signature);
    if (existingRoutineId) {
      routinesToReuse += 1;
      setImportMapping(payloadRoutineIdMap, routine?.id, existingRoutineId);
      return;
    }
    routinesToCreate += 1;
    setImportMapping(payloadRoutineIdMap, routine?.id, nextRoutinePlaceholderId);
    nextRoutinePlaceholderId -= 1;
  });

  if (routinesSkipped) {
    warnings.push(`${routinesSkipped} routines with missing names will be skipped.`);
  }

  let sessionsToCreate = 0;
  let sessionsToReuse = 0;
  sessions.forEach((session) => {
    const signaturePayload = buildSessionSignaturePayload(session, {
      exerciseIdMap: payloadExerciseIdMap,
      routineIdMap: payloadRoutineIdMap,
    });
    const signature = JSON.stringify(signaturePayload);
    if (existingSessionBySignature.has(signature)) {
      sessionsToReuse += 1;
    } else {
      sessionsToCreate += 1;
    }
  });

  let validWeightCount = 0;
  let weightsToCreate = 0;
  let weightsToReuse = 0;
  let weightsSkipped = 0;
  weights.forEach((entry) => {
    const signaturePayload = buildWeightSignaturePayload(entry);
    if (!signaturePayload) {
      weightsSkipped += 1;
      return;
    }
    validWeightCount += 1;
    const signature = JSON.stringify(signaturePayload);
    if (existingWeightSignatures.has(signature)) {
      weightsToReuse += 1;
    } else {
      weightsToCreate += 1;
    }
  });

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
        weights: weightsToCreate,
      },
      toReuse: {
        exercises: exercisesToReuse,
        routines: routinesToReuse,
        sessions: sessionsToReuse,
        weights: weightsToReuse,
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
      `SELECT id, fork_id, name, force, level, mechanic, equipment, primary_muscles_json, secondary_muscles_json, instructions_json, category, images_json,
              notes, merged_into_id, merged_at, archived_at, created_at, updated_at
       FROM exercises`
    )
    .all();

  const routines = listRoutines(userId);

  const sessions = db
    .prepare(
      `SELECT id, routine_id, routine_type, name, started_at, ended_at, notes,
              warmup_started_at, warmup_completed_at
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
    version: 8,
    exportedAt: nowIso(),
    user: user ? { username: user.username, createdAt: user.created_at } : null,
    exercises: exercises.map((exercise) => ({
      id: exercise.id,
      forkId: exercise.fork_id,
      name: exercise.name,
      force: exercise.force,
      level: exercise.level,
      mechanic: exercise.mechanic,
      equipment: exercise.equipment,
      primaryMuscles: parseJsonArray(exercise.primary_muscles_json),
      secondaryMuscles: parseJsonArray(exercise.secondary_muscles_json),
      instructions: parseJsonArray(exercise.instructions_json),
      category: exercise.category,
      images: parseJsonArray(exercise.images_json),
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
      routineType: normalizeRoutineType(routine.routineType, { fallback: 'standard' }),
      createdAt: routine.createdAt,
      updatedAt: routine.updatedAt,
      exercises: routine.exercises,
    })),
    sessions: sessions.map((session) => ({
      id: session.id,
      routineId: session.routine_id,
      routineType: normalizeRoutineType(session.routine_type, { fallback: 'standard' }),
      name: session.name,
      startedAt: session.started_at,
      endedAt: session.ended_at,
      notes: session.notes,
      warmupStartedAt: session.warmup_started_at,
      warmupCompletedAt: session.warmup_completed_at,
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
     (fork_id, name, force, level, mechanic, equipment, primary_muscles_json, secondary_muscles_json, instructions_json, category, images_json, notes, merged_into_id, merged_at, archived_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  DEFAULT_EXERCISES.forEach((exercise) => {
    insert.run(
      exercise.forkId,
      exercise.name,
      exercise.force,
      exercise.level || 'beginner',
      exercise.mechanic,
      exercise.equipment,
      stringifyJsonArray(exercise.primaryMuscles),
      stringifyJsonArray(exercise.secondaryMuscles),
      stringifyJsonArray(exercise.instructions),
      exercise.category || 'strength',
      stringifyJsonArray(exercise.images),
      exercise.notes || null,
      null,
      null,
      null,
      now,
      now
    );
  });
}

function backfillExerciseMetadataFromLibrary() {
  const rows = db
    .prepare(
      `SELECT id, name, fork_id, force, level, mechanic, equipment, primary_muscles_json, secondary_muscles_json, instructions_json, category, images_json, updated_at
       FROM exercises`
    )
    .all();
  const update = db.prepare(
    `UPDATE exercises
     SET fork_id = ?, force = ?, level = ?, mechanic = ?, equipment = ?,
         primary_muscles_json = ?, secondary_muscles_json = ?, instructions_json = ?,
         category = ?, images_json = ?, updated_at = ?
     WHERE id = ?`
  );
  const now = nowIso();

  rows.forEach((row) => {
    if (row.fork_id) return;
    const existingPrimary = parseJsonArray(row.primary_muscles_json);
    const existingSecondary = parseJsonArray(row.secondary_muscles_json);
    const existingInstructions = parseJsonArray(row.instructions_json);
    const existingImages = parseJsonArray(row.images_json);
    const libraryMatch = EXERCISE_LIBRARY.byName.get(normalizeText(row.name).toLowerCase());
    const payload = libraryMatch
      ? normalizeExercisePayload(
          {
            forkId: libraryMatch.id,
            name: libraryMatch.name,
            force: libraryMatch.force,
            level: libraryMatch.level,
            mechanic: libraryMatch.mechanic,
            equipment: libraryMatch.equipment,
            primaryMuscles: libraryMatch.primaryMuscles,
            secondaryMuscles: libraryMatch.secondaryMuscles,
            instructions: libraryMatch.instructions,
            category: libraryMatch.category,
            images: libraryMatch.images,
          },
          { requirePrimary: false }
        ).exercise
      : null;

    const nextPrimary = payload?.primaryMuscles?.length
      ? payload.primaryMuscles
      : existingPrimary.length
        ? existingPrimary
        : ['abdominals'];
    const nextSecondary = payload?.secondaryMuscles?.length
      ? payload.secondaryMuscles
      : existingSecondary;
    const nextInstructions = payload?.instructions?.length
      ? payload.instructions
      : existingInstructions;
    const nextImages = payload?.images?.length ? payload.images : existingImages;

    update.run(
      payload?.forkId || null,
      payload?.force || row.force || null,
      payload?.level || row.level || 'beginner',
      payload?.mechanic || row.mechanic || null,
      payload?.equipment || row.equipment || null,
      stringifyJsonArray(nextPrimary),
      stringifyJsonArray(nextSecondary),
      stringifyJsonArray(nextInstructions),
      payload?.category || row.category || 'strength',
      stringifyJsonArray(nextImages),
      now,
      row.id
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
  const {
    existingRoutineBySignature,
    existingSessionBySignature,
    existingWeightSignatures,
  } = buildExistingImportSignatureIndexes(userId);

  const insertExercise = db.prepare(
    `INSERT INTO exercises
     (fork_id, name, force, level, mechanic, equipment, primary_muscles_json, secondary_muscles_json, instructions_json, category, images_json, notes, merged_into_id, merged_at, archived_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertRoutine = db.prepare(
    `INSERT INTO routines (user_id, name, notes, routine_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertRoutineExercise = db.prepare(
    `INSERT INTO routine_exercises
     (routine_id, exercise_id, equipment, position, target_sets, target_reps, target_reps_range, target_rest_seconds, target_weight, target_band_label, notes, superset_group)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertSession = db.prepare(
    `INSERT INTO sessions (user_id, routine_id, routine_type, name, started_at, ended_at, notes, warmup_started_at, warmup_completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
  const exerciseEquipmentById = new Map();
  exercises.forEach((exercise) => {
    setImportMapping(exerciseEquipmentById, exercise?.id, normalizeText(exercise?.equipment) || null);
  });

  db.exec('BEGIN IMMEDIATE;');
  try {
    exercises.forEach((exercise) => {
      const sourceName = normalizeText(exercise?.name);
      if (!sourceName) return;
      const nameKey = sourceName.toLowerCase();
      if (seenExerciseNames.has(nameKey)) return;
      seenExerciseNames.add(nameKey);

      let exerciseId = existingExerciseByKey.get(nameKey);
      const normalizedExercise = normalizeExercisePayload(
        {
          forkId: exercise.forkId || null,
          name: sourceName,
          force: exercise.force,
          level: exercise.level || 'beginner',
          mechanic: exercise.mechanic,
          equipment: exercise.equipment,
          primaryMuscles: exercise.primaryMuscles || [],
          secondaryMuscles: exercise.secondaryMuscles || [],
          instructions: exercise.instructions || [],
          category: exercise.category || 'strength',
          images: exercise.images || [],
          notes: exercise.notes,
        },
        { requirePrimary: false }
      ).exercise;
      if (!normalizedExercise.primaryMuscles.length) {
        normalizedExercise.primaryMuscles = ['abdominals'];
      }
      if (!exerciseId) {
        const now = nowIso();
        const result = insertExercise.run(
          normalizedExercise.forkId,
          sourceName,
          normalizedExercise.force,
          normalizedExercise.level,
          normalizedExercise.mechanic,
          normalizedExercise.equipment,
          stringifyJsonArray(normalizedExercise.primaryMuscles),
          stringifyJsonArray(normalizedExercise.secondaryMuscles),
          stringifyJsonArray(normalizedExercise.instructions),
          normalizedExercise.category,
          stringifyJsonArray(normalizedExercise.images),
          normalizeText(normalizedExercise.notes) || null,
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
      setImportMapping(exerciseIdMap, exercise?.id, exerciseId);
    });

    routines.forEach((routine) => {
      const signaturePayload = buildRoutineSignaturePayload(routine, {
        exerciseIdMap,
        exerciseEquipmentById,
      });
      if (!signaturePayload) return;

      const signature = JSON.stringify(signaturePayload);
      let routineId = existingRoutineBySignature.get(signature);
      if (!routineId) {
        const now = nowIso();
        const result = insertRoutine.run(
          userId,
          signaturePayload.name,
          signaturePayload.notes,
          normalizeRoutineType(signaturePayload.routineType, { fallback: 'standard' }),
          routine.createdAt || now,
          routine.updatedAt || now
        );
        routineId = Number(result.lastInsertRowid);
        importedCount.routines += 1;
      }
      setImportMapping(routineIdMap, routine?.id, routineId);

      if (existingRoutineBySignature.has(signature)) {
        return;
      }

      signaturePayload.exercises.forEach((item) => {
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
      const signaturePayload = buildSessionSignaturePayload(session, {
        exerciseIdMap,
        routineIdMap,
      });
      const signature = JSON.stringify(signaturePayload);
      const existingSessionId = existingSessionBySignature.get(signature);
      if (existingSessionId) {
        setImportMapping(sessionIdMap, session?.id, existingSessionId);
        return;
      }

      const result = insertSession.run(
        userId,
        signaturePayload.routineId || null,
        normalizeRoutineType(signaturePayload.routineType, { fallback: 'standard' }),
        signaturePayload.name,
        signaturePayload.startedAt || nowIso(),
        signaturePayload.endedAt || null,
        signaturePayload.notes,
        signaturePayload.warmupStartedAt,
        signaturePayload.warmupCompletedAt
      );
      const sessionId = Number(result.lastInsertRowid);
      importedCount.sessions += 1;
      setImportMapping(sessionIdMap, session?.id, sessionId);

      signaturePayload.sets.forEach((set) => {
        const completedAt = set.completedAt || nowIso();
        insertSet.run(
          sessionId,
          set.exerciseId,
          set.setIndex,
          set.reps,
          set.weight,
          set.bandLabel,
          set.startedAt,
          completedAt,
          completedAt
        );
      });

      signaturePayload.exerciseProgress.forEach((progress) => {
        const createdAt = progress.createdAt || nowIso();
        const updatedAt = progress.updatedAt || createdAt;
        insertExerciseProgress.run(
          sessionId,
          progress.exerciseId,
          progress.position,
          progress.status,
          progress.startedAt,
          progress.completedAt,
          createdAt,
          updatedAt
        );
      });
    });

    weights.forEach((entry) => {
      const signaturePayload = buildWeightSignaturePayload(entry);
      if (!signaturePayload) return;
      const signature = JSON.stringify(signaturePayload);
      if (existingWeightSignatures.has(signature)) return;
      insertWeight.run(
        userId,
        signaturePayload.weight,
        signaturePayload.measuredAt || nowIso(),
        signaturePayload.notes
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
  if (!automaticExportHandle) {
    const dbPath = resolveDbPath();
    const automaticExportConfig = resolveAutomaticExportConfig({
      dbPath,
    });
    automaticExportHandle = startAutomaticExports({
      db,
      dbPath,
      ...automaticExportConfig,
    });
  }

  app.listen(port, host, () => {
    const displayHost = host === '0.0.0.0' ? 'localhost' : host;
    console.log(`API running on http://${displayHost}:${port}`);
  });
}

if (process.env.NODE_ENV !== 'test') {
  const start = async () => {
    await maybeSeedDevData();
    ensureDefaultExercises();
    backfillExerciseMetadataFromLibrary();
    startServer();
  };
  start();
}

export { app, startServer };
