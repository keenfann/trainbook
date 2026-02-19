export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
export const APP_RELEASED_AT = typeof __APP_RELEASED_AT__ !== 'undefined' ? __APP_RELEASED_AT__ : '';

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

export const WARMUP_STEP_ID = '__warmup__';
export const WARMUP_STEP_NAME = 'Warmup';
