import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { setupApiIntegrationSuite } from '../helpers/api-integration-helpers.js';

const { app, db, fetchCsrfToken, registerUser } = await setupApiIntegrationSuite('routines-sessions');

describe('API integration routines and sessions', () => {
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

  it('saves routine updates after completed sessions with duplicate routine exercises', async () => {
    const agent = request.agent(app);
    await registerUser(agent, 'routine-duplicate-history-user');
    const csrfToken = await fetchCsrfToken(agent);

    const exerciseResponse = await agent
      .post('/api/exercises')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Paused Bench Press', primaryMuscles: ['chest'], notes: '' });
    expect(exerciseResponse.status).toBe(200);
    const exerciseId = exerciseResponse.body.exercise.id;

    const routineResponse = await agent
      .post('/api/routines')
      .set('x-csrf-token', csrfToken)
      .send({
        name: 'Duplicate Slot Routine',
        notes: 'Two slots for the same lift',
        exercises: [
          {
            exerciseId,
            equipment: 'Barbell',
            targetSets: 3,
            targetReps: 5,
            targetWeight: 80,
            targetRestSeconds: 120,
            position: 0,
          },
          {
            exerciseId,
            equipment: 'Dumbbell',
            targetSets: 3,
            targetReps: 10,
            targetWeight: 30,
            targetRestSeconds: 90,
            position: 1,
          },
        ],
      });
    expect(routineResponse.status).toBe(200);
    const routineId = routineResponse.body.routine.id;

    const startSessionResponse = await agent
      .post('/api/sessions')
      .set('x-csrf-token', csrfToken)
      .send({ routineId, name: 'Duplicate Slot Session' });
    expect(startSessionResponse.status).toBe(200);
    const sessionId = startSessionResponse.body.session.id;
    const firstSessionExercise = startSessionResponse.body.session.exercises[0];
    expect(firstSessionExercise?.routineExerciseId).toBeTypeOf('number');

    const addSetResponse = await agent
      .post(`/api/sessions/${sessionId}/sets`)
      .set('x-csrf-token', csrfToken)
      .send({
        exerciseId,
        routineExerciseId: firstSessionExercise.routineExerciseId,
        reps: 5,
        weight: 80,
      });
    expect(addSetResponse.status).toBe(200);

    const finishSessionResponse = await agent
      .put(`/api/sessions/${sessionId}`)
      .set('x-csrf-token', csrfToken)
      .send({ endedAt: new Date().toISOString() });
    expect(finishSessionResponse.status).toBe(200);

    const updateRoutineResponse = await agent
      .put(`/api/routines/${routineId}`)
      .set('x-csrf-token', csrfToken)
      .send({
        name: 'Duplicate Slot Routine (Updated)',
        notes: 'Now with one slot',
        exercises: [
          {
            exerciseId,
            equipment: 'Barbell',
            targetSets: 3,
            targetReps: 6,
            targetWeight: 82.5,
            targetRestSeconds: 90,
            position: 0,
          },
        ],
      });
    expect(updateRoutineResponse.status).toBe(200);
    expect(updateRoutineResponse.body.routine.exercises).toHaveLength(1);

    const sessionDetailResponse = await agent.get(`/api/sessions/${sessionId}`);
    expect(sessionDetailResponse.status).toBe(200);
    const duplicateExerciseInstances = sessionDetailResponse.body.session.exercises.filter(
      (exercise) => exercise.exerciseId === exerciseId
    );
    expect(duplicateExerciseInstances).toHaveLength(2);
    const uniqueSessionKeys = new Set(
      duplicateExerciseInstances.map((exercise) => exercise.sessionExerciseKey)
    );
    expect(uniqueSessionKeys.size).toBe(2);
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
    expect(statsResponse.body.summary.avgWarmupTimeWeekMinutes).toBe(0);
    expect(statsResponse.body.summary.avgWarmupTimeMonthMinutes).toBe(0);
    expect(statsResponse.body.summary.avgWarmupTimeMinutes).toBe(0);
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


  it('allows reopening a completed exercise by starting it again', async () => {
    const agent = request.agent(app);
    await registerUser(agent, 'reopen-completed-user');
    const csrfToken = await fetchCsrfToken(agent);

    const exerciseResponse = await agent
      .post('/api/exercises')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Paused Row', primaryMuscles: ['shoulders'], notes: '' });
    expect(exerciseResponse.status).toBe(200);
    const exerciseId = exerciseResponse.body.exercise.id;

    const routineResponse = await agent
      .post('/api/routines')
      .set('x-csrf-token', csrfToken)
      .send({
        name: 'Reopen Routine',
        exercises: [
          {
            exerciseId,
            equipment: 'Barbell',
            targetSets: 1,
            targetReps: 6,
            targetWeight: 60,
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
      .send({ routineId, name: 'Reopen Session' });
    expect(sessionResponse.status).toBe(200);
    const sessionId = sessionResponse.body.session.id;

    const completeResponse = await agent
      .post(`/api/sessions/${sessionId}/exercises/${exerciseId}/complete`)
      .set('x-csrf-token', csrfToken)
      .send({ completedAt: '2026-01-12T10:00:00.000Z' });
    expect(completeResponse.status).toBe(200);
    expect(completeResponse.body.exerciseProgress.status).toBe('completed');

    const restartResponse = await agent
      .post(`/api/sessions/${sessionId}/exercises/${exerciseId}/start`)
      .set('x-csrf-token', csrfToken)
      .send({ startedAt: '2026-01-12T10:05:00.000Z' });
    expect(restartResponse.status).toBe(200);
    expect(restartResponse.body.exerciseProgress.status).toBe('in_progress');
    expect(restartResponse.body.exerciseProgress.completedAt).toBeNull();

    const progressRowCount = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM session_exercise_progress
         WHERE session_id = ? AND exercise_id = ?`
      )
      .get(sessionId, exerciseId);
    expect(Number(progressRowCount.count)).toBe(1);
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

});
