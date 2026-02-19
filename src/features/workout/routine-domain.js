import {
  DEFAULT_TARGET_REPS_MAX,
  DEFAULT_TARGET_REPS_MIN,
  DEFAULT_TARGET_REST_SECONDS,
  DEFAULT_TARGET_SETS,
  ROUTINE_BAND_OPTIONS,
  ROUTINE_REST_OPTIONS,
  ROUTINE_TYPES,
} from './constants.js';
import { resolveSessionExerciseKey } from './session-keys.js';

export function normalizeRoutineType(value, fallback = 'standard') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  return ROUTINE_TYPES.includes(normalized) ? normalized : fallback;
}

export function formatRoutineTypeLabel(value) {
  return normalizeRoutineType(value) === 'rehab' ? 'Rehab' : 'Standard';
}

export function normalizeRoutineForUi(routine) {
  if (!routine || typeof routine !== 'object') return routine;
  return {
    ...routine,
    routineType: normalizeRoutineType(routine.routineType),
  };
}

export function normalizeExercisePrimaryMuscles(exercise) {
  if (Array.isArray(exercise?.primaryMuscles) && exercise.primaryMuscles.length) {
    return exercise.primaryMuscles.filter(Boolean);
  }
  return [];
}

export function formatMuscleLabel(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function normalizeExerciseMetadataList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

export function formatInstructionsForTextarea(instructions) {
  if (Array.isArray(instructions)) {
    return instructions.filter(Boolean).join('\n');
  }
  return typeof instructions === 'string' ? instructions : '';
}

export function parseInstructionsFromTextarea(value) {
  const lines = String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const seen = new Set();
  return lines.filter((line) => {
    if (seen.has(line)) return false;
    seen.add(line);
    return true;
  });
}

export function resolveTargetRepBounds(targetReps, targetRepsRange) {
  if (targetRepsRange) {
    const strictMatch = String(targetRepsRange).match(/^(\d+)\s*-\s*(\d+)$/);
    const looseMatch = strictMatch || String(targetRepsRange).match(/(\d+)\D+(\d+)/);
    if (looseMatch) {
      const minValue = Number(looseMatch[1]);
      const maxValue = Number(looseMatch[2]);
      if (Number.isInteger(minValue) && Number.isInteger(maxValue) && minValue >= 1 && minValue <= 50 && maxValue <= 60 && maxValue >= minValue) {
        return { min: String(minValue), max: String(maxValue) };
      }
    }
  }
  if (targetReps !== null && targetReps !== undefined) {
    const repsValue = Number(targetReps);
    if (Number.isInteger(repsValue) && repsValue >= 1 && repsValue <= 50) {
      const repsText = String(repsValue);
      return { min: repsText, max: repsText };
    }
  }
  return { min: DEFAULT_TARGET_REPS_MIN, max: DEFAULT_TARGET_REPS_MAX };
}

export function resolveAutoTargetRepMax(minValue) {
  const normalizedMin = Number(minValue);
  if (!Number.isInteger(normalizedMin) || normalizedMin < 1 || normalizedMin > 50) {
    return DEFAULT_TARGET_REPS_MAX;
  }
  return String(Math.min(60, normalizedMin + 4));
}

export function resolveRoutineRestOptionValue(targetRestSeconds) {
  const totalSeconds = Number(targetRestSeconds);
  const optionSeconds = ROUTINE_REST_OPTIONS.map((option) => Number(option.value));
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return DEFAULT_TARGET_REST_SECONDS;
  }
  const closest = optionSeconds.reduce((best, current) => (
    Math.abs(current - totalSeconds) < Math.abs(best - totalSeconds) ? current : best
  ), optionSeconds[0]);
  return String(closest);
}

export function createRoutineEditorItem({
  editorId,
  position = 0,
  targetRestSeconds = DEFAULT_TARGET_REST_SECONDS,
} = {}) {
  return {
    editorId,
    exerciseId: '',
    equipment: '',
    targetSets: DEFAULT_TARGET_SETS,
    targetRepsMin: DEFAULT_TARGET_REPS_MIN,
    targetRepsMax: DEFAULT_TARGET_REPS_MAX,
    targetRestSeconds,
    targetWeight: '',
    targetBandLabel: '',
    notes: '',
    position,
    supersetGroup: null,
    pairWithNext: false,
  };
}

export function encodeRoutineEquipmentValue(equipment, targetBandLabel) {
  if (!equipment) return '';
  if (equipment === 'Band') {
    const bandLabel = targetBandLabel || ROUTINE_BAND_OPTIONS[0];
    return `band:${bandLabel}`;
  }
  return `equipment:${equipment}`;
}

export function decodeRoutineEquipmentValue(value) {
  if (!value) {
    return { equipment: '', targetBandLabel: '' };
  }
  if (value.startsWith('band:')) {
    return {
      equipment: 'Band',
      targetBandLabel: value.slice('band:'.length) || ROUTINE_BAND_OPTIONS[0],
    };
  }
  if (value.startsWith('equipment:')) {
    return {
      equipment: value.slice('equipment:'.length),
      targetBandLabel: '',
    };
  }
  if (value === 'Band') {
    return { equipment: 'Band', targetBandLabel: ROUTINE_BAND_OPTIONS[0] };
  }
  return { equipment: value, targetBandLabel: '' };
}

export function normalizeSupersetGroup(value) {
  if (!value) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

export function buildSupersetPartnerLookup(exercises) {
  const byGroup = new Map();
  const partnerByExerciseId = new Map();
  (exercises || []).forEach((exercise) => {
    const group = normalizeSupersetGroup(exercise?.supersetGroup);
    if (!group) return;
    if (!byGroup.has(group)) {
      byGroup.set(group, []);
    }
    byGroup.get(group).push(exercise);
  });
  byGroup.forEach((groupExercises) => {
    if (groupExercises.length !== 2) return;
    const [a, b] = groupExercises;
    const aKey = resolveSessionExerciseKey(a);
    const bKey = resolveSessionExerciseKey(b);
    if (!aKey || !bKey) return;
    partnerByExerciseId.set(aKey, b);
    partnerByExerciseId.set(bKey, a);
  });
  return partnerByExerciseId;
}

export function buildWorkoutPreviewBlocks(exercises) {
  const source = Array.isArray(exercises) ? exercises : [];
  const blocks = [];
  for (let index = 0; index < source.length; index += 1) {
    const item = source[index];
    const group = normalizeSupersetGroup(item?.supersetGroup);
    const hasPairNext = Boolean(
      group
      && normalizeSupersetGroup(source[index + 1]?.supersetGroup) === group
    );
    const endIndex = hasPairNext ? index + 1 : index;
    blocks.push({
      startIndex: index,
      endIndex,
      isSuperset: hasPairNext,
    });
    if (hasPairNext) {
      index += 1;
    }
  }
  return blocks;
}
