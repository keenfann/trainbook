import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import {
  FaArrowDown,
  FaArrowUp,
  FaCheck,
  FaCircleInfo,
  FaCopy,
  FaFlagCheckered,
  FaForwardStep,
  FaListUl,
  FaPenToSquare,
  FaStop,
  FaTrashCan,
  FaXmark,
} from 'react-icons/fa6';
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiFetch } from './api.js';
import { getChartAnimationConfig, getDirectionalPageVariants, getMotionConfig } from './motion.js';
import { useMotionPreferences } from './motion-preferences.jsx';
import { formatDaysAgoLabel, formatElapsedSince, formatRoutineLastUsedDaysAgo } from './date-labels.js';
import {
  buildChecklistRows,
  buildMissingSetPayloads,
  formatReadinessError,
  resolveExerciseStartAt,
  resolveTargetRepsValue,
  validateWorkoutReadiness,
} from './workout-flow.js';

const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
const PRIMARY_MUSCLE_OPTIONS = [
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
const EQUIPMENT_TYPES = [
  'Ab wheel',
  'Band',
  'Barbell',
  'Bodyweight',
  'Dumbbell',
  'Kettlebell',
  'Weight vest',
  'Weight plate',
];
const BASE_EQUIPMENT_TYPES = EQUIPMENT_TYPES.filter((equipment) => equipment !== 'Band');
const TARGET_SET_OPTIONS = ['1', '2', '3'];
const TARGET_REP_MIN_OPTIONS = Array.from({ length: 50 }, (_, index) => `${index + 1}`);
const TARGET_REP_MAX_OPTIONS = Array.from({ length: 60 }, (_, index) => `${index + 1}`);
const ROUTINE_BAND_OPTIONS = [
  'Red',
  'Orange',
  '10 lb',
  '20 lb',
  '30 lb',
  '40 lb',
  '50 lb',
  '60 lb',
];
const ROUTINE_REST_OPTIONS = [
  { value: '45', label: '00:45' },
  { value: '60', label: '01:00' },
  { value: '90', label: '01:30' },
  { value: '120', label: '02:00' },
  { value: '180', label: '03:00' },
];
const ROUTINE_REST_OPTION_VALUES = ROUTINE_REST_OPTIONS.map((option) => option.value);
const DEFAULT_TARGET_REST_SECONDS = '60';
const DEFAULT_TARGET_SETS = '2';
const DEFAULT_TARGET_REPS_MIN = '8';
const DEFAULT_TARGET_REPS_MAX = '12';
const SESSION_BAND_OPTIONS = ROUTINE_BAND_OPTIONS.map((bandLabel) => ({
  id: bandLabel,
  name: bandLabel,
}));
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const SET_CELEBRATION_MS = 520;
const EXERCISE_CELEBRATION_MS = 520;
const PROGRESS_PULSE_MS = 420;
const REDUCED_MOTION_FEEDBACK_MS = 120;
const ROUTINE_TYPES = ['standard', 'rehab'];

const LOCALE = 'sv-SE';
const APP_ROUTE_ORDER = {
  '/workout': 0,
  '/log': 0,
  '/routines': 1,
  '/exercises': 2,
  '/stats': 3,
  '/settings': 4,
};

function normalizeRoutineType(value, fallback = 'standard') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  return ROUTINE_TYPES.includes(normalized) ? normalized : fallback;
}

function formatRoutineTypeLabel(value) {
  return normalizeRoutineType(value) === 'rehab' ? 'Rehab' : 'Standard';
}

function normalizeRoutineForUi(routine) {
  if (!routine || typeof routine !== 'object') return routine;
  return {
    ...routine,
    routineType: normalizeRoutineType(routine.routineType),
  };
}

function normalizeExercisePrimaryMuscles(exercise) {
  if (Array.isArray(exercise?.primaryMuscles) && exercise.primaryMuscles.length) {
    return exercise.primaryMuscles.filter(Boolean);
  }
  return [];
}

function formatMuscleLabel(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeExerciseMetadataList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function formatInstructionsForTextarea(instructions) {
  if (Array.isArray(instructions)) {
    return instructions.filter(Boolean).join('\n');
  }
  return typeof instructions === 'string' ? instructions : '';
}

function parseInstructionsFromTextarea(value) {
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

function resolveExerciseImageUrl(relativePath) {
  const normalized = String(relativePath || '').trim();
  if (!normalized) return '';
  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (normalized.startsWith('/')) return normalized;
  return `https://raw.githubusercontent.com/keenfann/free-exercise-db/main/exercises/${normalized}`;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(LOCALE, {
    month: 'short',
    day: 'numeric',
  });
}

function formatDateTime(value) {
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

function formatNumber(value) {
  if (value === null || value === undefined) return '—';
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return '—';
  return numberValue.toLocaleString(LOCALE, { maximumFractionDigits: 1 });
}

function buildLinearTrendline(points, key) {
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

function buildMovingAverage(points, key, windowSize = 7) {
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

function formatExerciseImpact(impact) {
  if (!impact) return 'Impact unavailable.';
  return `${impact.routineReferences} routine links (${impact.routineUsers} users), ${impact.setReferences} logged sets (${impact.setUsers} users)`;
}

function buildSessionSummary(detail) {
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
  };
}

function resolveTargetRepBounds(targetReps, targetRepsRange) {
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

function resolveAutoTargetRepMax(minValue) {
  const normalizedMin = Number(minValue);
  if (!Number.isInteger(normalizedMin) || normalizedMin < 1 || normalizedMin > 50) {
    return DEFAULT_TARGET_REPS_MAX;
  }
  return String(Math.min(60, normalizedMin + 4));
}

function resolveRoutineRestOptionValue(targetRestSeconds) {
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

function createRoutineEditorItem({
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

function formatRestTime(targetRestSeconds) {
  const totalSeconds = Number(targetRestSeconds);
  if (!Number.isInteger(totalSeconds) || totalSeconds <= 0) return null;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatDurationSeconds(value) {
  const totalSeconds = Number(value);
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return null;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function resolveSessionDurationSeconds(session) {
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

const WARMUP_STEP_ID = '__warmup__';
const WARMUP_STEP_NAME = 'Warmup';

function resolveDurationSeconds(startedAt, endedAt) {
  const startedMs = new Date(startedAt || '').getTime();
  const endedMs = new Date(endedAt || '').getTime();
  if (!Number.isFinite(startedMs) || !Number.isFinite(endedMs) || endedMs < startedMs) {
    return null;
  }
  return Math.round((endedMs - startedMs) / 1000);
}

function createWarmupStep(warmupStartedAt = null, warmupCompletedAt = null) {
  return {
    exerciseId: WARMUP_STEP_ID,
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

function countSessionTrainedExercises(session) {
  return (session?.exercises || []).filter((exercise) => (
    exercise?.status === 'completed'
    || (exercise?.sets || []).length > 0
  )).length;
}

function formatDurationMinutes(value) {
  const totalMinutes = Number(value);
  if (!Number.isFinite(totalMinutes) || totalMinutes < 0) return '—';
  const rounded = Math.round(totalMinutes);
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (!hours) return `${minutes}m`;
  if (!minutes) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function encodeRoutineEquipmentValue(equipment, targetBandLabel) {
  if (!equipment) return '';
  if (equipment === 'Band') {
    const bandLabel = targetBandLabel || ROUTINE_BAND_OPTIONS[0];
    return `band:${bandLabel}`;
  }
  return `equipment:${equipment}`;
}

function decodeRoutineEquipmentValue(value) {
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

function normalizeSupersetGroup(value) {
  if (!value) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function buildSupersetPartnerLookup(exercises) {
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
    if (!a?.exerciseId || !b?.exerciseId) return;
    partnerByExerciseId.set(a.exerciseId, b);
    partnerByExerciseId.set(b.exerciseId, a);
  });
  return partnerByExerciseId;
}

function buildWorkoutPreviewBlocks(exercises) {
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

function resolveTopLevelPath(pathname) {
  if (!pathname || pathname === '/') return '/workout';
  const firstSegment = String(pathname)
    .split('/')
    .filter(Boolean)[0];
  const normalized = `/${firstSegment || 'workout'}`;
  return Object.prototype.hasOwnProperty.call(APP_ROUTE_ORDER, normalized) ? normalized : '/workout';
}

function resolveRouteOrder(pathname) {
  return APP_ROUTE_ORDER[resolveTopLevelPath(pathname)] ?? 0;
}

function AnimatedNavLink({ to, children }) {
  const { resolvedReducedMotion } = useMotionPreferences();
  const motionConfig = useMemo(
    () => getMotionConfig(resolvedReducedMotion),
    [resolvedReducedMotion]
  );
  return (
    <NavLink to={to} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
      {({ isActive }) => (
        <span className="nav-link-inner">
          <AnimatePresence>
            {isActive ? (
              <motion.span
                layoutId="primary-nav-active-pill"
                className="nav-link-active-bg"
                transition={motionConfig.transition.springSoft}
              />
            ) : null}
          </AnimatePresence>
          <motion.span
            className="nav-link-label"
            whileTap={resolvedReducedMotion ? undefined : { scale: motionConfig.tapScale }}
            transition={motionConfig.transition.fast}
          >
            {children}
          </motion.span>
        </span>
      )}
    </NavLink>
  );
}

function AnimatedModal({ onClose, panelClassName = '', children }) {
  const { resolvedReducedMotion } = useMotionPreferences();
  const motionConfig = useMemo(
    () => getMotionConfig(resolvedReducedMotion),
    [resolvedReducedMotion]
  );
  return (
    <motion.div
      className="modal-backdrop"
      variants={motionConfig.variants.modalBackdrop}
      initial="hidden"
      animate="visible"
      exit="exit"
      onClick={() => onClose?.()}
    >
      <motion.div
        className={`modal-panel ${panelClassName}`.trim()}
        variants={motionConfig.variants.modalPanel}
        initial="hidden"
        animate="visible"
        exit="exit"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [logoutError, setLogoutError] = useState(null);

  const handleLogout = async () => {
    setLogoutError(null);
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      setLogoutError(err.message);
    } finally {
      setUser(null);
    }
  };

  useEffect(() => {
    let active = true;
    apiFetch('/api/auth/me')
      .then((data) => {
        if (!active) return;
        setUser(data.user);
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setError(err.message);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="auth-layout">
        <div className="auth-card">Loading Trainbook…</div>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={<AuthPage mode="login" onAuth={setUser} />}
      />
      <Route
        path="/register"
        element={<AuthPage mode="register" onAuth={setUser} />}
      />
      <Route
        path="/*"
        element={
          <RequireAuth user={user}>
            <AppShell user={user} onLogout={handleLogout} error={logoutError || error} />
          </RequireAuth>
        }
      />
    </Routes>
  );
}

function RequireAuth({ user, children }) {
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function AppShell({ user, onLogout, error }) {
  const location = useLocation();
  const { resolvedReducedMotion } = useMotionPreferences();
  const motionConfig = useMemo(
    () => getMotionConfig(resolvedReducedMotion),
    [resolvedReducedMotion]
  );
  const pageTransitionVariants = useMemo(
    () => getDirectionalPageVariants(resolvedReducedMotion),
    [resolvedReducedMotion]
  );
  const [routeDirection, setRouteDirection] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [syncState, setSyncState] = useState({
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    queueSize: 0,
    syncing: false,
    lastError: null,
  });
  const previousRouteOrderRef = useRef(resolveRouteOrder(location.pathname));

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onSyncState = (event) => {
      setSyncState((previous) => ({
        ...previous,
        ...(event.detail || {}),
      }));
    };
    const onOnline = () => {
      setSyncState((previous) => ({ ...previous, online: true }));
    };
    const onOffline = () => {
      setSyncState((previous) => ({ ...previous, online: false }));
    };
    window.addEventListener('trainbook:sync-state', onSyncState);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('trainbook:sync-state', onSyncState);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    const previousOrder = previousRouteOrderRef.current;
    const nextOrder = resolveRouteOrder(location.pathname);
    if (nextOrder === previousOrder) {
      setRouteDirection(0);
    } else {
      setRouteDirection(nextOrder > previousOrder ? 1 : -1);
    }
    previousRouteOrderRef.current = nextOrder;
    setMenuOpen(false);
  }, [location.pathname]);

  const showSyncBanner =
    !syncState.online || syncState.syncing || syncState.queueSize > 0 || Boolean(syncState.lastError);
  const syncMessage = !syncState.online
    ? 'Offline mode: changes are queued on this device.'
    : syncState.syncing
      ? `Syncing ${syncState.queueSize} queued changes…`
      : syncState.queueSize > 0
        ? `${syncState.queueSize} changes queued for sync.`
        : syncState.lastError
          ? syncState.lastError
          : null;
  const pageKey = resolveTopLevelPath(location.pathname);

  return (
    <div className="app-shell" onClick={() => menuOpen && setMenuOpen(false)}>
      <header className="app-header">
        <div className="app-header-inner">
          <div className="inline">
            <div className="brand-group">
              <img src="/logo.png" alt="Trainbook logo" className="brand-logo" />
              <div className="brand">Trainbook</div>
            </div>
            <span className={`tag ${syncState.online ? '' : 'sync-tag-offline'}`}>
              {syncState.online ? 'Online' : 'Offline'}
            </span>
          </div>
          <div className="header-menu">
            <motion.button
              type="button"
              className="header-chip"
              whileHover={
                resolvedReducedMotion
                  ? undefined
                  : { y: motionConfig.hoverLiftY, scale: motionConfig.hoverScale }
              }
              whileTap={resolvedReducedMotion ? undefined : { scale: motionConfig.tapScale }}
              transition={motionConfig.transition.fast}
              onClick={(event) => {
                event.stopPropagation();
                setMenuOpen((prev) => !prev);
              }}
            >
              {user?.username}
            </motion.button>
            <AnimatePresence>
              {menuOpen ? (
                <motion.div
                  className="menu-panel"
                  variants={motionConfig.variants.scaleIn}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  onClick={(event) => event.stopPropagation()}
                >
                  <NavLink className="menu-item" to="/settings" onClick={() => setMenuOpen(false)}>
                    Settings
                  </NavLink>
                  <button
                    type="button"
                    className="menu-item"
                    onClick={() => {
                      setMenuOpen(false);
                      onLogout();
                    }}
                  >
                    Log out
                  </button>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </div>
        <AnimatePresence initial={false}>
          {showSyncBanner && syncMessage ? (
            <motion.div
              className={`sync-banner ${syncState.lastError ? 'sync-banner-error' : ''}`}
              variants={motionConfig.variants.fadeUp}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              {syncMessage}
            </motion.div>
          ) : null}
        </AnimatePresence>
        <nav className="navbar">
          <LayoutGroup id="primary-nav">
            <AnimatedNavLink to="/workout">Workout</AnimatedNavLink>
            <AnimatedNavLink to="/routines">Routines</AnimatedNavLink>
            <AnimatedNavLink to="/exercises">Exercises</AnimatedNavLink>
            <AnimatedNavLink to="/stats">Stats</AnimatedNavLink>
          </LayoutGroup>
        </nav>
      </header>

      <main className="page">
        <AnimatePresence initial={false}>
          {error ? (
            <motion.div
              className="notice"
              variants={motionConfig.variants.fadeUp}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              {error}
            </motion.div>
          ) : null}
        </AnimatePresence>
        <AnimatePresence mode="wait" initial={false} custom={routeDirection}>
          <motion.div
            key={pageKey}
            className="page-transition-shell"
            custom={routeDirection}
            variants={pageTransitionVariants}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <Routes location={location}>
              <Route path="/" element={<Navigate to="/workout" replace />} />
              <Route path="/workout" element={<LogPage />} />
              <Route path="/log" element={<Navigate to="/workout" replace />} />
              <Route path="/routines" element={<RoutinesPage />} />
              <Route path="/exercises" element={<ExercisesPage />} />
              <Route path="/stats" element={<StatsPage />} />
              <Route path="/settings" element={<SettingsPage user={user} onLogout={onLogout} />} />
            </Routes>
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

function AuthPage({ mode, onAuth }) {
  const navigate = useNavigate();
  const { resolvedReducedMotion } = useMotionPreferences();
  const motionConfig = useMemo(
    () => getMotionConfig(resolvedReducedMotion),
    [resolvedReducedMotion]
  );
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const isLogin = mode === 'login';

  const onSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await apiFetch(`/api/auth/${isLogin ? 'login' : 'register'}`,
        {
          method: 'POST',
          body: JSON.stringify({ username, password }),
        }
      );
      onAuth(data.user);
      navigate('/workout');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-layout">
      <motion.form
        className="auth-card"
        onSubmit={onSubmit}
        variants={motionConfig.variants.scaleIn}
        initial="hidden"
        animate="visible"
      >
        <div className="auth-title">{isLogin ? 'Welcome back' : 'Create account'}</div>
        <p className="muted">
          {isLogin
            ? 'Log in to keep training momentum.'
            : 'Start logging workouts and watch progress stack up.'}
        </p>
        <AnimatePresence initial={false}>
          {error ? (
            <motion.div
              className="notice"
              variants={motionConfig.variants.fadeUp}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              {error}
            </motion.div>
          ) : null}
        </AnimatePresence>
        <div className="stack">
          <div>
            <label htmlFor="username">Username</label>
            <input
              id="username"
              className="input"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="e.g. coach"
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className="input"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Minimum 6 characters"
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              required
            />
          </div>
          <button className="button" type="submit" disabled={loading}>
            {loading ? 'Working…' : isLogin ? 'Log in' : 'Create account'}
          </button>
          <button
            type="button"
            className="button ghost"
            onClick={() => navigate(isLogin ? '/register' : '/login')}
          >
            {isLogin ? 'Need an account? Sign up' : 'Already have an account? Log in'}
          </button>
        </div>
      </motion.form>
    </div>
  );
}

function LogPage() {
  const { resolvedReducedMotion } = useMotionPreferences();
  const motionConfig = useMemo(
    () => getMotionConfig(resolvedReducedMotion),
    [resolvedReducedMotion]
  );
  const [routines, setRoutines] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [weights, setWeights] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [weightInput, setWeightInput] = useState('');
  const [sessionNotesInput, setSessionNotesInput] = useState('');
  const [recentlyDeletedSet, setRecentlyDeletedSet] = useState(null);
  const [sessionDetail, setSessionDetail] = useState(null);
  const [sessionDetailLoading, setSessionDetailLoading] = useState(false);
  const [expandedDetailExercises, setExpandedDetailExercises] = useState([]);
  const [sessionMode, setSessionMode] = useState('preview');
  const [currentExerciseId, setCurrentExerciseId] = useState(null);
  const [exerciseDetailExerciseId, setExerciseDetailExerciseId] = useState(null);
  const [setChecklistByExerciseId, setSetChecklistByExerciseId] = useState({});
  const [setRepsByExerciseId, setSetRepsByExerciseId] = useState({});
  const [workoutPreviewOpen, setWorkoutPreviewOpen] = useState(false);
  const [finishConfirmOpen, setFinishConfirmOpen] = useState(false);
  const [isExerciseTransitioning, setIsExerciseTransitioning] = useState(false);
  const [celebratingSetKeys, setCelebratingSetKeys] = useState({});
  const [celebratingExerciseIds, setCelebratingExerciseIds] = useState({});
  const [isProgressPulsing, setIsProgressPulsing] = useState(false);
  const finishExerciseInFlightRef = useRef(false);
  const setCelebrationTimersRef = useRef(new Map());
  const exerciseCelebrationTimersRef = useRef(new Map());
  const progressPulseTimerRef = useRef(null);
  const previousWorkoutProgressCountRef = useRef(0);

  const clearSetCelebrationTimeout = (key) => {
    const timer = setCelebrationTimersRef.current.get(key);
    if (!timer) return;
    clearTimeout(timer);
    setCelebrationTimersRef.current.delete(key);
  };

  const clearExerciseCelebrationTimeout = (key) => {
    const timer = exerciseCelebrationTimersRef.current.get(key);
    if (!timer) return;
    clearTimeout(timer);
    exerciseCelebrationTimersRef.current.delete(key);
  };

  const clearProgressPulseTimeout = () => {
    if (!progressPulseTimerRef.current) return;
    clearTimeout(progressPulseTimerRef.current);
    progressPulseTimerRef.current = null;
  };

  const clearAllCelebrationTimers = () => {
    setCelebrationTimersRef.current.forEach((timer) => clearTimeout(timer));
    setCelebrationTimersRef.current.clear();
    exerciseCelebrationTimersRef.current.forEach((timer) => clearTimeout(timer));
    exerciseCelebrationTimersRef.current.clear();
    clearProgressPulseTimeout();
  };

  useEffect(() => (
    () => {
      clearAllCelebrationTimers();
    }
  ), []);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [routineData, sessionData, sessionList, weightData] =
        await Promise.all([
          apiFetch('/api/routines'),
          apiFetch('/api/sessions/active'),
          apiFetch('/api/sessions?limit=15'),
          apiFetch('/api/weights?limit=6'),
        ]);
      setRoutines((routineData.routines || []).map((routine) => normalizeRoutineForUi(routine)));
      setActiveSession(sessionData.session || null);
      setSessions((sessionList.sessions || []).filter((session) => Number(session?.totalSets || 0) > 0));
      setWeights(weightData.weights || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleSyncComplete = () => {
      refresh();
    };
    window.addEventListener('trainbook:sync-complete', handleSyncComplete);
    return () => {
      window.removeEventListener('trainbook:sync-complete', handleSyncComplete);
    };
  }, []);

  useEffect(() => {
    setSessionNotesInput(activeSession?.notes || '');
  }, [activeSession?.id, activeSession?.notes]);

  useEffect(() => {
    if (!recentlyDeletedSet) return undefined;
    const timer = setTimeout(() => {
      setRecentlyDeletedSet(null);
    }, 5000);
    return () => clearTimeout(timer);
  }, [recentlyDeletedSet]);

  const sessionExercises = useMemo(() => {
    if (!activeSession) return [];
    const shouldIncludeWarmup = normalizeRoutineType(activeSession.routineType) === 'standard';
    const fromSession = (activeSession.exercises || [])
      .map((exercise, index) => ({
        ...exercise,
        position: Number.isFinite(exercise.position) ? Number(exercise.position) : index,
        supersetGroup: normalizeSupersetGroup(exercise.supersetGroup),
        sets: (() => {
          const seen = new Set();
          return [...(exercise.sets || [])]
            .filter((set, setIndex) => {
              const setKey = set?.id !== null && set?.id !== undefined
                ? `id:${set.id}`
                : `fallback:${set?.setIndex ?? 'na'}:${set?.createdAt || set?.completedAt || setIndex}`;
              if (seen.has(setKey)) return false;
              seen.add(setKey);
              return true;
            })
            .sort((a, b) => Number(a.setIndex) - Number(b.setIndex));
        })(),
        targetRestSeconds:
          exercise.targetRestSeconds === null || exercise.targetRestSeconds === undefined
            ? null
            : Number(exercise.targetRestSeconds),
      }))
      .sort((a, b) => a.position - b.position);
    if (fromSession.length) {
      if (!shouldIncludeWarmup) return fromSession;
      const derivedWarmupStartedAt = activeSession.warmupStartedAt || activeSession.startedAt || null;
      const hasTrackedExerciseProgress = fromSession.some((exercise) => (
        exercise.status === 'in_progress'
        || exercise.status === 'completed'
        || Boolean(exercise.startedAt)
        || Boolean(exercise.completedAt)
        || (exercise.sets || []).length > 0
      ));
      const derivedWarmupCompletedAt = activeSession.warmupCompletedAt
        || (hasTrackedExerciseProgress ? derivedWarmupStartedAt : null);
      const warmupStep = createWarmupStep(derivedWarmupStartedAt, derivedWarmupCompletedAt);
      return [warmupStep, ...fromSession];
    }
    const routine = routines.find((item) => item.id === activeSession.routineId);
    if (!routine) return [];
    const routineExercises = (routine.exercises || []).map((exercise, index) => ({
      exerciseId: exercise.exerciseId,
      name: exercise.name,
      equipment: exercise.equipment || null,
      targetSets: exercise.targetSets,
      targetReps: exercise.targetReps,
      targetRepsRange: exercise.targetRepsRange || null,
      targetWeight: exercise.targetWeight,
      targetBandLabel: exercise.targetBandLabel || null,
      notes: exercise.notes || null,
      supersetGroup: normalizeSupersetGroup(exercise.supersetGroup),
      targetRestSeconds:
        exercise.targetRestSeconds === null || exercise.targetRestSeconds === undefined
          ? null
          : Number(exercise.targetRestSeconds),
      status: 'pending',
      position: Number.isFinite(exercise.position) ? Number(exercise.position) : index,
      sets: [],
    }));
    if (!shouldIncludeWarmup) return routineExercises;
    const derivedWarmupStartedAt = activeSession.warmupStartedAt || activeSession.startedAt || null;
    const derivedWarmupCompletedAt = activeSession.warmupCompletedAt || null;
    const warmupStep = createWarmupStep(derivedWarmupStartedAt, derivedWarmupCompletedAt);
    return [warmupStep, ...routineExercises];
  }, [activeSession, routines]);

  const currentExercise = useMemo(() => {
    if (!sessionExercises.length) return null;
    if (currentExerciseId !== null) {
      const match = sessionExercises.find((exercise) => exercise.exerciseId === currentExerciseId);
      if (match) return match;
    }
    const inProgress = sessionExercises.find((exercise) => exercise.status === 'in_progress');
    if (inProgress) return inProgress;
    return sessionExercises.find((exercise) => exercise.status !== 'completed') || sessionExercises[0];
  }, [sessionExercises, currentExerciseId]);

  const supersetPartnerByExerciseId = useMemo(
    () => buildSupersetPartnerLookup(sessionExercises),
    [sessionExercises]
  );
  const currentSupersetPartner = useMemo(() => {
    if (!currentExercise) return null;
    return supersetPartnerByExerciseId.get(currentExercise.exerciseId) || null;
  }, [currentExercise, supersetPartnerByExerciseId]);
  const detailExercise = useMemo(() => (
    sessionExercises.find((exercise) => exercise.exerciseId === exerciseDetailExerciseId) || null
  ), [sessionExercises, exerciseDetailExerciseId]);

  useEffect(() => {
    if (exerciseDetailExerciseId === null) return;
    const exists = sessionExercises.some((exercise) => exercise.exerciseId === exerciseDetailExerciseId);
    if (!exists) {
      setExerciseDetailExerciseId(null);
    }
  }, [exerciseDetailExerciseId, sessionExercises]);

  useEffect(() => {
    if (!activeSession) {
      clearAllCelebrationTimers();
      setSessionMode('preview');
      setCurrentExerciseId(null);
      setExerciseDetailExerciseId(null);
      setSetChecklistByExerciseId({});
      setSetRepsByExerciseId({});
      setWorkoutPreviewOpen(false);
      setFinishConfirmOpen(false);
      setCelebratingSetKeys({});
      setCelebratingExerciseIds({});
      setIsProgressPulsing(false);
      previousWorkoutProgressCountRef.current = 0;
      return;
    }
    const hasProgress = (activeSession.exercises || []).some(
      (exercise) =>
        exercise.status === 'in_progress'
        || exercise.status === 'completed'
        || (exercise.sets || []).length > 0
    );
    setSessionMode(hasProgress ? 'workout' : 'preview');
    const prioritized = (activeSession.exercises || []).find((exercise) => exercise.status === 'in_progress')
      || (activeSession.exercises || []).find((exercise) => exercise.status !== 'completed')
      || (activeSession.exercises || [])[0]
      || null;
    setCurrentExerciseId(prioritized ? prioritized.exerciseId : null);
  }, [activeSession?.id]);

  useEffect(() => {
    if (sessionMode !== 'workout') {
      setWorkoutPreviewOpen(false);
    }
  }, [sessionMode]);

  useEffect(() => {
    if (!activeSession) return;
    const validExerciseIds = new Set(sessionExercises.map((exercise) => exercise.exerciseId));
    setSetChecklistByExerciseId((prev) => {
      const next = {};
      Object.entries(prev || {}).forEach(([exerciseId, checklist]) => {
        if (validExerciseIds.has(Number(exerciseId))) {
          next[exerciseId] = checklist;
        }
      });
      return next;
    });
    setSetRepsByExerciseId((prev) => {
      const next = {};
      Object.entries(prev || {}).forEach(([exerciseId, repsBySetIndex]) => {
        if (validExerciseIds.has(Number(exerciseId))) {
          next[exerciseId] = repsBySetIndex;
        }
      });
      return next;
    });
  }, [activeSession, sessionExercises]);

  const handleStartSession = async (routineId) => {
    setError(null);
    if (!Number.isFinite(Number(routineId))) {
      setError('Select a routine before starting a workout.');
      return;
    }
    try {
      const payload = {
        routineId: Number(routineId),
      };
      const data = await apiFetch('/api/sessions', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setActiveSession(data.session);
      setSessionMode('preview');
      setCurrentExerciseId(null);
      setSetChecklistByExerciseId({});
      setSetRepsByExerciseId({});
    } catch (err) {
      setError(err.message);
    }
  };

  const mergeExerciseProgressIntoSession = (session, progress) => {
    if (!session || !progress) return session;
    return {
      ...session,
      exercises: (session.exercises || []).map((exercise) => (
        exercise.exerciseId === progress.exerciseId
          ? {
              ...exercise,
              status: progress.status || exercise.status,
              startedAt: progress.startedAt || exercise.startedAt,
              completedAt: progress.completedAt || exercise.completedAt,
              durationSeconds:
                progress.durationSeconds === null || progress.durationSeconds === undefined
                  ? exercise.durationSeconds
                  : progress.durationSeconds,
            }
          : exercise
      )),
    };
  };

  const handleEndSession = async (force = false) => {
    if (!activeSession) return;
    if (!force && pendingExercises.length > 0) {
      setFinishConfirmOpen(true);
      return;
    }
    setError(null);
    try {
      const data = await apiFetch(`/api/sessions/${activeSession.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          endedAt: new Date().toISOString(),
          warmupStartedAt: activeSession.warmupStartedAt || null,
          warmupCompletedAt: activeSession.warmupCompletedAt || null,
        }),
      });
      const endedSession = data?.session ? buildSessionSummary(data.session) : null;
      setActiveSession(null);
      setSessions((prev) => {
        const next = prev.filter((session) => session.id !== activeSession.id);
        if (Number(endedSession?.totalSets || 0) > 0) {
          return [endedSession, ...next];
        }
        return next;
      });
      setFinishConfirmOpen(false);
      setSessionDetail(endedSession || null);
      setExpandedDetailExercises([]);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCancelSession = async () => {
    if (!activeSession) return;
    setError(null);
    try {
      await apiFetch(`/api/sessions/${activeSession.id}`, {
        method: 'DELETE',
      });
      setActiveSession(null);
      setFinishConfirmOpen(false);
      setSessionDetail(null);
      setExpandedDetailExercises([]);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleStartExercise = async (exerciseId) => {
    if (!activeSession) return null;
    setError(null);
    try {
      const data = await apiFetch(`/api/sessions/${activeSession.id}/exercises/${exerciseId}/start`, {
        method: 'POST',
        body: JSON.stringify({ startedAt: new Date().toISOString() }),
      });
      setActiveSession((prev) => mergeExerciseProgressIntoSession(prev, data.exerciseProgress));
      setCurrentExerciseId(exerciseId);
      return data.exerciseProgress || null;
    } catch (err) {
      setError(err.message);
      return null;
    }
  };

  const handleCompleteExercise = async (exerciseId, completedAt = new Date().toISOString()) => {
    if (!activeSession) return null;
    setError(null);
    try {
      const data = await apiFetch(`/api/sessions/${activeSession.id}/exercises/${exerciseId}/complete`, {
        method: 'POST',
        body: JSON.stringify({ completedAt }),
      });
      setActiveSession((prev) => mergeExerciseProgressIntoSession(prev, data.exerciseProgress));
      return data.exerciseProgress || null;
    } catch (err) {
      setError(err.message);
      return null;
    }
  };

  const resolveIsExerciseCompleted = (exercise) => {
    if (!exercise) return true;
    if (exercise.status === 'completed') return true;
    const targetSets = Number(exercise.targetSets);
    if (Number.isInteger(targetSets) && targetSets > 0) {
      return (exercise.sets || []).length >= targetSets;
    }
    return false;
  };

  const resolveNextPendingExercise = (currentExerciseToComplete, additionallyCompletedExerciseIds = []) => {
    if (!currentExerciseToComplete) return null;
    const completedExerciseIds = new Set(
      [currentExerciseToComplete.exerciseId, ...additionallyCompletedExerciseIds]
        .filter((exerciseId) => Number.isFinite(Number(exerciseId)))
        .map((exerciseId) => Number(exerciseId))
    );
    const pending = sessionExercises
      .filter((exercise) => (
        !completedExerciseIds.has(Number(exercise.exerciseId))
        && !resolveIsExerciseCompleted(exercise)
      ))
      .sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
    if (!pending.length) return null;
    const partner = supersetPartnerByExerciseId.get(currentExerciseToComplete.exerciseId) || null;
    if (
      partner
      && !completedExerciseIds.has(Number(partner.exerciseId))
      && pending.some((exercise) => exercise.exerciseId === partner.exerciseId)
    ) {
      return partner;
    }
    const currentPosition = Number(currentExerciseToComplete.position || 0);
    return pending.find((exercise) => Number(exercise.position || 0) > currentPosition) || pending[0];
  };

  const clearLocalChecklistForExercise = (exerciseId) => {
    setSetChecklistByExerciseId((prev) => {
      if (!prev || !Object.prototype.hasOwnProperty.call(prev, exerciseId)) return prev;
      const next = { ...prev };
      delete next[exerciseId];
      return next;
    });
  };

  const clearLocalSetRepsForExercise = (exerciseId) => {
    setSetRepsByExerciseId((prev) => {
      if (!prev || !Object.prototype.hasOwnProperty.call(prev, exerciseId)) return prev;
      const next = { ...prev };
      delete next[exerciseId];
      return next;
    });
  };

  const resolveSelectedSetReps = (exerciseId, setIndex, fallbackReps) => {
    const selected = Number(setRepsByExerciseId?.[String(exerciseId)]?.[setIndex]);
    if (Number.isInteger(selected) && selected > 0) return selected;
    const fallback = Number(fallbackReps);
    if (Number.isInteger(fallback) && fallback > 0) return fallback;
    return null;
  };

  const handleSetRepsChange = (exerciseId, setIndex, value) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 60) return;
    const exerciseKey = String(exerciseId);
    setSetRepsByExerciseId((prev) => ({
      ...(prev || {}),
      [exerciseKey]: {
        ...(prev?.[exerciseKey] || {}),
        [setIndex]: parsed,
      },
    }));
  };

  const triggerSetCelebration = (exerciseId, setIndex) => {
    const key = `${exerciseId}:${setIndex}`;
    clearSetCelebrationTimeout(key);
    setCelebratingSetKeys((prev) => ({
      ...prev,
      [key]: true,
    }));
    const duration = resolvedReducedMotion ? REDUCED_MOTION_FEEDBACK_MS : SET_CELEBRATION_MS;
    const timer = setTimeout(() => {
      setCelebratingSetKeys((prev) => {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setCelebrationTimersRef.current.delete(key);
    }, duration);
    setCelebrationTimersRef.current.set(key, timer);
  };

  const clearSetCelebration = (exerciseId, setIndex) => {
    const key = `${exerciseId}:${setIndex}`;
    clearSetCelebrationTimeout(key);
    setCelebratingSetKeys((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const triggerExerciseCelebration = (exerciseId) => {
    const key = String(exerciseId);
    clearExerciseCelebrationTimeout(key);
    setCelebratingExerciseIds((prev) => ({
      ...prev,
      [key]: true,
    }));
    const duration = resolvedReducedMotion ? REDUCED_MOTION_FEEDBACK_MS : EXERCISE_CELEBRATION_MS;
    const timer = setTimeout(() => {
      setCelebratingExerciseIds((prev) => {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      exerciseCelebrationTimersRef.current.delete(key);
    }, duration);
    exerciseCelebrationTimersRef.current.set(key, timer);
  };

  const handleToggleSetChecklist = (exerciseId, setIndex) => {
    if (exerciseId === WARMUP_STEP_ID) return;
    const exerciseKey = String(exerciseId);
    const currentChecklist = { ...(setChecklistByExerciseId?.[exerciseKey] || {}) };
    if (currentChecklist[setIndex]) {
      delete currentChecklist[setIndex];
      clearSetCelebration(exerciseId, setIndex);
    } else {
      currentChecklist[setIndex] = new Date().toISOString();
      triggerSetCelebration(exerciseId, setIndex);
    }
    const checklistOverridesByExerciseId = {
      [exerciseKey]: currentChecklist,
    };
    setSetChecklistByExerciseId((prev) => ({
      ...(prev || {}),
      [exerciseKey]: currentChecklist,
    }));

    if (!currentExercise) return;
    if (resolveIsExerciseCompleted(currentExercise)) return;
    const currentExerciseKey = String(currentExercise.exerciseId);
    const currentSupersetPair = supersetPartnerByExerciseId.get(currentExercise.exerciseId) || null;
    const isToggleOnCurrent = exerciseKey === currentExerciseKey;
    const isToggleOnCurrentPair = Boolean(
      currentSupersetPair && String(currentSupersetPair.exerciseId) === exerciseKey
    );
    if (!isToggleOnCurrent && !isToggleOnCurrentPair) return;

    const currentRows = buildChecklistRows(
      currentExercise,
      checklistOverridesByExerciseId[currentExerciseKey]
      || setChecklistByExerciseId[currentExerciseKey]
      || {}
    );
    const currentAllSetsDone = currentRows.length > 0 && currentRows.every((row) => row.checked);
    if (!currentAllSetsDone) return;

    if (currentSupersetPair && !resolveIsExerciseCompleted(currentSupersetPair)) {
      const partnerExerciseKey = String(currentSupersetPair.exerciseId);
      const partnerRows = buildChecklistRows(
        currentSupersetPair,
        checklistOverridesByExerciseId[partnerExerciseKey]
        || setChecklistByExerciseId[partnerExerciseKey]
        || {}
      );
      const partnerAllSetsDone = partnerRows.length > 0 && partnerRows.every((row) => row.checked);
      if (!partnerAllSetsDone) return;
    }
    void handleFinishExercise({ checklistOverridesByExerciseId });
  };

  const handleCompleteWarmupStep = async () => {
    if (!activeSession || normalizeRoutineType(activeSession.routineType) !== 'standard') return false;
    const completedAt = new Date().toISOString();
    setActiveSession((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        warmupStartedAt: prev.warmupStartedAt || prev.startedAt || completedAt,
        warmupCompletedAt: completedAt,
      };
    });
    return true;
  };

  const handleBeginWorkout = async () => {
    const readiness = validateWorkoutReadiness(
      sessionExercises.filter((exercise) => !exercise.isWarmupStep)
    );
    if (!readiness.valid) {
      setError(formatReadinessError(readiness.issues));
      return;
    }
    const first = sessionExercises.find((exercise) => !resolveIsExerciseCompleted(exercise));
    if (!first) return;
    setCurrentExerciseId(first.exerciseId);
    setSessionMode('workout');
  };

  const handleFinishExercise = async ({ checklistOverridesByExerciseId = {} } = {}) => {
    if (!activeSession || !currentExercise) return;
    if (currentExercise.exerciseId === WARMUP_STEP_ID) {
      const done = await handleCompleteWarmupStep();
      if (!done) return;
      const nextExercise = resolveNextPendingExercise(currentExercise);
      if (nextExercise) {
        const started = await handleStartExercise(nextExercise.exerciseId);
        if (!started) return;
        setCurrentExerciseId(nextExercise.exerciseId);
        return;
      }
      await handleEndSession(true);
      return;
    }
    if (finishExerciseInFlightRef.current) return;
    finishExerciseInFlightRef.current = true;
    setIsExerciseTransitioning(true);
    try {
      const currentSupersetPair = supersetPartnerByExerciseId.get(currentExercise.exerciseId) || null;
      const isFinalPendingSupersetPair = Boolean(
        currentSupersetPair
        && !resolveIsExerciseCompleted(currentSupersetPair)
        && !resolveNextPendingExercise(currentExercise, [currentSupersetPair.exerciseId])
      );
      const partnerRowsAllDone = (() => {
        if (!currentSupersetPair || resolveIsExerciseCompleted(currentSupersetPair)) return false;
        const partnerExerciseKey = String(currentSupersetPair.exerciseId);
        const partnerChecklist =
          checklistOverridesByExerciseId[partnerExerciseKey]
          || setChecklistByExerciseId[partnerExerciseKey]
          || {};
        const partnerRows = buildChecklistRows(currentSupersetPair, partnerChecklist);
        return partnerRows.length > 0 && partnerRows.every((row) => row.checked);
      })();
      const shouldCompleteSupersetPairInline = Boolean(
        currentSupersetPair
        && !resolveIsExerciseCompleted(currentSupersetPair)
        && (isFinalPendingSupersetPair || partnerRowsAllDone)
      );
      const nextExercise = resolveNextPendingExercise(
        currentExercise,
        shouldCompleteSupersetPairInline ? [currentSupersetPair.exerciseId] : []
      );

      const finishedAt = new Date().toISOString();
      const startAt = resolveExerciseStartAt(currentExercise, finishedAt);
      const currentExerciseKey = String(currentExercise.exerciseId);
      const localChecklist =
        checklistOverridesByExerciseId[currentExerciseKey]
        || setChecklistByExerciseId[currentExerciseKey]
        || {};
      const missingSetPayloads = buildMissingSetPayloads({
        exercise: currentExercise,
        checkedAtBySetIndex: localChecklist,
        exerciseStartedAt: startAt,
        exerciseFinishedAt: finishedAt,
        defaultBandLabel: SESSION_BAND_OPTIONS[0]?.name || null,
      });

      for (const payload of missingSetPayloads) {
        const reps = resolveSelectedSetReps(
          currentExercise.exerciseId,
          payload.setIndex,
          payload.reps
        );
        if (!Number.isInteger(reps) || reps <= 0) return;
        const saved = await handleAddSet(
          currentExercise.exerciseId,
          reps,
          payload.weight,
          payload.bandLabel,
          payload.startedAt,
          payload.completedAt
        );
        if (!saved) return;
      }

      const completed = await handleCompleteExercise(currentExercise.exerciseId, finishedAt);
      if (!completed) return;
      triggerExerciseCelebration(currentExercise.exerciseId);
      clearLocalChecklistForExercise(currentExercise.exerciseId);
      clearLocalSetRepsForExercise(currentExercise.exerciseId);

      if (shouldCompleteSupersetPairInline && currentSupersetPair) {
        const partnerFinishedAt = new Date().toISOString();
        const partnerStartAt = resolveExerciseStartAt(currentSupersetPair, partnerFinishedAt);
        const partnerExerciseKey = String(currentSupersetPair.exerciseId);
        const partnerChecklist =
          checklistOverridesByExerciseId[partnerExerciseKey]
          || setChecklistByExerciseId[partnerExerciseKey]
          || {};
        const partnerMissingSetPayloads = buildMissingSetPayloads({
          exercise: currentSupersetPair,
          checkedAtBySetIndex: partnerChecklist,
          exerciseStartedAt: partnerStartAt,
          exerciseFinishedAt: partnerFinishedAt,
          defaultBandLabel: SESSION_BAND_OPTIONS[0]?.name || null,
        });

        for (const payload of partnerMissingSetPayloads) {
          const reps = resolveSelectedSetReps(
            currentSupersetPair.exerciseId,
            payload.setIndex,
            payload.reps
          );
          if (!Number.isInteger(reps) || reps <= 0) return;
          const saved = await handleAddSet(
            currentSupersetPair.exerciseId,
            reps,
            payload.weight,
            payload.bandLabel,
            payload.startedAt,
            payload.completedAt
          );
          if (!saved) return;
        }

        const partnerCompleted = await handleCompleteExercise(
          currentSupersetPair.exerciseId,
          partnerFinishedAt
        );
        if (!partnerCompleted) return;
        triggerExerciseCelebration(currentSupersetPair.exerciseId);
        clearLocalChecklistForExercise(currentSupersetPair.exerciseId);
        clearLocalSetRepsForExercise(currentSupersetPair.exerciseId);
      }

      if (nextExercise) {
        const started = await handleStartExercise(nextExercise.exerciseId);
        if (!started) return;
        setCurrentExerciseId(nextExercise.exerciseId);
        return;
      }

      await handleEndSession(true);
    } finally {
      finishExerciseInFlightRef.current = false;
      setIsExerciseTransitioning(false);
    }
  };

  const handleSkipExercise = async () => {
    if (!activeSession || !currentExercise || currentExercise.exerciseId === WARMUP_STEP_ID) return;
    setIsExerciseTransitioning(true);
    const currentSupersetPair = supersetPartnerByExerciseId.get(currentExercise.exerciseId) || null;
    const shouldSkipSupersetPair = Boolean(
      currentSupersetPair && !resolveIsExerciseCompleted(currentSupersetPair)
    );
    try {
      const completedAt = new Date().toISOString();
      const nextExercise = resolveNextPendingExercise(
        currentExercise,
        shouldSkipSupersetPair && currentSupersetPair ? [currentSupersetPair.exerciseId] : []
      );
      const completed = await handleCompleteExercise(currentExercise.exerciseId, completedAt);
      if (!completed) return;
      triggerExerciseCelebration(currentExercise.exerciseId);
      clearLocalChecklistForExercise(currentExercise.exerciseId);
      clearLocalSetRepsForExercise(currentExercise.exerciseId);
      if (shouldSkipSupersetPair && currentSupersetPair) {
        const partnerCompleted = await handleCompleteExercise(
          currentSupersetPair.exerciseId,
          completedAt
        );
        if (!partnerCompleted) return;
        triggerExerciseCelebration(currentSupersetPair.exerciseId);
        clearLocalChecklistForExercise(currentSupersetPair.exerciseId);
        clearLocalSetRepsForExercise(currentSupersetPair.exerciseId);
      }
      if (nextExercise) {
        const started = await handleStartExercise(nextExercise.exerciseId);
        if (!started) return;
        setCurrentExerciseId(nextExercise.exerciseId);
        return;
      }
      await handleEndSession(true);
    } finally {
      setIsExerciseTransitioning(false);
    }
  };

  const handleAddSet = async (
    exerciseId,
    reps,
    weight,
    bandLabel = null,
    startedAt = null,
    completedAt = null
  ) => {
    if (!activeSession) return;
    setError(null);
    try {
      const data = await apiFetch(`/api/sessions/${activeSession.id}/sets`, {
        method: 'POST',
        body: JSON.stringify({
          exerciseId,
          reps,
          weight,
          bandLabel,
          startedAt,
          completedAt,
        }),
      });
      setActiveSession((prev) => {
        if (!prev) return prev;
        const nextExercises = [...(prev.exercises || [])];
        const matchIndex = nextExercises.findIndex(
          (exercise) => exercise.exerciseId === exerciseId
        );
        if (matchIndex === -1) {
          nextExercises.push({
            exerciseId,
            name: 'Exercise',
            equipment: null,
            sets: [data.set],
          });
        } else {
          const existing = nextExercises[matchIndex];
          const existingSets = existing.sets || [];
          const mergedSets = data.set?.id !== null && data.set?.id !== undefined
            ? [...existingSets.filter((set) => set.id !== data.set.id), data.set]
            : [...existingSets, data.set];
          nextExercises[matchIndex] = {
            ...existing,
            sets: mergedSets,
          };
        }
        const merged = { ...prev, exercises: nextExercises };
        return mergeExerciseProgressIntoSession(merged, data.exerciseProgress || null);
      });
      setRecentlyDeletedSet(null);
      return data;
    } catch (err) {
      setError(err.message);
      return null;
    }
  };

  const handleUpdateSet = async (setId, reps, weight, bandLabel = null) => {
    if (!activeSession) return;
    setError(null);
    try {
      const data = await apiFetch(`/api/sets/${setId}`, {
        method: 'PUT',
        body: JSON.stringify({ reps, weight, bandLabel }),
      });
      setActiveSession((prev) => {
        if (!prev) return prev;
        const nextExercises = (prev.exercises || []).map((exercise) => ({
          ...exercise,
          sets: (exercise.sets || []).map((set) =>
            set.id === setId ? { ...set, ...data.set } : set
          ),
        }));
        return { ...prev, exercises: nextExercises };
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteSet = async (setId) => {
    if (!activeSession) return;
    setError(null);
    let deletedSetPayload = null;
    try {
      activeSession.exercises?.forEach((exercise) => {
        const found = (exercise.sets || []).find((set) => set.id === setId);
        if (found) {
          deletedSetPayload = {
            exerciseId: exercise.exerciseId,
            set: found,
            exerciseName: exercise.name,
          };
        }
      });
      await apiFetch(`/api/sets/${setId}`, { method: 'DELETE' });
      setActiveSession((prev) => {
        if (!prev) return prev;
        const nextExercises = (prev.exercises || []).map((exercise) => ({
          ...exercise,
          sets: (exercise.sets || []).filter((set) => set.id !== setId),
        }));
        return { ...prev, exercises: nextExercises };
      });
      if (deletedSetPayload) {
        setRecentlyDeletedSet(deletedSetPayload);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleUndoDeleteSet = async () => {
    if (!recentlyDeletedSet) return;
    const payload = recentlyDeletedSet;
    setRecentlyDeletedSet(null);
    await handleAddSet(
      payload.exerciseId,
      payload.set.reps,
      payload.set.weight,
      payload.set.bandLabel || null,
      payload.set.startedAt || null,
      payload.set.completedAt || payload.set.createdAt || null
    );
  };

  const handleSaveSessionDetails = async () => {
    if (!activeSession) return;
    setError(null);
    try {
      const data = await apiFetch(`/api/sessions/${activeSession.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          notes: sessionNotesInput,
        }),
      });
      setActiveSession(data.session);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleViewSessionDetail = async (sessionId) => {
    setSessionDetailLoading(true);
    setSessionDetail(null);
    setError(null);
    setExpandedDetailExercises([]);
    try {
      const data = await apiFetch(`/api/sessions/${sessionId}`);
      setSessionDetail(data.session || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSessionDetailLoading(false);
    }
  };

  const toggleDetailExercise = (exerciseKey) => {
    setExpandedDetailExercises((prev) => (
      prev.includes(exerciseKey)
        ? prev.filter((key) => key !== exerciseKey)
        : [...prev, exerciseKey]
    ));
  };

  const closeSessionDetail = () => {
    if (sessionDetailLoading) return;
    setSessionDetail(null);
    setExpandedDetailExercises([]);
  };

  const openExerciseDetail = (exerciseId) => {
    if (exerciseId === WARMUP_STEP_ID) return;
    if (!Number.isFinite(Number(exerciseId))) return;
    setExerciseDetailExerciseId(Number(exerciseId));
  };

  const closeExerciseDetail = () => {
    setExerciseDetailExerciseId(null);
  };

  const handleAddWeight = async () => {
    const value = Number(weightInput);
    if (!Number.isFinite(value)) {
      setError('Enter a valid weight.');
      return;
    }
    setError(null);
    try {
      const data = await apiFetch('/api/weights', {
        method: 'POST',
        body: JSON.stringify({ weight: value }),
      });
      setWeights((prev) => [data.entry, ...prev].slice(0, 6));
      setWeightInput('');
    } catch (err) {
      setError(err.message);
    }
  };

  const resolveChecklistRows = (exercise) => {
    if (!exercise) return [];
    const localChecklist = setChecklistByExerciseId[String(exercise.exerciseId)] || {};
    return buildChecklistRows(exercise, localChecklist);
  };
  const visibleWorkoutExercises = useMemo(() => {
    if (!currentExercise) return [];
    if (!currentSupersetPartner || resolveIsExerciseCompleted(currentSupersetPartner)) {
      return [currentExercise];
    }
    return [currentExercise, currentSupersetPartner];
  }, [currentExercise, currentSupersetPartner]);
  const showSharedGuidedSupersetPill = visibleWorkoutExercises.length > 1;
  const pendingExercises = useMemo(
    () => sessionExercises.filter((exercise) => !resolveIsExerciseCompleted(exercise)),
    [sessionExercises]
  );
  const currentIsCompleted = resolveIsExerciseCompleted(currentExercise);
  const currentSupersetPartnerIsPending = Boolean(
    sessionMode === 'workout'
    && currentExercise
    && !currentIsCompleted
    && currentSupersetPartner
    && !resolveIsExerciseCompleted(currentSupersetPartner)
  );
  const isCurrentSupersetFinalPendingBlock = Boolean(
    currentSupersetPartnerIsPending
    && pendingExercises.length === 2
    && pendingExercises.some((exercise) => exercise.exerciseId === currentExercise.exerciseId)
    && pendingExercises.some((exercise) => exercise.exerciseId === currentSupersetPartner.exerciseId)
  );
  const canInlineCompleteCurrentSupersetPair = Boolean(
    currentSupersetPartnerIsPending
    && (
      isCurrentSupersetFinalPendingBlock
      || (() => {
        const partnerRows = resolveChecklistRows(currentSupersetPartner);
        return partnerRows.length > 0 && partnerRows.every((row) => row.checked);
      })()
    )
  );
  const nextPendingExerciseAfterPrimaryAction = (
    currentExercise && !currentIsCompleted
      ? resolveNextPendingExercise(
        currentExercise,
        canInlineCompleteCurrentSupersetPair ? [currentSupersetPartner.exerciseId] : []
      )
      : null
  );
  const shouldPrimaryActionFinishWorkout = (
    sessionMode === 'workout'
    && currentExercise
    && !currentIsCompleted
    && !nextPendingExerciseAfterPrimaryAction
  );
  const previewExercises = useMemo(
    () => sessionExercises.filter((exercise) => !exercise.isWarmupStep),
    [sessionExercises]
  );
  const workoutPreviewBlocks = useMemo(
    () => buildWorkoutPreviewBlocks(previewExercises),
    [previewExercises]
  );
  const renderExerciseTargetBadges = (
    exercise,
    {
      includeSets = false,
      includeRest = false,
      showSupersetBadge = false,
    } = {}
  ) => (
    <>
      {exercise.targetWeight ? <span className="badge">{exercise.targetWeight} kg</span> : null}
      {includeSets && exercise.targetSets ? <span className="badge">{exercise.targetSets} sets</span> : null}
      {exercise.targetRepsRange ? <span className="badge">{exercise.targetRepsRange} reps</span> : null}
      {!exercise.targetRepsRange && exercise.targetReps ? <span className="badge">{exercise.targetReps} reps</span> : null}
      {exercise.targetBandLabel ? <span className="badge">{exercise.targetBandLabel}</span> : null}
      {includeRest && exercise.targetRestSeconds ? <span className="badge">Rest {formatRestTime(exercise.targetRestSeconds)}</span> : null}
      {showSupersetBadge ? <span className="badge badge-superset">Superset</span> : null}
    </>
  );
  const renderWorkoutPreviewRow = (
    exercise,
    index,
    {
      rowKey = `${exercise.exerciseId}-${exercise.position ?? index}-${index}`,
      grouped = false,
      showSupersetBadge = false,
    } = {}
  ) => {
    const exerciseNotes = typeof exercise.notes === 'string'
      ? exercise.notes.trim()
      : '';
    return (
      <div
        key={rowKey}
        className={`set-row workout-preview-row${grouped ? ' workout-preview-row-grouped' : ''}`}
      >
        <div>
          <div>{`${index + 1}. ${exercise.isWarmupStep ? exercise.name : [exercise.equipment, exercise.name].filter(Boolean).join(' ')}`}</div>
          <div className="inline workout-preview-row-badges">
            {renderExerciseTargetBadges(exercise, {
              includeSets: true,
              showSupersetBadge,
            })}
          </div>
          {exerciseNotes ? <div className="muted">Notes: {exerciseNotes}</div> : null}
        </div>
      </div>
    );
  };
  const renderWorkoutPreviewList = (keyPrefix) => (
    <div className="stack">
      {workoutPreviewBlocks.map((block) => {
        const blockItems = previewExercises.slice(block.startIndex, block.endIndex + 1);
        if (!block.isSuperset) {
          const exercise = blockItems[0];
          return renderWorkoutPreviewRow(exercise, block.startIndex, {
            rowKey: `${keyPrefix}-${exercise.exerciseId}-${block.startIndex}`,
            grouped: false,
            showSupersetBadge: Boolean(supersetPartnerByExerciseId.get(exercise.exerciseId)),
          });
        }
        const blockKey = `${keyPrefix}-superset-${blockItems.map((item) => item.exerciseId).join('-')}-${block.startIndex}`;
        return (
          <div key={blockKey} className="workout-preview-superset-block">
            <div className="inline workout-preview-superset-header">
              <span className="badge badge-superset">Superset</span>
            </div>
            <div className="stack workout-preview-superset-items">
              {blockItems.map((exercise, offset) =>
                renderWorkoutPreviewRow(exercise, block.startIndex + offset, {
                  rowKey: `${blockKey}-${exercise.exerciseId}-${offset}`,
                  grouped: true,
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  const latestWeightLoggedAt = useMemo(() => {
    let latest = null;
    weights.forEach((entry) => {
      const timestamp = new Date(entry.measuredAt).getTime();
      if (!Number.isFinite(timestamp)) return;
      if (latest === null || timestamp > latest) {
        latest = timestamp;
      }
    });
    return latest;
  }, [weights]);
  const shouldPromptWeightLog =
    latestWeightLoggedAt === null || Date.now() - latestWeightLoggedAt > ONE_WEEK_MS;
  const detailPrimaryMuscles = normalizeExerciseMetadataList(detailExercise?.primaryMuscles);
  const detailSecondaryMuscles = normalizeExerciseMetadataList(detailExercise?.secondaryMuscles);
  const detailInstructions = normalizeExerciseMetadataList(detailExercise?.instructions);
  const detailImageUrl = resolveExerciseImageUrl(detailExercise?.images?.[0]);
  const detailHasMetadata = Boolean(
    detailImageUrl
    || detailInstructions.length
    || detailExercise?.equipment
    || detailExercise?.category
    || detailExercise?.force
    || detailExercise?.level
    || detailExercise?.mechanic
    || detailPrimaryMuscles.length
    || detailSecondaryMuscles.length
  );
  const shouldHideWorkoutActionBar = (
    sessionMode === 'workout'
    && (workoutPreviewOpen || Boolean(detailExercise))
  );
  const isTrainingFocused = Boolean(activeSession && sessionMode === 'workout');
  const sessionDetailSummary = useMemo(
    () => buildSessionSummary(sessionDetail),
    [sessionDetail]
  );
  const sessionDetailDurationSeconds = resolveSessionDurationSeconds(sessionDetailSummary);
  const sessionDetailWarmupDurationSeconds = (
    Number.isFinite(Number(sessionDetailSummary?.warmupDurationSeconds))
    && Number(sessionDetailSummary?.warmupDurationSeconds) >= 0
  )
    ? Math.round(Number(sessionDetailSummary.warmupDurationSeconds))
    : null;
  const sessionDetailExerciseTotal = (sessionDetailSummary?.exercises || []).length;
  const sessionDetailExerciseCount = countSessionTrainedExercises(sessionDetailSummary);
  const workoutHeaderTitle = sessionMode === 'workout' && activeSession
    ? (activeSession.routineName || activeSession.name || 'Workout')
    : "Today's workout";
  const workoutNotes = typeof activeSession?.notes === 'string'
    ? activeSession.notes.trim()
    : '';
  const workoutHeaderSubtitle = sessionMode === 'workout' && activeSession
    ? (workoutNotes || null)
    : 'Log fast, stay in flow, keep the lift going.';
  const progressExercises = useMemo(
    () => sessionExercises.filter((exercise) => !exercise.isWarmupStep),
    [sessionExercises]
  );
  const workoutExerciseTotal = sessionMode === 'workout' ? progressExercises.length : 0;
  const workoutExerciseCompletedCount = useMemo(
    () => progressExercises.filter((exercise) => resolveIsExerciseCompleted(exercise)).length,
    [progressExercises]
  );
  const workoutExerciseCurrentCount = (
    sessionMode === 'workout'
    && currentExercise
    && !currentExercise.isWarmupStep
    && !resolveIsExerciseCompleted(currentExercise)
  ) ? 1 : 0;
  const workoutExerciseSupersetCompanionCount = isCurrentSupersetFinalPendingBlock ? 1 : 0;
  const workoutExerciseProgressCount = workoutExerciseTotal > 0
    ? Math.min(
      workoutExerciseTotal,
      workoutExerciseCompletedCount + workoutExerciseCurrentCount + workoutExerciseSupersetCompanionCount
    )
    : 0;
  const isWorkoutFullyCompleted = (
    workoutExerciseTotal > 0
    && workoutExerciseCompletedCount >= workoutExerciseTotal
  );
  const workoutExerciseProgressPercent = workoutExerciseTotal > 0
    ? Math.min(100, Math.max(0, (workoutExerciseProgressCount / workoutExerciseTotal) * 100))
    : 0;

  useEffect(() => {
    if (sessionMode !== 'workout' || !activeSession) {
      clearProgressPulseTimeout();
      setIsProgressPulsing(false);
      previousWorkoutProgressCountRef.current = 0;
      return;
    }
    if (workoutExerciseProgressCount > previousWorkoutProgressCountRef.current) {
      clearProgressPulseTimeout();
      setIsProgressPulsing(true);
      const duration = resolvedReducedMotion ? REDUCED_MOTION_FEEDBACK_MS : PROGRESS_PULSE_MS;
      progressPulseTimerRef.current = setTimeout(() => {
        setIsProgressPulsing(false);
        progressPulseTimerRef.current = null;
      }, duration);
    }
    previousWorkoutProgressCountRef.current = workoutExerciseProgressCount;
  }, [
    sessionMode,
    activeSession?.id,
    workoutExerciseProgressCount,
    resolvedReducedMotion,
  ]);

  return (
    <motion.div
      className="stack"
      variants={motionConfig.variants.listStagger}
      initial="hidden"
      animate="visible"
    >
      <div>
        <div className={sessionMode === 'workout' ? 'workout-header-top-row' : ''}>
          <div className={sessionMode === 'workout' ? 'workout-header-content' : ''}>
            <h2 className="section-title">{workoutHeaderTitle}</h2>
            {workoutHeaderSubtitle ? <p className="muted">{workoutHeaderSubtitle}</p> : null}
          </div>
          {sessionMode === 'workout' && sessionExercises.length ? (
            <button
              className="button ghost icon-button workout-preview-launch-button"
              type="button"
              aria-label="Open workout exercises"
              title="Open workout exercises"
              onClick={() => setWorkoutPreviewOpen(true)}
            >
              <FaListUl aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {sessionMode === 'workout' && workoutExerciseTotal > 0 ? (
          <div className="workout-progress">
            <div className="workout-progress-meta muted">
              <span>Exercise progress</span>
              <span>{workoutExerciseProgressCount} / {workoutExerciseTotal}</span>
            </div>
            <div
              className={`workout-progress-track${isProgressPulsing ? ' workout-progress-track-pulse' : ''}`}
              role="progressbar"
              aria-label="Workout exercise progress"
              aria-valuemin={0}
              aria-valuemax={workoutExerciseTotal}
              aria-valuenow={workoutExerciseProgressCount}
              aria-valuetext={`${workoutExerciseProgressCount} of ${workoutExerciseTotal} exercises in progress or completed`}
            >
              <span
                className={`workout-progress-fill${isWorkoutFullyCompleted ? ' workout-progress-fill-complete' : ''}`}
                style={{ width: `${workoutExerciseProgressPercent}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>

      <AnimatePresence initial={false}>
        {error ? (
          <motion.div
            className="notice"
            variants={motionConfig.variants.fadeUp}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {error}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence mode="wait" initial={false}>
        {loading ? (
          <motion.div
            key="log-state-loading"
            className="card"
            variants={motionConfig.variants.fadeUp}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            Loading workout workspace…
          </motion.div>
        ) : activeSession ? (
        <motion.div
          key={`log-state-active-${activeSession.id || 'current'}`}
          className={`stack ${sessionMode === 'workout' ? 'workout-stack-with-floating-bar' : ''}`}
          variants={motionConfig.variants.fadeUp}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          {sessionMode !== 'workout' ? (
            <div className="card">
            <div className="split">
              <div>
                <div className="section-title">
                  {activeSession.routineName || 'Workout'}
                </div>
                <div className="muted">
                  Started {formatDateTime(activeSession.startedAt)}
                </div>
              </div>
              <div className="tag">Active</div>
            </div>
            <div style={{ marginTop: '0.8rem', marginBottom: '0.8rem' }}>
              <label>Workout notes</label>
              <div className="session-notes-row">
                <input
                  className="input"
                  value={sessionNotesInput}
                  onChange={(event) => setSessionNotesInput(event.target.value)}
                  placeholder="Notes for this workout"
                />
                <button
                  className="button ghost icon-button"
                  type="button"
                  aria-label="Save workout details"
                  title="Save workout details"
                  onClick={handleSaveSessionDetails}
                >
                  <FaCheck aria-hidden="true" />
                </button>
              </div>
            </div>
            </div>
          ) : null}

          <AnimatePresence mode="wait" initial={false}>
            {sessionMode === 'preview' ? (
              <motion.div
                key="workout-preview-card"
                className="card"
                variants={motionConfig.variants.fadeUp}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <div className="section-title">Exercises</div>
                {renderWorkoutPreviewList('session-preview')}
              </motion.div>
            ) : currentExercise ? (
              <motion.div
                key={`guided-workout-${currentExercise.exerciseId}-${currentSupersetPartner?.exerciseId || 'solo'}`}
                className="stack guided-workout-card-stack"
                variants={motionConfig.variants.fadeUp}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                {showSharedGuidedSupersetPill ? (
                  <div className="inline guided-workout-shared-pill">
                    <span className="badge badge-superset">Superset</span>
                  </div>
                ) : null}
                {visibleWorkoutExercises.map((exercise) => {
                  const isActiveCard = exercise.exerciseId === currentExercise.exerciseId;
                  const checklistRows = resolveChecklistRows(exercise);
                  const exerciseCelebrationKey = String(exercise.exerciseId);
                  const exerciseNotes = typeof exercise.notes === 'string'
                    ? exercise.notes.trim()
                    : '';
                  return (
                    <div
                      key={`guided-workout-card-${exercise.exerciseId}`}
                      className={
                        `card guided-workout-card`
                        + `${isActiveCard ? '' : ' guided-workout-card-paired'}`
                        + `${celebratingExerciseIds[exerciseCelebrationKey] ? ' guided-workout-card-celebrate' : ''}`
                      }
                    >
                      <div className="guided-workout-header">
                        <div className="section-title guided-workout-title">
                          {exercise.isWarmupStep ? exercise.name : [exercise.equipment, exercise.name].filter(Boolean).join(' ')}
                        </div>
                        {!exercise.isWarmupStep ? (
                          <button
                            className="button ghost icon-button guided-workout-info-button"
                            type="button"
                            aria-label={`Open exercise details for ${exercise.name}`}
                            title="Exercise details"
                            onClick={() => openExerciseDetail(exercise.exerciseId)}
                          >
                            <FaCircleInfo aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                      <div className="inline">
                        {renderExerciseTargetBadges(exercise, { includeRest: true })}
                      </div>
                      {exerciseNotes ? (
                        <div className="muted" style={{ marginTop: '0.6rem' }}>
                          Notes: {exerciseNotes}
                        </div>
                      ) : null}

                      <div className="set-list set-checklist" style={{ marginTop: '0.9rem' }}>
                        {exercise.isWarmupStep ? (
                          <div className="muted">Complete this warmup step before your first exercise.</div>
                        ) : checklistRows.length ? (
                          checklistRows.map((row) => {
                            const set = row.persistedSet;
                            const showSetRepsSelector = (
                              normalizeRoutineType(activeSession?.routineType) === 'standard'
                              && !exercise.isWarmupStep
                              && !row.locked
                            );
                            const targetReps = resolveTargetRepsValue(exercise);
                            const selectedSetReps = resolveSelectedSetReps(
                              exercise.exerciseId,
                              row.setIndex,
                              targetReps
                            );
                            const summary = set
                              ? (
                                exercise.equipment === 'Bodyweight'
                                  ? `${formatNumber(set.reps)} reps`
                                  : exercise.equipment === 'Band'
                                    ? `${set.bandLabel || exercise.targetBandLabel || 'Band'} × ${formatNumber(set.reps)} reps`
                                    : `${formatNumber(set.weight)} kg × ${formatNumber(set.reps)} reps`
                              )
                              : null;
                            const rowMetaText = isExerciseTransitioning ? '' : (summary || '');
                            const rowLocked = row.locked;
                            const statusLabel = row.locked ? 'Logged' : row.checked ? 'Done' : 'Queued';
                            const setCelebrationKey = `${exercise.exerciseId}:${row.setIndex}`;
                            return (
                              <div
                                key={`${exercise.exerciseId}-${row.setIndex}`}
                                className={
                                  `set-row guided-set-row set-checklist-row`
                                  + `${row.checked ? ' set-checklist-row-checked' : ''}`
                                  + `${rowLocked ? ' set-checklist-row-locked' : ''}`
                                  + `${celebratingSetKeys[setCelebrationKey] ? ' set-checklist-row-celebrate' : ''}`
                                }
                                role="button"
                                aria-label={`Toggle set ${row.setIndex} for ${exercise.name}`}
                                aria-pressed={row.checked}
                                aria-disabled={rowLocked}
                                tabIndex={rowLocked ? -1 : 0}
                                onClick={() => {
                                  if (rowLocked) return;
                                  handleToggleSetChecklist(exercise.exerciseId, row.setIndex);
                                }}
                                onKeyDown={(event) => {
                                  if (rowLocked) return;
                                  if (event.key !== 'Enter' && event.key !== ' ') return;
                                  event.preventDefault();
                                  handleToggleSetChecklist(exercise.exerciseId, row.setIndex);
                                }}
                              >
                                <span className="set-checklist-label">Set {row.setIndex}</span>
                                {showSetRepsSelector && Number.isInteger(selectedSetReps) ? (
                                  <div className="input-suffix-wrap guided-set-reps-field">
                                    <select
                                      className="input-suffix-select guided-set-reps-select"
                                      value={String(selectedSetReps)}
                                      onChange={(event) =>
                                        handleSetRepsChange(
                                          exercise.exerciseId,
                                          row.setIndex,
                                          event.target.value
                                        )}
                                      onClick={(event) => event.stopPropagation()}
                                      onKeyDown={(event) => event.stopPropagation()}
                                      aria-label={`Set ${row.setIndex} reps for ${exercise.name}`}
                                    >
                                      {TARGET_REP_MAX_OPTIONS.map((value) => (
                                        <option key={value} value={value}>
                                          {value}
                                        </option>
                                      ))}
                                    </select>
                                    <span className="input-suffix" aria-hidden="true">reps</span>
                                  </div>
                                ) : (
                                  <span className="guided-set-summary">{rowMetaText}</span>
                                )}
                                <span
                                  className={
                                    `set-checklist-status`
                                    + `${row.checked ? ' set-checklist-status-checked' : ''}`
                                    + `${row.locked ? ' set-checklist-status-locked' : ''}`
                                  }
                                  aria-hidden="true"
                                >
                                  {row.checked ? <FaCheck aria-hidden="true" /> : <span className="set-checklist-status-dot" />}
                                  {statusLabel}
                                </span>
                              </div>
                            );
                          })
                        ) : (
                          <div className="muted">No target sets configured.</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </motion.div>
            ) : null}
          </AnimatePresence>

          <AnimatePresence initial={false}>
            {finishConfirmOpen ? (
              <motion.div
                className="card"
                variants={motionConfig.variants.fadeUp}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <div className="section-title">End workout?</div>
                <div className="muted" style={{ marginBottom: '0.75rem' }}>
                  You still have {pendingExercises.length} exercise{pendingExercises.length === 1 ? '' : 's'} not marked complete.
                </div>
                <div className="inline">
                  <button className="button secondary" type="button" onClick={() => handleEndSession(true)}>
                    Finish anyway
                  </button>
                  <button className="button ghost" type="button" onClick={() => setFinishConfirmOpen(false)}>
                    Keep training
                  </button>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <AnimatePresence initial={false}>
            {recentlyDeletedSet ? (
              <motion.div
                className="card"
                variants={motionConfig.variants.fadeUp}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <div className="split">
                  <div className="muted">
                    Deleted set from {recentlyDeletedSet.exerciseName}. Undo available for 5s.
                  </div>
                  <button className="button ghost" type="button" onClick={handleUndoDeleteSet}>
                    Undo
                  </button>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          {!shouldHideWorkoutActionBar ? (
            <motion.div
              className={`workout-action-bar ${sessionMode === 'workout' ? 'workout-action-bar-floating' : ''}`}
            >
              {sessionMode === 'preview' ? (
                <button
                  className="button secondary"
                  type="button"
                  onClick={handleBeginWorkout}
                >
                  Begin workout
                </button>
              ) : null}
              {sessionMode === 'workout' && currentExercise && !currentIsCompleted ? (
                <button
                  className="button secondary"
                  type="button"
                  onClick={handleFinishExercise}
                >
                  <FaFlagCheckered aria-hidden="true" />
                  {currentExercise?.isWarmupStep
                    ? 'Finish warmup'
                    : shouldPrimaryActionFinishWorkout
                      ? 'Finish workout'
                      : 'Finish exercise'}
                </button>
              ) : null}
              {sessionMode === 'workout' && currentExercise && !currentIsCompleted && !shouldPrimaryActionFinishWorkout && !currentExercise.isWarmupStep ? (
                <button
                  className="button ghost"
                  type="button"
                  onClick={handleSkipExercise}
                >
                  <FaForwardStep aria-hidden="true" />
                  Skip exercise
                </button>
              ) : null}
              <button
                className="button ghost"
                type="button"
                onClick={sessionMode === 'preview' ? handleCancelSession : () => handleEndSession()}
              >
                {sessionMode === 'preview' ? null : <FaStop aria-hidden="true" />}
                {sessionMode === 'preview' ? 'Cancel' : 'End workout'}
              </button>
            </motion.div>
          ) : null}

          <AnimatePresence>
            {workoutPreviewOpen && sessionMode === 'workout' ? (
              <AnimatedModal onClose={() => setWorkoutPreviewOpen(false)} panelClassName="workout-preview-modal">
                <div className="split">
                  <div className="section-title" style={{ marginBottom: 0 }}>
                    Exercises
                  </div>
                  <button
                    className="button ghost icon-button"
                    type="button"
                    aria-label="Close workout exercises"
                    title="Close workout exercises"
                    onClick={() => setWorkoutPreviewOpen(false)}
                  >
                    <FaXmark aria-hidden="true" />
                  </button>
                </div>
                <div className="stack" style={{ marginTop: '1rem' }}>
                  {renderWorkoutPreviewList('workout-preview-modal')}
                </div>
              </AnimatedModal>
            ) : null}
            {detailExercise ? (
              <AnimatedModal onClose={closeExerciseDetail} panelClassName="workout-exercise-detail-modal">
                <div className="split">
                  <div className="section-title" style={{ marginBottom: 0 }}>
                    {[detailExercise.equipment, detailExercise.name].filter(Boolean).join(' ')}
                  </div>
                  <button
                    className="button ghost icon-button"
                    type="button"
                    aria-label="Close exercise details"
                    title="Close exercise details"
                    onClick={closeExerciseDetail}
                  >
                    <FaXmark aria-hidden="true" />
                  </button>
                </div>
                <div className="stack" style={{ marginTop: '1rem' }}>
                  {detailImageUrl ? (
                    <img
                      className="exercise-detail-image"
                      src={detailImageUrl}
                      alt={detailExercise.name}
                    />
                  ) : null}
                  <div className="inline">
                    {detailExercise.category ? <span className="badge">{formatMuscleLabel(detailExercise.category)}</span> : null}
                    {detailExercise.level ? <span className="badge">Level {formatMuscleLabel(detailExercise.level)}</span> : null}
                    {detailExercise.force ? <span className="badge">Force {formatMuscleLabel(detailExercise.force)}</span> : null}
                    {detailExercise.mechanic ? <span className="badge">Mechanic {formatMuscleLabel(detailExercise.mechanic)}</span> : null}
                  </div>
                  {detailPrimaryMuscles.length ? (
                    <div className="muted">
                      Primary muscles: {detailPrimaryMuscles.map((muscle) => formatMuscleLabel(muscle)).join(', ')}
                    </div>
                  ) : null}
                  {detailSecondaryMuscles.length ? (
                    <div className="muted">
                      Secondary muscles: {detailSecondaryMuscles.map((muscle) => formatMuscleLabel(muscle)).join(', ')}
                    </div>
                  ) : null}
                  {detailInstructions.length ? (
                    <div className="exercise-detail-block">
                      <div className="exercise-detail-heading">Instructions</div>
                      <ol className="exercise-detail-instructions">
                        {detailInstructions.map((instruction, index) => (
                          <li key={`${instruction}-${index}`}>{instruction}</li>
                        ))}
                      </ol>
                    </div>
                  ) : null}
                  {!detailHasMetadata ? (
                    <div className="muted">No exercise metadata available yet.</div>
                  ) : null}
                </div>
              </AnimatedModal>
            ) : null}
          </AnimatePresence>
        </motion.div>
      ) : (
        <motion.div
          key="log-state-start"
          className="card"
          variants={motionConfig.variants.fadeUp}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <div className="section-title">Start a workout</div>
          <div className="start-workout-routine-list">
            {routines.length ? (
              routines.map((routine) => {
                const routineNote = typeof routine.notes === 'string' ? routine.notes.trim() : '';
                const routineLastUsedLabel = formatRoutineLastUsedDaysAgo(routine.lastUsedAt);
                const routineTypeLabel = formatRoutineTypeLabel(routine.routineType);
                return (
                  <button
                    key={routine.id}
                    className="button start-workout-routine-button"
                    type="button"
                    aria-label={routine.name}
                    onClick={() => handleStartSession(routine.id)}
                  >
                    <span className="start-workout-routine-content">
                      <span className="start-workout-routine-title-row">
                        <span className="start-workout-routine-name">{routine.name}</span>
                        {routineNote ? (
                          <span className="start-workout-routine-note">— {routineNote}</span>
                        ) : null}
                      </span>
                      <span className="start-workout-routine-meta">
                        {routine.exercises.length} {routine.exercises.length === 1 ? 'exercise' : 'exercises'} · {routineLastUsedLabel}
                      </span>
                    </span>
                    <span className="start-workout-routine-actions">
                      <span className="badge start-workout-routine-type-badge">{routineTypeLabel}</span>
                      <span className="start-workout-routine-chevron" aria-hidden="true">→</span>
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="muted">
                Create a routine in the Routines tab before starting a workout.
              </div>
            )}
          </div>
        </motion.div>
      )}
      </AnimatePresence>

      {!isTrainingFocused ? (
        <>
          {!loading && shouldPromptWeightLog ? (
            <div className="card">
              <div className="section-title">Bodyweight reminder</div>
              <div className="muted" style={{ marginBottom: '0.6rem' }}>
                {weights.length
                  ? 'It has been over a week since your last entry. Log your weight to keep trends accurate.'
                  : 'Log your weight to start tracking progress.'}
              </div>
              <div className="form-row">
                <div className="input-suffix-wrap">
                  <input
                    className="input"
                    type="number"
                    step="0.1"
                    placeholder="Enter weight"
                    value={weightInput}
                    onChange={(event) => setWeightInput(event.target.value)}
                  />
                  <span className="input-suffix" aria-hidden="true">kg</span>
                </div>
                <button className="button" onClick={handleAddWeight}>
                  Log weight
                </button>
              </div>
            </div>
          ) : null}
          <div className="card">
            <div className="section-title">Recent workouts</div>
            {sessions.length ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Workout</th>
                    <th>Sets</th>
                    <th>Ago</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session, index) => {
                    const sessionRoutineNote = typeof session.routineNotes === 'string' ? session.routineNotes.trim() : '';
                    return (
                      <tr
                        key={`${session.id}-${session.startedAt || index}`}
                        className="table-row-action"
                        role="button"
                        tabIndex={0}
                        onClick={() => handleViewSessionDetail(session.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            handleViewSessionDetail(session.id);
                          }
                        }}
                      >
                        <td>
                          <span>{session.routineName || 'Workout'}</span>
                          {sessionRoutineNote ? (
                            <span className="start-workout-routine-note">— {sessionRoutineNote}</span>
                          ) : null}
                        </td>
                        <td>{Number(session.totalSets || 0)}</td>
                        <td>{formatDaysAgoLabel(session.startedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="muted">No workouts logged yet.</div>
            )}
          </div>
          <AnimatePresence>
            {sessionDetailLoading || sessionDetail ? (
              <AnimatedModal onClose={closeSessionDetail} panelClassName="routine-modal">
                <div className="split">
                  <div className="section-title" style={{ marginBottom: 0 }}>
                    Workout details
                  </div>
                  <button
                    className="button ghost icon-button"
                    type="button"
                    aria-label="Close workout details"
                    title="Close workout details"
                    onClick={closeSessionDetail}
                    disabled={sessionDetailLoading}
                  >
                    <FaXmark aria-hidden="true" />
                  </button>
                </div>
                {sessionDetailLoading ? (
                  <div style={{ marginTop: '1rem' }} className="muted">Loading workout details…</div>
                ) : sessionDetailSummary ? (
                  <div className="stack" style={{ marginTop: '1rem' }}>
                    <div>
                      <div className="section-title">
                        {sessionDetailSummary.routineName || 'Workout'}
                      </div>
                      <div className="muted">{formatDateTime(sessionDetailSummary.startedAt)}</div>
                      {sessionDetailSummary.notes ? (
                        <div className="muted">Notes: {sessionDetailSummary.notes}</div>
                      ) : null}
                    </div>
                    <div className="session-complete-metrics">
                      <div className="card session-complete-metric">
                        <div className="muted stats-kpi-label">Workout time</div>
                        <div className="section-title">{sessionDetailDurationSeconds !== null ? formatDurationSeconds(sessionDetailDurationSeconds) : '—'}</div>
                      </div>
                      <div className="card session-complete-metric">
                        <div className="muted stats-kpi-label">Warmup time</div>
                        <div className="section-title">{sessionDetailWarmupDurationSeconds !== null ? formatDurationSeconds(sessionDetailWarmupDurationSeconds) : '—'}</div>
                      </div>
                      <div className="card session-complete-metric">
                        <div className="muted stats-kpi-label">Exercises</div>
                        <div className="section-title">{sessionDetailExerciseCount} / {sessionDetailExerciseTotal || 0}</div>
                      </div>
                      <div className="card session-complete-metric">
                        <div className="muted stats-kpi-label">Sets</div>
                        <div className="section-title">{formatNumber(sessionDetailSummary.totalSets || 0)}</div>
                      </div>
                      <div className="card session-complete-metric">
                        <div className="muted stats-kpi-label">Total reps</div>
                        <div className="section-title">{formatNumber(sessionDetailSummary.totalReps || 0)}</div>
                      </div>
                      <div className="card session-complete-metric">
                        <div className="muted stats-kpi-label">Volume</div>
                        <div className="section-title">{formatNumber(sessionDetailSummary.totalVolume || 0)} kg</div>
                      </div>
                    </div>
                    <div className="stack">
                      {(sessionDetailSummary.exercises || []).map((exercise, index) => {
                        const exerciseKey = `${exercise.exerciseId}-${exercise.position ?? index}-${index}`;
                        const isExpanded = expandedDetailExercises.includes(exerciseKey);
                        const setCount = (exercise.sets || []).length;

                        return (
                          <div key={exerciseKey} className="set-list">
                            <div className="session-detail-exercise-header">
                              <div className="section-title session-detail-exercise-title" style={{ fontSize: '1rem' }}>
                                {exercise.name}
                                {exercise.durationSeconds ? ` · ${formatDurationSeconds(exercise.durationSeconds)}` : ''}
                              </div>
                              {setCount > 0 ? (
                                <button
                                  className="button ghost icon-button session-detail-toggle-button"
                                  type="button"
                                  aria-label={isExpanded ? `Hide sets for ${exercise.name}` : `Show ${setCount} sets for ${exercise.name}`}
                                  title={isExpanded ? `Hide sets (${setCount})` : `Show sets (${setCount})`}
                                  onClick={() => toggleDetailExercise(exerciseKey)}
                                >
                                  {isExpanded ? <FaArrowUp aria-hidden="true" /> : <FaArrowDown aria-hidden="true" />}
                                </button>
                              ) : (
                                <span className="muted session-detail-skipped-note">Skipped</span>
                              )}
                            </div>
                            <AnimatePresence initial={false}>
                              {setCount > 0 && isExpanded ? (
                                <motion.div
                                  className="motion-collapse"
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={motionConfig.transition.fast}
                                >
                                  <table className="session-detail-set-table" aria-label={`${exercise.name} set summary`}>
                                    <thead>
                                      <tr>
                                        <th scope="col">Set</th>
                                        <th scope="col">Summary</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(exercise.sets || []).map((set, setIndex) => (
                                        <tr
                                          key={`${set.id ?? 'set'}-${set.setIndex ?? 'na'}-${set.createdAt || set.completedAt || setIndex}`}
                                          className="session-detail-set-row"
                                        >
                                          <td>
                                            <span className="set-chip">Set {set.setIndex}</span>
                                          </td>
                                          <td>
                                            {set.bandLabel
                                              ? `${set.bandLabel} × ${formatNumber(set.reps)} reps`
                                              : Number(set.weight) === 0
                                                ? `${formatNumber(set.reps)} reps`
                                                : `${formatNumber(set.weight)} kg × ${formatNumber(set.reps)} reps`}
                                            {set.durationSeconds ? ` · ${formatDurationSeconds(set.durationSeconds)}` : ''}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </motion.div>
                              ) : null}
                            </AnimatePresence>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </AnimatedModal>
            ) : null}
          </AnimatePresence>
        </>
      ) : null}

    </motion.div>
  );
}

function RoutinesPage() {
  const { resolvedReducedMotion } = useMotionPreferences();
  const motionConfig = useMemo(
    () => getMotionConfig(resolvedReducedMotion),
    [resolvedReducedMotion]
  );
  const [routines, setRoutines] = useState([]);
  const [expandedRoutineIds, setExpandedRoutineIds] = useState([]);
  const [exercises, setExercises] = useState([]);
  const [routineModal, setRoutineModal] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [routineData, exerciseData] = await Promise.all([
        apiFetch('/api/routines'),
        apiFetch('/api/exercises'),
      ]);
      setRoutines((routineData.routines || []).map((routine) => normalizeRoutineForUi(routine)));
      setExercises(exerciseData.exercises || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!routineModal) return undefined;
    if (typeof document === 'undefined') return undefined;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setRoutineModal(null);
      }
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [routineModal]);

  const handleSave = async (payload) => {
    setError(null);
    try {
      if (payload.id) {
        const data = await apiFetch(`/api/routines/${payload.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setRoutines((prev) =>
          prev.map((routine) => (
            routine.id === payload.id ? normalizeRoutineForUi(data.routine) : routine
          ))
        );
      } else {
        const data = await apiFetch('/api/routines', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setRoutines((prev) => [normalizeRoutineForUi(data.routine), ...prev]);
      }
      setRoutineModal(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (routine) => {
    if (!routine?.id) return;
    const routineName = typeof routine.name === 'string' ? routine.name.trim() : '';
    const confirmed = window.confirm(
      `Delete "${routineName || 'this routine'}"?\n\nThis cannot be undone.`
    );
    if (!confirmed) return;

    setError(null);
    try {
      await apiFetch(`/api/routines/${routine.id}`, { method: 'DELETE' });
      setRoutines((prev) => prev.filter((item) => item.id !== routine.id));
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDuplicate = async (routineId) => {
    setError(null);
    try {
      const data = await apiFetch(`/api/routines/${routineId}/duplicate`, {
        method: 'POST',
      });
      setRoutines((prev) => [normalizeRoutineForUi(data.routine), ...prev]);
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleRoutineExercises = (routineId) => {
    setExpandedRoutineIds((prev) =>
      prev.includes(routineId) ? prev.filter((id) => id !== routineId) : [...prev, routineId]
    );
  };

  const resolveReorderBlock = (routine, index) => {
    const list = routine?.exercises || [];
    const item = list[index];
    if (!item) return { start: index, end: index };
    const group = normalizeSupersetGroup(item.supersetGroup);
    if (!group) return { start: index, end: index };
    const memberIndexes = list
      .map((exercise, exerciseIndex) => ({ exercise, exerciseIndex }))
      .filter(({ exercise }) => normalizeSupersetGroup(exercise.supersetGroup) === group)
      .map(({ exerciseIndex }) => exerciseIndex)
      .sort((a, b) => a - b);
    if (memberIndexes.length !== 2 || Math.abs(memberIndexes[0] - memberIndexes[1]) !== 1) {
      return { start: index, end: index };
    }
    return { start: memberIndexes[0], end: memberIndexes[1] };
  };

  const canMoveExercise = (routine, index, direction) => {
    if (!routine) return false;
    const { start, end } = resolveReorderBlock(routine, index);
    if (direction < 0) return start > 0;
    if (direction > 0) return end < routine.exercises.length - 1;
    return false;
  };

  const handleReorderExercises = async (routine, index, direction) => {
    if (!routine || !direction) return;
    const list = routine.exercises || [];
    if (!list.length) return;
    if (!canMoveExercise(routine, index, direction)) return;

    const { start, end } = resolveReorderBlock(routine, index);
    const nextOrder = list.map((item) => item.id);
    const block = nextOrder.splice(start, end - start + 1);
    const insertAt = direction < 0 ? start - 1 : start + 1;
    nextOrder.splice(insertAt, 0, ...block);

    setError(null);
    try {
      const data = await apiFetch(`/api/routines/${routine.id}/reorder`, {
        method: 'PUT',
        body: JSON.stringify({ exerciseOrder: nextOrder }),
      });
      setRoutines((prev) =>
        prev.map((item) => (
          item.id === routine.id ? normalizeRoutineForUi(data.routine) : item
        ))
      );
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <motion.div
      className="stack"
      variants={motionConfig.variants.listStagger}
      initial="hidden"
      animate="visible"
    >
      <div className="split">
        <div>
          <h2 className="section-title">Routines</h2>
          <p className="muted">Build your templates for effortless workouts.</p>
        </div>
        <button
          className="button"
          type="button"
          onClick={() => setRoutineModal({ mode: 'create', routine: null })}
        >
          Create
        </button>
      </div>
      <AnimatePresence initial={false}>
        {error ? (
          <motion.div
            className="notice"
            variants={motionConfig.variants.fadeUp}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {error}
          </motion.div>
        ) : null}
      </AnimatePresence>

      {loading ? (
        <div className="card">Loading routines…</div>
      ) : routines.length ? (
        routines.map((routine) => {
          const isExpanded = expandedRoutineIds.includes(routine.id);
          const routineNotes = typeof routine.notes === 'string' ? routine.notes.trim() : '';
          const routinePreviewBlocks = buildWorkoutPreviewBlocks(routine.exercises || []);
          const exerciseToggleLabel = isExpanded
            ? `Hide exercises (${routine.exercises.length})`
            : `Show exercises (${routine.exercises.length})`;
          const renderRoutineExerciseRow = (
            exercise,
            index,
            {
              rowKey = `${routine.id}-${exercise.id}-${index}`,
              grouped = false,
              showSupersetBadge = false,
            } = {}
          ) => (
            <div
              key={rowKey}
              className={`set-row workout-preview-row routine-workout-preview-row${grouped ? ' workout-preview-row-grouped' : ''}`}
            >
              <div>
                <div>{`${index + 1}. ${[exercise.equipment, exercise.name].filter(Boolean).join(' ')}`}</div>
                <div className="inline routine-workout-preview-badges">
                  {exercise.targetSets ? <span className="badge">{exercise.targetSets} sets</span> : null}
                  {exercise.targetRepsRange ? <span className="badge">{exercise.targetRepsRange} reps</span> : null}
                  {!exercise.targetRepsRange && exercise.targetReps ? <span className="badge">{exercise.targetReps} reps</span> : null}
                  {exercise.targetWeight
                  && exercise.equipment !== 'Bodyweight'
                  && exercise.equipment !== 'Band'
                  && exercise.equipment !== 'Ab wheel'
                    ? <span className="badge">{exercise.targetWeight} kg</span>
                    : null}
                  {exercise.equipment === 'Band' && exercise.targetBandLabel
                    ? <span className="badge">{exercise.targetBandLabel}</span>
                    : null}
                  {exercise.targetRestSeconds
                    ? <span className="badge">Rest {formatRestTime(exercise.targetRestSeconds)}</span>
                    : null}
                  {showSupersetBadge ? <span className="badge badge-superset">Superset</span> : null}
                </div>
              </div>
              <div className="inline routine-workout-preview-actions">
                <button
                  className="button ghost"
                  type="button"
                  onClick={() => handleReorderExercises(routine, index, -1)}
                  style={{ padding: '0.3rem 0.6rem' }}
                  disabled={!canMoveExercise(routine, index, -1)}
                >
                  ↑
                </button>
                <button
                  className="button ghost"
                  type="button"
                  onClick={() => handleReorderExercises(routine, index, 1)}
                  style={{ padding: '0.3rem 0.6rem' }}
                  disabled={!canMoveExercise(routine, index, 1)}
                >
                  ↓
                </button>
              </div>
            </div>
          );
          return (
	            <motion.div
	              key={routine.id}
	              className="card"
	              variants={motionConfig.variants.listItem}
	            >
	              <div className="routine-card-header">
                <div className="routine-card-title-wrap">
                  <div className="section-title">
                    {routine.name} ({routine.exercises.length})
                  </div>
                  {routineNotes ? <div className="muted">{routineNotes}</div> : null}
                </div>
	                <div className="routine-card-header-right">
	                  <span className="badge routine-card-type-badge">
	                    {formatRoutineTypeLabel(routine.routineType)}
	                  </span>
	                  <div className="inline routine-card-actions">
	                    <button
	                      className="button ghost icon-button"
	                      type="button"
	                      aria-label="Edit routine"
	                      title="Edit routine"
	                      onClick={() => setRoutineModal({ mode: 'edit', routine })}
	                    >
	                      <FaPenToSquare aria-hidden="true" />
	                    </button>
	                    <button
	                      className="button ghost icon-button"
	                      type="button"
	                      aria-label="Duplicate routine"
	                      title="Duplicate routine"
	                      onClick={() => handleDuplicate(routine.id)}
	                    >
	                      <FaCopy aria-hidden="true" />
	                    </button>
	                    <button
	                      className="button ghost icon-button"
	                      type="button"
	                      aria-label="Delete routine"
	                      title="Delete routine"
	                      onClick={() => handleDelete(routine)}
	                    >
	                      <FaTrashCan aria-hidden="true" />
	                    </button>
	                    <button
	                      className="button ghost icon-button"
	                      type="button"
	                      aria-label={exerciseToggleLabel}
	                      title={exerciseToggleLabel}
	                      onClick={() => toggleRoutineExercises(routine.id)}
	                    >
	                      {isExpanded ? <FaArrowUp aria-hidden="true" /> : <FaArrowDown aria-hidden="true" />}
	                    </button>
	                  </div>
	                </div>
	              </div>
              <AnimatePresence initial={false}>
                {isExpanded ? (
                  <motion.div
                    className="set-list motion-collapse"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={motionConfig.transition.fast}
                  >
                    {routinePreviewBlocks.map((block) => {
                      const blockItems = routine.exercises.slice(block.startIndex, block.endIndex + 1);
                      if (!block.isSuperset) {
                        const exercise = blockItems[0];
                        return renderRoutineExerciseRow(exercise, block.startIndex, {
                          rowKey: `${routine.id}-${exercise.id}-${block.startIndex}`,
                          showSupersetBadge: Boolean(normalizeSupersetGroup(exercise.supersetGroup)),
                        });
                      }
                      const blockKey = `${routine.id}-superset-${blockItems.map((item) => item.id).join('-')}-${block.startIndex}`;
                      return (
                        <div key={blockKey} className="workout-preview-superset-block">
                          <div className="inline workout-preview-superset-header">
                            <span className="badge badge-superset">Superset</span>
                          </div>
                          <div className="stack workout-preview-superset-items">
                            {blockItems.map((exercise, offset) =>
                              renderRoutineExerciseRow(exercise, block.startIndex + offset, {
                                rowKey: `${blockKey}-${exercise.id}-${offset}`,
                                grouped: true,
                              })
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </motion.div>
          );
        })
      ) : (
        <div className="empty">No routines yet. Create your first template.</div>
      )}

      <AnimatePresence>
        {routineModal ? (
          <AnimatedModal
            onClose={() => setRoutineModal(null)}
            panelClassName="routine-modal routine-editor-modal"
          >
            <div className="split">
              <div className="section-title" style={{ marginBottom: 0 }}>
                {routineModal.mode === 'edit' ? 'Edit routine' : 'Create routine'}
              </div>
              <button
                className="button ghost icon-button"
                type="button"
                aria-label="Close routine editor"
                title="Close routine editor"
                onClick={() => setRoutineModal(null)}
              >
                <FaXmark aria-hidden="true" />
              </button>
            </div>
            <div className="routine-modal-editor">
              <RoutineEditor
                routine={routineModal.routine || undefined}
                exercises={exercises}
                onSave={handleSave}
                motionConfig={motionConfig}
              />
            </div>
          </AnimatedModal>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

function buildRoutineEditorBlocks(sourceItems) {
  const blocks = [];
  for (let index = 0; index < sourceItems.length; index += 1) {
    const item = sourceItems[index];
    const hasPairNext = Boolean(item?.pairWithNext && sourceItems[index + 1]);
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

function RoutineEditor({ routine, exercises, onSave, motionConfig }) {
  const isCreateMode = !routine?.id;
  const [name, setName] = useState(routine?.name || '');
  const [notes, setNotes] = useState(routine?.notes || '');
  const [routineType, setRoutineType] = useState(normalizeRoutineType(routine?.routineType));
  const [formError, setFormError] = useState(null);
  const [dragIndex, setDragIndex] = useState(null);
  const [pendingScrollItemId, setPendingScrollItemId] = useState(null);
  const nextEditorIdRef = useRef(1);
  const scrollContainerRef = useRef(null);
  const createEditorItemId = () => {
    const editorId = `routine-editor-item-${nextEditorIdRef.current}`;
    nextEditorIdRef.current += 1;
    return editorId;
  };
  const exerciseOptionsByGroup = useMemo(() => {
    const grouped = new Map();
    exercises.forEach((exercise) => {
      const group = normalizeExercisePrimaryMuscles(exercise)[0] || 'uncategorized';
      if (!grouped.has(group)) {
        grouped.set(group, []);
      }
      grouped.get(group).push(exercise);
    });

    return Array.from(grouped.entries())
      .map(([group, groupedExercises]) => [
        group,
        [...groupedExercises].sort((a, b) =>
          String(a.name || '').localeCompare(String(b.name || ''))
        ),
      ])
      .sort(([a], [b]) => {
        if (a === 'uncategorized' && b !== 'uncategorized') return 1;
        if (b === 'uncategorized' && a !== 'uncategorized') return -1;
        return a.localeCompare(b);
      });
  }, [exercises]);
  const [items, setItems] = useState(() => {
    if (!routine?.exercises?.length) {
      return isCreateMode ? [createRoutineEditorItem({ editorId: createEditorItemId() })] : [];
    }
    const sourceItems = routine.exercises.map((item) => {
      const repBounds = resolveTargetRepBounds(item.targetReps, item.targetRepsRange);
      return {
        editorId: createEditorItemId(),
        exerciseId: item.exerciseId,
        equipment: item.equipment || '',
        targetSets: item.targetSets ? String(item.targetSets) : DEFAULT_TARGET_SETS,
        targetRepsMin: repBounds.min,
        targetRepsMax: repBounds.max,
        targetRestSeconds: resolveRoutineRestOptionValue(item.targetRestSeconds),
        targetWeight:
          item.equipment === 'Bodyweight' || item.equipment === 'Band'
          || item.equipment === 'Ab wheel'
            ? ''
            : item.targetWeight || '',
        targetBandLabel:
          item.equipment === 'Band'
            ? item.targetBandLabel || ROUTINE_BAND_OPTIONS[0]
            : '',
        notes: item.notes || '',
        position: item.position || 0,
        supersetGroup: normalizeSupersetGroup(item.supersetGroup),
        pairWithNext: false,
      };
    });
    return sourceItems.map((item, index) => ({
      ...item,
      pairWithNext:
        Boolean(item.supersetGroup)
        && sourceItems[index + 1]?.supersetGroup === item.supersetGroup,
    }));
  });

  const normalizePairings = (nextItems) =>
    nextItems.map((item, index) => {
      const previousPairsWithNext = index > 0 ? Boolean(nextItems[index - 1]?.pairWithNext) : false;
      const canPairWithNext = index < nextItems.length - 1;
      return {
        ...item,
        pairWithNext: canPairWithNext ? Boolean(item.pairWithNext) && !previousPairsWithNext : false,
      };
    });

  const updateItems = (updater) => {
    setItems((prev) => {
      const rawNext = typeof updater === 'function' ? updater(prev) : updater;
      return normalizePairings(rawNext);
    });
  };

  const itemBlocks = useMemo(() => buildRoutineEditorBlocks(items), [items]);
  const blockMotionVariants = useMemo(() => ({
    hidden: {
      opacity: 0,
      y: motionConfig.reducedMotion ? 0 : 10,
      scale: motionConfig.reducedMotion ? 1 : 0.992,
    },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: motionConfig.transition.standard,
    },
    exit: {
      opacity: 0,
      y: motionConfig.reducedMotion ? 0 : -8,
      scale: motionConfig.reducedMotion ? 1 : 0.992,
      transition: motionConfig.transition.fast,
    },
  }), [motionConfig]);

  useEffect(() => {
    if (!pendingScrollItemId) return undefined;
    const container = scrollContainerRef.current;
    if (!container) return undefined;

    let frameId = 0;
    let settleTimeoutId = 0;
    let finalTimeoutId = 0;
    const behavior = motionConfig.reducedMotion ? 'auto' : 'smooth';

    const scrollTargetIntoView = (scrollBehavior) => {
      const escapedId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(pendingScrollItemId)
        : pendingScrollItemId.replace(/"/g, '\\"');
      const selector = `[data-routine-editor-item-id="${escapedId}"]`;
      const target = container.querySelector(selector);
      if (!target) {
        container.scrollTo({ top: container.scrollHeight, behavior: scrollBehavior });
        return false;
      }

      const footer = container
        .closest('.routine-editor-form')
        ?.querySelector('.routine-editor-footer-fixed');
      const footerOffsetPx = footer
        ? Math.ceil(footer.getBoundingClientRect().height) + 12
        : 112;
      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const visibleTop = containerRect.top + 8;
      const visibleBottom = containerRect.bottom - footerOffsetPx;
      let nextScrollTop = container.scrollTop;

      if (targetRect.bottom > visibleBottom) {
        nextScrollTop += targetRect.bottom - visibleBottom;
      } else if (targetRect.top < visibleTop) {
        nextScrollTop -= visibleTop - targetRect.top;
      }
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
      const clampedTop = Math.max(0, Math.min(nextScrollTop, maxScrollTop));
      if (Math.abs(clampedTop - container.scrollTop) > 1) {
        container.scrollTo({ top: clampedTop, behavior: scrollBehavior });
      }
      return true;
    };

    frameId = window.requestAnimationFrame(() => {
      scrollTargetIntoView(behavior);
    });

    settleTimeoutId = window.setTimeout(() => {
      scrollTargetIntoView('auto');
    }, motionConfig.reducedMotion ? 80 : 320);

    finalTimeoutId = window.setTimeout(() => {
      scrollTargetIntoView('auto');
      setPendingScrollItemId(null);
    }, motionConfig.reducedMotion ? 180 : 620);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(settleTimeoutId);
      window.clearTimeout(finalTimeoutId);
    };
  }, [pendingScrollItemId, motionConfig.reducedMotion]);

  const describeItem = (item, index) => {
    const selectedExercise = exercises.find(
      (exercise) => String(exercise.id) === String(item.exerciseId)
    );
    return [item.equipment, selectedExercise?.name]
      .filter(Boolean)
      .join(' ')
      .trim() || `exercise ${index + 1}`;
  };

  const addItem = () => {
    const nextItemId = createEditorItemId();
    updateItems((prev) => {
      const previousItem = prev[prev.length - 1];
      const inheritedRest = String(previousItem?.targetRestSeconds || '');
      const nextRestSeconds = ROUTINE_REST_OPTION_VALUES.includes(inheritedRest)
        ? inheritedRest
        : DEFAULT_TARGET_REST_SECONDS;
      return [
        ...prev,
        createRoutineEditorItem({
          editorId: nextItemId,
          position: prev.length,
          targetRestSeconds: nextRestSeconds,
        }),
      ];
    });
    setPendingScrollItemId(nextItemId);
    setFormError(null);
  };

  const updateItem = (index, key, value) => {
    updateItems((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, [key]: value } : item))
    );
    setFormError(null);
  };

  const updateTargetRepsMin = (index, minValue) => {
    updateItems((prev) =>
      prev.map((item, idx) => {
        if (idx !== index) return item;
        return {
          ...item,
          targetRepsMin: minValue,
          targetRepsMax: resolveAutoTargetRepMax(minValue),
        };
      })
    );
    setFormError(null);
  };

  const removeBlock = (startIndex, endIndex) => {
    const blockItems = items.slice(startIndex, endIndex + 1);
    if (!blockItems.length) return;
    const label = blockItems
      .map((item, offset) => describeItem(item, startIndex + offset))
      .join(' + ');
    const confirmed = window.confirm(`Remove "${label}" from this routine?`);
    if (!confirmed) return;

    updateItems((prev) =>
      prev.filter((_, idx) => idx < startIndex || idx > endIndex)
    );
    setFormError(null);
  };

  const moveBlock = (startIndex, offset) => {
    if (offset === 0) return;
    updateItems((prev) => {
      const blocks = buildRoutineEditorBlocks(prev);
      const fromBlockIndex = blocks.findIndex((block) => block.startIndex === startIndex);
      if (fromBlockIndex < 0) return prev;
      const toBlockIndex = fromBlockIndex + offset;
      if (toBlockIndex < 0 || toBlockIndex >= blocks.length) return prev;
      const blockSlices = blocks.map((block) =>
        prev.slice(block.startIndex, block.endIndex + 1)
      );
      const [movedBlock] = blockSlices.splice(fromBlockIndex, 1);
      blockSlices.splice(toBlockIndex, 0, movedBlock);
      return blockSlices.flat();
    });
    setFormError(null);
  };

  const moveBlockTo = (fromStartIndex, toStartIndex) => {
    if (fromStartIndex === toStartIndex) return;
    updateItems((prev) => {
      const blocks = buildRoutineEditorBlocks(prev);
      const fromBlockIndex = blocks.findIndex((block) => block.startIndex === fromStartIndex);
      const toBlockIndex = blocks.findIndex((block) => block.startIndex === toStartIndex);
      if (fromBlockIndex < 0 || toBlockIndex < 0 || fromBlockIndex === toBlockIndex) return prev;
      const blockSlices = blocks.map((block) =>
        prev.slice(block.startIndex, block.endIndex + 1)
      );
      const [movedBlock] = blockSlices.splice(fromBlockIndex, 1);
      blockSlices.splice(toBlockIndex, 0, movedBlock);
      return blockSlices.flat();
    });
    setFormError(null);
  };

  const updateTargetSets = (index, targetSets) => {
    updateItems((prev) =>
      prev.map((item, idx) => {
        if (idx === index) {
          return { ...item, targetSets };
        }
        if (idx === index + 1 && prev[index]?.pairWithNext) {
          return { ...item, targetSets };
        }
        if (idx === index - 1 && prev[index - 1]?.pairWithNext) {
          return { ...item, targetSets };
        }
        return item;
      })
    );
    setFormError(null);
  };

  const togglePairWithNext = (index) => {
    if (index < 0 || index >= items.length - 1) return;
    const current = items[index];
    const next = items[index + 1];
    if (!current?.exerciseId || !next?.exerciseId) {
      setFormError('Select exercises for both rows before creating a superset.');
      return;
    }

    const shouldPair = !current.pairWithNext;
    const syncedTargetSets = current.targetSets || DEFAULT_TARGET_SETS;
    updateItems((prev) =>
      prev.map((item, idx) => {
        if (idx === index) {
          return { ...item, pairWithNext: shouldPair, targetSets: syncedTargetSets };
        }
        if (shouldPair && idx === index - 1) {
          return { ...item, pairWithNext: false };
        }
        if (shouldPair && idx === index + 1 && idx < prev.length - 1) {
          return { ...item, pairWithNext: false, targetSets: syncedTargetSets };
        }
        if (shouldPair && idx === index + 1) {
          return { ...item, targetSets: syncedTargetSets };
        }
        return item;
      })
    );
    setFormError(null);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError('Routine name is required.');
      return;
    }
    const missingEquipment = items.some((item) => item.exerciseId && !item.equipment);
    if (missingEquipment) {
      setFormError('Select equipment for each exercise in the routine.');
      return;
    }
    const duplicateSelections = items
      .filter((item) => item.exerciseId)
      .map((item) => `${item.exerciseId}:${item.equipment || ''}`);
    if (new Set(duplicateSelections).size !== duplicateSelections.length) {
      setFormError('Each exercise + equipment combination can only appear once per routine.');
      return;
    }
    const invalidSets = items.some(
      (item) => item.exerciseId && !TARGET_SET_OPTIONS.includes(String(item.targetSets))
    );
    if (invalidSets) {
      setFormError('Target sets must be between 1 and 3.');
      return;
    }
    const invalidReps = items.some(
      (item) => {
        if (!item.exerciseId) return false;
        const minValue = Number(item.targetRepsMin);
        const maxValue = Number(item.targetRepsMax);
        return (
          !TARGET_REP_MIN_OPTIONS.includes(String(item.targetRepsMin)) ||
          !TARGET_REP_MAX_OPTIONS.includes(String(item.targetRepsMax)) ||
          !Number.isInteger(minValue) ||
          !Number.isInteger(maxValue) ||
          minValue > 50 ||
          maxValue > 60 ||
          maxValue < minValue
        );
      }
    );
    if (invalidReps) {
      setFormError('Target reps must be 1-50, with range max up to 60.');
      return;
    }
    const invalidTargetWeight = items.some(
      (item) =>
        item.equipment !== 'Bodyweight' &&
        item.equipment !== 'Band' &&
        item.equipment !== 'Ab wheel' &&
        item.targetWeight !== '' &&
        Number(item.targetWeight) <= 0
    );
    if (invalidTargetWeight) {
      setFormError('Target weight must be greater than zero when provided.');
      return;
    }
    const invalidTargetBand = items.some(
      (item) =>
        item.exerciseId &&
        item.equipment === 'Band' &&
        !ROUTINE_BAND_OPTIONS.includes(String(item.targetBandLabel || ''))
    );
    if (invalidTargetBand) {
      setFormError('Select a band when equipment is Band.');
      return;
    }
    const invalidRest = items.some(
      (item) =>
        item.exerciseId &&
        !ROUTINE_REST_OPTION_VALUES.includes(String(item.targetRestSeconds || ''))
    );
    if (invalidRest) {
      setFormError('Rest time must be one of the predefined options.');
      return;
    }

    const invalidSupersetRows = items.some(
      (item, index) => item.pairWithNext && (!item.exerciseId || !items[index + 1]?.exerciseId)
    );
    if (invalidSupersetRows) {
      setFormError('Supersets require two adjacent exercises with selections.');
      return;
    }

    const mismatchedSupersetSets = items.some(
      (item, index) => item.pairWithNext && String(item.targetSets) !== String(items[index + 1]?.targetSets || '')
    );
    if (mismatchedSupersetSets) {
      setFormError('Superset pairs must use the same target sets.');
      return;
    }

    setFormError(null);
    const activeItems = items.filter((item) => item.exerciseId);
    const supersetGroupByIndex = new Map();
    let groupCounter = 1;
    for (let index = 0; index < activeItems.length - 1; index += 1) {
      if (!activeItems[index].pairWithNext) continue;
      const group = `g${groupCounter}`;
      groupCounter += 1;
      supersetGroupByIndex.set(index, group);
      supersetGroupByIndex.set(index + 1, group);
      index += 1;
    }
    const payload = {
      id: routine?.id,
      name: trimmedName,
      notes,
      routineType: normalizeRoutineType(routineType),
      exercises: activeItems
        .map((item, index) => {
          const minValue = Number(item.targetRepsMin);
          const maxValue = Number(item.targetRepsMax);
          const hasRange = maxValue > minValue;
          const targetRestSeconds = Number(item.targetRestSeconds);
          return {
            exerciseId: Number(item.exerciseId),
            equipment: item.equipment || null,
            targetSets: item.targetSets ? Number(item.targetSets) : null,
            targetReps: hasRange ? null : minValue,
            targetRepsRange: hasRange ? `${minValue}-${maxValue}` : null,
            targetRestSeconds,
            targetWeight:
              item.equipment === 'Bodyweight' || item.equipment === 'Band'
              || item.equipment === 'Ab wheel'
                ? null
                : item.targetWeight
                  ? Number(item.targetWeight)
                  : null,
            targetBandLabel:
              item.equipment === 'Band' ? item.targetBandLabel || ROUTINE_BAND_OPTIONS[0] : null,
            notes: item.notes || null,
            position: index,
            supersetGroup: supersetGroupByIndex.get(index) || null,
          };
        }),
    };
    onSave(payload);
  };

  const renderRoutineEditorItemFields = (item, index) => (
    <div className="stack routine-editor-block-item-fields">
      <div className="form-row routine-editor-row">
        <div className="routine-exercise-field">
          <select
            aria-label="Exercise"
            value={item.exerciseId}
            onChange={(event) => updateItem(index, 'exerciseId', event.target.value)}
          >
            <option value="">Exercise</option>
            {exerciseOptionsByGroup.flatMap(([group, groupedExercises]) => [
              <option key={`group-${group}`} value="" disabled>
                {`— ${formatMuscleLabel(group)} —`}
              </option>,
              ...groupedExercises.map((exercise) => (
                <option key={exercise.id} value={exercise.id}>
                  {exercise.name}
                </option>
              )),
            ])}
          </select>
        </div>
        <div className="routine-equipment-field">
          <select
            aria-label="Equipment"
            value={encodeRoutineEquipmentValue(item.equipment, item.targetBandLabel)}
            onChange={(event) => {
              const { equipment: nextEquipment, targetBandLabel } =
                decodeRoutineEquipmentValue(event.target.value);
              updateItems((prev) =>
                prev.map((entry, entryIndex) => {
                  if (entryIndex !== index) return entry;
                  return {
                    ...entry,
                    equipment: nextEquipment,
                    targetWeight:
                      nextEquipment === 'Bodyweight'
                      || nextEquipment === 'Band'
                      || nextEquipment === 'Ab wheel'
                        ? ''
                        : entry.targetWeight,
                    targetBandLabel: nextEquipment === 'Band' ? targetBandLabel : '',
                  };
                })
              );
              setFormError(null);
            }}
          >
            <option value="">Equipment</option>
            {BASE_EQUIPMENT_TYPES.map((equipment) => (
              <option key={equipment} value={`equipment:${equipment}`}>
                {equipment}
              </option>
            ))}
            <option disabled value="">
              -- Band --
            </option>
            {item.targetBandLabel &&
            !ROUTINE_BAND_OPTIONS.includes(item.targetBandLabel) ? (
              <option value={`band:${item.targetBandLabel}`}>
                {`Band · ${item.targetBandLabel}`}
              </option>
            ) : null}
            {ROUTINE_BAND_OPTIONS.map((bandLabel) => (
              <option key={bandLabel} value={`band:${bandLabel}`}>
                {`Band · ${bandLabel}`}
              </option>
            ))}
          </select>
        </div>
        {item.equipment !== 'Bodyweight'
        && item.equipment !== 'Band'
        && item.equipment !== 'Ab wheel' ? (
          <div className="routine-weight-field">
            <div className="input-suffix-wrap">
              <input
                className="input"
                type="number"
                inputMode="decimal"
                step="0.5"
                aria-label="Weight"
                placeholder="Weight"
                value={item.targetWeight}
                onChange={(event) => updateItem(index, 'targetWeight', event.target.value)}
              />
              <span className="input-suffix" aria-hidden="true">kg</span>
            </div>
          </div>
        ) : null}
        <div className="routine-sets-field">
          <div className="input-suffix-wrap">
            <select
              aria-label="Sets"
              className="input-suffix-select input-suffix-select-wide"
              value={item.targetSets}
              onChange={(event) => updateTargetSets(index, event.target.value)}
            >
              {TARGET_SET_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <span className="input-suffix" aria-hidden="true">sets</span>
          </div>
        </div>
        <div className="routine-reps-field">
          <div className="rep-range-controls">
            <div className="input-suffix-wrap">
              <select
                className="input-suffix-select input-suffix-select-wide"
                value={item.targetRepsMin}
                onChange={(event) => updateTargetRepsMin(index, event.target.value)}
                aria-label="Reps minimum"
              >
                {TARGET_REP_MIN_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <span className="input-suffix" aria-hidden="true">reps</span>
            </div>
            <div className="input-suffix-wrap">
              <select
                className="input-suffix-select input-suffix-select-wide"
                value={item.targetRepsMax}
                onChange={(event) => updateItem(index, 'targetRepsMax', event.target.value)}
                aria-label="Reps maximum"
              >
                {TARGET_REP_MAX_OPTIONS
                  .filter((value) => Number(value) >= Number(item.targetRepsMin))
                  .map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
              </select>
              <span className="input-suffix" aria-hidden="true">reps</span>
            </div>
          </div>
        </div>
        <div className="routine-rest-field">
          <div className="input-suffix-wrap">
            <select
              className="input-suffix-select input-suffix-select-wide"
              value={item.targetRestSeconds}
              onChange={(event) => updateItem(index, 'targetRestSeconds', event.target.value)}
              aria-label="Rest"
            >
              {ROUTINE_REST_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="input-suffix" aria-hidden="true">rest</span>
          </div>
        </div>
      </div>
      <input
        className="input"
        value={item.notes}
        onChange={(event) => updateItem(index, 'notes', event.target.value)}
        placeholder="Notes or cues"
      />
    </div>
  );

  return (
    <form className="routine-editor-form" onSubmit={handleSubmit}>
      <motion.div
        ref={scrollContainerRef}
        className="stack routine-editor-scroll"
        variants={motionConfig.variants.listStagger}
        initial="hidden"
        animate="visible"
      >
        <AnimatePresence initial={false}>
          {formError ? (
            <motion.div
              className="notice"
              variants={motionConfig.variants.fadeUp}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              {formError}
            </motion.div>
          ) : null}
        </AnimatePresence>
        <motion.div className="form-row" variants={motionConfig.variants.listItem}>
          <div>
            <label>Routine name</label>
            <input
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Push Day"
              required
            />
          </div>
          <div>
            <label>Notes</label>
            <input
              className="input"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Tempo, cues, goals"
            />
          </div>
          <div>
            <label>Routine type</label>
            <div className="inline" role="radiogroup" aria-label="Routine type">
              <label>
                <input
                  type="radio"
                  name="routine-type"
                  value="standard"
                  checked={normalizeRoutineType(routineType) === 'standard'}
                  onChange={(event) => setRoutineType(normalizeRoutineType(event.target.value))}
                />
                {' '}
                Standard
              </label>
              <label>
                <input
                  type="radio"
                  name="routine-type"
                  value="rehab"
                  checked={normalizeRoutineType(routineType) === 'rehab'}
                  onChange={(event) => setRoutineType(normalizeRoutineType(event.target.value))}
                />
                {' '}
                Rehab
              </label>
            </div>
          </div>
        </motion.div>
        <motion.div className="stack" layout>
          {itemBlocks.map((block, blockIndex) => {
            const blockItems = items.slice(block.startIndex, block.endIndex + 1);
            const blockKey = blockItems
              .map((item, offset) => item.editorId || `fallback-${block.startIndex + offset}`)
              .join('|');
            return (
              <motion.div
                key={blockKey}
                layout
                className={`card ${block.isSuperset ? 'routine-editor-item-paired' : ''}`}
                style={{ boxShadow: 'none' }}
                variants={blockMotionVariants}
                initial="hidden"
                animate="visible"
                transition={{
                  ...motionConfig.transition.standard,
                  layout: motionConfig.transition.springSoft,
                }}
                draggable
                onDragStart={() => setDragIndex(block.startIndex)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (dragIndex === null) return;
                  moveBlockTo(dragIndex, block.startIndex);
                  setDragIndex(null);
                }}
                onDragEnd={() => setDragIndex(null)}
              >
                <motion.div className="stack routine-editor-block-content" layout="position">
                  {block.isSuperset ? (
                    <div className="inline">
                      <span className="badge badge-superset">Superset</span>
                    </div>
                  ) : null}
                  <motion.div
                    className={`stack ${block.isSuperset ? 'routine-editor-paired-items' : ''}`}
                    layout="position"
                  >
                    {blockItems.map((item, offset) => {
                      const itemIndex = block.startIndex + offset;
                      return (
                        <motion.div
                          key={item.editorId || `routine-item-${itemIndex}`}
                          className={`stack routine-editor-item-shell ${block.isSuperset && offset > 0 ? 'routine-editor-paired-item' : ''}`}
                          data-routine-editor-item-id={item.editorId || undefined}
                          layout="position"
                        >
                          {renderRoutineEditorItemFields(item, itemIndex)}
                        </motion.div>
                      );
                    })}
                  </motion.div>
                  <motion.div className="inline routine-item-actions" layout="position">
                    {block.isSuperset ? (
                      <button
                        type="button"
                        className="button ghost"
                        onClick={() => togglePairWithNext(block.startIndex)}
                      >
                        Unpair
                      </button>
                    ) : block.startIndex < items.length - 1
                    && !itemBlocks[blockIndex + 1]?.isSuperset ? (
                      <button
                        type="button"
                        className="button ghost"
                        onClick={() => togglePairWithNext(block.startIndex)}
                      >
                        Pair with next
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="button ghost icon-button"
                      onClick={() => moveBlock(block.startIndex, -1)}
                      aria-label="Move exercise up"
                      title="Move up"
                      disabled={blockIndex === 0}
                    >
                      <FaArrowUp aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="button ghost icon-button"
                      onClick={() => moveBlock(block.startIndex, 1)}
                      aria-label="Move exercise down"
                      title="Move down"
                      disabled={blockIndex === itemBlocks.length - 1}
                    >
                      <FaArrowDown aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="button ghost icon-button"
                      onClick={() => removeBlock(block.startIndex, block.endIndex)}
                      aria-label="Remove exercise"
                      title="Remove"
                    >
                      <FaTrashCan aria-hidden="true" />
                    </button>
                  </motion.div>
                </motion.div>
              </motion.div>
            );
          })}
        </motion.div>
      </motion.div>
      <motion.div className="routine-editor-footer routine-editor-footer-fixed" layout="position">
        <motion.button
          type="button"
          className="button ghost"
          onClick={addItem}
          whileTap={motionConfig.reducedMotion ? undefined : { scale: motionConfig.tapScale }}
        >
          + Add exercise
        </motion.button>
        <motion.button
          type="submit"
          className="button routine-editor-save"
          whileTap={motionConfig.reducedMotion ? undefined : { scale: motionConfig.tapScale }}
        >
          Save
        </motion.button>
      </motion.div>
    </form>
  );
}

function ExercisesPage() {
  const { resolvedReducedMotion } = useMotionPreferences();
  const motionConfig = useMemo(
    () => getMotionConfig(resolvedReducedMotion),
    [resolvedReducedMotion]
  );
  const [exercises, setExercises] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    name: '',
    primaryMuscle: '',
    secondaryMuscles: [],
    level: 'beginner',
    category: 'strength',
    notes: '',
    images: [],
    instructions: '',
  });
  const [editingId, setEditingId] = useState(null);
  const [editingForm, setEditingForm] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);
  const [highlightId, setHighlightId] = useState(null);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [impactSummary, setImpactSummary] = useState(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [filterMode, setFilterMode] = useState('active');
  const [libraryQuery, setLibraryQuery] = useState('');
  const [libraryResults, setLibraryResults] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [showLibraryModal, setShowLibraryModal] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const query = filterMode === 'active' ? '/api/exercises' : `/api/exercises?mode=${filterMode}`;
      const data = await apiFetch(query);
      setExercises(data.exercises || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [filterMode]);

  useEffect(() => {
    setMergeTargetId('');
    setImpactSummary(null);
    if (!editingId) return undefined;

    let active = true;
    setImpactLoading(true);
    apiFetch(`/api/exercises/${editingId}/impact`)
      .then((data) => {
        if (!active) return;
        setImpactSummary(data.impact || null);
      })
      .catch((err) => {
        if (!active) return;
        setError(err.message);
      })
      .finally(() => {
        if (active) {
          setImpactLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [editingId]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (!libraryQuery.trim()) {
        if (active) setLibraryResults([]);
        return;
      }
      setLibraryLoading(true);
      try {
        const encoded = encodeURIComponent(libraryQuery.trim());
        const data = await apiFetch(`/api/exercise-library?q=${encoded}&limit=20`);
        if (!active) return;
        setLibraryResults(data.results || []);
      } catch (err) {
        if (!active) return;
        setError(err.message);
      } finally {
        if (active) setLibraryLoading(false);
      }
    };
    run();
    return () => {
      active = false;
    };
  }, [libraryQuery]);

  const createExercise = async (payload) => {
    setError(null);
    if (!payload.primaryMuscle) {
      setError('Primary muscle is required.');
      return;
    }
    try {
      const data = await apiFetch('/api/exercises', {
        method: 'POST',
        body: JSON.stringify({
          name: payload.name,
          primaryMuscles: [payload.primaryMuscle],
          secondaryMuscles: payload.secondaryMuscles,
          level: payload.level,
          category: payload.category,
          notes: payload.notes,
          instructions: parseInstructionsFromTextarea(payload.instructions),
          images: payload.images || [],
        }),
      });
      setExercises((prev) => [...prev, data.exercise]);
      setForm({
        name: '',
        primaryMuscle: '',
        secondaryMuscles: [],
        level: 'beginner',
        category: 'strength',
        notes: '',
        images: [],
        instructions: '',
      });
      setSearchQuery('');
      setShowNewForm(false);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    await createExercise(form);
  };

  const handleQuickCreate = () => {
    const name = searchQuery.trim();
    if (!name) return;
    setForm((prev) => ({ ...prev, name }));
    setShowNewForm(true);
  };

  const handleSave = async (exerciseId) => {
    setError(null);
    try {
      const nextInstructions = parseInstructionsFromTextarea(editingForm.instructions);
      const payload = {
        ...editingForm,
        primaryMuscles: editingForm.primaryMuscle ? [editingForm.primaryMuscle] : [],
        instructions: nextInstructions,
      };
      delete payload.primaryMuscle;
      await apiFetch(`/api/exercises/${exerciseId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setExercises((prev) =>
        prev.map((exercise) =>
          exercise.id === exerciseId
            ? {
                ...exercise,
                ...editingForm,
                primaryMuscles: editingForm.primaryMuscle ? [editingForm.primaryMuscle] : [],
                instructions: nextInstructions,
              }
            : exercise
        )
      );
      setEditingId(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleMerge = async () => {
    if (!editingId || !mergeTargetId) return;
    const targetId = Number(mergeTargetId);
    if (!targetId || targetId === editingId) return;
    const source = exercises.find((exercise) => exercise.id === editingId);
    const target = exercises.find((exercise) => exercise.id === targetId);
    const sourceName = source?.name || 'this exercise';
    const targetName = target?.name || 'the target';
    let impact = impactSummary;
    if (!impact) {
      try {
        const impactData = await apiFetch(`/api/exercises/${editingId}/impact`);
        impact = impactData.impact || null;
        setImpactSummary(impact);
      } catch (err) {
        setError(err.message);
        return;
      }
    }
    const confirmed = window.confirm(
      `Merge "${sourceName}" into "${targetName}"?\n\nImpact: ${formatExerciseImpact(
        impact
      )}\n\nThis will move routines and stats, then archive "${sourceName}".`
    );
    if (!confirmed) return;

    setError(null);
    try {
      await apiFetch('/api/exercises/merge', {
        method: 'POST',
        body: JSON.stringify({ sourceId: editingId, targetId }),
      });
      setEditingId(null);
      setMergeTargetId('');
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleUnarchive = async (exerciseId) => {
    setError(null);
    try {
      await apiFetch(`/api/exercises/${exerciseId}/unarchive`, {
        method: 'POST',
      });
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleArchive = async () => {
    if (!editingId) return;
    const source = exercises.find((exercise) => exercise.id === editingId);
    const sourceName = source?.name || 'this exercise';
    let impact = impactSummary;
    if (!impact) {
      try {
        const impactData = await apiFetch(`/api/exercises/${editingId}/impact`);
        impact = impactData.impact || null;
        setImpactSummary(impact);
      } catch (err) {
        setError(err.message);
        return;
      }
    }
    const confirmed = window.confirm(
      `Archive "${sourceName}"?\n\nImpact: ${formatExerciseImpact(
        impact
      )}\n\nThis hides it from active lists but keeps historical data.`
    );
    if (!confirmed) return;

    setError(null);
    try {
      await apiFetch(`/api/exercises/${editingId}`, {
        method: 'DELETE',
      });
      setEditingId(null);
      setMergeTargetId('');
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  const openExerciseEditor = (exercise) => {
    setEditingId(exercise.id);
    const primaryMuscles = normalizeExercisePrimaryMuscles(exercise);
    setEditingForm({
      name: exercise.name,
      primaryMuscle: primaryMuscles[0] || '',
      secondaryMuscles: Array.isArray(exercise.secondaryMuscles) ? exercise.secondaryMuscles : [],
      level: exercise.level || 'beginner',
      category: exercise.category || 'strength',
      force: exercise.force || '',
      mechanic: exercise.mechanic || '',
      equipment: exercise.equipment || '',
      images: Array.isArray(exercise.images) ? exercise.images : [],
      notes: exercise.notes || '',
      instructions: formatInstructionsForTextarea(exercise.instructions),
    });
  };

  const handleAddFromLibrary = async (forkId) => {
    try {
      const data = await apiFetch(`/api/exercise-library/${encodeURIComponent(forkId)}/add`, {
        method: 'POST',
      });
      const exercise = data.exercise;
      setExercises((prev) => {
        const existing = prev.some((item) => item.id === exercise.id);
        if (existing) {
          return prev.map((item) => (item.id === exercise.id ? exercise : item));
        }
        return [...prev, exercise];
      });
      setLibraryResults((prev) =>
        prev.map((item) => (item.forkId === forkId ? { ...item, alreadyAdded: true } : item))
      );
    } catch (err) {
      setError(err.message);
    }
  };


  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredExercises = exercises.filter((exercise) => {
    if (!normalizedQuery) return true;
    const searchable = [
      exercise.name,
      ...normalizeExercisePrimaryMuscles(exercise),
      ...(Array.isArray(exercise.secondaryMuscles) ? exercise.secondaryMuscles : []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return searchable.includes(normalizedQuery);
  });
  const nameExists = exercises.some(
    (exercise) => exercise.name.toLowerCase() === normalizedQuery
  );

  const normalizedFormName = form.name.trim().toLowerCase();
  const formMatches = normalizedFormName
    ? exercises.filter((exercise) =>
        exercise.name.toLowerCase().includes(normalizedFormName)
      )
    : [];
  const exactFormMatch = exercises.some(
    (exercise) => exercise.name.toLowerCase() === normalizedFormName
  );
  const canSaveExercise = form.name.trim() && form.primaryMuscle && !exactFormMatch;
  const editingExercise = editingId
    ? exercises.find((exercise) => exercise.id === editingId) || null
    : null;
  const duplicateEditName = Boolean(
    editingExercise &&
      exercises.some(
        (item) =>
          item.id !== editingExercise.id &&
          item.name.toLowerCase() === editingForm.name?.trim().toLowerCase()
      )
  );
  const canSaveEdit =
    editingExercise && editingForm.name?.trim() && editingForm.primaryMuscle && !duplicateEditName;
  const mergeTargets = editingExercise
    ? exercises.filter(
        (item) => item.id !== editingExercise.id && !item.archivedAt && !item.mergedIntoId
      )
    : [];

  return (
    <motion.div
      className="stack"
      variants={motionConfig.variants.listStagger}
      initial="hidden"
      animate="visible"
    >
      <div>
        <h2 className="section-title">Exercises</h2>
        <p className="muted">Curate your library for fast logging.</p>
      </div>
      <AnimatePresence initial={false}>
        {error ? (
          <motion.div
            className="notice"
            variants={motionConfig.variants.fadeUp}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {error}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="card">
        <div className="section-title">Find or add exercise</div>
        <div className="stack">
          <div>
            <label>Library view</label>
            <select
              value={filterMode}
              onChange={(event) => setFilterMode(event.target.value)}
            >
              <option value="active">Active</option>
              <option value="archived">Archived</option>
              <option value="all">All</option>
            </select>
          </div>
          <div>
            <label>Filter exercises</label>
            <input
              className="input"
              placeholder="Search by name or muscle group"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>
          <div className="inline">
            <button
              className="button ghost"
              type="button"
              onClick={() => setShowLibraryModal(true)}
            >
              Add from external library
            </button>
          </div>
          {normalizedQuery ? (
            <div className="inline">
              <button
                className="button"
                type="button"
                onClick={handleQuickCreate}
                disabled={nameExists}
              >
                {nameExists ? 'Already in library' : `Add "${searchQuery.trim()}"`}
              </button>
              <button
                className="button ghost"
                type="button"
                onClick={() => setSearchQuery('')}
              >
                Clear
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {showNewForm ? (
        <div className="card">
          <div className="section-title">New exercise</div>
          <form className="stack" onSubmit={handleCreate}>
            <div className="form-row">
              <div>
                <label>Name</label>
                <input
                  className="input"
                  value={form.name}
                  onChange={(event) => {
                    const nextName = event.target.value;
                    setForm({ ...form, name: nextName });
                    setSearchQuery(nextName);
                    setHighlightId(null);
                  }}
                  required
                />
              </div>
              <div>
                <label>Primary muscle</label>
                <select
                  value={form.primaryMuscle}
                  onChange={(event) => setForm({ ...form, primaryMuscle: event.target.value })}
                  required
                >
                  <option value="">Select muscle</option>
                  {PRIMARY_MUSCLE_OPTIONS.map((muscle) => (
                    <option key={muscle} value={muscle}>
                      {formatMuscleLabel(muscle)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label>Secondary muscles</label>
              <select
                multiple
                value={form.secondaryMuscles}
                onChange={(event) =>
                  setForm({
                    ...form,
                    secondaryMuscles: Array.from(event.target.selectedOptions).map((option) => option.value),
                  })
                }
              >
                {PRIMARY_MUSCLE_OPTIONS.map((muscle) => (
                  <option key={muscle} value={muscle}>
                    {formatMuscleLabel(muscle)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Notes</label>
              <textarea
                rows="2"
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
              />
            </div>
            <div>
              <label>Instructions (one step per line)</label>
              <textarea
                rows="4"
                value={form.instructions}
                onChange={(event) => setForm({ ...form, instructions: event.target.value })}
              />
            </div>
            {normalizedFormName ? (
              <div className="stack">
                {exactFormMatch ? (
                  <div className="notice">
                    This exercise already exists. Open it from the list below.
                  </div>
                ) : null}
                {formMatches.length ? (
                  <div className="stack">
                    <div className="muted">Matches</div>
                    <div className="stack">
                      {formMatches.slice(0, 5).map((exercise) => (
                        <div
                          key={exercise.id}
                          className="split"
                          style={{
                            padding: '0.65rem 0.9rem',
                            borderRadius: '12px',
                            border: '1px solid var(--border)',
                            background:
                              highlightId === exercise.id ? 'var(--accent-soft)' : 'var(--bg)',
                          }}
                        >
                          <div>
                            <div className="section-title" style={{ fontSize: '1rem' }}>
                              {exercise.name}
                            </div>
                            <div className="inline">
                              {normalizeExercisePrimaryMuscles(exercise)[0] ? (
                                <span
                                  className="badge badge-group"
                                >
                                  {formatMuscleLabel(normalizeExercisePrimaryMuscles(exercise)[0])}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="inline">
                            <button
                              className="button ghost"
                              type="button"
                              onClick={() => {
                                openExerciseEditor(exercise);
                                setHighlightId(exercise.id);
                              }}
                            >
                              Open
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="inline">
              <button className="button" type="submit" disabled={!canSaveExercise}>
                Save exercise
              </button>
              <button
                className="button ghost"
                type="button"
                onClick={() => setShowNewForm(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <AnimatePresence>
        {showLibraryModal ? (
          <AnimatedModal onClose={() => setShowLibraryModal(false)} panelClassName="routine-modal">
            <div className="split">
              <div className="section-title" style={{ marginBottom: 0 }}>
                Add from external library
              </div>
              <button
                className="button ghost icon-button"
                type="button"
                aria-label="Close external library"
                title="Close"
                onClick={() => setShowLibraryModal(false)}
              >
                <FaXmark aria-hidden="true" />
              </button>
            </div>
            <div className="stack" style={{ marginTop: '1rem' }}>
              <div>
                <label>Search library by exercise name</label>
                <input
                  className="input"
                  placeholder="e.g. bench press"
                  value={libraryQuery}
                  onChange={(event) => setLibraryQuery(event.target.value)}
                />
              </div>
              {libraryLoading ? <div className="muted">Searching library…</div> : null}
              {!libraryLoading && libraryQuery.trim() && !libraryResults.length ? (
                <div className="muted">No external library matches.</div>
              ) : null}
              {!libraryLoading && libraryResults.length ? (
                <div className="stack">
                  {libraryResults.slice(0, 12).map((item) => (
                    <div key={item.forkId} className="split" style={{ gap: '0.75rem' }}>
                      <div className="inline" style={{ gap: '0.75rem', alignItems: 'center' }}>
                        {item.imageUrls?.[0] ? (
                          <img
                            src={item.imageUrls[0]}
                            alt={item.name}
                            style={{ width: 52, height: 52, borderRadius: '10px', objectFit: 'cover' }}
                          />
                        ) : null}
                        <div>
                          <div style={{ fontWeight: 600 }}>{item.name}</div>
                          <div className="muted" style={{ fontSize: '0.85rem' }}>
                            {item.primaryMuscles?.length
                              ? item.primaryMuscles.map((muscle) => formatMuscleLabel(muscle)).join(', ')
                              : 'Unspecified'}
                          </div>
                        </div>
                      </div>
                      <button
                        className="button ghost"
                        type="button"
                        disabled={item.alreadyAdded}
                        onClick={() => handleAddFromLibrary(item.forkId)}
                      >
                        {item.alreadyAdded ? 'Added' : 'Add'}
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </AnimatedModal>
        ) : null}
      </AnimatePresence>

      {loading ? (
        <div className="card">Loading exercises…</div>
      ) : filteredExercises.length ? (
        filteredExercises.map((exercise) => (
          <motion.div
            key={exercise.id}
            className="card"
            variants={motionConfig.variants.listItem}
            style={exercise.archivedAt ? { opacity: 0.85 } : undefined}
          >
            <div className="exercise-card-header">
              <div className="section-title exercise-card-title">{exercise.name}</div>
              <div className="exercise-card-meta">
                <div className="inline exercise-card-badges">
                  {normalizeExercisePrimaryMuscles(exercise)[0] ? (
                    <span
                      className="badge badge-group"
                    >
                      {formatMuscleLabel(normalizeExercisePrimaryMuscles(exercise)[0])}
                    </span>
                  ) : null}
                  {exercise.archivedAt ? <span className="tag">Archived</span> : null}
                </div>
                <div className="inline exercise-card-header-actions">
                  <button
                    className="button ghost icon-button"
                    type="button"
                    aria-label="Edit"
                    title="Edit"
                    onClick={() => openExerciseEditor(exercise)}
                  >
                    <FaPenToSquare />
                  </button>
                  {exercise.archivedAt && !exercise.mergedIntoId ? (
                    <button
                      className="button ghost"
                      type="button"
                      onClick={() => handleUnarchive(exercise.id)}
                    >
                      Unarchive
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
            {exercise.images?.[0] ? (
              <img
                src={resolveExerciseImageUrl(exercise.images[0])}
                alt={exercise.name}
                style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: '12px', marginTop: '0.8rem' }}
              />
            ) : null}
            {exercise.notes ? <div className="muted">Notes: {exercise.notes}</div> : null}
            {exercise.mergedIntoId ? (
              <div className="muted">
                Merged into {exercise.mergedIntoName || `#${exercise.mergedIntoId}`}
                {exercise.mergedAt ? ` on ${formatDateTime(exercise.mergedAt)}` : ''}.
              </div>
            ) : null}
            {exercise.lastSet ? (
              <div className="tag" style={{ marginTop: '0.6rem' }}>
                Last: {exercise.lastSet.weight} kg × {exercise.lastSet.reps}
              </div>
            ) : null}
          </motion.div>
        ))
      ) : (
        <div className="empty">
          {exercises.length
            ? `No exercises match "${searchQuery.trim()}".`
            : 'No exercises yet. Add your first movement.'}
        </div>
      )}
      <AnimatePresence>
        {editingExercise ? (
          <AnimatedModal onClose={() => setEditingId(null)} panelClassName="routine-modal">
            <div className="split">
              <div className="section-title" style={{ marginBottom: 0 }}>
                Edit exercise
              </div>
              <button
                className="button ghost icon-button"
                type="button"
                aria-label="Close exercise editor"
                title="Close exercise editor"
                onClick={() => setEditingId(null)}
              >
                <FaXmark aria-hidden="true" />
              </button>
            </div>
            <div className="stack" style={{ marginTop: '1rem' }}>
              <div className="form-row">
                <div>
                  <label>Name</label>
                  <input
                    className="input"
                    value={editingForm.name}
                    onChange={(event) =>
                      setEditingForm({ ...editingForm, name: event.target.value })
                    }
                    required
                  />
                </div>
                <div>
                  <label>Primary muscle</label>
                  <select
                    value={editingForm.primaryMuscle}
                    onChange={(event) =>
                      setEditingForm({ ...editingForm, primaryMuscle: event.target.value })
                    }
                    required
                  >
                    <option value="">Select muscle</option>
                    {PRIMARY_MUSCLE_OPTIONS.map((muscle) => (
                      <option key={muscle} value={muscle}>
                        {formatMuscleLabel(muscle)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label>Secondary muscles</label>
                <select
                  multiple
                  value={editingForm.secondaryMuscles || []}
                  onChange={(event) =>
                    setEditingForm({
                      ...editingForm,
                      secondaryMuscles: Array.from(event.target.selectedOptions).map((option) => option.value),
                    })
                  }
                >
                  {PRIMARY_MUSCLE_OPTIONS.map((muscle) => (
                    <option key={muscle} value={muscle}>
                      {formatMuscleLabel(muscle)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label>Notes</label>
                <textarea
                  rows="2"
                  value={editingForm.notes}
                  onChange={(event) =>
                    setEditingForm({ ...editingForm, notes: event.target.value })
                  }
                />
              </div>
              <div>
                <label>Instructions (one step per line)</label>
                <textarea
                  rows="4"
                  value={editingForm.instructions || ''}
                  onChange={(event) =>
                    setEditingForm({ ...editingForm, instructions: event.target.value })
                  }
                />
              </div>
              {duplicateEditName ? (
                <div className="notice">
                  Another exercise already uses this exact name. Choose a unique name.
                </div>
              ) : null}
              <details className="stack exercise-edit-section">
                <summary className="exercise-edit-section-summary">
                  <span className="section-title" style={{ fontSize: '1rem' }}>
                    Merge exercise
                  </span>
                </summary>
                <div className="stack">
                  <div className="muted">
                    Merging moves routines and workout history into the target exercise, then
                    archives this one. Use it to clean up duplicates.
                  </div>
                  {impactLoading ? (
                    <div className="muted">Loading impact…</div>
                  ) : impactSummary ? (
                    <div className="tag">Impact: {formatExerciseImpact(impactSummary)}</div>
                  ) : null}
                  {mergeTargets.length ? (
                    <div className="inline">
                      <select
                        value={mergeTargetId}
                        onChange={(event) => setMergeTargetId(event.target.value)}
                      >
                        <option value="">Select target exercise</option>
                        {mergeTargets.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                      <button
                        className="button ghost"
                        type="button"
                        onClick={handleMerge}
                        disabled={!mergeTargetId}
                      >
                        Merge
                      </button>
                    </div>
                  ) : (
                    <div className="muted">No other exercises available to merge into.</div>
                  )}
                </div>
              </details>
              <details className="stack exercise-edit-section">
                <summary className="exercise-edit-section-summary">
                  <span className="section-title" style={{ fontSize: '1rem' }}>
                    Archive exercise
                  </span>
                </summary>
                <div className="stack">
                  <div className="muted">
                    Archive removes the exercise from active pickers while retaining historical
                    data for routines and logged sets.
                  </div>
                  <div className="inline">
                    <button className="button ghost" type="button" onClick={handleArchive}>
                      Archive
                    </button>
                  </div>
                </div>
              </details>
              <div className="routine-editor-footer">
                <button
                  className="button routine-editor-save"
                  type="button"
                  onClick={() => handleSave(editingExercise.id)}
                  disabled={!canSaveEdit}
                >
                  Save
                </button>
              </div>
            </div>
          </AnimatedModal>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

function StatsPage() {
  const { resolvedReducedMotion } = useMotionPreferences();
  const motionConfig = useMemo(
    () => getMotionConfig(resolvedReducedMotion),
    [resolvedReducedMotion]
  );
  const [stats, setStats] = useState(null);
  const [weights, setWeights] = useState([]);
  const [exerciseOptions, setExerciseOptions] = useState([]);
  const [selectedExerciseId, setSelectedExerciseId] = useState('');
  const [statsRoutineType, setStatsRoutineType] = useState('standard');
  const [timeseriesBucket, setTimeseriesBucket] = useState('week');
  const [timeseriesWindow, setTimeseriesWindow] = useState('180d');
  const [progressionWindow, setProgressionWindow] = useState('90d');
  const [distributionMetric, setDistributionMetric] = useState('frequency');
  const [distributionWindow, setDistributionWindow] = useState('30d');
  const [bodyweightWindow, setBodyweightWindow] = useState('90d');
  const [timeseries, setTimeseries] = useState(null);
  const [progression, setProgression] = useState(null);
  const [distribution, setDistribution] = useState(null);
  const [bodyweightTrend, setBodyweightTrend] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [chartAnimationMode, setChartAnimationMode] = useState('initial');
  const hasLoadedAnalyticsRef = useRef(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [statsData, weightData, exerciseData] = await Promise.all([
          apiFetch(`/api/stats/overview?routineType=${statsRoutineType}`),
          apiFetch('/api/weights?limit=8'),
          apiFetch('/api/exercises'),
        ]);
        if (!active) return;
        setStats(statsData);
        setWeights(weightData.weights || []);
        const options = exerciseData.exercises || [];
        setExerciseOptions(options);
        if (!selectedExerciseId && options.length) {
          setSelectedExerciseId(String(options[0].id));
        }
      } catch (err) {
        if (!active) return;
        setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [statsRoutineType]);

  useEffect(() => {
    let active = true;
    const loadAnalytics = async () => {
      setAnalyticsLoading(true);
      setError(null);
      try {
        const progressionPath = selectedExerciseId
          ? `/api/stats/progression?exerciseId=${selectedExerciseId}&window=${progressionWindow}&routineType=${statsRoutineType}`
          : null;
        const requests = await Promise.all([
          apiFetch(`/api/stats/timeseries?bucket=${timeseriesBucket}&window=${timeseriesWindow}&routineType=${statsRoutineType}`),
          progressionPath ? apiFetch(progressionPath) : Promise.resolve(null),
          apiFetch(`/api/stats/distribution?metric=${distributionMetric}&window=${distributionWindow}&routineType=${statsRoutineType}`),
          apiFetch(`/api/stats/bodyweight-trend?window=${bodyweightWindow}`),
        ]);
        if (!active) return;
        setTimeseries(requests[0]);
        setProgression(requests[1]);
        setDistribution(requests[2]);
        setBodyweightTrend(requests[3]);
        setChartAnimationMode(hasLoadedAnalyticsRef.current ? 'update' : 'initial');
        hasLoadedAnalyticsRef.current = true;
      } catch (err) {
        if (!active) return;
        setError(err.message);
      } finally {
        if (active) {
          setAnalyticsLoading(false);
        }
      }
    };
    loadAnalytics();
    return () => {
      active = false;
    };
  }, [
    selectedExerciseId,
    progressionWindow,
    statsRoutineType,
    distributionMetric,
    distributionWindow,
    bodyweightWindow,
    timeseriesBucket,
    timeseriesWindow,
  ]);

  const summary = stats?.summary || {};
  const elapsedSinceLastSession = useMemo(
    () => formatElapsedSince(summary.lastSessionAt),
    [summary.lastSessionAt]
  );

  const timeseriesData = useMemo(() => {
    const basePoints = (timeseries?.points || []).map((point) => ({
      bucketKey: String(point.bucketKey || ''),
      label: String(point.label || ''),
      startAt: point.startAt,
      sets: Number(point.sets || 0),
      volume: Number(point.volume || 0),
      sessions: Number(point.sessions || 0),
      uniqueExercises: Number(point.uniqueExercises || 0),
      avgSetWeight: Number(point.avgSetWeight || 0),
    }));
    const sessionsTrend = buildLinearTrendline(basePoints, 'sessions');
    return basePoints.map((point, index) => ({
      ...point,
      sessionsTrend: sessionsTrend[index],
    }));
  }, [timeseries]);

  const progressionData = useMemo(() => {
    const basePoints = (progression?.points || []).map((point, index) => ({
      id: `${point.sessionId || 'session'}-${index}`,
      label: formatDate(point.startedAt),
      startedAt: point.startedAt,
      topWeight: Number(point.topWeight || 0),
      topReps: Number(point.topReps || 0),
      topVolume: Number(point.topVolume || 0),
    }));
    const topWeightTrend = buildLinearTrendline(basePoints, 'topWeight');
    const topWeightMoving = buildMovingAverage(basePoints, 'topWeight', 7);
    return basePoints.map((point, index) => ({
      ...point,
      topWeightTrend: topWeightTrend[index],
      topWeightMoving: topWeightMoving[index],
    }));
  }, [progression]);

  const distributionData = useMemo(
    () =>
      (distribution?.rows || []).map((row) => ({
        bucket: String(row.bucket || 'other'),
        label: formatMuscleLabel(row.bucket || 'other'),
        value: Number(row.value || 0),
        share: Number(row.share || 0),
      })),
    [distribution]
  );

  const bodyweightData = useMemo(() => {
    const sourcePoints = (bodyweightTrend?.points || []).length
      ? bodyweightTrend.points
      : weights;
    const sorted = [...sourcePoints].sort((a, b) => {
      const left = new Date(a.measuredAt || a.measured_at).getTime();
      const right = new Date(b.measuredAt || b.measured_at).getTime();
      return left - right;
    });
    const basePoints = sorted.map((entry, index) => ({
      id: `${entry.id || 'weight'}-${index}`,
      measuredAt: entry.measuredAt || entry.measured_at,
      label: formatDate(entry.measuredAt || entry.measured_at),
      weight: Number(entry.weight || 0),
    }));
    const trend = buildLinearTrendline(basePoints, 'weight');
    const movingAverage = buildMovingAverage(basePoints, 'weight', 7);
    return basePoints.map((point, index) => ({
      ...point,
      trend: trend[index],
      movingAverage: movingAverage[index],
    }));
  }, [bodyweightTrend, weights]);
  const chartAnimation = useMemo(
    () => getChartAnimationConfig(resolvedReducedMotion, chartAnimationMode),
    [resolvedReducedMotion, chartAnimationMode]
  );

  if (loading) {
    return <div className="card">Loading stats…</div>;
  }

  if (error) {
    return <div className="notice">{error}</div>;
  }

  return (
    <motion.div
      className="stack stats-page"
      variants={motionConfig.variants.listStagger}
      initial="hidden"
      animate="visible"
    >
      <div>
        <div className="split">
          <div>
            <h2 className="section-title">Stats</h2>
            <p className="muted">Progression insights with weekly and monthly trend lines.</p>
          </div>
          <div className="stats-controls">
            <select
              aria-label="Stats routine type"
              value={statsRoutineType}
              onChange={(event) => setStatsRoutineType(event.target.value)}
            >
              <option value="standard">Standard</option>
              <option value="rehab">Rehab</option>
              <option value="all">All</option>
            </select>
          </div>
        </div>
      </div>

      <div className="stats-kpi-grid">
        <div className="card stats-kpi-card">
          <div className="muted stats-kpi-label">Workouts</div>
          <div className="section-title">{formatNumber(summary.sessionsWeek)} / {formatNumber(summary.sessionsMonth)}</div>
          <div className="muted stats-kpi-meta">7d / 30d</div>
        </div>
        <div className="card stats-kpi-card">
          <div className="muted stats-kpi-label">Sets</div>
          <div className="section-title">{formatNumber(summary.setsWeek)} / {formatNumber(summary.setsMonth)}</div>
          <div className="muted stats-kpi-meta">7d / 30d</div>
        </div>
        <div className="card stats-kpi-card">
          <div className="muted stats-kpi-label">Time since last workout</div>
          <div className="section-title">{elapsedSinceLastSession}</div>
          <div className="muted stats-kpi-meta">
            {summary.lastSessionAt ? `Last workout: ${formatDate(summary.lastSessionAt)}` : 'No workouts yet'}
          </div>
        </div>
        <div className="card stats-kpi-card">
          <div className="muted stats-kpi-label">Exercises</div>
          <div className="section-title">{formatNumber(summary.uniqueExercisesWeek)} / {formatNumber(summary.uniqueExercisesMonth)}</div>
          <div className="muted stats-kpi-meta">7d / 30d</div>
        </div>
        <div className="card stats-kpi-card">
          <div className="muted stats-kpi-label">Bodyweight delta</div>
          <div className="section-title">
            {bodyweightTrend?.summary?.delta == null ? '—' : `${formatNumber(bodyweightTrend.summary.delta)} kg`}
          </div>
          <div className="muted stats-kpi-meta">{formatNumber(summary.totalSessions)} total workouts</div>
        </div>
        <div className="card stats-kpi-card">
          <div className="muted stats-kpi-label">Avg Workouts per week</div>
          <div className="section-title">{formatNumber(summary.avgSessionsPerWeek)}</div>
          <div className="muted stats-kpi-meta">Rolling 90d average</div>
        </div>
        <div className="card stats-kpi-card">
          <div className="muted stats-kpi-label">Time spent per week</div>
          <div className="section-title">{formatDurationMinutes(summary.timeSpentWeekMinutes)}</div>
          <div className="muted stats-kpi-meta">Last 7 days</div>
        </div>
        <div className="card stats-kpi-card">
          <div className="muted stats-kpi-label">Warmup time</div>
          <div className="section-title">{formatDurationMinutes(summary.warmupWeekMinutes)}</div>
          <div className="muted stats-kpi-meta">Last 7 days</div>
        </div>
        <div className="card stats-kpi-card">
          <div className="muted stats-kpi-label">Avg workout time</div>
          <div className="section-title">{formatDurationMinutes(summary.avgSessionTimeMinutes)}</div>
          <div className="muted stats-kpi-meta">Completed workouts (30d)</div>
        </div>
      </div>

      <div className="card stats-card">
        <div className="stats-card-header">
          <div>
            <div className="section-title">Workload over time</div>
            <p className="muted stats-card-subtitle">Set and workout counts per selected time bucket.</p>
          </div>
          <div className="stats-controls">
            <select
              aria-label="Timeseries bucket"
              value={timeseriesBucket}
              onChange={(event) => setTimeseriesBucket(event.target.value)}
            >
              <option value="week">Weekly</option>
              <option value="month">Monthly</option>
            </select>
            <select
              aria-label="Timeseries window"
              value={timeseriesWindow}
              onChange={(event) => setTimeseriesWindow(event.target.value)}
            >
              <option value="90d">90 days</option>
              <option value="180d">180 days</option>
              <option value="365d">365 days</option>
            </select>
          </div>
        </div>
        {analyticsLoading ? (
          <div className="muted">Loading analytics…</div>
        ) : timeseriesData.length ? (
          <div className="stats-chart">
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={timeseriesData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(245, 243, 238, 0.12)" />
                <XAxis dataKey="label" stroke="var(--muted)" />
                <YAxis yAxisId="sets" stroke="var(--muted)" />
                <Tooltip formatter={(value) => formatNumber(value)} />
                <Legend />
                <Bar yAxisId="sets" dataKey="sets" name="Sets" fill="var(--accent)" radius={[6, 6, 0, 0]} {...chartAnimation} />
                <Line yAxisId="sets" type="monotone" dataKey="sessions" name="Workouts" stroke="var(--teal)" strokeWidth={2.2} dot={false} {...chartAnimation} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="muted">No workload data for this window.</div>
        )}
      </div>

      <div className="card-grid two stats-grid">
        <div className="card stats-card">
          <div className="stats-card-header">
            <div>
              <div className="section-title">Exercise activity</div>
              <p className="muted stats-card-subtitle">Workouts and unique exercises per bucket.</p>
            </div>
          </div>
          {analyticsLoading ? (
            <div className="muted">Loading analytics…</div>
          ) : timeseriesData.length ? (
            <div className="stats-chart">
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={timeseriesData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(245, 243, 238, 0.12)" />
                  <XAxis dataKey="label" stroke="var(--muted)" />
                  <YAxis stroke="var(--muted)" />
                  <Tooltip formatter={(value) => formatNumber(value)} />
                  <Legend />
                  <Line type="monotone" dataKey="sessions" name="Workouts" stroke="var(--teal)" strokeWidth={2} dot={false} {...chartAnimation} />
                  <Line type="monotone" dataKey="uniqueExercises" name="Unique exercises" stroke="#9dc07b" strokeWidth={2} dot={false} {...chartAnimation} />
                  <Line type="monotone" dataKey="sessionsTrend" name="Workout trend" stroke="#f4c56a" strokeDasharray="6 6" strokeWidth={2} dot={false} {...chartAnimation} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="muted">No activity data for this window.</div>
          )}
        </div>

        <div className="card stats-card">
          <div className="stats-card-header">
            <div>
              <div className="section-title">Exercise progression</div>
              <p className="muted stats-card-subtitle">Top weight and reps with trend and rolling average.</p>
            </div>
            <div className="stats-controls">
              <select
                aria-label="Progression exercise"
                value={selectedExerciseId}
                onChange={(event) => setSelectedExerciseId(event.target.value)}
              >
                {exerciseOptions.length ? (
                  exerciseOptions.map((exercise) => (
                    <option key={exercise.id} value={exercise.id}>
                      {exercise.name}
                    </option>
                  ))
                ) : (
                  <option value="">No exercises</option>
                )}
              </select>
              <select
                aria-label="Progression window"
                value={progressionWindow}
                onChange={(event) => setProgressionWindow(event.target.value)}
              >
                <option value="90d">90 days</option>
                <option value="180d">180 days</option>
                <option value="365d">365 days</option>
              </select>
            </div>
          </div>
          {analyticsLoading ? (
            <div className="muted">Loading analytics…</div>
          ) : progressionData.length ? (
            <div className="stats-chart">
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={progressionData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(245, 243, 238, 0.12)" />
                  <XAxis dataKey="label" stroke="var(--muted)" />
                  <YAxis yAxisId="weight" stroke="var(--muted)" />
                  <YAxis yAxisId="reps" orientation="right" stroke="var(--muted)" />
                  <Tooltip
                    formatter={(value, name) => {
                      if (name === 'Top reps') return [formatNumber(value), name];
                      return [`${formatNumber(value)} kg`, name];
                    }}
                  />
                  <Legend />
                  <Line yAxisId="weight" dataKey="topWeight" name="Top weight" stroke="var(--accent)" strokeWidth={2.4} dot={false} {...chartAnimation} />
                  <Line yAxisId="weight" dataKey="topWeightMoving" name="7-point average" stroke="#7dc7e4" strokeWidth={2} dot={false} {...chartAnimation} />
                  <Line yAxisId="weight" dataKey="topWeightTrend" name="Weight trend" stroke="#f4c56a" strokeDasharray="6 6" strokeWidth={2} dot={false} {...chartAnimation} />
                  <Line yAxisId="reps" dataKey="topReps" name="Top reps" stroke="#9dc07b" strokeWidth={1.8} dot={false} {...chartAnimation} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="muted">No progression data for this window.</div>
          )}
        </div>
      </div>

      <div className="card-grid two stats-grid">
        <div className="card stats-card">
          <div className="stats-card-header">
            <div>
              <div className="section-title">Muscle-group set distribution</div>
              <p className="muted stats-card-subtitle">Frequency or volume split by primary muscle.</p>
            </div>
            <div className="stats-controls">
              <select
                aria-label="Distribution metric"
                value={distributionMetric}
                onChange={(event) => setDistributionMetric(event.target.value)}
              >
                <option value="frequency">Frequency</option>
                <option value="volume">Volume</option>
              </select>
              <select
                aria-label="Distribution window"
                value={distributionWindow}
                onChange={(event) => setDistributionWindow(event.target.value)}
              >
                <option value="30d">30 days</option>
                <option value="90d">90 days</option>
              </select>
            </div>
          </div>
          {analyticsLoading ? (
            <div className="muted">Loading analytics…</div>
          ) : distributionData.length ? (
            <div className="stats-chart">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={distributionData} layout="vertical" margin={{ left: 16, right: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(245, 243, 238, 0.12)" />
                  <XAxis type="number" stroke="var(--muted)" />
                  <YAxis type="category" dataKey="label" width={120} stroke="var(--muted)" />
                  <Tooltip
                    formatter={(value, name, item) => {
                      const point = item?.payload;
                      if (distributionMetric === 'volume') {
                        return [`${formatNumber(value)} kg`, `${point?.label || name}`];
                      }
                      return [`${formatNumber(value)} sets`, `${point?.label || name}`];
                    }}
                  />
                  <Bar dataKey="value" name="Distribution" fill="var(--accent)" radius={[0, 6, 6, 0]} {...chartAnimation} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="muted">No distribution data for this window.</div>
          )}
        </div>

        <div className="card stats-card">
          <div className="stats-card-header">
            <div>
              <div className="section-title">Bodyweight trend</div>
              <p className="muted stats-card-subtitle">Logged weight with 7-point average and linear trend.</p>
            </div>
            <div className="stats-controls">
              <select
                aria-label="Bodyweight window"
                value={bodyweightWindow}
                onChange={(event) => setBodyweightWindow(event.target.value)}
              >
                <option value="30d">30 days</option>
                <option value="90d">90 days</option>
                <option value="180d">180 days</option>
              </select>
            </div>
          </div>
          {bodyweightTrend?.summary?.latestWeight != null ? (
            <div className="tag stats-chip">
              Start {formatNumber(bodyweightTrend.summary.startWeight)} kg · Latest {formatNumber(bodyweightTrend.summary.latestWeight)} kg · Delta {formatNumber(bodyweightTrend.summary.delta)} kg
            </div>
          ) : null}
          {analyticsLoading ? (
            <div className="muted">Loading analytics…</div>
          ) : bodyweightData.length ? (
            <div className="stats-chart">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={bodyweightData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(245, 243, 238, 0.12)" />
                  <XAxis dataKey="label" stroke="var(--muted)" />
                  <YAxis stroke="var(--muted)" />
                  <Tooltip formatter={(value) => [`${formatNumber(value)} kg`, 'Bodyweight']} />
                  <Legend />
                  <Line dataKey="weight" name="Bodyweight" stroke="var(--accent)" strokeWidth={2.4} dot={false} {...chartAnimation} />
                  <Line dataKey="movingAverage" name="7-point average" stroke="var(--teal)" strokeWidth={2} dot={false} {...chartAnimation} />
                  <Line dataKey="trend" name="Trend" stroke="#f4c56a" strokeDasharray="6 6" strokeWidth={2} dot={false} {...chartAnimation} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="muted">Log weight in the workout view.</div>
          )}
        </div>
      </div>

      <div className="card stats-card">
        <div className="stats-card-header">
          <div>
            <div className="section-title">Recent best lifts</div>
            <p className="muted stats-card-subtitle">Current top recorded set weight per exercise.</p>
          </div>
        </div>
        {(stats?.topExercises || []).length ? (
          <div className="stats-best-lifts-table-wrap">
            <table className="stats-best-lifts-table">
              <thead>
                <tr>
                  <th scope="col">Exercise</th>
                  <th scope="col">Weight</th>
                  <th scope="col">Reps</th>
                </tr>
              </thead>
              <tbody>
                {stats.topExercises.map((exercise) => (
                  <tr key={exercise.exerciseId}>
                    <th scope="row">{exercise.name}</th>
                    <td>{formatNumber(exercise.maxWeight)} kg</td>
                    <td>{formatNumber(exercise.maxReps)} reps</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="muted">No top lift data yet.</div>
        )}
      </div>
    </motion.div>
  );
}

function SettingsPage({ user, onLogout }) {
  const { preference, setPreference, resolvedReducedMotion, motionMode } = useMotionPreferences();
  const motionConfig = useMemo(
    () => getMotionConfig(resolvedReducedMotion),
    [resolvedReducedMotion]
  );
  const [error, setError] = useState(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [importing, setImporting] = useState(false);
  const [validatingImport, setValidatingImport] = useState(false);
  const [pendingImport, setPendingImport] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [importInputKey, setImportInputKey] = useState(0);

  const handleLogout = async () => {
    setError(null);
    try {
      await onLogout();
    } catch (err) {
      setError(err.message);
    }
  };

  const handlePassword = async (event) => {
    event.preventDefault();
    setError(null);
    try {
      await apiFetch('/api/auth/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, nextPassword }),
      });
      setCurrentPassword('');
      setNextPassword('');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleExport = async () => {
    setError(null);
    try {
      const data = await apiFetch('/api/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `trainbook-export-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setValidatingImport(true);
    setPendingImport(null);
    setImportResult(null);
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const validation = await apiFetch('/api/import/validate', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setPendingImport({
        fileName: file.name,
        payload,
        validation,
      });
      if (!validation.valid) {
        setError(validation.errors?.join(' ') || 'Import validation failed.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setValidatingImport(false);
      event.target.value = '';
    }
  };

  const handleConfirmImport = async () => {
    if (!pendingImport?.validation?.valid) return;
    setError(null);
    setImporting(true);
    try {
      const data = await apiFetch('/api/import', {
        method: 'POST',
        body: JSON.stringify(pendingImport.payload),
      });
      setImportResult(data || null);
      setPendingImport(null);
      setImportInputKey((value) => value + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const handleCancelImport = () => {
    setPendingImport(null);
    setImportInputKey((value) => value + 1);
    setImportResult(null);
    setError(null);
  };

  const importSummary = pendingImport?.validation?.summary || null;
  const reuseSummary = importSummary?.toReuse || {};

  return (
    <motion.div
      className="stack"
      variants={motionConfig.variants.listStagger}
      initial="hidden"
      animate="visible"
    >
      <div>
        <h2 className="section-title">Settings</h2>
        <p className="muted">Account controls, backups, and environment.</p>
      </div>
      <AnimatePresence initial={false}>
        {error ? (
          <motion.div
            className="notice"
            variants={motionConfig.variants.fadeUp}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {error}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="card">
        <div className="section-title">Account</div>
        <div className="stack">
          <div className="inline">
            <span className="tag">User</span>
            <strong>{user?.username}</strong>
          </div>
          <form className="stack" onSubmit={handlePassword}>
            <label>Change password</label>
            <input
              className="input"
              type="password"
              placeholder="Current password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
            <input
              className="input"
              type="password"
              placeholder="New password"
              value={nextPassword}
              onChange={(event) => setNextPassword(event.target.value)}
              required
            />
            <button className="button" type="submit">
              Update password
            </button>
          </form>
          <button className="button ghost" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Import & export</div>
        <div className="stack">
          <button className="button" onClick={handleExport}>
            Export JSON
          </button>
          <div>
            <label>Import JSON</label>
            <input
              key={importInputKey}
              type="file"
              accept="application/json"
              onChange={handleImport}
            />
            {validatingImport ? <div className="muted">Validating import…</div> : null}
            {importing ? <div className="muted">Importing…</div> : null}
            {pendingImport ? (
              <div className="stack" style={{ marginTop: '0.75rem' }}>
                <div className="tag">Validation summary for {pendingImport.fileName}</div>
                {importSummary ? (
                  <div className="muted">
                    Create: {importSummary.toCreate.exercises} exercises,{' '}
                    {importSummary.toCreate.routines} routines, {importSummary.toCreate.sessions}{' '}
                    workouts, {importSummary.toCreate.weights} weights
                    <br />
                    Reuse: {reuseSummary.exercises || 0} exercises,{' '}
                    {reuseSummary.routines || 0} routines, {reuseSummary.sessions || 0} workouts,{' '}
                    {reuseSummary.weights || 0} weights
                    <br />
                    Skip: {importSummary.skipped.exercises} exercises,{' '}
                    {importSummary.skipped.routines} routines, {importSummary.skipped.weights}{' '}
                    weights
                  </div>
                ) : null}
                {pendingImport.validation.warnings?.length ? (
                  <div className="muted">
                    Warnings: {pendingImport.validation.warnings.join(' ')}
                  </div>
                ) : null}
                {pendingImport.validation.valid ? (
                  <div className="inline">
                    <button
                      className="button secondary"
                      type="button"
                      onClick={handleConfirmImport}
                      disabled={importing}
                    >
                      Confirm import
                    </button>
                    <button className="button ghost" type="button" onClick={handleCancelImport}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button className="button ghost" type="button" onClick={handleCancelImport}>
                    Clear validation
                  </button>
                )}
              </div>
            ) : null}
            {importResult ? (
              <div className="tag">
                Imported {importResult.importedCount?.exercises || 0} exercises,{' '}
                {importResult.importedCount?.routines || 0} routines,{' '}
                {importResult.importedCount?.sessions || 0} workouts,{' '}
                {importResult.importedCount?.weights || 0} bodyweight entries.
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Motion</div>
        <div className="stack">
          <div>
            <label htmlFor="motion-preference-select">Animation preference</label>
            <select
              id="motion-preference-select"
              aria-label="Motion preference"
              value={preference}
              onChange={(event) => setPreference(event.target.value)}
            >
              <option value="system">System</option>
              <option value="reduced">Reduced</option>
              <option value="full">Full</option>
            </select>
          </div>
          <div className="muted">
            Active mode: {motionMode === 'reduced' ? 'Reduced motion' : 'Full motion'}.
            {preference === 'system' ? ' Following system preference.' : ''}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="section-title">About</div>
        <div className="inline">
          <span className="tag">Version</span>
          <strong>{APP_VERSION}</strong>
        </div>
        <p className="muted">Trainbook is designed for fast, satisfying workout logging.</p>
      </div>
    </motion.div>
  );
}

export default App;
