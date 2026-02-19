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
    expect(await screen.findByText('Exercise (1/1)')).toBeInTheDocument();
    await user.type(await screen.findByPlaceholderText('Push Day'), 'Push Day');
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
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Push Day')).not.toBeInTheDocument();
    });
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
    const routineCard = screen.getByRole('button', { name: 'Hide exercises (3)' }).closest('.card');
    expect(routineCard).toBeTruthy();
    const routineScope = within(routineCard);
    expect(routineScope.getAllByText('Superset')).toHaveLength(1);
    expect(routineCard.querySelectorAll('.workout-preview-superset-block')).toHaveLength(1);
    expect(routineCard.querySelectorAll('.workout-preview-superset-block .routine-workout-preview-row.workout-preview-row-grouped')).toHaveLength(2);

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
      if (path === '/api/sessions?limit=15') return { sessions: [] };
      if (path === '/api/weights?limit=6') return { weights: [] };
      throw new Error(`Unhandled path: ${path}`);
    });

    const user = userEvent.setup();
    renderAppAt('/settings');

    expect(await screen.findByText('Version')).toBeInTheDocument();
    expect(await screen.findByText('Released')).toBeInTheDocument();
    expect(await screen.findByText('Unknown')).toBeInTheDocument();

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


  it('supports header account menu actions for settings and logout', async () => {
    apiFetch.mockImplementation(async (path, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
      if (path === '/api/routines') return { routines: [] };
      if (path === '/api/exercises') return { exercises: [] };
      if (path === '/api/sessions/active') return { session: null };
      if (path === '/api/sessions?limit=15') return { sessions: [] };
      if (path === '/api/weights?limit=6') return { weights: [] };
      if (path === '/api/bands') return { bands: [] };
      if (path === '/api/auth/logout' && method === 'POST') return { ok: true };
      throw new Error(`Unhandled path: ${path}`);
    });

    const user = userEvent.setup();
    renderAppAt('/workout');

    const accountButton = await screen.findByRole('button', { name: 'coach' });
    await user.click(accountButton);
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Settings' }));
    expect(await screen.findByText('Account controls, backups, and environment.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'coach' }));
    const menuLogoutButton = screen
      .getAllByRole('button', { name: 'Log out' })
      .find((button) => button.className.includes('menu-item'));
    expect(menuLogoutButton).toBeTruthy();
    await user.click(menuLogoutButton);
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
  });

});
