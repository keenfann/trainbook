import { describe, expect, it } from 'vitest';
import {
  formatReleaseTimestamp,
  parseReleaseTimestamp,
  resolveSessionDetailAggregateMetrics,
  resolveSessionDetailExerciseState,
} from '../src/features/workout/workout-utils.js';

describe('session detail metrics', () => {
  it('treats explicitly skipped exercises as skipped even when completedAt is present', () => {
    const state = resolveSessionDetailExerciseState({
      status: 'skipped',
      completedAt: '2026-01-01T12:00:00.000Z',
      sets: [],
    });

    expect(state).toBe('skipped');
  });

  it('does not count skipped target rows toward reps, sets, or volume', () => {
    const metrics = resolveSessionDetailAggregateMetrics({
      endedAt: '2026-01-01T12:00:00.000Z',
      exercises: [
        {
          status: 'skipped',
          completedAt: '2026-01-01T12:00:00.000Z',
          targetSets: 2,
          targetReps: 10,
          targetWeight: 18,
          sets: [],
        },
      ],
    });

    expect(metrics).toEqual({
      totalSets: 0,
      totalReps: 0,
      totalVolume: 0,
    });
  });
});

describe('release timestamp formatting', () => {
  it('treats timezone-less release timestamps as UTC', () => {
    const parsed = parseReleaseTimestamp('2026-02-18 11:38:47');
    expect(parsed?.toISOString()).toBe('2026-02-18T11:38:47.000Z');
  });

  it('keeps explicit timezone offsets unchanged', () => {
    const parsed = parseReleaseTimestamp('2026-02-18T11:38:47-05:00');
    expect(parsed?.toISOString()).toBe('2026-02-18T16:38:47.000Z');
  });

  it('returns Unknown for empty release values', () => {
    expect(formatReleaseTimestamp('')).toBe('Unknown');
  });
});
