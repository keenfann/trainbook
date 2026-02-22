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
  it('does not persist unchecked sets when skipping an exercise', async () => {
    const now = new Date().toISOString();
    const startCalls = [];
    const completePayloads = [];
    const savedSets = [];
    const activeSession = {
      id: 777,
      routineId: 44,
      routineName: 'Leg Day',
      name: 'Leg Day',
      startedAt: now,
      endedAt: null,
      notes: null,
      exercises: [
        {
          exerciseId: 101,
          name: 'Back Squat',
          equipment: 'Barbell',
          targetSets: 2,
          targetReps: 5,
          targetRepsRange: null,
          targetRestSeconds: 60,
          targetWeight: 100,
          targetBandLabel: null,
          status: 'in_progress',
          position: 0,
          supersetGroup: null,
          sets: [],
        },
        {
          exerciseId: 103,
          name: 'Leg Extension',
          equipment: 'Machine',
          targetSets: 1,
          targetReps: 10,
          targetRepsRange: null,
          targetRestSeconds: 60,
          targetWeight: 45,
          targetBandLabel: null,
          status: 'pending',
          position: 1,
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
        savedSets.push(payload);
        return {
          set: {
            id: savedSets.length,
            sessionId: 777,
            exerciseId: payload.exerciseId,
            setIndex: savedSets.length,
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
        completePayloads.push(JSON.parse(options.body));
        return { exerciseProgress: { exerciseId: 101, status: 'skipped', startedAt: now, completedAt: now } };
      }
      if (path === '/api/sessions/777/exercises/103/start' && method === 'POST') {
        startCalls.push(103);
        return { exerciseProgress: { exerciseId: 103, status: 'in_progress', startedAt: now } };
      }

      throw new Error(`Unhandled path: ${path} (${method})`);
    });

    const user = userEvent.setup();
    renderAppAt('/workout');

    await user.click(await screen.findByRole('button', { name: 'Skip exercise' }, { timeout: 3000 }));

    await waitFor(() => {
      expect(savedSets).toHaveLength(0);
      expect(completePayloads).toHaveLength(1);
      expect(completePayloads[0].skipped).toBe(true);
      expect(startCalls).toContain(103);
    });
  });

  it('treats previously skipped exercises as done for progress and final-action state', async () => {
    const now = new Date().toISOString();
    const activeSession = {
      id: 777,
      routineId: 44,
      routineName: 'Leg Day',
      name: 'Leg Day',
      startedAt: now,
      endedAt: null,
      notes: null,
      exercises: [
        {
          exerciseId: 101,
          name: 'Back Squat',
          equipment: 'Barbell',
          targetSets: 2,
          targetReps: 5,
          targetRepsRange: null,
          targetRestSeconds: 60,
          targetWeight: 100,
          targetBandLabel: null,
          status: 'skipped',
          startedAt: now,
          completedAt: now,
          position: 0,
          supersetGroup: null,
          sets: [],
        },
        {
          exerciseId: 103,
          name: 'Leg Extension',
          equipment: 'Machine',
          targetSets: 1,
          targetReps: 10,
          targetRepsRange: null,
          targetRestSeconds: 60,
          targetWeight: 45,
          targetBandLabel: null,
          status: 'in_progress',
          position: 1,
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

      throw new Error(`Unhandled path: ${path} (${method})`);
    });

    renderAppAt('/workout');

    const progress = await screen.findByRole('progressbar', { name: 'Workout exercise progress' });
    expect(progress).toHaveAttribute('aria-valuenow', '2');
    expect(progress).toHaveAttribute('aria-valuemax', '2');
    expect(await screen.findByRole('button', { name: 'Finish workout' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip exercise' })).not.toBeInTheDocument();
  });

  it('persists checked sets before skipping an exercise', async () => {
    const now = new Date().toISOString();
    const startCalls = [];
    const completeCalls = [];
    const setCounts = { 101: 0 };
    const savedSets = [];
    const activeSession = {
      id: 777,
      routineId: 44,
      routineName: 'Leg Day',
      name: 'Leg Day',
      startedAt: now,
      endedAt: null,
      notes: null,
      exercises: [
        {
          exerciseId: 101,
          name: 'Back Squat',
          equipment: 'Barbell',
          targetSets: 2,
          targetReps: 5,
          targetRepsRange: null,
          targetRestSeconds: 60,
          targetWeight: 100,
          targetBandLabel: null,
          status: 'in_progress',
          position: 0,
          supersetGroup: null,
          sets: [],
        },
        {
          exerciseId: 103,
          name: 'Leg Extension',
          equipment: 'Machine',
          targetSets: 1,
          targetReps: 10,
          targetRepsRange: null,
          targetRestSeconds: 60,
          targetWeight: 45,
          targetBandLabel: null,
          status: 'pending',
          position: 1,
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
        savedSets.push(set);
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
      if (path === '/api/sessions/777/exercises/103/start' && method === 'POST') {
        startCalls.push(103);
        return { exerciseProgress: { exerciseId: 103, status: 'in_progress', startedAt: now } };
      }

      throw new Error(`Unhandled path: ${path} (${method})`);
    });

    const user = userEvent.setup();
    renderAppAt('/workout');

    await user.click(await screen.findByRole('button', { name: /Toggle set 1 for Back Squat/i }, { timeout: 3000 }));
    await user.click(await screen.findByRole('button', { name: 'Skip exercise' }, { timeout: 3000 }));

    await waitFor(() => {
      expect(completeCalls).toEqual(expect.arrayContaining([101]));
      expect(startCalls).toContain(103);
      expect(savedSets).toHaveLength(1);
      expect(savedSets[0]).toMatchObject({
        exerciseId: 101,
        setIndex: 1,
        reps: 5,
        weight: 100,
      });
    });
  });


  it('persists all remaining sets when finishing an exercise with unchecked set rows', async () => {
    const now = new Date().toISOString();
    const startCalls = [];
    const completeCalls = [];
    const setCounts = { 101: 0 };
    const savedSets = [];
    const activeSession = {
      id: 777,
      routineId: 44,
      routineName: 'Leg Day',
      name: 'Leg Day',
      startedAt: now,
      endedAt: null,
      notes: null,
      exercises: [
        {
          exerciseId: 101,
          name: 'Back Squat',
          equipment: 'Barbell',
          targetSets: 2,
          targetReps: 5,
          targetRepsRange: null,
          targetRestSeconds: 60,
          targetWeight: 100,
          targetBandLabel: null,
          status: 'in_progress',
          position: 0,
          supersetGroup: null,
          sets: [],
        },
        {
          exerciseId: 103,
          name: 'Leg Extension',
          equipment: 'Machine',
          targetSets: 1,
          targetReps: 10,
          targetRepsRange: null,
          targetRestSeconds: 60,
          targetWeight: 45,
          targetBandLabel: null,
          status: 'pending',
          position: 1,
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
        savedSets.push(set);
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
      if (path === '/api/sessions/777/exercises/103/start' && method === 'POST') {
        startCalls.push(103);
        return { exerciseProgress: { exerciseId: 103, status: 'in_progress', startedAt: now } };
      }

      throw new Error(`Unhandled path: ${path} (${method})`);
    });

    const user = userEvent.setup();
    renderAppAt('/workout');

    await user.click(await screen.findByRole('button', { name: /Toggle set 1 for Back Squat/i }, { timeout: 3000 }));
    await user.click(await screen.findByRole('button', { name: 'Finish exercise' }, { timeout: 3000 }));

    await waitFor(() => {
      expect(completeCalls).toEqual(expect.arrayContaining([101]));
      expect(startCalls).toContain(103);
      expect(savedSets).toHaveLength(2);
      expect(savedSets).toEqual([
        expect.objectContaining({
          exerciseId: 101,
          setIndex: 1,
          reps: 5,
          weight: 100,
        }),
        expect.objectContaining({
          exerciseId: 101,
          setIndex: 2,
          reps: 5,
          weight: 100,
        }),
      ]);
    });
  });

  it('allows checking and unchecking local set checklist rows before finishing', async () => {
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
          name: 'Back Squat',
          equipment: 'Barbell',
          targetSets: 2,
          targetReps: 5,
          targetRepsRange: null,
          targetRestSeconds: 120,
          targetWeight: 100,
          targetBandLabel: null,
          status: 'in_progress',
          position: 0,
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

    const setToggle = await screen.findByRole('button', { name: /Toggle set 1/i });
    const progress = screen.getByRole('progressbar', { name: 'Workout exercise progress' });
    expect(progress).toHaveAttribute('aria-valuenow', '1');
    expect(progress).toHaveAttribute('aria-valuemax', '1');
    expect(setToggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(setToggle);
    await waitFor(() => expect(setToggle).toHaveAttribute('aria-pressed', 'true'));
    await waitFor(() => expect(setToggle).toHaveClass('set-checklist-row-celebrate'));
    await user.click(setToggle);
    await waitFor(() => expect(setToggle).toHaveAttribute('aria-pressed', 'false'));
    await waitFor(() => expect(setToggle).not.toHaveClass('set-checklist-row-celebrate'));
  });

  it('opens workout exercise list from an icon button in workout mode', async () => {
    const now = new Date().toISOString();
    const activeSession = {
      id: 778,
      routineId: 31,
      routineName: 'Leg Day',
      name: 'Leg Day',
      startedAt: now,
      endedAt: null,
      notes: null,
      exercises: [
        {
          exerciseId: 101,
          name: 'Back Squat',
          equipment: 'Barbell',
          targetSets: 2,
          targetReps: 5,
          targetRepsRange: null,
          targetRestSeconds: 120,
          targetWeight: 100,
          targetBandLabel: null,
          status: 'in_progress',
          position: 0,
          sets: [],
        },
        {
          exerciseId: 102,
          name: 'Romanian Deadlift',
          equipment: 'Barbell',
          targetSets: 2,
          targetReps: 8,
          targetRepsRange: null,
          targetRestSeconds: 90,
          targetWeight: 90,
          targetBandLabel: null,
          status: 'pending',
          position: 1,
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

    const previewToggle = await screen.findByRole('button', { name: /Open workout exercises/i });
    const progress = screen.getByRole('progressbar', { name: 'Workout exercise progress' });
    expect(progress).toHaveAttribute('aria-valuenow', '1');
    expect(progress).toHaveAttribute('aria-valuemax', '2');
    expect(screen.queryByText('1. Barbell Back Squat')).not.toBeInTheDocument();

    await user.click(previewToggle);

    expect(await screen.findByText('1. Barbell Back Squat')).toBeInTheDocument();
    expect(await screen.findByText('2. Barbell Romanian Deadlift')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finish exercise' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip exercise' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End workout' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Close workout exercises/i }));
    await waitFor(() => {
      expect(screen.queryByText('1. Barbell Back Squat')).not.toBeInTheDocument();
    });
  });

  it('shows exercise complete state when target sets are already reached', async () => {
    const now = new Date().toISOString();
    const completedSession = {
      id: 901,
      routineId: 77,
      routineName: 'Push Day',
      name: 'Push Day',
      startedAt: now,
      endedAt: null,
      notes: null,
      exercises: [
        {
          exerciseId: 101,
          name: 'Bodyweight Scapular Push-Ups',
          equipment: 'Bodyweight',
          targetSets: 3,
          targetReps: 8,
          targetRepsRange: null,
          targetRestSeconds: 45,
          targetWeight: null,
          targetBandLabel: null,
          status: 'in_progress',
          position: 0,
          sets: [
            { id: 1, setIndex: 1, reps: 8, weight: 0, bandLabel: null, startedAt: now, completedAt: now, createdAt: now },
            { id: 2, setIndex: 2, reps: 8, weight: 0, bandLabel: null, startedAt: now, completedAt: now, createdAt: now },
            { id: 3, setIndex: 3, reps: 8, weight: 0, bandLabel: null, startedAt: now, completedAt: now, createdAt: now },
          ],
        },
      ],
    };

    apiFetch.mockImplementation(async (path, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
      if (path === '/api/routines') return { routines: [] };
      if (path === '/api/exercises') return { exercises: [] };
      if (path === '/api/sessions/active') return { session: completedSession };
      if (path === '/api/sessions?limit=15') return { sessions: [] };
      if (path === '/api/weights?limit=6') return { weights: [] };
      if (path === '/api/bands') return { bands: [] };
      throw new Error(`Unhandled path: ${path} (${method})`);
    });

    renderAppAt('/workout');

    expect(await screen.findByRole('button', { name: 'End workout' })).toBeInTheDocument();
    const progress = screen.getByRole('progressbar', { name: 'Workout exercise progress' });
    expect(progress).toHaveAttribute('aria-valuenow', '1');
    expect(progress).toHaveAttribute('aria-valuemax', '1');
    expect(screen.queryByRole('button', { name: 'Finish exercise' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip exercise' })).not.toBeInTheDocument();
  });

  it('cancels a preview session without saving it', async () => {
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
          targetSets: 3,
          targetReps: 8,
          targetRepsRange: null,
          targetRestSeconds: 60,
          targetWeight: 100,
          targetBandLabel: null,
          notes: null,
          position: 0,
        },
      ],
    };
    const state = {
      activeSession: null,
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

      if (path === '/api/sessions/501' && method === 'DELETE') {
        state.activeSession = null;
        return { ok: true };
      }

      throw new Error(`Unhandled path: ${path} (${method})`);
    });

    const user = userEvent.setup();
    renderAppAt('/workout');

    await user.click(await screen.findByRole('button', { name: 'Leg Day' }));
    expect(await screen.findByRole('button', { name: 'Begin workout' })).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Cancel' })[0]);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/sessions/501',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
    expect(await screen.findByRole('button', { name: 'Leg Day' })).toBeInTheDocument();
  });

  it('updates recent sessions immediately after finishing an active session', async () => {
    const now = new Date().toISOString();
    const finishedSessionDetail = {
      id: 601,
      routineId: 88,
      routineName: 'Rehab',
      routineNotes: 'Axelskada',
      name: 'Rehab',
      startedAt: now,
      endedAt: now,
      notes: null,
      exercises: [
        {
          exerciseId: 401,
          name: 'Wall Slides',
          equipment: 'Bodyweight',
          targetSets: 2,
          targetReps: 10,
          targetRepsRange: null,
          targetRestSeconds: 45,
          targetWeight: null,
          targetBandLabel: null,
          status: 'completed',
          position: 0,
          sets: [
            { id: 1, setIndex: 1, reps: 10, weight: 0, bandLabel: null, startedAt: now, completedAt: now, createdAt: now },
            { id: 2, setIndex: 2, reps: 10, weight: 0, bandLabel: null, startedAt: now, completedAt: now, createdAt: now },
          ],
        },
      ],
    };

    apiFetch.mockImplementation(async (path, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
      if (path === '/api/routines') return { routines: [] };
      if (path === '/api/exercises') return { exercises: [] };
      if (path === '/api/sessions/active') return { session: { ...finishedSessionDetail, endedAt: null } };
      if (path === '/api/sessions?limit=15') {
        return {
          sessions: [
            {
              id: 601,
              routineId: 88,
              routineName: 'Rehab',
              routineNotes: 'Axelskada',
              name: 'Rehab',
              startedAt: now,
              endedAt: null,
              notes: null,
              totalSets: 0,
              totalReps: 0,
              totalVolume: 0,
            },
          ],
        };
      }
      if (path === '/api/weights?limit=6') return { weights: [] };
      if (path === '/api/bands') return { bands: [] };
      if (path === '/api/sessions/601' && method === 'PUT') {
        return { session: finishedSessionDetail };
      }
      throw new Error(`Unhandled path: ${path} (${method})`);
    });

    const user = userEvent.setup();
    renderAppAt('/workout');

    await user.click(await screen.findByRole('button', { name: 'End workout' }));
    expect(screen.queryByText('Session complete')).not.toBeInTheDocument();
    const detailTitle = await screen.findByText('Workout details');
    const detailModal = detailTitle.closest('.modal-panel');
    expect(detailModal).toBeTruthy();
    const detailScope = within(detailModal);
    expect(detailScope.getByText(/Workout time/i)).toBeInTheDocument();
    expect(detailScope.getByText(/Total reps/i)).toBeInTheDocument();

    await waitFor(() => {
      const recentSessionRow = screen.getByRole('button', { name: /Rehab/i });
      expect(recentSessionRow.textContent || '').toContain('2');
      expect(recentSessionRow.textContent || '').toContain('Axelskada');
    });
  });

  it('keeps completed rehab sessions with zero sets in recent workouts', async () => {
    const now = new Date().toISOString();
    const finishedSessionDetail = {
      id: 602,
      routineId: 88,
      routineType: 'rehab',
      routineName: 'Rehab',
      routineNotes: 'Axelskada',
      name: 'Rehab',
      startedAt: now,
      endedAt: now,
      notes: null,
      exercises: [
        {
          exerciseId: 402,
          name: 'External Rotation',
          equipment: 'Band',
          targetSets: 2,
          targetReps: null,
          targetRepsRange: '12-15',
          targetRestSeconds: 45,
          targetWeight: null,
          targetBandLabel: '20 lb',
          status: 'completed',
          startedAt: now,
          completedAt: now,
          position: 0,
          sets: [],
        },
        {
          exerciseId: 403,
          name: 'Wall Slides',
          equipment: 'Band',
          targetSets: 2,
          targetReps: null,
          targetRepsRange: '12-15',
          targetRestSeconds: 45,
          targetWeight: null,
          targetBandLabel: '20 lb',
          status: 'completed',
          startedAt: now,
          completedAt: now,
          position: 1,
          sets: [],
        },
        {
          exerciseId: 404,
          name: 'Y-Raise',
          equipment: 'Band',
          targetSets: 2,
          targetReps: null,
          targetRepsRange: '12-15',
          targetRestSeconds: 45,
          targetWeight: null,
          targetBandLabel: '20 lb',
          status: 'in_progress',
          startedAt: now,
          completedAt: null,
          position: 2,
          sets: [],
        },
        {
          exerciseId: 405,
          name: 'Scapula Push-Up',
          equipment: 'Bodyweight',
          targetSets: 2,
          targetReps: null,
          targetRepsRange: '10-12',
          targetRestSeconds: 45,
          targetWeight: null,
          targetBandLabel: null,
          status: 'pending',
          startedAt: null,
          completedAt: null,
          position: 3,
          sets: [],
        },
      ],
    };

    apiFetch.mockImplementation(async (path, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
      if (path === '/api/routines') return { routines: [] };
      if (path === '/api/exercises') return { exercises: [] };
      if (path === '/api/sessions/active') return { session: { ...finishedSessionDetail, endedAt: null } };
      if (path === '/api/sessions?limit=15') return { sessions: [] };
      if (path === '/api/weights?limit=6') return { weights: [] };
      if (path === '/api/bands') return { bands: [] };
      if (path === '/api/sessions/602' && method === 'PUT') {
        return { session: finishedSessionDetail };
      }
      throw new Error(`Unhandled path: ${path} (${method})`);
    });

    const user = userEvent.setup();
    renderAppAt('/workout');

    await user.click(await screen.findByRole('button', { name: 'End workout' }));
    await user.click(await screen.findByRole('button', { name: 'Finish anyway' }));

    const detailTitle = await screen.findByText('Workout details');
    const detailModal = detailTitle.closest('.modal-panel');
    expect(detailModal).toBeTruthy();
    const detailScope = within(detailModal);

    await waitFor(() => {
      const recentSessionRow = screen.getByRole('button', { name: /Rehab/i });
      expect(recentSessionRow.textContent || '').toContain('2');
      expect(recentSessionRow.textContent || '').toContain('Axelskada');
    });
    expect(detailScope.getByText('2 / 4')).toBeInTheDocument();
    expect(detailScope.queryByText(/Warmup time/i)).not.toBeInTheDocument();
    const setsMetric = detailScope.getByText(/Sets/i).closest('.session-complete-metric');
    expect(setsMetric).toBeTruthy();
    expect(within(setsMetric).getByText('4')).toBeInTheDocument();
    const totalRepsMetric = detailScope.getByText(/Total reps/i).closest('.session-complete-metric');
    expect(totalRepsMetric).toBeTruthy();
    expect(within(totalRepsMetric).getByText('48')).toBeInTheDocument();
    expect(detailScope.getAllByText(/^Skipped$/)).toHaveLength(2);
    expect(detailScope.queryByText('In progress')).not.toBeInTheDocument();
    expect(detailScope.getByRole('button', { name: /Show 2 sets for External Rotation/i })).toBeInTheDocument();
    expect(detailScope.getByRole('button', { name: /Show 2 sets for Wall Slides/i })).toBeInTheDocument();
    expect(detailScope.queryByRole('button', { name: /Show 2 sets for Y-Raise/i })).not.toBeInTheDocument();

    await user.click(detailScope.getByRole('button', { name: /Show 2 sets for External Rotation/i }));
    const externalRotationTable = detailScope.getByLabelText('External Rotation set summary');
    expect(within(externalRotationTable).getAllByText('12-15 reps')).toHaveLength(2);
    expect(within(externalRotationTable).getAllByText('20 lb')).toHaveLength(2);
  });

  it('shows completion stats in session detail modal', async () => {
    const startedAt = '2026-01-15T10:00:00.000Z';
    const endedAt = '2026-01-15T10:30:00.000Z';
    const warmupStartedAt = '2026-01-15T09:50:00.000Z';
    const warmupCompletedAt = '2026-01-15T10:00:00.000Z';
    const sessionDetail = {
      id: 710,
      routineId: 91,
      routineType: 'standard',
      routineName: 'Upper Body',
      name: 'Upper Body',
      startedAt,
      endedAt,
      durationSeconds: 1800,
      warmupStartedAt,
      warmupCompletedAt,
      warmupDurationSeconds: 600,
      notes: null,
      exercises: [
        {
          exerciseId: 901,
          name: 'Bench Press',
          equipment: 'Barbell',
          targetSets: 2,
          targetReps: 8,
          targetRepsRange: null,
          targetRestSeconds: 120,
          targetWeight: 60,
          targetBandLabel: null,
          status: 'completed',
          position: 0,
          sets: [
            { id: 1, setIndex: 1, reps: 8, weight: 60, bandLabel: null, startedAt, completedAt: startedAt, createdAt: startedAt },
          ],
        },
        {
          exerciseId: 902,
          name: 'Cable Row',
          equipment: 'Machine',
          targetSets: 2,
          targetReps: 10,
          targetRepsRange: null,
          targetRestSeconds: 90,
          targetWeight: 45,
          targetBandLabel: null,
          status: 'pending',
          position: 1,
          sets: [],
        },
      ],
    };

    apiFetch.mockImplementation(async (path, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
      if (path === '/api/routines') return { routines: [] };
      if (path === '/api/exercises') return { exercises: [] };
      if (path === '/api/sessions/active') return { session: null };
      if (path === '/api/sessions?limit=15') {
        return {
          sessions: [
            {
              id: 710,
              routineId: 91,
              routineName: 'Upper Body',
              name: 'Upper Body',
              startedAt,
              endedAt,
              notes: null,
              totalSets: 1,
              totalReps: 8,
              totalVolume: 480,
            },
          ],
        };
      }
      if (path === '/api/weights?limit=6') return { weights: [] };
      if (path === '/api/bands') return { bands: [] };
      if (path === '/api/sessions/710' && method === 'GET') return { session: sessionDetail };
      throw new Error(`Unhandled path: ${path} (${method})`);
    });

    const user = userEvent.setup();
    renderAppAt('/workout');

    await user.click(await screen.findByRole('button', { name: /Upper Body/i }));

    const detailTitle = await screen.findByText('Workout details');
    expect(detailTitle).toBeInTheDocument();
    const detailModal = detailTitle.closest('.modal-panel');
    expect(detailModal).toBeTruthy();
    const detailScope = within(detailModal);

    expect(detailScope.getByText(/Workout time/i)).toBeInTheDocument();
    expect(detailScope.getByText(/Warmup time/i)).toBeInTheDocument();
    expect(detailScope.getByText(/Exercises/i)).toBeInTheDocument();
    expect(detailScope.getByText(/Sets/i)).toBeInTheDocument();
    expect(detailScope.getByText(/Total reps/i)).toBeInTheDocument();
    expect(detailScope.getByText(/Volume/i)).toBeInTheDocument();
    expect(detailScope.getByText('Standard')).toBeInTheDocument();
    expect(detailScope.getByText('1 / 2')).toBeInTheDocument();
    expect(detailScope.getByText('480 kg')).toBeInTheDocument();
    const warmupMetric = detailScope.getByText(/Warmup time/i).closest('.session-complete-metric');
    expect(warmupMetric).toBeTruthy();
    expect(within(warmupMetric).getByText('10:00')).toBeInTheDocument();

    expect(detailScope.getAllByText(/^Skipped$/)).toHaveLength(1);
    await user.click(detailScope.getByRole('button', { name: /Show 2 sets for Bench Press/i }));
    await waitFor(() => expect(detailScope.getAllByText(/^Skipped$/)).toHaveLength(2));

    expect(detailScope.queryByRole('button', { name: /Show 0 sets for Cable Row/i })).not.toBeInTheDocument();
    expect(detailScope.getAllByText('Skipped').length).toBeGreaterThan(0);
  });

  it('prompts for bodyweight logging when no entry exists', async () => {
    apiFetch.mockImplementation(async (path, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
      if (path === '/api/routines') return { routines: [] };
      if (path === '/api/exercises') return { exercises: [] };
      if (path === '/api/sessions/active') return { session: null };
      if (path === '/api/sessions?limit=15') return { sessions: [] };
      if (path === '/api/weights?limit=6') return { weights: [] };
      if (path === '/api/bands') return { bands: [] };
      throw new Error(`Unhandled path: ${path} (${method})`);
    });

    renderAppAt('/workout');

    expect(await screen.findByText(/Log your weight to start tracking progress/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter weight')).toBeInTheDocument();
  });

  it('hides bodyweight logging input when a recent entry exists', async () => {
    const recentDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    apiFetch.mockImplementation(async (path, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
      if (path === '/api/routines') return { routines: [] };
      if (path === '/api/exercises') return { exercises: [] };
      if (path === '/api/sessions/active') return { session: null };
      if (path === '/api/sessions?limit=15') return { sessions: [] };
      if (path === '/api/weights?limit=6') {
        return {
          weights: [{ id: 1, weight: 80.5, measuredAt: recentDate }],
        };
      }
      if (path === '/api/bands') return { bands: [] };
      throw new Error(`Unhandled path: ${path} (${method})`);
    });

    renderAppAt('/workout');

    expect(await screen.findByText("Today's workout")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Enter weight')).not.toBeInTheDocument();
    expect(screen.queryByText(/over a week/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Bodyweight reminder/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/80[,.]5 kg/)).not.toBeInTheDocument();
  });

});
