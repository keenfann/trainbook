// @vitest-environment jsdom
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App.jsx';
import { apiFetch } from '../src/api.js';

vi.mock('../src/api.js', () => ({
  apiFetch: vi.fn(),
}));

function renderAppAt(pathname) {
  window.history.pushState({}, '', pathname);
  return render(
    <BrowserRouter>
      <App />
    </BrowserRouter>
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
      throw new Error(`Unhandled path: ${path}`);
    });

    const user = userEvent.setup();
    renderAppAt('/login');

    await user.type(await screen.findByPlaceholderText('e.g. coach'), 'coach');
    await user.type(screen.getByPlaceholderText('Minimum 6 characters'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText("Today's session")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('supports active session start and set logging', async () => {
    const now = new Date().toISOString();
    const state = {
      activeSession: null,
      nextSetId: 1,
      exercises: [{ id: 101, name: 'Back Squat', muscleGroup: 'Legs', lastSet: null }],
    };

    apiFetch.mockImplementation(async (path, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
      if (path === '/api/routines') return { routines: [] };
      if (path === '/api/exercises') return { exercises: state.exercises };
      if (path === '/api/sessions/active') return { session: state.activeSession };
      if (path === '/api/sessions?limit=6') return { sessions: [] };
      if (path === '/api/weights?limit=6') return { weights: [] };

      if (path === '/api/sessions' && method === 'POST') {
        const payload = JSON.parse(options.body);
        state.activeSession = {
          id: 501,
          routineId: null,
          routineName: null,
          name: payload.name,
          startedAt: now,
          endedAt: null,
          notes: null,
          exercises: [],
        };
        return { session: state.activeSession };
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
          rpe: null,
          createdAt: now,
        };
        return { set };
      }

      throw new Error(`Unhandled path: ${path}`);
    });

    const user = userEvent.setup();
    renderAppAt('/log');

    const sessionNameInput = await screen.findByPlaceholderText('Upper body, Pull day, etc.');
    await user.type(sessionNameInput, 'Leg Day');
    await user.click(screen.getByRole('button', { name: 'Start now' }));

    expect(await screen.findByText('Back Squat')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('Reps'), '5');
    await user.type(screen.getByPlaceholderText('Weight'), '100');
    await user.click(screen.getByRole('button', { name: '+ Add' }));

    expect(await screen.findByText('Set 1')).toBeInTheDocument();
  });

  it('supports routine create, update, and delete', async () => {
    const exercise = { id: 11, name: 'Bench Press', muscleGroup: 'Push' };
    const state = {
      routines: [],
    };

    function hydrateRoutine(id, payload) {
      return {
        id,
        name: payload.name,
        notes: payload.notes || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        exercises: (payload.exercises || []).map((item, index) => ({
          id: id * 1000 + index,
          exerciseId: item.exerciseId,
          name: exercise.name,
          muscleGroup: exercise.muscleGroup,
          equipment: item.equipment,
          position: index,
          targetSets: item.targetSets,
          targetReps: item.targetReps,
          targetWeight: item.targetWeight,
          notes: item.notes,
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
        const routine = hydrateRoutine(201, payload);
        state.routines = [routine, ...state.routines];
        return { routine };
      }

      if (path === '/api/routines/201' && method === 'PUT') {
        const payload = JSON.parse(options.body);
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

    await user.type(await screen.findByPlaceholderText('Push Day'), 'Push Day');
    await user.click(screen.getByRole('button', { name: '+ Add exercise' }));
    await user.selectOptions(screen.getAllByRole('combobox')[0], '11');
    await user.selectOptions(screen.getAllByRole('combobox')[1], 'Barbell');
    expect(screen.getAllByRole('combobox')[1]).toHaveValue('Barbell');
    await user.click(screen.getByRole('button', { name: 'Save routine' }));

    expect(await screen.findByText('Push Day')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const routineNameInputs = screen.getAllByPlaceholderText('Push Day');
    await user.clear(routineNameInputs[1]);
    await user.type(routineNameInputs[1], 'Push Day v2');
    await user.click(screen.getByRole('button', { name: 'Update routine' }));

    expect(await screen.findByText('Push Day v2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(screen.queryByText('Push Day v2')).not.toBeInTheDocument();
    });
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
          muscleGroup: payload.muscleGroup,
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

    await user.selectOptions(screen.getAllByRole('combobox')[1], 'Pull');
    await user.click(screen.getByRole('button', { name: 'Save exercise' }));

    expect(await screen.findByText('Hammer Curl')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const notesInput = screen.container?.querySelector?.('textarea') || document.querySelector('textarea');
    expect(notesInput).toBeTruthy();
    await user.type(notesInput, 'Neutral grip');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/Neutral grip/)).toBeInTheDocument();
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

    expect(
      await screen.findByText(/Imported\s+1\s+exercises,\s*1\s+routines,\s*1\s+sessions\./)
    ).toBeInTheDocument();

    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    HTMLAnchorElement.prototype.click = originalAnchorClick;
  });
});
