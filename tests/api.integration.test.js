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
  it('applies migrations with checksums and reversible SQL metadata', () => {
    const rows = db
      .prepare('SELECT id, checksum, down_sql FROM schema_migrations ORDER BY id')
      .all();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const ids = rows.map((row) => row.id);
    expect(ids).toContain('0001_initial_schema.sql');
    expect(ids).toContain('0002_add_sync_operations.sql');
    expect(rows.every((row) => typeof row.checksum === 'string' && row.checksum.length === 64)).toBe(true);
    expect(rows.every((row) => typeof row.down_sql === 'string' && row.down_sql.length > 0)).toBe(true);

    const syncColumns = db
      .prepare('PRAGMA table_info(sync_operations)')
      .all()
      .map((column) => column.name);
    expect(syncColumns).toContain('operation_id');
    expect(syncColumns).toContain('operation_type');
    expect(syncColumns).toContain('payload');
  });

  it('rejects mutating requests without CSRF token', async () => {
    const agent = request.agent(app);
    const response = await agent
      .post('/api/auth/register')
      .send({ username: 'coach', password: 'secret123' });
    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/CSRF/i);
  });

  it('supports auth lifecycle and password updates', async () => {
    const agent = request.agent(app);
    await registerUser(agent, 'coach');

    const whoAmI = await agent.get('/api/auth/me');
    expect(whoAmI.status).toBe(200);
    expect(whoAmI.body.user?.username).toBe('coach');

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
      .send({ username: 'coach', password: 'secret456' });
    expect(login.status).toBe(200);
    expect(login.body.user?.username).toBe('coach');
  });

  it('covers exercises, routines, sessions, sets, weights, stats, export and import', async () => {
    const owner = request.agent(app);
    await registerUser(owner, 'owner');
    const csrfToken = await fetchCsrfToken(owner);

    const sourceExercise = await owner
      .post('/api/exercises')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Bench Press', muscleGroup: 'Push', notes: 'Flat barbell' });
    expect(sourceExercise.status).toBe(200);

    const targetExercise = await owner
      .post('/api/exercises')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Barbell Bench Press', muscleGroup: 'Push', notes: '' });
    expect(targetExercise.status).toBe(200);

    const routineResponse = await owner
      .post('/api/routines')
      .set('x-csrf-token', csrfToken)
      .send({
        name: 'Push Day',
        notes: 'Strength focus',
        exercises: [
          {
            exerciseId: sourceExercise.body.exercise.id,
            equipment: 'Barbell',
            targetSets: 3,
            targetReps: 5,
            targetWeight: 80,
            notes: 'Keep tight setup',
            position: 0,
          },
          {
            exerciseId: targetExercise.body.exercise.id,
            equipment: 'Dumbbell',
            targetSets: 4,
            targetReps: 8,
            targetWeight: 35,
            notes: 'Accessory',
            position: 1,
          },
        ],
      });
    expect(routineResponse.status).toBe(200);
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
    const sessionId = sessionResponse.body.session.id;

    const setResponse = await owner
      .post(`/api/sessions/${sessionId}/sets`)
      .set('x-csrf-token', csrfToken)
      .send({
        exerciseId: sourceExercise.body.exercise.id,
        reps: 5,
        weight: 100,
      });
    expect(setResponse.status).toBe(200);
    const setId = setResponse.body.set.id;

    const updateSet = await owner
      .put(`/api/sets/${setId}`)
      .set('x-csrf-token', csrfToken)
      .send({ reps: 6, rpe: 8.5 });
    expect(updateSet.status).toBe(200);
    expect(updateSet.body.set.id).toBe(setId);
    expect(updateSet.body.set.reps).toBe(6);
    expect(updateSet.body.set.rpe).toBe(8.5);

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
      .send({ name: 'Tempo Push-Up', muscleGroup: 'Push', notes: '' });
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

    const bodyweightTrend = await owner.get('/api/stats/bodyweight-trend?window=90d');
    expect(bodyweightTrend.status).toBe(200);
    expect(Array.isArray(bodyweightTrend.body.points)).toBe(true);
    expect(bodyweightTrend.body.points.length).toBeGreaterThanOrEqual(1);

    const exportResponse = await owner.get('/api/export');
    expect(exportResponse.status).toBe(200);
    expect(exportResponse.body.version).toBe(3);
    expect(exportResponse.body.exercises.length).toBeGreaterThanOrEqual(1);
    expect(exportResponse.body.sessions.length).toBeGreaterThanOrEqual(1);

    const importer = request.agent(app);
    await registerUser(importer, 'importer');
    const importerCsrf = await fetchCsrfToken(importer);

    const importResponse = await importer
      .post('/api/import')
      .set('x-csrf-token', importerCsrf)
      .send(exportResponse.body);
    expect(importResponse.status).toBe(200);
    expect(importResponse.body.ok).toBe(true);
    expect(importResponse.body.importedCount.routines).toBeGreaterThanOrEqual(1);
    expect(importResponse.body.importedCount.sessions).toBeGreaterThanOrEqual(1);

    const importedSessions = await importer.get('/api/sessions');
    expect(importedSessions.status).toBe(200);
    expect(importedSessions.body.sessions.length).toBeGreaterThanOrEqual(1);
  });
});
