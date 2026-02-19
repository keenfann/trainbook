import { resolveTargetRepsValue } from '../../workout-flow.js';
import { WARMUP_STEP_ID, WARMUP_STEP_NAME } from './constants.js';
import {
  buildSessionExerciseKey,
} from './session-keys.js';
import { formatNumber } from './formatting.js';

export function buildSessionSummary(detail) {
  if (!detail) return detail;
  let totalSets = 0;
  let totalReps = 0;
  let totalVolume = 0;
  (detail.exercises || []).forEach((exercise) => {
    (exercise.sets || []).forEach((set) => {
      totalSets += 1;
      const reps = Number(set.reps);
      const weight = Number(set.weight);
      if (Number.isFinite(reps)) {
        totalReps += reps;
        if (Number.isFinite(weight)) {
          totalVolume += reps * weight;
        }
      }
    });
  });
  const explicitWarmupSeconds = Number(detail.warmupDurationSeconds);
  const warmupDurationSeconds = (
    Number.isFinite(explicitWarmupSeconds) && explicitWarmupSeconds >= 0
  )
    ? Math.round(explicitWarmupSeconds)
    : resolveDurationSeconds(detail.warmupStartedAt, detail.warmupCompletedAt);
  return {
    ...detail,
    totalSets,
    totalReps,
    totalVolume,
    warmupDurationSeconds,
    completedExercises: countSessionTrainedExercises(detail),
  };
}

export function sessionHasTrackedProgress(session) {
  if (!session) return false;
  if (Number(session.totalSets || 0) > 0) return true;
  if (session.warmupStartedAt || session.warmupCompletedAt) return true;
  return (session.exercises || []).some((exercise) => (
    exercise?.status === 'in_progress'
    || exercise?.status === 'completed'
    || Boolean(exercise?.startedAt)
    || Boolean(exercise?.completedAt)
    || (Array.isArray(exercise?.sets) && exercise.sets.length > 0)
  ));
}

export function resolveDurationSeconds(startedAt, endedAt) {
  const startedMs = new Date(startedAt || '').getTime();
  const endedMs = new Date(endedAt || '').getTime();
  if (!Number.isFinite(startedMs) || !Number.isFinite(endedMs) || endedMs < startedMs) {
    return null;
  }
  return Math.round((endedMs - startedMs) / 1000);
}

export function createWarmupStep(warmupStartedAt = null, warmupCompletedAt = null) {
  return {
    exerciseId: WARMUP_STEP_ID,
    routineExerciseId: null,
    sessionExerciseKey: buildSessionExerciseKey(WARMUP_STEP_ID),
    name: WARMUP_STEP_NAME,
    equipment: null,
    targetSets: null,
    targetReps: null,
    targetRepsRange: null,
    targetRestSeconds: null,
    targetWeight: null,
    targetBandLabel: null,
    supersetGroup: null,
    force: null,
    level: null,
    mechanic: null,
    category: null,
    primaryMuscles: [],
    secondaryMuscles: [],
    instructions: [],
    images: [],
    sets: [],
    status: warmupCompletedAt ? 'completed' : warmupStartedAt ? 'in_progress' : 'pending',
    startedAt: warmupStartedAt,
    completedAt: warmupCompletedAt,
    durationSeconds: resolveDurationSeconds(warmupStartedAt, warmupCompletedAt),
    position: -1,
    isWarmupStep: true,
  };
}

export function countSessionTrainedExercises(session) {
  return (session?.exercises || []).filter((exercise) => (
    exercise?.status === 'completed'
    || (exercise?.sets || []).length > 0
  )).length;
}

export function resolveRecentWorkoutCount(session) {
  const loggedSetCount = Number(session?.totalSets || 0);
  if (loggedSetCount > 0) return loggedSetCount;
  const completedExerciseCount = Number(session?.completedExercises || 0);
  if (completedExerciseCount > 0) return completedExerciseCount;
  return 0;
}

export function resolveSessionDetailPlaceholderWeight(exercise) {
  const bandLabel = String(exercise?.targetBandLabel || '').trim();
  if (bandLabel) return bandLabel;
  const targetWeight = Number(exercise?.targetWeight);
  if (Number.isFinite(targetWeight)) {
    if (targetWeight === 0) return 'Bodyweight';
    return `${formatNumber(targetWeight)} kg`;
  }
  const equipment = String(exercise?.equipment || '').trim().toLowerCase();
  if (equipment === 'bodyweight') return 'Bodyweight';
  return '—';
}

export function resolveSessionDetailPlaceholderReps(exercise) {
  const targetReps = Number(exercise?.targetReps);
  if (Number.isFinite(targetReps) && targetReps > 0) {
    return `${formatNumber(targetReps)} reps`;
  }
  const targetRange = String(exercise?.targetRepsRange || '').trim();
  if (targetRange) return `${targetRange} reps`;
  return 'Completed';
}

export function buildSessionDetailSetRows(exercise, { exerciseState = 'skipped' } = {}) {
  const persistedSets = Array.isArray(exercise?.sets) ? exercise.sets : [];
  const normalizedPersistedRows = persistedSets
    .map((set, order) => {
      const parsedSetIndex = Number(set?.setIndex);
      return {
        kind: 'logged',
        set,
        setIndex: Number.isInteger(parsedSetIndex) && parsedSetIndex > 0
          ? parsedSetIndex
          : order + 1,
        order,
      };
    })
    .sort((left, right) => (
      left.setIndex - right.setIndex || left.order - right.order
    ));

  const rows = normalizedPersistedRows.map((row) => ({
    kind: row.kind,
    set: row.set,
    setIndex: row.setIndex,
  }));

  if (!rows.length && exerciseState === 'completed') {
    const targetSetsFallback = Number(exercise?.targetSets);
    if (!Number.isInteger(targetSetsFallback) || targetSetsFallback <= 0) {
      rows.push({
        kind: 'completed_unlogged',
        set: null,
        setIndex: 1,
      });
      return rows;
    }
  }

  const targetSets = Number(exercise?.targetSets);
  const shouldAddTargetRows = (
    Number.isInteger(targetSets)
    && targetSets > 0
    && (normalizedPersistedRows.length > 0 || exerciseState === 'completed')
  );
  if (shouldAddTargetRows) {
    const loggedIndexes = new Set(
      normalizedPersistedRows
        .map((row) => row.setIndex)
        .filter((setIndex) => setIndex >= 1 && setIndex <= targetSets)
    );
    for (let setIndex = 1; setIndex <= targetSets; setIndex += 1) {
      if (loggedIndexes.has(setIndex)) continue;
      rows.push({
        kind: normalizedPersistedRows.length === 0 && exerciseState === 'completed'
          ? 'completed_unlogged'
          : 'skipped',
        set: null,
        setIndex,
      });
    }
    rows.sort((left, right) => (
      left.setIndex - right.setIndex || (left.kind === 'logged' ? -1 : 1)
    ));
  }

  return rows;
}

export function resolveSessionDetailExerciseState(exercise, { sessionEnded = false } = {}) {
  if (!exercise) return 'skipped';
  if ((exercise.sets || []).length > 0) return 'completed';
  const status = String(exercise.status || '').trim().toLowerCase();
  if (status === 'completed') return 'completed';
  if (status === 'skipped') return 'skipped';
  if (exercise.completedAt && status !== 'skipped') return 'completed';
  if (sessionEnded) return 'skipped';
  if (status === 'in_progress' || exercise.startedAt) return 'in_progress';
  return 'skipped';
}

export function resolveSessionDetailAggregateMetrics(session) {
  if (!session) {
    return {
      totalSets: 0,
      totalReps: 0,
      totalVolume: 0,
    };
  }

  const sessionEnded = Boolean(session.endedAt);
  let totalSets = 0;
  let totalReps = 0;
  let totalVolume = 0;

  (session.exercises || []).forEach((exercise) => {
    const exerciseState = resolveSessionDetailExerciseState(exercise, { sessionEnded });
    const rows = buildSessionDetailSetRows(exercise, { exerciseState });
    rows.forEach((row) => {
      if (row.kind === 'skipped') return;
      totalSets += 1;

      if (row.kind === 'logged') {
        const reps = Number(row.set?.reps);
        const weight = Number(row.set?.weight);
        if (Number.isFinite(reps) && reps > 0) {
          totalReps += reps;
          if (Number.isFinite(weight)) {
            totalVolume += reps * weight;
          }
        }
        return;
      }

      const fallbackReps = Number(resolveTargetRepsValue(exercise));
      const fallbackWeight = Number(exercise?.targetWeight);
      if (Number.isFinite(fallbackReps) && fallbackReps > 0) {
        totalReps += fallbackReps;
        if (Number.isFinite(fallbackWeight)) {
          totalVolume += fallbackReps * fallbackWeight;
        }
      }
    });
  });

  return {
    totalSets,
    totalReps,
    totalVolume,
  };
}
