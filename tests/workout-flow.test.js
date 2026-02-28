import { describe, expect, it } from 'vitest';
import {
  buildChecklistRows,
  buildMissingSetPayloads,
  formatReadinessError,
  interpolateTimestampForSetIndex,
  resolveExerciseStartAt,
  resolveTargetRepsValue,
  validateWorkoutReadiness,
} from '../src/workout-flow.js';

describe('workout-flow helpers', () => {
  it('resolves target reps from explicit value or range minimum', () => {
    expect(resolveTargetRepsValue({ targetReps: 6 })).toBe(6);
    expect(resolveTargetRepsValue({ targetRepsRange: '8-12' })).toBe(8);
    expect(resolveTargetRepsValue({ targetReps: null, targetRepsRange: null })).toBeNull();
  });

  it('validates workout readiness requirements', () => {
    const result = validateWorkoutReadiness([
      {
        exerciseId: 1,
        name: 'Bench Press',
        equipment: 'Barbell',
        targetSets: null,
        targetRepsRange: '5-8',
        targetWeight: 80,
      },
      {
        exerciseId: 2,
        name: 'Split Squat',
        equipment: 'Dumbbell',
        targetSets: 3,
        targetReps: 10,
        targetWeight: null,
      },
    ]);
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      { exerciseId: 1, name: 'Bench Press', missing: ['sets'] },
      { exerciseId: 2, name: 'Split Squat', missing: ['weight'] },
    ]);
    expect(formatReadinessError(result.issues)).toContain('Bench Press (sets)');
  });

  it('builds checklist rows with persisted locks and local checks', () => {
    const rows = buildChecklistRows(
      {
        targetSets: 3,
        sets: [
          {
            id: 10,
            setIndex: 1,
            completedAt: '2026-02-10T10:00:00.000Z',
          },
        ],
      },
      {
        2: '2026-02-10T10:03:00.000Z',
      }
    );

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      setIndex: 1,
      checked: true,
      locked: true,
      checkedAt: '2026-02-10T10:00:00.000Z',
    });
    expect(rows[1]).toMatchObject({
      setIndex: 2,
      checked: true,
      locked: false,
      checkedAt: '2026-02-10T10:03:00.000Z',
    });
    expect(rows[2]).toMatchObject({
      setIndex: 3,
      checked: false,
      locked: false,
      checkedAt: null,
    });
  });


  it('allows local force-uncheck overrides for persisted sets', () => {
    const rows = buildChecklistRows(
      {
        targetSets: 2,
        sets: [
          {
            id: 10,
            setIndex: 1,
            completedAt: '2026-02-10T10:00:00.000Z',
          },
        ],
      },
      {
        1: false,
      }
    );

    expect(rows[0]).toMatchObject({
      setIndex: 1,
      checked: false,
      locked: true,
      checkedAt: null,
    });
  });

  it('interpolates unchecked set timestamps between exercise start and finish', () => {
    const timestamp = interpolateTimestampForSetIndex({
      setIndex: 2,
      targetSetCount: 3,
      exerciseStartedAt: '2026-02-10T10:00:00.000Z',
      exerciseFinishedAt: '2026-02-10T10:06:00.000Z',
    });
    expect(timestamp).toBe('2026-02-10T10:03:00.000Z');
  });

  it('builds missing set payloads only for checked set indexes', () => {
    const payloads = buildMissingSetPayloads({
      exercise: {
        exerciseId: 44,
        equipment: 'Barbell',
        targetSets: 3,
        targetRepsRange: '5-8',
        targetWeight: 90,
        sets: [{ setIndex: 1, completedAt: '2026-02-10T10:00:00.000Z' }],
      },
      checkedAtBySetIndex: {
        2: '2026-02-10T10:04:00.000Z',
      },
      exerciseStartedAt: '2026-02-10T10:00:00.000Z',
      exerciseFinishedAt: '2026-02-10T10:06:00.000Z',
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
      setIndex: 2,
      reps: 5,
      weight: 90,
      startedAt: '2026-02-10T10:04:00.000Z',
      completedAt: '2026-02-10T10:04:00.000Z',
    });
  });


  it('builds missing set payloads for unchecked sets when includeUnchecked is enabled', () => {
    const payloads = buildMissingSetPayloads({
      exercise: {
        exerciseId: 44,
        equipment: 'Barbell',
        targetSets: 3,
        targetReps: 6,
        targetWeight: 90,
        sets: [{ setIndex: 1, completedAt: '2026-02-10T10:00:00.000Z' }],
      },
      checkedAtBySetIndex: {
        2: '2026-02-10T10:04:00.000Z',
      },
      exerciseStartedAt: '2026-02-10T10:00:00.000Z',
      exerciseFinishedAt: '2026-02-10T10:06:00.000Z',
      includeUnchecked: true,
    });

    expect(payloads).toHaveLength(2);
    expect(payloads).toEqual([
      expect.objectContaining({
        setIndex: 2,
        startedAt: '2026-02-10T10:04:00.000Z',
        completedAt: '2026-02-10T10:04:00.000Z',
      }),
      expect.objectContaining({
        setIndex: 3,
        startedAt: '2026-02-10T10:06:00.000Z',
        completedAt: '2026-02-10T10:06:00.000Z',
      }),
    ]);
  });

  it('resolves exercise start timestamp from progress, sets, or fallback', () => {
    expect(resolveExerciseStartAt({ startedAt: '2026-02-10T10:00:00.000Z' })).toBe(
      '2026-02-10T10:00:00.000Z'
    );
    expect(
      resolveExerciseStartAt({
        sets: [{ setIndex: 1, completedAt: '2026-02-10T10:05:00.000Z' }],
      })
    ).toBe('2026-02-10T10:05:00.000Z');
    expect(resolveExerciseStartAt({}, '2026-02-10T10:08:00.000Z')).toBe(
      '2026-02-10T10:08:00.000Z'
    );
  });
});
