// @vitest-environment jsdom
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ExercisesPage from '../src/pages/ExercisesPage.jsx';
import { apiFetch } from '../src/api.js';
import { MotionPreferenceProvider } from '../src/motion-preferences.jsx';

vi.mock('../src/api.js', () => ({
  apiFetch: vi.fn(),
}));

function renderExercisesPage() {
  return render(
    <MotionPreferenceProvider>
      <ExercisesPage />
    </MotionPreferenceProvider>
  );
}

function createApiFixture() {
  const exercises = [
    {
      id: 1,
      name: 'Bench Press',
      primaryMuscles: ['chest'],
      secondaryMuscles: ['triceps'],
      notes: 'Control eccentric.',
      images: ['bench-press.png'],
      instructions: ['Set shoulders', 'Press'],
      archivedAt: null,
      mergedIntoId: null,
      mergedIntoName: null,
      mergedAt: null,
      lastSet: { weight: 100, reps: 5 },
    },
    {
      id: 2,
      name: 'Back Squat',
      primaryMuscles: ['quadriceps'],
      secondaryMuscles: ['glutes'],
      notes: '',
      images: [],
      instructions: ['Brace', 'Squat'],
      archivedAt: null,
      mergedIntoId: null,
      mergedIntoName: null,
      mergedAt: null,
      lastSet: null,
    },
    {
      id: 9,
      name: 'Old Row',
      primaryMuscles: ['lats'],
      secondaryMuscles: ['middle back'],
      notes: '',
      images: [],
      instructions: ['Pull'],
      archivedAt: '2026-02-01T10:00:00.000Z',
      mergedIntoId: null,
      mergedIntoName: null,
      mergedAt: null,
      lastSet: null,
    },
  ];

  const impactById = {
    1: {
      routineReferences: 2,
      routineUsers: 1,
      setReferences: 15,
      setUsers: 1,
    },
    2: {
      routineReferences: 1,
      routineUsers: 1,
      setReferences: 10,
      setUsers: 1,
    },
  };

  const libraryItems = [
    {
      forkId: 'ext-bench-press',
      name: 'External Bench Press',
      primaryMuscles: ['chest'],
      imageUrls: ['https://example.com/ext-bench.png'],
      alreadyAdded: false,
    },
  ];

  let nextId = 100;

  apiFetch.mockImplementation(async (path, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    const url = new URL(path, 'http://localhost');
    const pathname = url.pathname;
    const params = url.searchParams;

    if (method === 'GET' && pathname === '/api/exercises') {
      const mode = params.get('mode') || 'active';
      let filtered = exercises;
      if (mode === 'active') {
        filtered = exercises.filter((exercise) => !exercise.archivedAt);
      } else if (mode === 'archived') {
        filtered = exercises.filter((exercise) => Boolean(exercise.archivedAt));
      }
      return { exercises: filtered.map((exercise) => ({ ...exercise })) };
    }

    if (method === 'POST' && pathname === '/api/exercises') {
      const payload = JSON.parse(options.body || '{}');
      const exercise = {
        id: nextId,
        name: payload.name,
        primaryMuscles: payload.primaryMuscles || [],
        secondaryMuscles: payload.secondaryMuscles || [],
        notes: payload.notes || '',
        images: payload.images || [],
        instructions: payload.instructions || [],
        archivedAt: null,
        mergedIntoId: null,
        mergedIntoName: null,
        mergedAt: null,
        lastSet: null,
      };
      nextId += 1;
      exercises.push(exercise);
      return { exercise: { ...exercise } };
    }

    if (method === 'GET' && pathname.match(/^\/api\/exercises\/\d+\/impact$/)) {
      const exerciseId = Number(pathname.split('/')[3]);
      return {
        impact: impactById[exerciseId] || {
          routineReferences: 0,
          routineUsers: 0,
          setReferences: 0,
          setUsers: 0,
        },
      };
    }

    if (method === 'PUT' && pathname.match(/^\/api\/exercises\/\d+$/)) {
      const exerciseId = Number(pathname.split('/')[3]);
      const payload = JSON.parse(options.body || '{}');
      const index = exercises.findIndex((item) => item.id === exerciseId);
      if (index !== -1) {
        exercises[index] = {
          ...exercises[index],
          ...payload,
          primaryMuscles: payload.primaryMuscles || [],
        };
      }
      return { ok: true };
    }

    if (method === 'DELETE' && pathname.match(/^\/api\/exercises\/\d+$/)) {
      const exerciseId = Number(pathname.split('/')[3]);
      const exercise = exercises.find((item) => item.id === exerciseId);
      if (exercise) {
        exercise.archivedAt = '2026-02-19T10:00:00.000Z';
      }
      return { ok: true };
    }

    if (method === 'POST' && pathname.match(/^\/api\/exercises\/\d+\/unarchive$/)) {
      const exerciseId = Number(pathname.split('/')[3]);
      const exercise = exercises.find((item) => item.id === exerciseId);
      if (exercise) {
        exercise.archivedAt = null;
      }
      return { ok: true };
    }

    if (method === 'POST' && pathname === '/api/exercises/merge') {
      const { sourceId, targetId } = JSON.parse(options.body || '{}');
      const source = exercises.find((item) => item.id === sourceId);
      const target = exercises.find((item) => item.id === targetId);
      if (source && target) {
        source.archivedAt = '2026-02-19T11:00:00.000Z';
        source.mergedIntoId = targetId;
        source.mergedIntoName = target.name;
        source.mergedAt = '2026-02-19T11:00:00.000Z';
      }
      return { ok: true };
    }

    if (method === 'GET' && pathname === '/api/exercise-library') {
      const query = (params.get('q') || '').toLowerCase();
      return {
        results: libraryItems
          .filter((item) => item.name.toLowerCase().includes(query))
          .map((item) => ({ ...item })),
      };
    }

    if (method === 'POST' && pathname.match(/^\/api\/exercise-library\/[^/]+\/add$/)) {
      const forkId = decodeURIComponent(pathname.split('/')[3]);
      const item = libraryItems.find((candidate) => candidate.forkId === forkId);
      if (item) {
        item.alreadyAdded = true;
      }
      const existing = exercises.find((exercise) => exercise.name === 'External Bench Press');
      const exercise =
        existing ||
        {
          id: nextId++,
          name: 'External Bench Press',
          primaryMuscles: ['chest'],
          secondaryMuscles: [],
          notes: '',
          images: [],
          instructions: [],
          archivedAt: null,
          mergedIntoId: null,
          mergedIntoName: null,
          mergedAt: null,
          lastSet: null,
        };
      if (!existing) {
        exercises.push(exercise);
      }
      return { exercise: { ...exercise } };
    }

    throw new Error(`Unhandled ${method} ${path}`);
  });

  return {
    exercises,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ExercisesPage', () => {
  it('supports quick create flow and creates a new exercise', async () => {
    const user = userEvent.setup();
    createApiFixture();

    renderExercisesPage();

    expect(await screen.findByText('Bench Press')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Search by name or muscle group'), 'Lateral Raise');
    await user.click(screen.getByRole('button', { name: 'Add "Lateral Raise"' }));

    const newExerciseHeading = await screen.findByText('New exercise');
    const newExerciseCard = newExerciseHeading.closest('.card');
    expect(newExerciseCard).toBeTruthy();

    await user.selectOptions(
      within(newExerciseCard).getByRole('combobox'),
      'shoulders'
    );
    await user.click(screen.getByRole('button', { name: 'Save exercise' }));

    expect(await screen.findByText('Lateral Raise')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith('/api/exercises', expect.objectContaining({ method: 'POST' }));
  });

  it('supports external library search and add', async () => {
    const user = userEvent.setup();
    createApiFixture();

    renderExercisesPage();

    await screen.findByText('Bench Press');
    await user.click(screen.getByRole('button', { name: 'Add from external library' }));

    const queryInput = screen.getByPlaceholderText('e.g. bench press');

    await user.type(queryInput, 'nothing-here');
    expect(await screen.findByText('No external library matches.')).toBeInTheDocument();

    await user.clear(queryInput);
    await user.type(queryInput, 'external bench');

    expect(await screen.findByText('External Bench Press')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Added' })).toBeDisabled();
    });
    expect(
      apiFetch
    ).toHaveBeenCalledWith('/api/exercise-library/ext-bench-press/add', { method: 'POST' });
    expect(screen.getAllByText('External Bench Press').length).toBeGreaterThan(0);
  });

  it('supports edit, merge, archive, and unarchive flows', async () => {
    const user = userEvent.setup();
    createApiFixture();

    const { container } = renderExercisesPage();

    await screen.findByText('Bench Press');

    await user.click(screen.getAllByLabelText('Edit')[0]);

    const nameInput = await screen.findByDisplayValue('Bench Press');
    await user.clear(nameInput);
    await user.type(nameInput, 'Back Squat');

    expect(await screen.findByText('Another exercise already uses this exact name. Choose a unique name.'))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await user.clear(nameInput);
    await user.type(nameInput, 'Bench Prime');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Bench Prime')).toBeInTheDocument();

    await user.click(screen.getAllByLabelText('Edit')[0]);
    await user.click(screen.getByText('Merge exercise'));

    const mergeButton = screen.getByRole('button', { name: 'Merge' });
    const mergeSelect = mergeButton.closest('.inline')?.querySelector('select');
    expect(mergeSelect).toBeTruthy();

    await user.selectOptions(mergeSelect, '2');
    await user.click(mergeButton);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/api/exercises/merge', expect.objectContaining({ method: 'POST' }));
    });

    await waitFor(() => {
      expect(screen.queryByText('Bench Prime')).not.toBeInTheDocument();
    });

    await user.click(screen.getAllByLabelText('Edit')[0]);
    await user.click(screen.getByText('Archive exercise'));
    await user.click(screen.getByRole('button', { name: 'Archive' }));

    await waitFor(() => {
      expect(screen.queryByText('Edit exercise')).not.toBeInTheDocument();
    });

    const filterSelect = container.querySelector('.card select');
    expect(filterSelect).toBeTruthy();
    await user.selectOptions(filterSelect, 'archived');

    const archivedCard = await screen.findByText('Back Squat');
    const archivedSection = archivedCard.closest('.card');
    expect(archivedSection).toBeTruthy();
    const unarchiveButton = within(archivedSection).getByRole('button', { name: 'Unarchive' });

    await user.click(unarchiveButton);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/api/exercises/2/unarchive', { method: 'POST' });
    });
  });
});
