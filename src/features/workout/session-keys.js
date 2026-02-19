import {
  TARGET_WEIGHT_STEP_BARBELL,
  TARGET_WEIGHT_STEP_DEFAULT,
} from './constants.js';

export function normalizeEquipmentForComparison(value) {
  return String(value || '').trim().toLowerCase();
}

export function normalizeRoutineExerciseId(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric;
}

export function buildSessionExerciseKey(exerciseId, routineExerciseId = null) {
  const normalizedRoutineExerciseId = normalizeRoutineExerciseId(routineExerciseId);
  if (normalizedRoutineExerciseId) {
    return `routine:${normalizedRoutineExerciseId}`;
  }
  const normalizedExerciseId = Number(exerciseId);
  if (Number.isFinite(normalizedExerciseId)) {
    return `exercise:${normalizedExerciseId}`;
  }
  const fallbackExerciseId = String(exerciseId || '').trim() || '0';
  return `exercise:${fallbackExerciseId}`;
}

export function resolveSessionExerciseKey(exercise) {
  if (!exercise) return null;
  if (exercise.sessionExerciseKey) return String(exercise.sessionExerciseKey);
  return buildSessionExerciseKey(exercise.exerciseId, exercise.routineExerciseId);
}

export function buildTargetWeightControlKey(routineId, exerciseId, equipment, routineExerciseId = null) {
  return [
    Number.isFinite(Number(routineId)) ? Number(routineId) : 'none',
    buildSessionExerciseKey(exerciseId, routineExerciseId),
    normalizeEquipmentForComparison(equipment) || 'unknown',
  ].join(':');
}

export function resolveWeightStepForEquipment(equipment) {
  return normalizeEquipmentForComparison(equipment) === 'barbell'
    ? TARGET_WEIGHT_STEP_BARBELL
    : TARGET_WEIGHT_STEP_DEFAULT;
}

export function roundWeight(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Number((Math.round(parsed * 100) / 100).toFixed(2));
}

export function formatTargetWeightInputValue(value) {
  const rounded = roundWeight(value);
  if (!Number.isFinite(rounded)) return '';
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded).replace(/\.0$/, '');
}

export function parseTargetWeightInput(value) {
  const normalized = String(value || '').trim().replace(',', '.');
  if (!normalized) return null;
  return roundWeight(normalized);
}

export function isWeightedTargetEditable(exercise) {
  if (!exercise || exercise.isWarmupStep) return false;
  const equipment = normalizeEquipmentForComparison(exercise.equipment);
  if (!equipment || equipment === 'bodyweight' || equipment === 'band' || equipment === 'ab wheel') {
    return false;
  }
  const targetWeight = Number(exercise.targetWeight);
  return Number.isFinite(targetWeight) && targetWeight > 0;
}

export function resolveSessionDurationSeconds(session) {
  const explicitSeconds = Number(session?.durationSeconds);
  if (Number.isFinite(explicitSeconds) && explicitSeconds >= 0) {
    return Math.round(explicitSeconds);
  }
  const startedAt = new Date(session?.startedAt || '').getTime();
  const endedAt = new Date(session?.endedAt || '').getTime();
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) {
    return null;
  }
  return Math.round((endedAt - startedAt) / 1000);
}
