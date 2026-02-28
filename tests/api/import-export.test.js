import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { setupApiIntegrationSuite } from '../helpers/api-integration-helpers.js';

const { app, db, fetchCsrfToken, registerUser } = await setupApiIntegrationSuite('import-export');

describe('API integration import export', () => {
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
    const addCandidates = librarySearch.body.results
      .filter(
        (item) => !item.alreadyAdded
          && typeof item.forkId === 'string'
          && item.forkId.trim().length > 0
      )
      .slice(0, 5);
    if (addCandidates.length > 0) {
      const attemptStatuses = [];
      let addedExercise = null;
      let addedForkId = null;

      for (const candidate of addCandidates) {
        const addFromLibrary = await owner
          .post(`/api/exercise-library/${encodeURIComponent(candidate.forkId)}/add`)
          .set('x-csrf-token', csrfToken)
          .send({});
        attemptStatuses.push(`${candidate.forkId}:${addFromLibrary.status}`);
        if (addFromLibrary.status === 200 && addFromLibrary.body?.exercise) {
          addedExercise = addFromLibrary.body.exercise;
          addedForkId = candidate.forkId;
          break;
        }
      }

      expect(
        addedExercise,
        `Failed to add any candidate from exercise library. Attempts: ${attemptStatuses.join(', ')}`
      ).toBeTruthy();
      expect(addedExercise.forkId).toBe(addedForkId);
      expect(Array.isArray(addedExercise.primaryMuscles)).toBe(true);
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
    expect(typeof statsResponse.body.summary.avgSessionsPerWeekThirty).toBe('number');
    expect(typeof statsResponse.body.summary.avgSessionsPerWeekNinety).toBe('number');
    expect(typeof statsResponse.body.summary.timeSpentWeekMinutes).toBe('number');
    expect(typeof statsResponse.body.summary.timeSpentMonthMinutes).toBe('number');
    expect(typeof statsResponse.body.summary.avgWarmupTimeWeekMinutes).toBe('number');
    expect(typeof statsResponse.body.summary.avgWarmupTimeMonthMinutes).toBe('number');
    expect(typeof statsResponse.body.summary.avgWarmupTimeMinutes).toBe('number');
    expect(typeof statsResponse.body.summary.avgSessionTimeWeekMinutes).toBe('number');
    expect(typeof statsResponse.body.summary.avgSessionTimeMonthMinutes).toBe('number');
    expect(typeof statsResponse.body.summary.avgSessionTimeMinutes).toBe('number');
    expect(typeof statsResponse.body.summary.medianSessionTimeWeekMinutes).toBe('number');
    expect(typeof statsResponse.body.summary.medianSessionTimeMonthMinutes).toBe('number');
    expect(typeof statsResponse.body.summary.medianSessionTimeMinutes).toBe('number');

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

});
