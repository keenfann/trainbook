function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function toMs(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function parseRangeMin(value) {
  if (!value) return null;
  const strictMatch = String(value).match(/^(\d+)\s*-\s*(\d+)$/);
  if (strictMatch) return Number(strictMatch[1]);
  const looseMatch = String(value).match(/(\d+)\D+(\d+)/);
  if (looseMatch) return Number(looseMatch[1]);
  return null;
}

export function resolveTargetRepsValue(exercise) {
  const direct = Number(exercise?.targetReps);
  if (Number.isFinite(direct) && direct > 0) {
    return Math.round(direct);
  }
  const rangeMin = parseRangeMin(exercise?.targetRepsRange);
  if (Number.isFinite(rangeMin) && rangeMin > 0) {
    return Math.round(rangeMin);
  }
  return null;
}

export function resolveExerciseStartAt(exercise, fallbackIso) {
  const direct = toIso(exercise?.startedAt);
  if (direct) return direct;
  const fromSets = (exercise?.sets || [])
    .map((set) => set?.startedAt || set?.completedAt || set?.createdAt || null)
    .map(toIso)
    .find(Boolean);
  return fromSets || toIso(fallbackIso) || new Date().toISOString();
}

export function validateWorkoutReadiness(exercises) {
  const issues = [];
  (exercises || []).forEach((exercise) => {
    const missing = [];
    const targetSets = Number(exercise?.targetSets);
    const hasTargetSets = Number.isInteger(targetSets) && targetSets > 0;
    if (!hasTargetSets) {
      missing.push('sets');
    }

    const reps = resolveTargetRepsValue(exercise);
    if (!Number.isFinite(reps)) {
      missing.push('reps');
    }

    const equipment = String(exercise?.equipment || '').trim();
    const weightRequired = equipment !== 'Bodyweight' && equipment !== 'Band';
    const hasWeight =
      exercise?.targetWeight !== null
      && exercise?.targetWeight !== undefined
      && exercise?.targetWeight !== ''
      && Number.isFinite(Number(exercise?.targetWeight));
    if (weightRequired && !hasWeight) {
      missing.push('weight');
    }

    if (missing.length) {
      issues.push({
        exerciseId: exercise?.exerciseId,
        name: exercise?.name || 'Exercise',
        missing,
      });
    }
  });
  return {
    valid: issues.length === 0,
    issues,
  };
}

export function formatReadinessError(issues) {
  if (!issues?.length) return null;
  const details = issues
    .map((issue) => `${issue.name} (${issue.missing.join(', ')})`)
    .join('; ');
  return `Cannot begin workout. Update routine targets for: ${details}.`;
}

export function buildChecklistRows(exercise, localCheckedAtBySetIndex = {}) {
  const targetSets = Number(exercise?.targetSets);
  if (!Number.isInteger(targetSets) || targetSets <= 0) return [];
  const persistedBySetIndex = new Map();
  (exercise?.sets || []).forEach((set) => {
    const setIndex = Number(set?.setIndex);
    if (!Number.isInteger(setIndex) || setIndex <= 0 || persistedBySetIndex.has(setIndex)) return;
    persistedBySetIndex.set(setIndex, set);
  });

  const rows = [];
  for (let setIndex = 1; setIndex <= targetSets; setIndex += 1) {
    const persistedSet = persistedBySetIndex.get(setIndex) || null;
    const localCheckedAt = toIso(localCheckedAtBySetIndex?.[setIndex]);
    const persistedCheckedAt = toIso(
      persistedSet?.completedAt || persistedSet?.createdAt || persistedSet?.startedAt
    );
    rows.push({
      setIndex,
      persistedSet,
      locked: Boolean(persistedSet),
      checked: Boolean(persistedSet || localCheckedAt),
      checkedAt: persistedCheckedAt || localCheckedAt || null,
    });
  }
  return rows;
}

export function interpolateTimestampForSetIndex({
  setIndex,
  targetSetCount,
  exerciseStartedAt,
  exerciseFinishedAt,
}) {
  const finishMs = toMs(exerciseFinishedAt);
  const startMsRaw = toMs(exerciseStartedAt);
  if (!Number.isFinite(finishMs)) {
    return new Date().toISOString();
  }
  const startMs = Number.isFinite(startMsRaw) ? Math.min(startMsRaw, finishMs) : finishMs;
  if (!Number.isInteger(targetSetCount) || targetSetCount <= 1) {
    return new Date(finishMs).toISOString();
  }
  const boundedIndex = Math.min(targetSetCount, Math.max(1, Number(setIndex) || 1));
  const ratio = (boundedIndex - 1) / (targetSetCount - 1);
  const interpolated = startMs + Math.round((finishMs - startMs) * ratio);
  return new Date(interpolated).toISOString();
}

export function buildMissingSetPayloads({
  exercise,
  checkedAtBySetIndex = {},
  exerciseStartedAt,
  exerciseFinishedAt,
  defaultBandLabel = null,
  includeUnchecked = false,
}) {
  const targetSets = Number(exercise?.targetSets);
  if (!Number.isInteger(targetSets) || targetSets <= 0) return [];
  const reps = resolveTargetRepsValue(exercise);
  if (!Number.isFinite(reps)) return [];

  const equipment = String(exercise?.equipment || '').trim();
  const isBodyweight = equipment === 'Bodyweight';
  const isBand = equipment === 'Band';
  const weight = isBodyweight || isBand ? 0 : Number(exercise?.targetWeight);
  if (
    !isBodyweight
    && !isBand
    && (
      exercise?.targetWeight === null
      || exercise?.targetWeight === undefined
      || exercise?.targetWeight === ''
      || !Number.isFinite(weight)
    )
  ) {
    return [];
  }
  const bandLabel = isBand
    ? String(exercise?.targetBandLabel || defaultBandLabel || '').trim() || null
    : null;

  const persistedSetIndexes = new Set(
    (exercise?.sets || [])
      .map((set) => Number(set?.setIndex))
      .filter((setIndex) => Number.isInteger(setIndex) && setIndex > 0)
  );

  const payloads = [];
  for (let setIndex = 1; setIndex <= targetSets; setIndex += 1) {
    if (persistedSetIndexes.has(setIndex)) continue;
    const checkedAt = toIso(checkedAtBySetIndex?.[setIndex]);
    if (!checkedAt && !includeUnchecked) continue;
    const completedAt = checkedAt || interpolateTimestampForSetIndex({
      setIndex,
      targetSetCount: targetSets,
      exerciseStartedAt,
      exerciseFinishedAt,
    });
    payloads.push({
      setIndex,
      reps,
      weight,
      bandLabel,
      startedAt: completedAt,
      completedAt,
    });
  }
  return payloads;
}
