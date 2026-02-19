// @vitest-environment jsdom
import { within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../src/api.js';
import {
  beginWorkoutThroughWarmup,
  renderAppAt,
  screen,
  waitFor,
} from './helpers/app-flows-helpers.jsx';

vi.mock('../src/api.js', () => ({
  apiFetch: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('App UI flows', () => {
  it('supports login flow and lands on workout page', async () => {
    apiFetch.mockImplementation(async (path, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (path === '/api/auth/me') return { user: null };
      if (path === '/api/auth/login' && method === 'POST') {
        return { user: { id: 1, username: 'coach' } };
      }
      if (path === '/api/routines') return { routines: [] };
      if (path === '/api/exercises') return { exercises: [] };
      if (path === '/api/sessions/active') return { session: null };
      if (path === '/api/sessions?limit=15') return { sessions: [] };
      if (path === '/api/weights?limit=6') return { weights: [] };
      if (path === '/api/bands') return { bands: [] };
      throw new Error(`Unhandled path: ${path}`);
    });

    const user = userEvent.setup();
    renderAppAt('/login');

    await user.type(await screen.findByPlaceholderText('e.g. coach'), 'coach');
    await user.type(screen.getByPlaceholderText('Minimum 6 characters'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText("Today's workout")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({ method: 'POST' })
    );
  });


  it('shows Yesterday labels for one-day-old routine and workout entries', async () => {
    const oneDayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

    apiFetch.mockImplementation(async (path, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
      if (path === '/api/routines') {
        return {
          routines: [
            {
              id: 77,
              name: 'Rehab',
              exercises: [{ id: 1 }, { id: 2 }],
              lastUsedAt: oneDayAgo,
              routineType: 'rehab',
              notes: null,
            },
          ],
        };
      }
      if (path === '/api/exercises') return { exercises: [] };
      if (path === '/api/sessions/active') return { session: null };
      if (path === '/api/sessions?limit=15') {
        return {
          sessions: [
            {
              id: 700,
              routineName: 'Rehab',
              startedAt: oneDayAgo,
              totalSets: 3,
              routineNotes: null,
            },
          ],
        };
      }
      if (path === '/api/weights?limit=6') return { weights: [] };
      if (path === '/api/bands') return { bands: [] };
      throw new Error(`Unhandled path: ${path} (${method})`);
    });

    renderAppAt('/workout');

    expect(await screen.findByText('2 exercises · Trained Yesterday')).toBeInTheDocument();
    expect(await screen.findByText('Yesterday')).toBeInTheDocument();
  });


  it('orders start workout routines by most recently trained first', async () => {
    const now = Date.now();
    const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
    const fiveDaysAgo = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString();

    apiFetch.mockImplementation(async (path) => {
      if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
      if (path === '/api/routines') {
        return {
          routines: [
            {
              id: 1,
              name: 'Old Routine',
              exercises: [{ id: 1 }],
              lastUsedAt: fiveDaysAgo,
              routineType: 'standard',
            },
            {
              id: 2,
              name: 'Never Trained Routine',
              exercises: [{ id: 2 }],
              lastUsedAt: null,
              routineType: 'standard',
            },
            {
              id: 3,
              name: 'Recent Routine',
              exercises: [{ id: 3 }],
              lastUsedAt: twoDaysAgo,
              routineType: 'rehab',
            },
          ],
        };
      }
      if (path === '/api/exercises') return { exercises: [] };
      if (path === '/api/sessions/active') return { session: null };
      if (path === '/api/sessions?limit=15') return { sessions: [] };
      if (path === '/api/weights?limit=6') return { weights: [] };
      if (path === '/api/bands') return { bands: [] };
      throw new Error(`Unhandled path: ${path}`);
    });

    renderAppAt('/workout');
    await screen.findByText("Today's workout");
    await screen.findByRole('button', { name: 'Recent Routine' });

    const routineButtons = screen.getAllByRole('button', {
      name: /Routine$/,
    });
    const routineNames = routineButtons.map((button) => button.getAttribute('aria-label'));

    expect(routineNames).toEqual([
      'Recent Routine',
      'Old Routine',
      'Never Trained Routine',
    ]);
  });

  it('marks a set done when reps change and auto-finishes the exercise', async () => {
    const now = new Date().toISOString();
    const sessionStartedAt = '2026-01-15T10:00:00.000Z';
    const routine = {
      id: 31,
      name: 'Leg Day',
      exercises: [
        {
          id: 3101,
          exerciseId: 101,
          name: 'Back Squat',
          equipment: 'Barbell',
          targetSets: 1,
          targetReps: 5,
          targetRepsRange: null,
          targetRestSeconds: null,
          targetWeight: 100,
          targetBandLabel: null,
          notes: null,
          position: 0,
        },
      ],
    };
    const state = {
      activeSession: null,
      nextSetId: 1,
      savedSets: [],
      exercises: [{ id: 101, name: 'Back Squat', primaryMuscles: ['quadriceps'], lastSet: null }],
    };

    apiFetch.mockImplementation(async (path, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
      if (path === '/api/routines') return { routines: [routine] };
      if (path === '/api/exercises') return { exercises: state.exercises };
      if (path === '/api/sessions/active') return { session: state.activeSession };
      if (path === '/api/sessions?limit=15') return { sessions: [] };
      if (path === '/api/weights?limit=6') return { weights: [] };
      if (path === '/api/bands') return { bands: [] };

      if (path === '/api/sessions' && method === 'POST') {
        const payload = JSON.parse(options.body);
        state.activeSession = {
          id: 501,
          routineId: payload.routineId,
          routineName: routine.name,
          name: payload.name,
          startedAt: sessionStartedAt,
          endedAt: null,
          notes: null,
          exercises: [],
        };
        return { session: state.activeSession };
      }

      if (path === '/api/sessions/501/exercises/101/start' && method === 'POST') {
        return {
          exerciseProgress: {
            exerciseId: 101,
            status: 'in_progress',
            startedAt: now,
          },
        };
      }

      if (path === '/api/sessions/501/sets' && method === 'POST') {
        const payload = JSON.parse(options.body);
        const set = {
          id: state.nextSetId++,
          sessionId: 501,
          exerciseId: payload.exerciseId,
          setIndex: 1,
          reps: payload.reps,
          weight: payload.weight,
          bandLabel: null,
          startedAt: payload.startedAt || now,
          completedAt: payload.completedAt || now,
          createdAt: now,
        };
        state.savedSets.push(set);
        return {
          set,
          exerciseProgress: {
            exerciseId: 101,
            status: 'in_progress',
            startedAt: now,
          },
        };
      }

      if (path === '/api/sessions/501/exercises/101/complete' && method === 'POST') {
        return {
          exerciseProgress: {
            exerciseId: 101,
            status: 'completed',
            startedAt: now,
            completedAt: now,
          },
        };
      }

      if (path === '/api/sessions/501' && method === 'PUT') {
        return {
          session: {
            id: 501,
            routineId: routine.id,
            routineName: routine.name,
            startedAt: sessionStartedAt,
            endedAt: now,
            exercises: [
              {
                exerciseId: 101,
                name: 'Back Squat',
                equipment: 'Barbell',
                targetSets: 1,
                targetReps: 5,
                targetRepsRange: null,
                targetRestSeconds: null,
                targetWeight: 100,
                targetBandLabel: null,
                status: 'completed',
                position: 0,
                sets: state.savedSets,
              },
            ],
          },
        };
      }

      throw new Error(`Unhandled path: ${path}`);
    });

    const user = userEvent.setup();
    renderAppAt('/workout');

    await user.click(await screen.findByRole('button', { name: 'Leg Day' }));

    expect((await screen.findAllByText(/Back Squat/)).length).toBeGreaterThan(0);
    await beginWorkoutThroughWarmup(user);
    expect(await screen.findByRole('button', { name: 'Finish workout' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip exercise' })).not.toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: /Increase next target weight for Back Squat/i })
    ).toBeInTheDocument();
    const progress = screen.getByRole('progressbar', { name: 'Workout exercise progress' });
    expect(progress).toHaveAttribute('aria-valuenow', '1');
    expect(progress).toHaveAttribute('aria-valuemax', '1');
    const repsSelect = await screen.findByRole('combobox', { name: /Set 1 reps for Back Squat/i });
    expect(repsSelect).toHaveValue('5');
    await user.selectOptions(repsSelect, '7');
    expect(repsSelect).toHaveValue('7');

    await waitFor(() => {
      expect(
        apiFetch.mock.calls.some(
          ([path, options]) => path === '/api/sessions/501/sets' && options?.method === 'POST'
        )
      ).toBe(true);
      expect(
        apiFetch.mock.calls.some(
          ([path, options]) => path === '/api/sessions/501/exercises/101/complete' && options?.method === 'POST'
        )
      ).toBe(true);
    });
    const addSetCall = apiFetch.mock.calls.find(
      ([path, options]) => path === '/api/sessions/501/sets' && options?.method === 'POST'
    );
    expect(addSetCall).toBeTruthy();
    const addSetPayload = JSON.parse(addSetCall[1].body);
    expect(addSetPayload.reps).toBe(7);
    const finishSessionCall = apiFetch.mock.calls.find(
      ([path, options]) => path === '/api/sessions/501' && options?.method === 'PUT'
    );
    expect(finishSessionCall).toBeTruthy();
    const finishSessionPayload = JSON.parse(finishSessionCall[1].body);
    expect(finishSessionPayload.warmupStartedAt).toBe(sessionStartedAt);
    expect(finishSessionPayload.warmupCompletedAt).not.toBeNull();
    expect(finishSessionPayload.warmupCompletedAt).not.toBe(sessionStartedAt);
    expect(await screen.findByText('Workout details', {}, { timeout: 300 })).toBeInTheDocument();
  });

  it('adjusts next target weight inline and persists when finishing exercise', async () => {
    const now = new Date().toISOString();
    const routine = {
      id: 41,
      name: 'Upper Day',
      exercises: [
        {
          id: 4101,
          exerciseId: 401,
          name: 'Bench Press',
          equipment: 'Barbell',
          targetSets: 1,
          targetReps: 5,
          targetRepsRange: null,
          targetRestSeconds: 90,
          targetWeight: 100,
          targetBandLabel: null,
          notes: null,
          position: 0,
        },
      ],
    };
    const state = {
      activeSession: null,
      nextSetId: 1,
      savedSets: [],
      targetPayload: null,
    };

    apiFetch.mockImplementation(async (path, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
      if (path === '/api/routines') return { routines: [routine] };
      if (path === '/api/exercises') return { exercises: [] };
      if (path === '/api/sessions/active') return { session: state.activeSession };
      if (path === '/api/sessions?limit=15') return { sessions: [] };
      if (path === '/api/weights?limit=6') return { weights: [] };
      if (path === '/api/bands') return { bands: [] };
      if (path === '/api/sessions' && method === 'POST') {
        const payload = JSON.parse(options.body);
        state.activeSession = {
          id: 901,
          routineId: payload.routineId,
          routineName: routine.name,
          name: routine.name,
          startedAt: now,
          endedAt: null,
          notes: null,
          exercises: [],
        };
        return { session: state.activeSession };
      }
      if (path === '/api/sessions/901/exercises/401/start' && method === 'POST') {
        return {
          exerciseProgress: {
            exerciseId: 401,
            status: 'in_progress',
            startedAt: now,
          },
        };
      }
      if (path === '/api/sessions/901/sets' && method === 'POST') {
        const payload = JSON.parse(options.body);
        const set = {
          id: state.nextSetId++,
          sessionId: 901,
          exerciseId: payload.exerciseId,
          setIndex: 1,
          reps: payload.reps,
          weight: payload.weight,
          bandLabel: null,
          startedAt: payload.startedAt || now,
          completedAt: payload.completedAt || now,
          createdAt: now,
        };
        state.savedSets.push(set);
        return {
          set,
          exerciseProgress: {
            exerciseId: 401,
            status: 'in_progress',
            startedAt: now,
          },
        };
      }
      if (path === '/api/sessions/901/exercises/401/complete' && method === 'POST') {
        return {
          exerciseProgress: {
            exerciseId: 401,
            status: 'completed',
            startedAt: now,
            completedAt: now,
          },
        };
      }
      if (path === '/api/routines/41/exercises/401/target' && method === 'PUT') {
        state.targetPayload = JSON.parse(options.body);
        return {
          target: {
            routineId: 41,
            exerciseId: 401,
            equipment: 'Barbell',
            targetWeight: 102.5,
            updatedAt: now,
          },
        };
      }
      if (path === '/api/sessions/901' && method === 'PUT') {
        return {
          session: {
            id: 901,
            routineId: routine.id,
            routineName: routine.name,
            startedAt: now,
            endedAt: now,
            exercises: [
              {
                exerciseId: 401,
                name: 'Bench Press',
                equipment: 'Barbell',
                targetSets: 1,
                targetReps: 5,
                targetRepsRange: null,
                targetRestSeconds: 90,
                targetWeight: 102.5,
                targetBandLabel: null,
                status: 'completed',
                position: 0,
                sets: state.savedSets,
              },
            ],
          },
        };
      }
      throw new Error(`Unhandled path: ${path} (${method})`);
    });

    const user = userEvent.setup();
    renderAppAt('/workout');

    await user.click(await screen.findByRole('button', { name: 'Upper Day' }));
    await beginWorkoutThroughWarmup(user);

    const increaseButton = await screen.findByRole('button', {
      name: /Increase next target weight for Bench Press/i,
    });
    await user.click(increaseButton);
    const targetInput = await screen.findByRole('textbox', {
      name: /Set next target weight for Bench Press/i,
    });

    expect(await screen.findByText('Save on finish')).toBeInTheDocument();
    expect(screen.getAllByText(/100(?:[,.]0)? kg/).length).toBeGreaterThan(0);
    expect(targetInput).toHaveValue('102.5');
    expect(state.targetPayload).toBeNull();

    await user.click(await screen.findByRole('button', { name: /Toggle set 1 for Bench Press/i }));

    await waitFor(() => {
      expect(state.targetPayload).toMatchObject({
        equipment: 'Barbell',
        targetWeight: 102.5,
      });
    });
  });

  it('supports direct next target input and saves on finish', async () => {
    const now = new Date().toISOString();
    const routine = {
      id: 44,
      name: 'Upper Day',
      exercises: [
        {
          id: 4401,
          exerciseId: 404,
          name: 'Bench Press',
          equipment: 'Barbell',
          targetSets: 1,
          targetReps: 5,
          targetRepsRange: null,
          targetRestSeconds: 90,
          targetWeight: 100,
          targetBandLabel: null,
          notes: null,
          position: 0,
        },
      ],
    };
    const state = {
      activeSession: null,
      nextSetId: 1,
      savedSets: [],
      targetPayload: null,
    };

    apiFetch.mockImplementation(async (path, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
      if (path === '/api/routines') return { routines: [routine] };
      if (path === '/api/exercises') return { exercises: [] };
      if (path === '/api/sessions/active') return { session: state.activeSession };
      if (path === '/api/sessions?limit=15') return { sessions: [] };
      if (path === '/api/weights?limit=6') return { weights: [] };
      if (path === '/api/bands') return { bands: [] };
      if (path === '/api/sessions' && method === 'POST') {
        const payload = JSON.parse(options.body);
        state.activeSession = {
          id: 904,
          routineId: payload.routineId,
          routineName: routine.name,
          name: routine.name,
          startedAt: now,
          endedAt: null,
          notes: null,
          exercises: [],
        };
        return { session: state.activeSession };
      }
      if (path === '/api/sessions/904/exercises/404/start' && method === 'POST') {
        return {
          exerciseProgress: {
            exerciseId: 404,
            status: 'in_progress',
            startedAt: now,
          },
        };
      }
      if (path === '/api/sessions/904/sets' && method === 'POST') {
        const payload = JSON.parse(options.body);
        const set = {
          id: state.nextSetId++,
          sessionId: 904,
          exerciseId: payload.exerciseId,
          setIndex: 1,
          reps: payload.reps,
          weight: payload.weight,
          bandLabel: null,
          startedAt: payload.startedAt || now,
          completedAt: payload.completedAt || now,
          createdAt: now,
        };
        state.savedSets.push(set);
        return {
          set,
          exerciseProgress: {
            exerciseId: 404,
            status: 'in_progress',
            startedAt: now,
          },
        };
      }
      if (path === '/api/sessions/904/exercises/404/complete' && method === 'POST') {
        return {
          exerciseProgress: {
            exerciseId: 404,
            status: 'completed',
            startedAt: now,
            completedAt: now,
          },
        };
      }
      if (path === '/api/routines/44/exercises/404/target' && method === 'PUT') {
        state.targetPayload = JSON.parse(options.body);
        return {
          target: {
            routineId: 44,
            exerciseId: 404,
            equipment: 'Barbell',
            targetWeight: 110.5,
            updatedAt: now,
          },
        };
      }
      if (path === '/api/sessions/904' && method === 'PUT') {
        return {
          session: {
            id: 904,
            routineId: routine.id,
            routineName: routine.name,
            startedAt: now,
            endedAt: now,
            exercises: [
              {
                exerciseId: 404,
                name: 'Bench Press',
                equipment: 'Barbell',
                targetSets: 1,
                targetReps: 5,
                targetRepsRange: null,
                targetRestSeconds: 90,
                targetWeight: 110.5,
                targetBandLabel: null,
                status: 'completed',
                position: 0,
                sets: state.savedSets,
              },
            ],
          },
        };
      }
      throw new Error(`Unhandled path: ${path} (${method})`);
    });

    const user = userEvent.setup();
    renderAppAt('/workout');

    await user.click(await screen.findByRole('button', { name: 'Upper Day' }));
    await beginWorkoutThroughWarmup(user);
    const lingeringWarmupButton = screen.queryByRole('button', { name: 'Finish warmup' });
    if (lingeringWarmupButton) {
      await user.click(lingeringWarmupButton);
    }

    const targetInput = await screen.findByRole(
      'textbox',
      { name: /Set next target weight for Bench Press/i },
      { timeout: 3000 }
    );
    await user.clear(targetInput);
    await user.type(targetInput, '110.5');
    await user.tab();

    expect(await screen.findByText('Save on finish')).toBeInTheDocument();
    expect(screen.getAllByText(/100(?:[,.]0)? kg/).length).toBeGreaterThan(0);
    expect(targetInput).toHaveValue('110.5');
    expect(state.targetPayload).toBeNull();

    await user.click(await screen.findByRole('button', { name: /Toggle set 1 for Bench Press/i }));

    await waitFor(() => {
      expect(state.targetPayload).toMatchObject({
        equipment: 'Barbell',
        targetWeight: 110.5,
      });
    });
  });

  it('clamps next target weight adjustments to 0.5 kg minimum and saves on finish', async () => {
    const now = new Date().toISOString();
    const routine = {
      id: 42,
      name: 'Upper Day',
      exercises: [
        {
          id: 4201,
          exerciseId: 402,
          name: 'Bench Press',
          equipment: 'Barbell',
          targetSets: 1,
          targetReps: 5,
          targetRepsRange: null,
          targetRestSeconds: 90,
          targetWeight: 1,
          targetBandLabel: null,
          notes: null,
          position: 0,
        },
      ],
    };
    const state = {
      activeSession: null,
      nextSetId: 1,
      savedSets: [],
      targetPayload: null,
    };

    apiFetch.mockImplementation(async (path, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
      if (path === '/api/routines') return { routines: [routine] };
      if (path === '/api/exercises') return { exercises: [] };
      if (path === '/api/sessions/active') return { session: state.activeSession };
      if (path === '/api/sessions?limit=15') return { sessions: [] };
      if (path === '/api/weights?limit=6') return { weights: [] };
      if (path === '/api/bands') return { bands: [] };
      if (path === '/api/sessions' && method === 'POST') {
        const payload = JSON.parse(options.body);
        state.activeSession = {
          id: 902,
          routineId: payload.routineId,
          routineName: routine.name,
          name: routine.name,
          startedAt: now,
          endedAt: null,
          notes: null,
          exercises: [],
        };
        return { session: state.activeSession };
      }
      if (path === '/api/sessions/902/exercises/402/start' && method === 'POST') {
        return {
          exerciseProgress: {
            exerciseId: 402,
            status: 'in_progress',
            startedAt: now,
          },
        };
      }
      if (path === '/api/sessions/902/sets' && method === 'POST') {
        const payload = JSON.parse(options.body);
        const set = {
          id: state.nextSetId++,
          sessionId: 902,
          exerciseId: payload.exerciseId,
          setIndex: 1,
          reps: payload.reps,
          weight: payload.weight,
          bandLabel: null,
          startedAt: payload.startedAt || now,
          completedAt: payload.completedAt || now,
          createdAt: now,
        };
        state.savedSets.push(set);
        return {
          set,
          exerciseProgress: {
            exerciseId: 402,
            status: 'in_progress',
            startedAt: now,
          },
        };
      }
      if (path === '/api/sessions/902/exercises/402/complete' && method === 'POST') {
        return {
          exerciseProgress: {
            exerciseId: 402,
            status: 'completed',
            startedAt: now,
            completedAt: now,
          },
        };
      }
      if (path === '/api/routines/42/exercises/402/target' && method === 'PUT') {
        state.targetPayload = JSON.parse(options.body);
        return {
          target: {
            routineId: 42,
            exerciseId: 402,
            equipment: 'Barbell',
            targetWeight: 0.5,
            updatedAt: now,
          },
        };
      }
      if (path === '/api/sessions/902' && method === 'PUT') {
        return {
          session: {
            id: 902,
            routineId: routine.id,
            routineName: routine.name,
            startedAt: now,
            endedAt: now,
            exercises: [
              {
                exerciseId: 402,
                name: 'Bench Press',
                equipment: 'Barbell',
                targetSets: 1,
                targetReps: 5,
                targetRepsRange: null,
                targetRestSeconds: 90,
                targetWeight: 0.5,
                targetBandLabel: null,
                status: 'completed',
                position: 0,
                sets: state.savedSets,
              },
            ],
          },
        };
      }
      throw new Error(`Unhandled path: ${path} (${method})`);
    });

    const user = userEvent.setup();
    renderAppAt('/workout');

    await user.click(await screen.findByRole('button', { name: 'Upper Day' }));
    await beginWorkoutThroughWarmup(user);

    await user.click(
      await screen.findByRole('button', { name: /Decrease next target weight for Bench Press/i })
    );
    const targetInput = await screen.findByRole('textbox', {
      name: /Set next target weight for Bench Press/i,
    });

    expect(state.targetPayload).toBeNull();
    expect(targetInput).toHaveValue('0.5');

    await user.click(await screen.findByRole('button', { name: /Toggle set 1 for Bench Press/i }));

    await waitFor(() => {
      expect(state.targetPayload).toMatchObject({
        equipment: 'Barbell',
        targetWeight: 0.5,
      });
    });
  });

  it.each(['Bodyweight', 'Band', 'Ab wheel'])(
    'does not show next target controls for %s exercises',
    async (equipment) => {
      const now = new Date().toISOString();
      const activeSession = {
        id: 903,
        routineId: 43,
        routineName: 'Control Check',
        name: 'Control Check',
        startedAt: now,
        endedAt: null,
        notes: null,
        exercises: [
          {
            exerciseId: 403,
            name: `${equipment} Exercise`,
            equipment,
            targetSets: 1,
            targetReps: 10,
            targetRepsRange: null,
            targetRestSeconds: 60,
            targetWeight: null,
            targetBandLabel: equipment === 'Band' ? '20 lb' : null,
            status: 'in_progress',
            position: 0,
            sets: [],
          },
        ],
      };

      apiFetch.mockImplementation(async (path, options = {}) => {
        const method = (options.method || 'GET').toUpperCase();
        if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
        if (path === '/api/routines') return { routines: [] };
        if (path === '/api/exercises') return { exercises: [] };
        if (path === '/api/sessions/active') return { session: activeSession };
        if (path === '/api/sessions?limit=15') return { sessions: [] };
        if (path === '/api/weights?limit=6') return { weights: [] };
        if (path === '/api/bands') return { bands: [] };
        throw new Error(`Unhandled path: ${path} (${method})`);
      });

      renderAppAt('/workout');

      expect(await screen.findByText(`${equipment} ${equipment} Exercise`)).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /Increase next target weight/i })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /Decrease next target weight/i })
      ).not.toBeInTheDocument();
    }
  );



  it('shows exercise notes in guided workout cards when present', async () => {
    const now = new Date().toISOString();
    const routine = {
      id: 88,
      name: 'Upper Day',
      exercises: [
        {
          id: 8801,
          exerciseId: 701,
          name: 'Incline Press',
          equipment: 'Barbell',
          targetSets: 2,
          targetReps: 8,
          targetRepsRange: null,
          targetRestSeconds: 90,
          targetWeight: 70,
          targetBandLabel: null,
          notes: 'Keep shoulder blades pinned.',
          position: 0,
        },
      ],
    };
    const state = {
      activeSession: null,
      exercises: [{ id: 701, name: 'Incline Press', primaryMuscles: ['chest'], lastSet: null }],
    };

    apiFetch.mockImplementation(async (path, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
      if (path === '/api/routines') return { routines: [routine] };
      if (path === '/api/exercises') return { exercises: state.exercises };
      if (path === '/api/sessions/active') return { session: state.activeSession };
      if (path === '/api/sessions?limit=15') return { sessions: [] };
      if (path === '/api/weights?limit=6') return { weights: [] };
      if (path === '/api/bands') return { bands: [] };

      if (path === '/api/sessions' && method === 'POST') {
        const payload = JSON.parse(options.body);
        state.activeSession = {
          id: 777,
          routineId: payload.routineId,
          routineName: routine.name,
          name: payload.name,
          startedAt: now,
          endedAt: null,
          notes: null,
          exercises: [],
        };
        return { session: state.activeSession };
      }

      if (path === '/api/sessions/777/exercises/701/start' && method === 'POST') {
        return {
          exerciseProgress: {
            exerciseId: 701,
            status: 'in_progress',
            startedAt: now,
          },
        };
      }

      throw new Error(`Unhandled path: ${path}`);
    });

    const user = userEvent.setup();
    renderAppAt('/workout');

    await user.click(await screen.findByRole('button', { name: 'Upper Day' }));

    expect(await screen.findByText(/Notes: Keep shoulder blades pinned\./i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Begin workout' }));

    expect(await screen.findByText(/Keep shoulder blades pinned/i)).toBeInTheDocument();
  });

  it('shows routine-type badge in the workout start list', async () => {
    const routine = {
      id: 91,
      name: 'Mobility Circuit',
      routineType: 'rehab',
      exercises: [],
      notes: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastUsedAt: null,
    };

    apiFetch.mockImplementation(async (path) => {
      if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
      if (path === '/api/routines') return { routines: [routine] };
      if (path === '/api/exercises') return { exercises: [] };
      if (path === '/api/sessions/active') return { session: null };
      if (path === '/api/sessions?limit=15') return { sessions: [] };
      if (path === '/api/weights?limit=6') return { weights: [] };
      if (path === '/api/bands') return { bands: [] };
      throw new Error(`Unhandled path: ${path}`);
    });

    renderAppAt('/workout');

    const routineButton = await screen.findByRole('button', { name: 'Mobility Circuit' });
    expect(within(routineButton).getByText('Rehab')).toBeInTheDocument();
  });

  it('blocks begin workout when required routine targets are missing', async () => {
    const now = new Date().toISOString();
    const routine = {
      id: 31,
      name: 'Leg Day',
      exercises: [
        {
          id: 3101,
          exerciseId: 101,
          name: 'Back Squat',
          equipment: 'Barbell',
          targetSets: 2,
          targetReps: 5,
          targetRepsRange: null,
          targetRestSeconds: null,
          targetWeight: null,
          targetBandLabel: null,
          notes: null,
          position: 0,
        },
      ],
    };
    const state = { activeSession: null };

    apiFetch.mockImplementation(async (path, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
      if (path === '/api/routines') return { routines: [routine] };
      if (path === '/api/exercises') return { exercises: [] };
      if (path === '/api/sessions/active') return { session: state.activeSession };
      if (path === '/api/sessions?limit=15') return { sessions: [] };
      if (path === '/api/weights?limit=6') return { weights: [] };
      if (path === '/api/bands') return { bands: [] };
      if (path === '/api/sessions' && method === 'POST') {
        state.activeSession = {
          id: 501,
          routineId: routine.id,
          routineName: routine.name,
          name: routine.name,
          startedAt: now,
          endedAt: null,
          notes: null,
          exercises: [],
        };
        return { session: state.activeSession };
      }
      throw new Error(`Unhandled path: ${path} (${method})`);
    });

    const user = userEvent.setup();
    renderAppAt('/workout');
    await user.click(await screen.findByRole('button', { name: 'Leg Day' }));
    await beginWorkoutThroughWarmup(user);
    expect(
      await screen.findByText(/Cannot begin workout\. Update routine targets for: Back Squat \(weight\)\./i)
    ).toBeInTheDocument();
  });

  it('groups superset pairs with a single superset badge in workout preview lists', async () => {
    const now = new Date().toISOString();
    const routine = {
      id: 44,
      name: 'Superset Day',
      exercises: [
        {
          id: 4401,
          exerciseId: 101,
          name: 'Bench Press',
          equipment: 'Barbell',
          targetSets: 2,
          targetReps: null,
          targetRepsRange: '8-12',
          targetRestSeconds: 60,
          targetWeight: 80,
          targetBandLabel: null,
          notes: null,
          position: 0,
          supersetGroup: 'g1',
        },
        {
          id: 4402,
          exerciseId: 102,
          name: 'Pendlay Row',
          equipment: 'Barbell',
          targetSets: 2,
          targetReps: null,
          targetRepsRange: '8-12',
          targetRestSeconds: 60,
          targetWeight: 60,
          targetBandLabel: null,
          notes: null,
          position: 1,
          supersetGroup: 'g1',
        },
        {
          id: 4403,
          exerciseId: 103,
          name: 'Overhead Press',
          equipment: 'Barbell',
          targetSets: 2,
          targetReps: null,
          targetRepsRange: '5-8',
          targetRestSeconds: 90,
          targetWeight: 50,
          targetBandLabel: null,
          notes: null,
          position: 2,
          supersetGroup: null,
        },
      ],
    };
    const state = { activeSession: null };

    apiFetch.mockImplementation(async (path, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
      if (path === '/api/routines') return { routines: [routine] };
      if (path === '/api/exercises') return { exercises: [] };
      if (path === '/api/sessions/active') return { session: state.activeSession };
      if (path === '/api/sessions?limit=15') return { sessions: [] };
      if (path === '/api/weights?limit=6') return { weights: [] };
      if (path === '/api/bands') return { bands: [] };
      if (path === '/api/sessions' && method === 'POST') {
        state.activeSession = {
          id: 501,
          routineId: routine.id,
          routineName: routine.name,
          name: routine.name,
          startedAt: now,
          endedAt: null,
          notes: null,
          exercises: [],
        };
        return { session: state.activeSession };
      }
      if (path === '/api/sessions/501/exercises/101/start' && method === 'POST') {
        return {
          exerciseProgress: {
            exerciseId: 101,
            status: 'in_progress',
            startedAt: now,
          },
        };
      }
      throw new Error(`Unhandled path: ${path} (${method})`);
    });

    const user = userEvent.setup();
    renderAppAt('/workout');

    await user.click(await screen.findByRole('button', { name: 'Superset Day' }));
    expect(await screen.findByRole('button', { name: 'Begin workout' })).toBeInTheDocument();
    expect(screen.getAllByText('Superset')).toHaveLength(1);
    expect(document.querySelectorAll('.workout-preview-superset-block')).toHaveLength(1);
    expect(document.querySelectorAll('.workout-preview-superset-block .workout-preview-row-grouped')).toHaveLength(2);
    const previewBenchRow = screen.getByText('1. Barbell Bench Press').closest('.set-row');
    expect(previewBenchRow).toBeTruthy();
    expect(previewBenchRow.querySelector('.badge')?.textContent).toBe('80 kg');

    await beginWorkoutThroughWarmup(user);
    const guidedBenchCard = await screen.findByText('Barbell Bench Press');
    const guidedBenchContainer = guidedBenchCard.closest('.guided-workout-card');
    expect(guidedBenchContainer).toBeTruthy();
    expect(guidedBenchContainer.querySelector('.badge')?.textContent).toBe('80 kg');
    await user.click(await screen.findByRole('button', { name: /Open workout exercises/i }));

    const closePreviewButton = await screen.findByRole('button', { name: /Close workout exercises/i });
    const previewModal = closePreviewButton.closest('.modal-panel');
    expect(previewModal).toBeTruthy();
    const modalScope = within(previewModal);
    expect(modalScope.getAllByText('Superset')).toHaveLength(1);
    expect(previewModal.querySelectorAll('.workout-preview-superset-block')).toHaveLength(1);
    expect(previewModal.querySelectorAll('.workout-preview-superset-block .workout-preview-row-grouped')).toHaveLength(2);
  });

  it('opens exercise metadata from the workout card info button', async () => {
    const now = new Date().toISOString();
    const activeSession = {
      id: 777,
      routineId: 31,
      routineName: 'Leg Day',
      name: 'Leg Day',
      startedAt: now,
      endedAt: null,
      notes: null,
      exercises: [
        {
          exerciseId: 101,
          name: 'Squat',
          equipment: 'Barbell',
          targetSets: 2,
          targetReps: null,
          targetRepsRange: '3-5',
          targetRestSeconds: 180,
          targetWeight: 120,
          targetBandLabel: null,
          status: 'in_progress',
          position: 0,
          category: 'strength',
          level: 'intermediate',
          force: 'push',
          mechanic: 'compound',
          primaryMuscles: ['quadriceps'],
          secondaryMuscles: ['glutes'],
          instructions: [
            'Set your feet shoulder-width apart.',
            'Drive through your heels and stand up.',
          ],
          images: ['https://example.com/squat.png'],
          sets: [],
        },
      ],
    };

    apiFetch.mockImplementation(async (path, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
      if (path === '/api/routines') return { routines: [] };
      if (path === '/api/exercises') return { exercises: [] };
      if (path === '/api/sessions/active') return { session: activeSession };
      if (path === '/api/sessions?limit=15') return { sessions: [] };
      if (path === '/api/weights?limit=6') return { weights: [] };
      if (path === '/api/bands') return { bands: [] };
      throw new Error(`Unhandled path: ${path} (${method})`);
    });

    const user = userEvent.setup();
    renderAppAt('/workout');

    await user.click(
      await screen.findByRole('button', { name: /Open exercise details for Squat/i })
    );

    expect(await screen.findByRole('img', { name: 'Squat' })).toBeInTheDocument();
    expect(screen.getByText(/Primary muscles: Quadriceps/i)).toBeInTheDocument();
    expect(screen.getByText(/Secondary muscles: Glutes/i)).toBeInTheDocument();
    expect(screen.getByText('Set your feet shoulder-width apart.')).toBeInTheDocument();
    expect(screen.getByText('Drive through your heels and stand up.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finish exercise' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip exercise' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End workout' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close exercise details' }));
    await waitFor(() => {
      expect(screen.queryByText('Set your feet shoulder-width apart.')).not.toBeInTheDocument();
    });
  });


});
