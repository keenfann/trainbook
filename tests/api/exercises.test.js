import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { setupApiIntegrationSuite } from '../helpers/api-integration-helpers.js';

const { app, db, fetchCsrfToken, registerUser } = await setupApiIntegrationSuite('exercises');

describe('API integration exercises', () => {
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

});
