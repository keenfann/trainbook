// @vitest-environment jsdom
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App.jsx';
import { apiFetch } from '../src/api.js';
import { MotionPreferenceProvider } from '../src/motion-preferences.jsx';

vi.mock('../src/api.js', () => ({
  apiFetch: vi.fn(),
}));

function renderAppAt(pathname) {
  window.history.pushState({}, '', pathname);
  return render(
    <MotionPreferenceProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </MotionPreferenceProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('App UI flows', () => {
  it('supports login flow and lands on log page', async () => {
    apiFetch.mockImplementation(async (path, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (path === '/api/auth/me') return { user: null };
      if (path === '/api/auth/login' && method === 'POST') {
        return { user: { id: 1, username: 'coach' } };
      }
      if (path === '/api/routines') return { routines: [] };
      if (path === '/api/exercises') return { exercises: [] };
      if (path === '/api/sessions/active') return { session: null };
      if (path === '/api/sessions?limit=6') return { sessions: [] };
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

  it('auto-finishes an exercise when the last checklist set is toggled', async () => {
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
      if (path === '/api/sessions?limit=6') return { sessions: [] };
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
            startedAt: now,
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
    renderAppAt('/log');

    await user.click(await screen.findByRole('button', { name: 'Leg Day' }));

    expect((await screen.findAllByText(/Back Squat/)).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Begin workout' }));
    expect(await screen.findByRole('button', { name: 'Finish workout' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip exercise' })).not.toBeInTheDocument();
    const progress = screen.getByRole('progressbar', { name: 'Workout exercise progress' });
    expect(progress).toHaveAttribute('aria-valuenow', '1');
    expect(progress).toHaveAttribute('aria-valuemax', '1');
    await user.click(await screen.findByRole('button', { name: /Toggle set 1/i }));

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
    expect(await screen.findByText('Workout details', {}, { timeout: 300 })).toBeInTheDocument();
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
      if (path === '/api/sessions?limit=6') return { sessions: [] };
      if (path === '/api/weights?limit=6') return { weights: [] };
      if (path === '/api/bands') return { bands: [] };
      throw new Error(`Unhandled path: ${path}`);
    });

    renderAppAt('/log');

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
      if (path === '/api/sessions?limit=6') return { sessions: [] };
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
    renderAppAt('/log');
    await user.click(await screen.findByRole('button', { name: 'Leg Day' }));
    await user.click(await screen.findByRole('button', { name: 'Begin workout' }));
    expect(
      await screen.findByText(/Cannot begin workout\. Update routine targets for: Back Squat \(weight\)\./i)
    ).toBeInTheDocument();
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
      if (path === '/api/sessions?limit=6') return { sessions: [] };
      if (path === '/api/weights?limit=6') return { weights: [] };
      if (path === '/api/bands') return { bands: [] };
      throw new Error(`Unhandled path: ${path} (${method})`);
    });

    const user = userEvent.setup();
    renderAppAt('/log');

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
      if (path === '/api/sessions?limit=6') return { sessions: [] };
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
        return {
          exerciseProgress: {
            exerciseId: 101,
            status: 'in_progress',
            startedAt: now,
          },
        };
      }
      if (path === '/api/sessions/501/exercises/102/start' && method === 'POST') {
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
    renderAppAt('/log');

    await user.click(await screen.findByRole('button', { name: 'Superset Day' }));
    await user.click(await screen.findByRole('button', { name: 'Begin workout' }));

    await waitFor(() => {
      expect(document.querySelectorAll('.guided-workout-card')).toHaveLength(2);
    });
    expect(screen.getByText('Barbell Bench Press')).toBeInTheDocument();
    expect(screen.getByText('Barbell Pendlay Row')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Finish exercise' }));

    expect(await screen.findByText('Barbell Pendlay Row')).toBeInTheDocument();
    expect(counts[101]).toBe(2);
    expect(screen.queryByText(/Target rest 01:00/i)).not.toBeInTheDocument();
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
      if (path === '/api/sessions?limit=6') return { sessions: [] };
      if (path === '/api/weights?limit=6') return { weights: [] };
      if (path === '/api/bands') return { bands: [] };
      throw new Error(`Unhandled path: ${path}`);
    });

    const user = userEvent.setup();
    renderAppAt('/log');

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
      if (path === '/api/sessions?limit=6') return { sessions: [] };
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
    renderAppAt('/log');

    await user.click(await screen.findByRole('button', { name: /Toggle set 1 for Pendlay Row/i }));
    await user.click(await screen.findByRole('button', { name: /Toggle set 1 for Bench Press/i }));

    expect(await screen.findByText('Dumbbell Incline Dumbbell Curl')).toBeInTheDocument();
    expect(startCalls).toContain(103);
    expect(startCalls).not.toContain(102);
    expect(completeCalls).toEqual(expect.arrayContaining([101, 102]));
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
      if (path === '/api/sessions?limit=6') return { sessions: [] };
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
    renderAppAt('/log');

    await user.click(await screen.findByRole('button', { name: /Toggle set 1 for Bench Press/i }));
    await user.click(await screen.findByRole('button', { name: /Toggle set 1 for Pendlay Row/i }));

    expect(await screen.findByText('Dumbbell Incline Dumbbell Curl')).toBeInTheDocument();
    expect(startCalls).toContain(103);
    expect(startCalls).not.toContain(102);
    expect(completeCalls).toEqual(expect.arrayContaining([101, 102]));
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
      if (path === '/api/sessions?limit=6') return { sessions: [] };
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
    renderAppAt('/log');

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
      if (path === '/api/sessions?limit=6') return { sessions: [] };
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
    renderAppAt('/log');

    const progress = await screen.findByRole('progressbar', { name: 'Workout exercise progress' });
    expect(progress).toHaveAttribute('aria-valuenow', '7');
    expect(progress).toHaveAttribute('aria-valuemax', '7');
    expect(await screen.findByRole('button', { name: 'Finish workout' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip exercise' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Finish workout' }));

    expect(await screen.findByText('Workout details')).toBeInTheDocument();
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
      if (path === '/api/sessions?limit=6') return { sessions: [] };
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
    renderAppAt('/log');

    await user.click(await screen.findByRole('button', { name: 'Skip exercise' }));

    expect(await screen.findByText('Dumbbell Incline Dumbbell Curl')).toBeInTheDocument();
    expect(completeCalls).toEqual(expect.arrayContaining([101, 102]));
    expect(startCalls).toContain(103);
    expect(startCalls).not.toContain(102);
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
      if (path === '/api/sessions?limit=6') return { sessions: [] };
      if (path === '/api/weights?limit=6') return { weights: [] };
      if (path === '/api/bands') return { bands: [] };
      throw new Error(`Unhandled path: ${path}`);
    });

    const user = userEvent.setup();
    renderAppAt('/log');

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
      if (path === '/api/sessions?limit=6') return { sessions: [] };
      if (path === '/api/weights?limit=6') return { weights: [] };
      if (path === '/api/bands') return { bands: [] };
      throw new Error(`Unhandled path: ${path}`);
    });

    const user = userEvent.setup();
    renderAppAt('/log');

    const previewToggle = await screen.findByRole('button', { name: /Open workout exercises/i });
    const progress = screen.getByRole('progressbar', { name: 'Workout exercise progress' });
    expect(progress).toHaveAttribute('aria-valuenow', '1');
    expect(progress).toHaveAttribute('aria-valuemax', '2');
    expect(screen.queryByText('1. Barbell Back Squat')).not.toBeInTheDocument();

    await user.click(previewToggle);

    expect(screen.getByText('1. Barbell Back Squat')).toBeInTheDocument();
    expect(screen.getByText('2. Barbell Romanian Deadlift')).toBeInTheDocument();
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
      if (path === '/api/sessions?limit=6') return { sessions: [] };
      if (path === '/api/weights?limit=6') return { weights: [] };
      if (path === '/api/bands') return { bands: [] };
      throw new Error(`Unhandled path: ${path} (${method})`);
    });

    renderAppAt('/log');

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
      if (path === '/api/sessions?limit=6') return { sessions: [] };
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
    renderAppAt('/log');

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
      if (path === '/api/sessions?limit=6') {
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
    renderAppAt('/log');

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

  it('shows completion stats in session detail modal', async () => {
    const startedAt = '2026-01-15T10:00:00.000Z';
    const endedAt = '2026-01-15T10:30:00.000Z';
    const sessionDetail = {
      id: 710,
      routineId: 91,
      routineName: 'Upper Body',
      name: 'Upper Body',
      startedAt,
      endedAt,
      durationSeconds: 1800,
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
            { id: 2, setIndex: 2, reps: 8, weight: 60, bandLabel: null, startedAt: endedAt, completedAt: endedAt, createdAt: endedAt },
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
      if (path === '/api/sessions?limit=6') {
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
              totalSets: 2,
              totalReps: 16,
              totalVolume: 960,
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
    renderAppAt('/log');

    await user.click(await screen.findByRole('button', { name: /Upper Body/i }));

    const detailTitle = await screen.findByText('Workout details');
    expect(detailTitle).toBeInTheDocument();
    const detailModal = detailTitle.closest('.modal-panel');
    expect(detailModal).toBeTruthy();
    const detailScope = within(detailModal);

    expect(detailScope.getByText(/Workout time/i)).toBeInTheDocument();
    expect(detailScope.getByText(/Exercises/i)).toBeInTheDocument();
    expect(detailScope.getByText(/Sets/i)).toBeInTheDocument();
    expect(detailScope.getByText(/Total reps/i)).toBeInTheDocument();
    expect(detailScope.getByText(/Volume/i)).toBeInTheDocument();
    expect(detailScope.getByText('1 / 2')).toBeInTheDocument();
    expect(detailScope.getByText('960 kg')).toBeInTheDocument();

    await user.click(detailScope.getByRole('button', { name: /Show 0 sets for Cable Row/i }));
    expect(detailScope.getByText('No sets finished in this workout.')).toBeInTheDocument();
  });

  it('prompts for bodyweight logging when no entry exists', async () => {
    apiFetch.mockImplementation(async (path, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
      if (path === '/api/routines') return { routines: [] };
      if (path === '/api/exercises') return { exercises: [] };
      if (path === '/api/sessions/active') return { session: null };
      if (path === '/api/sessions?limit=6') return { sessions: [] };
      if (path === '/api/weights?limit=6') return { weights: [] };
      if (path === '/api/bands') return { bands: [] };
      throw new Error(`Unhandled path: ${path} (${method})`);
    });

    renderAppAt('/log');

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
      if (path === '/api/sessions?limit=6') return { sessions: [] };
      if (path === '/api/weights?limit=6') {
        return {
          weights: [{ id: 1, weight: 80.5, measuredAt: recentDate }],
        };
      }
      if (path === '/api/bands') return { bands: [] };
      throw new Error(`Unhandled path: ${path} (${method})`);
    });

    renderAppAt('/log');

    expect(await screen.findByText("Today's workout")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Enter weight')).not.toBeInTheDocument();
    expect(screen.queryByText(/over a week/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Bodyweight reminder/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/80[,.]5 kg/)).not.toBeInTheDocument();
  });

  it('supports routine create, update, and delete', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const exercise = { id: 11, name: 'Bench Press', primaryMuscles: ['chest'] };
    const state = {
      routines: [],
      payloads: [],
    };

    function hydrateRoutine(id, payload) {
      return {
        id,
        name: payload.name,
        notes: payload.notes || null,
        routineType: payload.routineType || 'standard',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        exercises: (payload.exercises || []).map((item, index) => ({
          id: id * 1000 + index,
          exerciseId: item.exerciseId,
          name: exercise.name,
          primaryMuscles: exercise.primaryMuscles,
          equipment: item.equipment,
          position: index,
          targetSets: item.targetSets,
          targetReps: item.targetReps,
          targetRepsRange: item.targetRepsRange || null,
          targetRestSeconds: item.targetRestSeconds ?? 0,
          targetWeight: item.targetWeight,
          targetBandLabel: item.targetBandLabel || null,
          notes: item.notes,
          supersetGroup: item.supersetGroup || null,
        })),
      };
    }

    apiFetch.mockImplementation(async (path, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
      if (path === '/api/routines' && method === 'GET') return { routines: state.routines };
      if (path === '/api/exercises') return { exercises: [exercise] };

      if (path === '/api/routines' && method === 'POST') {
        const payload = JSON.parse(options.body);
        state.payloads.push(payload);
        const routine = hydrateRoutine(201, payload);
        state.routines = [routine, ...state.routines];
        return { routine };
      }

      if (path === '/api/routines/201' && method === 'PUT') {
        const payload = JSON.parse(options.body);
        state.payloads.push(payload);
        const routine = hydrateRoutine(201, payload);
        state.routines = state.routines.map((item) =>
          item.id === 201 ? routine : item
        );
        return { routine };
      }

      if (path === '/api/routines/201' && method === 'DELETE') {
        state.routines = state.routines.filter((item) => item.id !== 201);
        return { ok: true };
      }

      throw new Error(`Unhandled path: ${path}`);
    });

    const user = userEvent.setup();
    renderAppAt('/routines');

    await user.click(await screen.findByRole('button', { name: 'Create' }));
    await user.type(await screen.findByPlaceholderText('Push Day'), 'Push Day');
    await user.click(screen.getByRole('button', { name: '+ Add exercise' }));
    await user.selectOptions(screen.getAllByRole('combobox')[0], '11');
    await user.selectOptions(screen.getAllByRole('combobox')[1], 'equipment:Barbell');
    expect(screen.getAllByRole('combobox')[1]).toHaveValue('equipment:Barbell');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const createdRoutineTitle = await screen.findByText(/^Push Day \(\d+\)$/);
    expect(createdRoutineTitle).toBeInTheDocument();
    expect(state.payloads[0].routineType).toBe('standard');
    const createdRoutineCard = createdRoutineTitle.closest('.card');
    expect(createdRoutineCard).toBeTruthy();
    expect(within(createdRoutineCard).getByText('Standard')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit routine' }));
    const routineNameInput = await screen.findByPlaceholderText('Push Day');
    await user.clear(routineNameInput);
    await user.type(routineNameInput, 'Push Day v2');
    await user.click(screen.getByRole('radio', { name: 'Rehab' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const updatedRoutineTitle = await screen.findByText(/^Push Day v2 \(\d+\)$/);
    expect(updatedRoutineTitle).toBeInTheDocument();
    expect(state.payloads[1].routineType).toBe('rehab');
    const updatedRoutineCard = updatedRoutineTitle.closest('.card');
    expect(updatedRoutineCard).toBeTruthy();
    expect(within(updatedRoutineCard).getByText('Rehab')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete routine' }));
    await waitFor(() => {
      expect(screen.queryByText(/^Push Day v2 \(\d+\)$/)).not.toBeInTheDocument();
    });
  });

  it('supports routine superset pairing and syncs paired target sets', async () => {
    const exercises = [
      { id: 11, name: 'Bench Press', primaryMuscles: ['chest'] },
      { id: 12, name: 'Pendlay Row', primaryMuscles: ['lats'] },
    ];
    const state = {
      routines: [],
      savedPayloads: [],
    };

    const hydrateRoutine = (id, payload) => ({
      id,
      name: payload.name,
      notes: payload.notes || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      exercises: (payload.exercises || []).map((item, index) => ({
        id: id * 1000 + index,
        exerciseId: item.exerciseId,
        name: exercises.find((exercise) => exercise.id === item.exerciseId)?.name || 'Exercise',
        primaryMuscles:
          exercises.find((exercise) => exercise.id === item.exerciseId)?.primaryMuscles || [],
        equipment: item.equipment,
        position: index,
        targetSets: item.targetSets,
        targetReps: item.targetReps,
        targetRepsRange: item.targetRepsRange || null,
        targetRestSeconds: item.targetRestSeconds ?? 0,
        targetWeight: item.targetWeight,
        targetBandLabel: item.targetBandLabel || null,
        notes: item.notes,
        supersetGroup: item.supersetGroup || null,
      })),
    });

    apiFetch.mockImplementation(async (path, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
      if (path === '/api/routines' && method === 'GET') return { routines: state.routines };
      if (path === '/api/exercises') return { exercises };
      if (path === '/api/routines' && method === 'POST') {
        const payload = JSON.parse(options.body);
        state.savedPayloads.push(payload);
        const routine = hydrateRoutine(910, payload);
        state.routines = [routine, ...state.routines];
        return { routine };
      }
      throw new Error(`Unhandled path: ${path}`);
    });

    const user = userEvent.setup();
    renderAppAt('/routines');

    await user.click(await screen.findByRole('button', { name: 'Create' }));
    await user.type(await screen.findByPlaceholderText('Push Day'), 'Upper Pair');
    await user.click(screen.getByRole('button', { name: '+ Add exercise' }));
    await user.click(screen.getByRole('button', { name: '+ Add exercise' }));

    await user.selectOptions(screen.getAllByRole('combobox', { name: 'Exercise' })[0], '11');
    await user.selectOptions(screen.getAllByRole('combobox', { name: 'Exercise' })[1], '12');
    await user.selectOptions(screen.getAllByRole('combobox', { name: 'Equipment' })[0], 'equipment:Barbell');
    await user.selectOptions(screen.getAllByRole('combobox', { name: 'Equipment' })[1], 'equipment:Barbell');

    await user.click(screen.getByRole('button', { name: 'Pair with next' }));
    await user.selectOptions(screen.getAllByRole('combobox', { name: 'Sets' })[0], '3');

    expect(screen.getAllByRole('combobox', { name: 'Sets' })[1]).toHaveValue('3');
    expect(screen.getAllByRole('button', { name: 'Unpair' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Move exercise up' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Move exercise down' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Remove exercise' })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Save' }));

    const savedPayload = state.savedPayloads[0];
    expect(savedPayload.exercises[0].supersetGroup).toBe('g1');
    expect(savedPayload.exercises[1].supersetGroup).toBe('g1');
    expect(savedPayload.exercises[0].targetSets).toBe(3);
    expect(savedPayload.exercises[1].targetSets).toBe(3);
  });

  it('hides pair with next when the next block is already a superset', async () => {
    const exercises = [
      { id: 11, name: 'Bench Press', primaryMuscles: ['chest'] },
      { id: 12, name: 'Pendlay Row', primaryMuscles: ['lats'] },
      { id: 13, name: 'Split Squat', primaryMuscles: ['quadriceps'] },
    ];

    apiFetch.mockImplementation(async (path, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
      if (path === '/api/routines' && method === 'GET') return { routines: [] };
      if (path === '/api/exercises') return { exercises };
      throw new Error(`Unhandled path: ${path}`);
    });

    const user = userEvent.setup();
    renderAppAt('/routines');

    await user.click(await screen.findByRole('button', { name: 'Create' }));
    await user.type(await screen.findByPlaceholderText('Push Day'), 'Block Pairing');
    await user.click(screen.getByRole('button', { name: '+ Add exercise' }));
    await user.click(screen.getByRole('button', { name: '+ Add exercise' }));
    await user.click(screen.getByRole('button', { name: '+ Add exercise' }));

    await user.selectOptions(screen.getAllByRole('combobox', { name: 'Exercise' })[0], '11');
    await user.selectOptions(screen.getAllByRole('combobox', { name: 'Exercise' })[1], '12');
    await user.selectOptions(screen.getAllByRole('combobox', { name: 'Exercise' })[2], '13');
    await user.selectOptions(screen.getAllByRole('combobox', { name: 'Equipment' })[0], 'equipment:Barbell');
    await user.selectOptions(screen.getAllByRole('combobox', { name: 'Equipment' })[1], 'equipment:Barbell');
    await user.selectOptions(screen.getAllByRole('combobox', { name: 'Equipment' })[2], 'equipment:Dumbbell');

    const pairButtons = screen.getAllByRole('button', { name: 'Pair with next' });
    await user.click(pairButtons[1]);

    expect(screen.queryByRole('button', { name: 'Pair with next' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unpair' })).toBeInTheDocument();
  });

  it('reorders supersets as a block in routine list controls', async () => {
    const routine = {
      id: 300,
      name: 'Block Move',
      notes: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      exercises: [
        { id: 1, exerciseId: 11, name: 'Bench Press', primaryMuscles: ['chest'], equipment: 'Barbell', position: 0, targetSets: 2, targetReps: 8, targetRepsRange: null, targetRestSeconds: 60, targetWeight: 80, targetBandLabel: null, notes: null, supersetGroup: 'g1' },
        { id: 2, exerciseId: 12, name: 'Pendlay Row', primaryMuscles: ['lats'], equipment: 'Barbell', position: 1, targetSets: 2, targetReps: 8, targetRepsRange: null, targetRestSeconds: 60, targetWeight: 60, targetBandLabel: null, notes: null, supersetGroup: 'g1' },
        { id: 3, exerciseId: 13, name: 'Split Squat', primaryMuscles: ['quadriceps'], equipment: 'Dumbbell', position: 2, targetSets: 2, targetReps: 10, targetRepsRange: null, targetRestSeconds: 90, targetWeight: 20, targetBandLabel: null, notes: null, supersetGroup: null },
      ],
    };
    let lastReorderPayload = null;

    apiFetch.mockImplementation(async (path, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
      if (path === '/api/routines' && method === 'GET') return { routines: [routine] };
      if (path === '/api/exercises') return { exercises: [] };
      if (path === '/api/routines/300/reorder' && method === 'PUT') {
        const payload = JSON.parse(options.body);
        lastReorderPayload = payload;
        return { routine };
      }
      throw new Error(`Unhandled path: ${path} (${method})`);
    });

    const user = userEvent.setup();
    renderAppAt('/routines');

    await user.click(await screen.findByRole('button', { name: 'Show exercises (3)' }));

    const upButtons = await screen.findAllByRole('button', { name: '↑' });
    const downButtons = screen.getAllByRole('button', { name: '↓' });
    expect(upButtons[0]).toBeDisabled();
    expect(upButtons[1]).toBeDisabled();

    await user.click(downButtons[0]);

    expect(lastReorderPayload.exerciseOrder).toEqual([3, 1, 2]);
  });

  it('hides target weight when routine equipment is bodyweight', async () => {
    const exercise = { id: 11, name: 'Push Up', primaryMuscles: ['chest'] };

    apiFetch.mockImplementation(async (path, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
      if (path === '/api/routines' && method === 'GET') return { routines: [] };
      if (path === '/api/exercises') return { exercises: [exercise] };
      throw new Error(`Unhandled path: ${path}`);
    });

    const user = userEvent.setup();
    renderAppAt('/routines');

    await user.click(await screen.findByRole('button', { name: 'Create' }));
    await user.click(await screen.findByRole('button', { name: '+ Add exercise' }));
    const equipmentSelect = screen.getAllByRole('combobox')[1];
    expect(screen.getAllByRole('spinbutton')).toHaveLength(1);

    await user.selectOptions(equipmentSelect, 'equipment:Bodyweight');

    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
  });

  it('hides target weight when routine equipment is ab wheel', async () => {
    const exercise = { id: 11, name: 'Ab Wheel Rollout', primaryMuscles: ['abdominals'] };

    apiFetch.mockImplementation(async (path, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
      if (path === '/api/routines' && method === 'GET') return { routines: [] };
      if (path === '/api/exercises') return { exercises: [exercise] };
      throw new Error(`Unhandled path: ${path}`);
    });

    const user = userEvent.setup();
    renderAppAt('/routines');

    await user.click(await screen.findByRole('button', { name: 'Create' }));
    await user.click(await screen.findByRole('button', { name: '+ Add exercise' }));
    const equipmentSelect = screen.getAllByRole('combobox')[1];
    expect(screen.getAllByRole('spinbutton')).toHaveLength(1);

    await user.selectOptions(equipmentSelect, 'equipment:Ab wheel');

    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
  });

  it('shows fixed band options and hides weight when routine equipment is band', async () => {
    const exercise = { id: 11, name: 'Row', primaryMuscles: ['lats'] };

    apiFetch.mockImplementation(async (path, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
      if (path === '/api/routines' && method === 'GET') return { routines: [] };
      if (path === '/api/exercises') return { exercises: [exercise] };
      throw new Error(`Unhandled path: ${path}`);
    });

    const user = userEvent.setup();
    renderAppAt('/routines');

    await user.click(await screen.findByRole('button', { name: 'Create' }));
    await user.click(await screen.findByRole('button', { name: '+ Add exercise' }));
    const equipmentSelect = screen.getAllByRole('combobox')[1];
    await user.selectOptions(equipmentSelect, 'band:Red');

    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
    expect(screen.getByRole('option', { name: 'Band · Red' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Band · Orange' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Band · 10 lb' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Band · 20 lb' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Band · 30 lb' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Band · 40 lb' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Band · 50 lb' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Band · 60 lb' })).toBeInTheDocument();
  });

  it('supports routine rest time minutes and seconds', async () => {
    const exercises = [
      { id: 11, name: 'Bench Press', primaryMuscles: ['chest'] },
      { id: 12, name: 'Incline Bench Press', primaryMuscles: ['chest'] },
    ];
    const state = { routines: [], savedPayload: null };
    const hydrateRoutine = (id, payload) => ({
      id,
      name: payload.name,
      notes: payload.notes || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      exercises: (payload.exercises || []).map((item, index) => ({
        id: id * 1000 + index,
        exerciseId: item.exerciseId,
        name: exercises.find((exercise) => exercise.id === item.exerciseId)?.name || 'Exercise',
        primaryMuscles:
          exercises.find((exercise) => exercise.id === item.exerciseId)?.primaryMuscles || [],
        equipment: item.equipment,
        position: index,
        targetSets: item.targetSets,
        targetReps: item.targetReps,
        targetRepsRange: item.targetRepsRange || null,
        targetRestSeconds: item.targetRestSeconds ?? 0,
        targetWeight: item.targetWeight,
        targetBandLabel: item.targetBandLabel || null,
        notes: item.notes,
        supersetGroup: item.supersetGroup || null,
      })),
    });

    apiFetch.mockImplementation(async (path, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
      if (path === '/api/routines' && method === 'GET') return { routines: state.routines };
      if (path === '/api/exercises') return { exercises };
      if (path === '/api/routines' && method === 'POST') {
        const payload = JSON.parse(options.body);
        state.savedPayload = payload;
        const routine = hydrateRoutine(301, payload);
        state.routines = [routine, ...state.routines];
        return { routine };
      }
      throw new Error(`Unhandled path: ${path}`);
    });

    const user = userEvent.setup();
    renderAppAt('/routines');

    await user.click(await screen.findByRole('button', { name: 'Create' }));
    await user.type(await screen.findByPlaceholderText('Push Day'), 'Push Day');
    await user.click(screen.getByRole('button', { name: '+ Add exercise' }));
    await user.selectOptions(screen.getAllByRole('combobox', { name: 'Exercise' })[0], '11');
    await user.selectOptions(screen.getAllByRole('combobox', { name: 'Equipment' })[0], 'equipment:Barbell');
    await user.selectOptions(screen.getAllByRole('combobox', { name: 'Rest' })[0], '120');
    await user.click(screen.getByRole('button', { name: '+ Add exercise' }));

    expect(screen.getAllByRole('combobox', { name: 'Rest' })[1]).toHaveValue('120');

    await user.selectOptions(screen.getAllByRole('combobox', { name: 'Exercise' })[1], '12');
    await user.selectOptions(screen.getAllByRole('combobox', { name: 'Equipment' })[1], 'equipment:Dumbbell');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(state.savedPayload?.exercises?.[0]?.targetRestSeconds).toBe(120);
    expect(state.savedPayload?.exercises?.[1]?.targetRestSeconds).toBe(120);
    await user.click(await screen.findByRole('button', { name: 'Show exercises (2)' }));
    expect((await screen.findAllByText(/Rest 02:00/i)).length).toBeGreaterThanOrEqual(2);
  });

  it('defaults added exercise rest in routine edit to previous exercise rest', async () => {
    const exercises = [
      { id: 11, name: 'Bench Press', primaryMuscles: ['chest'] },
      { id: 12, name: 'Pendlay Row', primaryMuscles: ['lats'] },
    ];
    const hydrateRoutine = (id, payload) => ({
      id,
      name: payload.name,
      notes: payload.notes || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      exercises: (payload.exercises || []).map((item, index) => ({
        id: id * 1000 + index,
        exerciseId: item.exerciseId,
        name: exercises.find((exercise) => exercise.id === item.exerciseId)?.name || 'Exercise',
        primaryMuscles:
          exercises.find((exercise) => exercise.id === item.exerciseId)?.primaryMuscles || [],
        equipment: item.equipment,
        position: index,
        targetSets: item.targetSets,
        targetReps: item.targetReps,
        targetRepsRange: item.targetRepsRange || null,
        targetRestSeconds: item.targetRestSeconds ?? 0,
        targetWeight: item.targetWeight,
        targetBandLabel: item.targetBandLabel || null,
        notes: item.notes,
        supersetGroup: item.supersetGroup || null,
      })),
    });
    const state = {
      savedPayload: null,
      routines: [
        hydrateRoutine(501, {
          id: 501,
          name: 'Upper A',
          notes: null,
          exercises: [
            {
              exerciseId: 11,
              equipment: 'Barbell',
              position: 0,
              targetSets: 2,
              targetReps: 8,
              targetRepsRange: null,
              targetRestSeconds: 90,
              targetWeight: 60,
              targetBandLabel: null,
              notes: null,
              supersetGroup: null,
            },
          ],
        }),
      ],
    };

    apiFetch.mockImplementation(async (path, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
      if (path === '/api/routines' && method === 'GET') return { routines: state.routines };
      if (path === '/api/exercises') return { exercises };
      if (path === '/api/routines/501' && method === 'PUT') {
        const payload = JSON.parse(options.body);
        state.savedPayload = payload;
        const routine = hydrateRoutine(501, payload);
        state.routines = state.routines.map((item) => (item.id === 501 ? routine : item));
        return { routine };
      }
      throw new Error(`Unhandled path: ${path}`);
    });

    const user = userEvent.setup();
    renderAppAt('/routines');

    await user.click(await screen.findByRole('button', { name: 'Edit routine' }));
    await user.click(screen.getByRole('button', { name: '+ Add exercise' }));

    expect(screen.getAllByRole('combobox', { name: 'Rest' })[1]).toHaveValue('90');

    await user.selectOptions(screen.getAllByRole('combobox', { name: 'Exercise' })[1], '12');
    await user.selectOptions(screen.getAllByRole('combobox', { name: 'Equipment' })[1], 'equipment:Barbell');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(state.savedPayload?.exercises?.[0]?.targetRestSeconds).toBe(90);
    expect(state.savedPayload?.exercises?.[1]?.targetRestSeconds).toBe(90);
  });

  it('supports exercise create and update', async () => {
    const state = {
      exercises: [],
      nextId: 1,
    };

    apiFetch.mockImplementation(async (path, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
      if (path === '/api/exercises' && method === 'GET') return { exercises: state.exercises };

      if (path === '/api/exercises' && method === 'POST') {
        const payload = JSON.parse(options.body);
        const exercise = {
          id: state.nextId++,
          name: payload.name,
          primaryMuscles: payload.primaryMuscles,
          notes: payload.notes || null,
          archivedAt: null,
          mergedIntoId: null,
          mergedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastSet: null,
        };
        state.exercises = [...state.exercises, exercise];
        return { exercise };
      }

      if (path === '/api/exercises/1/impact' && method === 'GET') {
        return {
          exercise: { id: 1, name: 'Hammer Curl' },
          impact: {
            routineReferences: 0,
            routineUsers: 0,
            setReferences: 0,
            setUsers: 0,
          },
        };
      }

      if (path === '/api/exercises/1' && method === 'PUT') {
        const payload = JSON.parse(options.body);
        state.exercises = state.exercises.map((item) =>
          item.id === 1 ? { ...item, ...payload } : item
        );
        return { ok: true };
      }

      throw new Error(`Unhandled path: ${path}`);
    });

    const user = userEvent.setup();
    renderAppAt('/exercises');

    const searchInput = await screen.findByPlaceholderText('Search by name or muscle group');
    await user.type(searchInput, 'Hammer Curl');
    await user.click(screen.getByRole('button', { name: 'Add "Hammer Curl"' }));

    await user.selectOptions(screen.getAllByRole('combobox')[1], 'lats');
    await user.click(screen.getByRole('button', { name: 'Save exercise' }));

    expect(await screen.findByText('Hammer Curl')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const notesInput = screen.container?.querySelector?.('textarea') || document.querySelector('textarea');
    expect(notesInput).toBeTruthy();
    await user.type(notesInput, 'Neutral grip');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/Neutral grip/)).toBeInTheDocument();
  });

  it('persists motion preference and keeps route navigation functional', async () => {
    window.localStorage.removeItem('trainbook.motionPreference');

    apiFetch.mockImplementation(async (path) => {
      if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
      if (path === '/api/routines') return { routines: [] };
      if (path === '/api/sessions/active') return { session: null };
      if (path === '/api/sessions?limit=6') return { sessions: [] };
      if (path === '/api/weights?limit=6') return { weights: [] };
      throw new Error(`Unhandled path: ${path}`);
    });

    const user = userEvent.setup();
    renderAppAt('/settings');

    const preferenceSelect = await screen.findByLabelText('Motion preference');
    expect(preferenceSelect).toHaveValue('system');
    await user.selectOptions(preferenceSelect, 'reduced');
    expect(window.localStorage.getItem('trainbook.motionPreference')).toBe('reduced');

    await user.click(screen.getByRole('link', { name: 'Workout' }));
    expect(await screen.findByText("Today's workout")).toBeInTheDocument();
  });

  it('supports settings export and import', async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = vi.fn();
    URL.createObjectURL = vi.fn(() => 'blob:trainbook-export');
    URL.revokeObjectURL = vi.fn();

    apiFetch.mockImplementation(async (path, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
      if (path === '/api/export') {
        return {
          version: 3,
          exercises: [],
          routines: [],
          sessions: [],
          weights: [],
        };
      }
      if (path === '/api/import/validate' && method === 'POST') {
        return {
          valid: true,
          errors: [],
          warnings: [],
          summary: {
            toCreate: { exercises: 1, routines: 1, sessions: 1, weights: 1 },
            toReuse: { exercises: 0 },
            skipped: { exercises: 0, routines: 0, sessions: 0, weights: 0 },
          },
        };
      }
      if (path === '/api/import' && method === 'POST') {
        return {
          ok: true,
          importedCount: { exercises: 1, routines: 1, sessions: 1, weights: 1 },
        };
      }
      throw new Error(`Unhandled path: ${path}`);
    });

    const user = userEvent.setup();
    const view = renderAppAt('/settings');

    await user.click(await screen.findByRole('button', { name: 'Export JSON' }));
    expect(URL.createObjectURL).toHaveBeenCalled();

    const fileInput = view.container.querySelector('input[type="file"]');
    expect(fileInput).toBeTruthy();
    const file = new File(
      [JSON.stringify({ version: 3, exercises: [] })],
      'backup.json',
      { type: 'application/json' }
    );
    file.text = async () => JSON.stringify({ version: 3, exercises: [] });
    await user.upload(fileInput, file);
    expect(await screen.findByText(/Validation summary for backup\.json/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm import' }));

    expect(
      await screen.findByText(
        /Imported\s+1\s+exercises,\s*1\s+routines,\s*1\s+workouts,\s*1\s+bodyweight entries\./
      )
    ).toBeInTheDocument();

    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    HTMLAnchorElement.prototype.click = originalAnchorClick;
  });
});
