// @vitest-environment jsdom
import { within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../src/api.js';
import {
  beginWorkoutThroughWarmup,
  renderAppAt,
  screen,
  waitFor,
} from '../helpers/app-flows-helpers.jsx';

vi.mock('../../src/api.js', () => ({
  apiFetch: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('App UI flows', () => {
  it('auto-advances to superset partner when finishing an exercise', async () => {
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
          targetReps: 8,
          targetRepsRange: null,
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
          targetReps: 8,
          targetRepsRange: null,
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
          name: 'Incline Dumbbell Curl',
          equipment: 'Dumbbell',
          targetSets: 2,
          targetReps: 10,
          targetRepsRange: null,
          targetRestSeconds: 60,
          targetWeight: 12,
          targetBandLabel: null,
          notes: null,
          position: 2,
          supersetGroup: null,
        },
      ],
    };
    const counts = { 101: 0, 102: 0, 103: 0 };
    const startCalls = [];
    const state = {
      activeSession: null,
      exercises: [
        { id: 101, name: 'Bench Press', primaryMuscles: ['chest'], lastSet: null },
        { id: 102, name: 'Pendlay Row', primaryMuscles: ['lats'], lastSet: null },
        { id: 103, name: 'Incline Dumbbell Curl', primaryMuscles: ['biceps'], lastSet: null },
      ],
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
          startedAt: now,
          endedAt: null,
          notes: null,
          exercises: routine.exercises.map((exercise) => ({
            exerciseId: exercise.exerciseId,
            name: exercise.name,
            equipment: exercise.equipment,
            targetSets: exercise.targetSets,
            targetReps: exercise.targetReps,
            targetRepsRange: exercise.targetRepsRange,
            targetRestSeconds: exercise.targetRestSeconds,
            targetWeight: exercise.targetWeight,
            targetBandLabel: exercise.targetBandLabel,
            position: exercise.position,
            supersetGroup: exercise.supersetGroup,
            status: 'pending',
            sets: [],
          })),
        };
        return { session: state.activeSession };
      }

      if (path === '/api/sessions/501/exercises/101/start' && method === 'POST') {
        startCalls.push(101);
        return {
          exerciseProgress: {
            exerciseId: 101,
            status: 'in_progress',
            startedAt: now,
          },
        };
      }
      if (path === '/api/sessions/501/exercises/102/start' && method === 'POST') {
        startCalls.push(102);
        return {
          exerciseProgress: {
            exerciseId: 102,
            status: 'in_progress',
            startedAt: now,
          },
        };
      }

      if (path === '/api/sessions/501/sets' && method === 'POST') {
        const payload = JSON.parse(options.body);
        counts[payload.exerciseId] += 1;
        const set = {
          id: counts[payload.exerciseId],
          sessionId: 501,
          exerciseId: payload.exerciseId,
          setIndex: counts[payload.exerciseId],
          reps: payload.reps,
          weight: payload.weight,
          bandLabel: null,
          startedAt: payload.startedAt || now,
          completedAt: payload.completedAt || now,
          createdAt: now,
        };
        return {
          set,
          exerciseProgress: {
            exerciseId: payload.exerciseId,
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

      throw new Error(`Unhandled path: ${path} (${method})`);
    });

    const user = userEvent.setup();
    renderAppAt('/workout');

    await user.click(await screen.findByRole('button', { name: 'Superset Day' }));
    await beginWorkoutThroughWarmup(user);

    await waitFor(() => {
      expect(document.querySelectorAll('.guided-workout-card')).toHaveLength(2);
    });
    expect(document.querySelectorAll('.guided-workout-shared-pill .badge-superset')).toHaveLength(1);
    expect(screen.getAllByText('Superset')).toHaveLength(1);
    expect(screen.getByText('Barbell Bench Press')).toBeInTheDocument();
    expect(screen.getByText('Barbell Pendlay Row')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Finish exercise' }));

    await waitFor(() => {
      expect(startCalls).toContain(102);
      expect(counts[101]).toBe(2);
      expect(
        screen.getByRole('button', { name: /Open exercise details for Pendlay Row/i })
      ).toBeInTheDocument();
    }, { timeout: 3000 });
    expect(screen.queryByText(/Target rest 01:00/i)).not.toBeInTheDocument();
  });

  it('disables exercise nav buttons at superset start and end boundaries', async () => {
    const now = new Date().toISOString();
    const activeSession = {
      id: 777,
      routineId: 44,
      routineName: 'Superset Day',
      name: 'Superset Day',
      startedAt: now,
      endedAt: null,
      notes: null,
      exercises: [
        {
          exerciseId: 101,
          name: 'Bench Press',
          equipment: 'Barbell',
          targetSets: 1,
          targetReps: 8,
          targetRepsRange: null,
          targetRestSeconds: 60,
          targetWeight: 80,
          targetBandLabel: null,
          status: 'pending',
          position: 0,
          supersetGroup: 'g1',
          sets: [],
        },
        {
          exerciseId: 102,
          name: 'Pendlay Row',
          equipment: 'Barbell',
          targetSets: 1,
          targetReps: 8,
          targetRepsRange: null,
          targetRestSeconds: 60,
          targetWeight: 60,
          targetBandLabel: null,
          status: 'in_progress',
          position: 1,
          supersetGroup: 'g1',
          sets: [],
        },
        {
          exerciseId: 103,
          name: 'Incline Dumbbell Curl',
          equipment: 'Dumbbell',
          targetSets: 1,
          targetReps: 10,
          targetRepsRange: null,
          targetRestSeconds: 60,
          targetWeight: 12,
          targetBandLabel: null,
          status: 'pending',
          position: 2,
          supersetGroup: 'g2',
          sets: [],
        },
        {
          exerciseId: 104,
          name: 'Overhead Triceps Extension',
          equipment: 'Cable',
          targetSets: 1,
          targetReps: 12,
          targetRepsRange: null,
          targetRestSeconds: 60,
          targetWeight: 25,
          targetBandLabel: null,
          status: 'pending',
          position: 3,
          supersetGroup: 'g2',
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

    expect(await screen.findByText('Barbell Bench Press')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous exercise' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Next exercise' }));
    expect(await screen.findByText('Dumbbell Incline Dumbbell Curl')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next exercise' })).toBeDisabled();
  });

  it('does not auto-finish a superset exercise while its pair is still pending', async () => {
    const now = new Date().toISOString();
    const activeSession = {
      id: 777,
      routineId: 44,
      routineName: 'Superset Day',
      name: 'Superset Day',
      startedAt: now,
      endedAt: null,
      notes: null,
      exercises: [
        {
          exerciseId: 101,
          name: 'Bench Press',
          equipment: 'Barbell',
          targetSets: 1,
          targetReps: 8,
          targetRepsRange: null,
          targetRestSeconds: 60,
          targetWeight: 80,
          targetBandLabel: null,
          status: 'in_progress',
          position: 0,
          supersetGroup: 'g1',
          sets: [],
        },
        {
          exerciseId: 102,
          name: 'Pendlay Row',
          equipment: 'Barbell',
          targetSets: 1,
          targetReps: 8,
          targetRepsRange: null,
          targetRestSeconds: 60,
          targetWeight: 60,
          targetBandLabel: null,
          status: 'pending',
          position: 1,
          supersetGroup: 'g1',
          sets: [],
        },
      ],
    };

    apiFetch.mockImplementation(async (path) => {
      if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
      if (path === '/api/routines') return { routines: [] };
      if (path === '/api/exercises') return { exercises: [] };
      if (path === '/api/sessions/active') return { session: activeSession };
      if (path === '/api/sessions?limit=15') return { sessions: [] };
      if (path === '/api/weights?limit=6') return { weights: [] };
      if (path === '/api/bands') return { bands: [] };
      throw new Error(`Unhandled path: ${path}`);
    });

    const user = userEvent.setup();
    renderAppAt('/workout');

    await user.click(await screen.findByRole('button', { name: /Toggle set 1 for Bench Press/i }));

    expect(
      apiFetch.mock.calls.some(
        ([path, options]) => path === '/api/sessions/777/exercises/101/complete' && options?.method === 'POST'
      )
    ).toBe(false);
    expect(screen.getByRole('button', { name: 'Finish workout' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip exercise' })).not.toBeInTheDocument();
    expect(screen.getByText('Barbell Bench Press')).toBeInTheDocument();
    expect(screen.getByText('Barbell Pendlay Row')).toBeInTheDocument();
  });

  it('moves to the exercise after a superset when both superset exercises are done', async () => {
    const now = new Date().toISOString();
    const startCalls = [];
    const completeCalls = [];
    const setCounts = { 101: 0, 102: 0, 103: 0 };
    const activeSession = {
      id: 777,
      routineId: 44,
      routineName: 'Superset Day',
      name: 'Superset Day',
      startedAt: now,
      endedAt: null,
      notes: null,
      exercises: [
        {
          exerciseId: 101,
          name: 'Bench Press',
          equipment: 'Barbell',
          targetSets: 1,
          targetReps: 8,
          targetRepsRange: null,
          targetRestSeconds: 60,
          targetWeight: 80,
          targetBandLabel: null,
          status: 'in_progress',
          position: 0,
          supersetGroup: 'g1',
          sets: [],
        },
        {
          exerciseId: 102,
          name: 'Pendlay Row',
          equipment: 'Barbell',
          targetSets: 1,
          targetReps: 8,
          targetRepsRange: null,
          targetRestSeconds: 60,
          targetWeight: 60,
          targetBandLabel: null,
          status: 'pending',
          position: 1,
          supersetGroup: 'g1',
          sets: [],
        },
        {
          exerciseId: 103,
          name: 'Incline Dumbbell Curl',
          equipment: 'Dumbbell',
          targetSets: 1,
          targetReps: 10,
          targetRepsRange: null,
          targetRestSeconds: 60,
          targetWeight: 12,
          targetBandLabel: null,
          status: 'pending',
          position: 2,
          supersetGroup: null,
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

      if (path === '/api/sessions/777/sets' && method === 'POST') {
        const payload = JSON.parse(options.body);
        setCounts[payload.exerciseId] += 1;
        return {
          set: {
            id: setCounts[payload.exerciseId],
            sessionId: 777,
            exerciseId: payload.exerciseId,
            setIndex: setCounts[payload.exerciseId],
            reps: payload.reps,
            weight: payload.weight,
            bandLabel: payload.bandLabel || null,
            startedAt: payload.startedAt || now,
            completedAt: payload.completedAt || now,
            createdAt: now,
          },
          exerciseProgress: {
            exerciseId: payload.exerciseId,
            status: 'in_progress',
            startedAt: now,
          },
        };
      }

      if (path === '/api/sessions/777/exercises/101/complete' && method === 'POST') {
        completeCalls.push(101);
        return { exerciseProgress: { exerciseId: 101, status: 'completed', startedAt: now, completedAt: now } };
      }
      if (path === '/api/sessions/777/exercises/102/complete' && method === 'POST') {
        completeCalls.push(102);
        return { exerciseProgress: { exerciseId: 102, status: 'completed', startedAt: now, completedAt: now } };
      }

      if (path === '/api/sessions/777/exercises/103/start' && method === 'POST') {
        startCalls.push(103);
        return { exerciseProgress: { exerciseId: 103, status: 'in_progress', startedAt: now } };
      }
      if (path === '/api/sessions/777/exercises/102/start' && method === 'POST') {
        startCalls.push(102);
        return { exerciseProgress: { exerciseId: 102, status: 'in_progress', startedAt: now } };
      }

      throw new Error(`Unhandled path: ${path} (${method})`);
    });

    const user = userEvent.setup();
    renderAppAt('/workout');

    await user.click(await screen.findByRole('button', { name: /Toggle set 1 for Pendlay Row/i }));
    await user.click(await screen.findByRole('button', { name: /Toggle set 1 for Bench Press/i }));

    await waitFor(() => {
      expect(startCalls).toContain(103);
      expect(startCalls).not.toContain(102);
      expect(completeCalls).toEqual(expect.arrayContaining([101, 102]));
    });
    expect(await screen.findByText(/Incline Dumbbell Curl/i)).toBeInTheDocument();
  });

  it('auto-finishes supersets when the final checked set is on the second superset card', async () => {
    const now = new Date().toISOString();
    const startCalls = [];
    const completeCalls = [];
    const setCounts = { 101: 0, 102: 0, 103: 0 };
    const activeSession = {
      id: 777,
      routineId: 44,
      routineName: 'Superset Day',
      name: 'Superset Day',
      startedAt: now,
      endedAt: null,
      notes: null,
      exercises: [
        {
          exerciseId: 101,
          name: 'Bench Press',
          equipment: 'Barbell',
          targetSets: 1,
          targetReps: 8,
          targetRepsRange: null,
          targetRestSeconds: 60,
          targetWeight: 80,
          targetBandLabel: null,
          status: 'in_progress',
          position: 0,
          supersetGroup: 'g1',
          sets: [],
        },
        {
          exerciseId: 102,
          name: 'Pendlay Row',
          equipment: 'Barbell',
          targetSets: 1,
          targetReps: 8,
          targetRepsRange: null,
          targetRestSeconds: 60,
          targetWeight: 60,
          targetBandLabel: null,
          status: 'pending',
          position: 1,
          supersetGroup: 'g1',
          sets: [],
        },
        {
          exerciseId: 103,
          name: 'Incline Dumbbell Curl',
          equipment: 'Dumbbell',
          targetSets: 1,
          targetReps: 10,
          targetRepsRange: null,
          targetRestSeconds: 60,
          targetWeight: 12,
          targetBandLabel: null,
          status: 'pending',
          position: 2,
          supersetGroup: null,
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

      if (path === '/api/sessions/777/sets' && method === 'POST') {
        const payload = JSON.parse(options.body);
        setCounts[payload.exerciseId] += 1;
        return {
          set: {
            id: setCounts[payload.exerciseId],
            sessionId: 777,
            exerciseId: payload.exerciseId,
            setIndex: setCounts[payload.exerciseId],
            reps: payload.reps,
            weight: payload.weight,
            bandLabel: payload.bandLabel || null,
            startedAt: payload.startedAt || now,
            completedAt: payload.completedAt || now,
            createdAt: now,
          },
          exerciseProgress: {
            exerciseId: payload.exerciseId,
            status: 'in_progress',
            startedAt: now,
          },
        };
      }

      if (path === '/api/sessions/777/exercises/101/complete' && method === 'POST') {
        completeCalls.push(101);
        return { exerciseProgress: { exerciseId: 101, status: 'completed', startedAt: now, completedAt: now } };
      }
      if (path === '/api/sessions/777/exercises/102/complete' && method === 'POST') {
        completeCalls.push(102);
        return { exerciseProgress: { exerciseId: 102, status: 'completed', startedAt: now, completedAt: now } };
      }

      if (path === '/api/sessions/777/exercises/103/start' && method === 'POST') {
        startCalls.push(103);
        return { exerciseProgress: { exerciseId: 103, status: 'in_progress', startedAt: now } };
      }
      if (path === '/api/sessions/777/exercises/102/start' && method === 'POST') {
        startCalls.push(102);
        return { exerciseProgress: { exerciseId: 102, status: 'in_progress', startedAt: now } };
      }

      throw new Error(`Unhandled path: ${path} (${method})`);
    });

    const user = userEvent.setup();
    renderAppAt('/workout');

    await user.click(await screen.findByRole('button', { name: /Toggle set 1 for Bench Press/i }));
    await user.click(await screen.findByRole('button', { name: /Toggle set 1 for Pendlay Row/i }));

    await waitFor(() => {
      expect(startCalls).toContain(103);
      expect(startCalls).not.toContain(102);
      expect(completeCalls).toEqual(expect.arrayContaining([101, 102]));
    });
    expect(await screen.findByText(/Incline Dumbbell Curl/i)).toBeInTheDocument();
  });

  it('treats a final superset pair as workout-completing when partner checklist is done', async () => {
    const now = new Date().toISOString();
    const completeCalls = [];
    const setCounts = { 101: 0, 102: 0 };
    const savedSets = { 101: [], 102: [] };
    const activeSession = {
      id: 777,
      routineId: 44,
      routineName: 'Superset Day',
      name: 'Superset Day',
      startedAt: now,
      endedAt: null,
      notes: null,
      exercises: [
        {
          exerciseId: 101,
          name: 'Bench Press',
          equipment: 'Barbell',
          targetSets: 2,
          targetReps: 8,
          targetRepsRange: null,
          targetRestSeconds: 60,
          targetWeight: 80,
          targetBandLabel: null,
          status: 'in_progress',
          position: 0,
          supersetGroup: 'g1',
          sets: [],
        },
        {
          exerciseId: 102,
          name: 'Pendlay Row',
          equipment: 'Barbell',
          targetSets: 2,
          targetReps: 8,
          targetRepsRange: null,
          targetRestSeconds: 60,
          targetWeight: 60,
          targetBandLabel: null,
          status: 'pending',
          position: 1,
          supersetGroup: 'g1',
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

      if (path === '/api/sessions/777/sets' && method === 'POST') {
        const payload = JSON.parse(options.body);
        setCounts[payload.exerciseId] += 1;
        const set = {
          id: setCounts[payload.exerciseId],
          sessionId: 777,
          exerciseId: payload.exerciseId,
          setIndex: setCounts[payload.exerciseId],
          reps: payload.reps,
          weight: payload.weight,
          bandLabel: payload.bandLabel || null,
          startedAt: payload.startedAt || now,
          completedAt: payload.completedAt || now,
          createdAt: now,
        };
        savedSets[payload.exerciseId].push(set);
        return {
          set,
          exerciseProgress: {
            exerciseId: payload.exerciseId,
            status: 'in_progress',
            startedAt: now,
          },
        };
      }

      if (path === '/api/sessions/777/exercises/101/complete' && method === 'POST') {
        completeCalls.push(101);
        return { exerciseProgress: { exerciseId: 101, status: 'completed', startedAt: now, completedAt: now } };
      }
      if (path === '/api/sessions/777/exercises/102/complete' && method === 'POST') {
        completeCalls.push(102);
        return { exerciseProgress: { exerciseId: 102, status: 'completed', startedAt: now, completedAt: now } };
      }
      if (path === '/api/sessions/777' && method === 'PUT') {
        return {
          session: {
            id: 777,
            routineId: 44,
            routineName: 'Superset Day',
            startedAt: now,
            endedAt: now,
            exercises: [
              {
                exerciseId: 101,
                name: 'Bench Press',
                equipment: 'Barbell',
                targetSets: 2,
                targetReps: 8,
                targetRepsRange: null,
                targetRestSeconds: 60,
                targetWeight: 80,
                targetBandLabel: null,
                status: 'completed',
                position: 0,
                supersetGroup: 'g1',
                sets: savedSets[101],
              },
              {
                exerciseId: 102,
                name: 'Pendlay Row',
                equipment: 'Barbell',
                targetSets: 2,
                targetReps: 8,
                targetRepsRange: null,
                targetRestSeconds: 60,
                targetWeight: 60,
                targetBandLabel: null,
                status: 'completed',
                position: 1,
                supersetGroup: 'g1',
                sets: savedSets[102],
              },
            ],
          },
        };
      }

      throw new Error(`Unhandled path: ${path} (${method})`);
    });

    const user = userEvent.setup();
    renderAppAt('/workout');

    expect(await screen.findByRole('button', { name: 'Finish workout' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip exercise' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /Toggle set 1 for Pendlay Row/i }));
    await user.click(await screen.findByRole('button', { name: /Toggle set 2 for Pendlay Row/i }));

    expect(screen.getByRole('button', { name: 'Finish workout' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip exercise' })).not.toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: /Toggle set 1 for Bench Press/i }));
    await user.click(await screen.findByRole('button', { name: /Toggle set 2 for Bench Press/i }));

    expect(await screen.findByText('Workout details')).toBeInTheDocument();
    expect(completeCalls).toEqual(expect.arrayContaining([101, 102]));
  });

  it('shows finish-workout state for a final pending superset pair and completes workout', async () => {
    const now = new Date().toISOString();
    const completeCalls = [];
    const setCounts = { 106: 0, 107: 0 };
    const savedSets = { 106: [], 107: [] };
    const activeSession = {
      id: 777,
      routineId: 55,
      routineName: 'Full Body',
      name: 'Full Body',
      startedAt: now,
      endedAt: null,
      notes: null,
      exercises: [
        {
          exerciseId: 101,
          name: 'Exercise 1',
          equipment: 'Bodyweight',
          targetSets: 1,
          targetReps: 10,
          targetRepsRange: null,
          targetRestSeconds: 60,
          targetWeight: null,
          targetBandLabel: null,
          status: 'completed',
          position: 0,
          supersetGroup: null,
          sets: [{ id: 1, setIndex: 1, reps: 10, weight: 0, bandLabel: null, startedAt: now, completedAt: now, createdAt: now }],
        },
        {
          exerciseId: 102,
          name: 'Exercise 2',
          equipment: 'Bodyweight',
          targetSets: 1,
          targetReps: 10,
          targetRepsRange: null,
          targetRestSeconds: 60,
          targetWeight: null,
          targetBandLabel: null,
          status: 'completed',
          position: 1,
          supersetGroup: null,
          sets: [{ id: 2, setIndex: 1, reps: 10, weight: 0, bandLabel: null, startedAt: now, completedAt: now, createdAt: now }],
        },
        {
          exerciseId: 103,
          name: 'Exercise 3',
          equipment: 'Bodyweight',
          targetSets: 1,
          targetReps: 10,
          targetRepsRange: null,
          targetRestSeconds: 60,
          targetWeight: null,
          targetBandLabel: null,
          status: 'completed',
          position: 2,
          supersetGroup: null,
          sets: [{ id: 3, setIndex: 1, reps: 10, weight: 0, bandLabel: null, startedAt: now, completedAt: now, createdAt: now }],
        },
        {
          exerciseId: 104,
          name: 'Exercise 4',
          equipment: 'Bodyweight',
          targetSets: 1,
          targetReps: 10,
          targetRepsRange: null,
          targetRestSeconds: 60,
          targetWeight: null,
          targetBandLabel: null,
          status: 'completed',
          position: 3,
          supersetGroup: null,
          sets: [{ id: 4, setIndex: 1, reps: 10, weight: 0, bandLabel: null, startedAt: now, completedAt: now, createdAt: now }],
        },
        {
          exerciseId: 105,
          name: 'Exercise 5',
          equipment: 'Bodyweight',
          targetSets: 1,
          targetReps: 10,
          targetRepsRange: null,
          targetRestSeconds: 60,
          targetWeight: null,
          targetBandLabel: null,
          status: 'completed',
          position: 4,
          supersetGroup: null,
          sets: [{ id: 5, setIndex: 1, reps: 10, weight: 0, bandLabel: null, startedAt: now, completedAt: now, createdAt: now }],
        },
        {
          exerciseId: 106,
          name: 'Bodyweight Sit-Up',
          equipment: 'Bodyweight',
          targetSets: 2,
          targetReps: 10,
          targetRepsRange: null,
          targetRestSeconds: 90,
          targetWeight: null,
          targetBandLabel: null,
          status: 'in_progress',
          position: 5,
          supersetGroup: 'last-pair',
          sets: [],
        },
        {
          exerciseId: 107,
          name: 'Band External Rotation',
          equipment: 'Band',
          targetSets: 2,
          targetReps: 10,
          targetRepsRange: null,
          targetRestSeconds: 90,
          targetWeight: null,
          targetBandLabel: '10 lb',
          status: 'pending',
          position: 6,
          supersetGroup: 'last-pair',
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

      if (path === '/api/sessions/777/sets' && method === 'POST') {
        const payload = JSON.parse(options.body);
        setCounts[payload.exerciseId] += 1;
        const set = {
          id: setCounts[payload.exerciseId],
          sessionId: 777,
          exerciseId: payload.exerciseId,
          setIndex: setCounts[payload.exerciseId],
          reps: payload.reps,
          weight: payload.weight,
          bandLabel: payload.bandLabel || null,
          startedAt: payload.startedAt || now,
          completedAt: payload.completedAt || now,
          createdAt: now,
        };
        savedSets[payload.exerciseId].push(set);
        return {
          set,
          exerciseProgress: {
            exerciseId: payload.exerciseId,
            status: 'in_progress',
            startedAt: now,
          },
        };
      }

      if (path === '/api/sessions/777/exercises/106/complete' && method === 'POST') {
        completeCalls.push(106);
        return { exerciseProgress: { exerciseId: 106, status: 'completed', startedAt: now, completedAt: now } };
      }
      if (path === '/api/sessions/777/exercises/107/complete' && method === 'POST') {
        completeCalls.push(107);
        return { exerciseProgress: { exerciseId: 107, status: 'completed', startedAt: now, completedAt: now } };
      }

      if (path === '/api/sessions/777' && method === 'PUT') {
        return {
          session: {
            id: 777,
            routineId: 55,
            routineName: 'Full Body',
            startedAt: now,
            endedAt: now,
            exercises: [
              {
                exerciseId: 106,
                name: 'Bodyweight Sit-Up',
                equipment: 'Bodyweight',
                targetSets: 2,
                targetReps: 10,
                targetRepsRange: null,
                targetRestSeconds: 90,
                targetWeight: null,
                targetBandLabel: null,
                status: 'completed',
                position: 5,
                durationSeconds: 95,
                supersetGroup: 'last-pair',
                sets: savedSets[106],
              },
              {
                exerciseId: 107,
                name: 'Band External Rotation',
                equipment: 'Band',
                targetSets: 2,
                targetReps: 10,
                targetRepsRange: null,
                targetRestSeconds: 90,
                targetWeight: null,
                targetBandLabel: '10 lb',
                status: 'completed',
                position: 6,
                durationSeconds: 85,
                supersetGroup: 'last-pair',
                sets: savedSets[107],
              },
            ],
          },
        };
      }

      throw new Error(`Unhandled path: ${path} (${method})`);
    });

    const user = userEvent.setup();
    renderAppAt('/workout');

    const progress = await screen.findByRole('progressbar', { name: 'Workout exercise progress' });
    expect(progress).toHaveAttribute('aria-valuenow', '7');
    expect(progress).toHaveAttribute('aria-valuemax', '7');
    expect(await screen.findByRole('button', { name: 'Finish workout' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip exercise' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Finish workout' }));

    expect(await screen.findByText('Workout details')).toBeInTheDocument();
    const detailTitle = await screen.findByText('Workout details');
    const detailModal = detailTitle.closest('.modal-panel');
    expect(detailModal).toBeTruthy();
    const detailScope = within(detailModal);
    expect(detailModal.querySelectorAll('.session-detail-superset-block')).toHaveLength(1);
    expect(detailScope.getAllByText('Superset')).toHaveLength(1);
    expect(detailScope.getByText('03:00')).toBeInTheDocument();
    expect(completeCalls).toEqual(expect.arrayContaining([106, 107]));
  });

  it('skip exercise on supersets skips both pair exercises and advances past the pair', async () => {
    const now = new Date().toISOString();
    const startCalls = [];
    const completeCalls = [];
    const activeSession = {
      id: 777,
      routineId: 44,
      routineName: 'Superset Day',
      name: 'Superset Day',
      startedAt: now,
      endedAt: null,
      notes: null,
      exercises: [
        {
          exerciseId: 101,
          name: 'Bench Press',
          equipment: 'Barbell',
          targetSets: 1,
          targetReps: 8,
          targetRepsRange: null,
          targetRestSeconds: 60,
          targetWeight: 80,
          targetBandLabel: null,
          status: 'in_progress',
          position: 0,
          supersetGroup: 'g1',
          sets: [],
        },
        {
          exerciseId: 102,
          name: 'Pendlay Row',
          equipment: 'Barbell',
          targetSets: 1,
          targetReps: 8,
          targetRepsRange: null,
          targetRestSeconds: 60,
          targetWeight: 60,
          targetBandLabel: null,
          status: 'pending',
          position: 1,
          supersetGroup: 'g1',
          sets: [],
        },
        {
          exerciseId: 103,
          name: 'Incline Dumbbell Curl',
          equipment: 'Dumbbell',
          targetSets: 1,
          targetReps: 10,
          targetRepsRange: null,
          targetRestSeconds: 60,
          targetWeight: 12,
          targetBandLabel: null,
          status: 'pending',
          position: 2,
          supersetGroup: null,
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

      if (path === '/api/sessions/777/exercises/101/complete' && method === 'POST') {
        completeCalls.push(101);
        return { exerciseProgress: { exerciseId: 101, status: 'completed', startedAt: now, completedAt: now } };
      }
      if (path === '/api/sessions/777/exercises/102/complete' && method === 'POST') {
        completeCalls.push(102);
        return { exerciseProgress: { exerciseId: 102, status: 'completed', startedAt: now, completedAt: now } };
      }
      if (path === '/api/sessions/777/exercises/103/start' && method === 'POST') {
        startCalls.push(103);
        return { exerciseProgress: { exerciseId: 103, status: 'in_progress', startedAt: now } };
      }
      if (path === '/api/sessions/777/exercises/102/start' && method === 'POST') {
        startCalls.push(102);
        return { exerciseProgress: { exerciseId: 102, status: 'in_progress', startedAt: now } };
      }

      throw new Error(`Unhandled path: ${path} (${method})`);
    });

    const user = userEvent.setup();
    renderAppAt('/workout');

    await user.click(await screen.findByRole('button', { name: 'Skip exercise' }));

    expect(await screen.findByText('Dumbbell Incline Dumbbell Curl')).toBeInTheDocument();
    expect(completeCalls).toEqual(expect.arrayContaining([101, 102]));
    expect(startCalls).toContain(103);
    expect(startCalls).not.toContain(102);
  });


});
