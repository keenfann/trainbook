import { resolveTargetRepsValue } from '../../workout-flow.js';

export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
export const PRIMARY_MUSCLE_OPTIONS = [
  'abdominals',
  'abductors',
  'adductors',
  'biceps',
  'calves',
  'chest',
  'forearms',
  'glutes',
  'hamstrings',
  'lats',
  'lower back',
  'middle back',
  'neck',
  'quadriceps',
  'shoulders',
  'traps',
  'triceps',
];
export const EQUIPMENT_TYPES = [
  'Ab wheel',
  'Band',
  'Barbell',
  'Bodyweight',
  'Dumbbell',
  'Kettlebell',
  'Weight vest',
  'Weight plate',
];
export const BASE_EQUIPMENT_TYPES = EQUIPMENT_TYPES.filter((equipment) => equipment !== 'Band');
export const TARGET_SET_OPTIONS = ['1', '2', '3'];
export const TARGET_REP_MIN_OPTIONS = Array.from({ length: 50 }, (_, index) => `${index + 1}`);
export const TARGET_REP_MAX_OPTIONS = Array.from({ length: 60 }, (_, index) => `${index + 1}`);
export const ROUTINE_BAND_OPTIONS = [
  'Red',
  'Orange',
  '10 lb',
  '20 lb',
  '30 lb',
  '40 lb',
  '50 lb',
  '60 lb',
];
export const ROUTINE_REST_OPTIONS = [
  { value: '45', label: '00:45' },
  { value: '60', label: '01:00' },
  { value: '90', label: '01:30' },
  { value: '120', label: '02:00' },
  { value: '180', label: '03:00' },
];
export const ROUTINE_REST_OPTION_VALUES = ROUTINE_REST_OPTIONS.map((option) => option.value);
export const DEFAULT_TARGET_REST_SECONDS = '60';
export const DEFAULT_TARGET_SETS = '2';
export const DEFAULT_TARGET_REPS_MIN = '8';
export const DEFAULT_TARGET_REPS_MAX = '12';
export const SESSION_BAND_OPTIONS = ROUTINE_BAND_OPTIONS.map((bandLabel) => ({
  id: bandLabel,
  name: bandLabel,
}));
export const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const SET_CELEBRATION_MS = 520;
export const EXERCISE_CELEBRATION_MS = 520;
export const PROGRESS_PULSE_MS = 420;
export const REDUCED_MOTION_FEEDBACK_MS = 120;
export const TARGET_WEIGHT_MIN = 0.5;
export const TARGET_WEIGHT_STEP_DEFAULT = 1;
export const TARGET_WEIGHT_STEP_BARBELL = 2.5;
export const TARGET_WEIGHT_STATUS_CLEAR_MS = 1800;
export const ROUTINE_TYPES = ['standard', 'rehab'];

export const LOCALE = 'sv-SE';
export const APP_ROUTE_ORDER = {
  '/workout': 0,
  '/log': 0,
  '/routines': 1,
  '/exercises': 2,
  '/stats': 3,
  '/settings': 4,
};

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

export function resolveExerciseImageUrl(relativePath) {
  const normalized = String(relativePath || '').trim();
  if (!normalized) return '';
  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (normalized.startsWith('/')) return normalized;
  return `https://raw.githubusercontent.com/keenfann/free-exercise-db/main/exercises/${normalized}`;
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(LOCALE, {
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(LOCALE, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatNumber(value) {
  if (value === null || value === undefined) return '—';
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return '—';
  return numberValue.toLocaleString(LOCALE, { maximumFractionDigits: 1 });
}

export function buildLinearTrendline(points, key) {
  if (!Array.isArray(points) || points.length < 2) {
    return Array.isArray(points) ? points.map(() => null) : [];
  }

  const samples = points
    .map((point, index) => {
      const value = Number(point?.[key]);
      return Number.isFinite(value) ? { x: index, y: value } : null;
    })
    .filter(Boolean);

  if (samples.length < 2) {
    return points.map(() => null);
  }

  const n = samples.length;
  const sumX = samples.reduce((sum, sample) => sum + sample.x, 0);
  const sumY = samples.reduce((sum, sample) => sum + sample.y, 0);
  const sumXX = samples.reduce((sum, sample) => sum + sample.x * sample.x, 0);
  const sumXY = samples.reduce((sum, sample) => sum + sample.x * sample.y, 0);
  const denominator = n * sumXX - sumX * sumX;
  if (!denominator) {
    return points.map(() => null);
  }

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  return points.map((_, index) => Number((slope * index + intercept).toFixed(2)));
}

export function buildMovingAverage(points, key, windowSize = 7) {
  if (!Array.isArray(points) || points.length === 0) return [];
  const normalizedWindow = Math.max(2, Number(windowSize || 7));
  return points.map((_, index) => {
    const start = index - normalizedWindow + 1;
    if (start < 0) return null;
    const window = points.slice(start, index + 1);
    const values = window
      .map((point) => Number(point?.[key]))
      .filter((value) => Number.isFinite(value));
    if (values.length < normalizedWindow) return null;
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    return Number(average.toFixed(2));
  });
}

export function formatExerciseImpact(impact) {
  if (!impact) return 'Impact unavailable.';
  return `${impact.routineReferences} routine links (${impact.routineUsers} users), ${impact.setReferences} logged sets (${impact.setUsers} users)`;
}

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

export function formatRestTime(targetRestSeconds) {
  const totalSeconds = Number(targetRestSeconds);
  if (!Number.isInteger(totalSeconds) || totalSeconds <= 0) return null;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatDurationSeconds(value) {
  const totalSeconds = Number(value);
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return null;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

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

export function resolveTargetWeightSaveStatusLabel(status) {
  if (status === 'pending') return 'Save on finish';
  if (status === 'saving') return 'Saving';
  if (status === 'saved') return 'Saved';
  if (status === 'queued') return 'Queued offline';
  if (status === 'failed') return 'Failed';
  return null;
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

export const WARMUP_STEP_ID = '__warmup__';
export const WARMUP_STEP_NAME = 'Warmup';

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

export function formatSessionDetailExerciseStateLabel(state) {
  if (state === 'completed') return 'Completed';
  if (state === 'in_progress') return 'In progress';
  return 'Skipped';
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

export function formatDurationMinutes(value) {
  const totalMinutes = Number(value);
  if (!Number.isFinite(totalMinutes) || totalMinutes < 0) return '—';
  const rounded = Math.round(totalMinutes);
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (!hours) return `${minutes}m`;
  if (!minutes) return `${hours}h`;
  return `${hours}h ${minutes}m`;
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

export function resolveTopLevelPath(pathname) {
  if (!pathname || pathname === '/') return '/workout';
  const firstSegment = String(pathname)
    .split('/')
    .filter(Boolean)[0];
  const normalized = `/${firstSegment || 'workout'}`;
  return Object.prototype.hasOwnProperty.call(APP_ROUTE_ORDER, normalized) ? normalized : '/workout';
}

export function resolveRouteOrder(pathname) {
  return APP_ROUTE_ORDER[resolveTopLevelPath(pathname)] ?? 0;
}
