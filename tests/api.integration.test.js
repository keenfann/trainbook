import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const TEST_DB_PATH = path.resolve(
  process.cwd(),
  'db',
  `test-api-${process.pid}.sqlite`
);

process.env.NODE_ENV = 'test';
process.env.DB_PATH = TEST_DB_PATH;
process.env.SESSION_SECRET = 'test-session-secret';
process.env.DEV_AUTOLOGIN = 'false';
process.env.DEV_AUTOLOGIN_ALLOW_REMOTE = 'false';

if (fs.existsSync(TEST_DB_PATH)) {
  fs.rmSync(TEST_DB_PATH, { force: true });
}

const [{ app }, { default: db }] = await Promise.all([
  import('../server/index.js'),
  import('../server/db.js'),
]);

function resetDatabase() {
  db.exec(`
    DELETE FROM sync_operations;
    DELETE FROM session_sets;
    DELETE FROM sessions;
    DELETE FROM routine_exercises;
    DELETE FROM routines;
    DELETE FROM user_bands;
    DELETE FROM bodyweight_entries;
    DELETE FROM exercises;
    DELETE FROM users;
    DELETE FROM sessions_store;
    DELETE FROM sqlite_sequence;
  `);
}

async function fetchCsrfToken(agent) {
  const response = await agent.get('/api/csrf');
  expect(response.status).toBe(200);
  expect(response.body.csrfToken).toBeTypeOf('string');
  return response.body.csrfToken;
}

async function registerUser(agent, username, password = 'secret123') {
  const csrfToken = await fetchCsrfToken(agent);
  const response = await agent
    .post('/api/auth/register')
    .set('x-csrf-token', csrfToken)
    .send({ username, password });
  expect(response.status).toBe(200);
  return response.body.user;
}

beforeEach(() => {
  resetDatabase();
});

afterAll(() => {
  try {
    db.close?.();
  } catch {
    // no-op
  }
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.rmSync(TEST_DB_PATH, { force: true });
  }
});

describe('API integration smoke tests', () => {
  const THIRTY_DAY_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

  function extractSessionCookieExpiry(cookieHeaders) {
    const sessionCookie = (cookieHeaders || []).find(
      (value) => typeof value === 'string' && value.startsWith('connect.sid=')
    );
    if (!sessionCookie) return null;
    const expiresMatch = sessionCookie.match(/;\s*Expires=([^;]+)/i);
    if (!expiresMatch) return null;
    const expiresAt = Date.parse(expiresMatch[1]);
    return Number.isFinite(expiresAt) ? expiresAt : null;
  }

  function expectThirtyDayCookieLifetime(response) {
    const expiresAt = extractSessionCookieExpiry(response.headers['set-cookie']);
    expect(expiresAt).not.toBeNull();
    const serverTimestamp = Date.parse(response.headers.date || '');
    const responseAt = Number.isFinite(serverTimestamp) ? serverTimestamp : Date.now();
    const lifetimeMs = expiresAt - responseAt;
    expect(lifetimeMs).toBeGreaterThanOrEqual(THIRTY_DAY_COOKIE_MAX_AGE_MS - 60_000);
    expect(lifetimeMs).toBeLessThanOrEqual(THIRTY_DAY_COOKIE_MAX_AGE_MS + 60_000);
  }

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

  it('rejects mutating requests without CSRF token', async () => {
    const agent = request.agent(app);
    const response = await agent
      .post('/api/auth/register')
      .send({ username: 'coach', password: 'secret123' });
    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/CSRF/i);
  });

  it('merges exercises and transfers forkId without unique constraint conflicts', async () => {
    const owner = request.agent(app);
    await registerUser(owner, 'mergeowner');
    const csrfToken = await fetchCsrfToken(owner);

    const sourceExercise = await owner
      .post('/api/exercises')
      .set('x-csrf-token', csrfToken)
      .send({
        name: 'Source Fork Exercise',
        forkId: 'fork-merge-transfer-test',
        primaryMuscles: ['chest'],
      });
    expect(sourceExercise.status).toBe(200);
    expect(sourceExercise.body.exercise.forkId).toBe('fork-merge-transfer-test');

    const targetExercise = await owner
      .post('/api/exercises')
      .set('x-csrf-token', csrfToken)
      .send({
        name: 'Target Custom Exercise',
        primaryMuscles: ['chest'],
      });
    expect(targetExercise.status).toBe(200);
    expect(targetExercise.body.exercise.forkId).toBeNull();

    const mergeResponse = await owner
      .post('/api/exercises/merge')
      .set('x-csrf-token', csrfToken)
      .send({
        sourceId: sourceExercise.body.exercise.id,
        targetId: targetExercise.body.exercise.id,
      });
    expect(mergeResponse.status).toBe(200);
    expect(mergeResponse.body.ok).toBe(true);

    const mergedExercises = await owner.get('/api/exercises?includeArchived=true');
    expect(mergedExercises.status).toBe(200);
    const mergedTarget = mergedExercises.body.exercises.find(
      (exercise) => exercise.id === targetExercise.body.exercise.id
    );
    const mergedSource = mergedExercises.body.exercises.find(
      (exercise) => exercise.id === sourceExercise.body.exercise.id
    );
    expect(mergedTarget.forkId).toBe('fork-merge-transfer-test');
    expect(mergedSource.archivedAt).toBeTypeOf('string');

    const persistedSource = db
      .prepare('SELECT fork_id FROM exercises WHERE id = ?')
      .get(sourceExercise.body.exercise.id);
    expect(persistedSource.fork_id).toBeNull();
  });

  it('supports auth lifecycle and password updates', async () => {
    const agent = request.agent(app);
    const username = 'coach-auth-lifecycle';
    const registerCsrf = await fetchCsrfToken(agent);
    const register = await agent
      .post('/api/auth/register')
      .set('x-csrf-token', registerCsrf)
      .send({ username, password: 'secret123' });
    expect(register.status).toBe(200);
    expect(register.body.user?.username).toBe(username);
    expectThirtyDayCookieLifetime(register);

    const whoAmI = await agent.get('/api/auth/me');
    expect(whoAmI.status).toBe(200);
    expect(whoAmI.body.user?.username).toBe(username);

    const passwordCsrf = await fetchCsrfToken(agent);
    const wrongPassword = await agent
      .post('/api/auth/password')
      .set('x-csrf-token', passwordCsrf)
      .send({ currentPassword: 'wrong', nextPassword: 'secret456' });
    expect(wrongPassword.status).toBe(401);

    const updatePassword = await agent
      .post('/api/auth/password')
      .set('x-csrf-token', passwordCsrf)
      .send({ currentPassword: 'secret123', nextPassword: 'secret456' });
    expect(updatePassword.status).toBe(200);
    expect(updatePassword.body.ok).toBe(true);

    const logoutCsrf = await fetchCsrfToken(agent);
    const logout = await agent
      .post('/api/auth/logout')
      .set('x-csrf-token', logoutCsrf)
      .send({});
    expect(logout.status).toBe(200);

    const unauthRoutines = await agent.get('/api/routines');
    expect(unauthRoutines.status).toBe(401);

    const loginCsrf = await fetchCsrfToken(agent);
    const login = await agent
      .post('/api/auth/login')
      .set('x-csrf-token', loginCsrf)
      .send({ username, password: 'secret456' });
    expect(login.status).toBe(200);
    expect(login.body.user?.username).toBe(username);
    expectThirtyDayCookieLifetime(login);
  });

  it('requires an owned routine when starting a session', async () => {
    const owner = request.agent(app);
    await registerUser(owner, 'owner-routine');
    const ownerCsrf = await fetchCsrfToken(owner);

    const routineResponse = await owner
      .post('/api/routines')
      .set('x-csrf-token', ownerCsrf)
      .send({ name: 'Routine A', exercises: [] });
    expect(routineResponse.status).toBe(200);
    expect(routineResponse.body.routine.routineType).toBe('standard');
    const routineId = routineResponse.body.routine.id;

    const missingRoutine = await owner
      .post('/api/sessions')
      .set('x-csrf-token', ownerCsrf)
      .send({ name: 'No routine selected' });
    expect(missingRoutine.status).toBe(400);
    expect(missingRoutine.body.error).toBe('Routine is required.');

    const otherUser = request.agent(app);
    await registerUser(otherUser, 'other-user');
    const otherCsrf = await fetchCsrfToken(otherUser);

    const foreignRoutine = await otherUser
      .post('/api/sessions')
      .set('x-csrf-token', otherCsrf)
      .send({ routineId, name: 'Foreign routine' });
    expect(foreignRoutine.status).toBe(404);
    expect(foreignRoutine.body.error).toBe('Routine not found.');

    const validSession = await owner
      .post('/api/sessions')
      .set('x-csrf-token', ownerCsrf)
      .send({ routineId, name: 'Routine session' });
    expect(validSession.status).toBe(200);
    expect(validSession.body.session.routineId).toBe(routineId);
    expect(validSession.body.session.routineType).toBe('standard');
  });

  it('blocks saving routine changes while an active workout exists for that routine', async () => {
    const agent = request.agent(app);
    await registerUser(agent, 'routine-save-while-active-user');
    const csrfToken = await fetchCsrfToken(agent);

    const exerciseResponse = await agent
      .post('/api/exercises')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Active Save Lift', primaryMuscles: ['chest'], notes: '' });
    expect(exerciseResponse.status).toBe(200);
    const exerciseId = exerciseResponse.body.exercise.id;

    const routineResponse = await agent
      .post('/api/routines')
      .set('x-csrf-token', csrfToken)
      .send({
        name: 'Active Save Routine',
        notes: 'Before update',
        exercises: [
          {
            exerciseId,
            equipment: 'Barbell',
            targetSets: 3,
            targetReps: 5,
            targetWeight: 70,
            targetRestSeconds: 90,
            position: 0,
          },
        ],
      });
    expect(routineResponse.status).toBe(200);
    const routineId = routineResponse.body.routine.id;

    const startSessionResponse = await agent
      .post('/api/sessions')
      .set('x-csrf-token', csrfToken)
      .send({ routineId, name: 'In Progress Workout' });
    expect(startSessionResponse.status).toBe(200);

    const blockedUpdateResponse = await agent
      .put(`/api/routines/${routineId}`)
      .set('x-csrf-token', csrfToken)
      .send({
        name: 'Should Not Save',
        notes: 'After update',
        exercises: [
          {
            exerciseId,
            equipment: 'Barbell',
            targetSets: 3,
            targetReps: 6,
            targetWeight: 75,
            targetRestSeconds: 90,
            position: 0,
          },
        ],
      });
    expect(blockedUpdateResponse.status).toBe(409);
    expect(blockedUpdateResponse.body.error).toBe(
      'Finish or discard your active workout for this routine before saving routine changes.'
    );

    const routineAfterBlockedUpdate = await agent.get(`/api/routines/${routineId}`);
    expect(routineAfterBlockedUpdate.status).toBe(200);
    expect(routineAfterBlockedUpdate.body.routine.name).toBe('Active Save Routine');
    expect(routineAfterBlockedUpdate.body.routine.notes).toBe('Before update');
    expect(routineAfterBlockedUpdate.body.routine.exercises[0].targetSets).toBe(3);
    expect(routineAfterBlockedUpdate.body.routine.exercises[0].targetReps).toBe(5);
    expect(Number(routineAfterBlockedUpdate.body.routine.exercises[0].targetWeight)).toBe(70);
  });

  it('excludes zero-set sessions from recent sessions and routine last-used metadata', async () => {
    const agent = request.agent(app);
    await registerUser(agent, 'session-filter-user');
    const csrfToken = await fetchCsrfToken(agent);

    const exerciseResponse = await agent
      .post('/api/exercises')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Filter Test Lift', primaryMuscles: ['chest'], notes: '' });
    expect(exerciseResponse.status).toBe(200);
    const exerciseId = exerciseResponse.body.exercise.id;

    const routineResponse = await agent
      .post('/api/routines')
      .set('x-csrf-token', csrfToken)
      .send({
        name: 'Filter Test Routine',
        notes: 'Filter note',
        exercises: [
          {
            exerciseId,
            equipment: 'Barbell',
            targetSets: 3,
            targetReps: 5,
            targetRestSeconds: 90,
            targetWeight: 60,
            position: 0,
          },
        ],
      });
    expect(routineResponse.status).toBe(200);
    const routineId = routineResponse.body.routine.id;

    const startedWithSets = '2026-01-02T08:00:00.000Z';
    const startedNoSets = '2026-01-10T08:00:00.000Z';

    const sessionWithSetsResponse = await agent
      .post('/api/sessions')
      .set('x-csrf-token', csrfToken)
      .send({ routineId, name: 'With sets', startedAt: startedWithSets });
    expect(sessionWithSetsResponse.status).toBe(200);
    const sessionWithSetsId = sessionWithSetsResponse.body.session.id;

    const addSetResponse = await agent
      .post(`/api/sessions/${sessionWithSetsId}/sets`)
      .set('x-csrf-token', csrfToken)
      .send({ exerciseId, reps: 5, weight: 60, startedAt: startedWithSets, completedAt: startedWithSets });
    expect(addSetResponse.status).toBe(200);

    const sessionWithoutSetsResponse = await agent
      .post('/api/sessions')
      .set('x-csrf-token', csrfToken)
      .send({ routineId, name: 'No sets', startedAt: startedNoSets });
    expect(sessionWithoutSetsResponse.status).toBe(200);
    const sessionWithoutSetsId = sessionWithoutSetsResponse.body.session.id;

    const sessionsResponse = await agent.get('/api/sessions?limit=10');
    expect(sessionsResponse.status).toBe(200);
    const listedSessionIds = sessionsResponse.body.sessions.map((session) => session.id);
    expect(listedSessionIds).toContain(sessionWithSetsId);
    expect(listedSessionIds).not.toContain(sessionWithoutSetsId);
    expect(sessionsResponse.body.sessions.every((session) => Number(session.totalSets) > 0)).toBe(true);
    const listedSession = sessionsResponse.body.sessions.find((session) => session.id === sessionWithSetsId);
    expect(listedSession?.routineNotes).toBe('Filter note');

    const routinesListResponse = await agent.get('/api/routines');
    expect(routinesListResponse.status).toBe(200);
    const listedRoutine = routinesListResponse.body.routines.find((routine) => routine.id === routineId);
    expect(listedRoutine).toBeTruthy();
    expect(listedRoutine.lastUsedAt).toBe(startedWithSets);
  });

  it('discards a workout when ending with zero sets', async () => {
    const agent = request.agent(app);
    await registerUser(agent, 'discard-zero-sets-user');
    const csrfToken = await fetchCsrfToken(agent);

    const exerciseResponse = await agent
      .post('/api/exercises')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Discard Test Lift', primaryMuscles: ['shoulders'], notes: '' });
    expect(exerciseResponse.status).toBe(200);
    const exerciseId = exerciseResponse.body.exercise.id;

    const routineResponse = await agent
      .post('/api/routines')
      .set('x-csrf-token', csrfToken)
      .send({
        name: 'Discard Test Routine',
        exercises: [
          {
            exerciseId,
            equipment: 'Dumbbell',
            targetSets: 2,
            targetReps: 10,
            targetRestSeconds: 60,
            targetWeight: 20,
            position: 0,
          },
        ],
      });
    expect(routineResponse.status).toBe(200);
    const routineId = routineResponse.body.routine.id;

    const createSession = await agent
      .post('/api/sessions')
      .set('x-csrf-token', csrfToken)
      .send({ routineId, name: 'Should be discarded' });
    expect(createSession.status).toBe(200);
    const sessionId = createSession.body.session.id;

    const endSession = await agent
      .put(`/api/sessions/${sessionId}`)
      .set('x-csrf-token', csrfToken)
      .send({ endedAt: new Date().toISOString() });
    expect(endSession.status).toBe(200);
    expect(endSession.body.discarded).toBe(true);
    expect(endSession.body.session).toBeNull();

    const activeSession = await agent.get('/api/sessions/active');
    expect(activeSession.status).toBe(200);
    expect(activeSession.body.session).toBeNull();

    const sessions = await agent.get('/api/sessions?limit=10');
    expect(sessions.status).toBe(200);
    expect(sessions.body.sessions).toEqual([]);

    const missingDetail = await agent.get(`/api/sessions/${sessionId}`);
    expect(missingDetail.status).toBe(404);

    const routinesList = await agent.get('/api/routines');
    expect(routinesList.status).toBe(200);
    const routine = routinesList.body.routines.find((item) => item.id === routineId);
    expect(routine).toBeTruthy();
    expect(routine.lastUsedAt).toBeNull();

    const statsResponse = await agent.get('/api/stats/overview');
    expect(statsResponse.status).toBe(200);
    expect(statsResponse.body.summary.totalSessions).toBe(0);
    expect(statsResponse.body.summary.totalSets).toBe(0);
  });

  it('keeps ended rehab sessions with tracked progress even when no sets were logged', async () => {
    const agent = request.agent(app);
    await registerUser(agent, 'rehab-progress-user');
    const csrfToken = await fetchCsrfToken(agent);

    const exerciseResponse = await agent
      .post('/api/exercises')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Rehab Progress Lift', primaryMuscles: ['shoulders'], notes: '' });
    expect(exerciseResponse.status).toBe(200);
    const exerciseId = exerciseResponse.body.exercise.id;

    const routineResponse = await agent
      .post('/api/routines')
      .set('x-csrf-token', csrfToken)
      .send({
        name: 'Rehab Progress Routine',
        routineType: 'rehab',
        notes: 'Shoulder rehab',
        exercises: [
          {
            exerciseId,
            equipment: 'Band',
            targetSets: 2,
            targetRepsRange: '12-15',
            targetRestSeconds: 45,
            targetBandLabel: '20 lb',
            position: 0,
          },
        ],
      });
    expect(routineResponse.status).toBe(200);
    const routineId = routineResponse.body.routine.id;

    const startedAt = '2026-01-12T08:00:00.000Z';
    const completedAt = '2026-01-12T08:10:00.000Z';
    const endedAt = '2026-01-12T08:15:00.000Z';

    const createSession = await agent
      .post('/api/sessions')
      .set('x-csrf-token', csrfToken)
      .send({ routineId, name: 'Rehab no-sets completion', startedAt });
    expect(createSession.status).toBe(200);
    const sessionId = createSession.body.session.id;

    const completeExercise = await agent
      .post(`/api/sessions/${sessionId}/exercises/${exerciseId}/complete`)
      .set('x-csrf-token', csrfToken)
      .send({ completedAt });
    expect(completeExercise.status).toBe(200);

    const endSession = await agent
      .put(`/api/sessions/${sessionId}`)
      .set('x-csrf-token', csrfToken)
      .send({ endedAt });
    expect(endSession.status).toBe(200);
    expect(endSession.body.discarded).not.toBe(true);
    expect(endSession.body.session?.id).toBe(sessionId);

    const sessions = await agent.get('/api/sessions?limit=10');
    expect(sessions.status).toBe(200);
    const listedSession = sessions.body.sessions.find((session) => session.id === sessionId);
    expect(listedSession).toBeTruthy();
    expect(Number(listedSession.totalSets || 0)).toBe(0);

    const routinesList = await agent.get('/api/routines');
    expect(routinesList.status).toBe(200);
    const routine = routinesList.body.routines.find((item) => item.id === routineId);
    expect(routine).toBeTruthy();
    expect(routine.lastUsedAt).toBe(startedAt);
  });

  it('keeps historical routine type snapshots and supports routine-type scoped stats', async () => {
    const agent = request.agent(app);
    await registerUser(agent, 'routine-type-stats-user');
    const csrfToken = await fetchCsrfToken(agent);

    const exerciseResponse = await agent
      .post('/api/exercises')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Routine Type Lift', primaryMuscles: ['chest'], notes: '' });
    expect(exerciseResponse.status).toBe(200);
    const exerciseId = exerciseResponse.body.exercise.id;

    const standardRoutineResponse = await agent
      .post('/api/routines')
      .set('x-csrf-token', csrfToken)
      .send({
        name: 'Standard Day',
        routineType: 'standard',
        exercises: [
          {
            exerciseId,
            equipment: 'Barbell',
            targetSets: 1,
            targetReps: 5,
            targetRestSeconds: 60,
            targetWeight: 100,
            position: 0,
          },
        ],
      });
    expect(standardRoutineResponse.status).toBe(200);
    expect(standardRoutineResponse.body.routine.routineType).toBe('standard');
    const standardRoutineId = standardRoutineResponse.body.routine.id;

    const rehabRoutineResponse = await agent
      .post('/api/routines')
      .set('x-csrf-token', csrfToken)
      .send({
        name: 'Rehab Day',
        routineType: 'rehab',
        exercises: [
          {
            exerciseId,
            equipment: 'Band',
            targetSets: 1,
            targetRepsRange: '12-15',
            targetRestSeconds: 60,
            targetBandLabel: '20 lb',
            position: 0,
          },
        ],
      });
    expect(rehabRoutineResponse.status).toBe(200);
    expect(rehabRoutineResponse.body.routine.routineType).toBe('rehab');
    const rehabRoutineId = rehabRoutineResponse.body.routine.id;

    const standardSessionResponse = await agent
      .post('/api/sessions')
      .set('x-csrf-token', csrfToken)
      .send({ routineId: standardRoutineId, name: 'Standard Workout' });
    expect(standardSessionResponse.status).toBe(200);
    expect(standardSessionResponse.body.session.routineType).toBe('standard');
    const standardSessionId = standardSessionResponse.body.session.id;

    const rehabSessionResponse = await agent
      .post('/api/sessions')
      .set('x-csrf-token', csrfToken)
      .send({ routineId: rehabRoutineId, name: 'Rehab Workout' });
    expect(rehabSessionResponse.status).toBe(200);
    expect(rehabSessionResponse.body.session.routineType).toBe('rehab');
    const rehabSessionId = rehabSessionResponse.body.session.id;

    const addStandardSetResponse = await agent
      .post(`/api/sessions/${standardSessionId}/sets`)
      .set('x-csrf-token', csrfToken)
      .send({ exerciseId, reps: 5, weight: 100 });
    expect(addStandardSetResponse.status).toBe(200);

    const addRehabSetResponse = await agent
      .post(`/api/sessions/${rehabSessionId}/sets`)
      .set('x-csrf-token', csrfToken)
      .send({ exerciseId, reps: 10, weight: 20, bandLabel: '20 lb' });
    expect(addRehabSetResponse.status).toBe(200);

    const allOverview = await agent.get('/api/stats/overview');
    expect(allOverview.status).toBe(200);
    expect(allOverview.body.routineType).toBe('all');
    expect(allOverview.body.summary.totalSessions).toBe(2);
    expect(allOverview.body.summary.totalSets).toBe(2);

    const standardOverview = await agent.get('/api/stats/overview?routineType=standard');
    expect(standardOverview.status).toBe(200);
    expect(standardOverview.body.routineType).toBe('standard');
    expect(standardOverview.body.summary.totalSessions).toBe(1);
    expect(standardOverview.body.summary.totalSets).toBe(1);
    expect(standardOverview.body.summary.volumeWeek).toBe(500);

    const rehabOverview = await agent.get('/api/stats/overview?routineType=rehab');
    expect(rehabOverview.status).toBe(200);
    expect(rehabOverview.body.routineType).toBe('rehab');
    expect(rehabOverview.body.summary.totalSessions).toBe(1);
    expect(rehabOverview.body.summary.totalSets).toBe(1);
    expect(rehabOverview.body.summary.volumeWeek).toBe(200);

    const standardTimeseries = await agent.get('/api/stats/timeseries?bucket=week&window=90d&routineType=standard');
    expect(standardTimeseries.status).toBe(200);
    expect(standardTimeseries.body.routineType).toBe('standard');
    expect(standardTimeseries.body.summary.totalSets).toBe(1);

    const rehabProgression = await agent.get(
      `/api/stats/progression?exerciseId=${exerciseId}&window=90d&routineType=rehab`
    );
    expect(rehabProgression.status).toBe(200);
    expect(rehabProgression.body.routineType).toBe('rehab');
    expect(rehabProgression.body.points).toHaveLength(1);
    expect(rehabProgression.body.points[0].topWeight).toBe(20);

    const standardDistribution = await agent.get('/api/stats/distribution?metric=volume&window=30d&routineType=standard');
    expect(standardDistribution.status).toBe(200);
    expect(standardDistribution.body.routineType).toBe('standard');
    expect(standardDistribution.body.total).toBe(500);

    const sessionListResponse = await agent.get('/api/sessions?limit=10');
    expect(sessionListResponse.status).toBe(200);
    const standardSession = sessionListResponse.body.sessions.find((session) => session.id === standardSessionId);
    const rehabSession = sessionListResponse.body.sessions.find((session) => session.id === rehabSessionId);
    expect(standardSession?.routineType).toBe('standard');
    expect(rehabSession?.routineType).toBe('rehab');

    const endRehabSessionResponse = await agent
      .put(`/api/sessions/${rehabSessionId}`)
      .set('x-csrf-token', csrfToken)
      .send({ endedAt: new Date().toISOString() });
    expect(endRehabSessionResponse.status).toBe(200);

    const rehabRoutineBeforeUpdate = rehabRoutineResponse.body.routine;
    const updateRehabRoutineResponse = await agent
      .put(`/api/routines/${rehabRoutineId}`)
      .set('x-csrf-token', csrfToken)
      .send({
        name: rehabRoutineBeforeUpdate.name,
        notes: rehabRoutineBeforeUpdate.notes,
        routineType: 'standard',
        exercises: rehabRoutineBeforeUpdate.exercises.map((exercise, index) => ({
          exerciseId: exercise.exerciseId,
          equipment: exercise.equipment,
          targetSets: exercise.targetSets,
          targetReps: exercise.targetReps,
          targetRepsRange: exercise.targetRepsRange,
          targetRestSeconds: exercise.targetRestSeconds,
          targetWeight: exercise.targetWeight,
          targetBandLabel: exercise.targetBandLabel,
          notes: exercise.notes,
          position: Number.isFinite(exercise.position) ? exercise.position : index,
          supersetGroup: exercise.supersetGroup,
        })),
      });
    expect(updateRehabRoutineResponse.status).toBe(200);
    expect(updateRehabRoutineResponse.body.routine.routineType).toBe('standard');

    const rehabOverviewAfterRoutineUpdate = await agent.get('/api/stats/overview?routineType=rehab');
    expect(rehabOverviewAfterRoutineUpdate.status).toBe(200);
    expect(rehabOverviewAfterRoutineUpdate.body.summary.totalSessions).toBe(1);
    expect(rehabOverviewAfterRoutineUpdate.body.summary.totalSets).toBe(1);
  });

  it('rejects sets beyond routine target sets', async () => {
    const agent = request.agent(app);
    await registerUser(agent, 'target-sets-user');
    const csrfToken = await fetchCsrfToken(agent);

    const exerciseResponse = await agent
      .post('/api/exercises')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Strict Press', primaryMuscles: ['shoulders'], notes: '' });
    expect(exerciseResponse.status).toBe(200);
    const exerciseId = exerciseResponse.body.exercise.id;

    const routineResponse = await agent
      .post('/api/routines')
      .set('x-csrf-token', csrfToken)
      .send({
        name: 'Press Day',
        exercises: [
          {
            exerciseId,
            equipment: 'Barbell',
            targetSets: 3,
            targetReps: 5,
            targetWeight: 50,
            targetRestSeconds: 90,
            position: 0,
          },
        ],
      });
    expect(routineResponse.status).toBe(200);
    const routineId = routineResponse.body.routine.id;

    const sessionResponse = await agent
      .post('/api/sessions')
      .set('x-csrf-token', csrfToken)
      .send({ routineId, name: 'Strict Press Session' });
    expect(sessionResponse.status, JSON.stringify(sessionResponse.body)).toBe(200);
    const sessionId = sessionResponse.body.session.id;

    for (let index = 1; index <= 3; index += 1) {
      const setResponse = await agent
        .post(`/api/sessions/${sessionId}/sets`)
        .set('x-csrf-token', csrfToken)
        .send({ exerciseId, reps: 5, weight: 50 });
      expect(setResponse.status).toBe(200);
      expect(setResponse.body.set.setIndex).toBe(index);
    }

    const overflowResponse = await agent
      .post(`/api/sessions/${sessionId}/sets`)
      .set('x-csrf-token', csrfToken)
      .send({ exerciseId, reps: 5, weight: 50 });
    expect(overflowResponse.status).toBe(400);
    expect(overflowResponse.body.error).toBe('Target set count reached for this exercise.');

    const storedSetCount = db
      .prepare('SELECT COUNT(*) AS count FROM session_sets WHERE session_id = ? AND exercise_id = ?')
      .get(sessionId, exerciseId);
    expect(Number(storedSetCount.count)).toBe(3);
  });

  it('enforces and persists superset pairs across routines and sessions', async () => {
    const agent = request.agent(app);
    await registerUser(agent, 'superset-user');
    const csrfToken = await fetchCsrfToken(agent);

    const exerciseA = await agent
      .post('/api/exercises')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Flat Bench Press', primaryMuscles: ['chest'], notes: '' });
    const exerciseB = await agent
      .post('/api/exercises')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Pendlay Row', primaryMuscles: ['lats'], notes: '' });
    const exerciseC = await agent
      .post('/api/exercises')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Walking Lunge', primaryMuscles: ['quadriceps'], notes: '' });

    expect(exerciseA.status).toBe(200);
    expect(exerciseB.status).toBe(200);
    expect(exerciseC.status).toBe(200);

    const validRoutine = await agent
      .post('/api/routines')
      .set('x-csrf-token', csrfToken)
      .send({
        name: 'Upper Pair',
        exercises: [
          {
            exerciseId: exerciseA.body.exercise.id,
            equipment: 'Barbell',
            targetSets: 2,
            targetReps: 8,
            targetRestSeconds: 60,
            position: 0,
            supersetGroup: 'g1',
          },
          {
            exerciseId: exerciseB.body.exercise.id,
            equipment: 'Barbell',
            targetSets: 2,
            targetReps: 8,
            targetRestSeconds: 60,
            position: 1,
            supersetGroup: 'g1',
          },
          {
            exerciseId: exerciseC.body.exercise.id,
            equipment: 'Dumbbell',
            targetSets: 2,
            targetReps: 10,
            targetRestSeconds: 90,
            position: 2,
          },
        ],
      });
    expect(validRoutine.status).toBe(200);
    const routineId = validRoutine.body.routine.id;
    const supersetExercises = validRoutine.body.routine.exercises.filter(
      (exercise) => exercise.supersetGroup === 'g1'
    );
    expect(supersetExercises).toHaveLength(2);

    const brokenSize = await agent
      .post('/api/routines')
      .set('x-csrf-token', csrfToken)
      .send({
        name: 'Broken Size',
        exercises: [
          {
            exerciseId: exerciseA.body.exercise.id,
            equipment: 'Barbell',
            targetSets: 2,
            targetReps: 8,
            targetRestSeconds: 60,
            position: 0,
            supersetGroup: 'solo',
          },
        ],
      });
    expect(brokenSize.status).toBe(400);
    expect(brokenSize.body.error).toMatch(/exactly 2 exercises/i);

    const brokenAdjacency = await agent
      .post('/api/routines')
      .set('x-csrf-token', csrfToken)
      .send({
        name: 'Broken Adjacency',
        exercises: [
          {
            exerciseId: exerciseA.body.exercise.id,
            equipment: 'Barbell',
            targetSets: 2,
            targetReps: 8,
            targetRestSeconds: 60,
            position: 0,
            supersetGroup: 'g2',
          },
          {
            exerciseId: exerciseC.body.exercise.id,
            equipment: 'Dumbbell',
            targetSets: 2,
            targetReps: 10,
            targetRestSeconds: 90,
            position: 1,
          },
          {
            exerciseId: exerciseB.body.exercise.id,
            equipment: 'Barbell',
            targetSets: 2,
            targetReps: 8,
            targetRestSeconds: 60,
            position: 2,
            supersetGroup: 'g2',
          },
        ],
      });
    expect(brokenAdjacency.status).toBe(400);
    expect(brokenAdjacency.body.error).toMatch(/must be adjacent/i);

    const brokenTargetSets = await agent
      .post('/api/routines')
      .set('x-csrf-token', csrfToken)
      .send({
        name: 'Broken Sets',
        exercises: [
          {
            exerciseId: exerciseA.body.exercise.id,
            equipment: 'Barbell',
            targetSets: 1,
            targetReps: 8,
            targetRestSeconds: 60,
            position: 0,
            supersetGroup: 'g3',
          },
          {
            exerciseId: exerciseB.body.exercise.id,
            equipment: 'Barbell',
            targetSets: 2,
            targetReps: 8,
            targetRestSeconds: 60,
            position: 1,
            supersetGroup: 'g3',
          },
        ],
      });
    expect(brokenTargetSets.status).toBe(400);
    expect(brokenTargetSets.body.error).toMatch(/same target sets/i);

    const duplicateRoutine = await agent
      .post(`/api/routines/${routineId}/duplicate`)
      .set('x-csrf-token', csrfToken)
      .send({});
    expect(duplicateRoutine.status).toBe(200);
    expect(
      duplicateRoutine.body.routine.exercises.filter((exercise) => exercise.supersetGroup === 'g1')
    ).toHaveLength(2);

    const sourceRoutineOrder = validRoutine.body.routine.exercises.map((exercise) => exercise.id);
    const breakPairOrder = [sourceRoutineOrder[0], sourceRoutineOrder[2], sourceRoutineOrder[1]];
    const reorderInvalid = await agent
      .put(`/api/routines/${routineId}/reorder`)
      .set('x-csrf-token', csrfToken)
      .send({ exerciseOrder: breakPairOrder });
    expect(reorderInvalid.status).toBe(400);
    expect(reorderInvalid.body.error).toMatch(/break superset/i);

    const sessionResponse = await agent
      .post('/api/sessions')
      .set('x-csrf-token', csrfToken)
      .send({ routineId });
    expect(sessionResponse.status).toBe(200);
    const sessionId = sessionResponse.body.session.id;

    const sessionDetail = await agent.get(`/api/sessions/${sessionId}`);
    expect(sessionDetail.status).toBe(200);
    expect(
      sessionDetail.body.session.exercises.filter((exercise) => exercise.supersetGroup === 'g1')
    ).toHaveLength(2);
  }, 10_000);

  it('updates routine exercise target weight via dedicated endpoint', async () => {
    const agent = request.agent(app);
    await registerUser(agent, 'target-weight-update-user');
    const csrfToken = await fetchCsrfToken(agent);

    const exerciseResponse = await agent
      .post('/api/exercises')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Incline Press', primaryMuscles: ['chest'], notes: '' });
    expect(exerciseResponse.status).toBe(200);
    const exerciseId = exerciseResponse.body.exercise.id;

    const routineResponse = await agent
      .post('/api/routines')
      .set('x-csrf-token', csrfToken)
      .send({
        name: 'Press Day',
        exercises: [
          {
            exerciseId,
            equipment: 'Barbell',
            targetSets: 3,
            targetReps: 5,
            targetRestSeconds: 120,
            targetWeight: 80,
            position: 0,
          },
        ],
      });
    expect(routineResponse.status).toBe(200);
    const routineId = routineResponse.body.routine.id;
    const previousUpdatedAt = routineResponse.body.routine.updatedAt;

    const targetUpdateResponse = await agent
      .put(`/api/routines/${routineId}/exercises/${exerciseId}/target`)
      .set('x-csrf-token', csrfToken)
      .send({ equipment: 'Barbell', targetWeight: 82.5 });
    expect(targetUpdateResponse.status).toBe(200);
    expect(targetUpdateResponse.body.target.routineId).toBe(routineId);
    expect(targetUpdateResponse.body.target.exerciseId).toBe(exerciseId);
    expect(targetUpdateResponse.body.target.equipment).toBe('Barbell');
    expect(targetUpdateResponse.body.target.targetWeight).toBe(82.5);
    expect(
      new Date(targetUpdateResponse.body.target.updatedAt).getTime()
    ).toBeGreaterThanOrEqual(new Date(previousUpdatedAt).getTime());

    const storedTarget = db
      .prepare(
        `SELECT re.target_weight, r.updated_at
         FROM routine_exercises re
         JOIN routines r ON r.id = re.routine_id
         WHERE re.routine_id = ? AND re.exercise_id = ?`
      )
      .get(routineId, exerciseId);
    expect(Number(storedTarget.target_weight)).toBe(82.5);
    expect(new Date(storedTarget.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(previousUpdatedAt).getTime()
    );
  });

  it('rejects invalid or unsupported routine target weight updates', async () => {
    const agent = request.agent(app);
    await registerUser(agent, 'target-weight-rejection-user');
    const csrfToken = await fetchCsrfToken(agent);

    const exerciseResponse = await agent
      .post('/api/exercises')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Push-Up', primaryMuscles: ['chest'], notes: '' });
    expect(exerciseResponse.status).toBe(200);
    const exerciseId = exerciseResponse.body.exercise.id;

    const routineResponse = await agent
      .post('/api/routines')
      .set('x-csrf-token', csrfToken)
      .send({
        name: 'Bodyweight Day',
        exercises: [
          {
            exerciseId,
            equipment: 'Bodyweight',
            targetSets: 3,
            targetReps: 10,
            targetRestSeconds: 60,
            position: 0,
          },
        ],
      });
    expect(routineResponse.status).toBe(200);
    const routineId = routineResponse.body.routine.id;

    const unsupportedResponse = await agent
      .put(`/api/routines/${routineId}/exercises/${exerciseId}/target`)
      .set('x-csrf-token', csrfToken)
      .send({ equipment: 'Bodyweight', targetWeight: 10 });
    expect(unsupportedResponse.status).toBe(400);
    expect(unsupportedResponse.body.error).toMatch(/weighted exercises/i);

    const invalidWeightResponse = await agent
      .put(`/api/routines/${routineId}/exercises/${exerciseId}/target`)
      .set('x-csrf-token', csrfToken)
      .send({ equipment: 'Barbell', targetWeight: 0 });
    expect(invalidWeightResponse.status).toBe(400);
    expect(invalidWeightResponse.body.error).toMatch(/greater than zero/i);

    const unknownRoutineResponse = await agent
      .put(`/api/routines/999999/exercises/${exerciseId}/target`)
      .set('x-csrf-token', csrfToken)
      .send({ equipment: 'Barbell', targetWeight: 20 });
    expect(unknownRoutineResponse.status).toBe(404);
  }, 10_000);

  it('applies routine target weight updates through sync batch idempotently', async () => {
    const agent = request.agent(app);
    const user = await registerUser(agent, 'target-weight-sync-user');
    const csrfToken = await fetchCsrfToken(agent);

    const exerciseResponse = await agent
      .post('/api/exercises')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Row', primaryMuscles: ['lats'], notes: '' });
    expect(exerciseResponse.status).toBe(200);
    const exerciseId = exerciseResponse.body.exercise.id;

    const routineResponse = await agent
      .post('/api/routines')
      .set('x-csrf-token', csrfToken)
      .send({
        name: 'Pull Day',
        exercises: [
          {
            exerciseId,
            equipment: 'Barbell',
            targetSets: 3,
            targetReps: 6,
            targetRestSeconds: 120,
            targetWeight: 70,
            position: 0,
          },
        ],
      });
    expect(routineResponse.status).toBe(200);
    const routineId = routineResponse.body.routine.id;

    const syncApplyResponse = await agent
      .post('/api/sync/batch')
      .set('x-csrf-token', csrfToken)
      .send({
        operations: [
          {
            operationId: 'sync-target-weight-1',
            operationType: 'routine_exercise.target_weight.update',
            payload: {
              routineId,
              exerciseId,
              equipment: 'Barbell',
              targetWeight: 75,
            },
          },
        ],
      });
    expect(syncApplyResponse.status).toBe(200);
    expect(syncApplyResponse.body.summary.applied).toBe(1);
    expect(syncApplyResponse.body.summary.duplicates).toBe(0);
    expect(syncApplyResponse.body.results[0].status).toBe('applied');
    expect(syncApplyResponse.body.results[0].result.target.targetWeight).toBe(75);

    const syncDuplicateResponse = await agent
      .post('/api/sync/batch')
      .set('x-csrf-token', csrfToken)
      .send({
        operations: [
          {
            operationId: 'sync-target-weight-1',
            operationType: 'routine_exercise.target_weight.update',
            payload: {
              routineId,
              exerciseId,
              equipment: 'Barbell',
              targetWeight: 75,
            },
          },
        ],
      });
    expect(syncDuplicateResponse.status).toBe(200);
    expect(syncDuplicateResponse.body.summary.applied).toBe(0);
    expect(syncDuplicateResponse.body.summary.duplicates).toBe(1);
    expect(syncDuplicateResponse.body.results[0].status).toBe('duplicate');

    const storedTargetWeight = db
      .prepare(
        'SELECT target_weight FROM routine_exercises WHERE routine_id = ? AND exercise_id = ?'
      )
      .get(routineId, exerciseId);
    expect(Number(storedTargetWeight.target_weight)).toBe(75);

    const persistedSync = db
      .prepare(
        'SELECT COUNT(*) AS count FROM sync_operations WHERE user_id = ? AND operation_id = ?'
      )
      .get(user.id, 'sync-target-weight-1');
    expect(persistedSync.count).toBe(1);
  }, 10_000);

  it('covers exercises, routines, sessions, sets, weights, stats, export and import', async () => {
    const owner = request.agent(app);
    const ownerUser = await registerUser(owner, 'owner');
    const csrfToken = await fetchCsrfToken(owner);

    const sourceExercise = await owner
      .post('/api/exercises')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Bench Press', primaryMuscles: ['chest'], notes: 'Flat barbell' });
    expect(sourceExercise.status).toBe(200);
    expect(sourceExercise.body.exercise.primaryMuscles[0]).toBe('chest');

    const targetExercise = await owner
      .post('/api/exercises')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Barbell Bench Press', primaryMuscles: ['chest'], notes: '' });
    expect(targetExercise.status).toBe(200);

    const librarySearch = await owner.get('/api/exercise-library?q=bench&limit=5');
    expect(librarySearch.status).toBe(200);
    expect(Array.isArray(librarySearch.body.results)).toBe(true);
    const addCandidate = librarySearch.body.results.find((item) => !item.alreadyAdded);
    if (addCandidate) {
      const addFromLibrary = await owner
        .post(`/api/exercise-library/${encodeURIComponent(addCandidate.forkId)}/add`)
        .set('x-csrf-token', csrfToken)
        .send({});
      expect(addFromLibrary.status).toBe(200);
      expect(addFromLibrary.body.exercise.forkId).toBe(addCandidate.forkId);
      expect(Array.isArray(addFromLibrary.body.exercise.primaryMuscles)).toBe(true);
    }

    const routineResponse = await owner
      .post('/api/routines')
      .set('x-csrf-token', csrfToken)
      .send({
        name: 'Push Day',
        routineType: 'rehab',
        notes: 'Strength focus',
        exercises: [
          {
            exerciseId: sourceExercise.body.exercise.id,
            equipment: 'Barbell',
            targetSets: 3,
            targetReps: 5,
            targetRestSeconds: 120,
            targetWeight: 80,
            notes: 'Keep tight setup',
            position: 0,
          },
          {
            exerciseId: targetExercise.body.exercise.id,
            equipment: 'Band',
            targetSets: 3,
            targetRepsRange: '20-24',
            targetRestSeconds: 75,
            targetBandLabel: '20 lb',
            notes: 'Accessory',
            position: 1,
          },
        ],
      });
    expect(routineResponse.status).toBe(200);
    expect(routineResponse.body.routine.exercises[1].targetRepsRange).toBe('20-24');
    expect(routineResponse.body.routine.exercises[1].targetBandLabel).toBe('20 lb');
    expect(routineResponse.body.routine.exercises[0].targetRestSeconds).toBe(120);
    expect(routineResponse.body.routine.exercises[1].targetRestSeconds).toBe(75);
    expect(routineResponse.body.routine.routineType).toBe('rehab');
    const routineId = routineResponse.body.routine.id;

    const duplicateRoutine = await owner
      .post(`/api/routines/${routineId}/duplicate`)
      .set('x-csrf-token', csrfToken)
      .send({});
    expect(duplicateRoutine.status).toBe(200);
    expect(duplicateRoutine.body.routine.name).toContain('(Copy)');
    expect(duplicateRoutine.body.routine.exercises.length).toBe(2);

    const originalOrder = routineResponse.body.routine.exercises.map((item) => item.id);
    const reordered = [originalOrder[1], originalOrder[0]];
    const reorderRoutine = await owner
      .put(`/api/routines/${routineId}/reorder`)
      .set('x-csrf-token', csrfToken)
      .send({ exerciseOrder: reordered });
    expect(reorderRoutine.status).toBe(200);
    expect(reorderRoutine.body.routine.exercises[0].id).toBe(reordered[0]);

    const sessionResponse = await owner
      .post('/api/sessions')
      .set('x-csrf-token', csrfToken)
      .send({ routineId, name: 'Monday Push' });
    expect(sessionResponse.status).toBe(200);
    expect(sessionResponse.body.session.routineType).toBe('rehab');
    const sessionExerciseWithNotes = sessionResponse.body.session.exercises.find(
      (exercise) => exercise.exerciseId === sourceExercise.body.exercise.id
    );
    expect(sessionExerciseWithNotes?.notes).toBe('Keep tight setup');
    const sessionId = sessionResponse.body.session.id;
    const exerciseStartedAt = new Date().toISOString();
    const exerciseStart = await owner
      .post(`/api/sessions/${sessionId}/exercises/${sourceExercise.body.exercise.id}/start`)
      .set('x-csrf-token', csrfToken)
      .send({ startedAt: exerciseStartedAt });
    expect(exerciseStart.status).toBe(200);
    expect(exerciseStart.body.exerciseProgress.status).toBe('in_progress');
    expect(exerciseStart.body.exerciseProgress.startedAt).toBe(exerciseStartedAt);

    const setStartedAt = new Date(Date.now() + 10_000).toISOString();
    const setCompletedAt = new Date(Date.now() + 20_000).toISOString();

    const setResponse = await owner
      .post(`/api/sessions/${sessionId}/sets`)
      .set('x-csrf-token', csrfToken)
      .send({
        exerciseId: sourceExercise.body.exercise.id,
        reps: 5,
        weight: 100,
        startedAt: setStartedAt,
        completedAt: setCompletedAt,
      });
    expect(setResponse.status).toBe(200);
    const setId = setResponse.body.set.id;
    expect(setResponse.body.set.startedAt).toBe(setStartedAt);
    expect(setResponse.body.set.completedAt).toBe(setCompletedAt);
    expect(setResponse.body.exerciseProgress.status).toBe('in_progress');

    const exerciseComplete = await owner
      .post(`/api/sessions/${sessionId}/exercises/${sourceExercise.body.exercise.id}/complete`)
      .set('x-csrf-token', csrfToken)
      .send({});
    expect(exerciseComplete.status).toBe(200);
    expect(exerciseComplete.body.exerciseProgress.status).toBe('completed');

    const createdBand = await owner
      .post('/api/bands')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Green Loop' });
    expect(createdBand.status).toBe(200);

    const listBands = await owner.get('/api/bands');
    expect(listBands.status).toBe(200);
    expect(listBands.body.bands.some((band) => band.name === 'Green Loop')).toBe(true);

    const syncBatch = await owner
      .post('/api/sync/batch')
      .set('x-csrf-token', csrfToken)
      .send({
        operations: [
          {
            operationId: 'sync-ex-start-1',
            operationType: 'session_exercise.start',
            payload: {
              sessionId,
              exerciseId: targetExercise.body.exercise.id,
              startedAt: new Date().toISOString(),
            },
          },
          {
            operationId: 'sync-set-1',
            operationType: 'session_set.create',
            payload: {
              sessionId,
              exerciseId: sourceExercise.body.exercise.id,
              reps: 4,
              weight: 95,
              bandLabel: 'Green Loop',
            },
          },
        ],
      });
    expect(syncBatch.status).toBe(200);
    expect(syncBatch.body.summary.applied).toBe(2);
    expect(syncBatch.body.summary.duplicates).toBe(0);
    const syncSetResult = syncBatch.body.results.find(
      (result) => result.operationType === 'session_set.create'
    );
    expect(syncSetResult.status).toBe('applied');
    expect(syncSetResult.result.set.bandLabel).toBe('Green Loop');

    const syncBatchDuplicate = await owner
      .post('/api/sync/batch')
      .set('x-csrf-token', csrfToken)
      .send({
        operations: [
          {
            operationId: 'sync-set-1',
            operationType: 'session_set.create',
            payload: {
              sessionId,
              exerciseId: sourceExercise.body.exercise.id,
              reps: 4,
              weight: 95,
            },
          },
        ],
      });
    expect(syncBatchDuplicate.status).toBe(200);
    expect(syncBatchDuplicate.body.summary.applied).toBe(0);
    expect(syncBatchDuplicate.body.summary.duplicates).toBe(1);
    expect(syncBatchDuplicate.body.results[0].status).toBe('duplicate');

    const persistedSync = db
      .prepare(
        'SELECT COUNT(*) AS count FROM sync_operations WHERE user_id = ? AND operation_id = ?'
      )
      .get(ownerUser.id, 'sync-set-1');
    expect(persistedSync.count).toBe(1);

    const deleteBand = await owner
      .delete(`/api/bands/${createdBand.body.band.id}`)
      .set('x-csrf-token', csrfToken)
      .send({});
    expect(deleteBand.status).toBe(200);

    const updateSet = await owner
      .put(`/api/sets/${setId}`)
      .set('x-csrf-token', csrfToken)
      .send({ reps: 6, weight: 102.5 });
    expect(updateSet.status).toBe(200);
    expect(updateSet.body.set.id).toBe(setId);
    expect(updateSet.body.set.reps).toBe(6);
    expect(updateSet.body.set.weight).toBe(102.5);

    const impactBeforeMerge = await owner.get(
      `/api/exercises/${sourceExercise.body.exercise.id}/impact`
    );
    expect(impactBeforeMerge.status).toBe(200);
    expect(impactBeforeMerge.body.impact.routineReferences).toBeGreaterThanOrEqual(1);
    expect(impactBeforeMerge.body.impact.setReferences).toBeGreaterThanOrEqual(1);

    const mergeResponse = await owner
      .post('/api/exercises/merge')
      .set('x-csrf-token', csrfToken)
      .send({
        sourceId: sourceExercise.body.exercise.id,
        targetId: targetExercise.body.exercise.id,
      });
    expect(mergeResponse.status).toBe(200);
    expect(mergeResponse.body.ok).toBe(true);
    expect(mergeResponse.body.movedRoutineLinks).toBeGreaterThanOrEqual(1);
    expect(mergeResponse.body.movedSetLinks).toBeGreaterThanOrEqual(1);
    expect(mergeResponse.body.impact.routineReferences).toBeGreaterThanOrEqual(1);
    expect(mergeResponse.body.impact.setReferences).toBeGreaterThanOrEqual(1);

    const routineDetail = await owner.get(`/api/routines/${routineId}`);
    expect(routineDetail.status).toBe(200);
    expect(routineDetail.body.routine.exercises[0].exerciseId).toBe(
      targetExercise.body.exercise.id
    );

    const archivedExercises = await owner.get('/api/exercises?includeArchived=true');
    expect(archivedExercises.status).toBe(200);
    const mergedSource = archivedExercises.body.exercises.find(
      (exercise) => exercise.id === sourceExercise.body.exercise.id
    );
    expect(mergedSource.archivedAt).toBeTypeOf('string');
    expect(mergedSource.mergedIntoId).toBe(targetExercise.body.exercise.id);
    expect(mergedSource.mergedIntoName).toBe('Barbell Bench Press');

    const cannotUnarchiveMerged = await owner
      .post(`/api/exercises/${sourceExercise.body.exercise.id}/unarchive`)
      .set('x-csrf-token', csrfToken)
      .send({});
    expect(cannotUnarchiveMerged.status).toBe(409);

    const archiveCandidate = await owner
      .post('/api/exercises')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Tempo Push-Up', primaryMuscles: ['chest'], notes: '' });
    expect(archiveCandidate.status).toBe(200);
    const archiveCandidateId = archiveCandidate.body.exercise.id;

    const archiveCandidateResponse = await owner
      .delete(`/api/exercises/${archiveCandidateId}`)
      .set('x-csrf-token', csrfToken)
      .send({});
    expect(archiveCandidateResponse.status).toBe(200);

    const archivedOnly = await owner.get('/api/exercises?mode=archived');
    expect(archivedOnly.status).toBe(200);
    expect(archivedOnly.body.exercises.some((exercise) => exercise.id === archiveCandidateId)).toBe(true);

    const unarchiveCandidate = await owner
      .post(`/api/exercises/${archiveCandidateId}/unarchive`)
      .set('x-csrf-token', csrfToken)
      .send({});
    expect(unarchiveCandidate.status).toBe(200);

    const activeOnly = await owner.get('/api/exercises?mode=active');
    expect(activeOnly.status).toBe(200);
    expect(activeOnly.body.exercises.some((exercise) => exercise.id === archiveCandidateId)).toBe(true);

    const allExercises = await owner.get('/api/exercises?mode=all');
    expect(allExercises.status).toBe(200);
    expect(allExercises.body.exercises.length).toBeGreaterThanOrEqual(activeOnly.body.exercises.length);

    const sessionDetail = await owner.get(`/api/sessions/${sessionId}`);
    expect(sessionDetail.status).toBe(200);
    expect(
      sessionDetail.body.session.exercises.find(
        (exercise) => exercise.exerciseId === targetExercise.body.exercise.id
      )
    ).toBeTruthy();
    expect(sessionDetail.body.session.exercises[0].exerciseId).toBe(
      targetExercise.body.exercise.id
    );

    const weightResponse = await owner
      .post('/api/weights')
      .set('x-csrf-token', csrfToken)
      .send({ weight: 81.4, measuredAt: new Date().toISOString() });
    expect(weightResponse.status).toBe(200);

    const statsResponse = await owner.get('/api/stats/overview');
    expect(statsResponse.status).toBe(200);
    expect(statsResponse.body.summary.totalSessions).toBeGreaterThanOrEqual(1);
    expect(statsResponse.body.summary.totalSets).toBeGreaterThanOrEqual(1);
    expect(typeof statsResponse.body.summary.sessionsWeek).toBe('number');
    expect(typeof statsResponse.body.summary.sessionsMonth).toBe('number');
    expect(typeof statsResponse.body.summary.uniqueExercisesWeek).toBe('number');
    expect(typeof statsResponse.body.summary.uniqueExercisesMonth).toBe('number');
    expect(typeof statsResponse.body.summary.avgSetWeightWeek).toBe('number');
    expect(typeof statsResponse.body.summary.avgSetWeightMonth).toBe('number');
    expect(typeof statsResponse.body.summary.avgSessionsPerWeek).toBe('number');
    expect(typeof statsResponse.body.summary.timeSpentWeekMinutes).toBe('number');
    expect(typeof statsResponse.body.summary.avgSessionTimeMinutes).toBe('number');

    const progression = await owner.get(
      `/api/stats/progression?exerciseId=${targetExercise.body.exercise.id}&window=90d`
    );
    expect(progression.status).toBe(200);
    expect(progression.body.exercise.id).toBe(targetExercise.body.exercise.id);
    expect(Array.isArray(progression.body.points)).toBe(true);
    expect(progression.body.points.length).toBeGreaterThanOrEqual(1);

    const distribution = await owner.get('/api/stats/distribution?metric=volume&window=30d');
    expect(distribution.status).toBe(200);
    expect(distribution.body.metric).toBe('volume');
    expect(Array.isArray(distribution.body.rows)).toBe(true);
    expect(distribution.body.rows.length).toBeGreaterThanOrEqual(1);

    const drilldownMuscle = distribution.body.rows[0].bucket;
    const distributionDrilldown = await owner.get(
      `/api/stats/distribution/drilldown?muscle=${encodeURIComponent(drilldownMuscle)}&metric=volume&window=30d`
    );
    expect(distributionDrilldown.status).toBe(200);
    expect(distributionDrilldown.body.metric).toBe('volume');
    expect(distributionDrilldown.body.muscle).toBe(drilldownMuscle);
    expect(Array.isArray(distributionDrilldown.body.rows)).toBe(true);
    expect(typeof distributionDrilldown.body.summary.totalExercises).toBe('number');
    expect(typeof distributionDrilldown.body.summary.totalSets).toBe('number');
    expect(typeof distributionDrilldown.body.summary.totalVolume).toBe('number');
    expect(
      distributionDrilldown.body.rows.every(
        (row) =>
          typeof row.exerciseId === 'number' &&
          typeof row.name === 'string' &&
          typeof row.setCount === 'number' &&
          typeof row.volume === 'number' &&
          typeof row.value === 'number' &&
          typeof row.share === 'number'
      )
    ).toBe(true);

    const bodyweightTrend = await owner.get('/api/stats/bodyweight-trend?window=90d');
    expect(bodyweightTrend.status).toBe(200);
    expect(Array.isArray(bodyweightTrend.body.points)).toBe(true);
    expect(bodyweightTrend.body.points.length).toBeGreaterThanOrEqual(1);

    const weeklyTimeseries = await owner.get('/api/stats/timeseries?bucket=week&window=180d');
    expect(weeklyTimeseries.status).toBe(200);
    expect(weeklyTimeseries.body.bucket).toBe('week');
    expect(weeklyTimeseries.body.windowDays).toBe(180);
    expect(Array.isArray(weeklyTimeseries.body.points)).toBe(true);
    expect(weeklyTimeseries.body.points.length).toBeGreaterThanOrEqual(1);
    expect(typeof weeklyTimeseries.body.summary.totalSets).toBe('number');
    expect(typeof weeklyTimeseries.body.summary.totalVolume).toBe('number');
    expect(typeof weeklyTimeseries.body.summary.totalSessions).toBe('number');
    expect(typeof weeklyTimeseries.body.summary.avgSetsPerBucket).toBe('number');

    const monthlyTimeseries = await owner.get('/api/stats/timeseries?bucket=month&window=365d');
    expect(monthlyTimeseries.status).toBe(200);
    expect(monthlyTimeseries.body.bucket).toBe('month');
    expect(monthlyTimeseries.body.windowDays).toBe(365);
    expect(Array.isArray(monthlyTimeseries.body.points)).toBe(true);
    expect(monthlyTimeseries.body.points.length).toBeGreaterThanOrEqual(1);
    expect(
      monthlyTimeseries.body.points.some(
        (point) =>
          typeof point.bucketKey === 'string' &&
          typeof point.label === 'string' &&
          typeof point.startAt === 'string' &&
          typeof point.sets === 'number' &&
          typeof point.volume === 'number' &&
          typeof point.sessions === 'number' &&
          typeof point.uniqueExercises === 'number' &&
          typeof point.avgSetWeight === 'number'
      )
    ).toBe(true);

    const fallbackTimeseries = await owner.get('/api/stats/timeseries?bucket=year&window=999d');
    expect(fallbackTimeseries.status).toBe(200);
    expect(fallbackTimeseries.body.bucket).toBe('week');
    expect(fallbackTimeseries.body.windowDays).toBe(90);
    expect(Array.isArray(fallbackTimeseries.body.points)).toBe(true);
    expect(fallbackTimeseries.body.points.length).toBeGreaterThanOrEqual(1);

    const exportResponse = await owner.get('/api/export');
    expect(exportResponse.status).toBe(200);
    expect(exportResponse.body.version).toBe(9);
    expect(exportResponse.body.exercises.length).toBeGreaterThanOrEqual(1);
    expect(exportResponse.body.sessions.length).toBeGreaterThanOrEqual(1);
    expect(exportResponse.body.routines[0]?.routineType).toBeTypeOf('string');
    expect(exportResponse.body.sessions[0]?.routineType).toBeTypeOf('string');

    const ownerCountsBeforeRoundTrip = {
      exercises: Number(db.prepare('SELECT COUNT(*) AS count FROM exercises').get()?.count || 0),
      routines: Number(
        db.prepare('SELECT COUNT(*) AS count FROM routines WHERE user_id = ?').get(ownerUser.id)
          ?.count || 0
      ),
      sessions: Number(
        db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?').get(ownerUser.id)
          ?.count || 0
      ),
      weights: Number(
        db
          .prepare('SELECT COUNT(*) AS count FROM bodyweight_entries WHERE user_id = ?')
          .get(ownerUser.id)?.count || 0
      ),
    };

    const ownerValidateRoundTrip = await owner
      .post('/api/import/validate')
      .set('x-csrf-token', csrfToken)
      .send(exportResponse.body);
    expect(ownerValidateRoundTrip.status).toBe(200);
    expect(ownerValidateRoundTrip.body.valid).toBe(true);
    expect(ownerValidateRoundTrip.body.summary.toCreate.exercises).toBe(0);
    expect(ownerValidateRoundTrip.body.summary.toCreate.routines).toBe(0);
    expect(ownerValidateRoundTrip.body.summary.toCreate.sessions).toBe(0);
    expect(ownerValidateRoundTrip.body.summary.toCreate.weights).toBe(0);
    expect(ownerValidateRoundTrip.body.summary.toReuse.exercises).toBeGreaterThanOrEqual(1);
    expect(ownerValidateRoundTrip.body.summary.toReuse.routines).toBeGreaterThanOrEqual(1);
    expect(ownerValidateRoundTrip.body.summary.toReuse.sessions).toBeGreaterThanOrEqual(1);
    expect(ownerValidateRoundTrip.body.summary.toReuse.weights).toBeGreaterThanOrEqual(1);

    const ownerImportRoundTrip = await owner
      .post('/api/import')
      .set('x-csrf-token', csrfToken)
      .send(exportResponse.body);
    expect(ownerImportRoundTrip.status).toBe(200);
    expect(ownerImportRoundTrip.body.ok).toBe(true);
    expect(ownerImportRoundTrip.body.importedCount.exercises).toBe(0);
    expect(ownerImportRoundTrip.body.importedCount.routines).toBe(0);
    expect(ownerImportRoundTrip.body.importedCount.sessions).toBe(0);
    expect(ownerImportRoundTrip.body.importedCount.weights).toBe(0);

    const ownerCountsAfterRoundTrip = {
      exercises: Number(db.prepare('SELECT COUNT(*) AS count FROM exercises').get()?.count || 0),
      routines: Number(
        db.prepare('SELECT COUNT(*) AS count FROM routines WHERE user_id = ?').get(ownerUser.id)
          ?.count || 0
      ),
      sessions: Number(
        db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?').get(ownerUser.id)
          ?.count || 0
      ),
      weights: Number(
        db
          .prepare('SELECT COUNT(*) AS count FROM bodyweight_entries WHERE user_id = ?')
          .get(ownerUser.id)?.count || 0
      ),
    };
    expect(ownerCountsAfterRoundTrip).toEqual(ownerCountsBeforeRoundTrip);

    const importer = request.agent(app);
    await registerUser(importer, 'importer');
    const importerCsrf = await fetchCsrfToken(importer);

    const validateResponse = await importer
      .post('/api/import/validate')
      .set('x-csrf-token', importerCsrf)
      .send(exportResponse.body);
    expect(validateResponse.status).toBe(200);
    expect(validateResponse.body.valid).toBe(true);
    expect(validateResponse.body.summary.expectedVersion).toBe(9);
    expect(validateResponse.body.summary.toCreate.routines).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(validateResponse.body.summary.conflicts.existingExerciseNames)).toBe(true);

    const invalidVersionImport = await importer
      .post('/api/import')
      .set('x-csrf-token', importerCsrf)
      .send({ ...exportResponse.body, version: 2 });
    expect(invalidVersionImport.status).toBe(400);
    expect(invalidVersionImport.body.error).toBe('Invalid import file');
    expect(invalidVersionImport.body.validation.valid).toBe(false);
    expect(invalidVersionImport.body.validation.summary.expectedVersion).toBe(9);

    const importResponse = await importer
      .post('/api/import')
      .set('x-csrf-token', importerCsrf)
      .send(exportResponse.body);
    expect(importResponse.status).toBe(200);
    expect(importResponse.body.ok).toBe(true);
    expect(importResponse.body.importedCount.routines).toBeGreaterThanOrEqual(1);
    expect(importResponse.body.importedCount.sessions).toBeGreaterThanOrEqual(1);
    expect(importResponse.body.validationSummary.expectedVersion).toBe(9);
    expect(Array.isArray(importResponse.body.warnings)).toBe(true);

    const importedSessions = await importer.get('/api/sessions');
    expect(importedSessions.status).toBe(200);
    expect(importedSessions.body.sessions.length).toBeGreaterThanOrEqual(1);
  });

  it('computes overview volume windows from set timestamps instead of session start date', async () => {
    const agent = request.agent(app);
    await registerUser(agent, 'stats-window-user');
    const csrfToken = await fetchCsrfToken(agent);

    const exerciseResponse = await agent
      .post('/api/exercises')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Stats Window Lift', primaryMuscles: ['chest'], notes: '' });
    expect(exerciseResponse.status).toBe(200);
    const exerciseId = exerciseResponse.body.exercise.id;

    const routineResponse = await agent
      .post('/api/routines')
      .set('x-csrf-token', csrfToken)
      .send({
        name: 'Stats Window Routine',
        exercises: [
          {
            exerciseId,
            equipment: 'Barbell',
            targetSets: 1,
            targetReps: 5,
            targetRestSeconds: 60,
            targetWeight: 100,
            position: 0,
          },
        ],
      });
    expect(routineResponse.status).toBe(200);
    const routineId = routineResponse.body.routine.id;

    const sessionResponse = await agent
      .post('/api/sessions')
      .set('x-csrf-token', csrfToken)
      .send({ routineId, name: 'Backdated Session' });
    expect(sessionResponse.status).toBe(200);
    const sessionId = sessionResponse.body.session.id;

    const now = new Date().toISOString();
    const setResponse = await agent
      .post(`/api/sessions/${sessionId}/sets`)
      .set('x-csrf-token', csrfToken)
      .send({
        exerciseId,
        reps: 5,
        weight: 100,
        startedAt: now,
        completedAt: now,
      });
    expect(setResponse.status).toBe(200);

    const oldDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(
      `UPDATE sessions
       SET started_at = ?, ended_at = ?
       WHERE id = ?`
    ).run(oldDate, oldDate, sessionId);

    const statsResponse = await agent.get('/api/stats/overview');
    expect(statsResponse.status).toBe(200);
    expect(statsResponse.body.summary.totalSets).toBe(1);
    expect(statsResponse.body.summary.setsWeek).toBe(1);
    expect(statsResponse.body.summary.setsMonth).toBe(1);
    expect(statsResponse.body.summary.volumeWeek).toBe(500);
    expect(statsResponse.body.summary.volumeMonth).toBe(500);
    expect(
      statsResponse.body.weeklySets.some((row) => Number(row.sets) === 1)
    ).toBe(true);
    expect(
      statsResponse.body.weeklyVolume.some((row) => Number(row.volume) === 500)
    ).toBe(true);
  });
});
