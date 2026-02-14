// @vitest-environment jsdom
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
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

function buildStatsFixture({ bodyweightPoints = [], fallbackWeights = [] } = {}) {
  const exercises = [
    { id: 1, name: 'Bench Press', primaryMuscles: ['chest'] },
    { id: 2, name: 'Back Squat', primaryMuscles: ['quadriceps'] },
  ];

  const progressionByExerciseId = {
    1: [
      { sessionId: 101, startedAt: '2026-01-02T09:00:00.000Z', topWeight: 100, topReps: 5, topVolume: 500 },
      { sessionId: 102, startedAt: '2026-01-09T09:00:00.000Z', topWeight: 102.5, topReps: 5, topVolume: 512.5 },
    ],
    2: [
      { sessionId: 201, startedAt: '2026-01-03T09:00:00.000Z', topWeight: 120, topReps: 4, topVolume: 480 },
      { sessionId: 202, startedAt: '2026-01-10T09:00:00.000Z', topWeight: 125, topReps: 4, topVolume: 500 },
    ],
  };

  const distributionBreakdownByBucket = {
    chest: [
      { exerciseId: 1, name: 'Bench Press', setCount: 18, volume: 4200 },
      { exerciseId: 3, name: 'Incline Bench Press', setCount: 14, volume: 3200 },
    ],
    quadriceps: [
      { exerciseId: 2, name: 'Back Squat', setCount: 16, volume: 6100 },
      { exerciseId: 4, name: 'Split Squat', setCount: 8, volume: 2100 },
    ],
    lats: [
      { exerciseId: 5, name: 'Lat Pulldown', setCount: 10, volume: 1900 },
      { exerciseId: 6, name: 'Seated Row', setCount: 4, volume: 800 },
    ],
  };

  const bodyweightSummary = bodyweightPoints.length
    ? {
      startWeight: bodyweightPoints[0].weight,
      latestWeight: bodyweightPoints[bodyweightPoints.length - 1].weight,
      delta: bodyweightPoints[bodyweightPoints.length - 1].weight - bodyweightPoints[0].weight,
    }
    : {
      startWeight: null,
      latestWeight: null,
      delta: null,
    };

  apiFetch.mockImplementation(async (path, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    const url = new URL(path, 'http://localhost');
    const pathname = url.pathname;
    const params = url.searchParams;

    if (pathname === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
    if (pathname === '/api/stats/overview') {
      return {
        routineType: params.get('routineType') || 'all',
        summary: {
          totalSessions: 22,
          totalSets: 280,
          setsWeek: 18,
          setsMonth: 72,
          volumeWeek: 9200,
          volumeMonth: 38500,
          sessionsWeek: 3,
          sessionsMonth: 12,
          uniqueExercisesWeek: 8,
          uniqueExercisesMonth: 16,
          avgSetWeightWeek: 56.2,
          avgSetWeightMonth: 53.8,
          lastSessionAt: '2026-01-12T09:00:00.000Z',
        },
        topExercises: [
          { exerciseId: 1, name: 'Bench Press', maxWeight: 110, maxReps: 6 },
          { exerciseId: 2, name: 'Back Squat', maxWeight: 140, maxReps: 5 },
        ],
        weeklyVolume: [],
        weeklySets: [],
      };
    }
    if (pathname === '/api/weights') return { weights: fallbackWeights };
    if (pathname === '/api/exercises') return { exercises };

    if (pathname === '/api/stats/timeseries') {
      const bucket = params.get('bucket') || 'week';
      const window = params.get('window') || '180d';
      return {
        routineType: params.get('routineType') || 'all',
        bucket,
        windowDays: Number(window.replace('d', '')),
        points: [
          {
            bucketKey: bucket === 'month' ? '2026-01' : '2026-W01',
            label: bucket === 'month' ? 'Jan 26' : 'W01',
            startAt: '2026-01-01T00:00:00.000Z',
            sets: 24,
            volume: 13250,
            sessions: 4,
            uniqueExercises: 9,
            avgSetWeight: 55.2,
          },
          {
            bucketKey: bucket === 'month' ? '2026-02' : '2026-W02',
            label: bucket === 'month' ? 'Feb 26' : 'W02',
            startAt: '2026-01-08T00:00:00.000Z',
            sets: 20,
            volume: 11800,
            sessions: 3,
            uniqueExercises: 8,
            avgSetWeight: 54.1,
          },
        ],
        summary: {
          totalSets: 44,
          totalVolume: 25050,
          totalSessions: 7,
          avgSetsPerBucket: 22,
        },
      };
    }

    if (pathname === '/api/stats/progression') {
      const exerciseId = Number(params.get('exerciseId') || 1);
      return {
        routineType: params.get('routineType') || 'all',
        exercise: { id: exerciseId, name: exercises.find((item) => item.id === exerciseId)?.name || 'Exercise' },
        windowDays: Number((params.get('window') || '90d').replace('d', '')),
        points: progressionByExerciseId[exerciseId] || [],
      };
    }

    if (pathname === '/api/stats/distribution') {
      const metric = params.get('metric') || 'frequency';
      const rows = [
        { bucket: 'chest', value: metric === 'volume' ? 8200 : 32, share: 0.48 },
        { bucket: 'quadriceps', value: metric === 'volume' ? 6100 : 24, share: 0.35 },
        { bucket: 'lats', value: metric === 'volume' ? 2700 : 14, share: 0.17 },
      ];
      return {
        routineType: params.get('routineType') || 'all',
        metric,
        windowDays: Number((params.get('window') || '30d').replace('d', '')),
        total: rows.reduce((sum, row) => sum + row.value, 0),
        rows,
      };
    }

    if (pathname === '/api/stats/distribution/drilldown') {
      const metric = params.get('metric') || 'frequency';
      const muscle = (params.get('muscle') || '').toLowerCase();
      const rows = (distributionBreakdownByBucket[muscle] || []).map((row) => ({
        ...row,
        value: metric === 'volume' ? row.volume : row.setCount,
      }));
      const total = rows.reduce((sum, row) => sum + row.value, 0);
      const totalSets = rows.reduce((sum, row) => sum + row.setCount, 0);
      const totalVolume = rows.reduce((sum, row) => sum + row.volume, 0);
      return {
        routineType: params.get('routineType') || 'all',
        metric,
        muscle,
        windowDays: Number((params.get('window') || '30d').replace('d', '')),
        total,
        rows: rows.map((row) => ({
          ...row,
          share: total ? row.value / total : 0,
        })),
        summary: {
          totalExercises: rows.length,
          totalSets,
          totalVolume,
        },
      };
    }

    if (pathname === '/api/stats/bodyweight-trend') {
      return {
        windowDays: 90,
        points: bodyweightPoints,
        summary: bodyweightSummary,
      };
    }

    throw new Error(`Unhandled path: ${path} (${method})`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Stats page', () => {
  it('renders modern stats sections and KPI cards', async () => {
    buildStatsFixture({
      bodyweightPoints: [
        { id: 1, weight: 80.3, measuredAt: '2026-01-01T08:00:00.000Z' },
        { id: 2, weight: 79.8, measuredAt: '2026-01-10T08:00:00.000Z' },
      ],
    });

    renderAppAt('/stats');

    expect(await screen.findByRole('heading', { name: 'Stats' })).toBeInTheDocument();
    expect(screen.getByText('Workload over time')).toBeInTheDocument();
    expect(screen.getByText('Exercise activity')).toBeInTheDocument();
    expect(screen.getByText('Exercise progression')).toBeInTheDocument();
    expect(screen.getByText('Muscle-group set distribution')).toBeInTheDocument();
    expect(screen.getByText('Bodyweight trend')).toBeInTheDocument();
    expect(screen.getByText('Recent best lifts')).toBeInTheDocument();
    expect(screen.getByText('Workouts')).toBeInTheDocument();
    expect(screen.getByText('Time since last workout')).toBeInTheDocument();
    expect(screen.getByText('Bodyweight delta')).toBeInTheDocument();
    expect(screen.getByLabelText('Stats routine type')).toHaveValue('all');
    expect(
      apiFetch.mock.calls.some(([path]) => path === '/api/stats/overview?routineType=all')
    ).toBe(true);
  });

  it('refetches timeseries analytics when bucket and window change', async () => {
    buildStatsFixture();
    const user = userEvent.setup();
    renderAppAt('/stats');

    await screen.findByText('Workload over time');

    await user.selectOptions(screen.getByLabelText('Timeseries bucket'), 'month');
    await user.selectOptions(screen.getByLabelText('Timeseries window'), '365d');

    await waitFor(() => {
      expect(
        apiFetch.mock.calls.some(
          ([path]) => path === '/api/stats/timeseries?bucket=month&window=365d&routineType=all'
        )
      ).toBe(true);
    });
  });

  it('refetches progression when exercise selection changes', async () => {
    buildStatsFixture();
    const user = userEvent.setup();
    renderAppAt('/stats');

    await screen.findByText('Exercise progression');

    await user.selectOptions(screen.getByLabelText('Progression exercise'), '2');

    await waitFor(() => {
      expect(
        apiFetch.mock.calls.some(([path]) =>
          path === '/api/stats/progression?exerciseId=2&window=90d&routineType=all'
        )
      ).toBe(true);
    });
  });

  it('refetches stats and analytics when routine type changes', async () => {
    buildStatsFixture();
    const user = userEvent.setup();
    renderAppAt('/stats');

    await screen.findByText('Workload over time');
    await user.selectOptions(screen.getByLabelText('Stats routine type'), 'rehab');

    await waitFor(() => {
      expect(
        apiFetch.mock.calls.some(([path]) => path === '/api/stats/overview?routineType=rehab')
      ).toBe(true);
      expect(
        apiFetch.mock.calls.some(
          ([path]) => path === '/api/stats/timeseries?bucket=week&window=180d&routineType=rehab'
        )
      ).toBe(true);
      expect(
        apiFetch.mock.calls.some(
          ([path]) => path === '/api/stats/distribution?metric=frequency&window=30d&routineType=rehab'
        )
      ).toBe(true);
    });
  });

  it('shows empty bodyweight state when no points are available', async () => {
    buildStatsFixture({ bodyweightPoints: [], fallbackWeights: [] });
    renderAppAt('/stats');
    expect(await screen.findByText('Log weight in the workout view.')).toBeInTheDocument();
  });

  it('shows bodyweight summary chip when trend points exist', async () => {
    buildStatsFixture({
      bodyweightPoints: [
        { id: 1, weight: 82.1, measuredAt: '2026-01-01T08:00:00.000Z' },
        { id: 2, weight: 81.4, measuredAt: '2026-01-12T08:00:00.000Z' },
      ],
    });
    renderAppAt('/stats');

    expect(await screen.findByText(/Start/i)).toBeInTheDocument();
    expect(screen.queryByText('Log weight in the workout view.')).not.toBeInTheDocument();
  });

  it('toggles recent best lifts between weight and reps views', async () => {
    buildStatsFixture();
    const user = userEvent.setup();
    renderAppAt('/stats');

    expect(await screen.findByText('Recent best lifts')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Weight' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Reps' })).not.toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '110 kg' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reps' }));

    expect(screen.getByRole('columnheader', { name: 'Reps' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Weight' })).not.toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '6 reps' })).toBeInTheDocument();
  });
});
