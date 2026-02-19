import { describe, expect, it } from 'vitest';

import {
  ROUTINE_BAND_OPTIONS,
  buildLinearTrendline,
  buildMovingAverage,
  buildSessionDetailSetRows,
  buildSupersetPartnerLookup,
  decodeRoutineEquipmentValue,
  formatDate,
  formatDateTime,
  formatDurationMinutes,
  formatDurationSeconds,
  formatExerciseImpact,
  formatInstructionsForTextarea,
  formatMuscleLabel,
  formatNumber,
  formatSessionDetailExerciseStateLabel,
  formatTargetWeightInputValue,
  formatReleaseTimestamp,
  normalizeExerciseMetadataList,
  normalizeExercisePrimaryMuscles,
  normalizeRoutineForUi,
  parseInstructionsFromTextarea,
  parseReleaseTimestamp,
  parseTargetWeightInput,
  resolveAutoTargetRepMax,
  resolveExerciseImageUrl,
  resolveRoutineRestOptionValue,
  resolveRouteOrder,
  resolveSessionDetailExerciseState,
  resolveSessionDetailPlaceholderReps,
  resolveSessionDetailPlaceholderWeight,
  resolveTargetRepBounds,
  resolveTargetWeightSaveStatusLabel,
  resolveTopLevelPath,
  sessionHasTrackedProgress,
} from '../src/features/workout/workout-utils.js';

describe('workout-utils helper coverage', () => {
  it('normalizes routine and exercise metadata helpers', () => {
    expect(normalizeRoutineForUi(null)).toBeNull();
    expect(normalizeRoutineForUi({ id: 1, routineType: ' ReHab ' })).toEqual({
      id: 1,
      routineType: 'rehab',
    });

    expect(normalizeExercisePrimaryMuscles({ primaryMuscles: ['chest', '', 'triceps'] })).toEqual([
      'chest',
      'triceps',
    ]);
    expect(normalizeExercisePrimaryMuscles({ primaryMuscles: null })).toEqual([]);

    expect(formatMuscleLabel(' lower    back ')).toBe('Lower Back');
    expect(formatMuscleLabel('')).toBe('');

    expect(normalizeExerciseMetadataList([' push ', '', null, 'pull'])).toEqual(['push', 'pull']);
  });

  it('formats instructions and resolves image urls', () => {
    expect(formatInstructionsForTextarea(['Line 1', '', 'Line 2'])).toBe('Line 1\nLine 2');
    expect(formatInstructionsForTextarea('Raw')).toBe('Raw');

    expect(parseInstructionsFromTextarea('One\nTwo\nOne\n\nTwo\nThree')).toEqual([
      'One',
      'Two',
      'Three',
    ]);

    expect(resolveExerciseImageUrl('')).toBe('');
    expect(resolveExerciseImageUrl('https://example.com/image.png')).toBe('https://example.com/image.png');
    expect(resolveExerciseImageUrl('/exercise-images/image.png')).toBe('/exercise-images/image.png');
    expect(resolveExerciseImageUrl('legs/squat.png')).toBe(
      'https://raw.githubusercontent.com/keenfann/free-exercise-db/main/exercises/legs/squat.png'
    );
  });

  it('handles date/number/release formatting fallbacks', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('not-a-date')).toBe('—');
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('bad')).toBe('—');
    expect(formatNumber(undefined)).toBe('—');
    expect(formatNumber('not-a-number')).toBe('—');

    expect(parseReleaseTimestamp('')).toBeNull();
    expect(parseReleaseTimestamp('not-a-date')).toBeNull();
    expect(formatReleaseTimestamp('not-a-date')).toBe('not-a-date');
  });

  it('covers trendline and moving-average fallbacks', () => {
    expect(buildLinearTrendline(null, 'value')).toEqual([]);
    expect(buildLinearTrendline([{ value: 'x' }, { value: 2 }], 'value')).toEqual([null, null]);

    expect(buildMovingAverage([], 'value')).toEqual([]);
    expect(
      buildMovingAverage(
        [{ value: 1 }, { value: 2 }, { value: 'x' }, { value: 4 }],
        'value',
        3
      )
    ).toEqual([null, null, null, null]);
  });

  it('formats impact and session progress states', () => {
    expect(formatExerciseImpact(null)).toBe('Impact unavailable.');
    expect(
      formatExerciseImpact({
        routineReferences: 3,
        routineUsers: 2,
        setReferences: 12,
        setUsers: 4,
      })
    ).toBe('3 routine links (2 users), 12 logged sets (4 users)');

    expect(sessionHasTrackedProgress(null)).toBe(false);
    expect(sessionHasTrackedProgress({ warmupStartedAt: '2026-01-01T10:00:00.000Z' })).toBe(true);
    expect(sessionHasTrackedProgress({ exercises: [{ startedAt: '2026-01-01T10:05:00.000Z' }] })).toBe(
      true
    );
  });

  it('resolves target rep and rest option fallback values', () => {
    expect(resolveTargetRepBounds(null, '6-10')).toEqual({ min: '6', max: '10' });
    expect(resolveTargetRepBounds(5, null)).toEqual({ min: '5', max: '5' });
    expect(resolveTargetRepBounds('bad', 'bad input')).toEqual({ min: '8', max: '12' });

    expect(resolveAutoTargetRepMax('bad')).toBe('12');
    expect(resolveAutoTargetRepMax(50)).toBe('54');

    expect(resolveRoutineRestOptionValue(null)).toBe('60');
    expect(resolveRoutineRestOptionValue(88)).toBe('90');
  });

  it('covers weight and duration format/save helpers', () => {
    expect(formatDurationSeconds(-1)).toBeNull();
    expect(formatDurationSeconds(125)).toBe('02:05');

    expect(formatTargetWeightInputValue('')).toBe('0');
    expect(formatTargetWeightInputValue('abc')).toBe('');
    expect(formatTargetWeightInputValue(10)).toBe('10');
    expect(formatTargetWeightInputValue(10.5)).toBe('10.5');

    expect(parseTargetWeightInput('')).toBeNull();
    expect(parseTargetWeightInput('12,75')).toBe(12.75);

    expect(resolveTargetWeightSaveStatusLabel('saving')).toBe('Saving');
    expect(resolveTargetWeightSaveStatusLabel('saved')).toBe('Saved');
    expect(resolveTargetWeightSaveStatusLabel('queued')).toBe('Queued offline');
    expect(resolveTargetWeightSaveStatusLabel('failed')).toBe('Failed');
    expect(resolveTargetWeightSaveStatusLabel('unknown')).toBeNull();
  });

  it('covers session detail placeholder and state fallbacks', () => {
    expect(resolveSessionDetailPlaceholderWeight({ targetBandLabel: 'Red' })).toBe('Red');
    expect(resolveSessionDetailPlaceholderWeight({ targetWeight: 0 })).toBe('Bodyweight');
    expect(resolveSessionDetailPlaceholderWeight({ equipment: 'bodyweight' })).toBe('Bodyweight');
    expect(resolveSessionDetailPlaceholderWeight({})).toBe('—');

    expect(resolveSessionDetailPlaceholderReps({ targetReps: 8 })).toBe('8 reps');
    expect(resolveSessionDetailPlaceholderReps({ targetRepsRange: '10-12' })).toBe('10-12 reps');
    expect(resolveSessionDetailPlaceholderReps({})).toBe('Completed');

    expect(
      buildSessionDetailSetRows(
        {
          targetSets: 0,
          sets: [],
        },
        { exerciseState: 'completed' }
      )
    ).toEqual([{ kind: 'completed_unlogged', set: null, setIndex: 1 }]);

    expect(
      buildSessionDetailSetRows(
        {
          targetSets: 3,
          sets: [],
        },
        { exerciseState: 'completed' }
      )
    ).toEqual([
      { kind: 'completed_unlogged', set: null, setIndex: 1 },
      { kind: 'completed_unlogged', set: null, setIndex: 2 },
      { kind: 'completed_unlogged', set: null, setIndex: 3 },
    ]);

    expect(resolveSessionDetailExerciseState(null)).toBe('skipped');
    expect(resolveSessionDetailExerciseState({ completedAt: '2026-01-01T10:00:00.000Z' })).toBe(
      'completed'
    );
    expect(resolveSessionDetailExerciseState({ status: 'in_progress' })).toBe('in_progress');
    expect(resolveSessionDetailExerciseState({}, { sessionEnded: true })).toBe('skipped');

    expect(formatSessionDetailExerciseStateLabel('completed')).toBe('Completed');
    expect(formatSessionDetailExerciseStateLabel('in_progress')).toBe('In progress');
    expect(formatSessionDetailExerciseStateLabel('anything-else')).toBe('Skipped');

    expect(formatDurationMinutes(-1)).toBe('—');
    expect(formatDurationMinutes(60)).toBe('1h');
    expect(formatDurationMinutes(75)).toBe('1h 15m');
  });

  it('covers equipment decoding, superset lookup, and route fallback helpers', () => {
    expect(decodeRoutineEquipmentValue('')).toEqual({ equipment: '', targetBandLabel: '' });
    expect(decodeRoutineEquipmentValue('band:')).toEqual({
      equipment: 'Band',
      targetBandLabel: ROUTINE_BAND_OPTIONS[0],
    });
    expect(decodeRoutineEquipmentValue('equipment:Dumbbell')).toEqual({
      equipment: 'Dumbbell',
      targetBandLabel: '',
    });
    expect(decodeRoutineEquipmentValue('Band')).toEqual({
      equipment: 'Band',
      targetBandLabel: ROUTINE_BAND_OPTIONS[0],
    });
    expect(decodeRoutineEquipmentValue('Bodyweight')).toEqual({
      equipment: 'Bodyweight',
      targetBandLabel: '',
    });

    expect(
      buildSupersetPartnerLookup([
        { exerciseId: 1, supersetGroup: 'A' },
        { exerciseId: 2, supersetGroup: 'A' },
        { exerciseId: 3, supersetGroup: 'A' },
      ]).size
    ).toBe(0);

    const partnerLookup = buildSupersetPartnerLookup([
      { routineExerciseId: 11, exerciseId: 1, supersetGroup: 'B' },
      { routineExerciseId: 12, exerciseId: 2, supersetGroup: 'B' },
    ]);
    expect(partnerLookup.get('routine:11')?.routineExerciseId).toBe(12);
    expect(partnerLookup.get('routine:12')?.routineExerciseId).toBe(11);

    expect(resolveTopLevelPath()).toBe('/workout');
    expect(resolveTopLevelPath('/unknown/route')).toBe('/workout');
    expect(resolveTopLevelPath('/stats/details')).toBe('/stats');
    expect(resolveRouteOrder('/stats/details')).toBe(3);
    expect(resolveRouteOrder('/nope')).toBe(0);
  });
});
