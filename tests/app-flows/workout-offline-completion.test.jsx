// @vitest-environment jsdom
import { within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../src/api.js';
import { buildQueuedResponse, toSyncOperation } from '../../src/api/sync-operations.js';
import { renderAppAt, screen, waitFor } from '../helpers/app-flows-helpers.jsx';

vi.mock('../../src/api.js', () => ({ apiFetch: vi.fn() }));

const startedAt = '2026-10-06T10:00:00.000Z';
const warmupCompletedAt = '2026-10-06T10:05:00.000Z';

function createSession() {
  return {
    id: 810,
    routineId: 91,
    routineType: 'standard',
    routineName: 'Upper Body',
    name: 'Upper Body',
    notes: 'Felt strong',
    startedAt,
    endedAt: null,
    durationSeconds: null,
    warmupStartedAt: startedAt,
    warmupCompletedAt,
    warmupDurationSeconds: null,
    exercises: [{
      exerciseId: 901,
      routineExerciseId: 71,
      name: 'Bench Press',
      equipment: 'Barbell',
      targetSets: 1,
      targetReps: 8,
      targetWeight: 60,
      status: 'completed',
      startedAt: warmupCompletedAt,
      completedAt: '2026-10-06T10:10:00.000Z',
      position: 0,
      sets: [{ id: 1, setIndex: 1, reps: 8, weight: 60 }],
    }],
  };
}

function mockQueuedSaves(session) {
  let operationCount = 0;
  apiFetch.mockImplementation(async (path, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    if (method !== 'GET') {
      const operation = toSyncOperation(path, method, JSON.parse(options.body));
      if (operation) return buildQueuedResponse(operation, String(++operationCount));
    }
    if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
    if (path === '/api/routines') return { routines: [] };
    if (path === '/api/exercises') return { exercises: [] };
    if (path === '/api/sessions/active') return { session };
    if (path === '/api/sessions?limit=15') return { sessions: [] };
    if (path === '/api/weights?limit=6') return { weights: [] };
    if (path === '/api/bands') return { bands: [] };
    throw new Error(`Unavailable offline: ${path} (${method})`);
  });
}

function expectMetric(dialog, label, value) {
  const card = dialog.getByText(label).closest('.session-complete-metric');
  expect(within(card).getByText(value)).toBeInTheDocument();
}

beforeEach(() => vi.clearAllMocks());

describe('Offline workout completion', () => {
  it('keeps workout stats and reopens local details when the finish save is queued', async () => {
    mockQueuedSaves(createSession());
    const user = userEvent.setup();
    renderAppAt('/workout');

    await user.click(await screen.findByRole('button', { name: 'End workout' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Workout details' }));
    expect(dialog.getByText('Upper Body')).toBeInTheDocument();
    expect(dialog.getByText('Notes: Felt strong')).toBeInTheDocument();
    expectMetric(dialog, 'Exercises', '1 / 1');
    expectMetric(dialog, 'Sets', '1');
    expectMetric(dialog, 'Total reps', '8');
    expectMetric(dialog, 'Volume', '480 kg');
    expectMetric(dialog, 'Warmup time', '05:00');
    const finishCall = apiFetch.mock.calls.find(([path, options]) => (
      path === '/api/sessions/810' && options?.method === 'PUT'
    ));
    const { endedAt } = JSON.parse(finishCall[1].body);
    const seconds = Math.round((new Date(endedAt) - new Date(startedAt)) / 1000);
    const duration = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    expectMetric(dialog, 'Workout time', duration);

    await user.click(dialog.getByRole('button', { name: 'Close workout details' }));
    const recent = await screen.findByRole('button', { name: /Upper Body.*1 set/i });
    expect(recent).toHaveTextContent(duration);
    await user.click(recent);
    const reopened = within(await screen.findByRole('dialog', { name: 'Workout details' }));
    expectMetric(reopened, 'Volume', '480 kg');
    expect(apiFetch.mock.calls.filter(([path]) => path === '/api/sessions/810')).toHaveLength(1);
  });

  it('includes sets and completion of the final exercise before automatically finishing offline', async () => {
    const session = createSession();
    session.exercises.push({
      exerciseId: 902,
      routineExerciseId: 72,
      name: 'Cable Row',
      equipment: 'Machine',
      targetSets: 1,
      targetReps: 5,
      targetWeight: 60,
      status: 'in_progress',
      startedAt: '2026-10-06T10:10:00.000Z',
      completedAt: null,
      position: 1,
      sets: [],
    });
    mockQueuedSaves(session);
    const user = userEvent.setup();
    renderAppAt('/workout');

    await user.click(await screen.findByRole('button', { name: 'Finish workout' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Workout details' }));
    expectMetric(dialog, 'Exercises', '2 / 2');
    expectMetric(dialog, 'Sets', '2');
    expectMetric(dialog, 'Total reps', '13');
    expectMetric(dialog, 'Volume', '780 kg');
    expect(dialog.queryByText('Skipped')).not.toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Show 1 sets for Cable Row' }));
    const table = within(dialog.getByLabelText('Cable Row set summary'));
    expect(table.getByText('5 reps')).toBeInTheDocument();
    expect(table.getByText('60 kg')).toBeInTheDocument();
  });

  it('preserves the active workout when a notes-only save is queued', async () => {
    const session = createSession();
    session.exercises[0].status = 'pending';
    session.exercises[0].startedAt = null;
    session.exercises[0].completedAt = null;
    session.exercises[0].sets = [];
    session.warmupStartedAt = null;
    session.warmupCompletedAt = null;
    mockQueuedSaves(session);
    const user = userEvent.setup();
    renderAppAt('/workout');

    const notes = await screen.findByPlaceholderText('Notes for this workout');
    await user.clear(notes);
    await user.type(notes, 'New notes');
    await user.click(screen.getByRole('button', { name: 'Save workout details' }));
    await waitFor(() => expect(screen.getByText('Upper Body')).toBeInTheDocument());
    expect(screen.getByText(/Bench Press/)).toBeInTheDocument();
    expect(notes).toHaveValue('New notes');
    expect(screen.getByRole('button', { name: 'Begin workout' })).toBeInTheDocument();
  });
});
