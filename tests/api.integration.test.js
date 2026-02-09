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

  it('requires an owned routine when starting a session', async () => {
    const owner = request.agent(app);
    await registerUser(owner, 'owner-routine');
    const ownerCsrf = await fetchCsrfToken(owner);

    const routineResponse = await owner
      .post('/api/routines')
      .set('x-csrf-token', ownerCsrf)
      .send({ name: 'Routine A', exercises: [] });
    expect(routineResponse.status).toBe(200);
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
  });

  it('rejects sets beyond routine target sets', async () => {
    const agent = request.agent(app);
    await registerUser(agent, 'target-sets-user');
    const csrfToken = await fetchCsrfToken(agent);

    const exerciseResponse = await agent
      .post('/api/exercises')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Strict Press', muscleGroup: 'Push', notes: '' });
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
      .send({ name: 'Flat Bench Press', muscleGroup: 'Push', notes: '' });
    const exerciseB = await agent
      .post('/api/exercises')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Pendlay Row', muscleGroup: 'Pull', notes: '' });
    const exerciseC = await agent
      .post('/api/exercises')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Walking Lunge', muscleGroup: 'Legs', notes: '' });

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
  });

  it('covers exercises, routines, sessions, sets, weights, stats, export and import', async () => {
    const owner = request.agent(app);
    const ownerUser = await registerUser(owner, 'owner');
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
    expect(exportResponse.body.version).toBe(5);
    expect(exportResponse.body.exercises.length).toBeGreaterThanOrEqual(1);
    expect(exportResponse.body.sessions.length).toBeGreaterThanOrEqual(1);

    const importer = request.agent(app);
    await registerUser(importer, 'importer');
    const importerCsrf = await fetchCsrfToken(importer);

    const validateResponse = await importer
      .post('/api/import/validate')
      .set('x-csrf-token', importerCsrf)
      .send(exportResponse.body);
    expect(validateResponse.status).toBe(200);
    expect(validateResponse.body.valid).toBe(true);
    expect(validateResponse.body.summary.expectedVersion).toBe(5);
    expect(validateResponse.body.summary.toCreate.routines).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(validateResponse.body.summary.conflicts.existingExerciseNames)).toBe(true);

    const invalidVersionImport = await importer
      .post('/api/import')
      .set('x-csrf-token', importerCsrf)
      .send({ ...exportResponse.body, version: 2 });
    expect(invalidVersionImport.status).toBe(400);
    expect(invalidVersionImport.body.error).toBe('Invalid import file');
    expect(invalidVersionImport.body.validation.valid).toBe(false);
    expect(invalidVersionImport.body.validation.summary.expectedVersion).toBe(5);

    const importResponse = await importer
      .post('/api/import')
      .set('x-csrf-token', importerCsrf)
      .send(exportResponse.body);
    expect(importResponse.status).toBe(200);
    expect(importResponse.body.ok).toBe(true);
    expect(importResponse.body.importedCount.routines).toBeGreaterThanOrEqual(1);
    expect(importResponse.body.importedCount.sessions).toBeGreaterThanOrEqual(1);
    expect(importResponse.body.validationSummary.expectedVersion).toBe(5);
    expect(Array.isArray(importResponse.body.warnings)).toBe(true);

    const importedSessions = await importer.get('/api/sessions');
    expect(importedSessions.status).toBe(200);
    expect(importedSessions.body.sessions.length).toBeGreaterThanOrEqual(1);
  });
});
