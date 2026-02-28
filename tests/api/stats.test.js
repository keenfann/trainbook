import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { setupApiIntegrationSuite } from '../helpers/api-integration-helpers.js';

const { app, db, fetchCsrfToken, registerUser } = await setupApiIntegrationSuite('stats');

describe('API integration stats', () => {
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


  it('caps session durations for duration aggregates and returns median workout durations', async () => {
    const agent = request.agent(app);
    await registerUser(agent, 'stats-duration-cap-user');
    const csrfToken = await fetchCsrfToken(agent);

    const exerciseResponse = await agent
      .post('/api/exercises')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Duration Cap Lift', primaryMuscles: ['chest'], notes: '' });
    expect(exerciseResponse.status).toBe(200);
    const exerciseId = exerciseResponse.body.exercise.id;

    const routineResponse = await agent
      .post('/api/routines')
      .set('x-csrf-token', csrfToken)
      .send({
        name: 'Duration Cap Routine',
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

    const firstSessionResponse = await agent
      .post('/api/sessions')
      .set('x-csrf-token', csrfToken)
      .send({ routineId, name: 'One Hour Session' });
    expect(firstSessionResponse.status).toBe(200);
    const firstSessionId = firstSessionResponse.body.session.id;

    const secondSessionResponse = await agent
      .post('/api/sessions')
      .set('x-csrf-token', csrfToken)
      .send({ routineId, name: 'Forgot to end session' });
    expect(secondSessionResponse.status).toBe(200);
    const secondSessionId = secondSessionResponse.body.session.id;

    const nowMs = Date.now();
    const firstStart = new Date(nowMs - (2 * 60 * 60 * 1000)).toISOString();
    const firstEnd = new Date(nowMs - (1 * 60 * 60 * 1000)).toISOString();
    const secondStart = new Date(nowMs - (12 * 60 * 60 * 1000)).toISOString();
    const secondEnd = new Date(nowMs - (2 * 60 * 60 * 1000)).toISOString();

    db.prepare(
      `UPDATE sessions
       SET started_at = ?, ended_at = ?
       WHERE id = ?`
    ).run(firstStart, firstEnd, firstSessionId);
    db.prepare(
      `UPDATE sessions
       SET started_at = ?, ended_at = ?
       WHERE id = ?`
    ).run(secondStart, secondEnd, secondSessionId);

    const statsResponse = await agent.get('/api/stats/overview');
    expect(statsResponse.status).toBe(200);
    expect(statsResponse.body.summary.timeSpentWeekMinutes).toBe(240);
    expect(statsResponse.body.summary.timeSpentMonthMinutes).toBe(240);
    expect(statsResponse.body.summary.avgSessionTimeWeekMinutes).toBe(120);
    expect(statsResponse.body.summary.avgSessionTimeMonthMinutes).toBe(120);
    expect(statsResponse.body.summary.medianSessionTimeWeekMinutes).toBe(120);
    expect(statsResponse.body.summary.medianSessionTimeMonthMinutes).toBe(120);
    expect(statsResponse.body.summary.medianSessionTimeMinutes).toBe(120);
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
