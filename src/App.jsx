import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { FaArrowDown, FaArrowUp, FaCheck, FaCircleInfo, FaCopy, FaPenToSquare, FaTrashCan, FaXmark } from 'react-icons/fa6';
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiFetch } from './api.js';
import { getChartAnimationConfig, getDirectionalPageVariants, getMotionConfig } from './motion.js';
import { useMotionPreferences } from './motion-preferences.jsx';
import {
  buildChecklistRows,
  buildMissingSetPayloads,
  formatReadinessError,
  resolveExerciseStartAt,
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
const TARGET_REP_MIN_OPTIONS = Array.from({ length: 20 }, (_, index) => `${index + 1}`);
const TARGET_REP_MAX_OPTIONS = Array.from({ length: 24 }, (_, index) => `${index + 1}`);
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

const LOCALE = 'sv-SE';
const APP_ROUTE_ORDER = {
  '/log': 0,
  '/routines': 1,
  '/exercises': 2,
  '/stats': 3,
  '/settings': 4,
};

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
  return {
    ...detail,
    totalSets,
    totalReps,
    totalVolume,
  };
}

function resolveTargetRepBounds(targetReps, targetRepsRange) {
  if (targetRepsRange) {
    const strictMatch = String(targetRepsRange).match(/^(\d+)\s*-\s*(\d+)$/);
    const looseMatch = strictMatch || String(targetRepsRange).match(/(\d+)\D+(\d+)/);
    if (looseMatch) {
      const minValue = Number(looseMatch[1]);
      const maxValue = Number(looseMatch[2]);
      if (Number.isInteger(minValue) && Number.isInteger(maxValue) && minValue >= 1 && minValue <= 20 && maxValue <= 24 && maxValue >= minValue) {
        return { min: String(minValue), max: String(maxValue) };
      }
    }
  }
  if (targetReps !== null && targetReps !== undefined) {
    const repsValue = Number(targetReps);
    if (Number.isInteger(repsValue) && repsValue >= 1 && repsValue <= 20) {
      const repsText = String(repsValue);
      return { min: repsText, max: repsText };
    }
  }
  return { min: DEFAULT_TARGET_REPS_MIN, max: DEFAULT_TARGET_REPS_MAX };
}

function resolveAutoTargetRepMax(minValue) {
  const normalizedMin = Number(minValue);
  if (!Number.isInteger(normalizedMin) || normalizedMin < 1 || normalizedMin > 20) {
    return DEFAULT_TARGET_REPS_MAX;
  }
  return String(Math.min(24, normalizedMin + 4));
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

function formatElapsedSince(value, now = new Date()) {
  if (!value) return '—';
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return '—';
  const diffMs = now.getTime() - then.getTime();
  if (diffMs <= 0) return 'Just now';

  const totalMinutes = Math.floor(diffMs / (60 * 1000));
  if (totalMinutes < 60) return `${totalMinutes}m`;

  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) return `${totalHours}h`;

  const totalDays = Math.floor(totalHours / 24);
  if (totalDays < 7) {
    const hours = totalHours % 24;
    return hours ? `${totalDays}d ${hours}h` : `${totalDays}d`;
  }

  const weeks = Math.floor(totalDays / 7);
  const days = totalDays % 7;
  return days ? `${weeks}w ${days}d` : `${weeks}w`;
}

function formatRoutineLastUsedDaysAgo(value, now = new Date()) {
  if (!value) return 'Never trained';
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return 'Never trained';
  const diffMs = Math.max(0, now.getTime() - then.getTime());
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (!days) return 'Trained today';
  return `Trained ${days} day${days === 1 ? '' : 's'} ago`;
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

function resolveTopLevelPath(pathname) {
  if (!pathname || pathname === '/') return '/log';
  const firstSegment = String(pathname)
    .split('/')
    .filter(Boolean)[0];
  const normalized = `/${firstSegment || 'log'}`;
  return Object.prototype.hasOwnProperty.call(APP_ROUTE_ORDER, normalized) ? normalized : '/log';
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
            <AnimatedNavLink to="/log">Workout</AnimatedNavLink>
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
              <Route path="/" element={<Navigate to="/log" replace />} />
              <Route path="/log" element={<LogPage />} />
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
      navigate('/log');
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
  const [finishConfirmOpen, setFinishConfirmOpen] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [routineData, sessionData, sessionList, weightData] =
        await Promise.all([
          apiFetch('/api/routines'),
          apiFetch('/api/sessions/active'),
          apiFetch('/api/sessions?limit=6'),
          apiFetch('/api/weights?limit=6'),
        ]);
      setRoutines(routineData.routines || []);
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
    if (fromSession.length) return fromSession;
    const routine = routines.find((item) => item.id === activeSession.routineId);
    if (!routine) return [];
    return (routine.exercises || []).map((exercise, index) => ({
      exerciseId: exercise.exerciseId,
      name: exercise.name,
      equipment: exercise.equipment || null,
      targetSets: exercise.targetSets,
      targetReps: exercise.targetReps,
      targetRepsRange: exercise.targetRepsRange || null,
      targetWeight: exercise.targetWeight,
      targetBandLabel: exercise.targetBandLabel || null,
      supersetGroup: normalizeSupersetGroup(exercise.supersetGroup),
      targetRestSeconds:
        exercise.targetRestSeconds === null || exercise.targetRestSeconds === undefined
          ? null
          : Number(exercise.targetRestSeconds),
      status: 'pending',
      position: Number.isFinite(exercise.position) ? Number(exercise.position) : index,
      sets: [],
    }));
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
      setSessionMode('preview');
      setCurrentExerciseId(null);
      setExerciseDetailExerciseId(null);
      setSetChecklistByExerciseId({});
      setFinishConfirmOpen(false);
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
        body: JSON.stringify({ endedAt: new Date().toISOString() }),
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

  const resolveNextPendingExercise = (currentExerciseToComplete) => {
    if (!currentExerciseToComplete) return null;
    const pending = sessionExercises
      .filter((exercise) => (
        exercise.exerciseId !== currentExerciseToComplete.exerciseId
        && !resolveIsExerciseCompleted(exercise)
      ))
      .sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
    if (!pending.length) return null;
    const partner = supersetPartnerByExerciseId.get(currentExerciseToComplete.exerciseId) || null;
    if (partner && pending.some((exercise) => exercise.exerciseId === partner.exerciseId)) {
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

  const handleToggleSetChecklist = (exerciseId, setIndex) => {
    setSetChecklistByExerciseId((prev) => {
      const exerciseKey = String(exerciseId);
      const current = { ...(prev?.[exerciseKey] || {}) };
      if (current[setIndex]) {
        delete current[setIndex];
      } else {
        current[setIndex] = new Date().toISOString();
      }
      return {
        ...(prev || {}),
        [exerciseKey]: current,
      };
    });
  };

  const handleBeginWorkout = async () => {
    const readiness = validateWorkoutReadiness(sessionExercises);
    if (!readiness.valid) {
      setError(formatReadinessError(readiness.issues));
      return;
    }
    const first = sessionExercises.find((exercise) => !resolveIsExerciseCompleted(exercise));
    if (!first) return;
    const started = await handleStartExercise(first.exerciseId);
    if (!started) return;
    setCurrentExerciseId(first.exerciseId);
    setSessionMode('workout');
  };

  const handleFinishExercise = async () => {
    if (!activeSession || !currentExercise) return;
    const finishedAt = new Date().toISOString();
    const startAt = resolveExerciseStartAt(currentExercise, finishedAt);
    const localChecklist = setChecklistByExerciseId[String(currentExercise.exerciseId)] || {};
    const missingSetPayloads = buildMissingSetPayloads({
      exercise: currentExercise,
      checkedAtBySetIndex: localChecklist,
      exerciseStartedAt: startAt,
      exerciseFinishedAt: finishedAt,
      defaultBandLabel: SESSION_BAND_OPTIONS[0]?.name || null,
    });

    for (const payload of missingSetPayloads) {
      const saved = await handleAddSet(
        currentExercise.exerciseId,
        payload.reps,
        payload.weight,
        payload.bandLabel,
        payload.startedAt,
        payload.completedAt
      );
      if (!saved) return;
    }

    const nextExercise = resolveNextPendingExercise(currentExercise);
    const completed = await handleCompleteExercise(currentExercise.exerciseId, finishedAt);
    if (!completed) return;
    clearLocalChecklistForExercise(currentExercise.exerciseId);

    if (nextExercise) {
      const started = await handleStartExercise(nextExercise.exerciseId);
      if (!started) return;
      setCurrentExerciseId(nextExercise.exerciseId);
      return;
    }

    await handleEndSession(true);
  };

  const handleSkipExercise = async () => {
    if (!activeSession || !currentExercise) return;
    const completedAt = new Date().toISOString();
    const nextExercise = resolveNextPendingExercise(currentExercise);
    const completed = await handleCompleteExercise(currentExercise.exerciseId, completedAt);
    if (!completed) return;
    clearLocalChecklistForExercise(currentExercise.exerciseId);
    if (nextExercise) {
      const started = await handleStartExercise(nextExercise.exerciseId);
      if (!started) return;
      setCurrentExerciseId(nextExercise.exerciseId);
      return;
    }
    await handleEndSession(true);
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

  const currentChecklistRows = useMemo(() => {
    if (!currentExercise) return [];
    const localChecklist = setChecklistByExerciseId[String(currentExercise.exerciseId)] || {};
    return buildChecklistRows(currentExercise, localChecklist);
  }, [currentExercise, setChecklistByExerciseId]);
  const pendingExercises = useMemo(
    () => sessionExercises.filter((exercise) => !resolveIsExerciseCompleted(exercise)),
    [sessionExercises]
  );
  const currentIsCompleted = resolveIsExerciseCompleted(currentExercise);

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
  const isTrainingFocused = Boolean(activeSession && sessionMode === 'workout');
  const sessionDetailSummary = useMemo(
    () => buildSessionSummary(sessionDetail),
    [sessionDetail]
  );
  const sessionDetailDurationSeconds = resolveSessionDurationSeconds(sessionDetailSummary);
  const sessionDetailExerciseTotal = (sessionDetailSummary?.exercises || []).length;
  const sessionDetailExerciseCount = countSessionTrainedExercises(sessionDetailSummary);

  return (
    <motion.div
      className="stack"
      variants={motionConfig.variants.listStagger}
      initial="hidden"
      animate="visible"
    >
      <div className="split">
        <div>
          <h2 className="section-title">Today&apos;s workout</h2>
          <p className="muted">Log fast, stay in flow, keep the lift going.</p>
        </div>
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
                <div className="section-title">Workout preview</div>
                <div className="stack">
                  {sessionExercises.map((exercise, index) => (
                    <div
                      key={`${exercise.exerciseId}-${exercise.position ?? index}-${index}`}
                      className="set-row workout-preview-row"
                    >
                      <div>
                        <div>{`${index + 1}. ${[exercise.equipment, exercise.name].filter(Boolean).join(' ')}`}</div>
                        <div className="inline" style={{ marginTop: '0.25rem' }}>
                          {exercise.targetSets ? <span className="badge">{exercise.targetSets} sets</span> : null}
                          {exercise.targetRepsRange ? <span className="badge">{exercise.targetRepsRange} reps</span> : null}
                          {!exercise.targetRepsRange && exercise.targetReps ? <span className="badge">{exercise.targetReps} reps</span> : null}
                          {exercise.targetWeight ? <span className="badge">{exercise.targetWeight} kg</span> : null}
                          {exercise.targetBandLabel ? <span className="badge">{exercise.targetBandLabel}</span> : null}
                          {supersetPartnerByExerciseId.get(exercise.exerciseId) ? (
                            <span className="badge badge-superset">Superset</span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            ) : currentExercise ? (
              <motion.div
                key={`guided-workout-${currentExercise.exerciseId}`}
                className="card guided-workout-card"
                variants={motionConfig.variants.fadeUp}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <div className="guided-workout-header">
                  <div className="section-title guided-workout-title">
                    {[currentExercise.equipment, currentExercise.name].filter(Boolean).join(' ')}
                  </div>
                  <button
                    className="button ghost icon-button guided-workout-info-button"
                    type="button"
                    aria-label={`Open exercise details for ${currentExercise.name}`}
                    title="Exercise details"
                    onClick={() => openExerciseDetail(currentExercise.exerciseId)}
                  >
                    <FaCircleInfo aria-hidden="true" />
                  </button>
                </div>
                <div className="inline">
                  {currentExercise.targetSets ? <span className="badge">{currentExercise.targetSets} sets</span> : null}
                  {currentExercise.targetRepsRange ? <span className="badge">{currentExercise.targetRepsRange} reps</span> : null}
                  {!currentExercise.targetRepsRange && currentExercise.targetReps ? <span className="badge">{currentExercise.targetReps} reps</span> : null}
                  {currentExercise.targetWeight ? <span className="badge">{currentExercise.targetWeight} kg</span> : null}
                  {currentExercise.targetBandLabel ? <span className="badge">{currentExercise.targetBandLabel}</span> : null}
                  {currentExercise.targetRestSeconds ? <span className="badge">Rest {formatRestTime(currentExercise.targetRestSeconds)}</span> : null}
                  {currentSupersetPartner ? (
                    <span className="badge badge-superset">Superset with {currentSupersetPartner.name}</span>
                  ) : null}
                </div>

                <div className="set-list set-checklist" style={{ marginTop: '0.9rem' }}>
                  {currentChecklistRows.length ? (
                    currentChecklistRows.map((row) => {
                      const set = row.persistedSet;
                      const summary = set
                        ? (
                          currentExercise.equipment === 'Bodyweight'
                            ? `${formatNumber(set.reps)} reps`
                            : currentExercise.equipment === 'Band'
                              ? `${set.bandLabel || currentExercise.targetBandLabel || 'Band'} × ${formatNumber(set.reps)} reps`
                              : `${formatNumber(set.weight)} kg × ${formatNumber(set.reps)} reps`
                        )
                        : row.checked
                          ? 'Checked'
                          : 'Not checked';
                      return (
                        <div
                          key={`${currentExercise.exerciseId}-${row.setIndex}`}
                          className={`set-row guided-set-row set-checklist-row${row.locked ? ' set-checklist-row-locked' : ''}`}
                        >
                          <div className="set-chip">Set {row.setIndex}</div>
                          <div className="guided-set-summary">
                            {summary}
                            {row.checkedAt ? ` · ${formatDateTime(row.checkedAt)}` : ''}
                          </div>
                          <input
                            className="set-checklist-checkbox"
                            type="checkbox"
                            aria-label={`Mark set ${row.setIndex} complete`}
                            checked={row.checked}
                            disabled={row.locked}
                            onChange={() => handleToggleSetChecklist(currentExercise.exerciseId, row.setIndex)}
                          />
                        </div>
                      );
                    })
                  ) : (
                    <div className="muted">No target sets configured.</div>
                  )}
                </div>
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
                className="button ghost"
                type="button"
                onClick={handleSkipExercise}
              >
                Skip exercise
              </button>
            ) : null}
            {sessionMode === 'workout' && currentExercise && !currentIsCompleted ? (
              <button
                className="button secondary"
                type="button"
                onClick={handleFinishExercise}
              >
                Finish exercise
              </button>
            ) : null}
            <button
              className="button ghost"
              type="button"
              onClick={sessionMode === 'preview' ? handleCancelSession : () => handleEndSession()}
            >
              {sessionMode === 'preview' ? 'Cancel' : 'End workout'}
            </button>
          </motion.div>

          <AnimatePresence>
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
                    <span className="start-workout-routine-chevron" aria-hidden="true">→</span>
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
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session, index) => (
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
                      <td>{session.routineName || 'Workout'}</td>
                      <td>{Number(session.totalSets || 0)}</td>
                      <td>{formatDate(session.startedAt)}</td>
                    </tr>
                  ))}
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
                              <button
                                className="button ghost icon-button session-detail-toggle-button"
                                type="button"
                                aria-label={isExpanded ? `Hide sets for ${exercise.name}` : `Show ${setCount} sets for ${exercise.name}`}
                                title={isExpanded ? `Hide sets (${setCount})` : `Show sets (${setCount})`}
                                onClick={() => toggleDetailExercise(exerciseKey)}
                              >
                                {isExpanded ? <FaArrowUp aria-hidden="true" /> : <FaArrowDown aria-hidden="true" />}
                              </button>
                            </div>
                            <AnimatePresence initial={false}>
                              {isExpanded ? (
                                <motion.div
                                  className="motion-collapse"
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={motionConfig.transition.fast}
                                >
                                  {setCount === 0 ? (
                                    <div className="set-row session-detail-set-row muted">
                                      No sets finished in this workout.
                                    </div>
                                  ) : (
                                    (exercise.sets || []).map((set, setIndex) => (
                                      <div
                                        key={`${set.id ?? 'set'}-${set.setIndex ?? 'na'}-${set.createdAt || set.completedAt || setIndex}`}
                                        className="set-row session-detail-set-row"
                                      >
                                        <div className="set-chip">Set {set.setIndex}</div>
                                        <div>
                                          {set.bandLabel
                                            ? `${set.bandLabel} × ${formatNumber(set.reps)} reps`
                                            : Number(set.weight) === 0
                                              ? `${formatNumber(set.reps)} reps`
                                              : `${formatNumber(set.weight)} kg × ${formatNumber(set.reps)} reps`}
                                          {set.durationSeconds ? ` · ${formatDurationSeconds(set.durationSeconds)}` : ''}
                                        </div>
                                      </div>
                                    ))
                                  )}
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
      setRoutines(routineData.routines || []);
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
          prev.map((routine) => (routine.id === payload.id ? data.routine : routine))
        );
      } else {
        const data = await apiFetch('/api/routines', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setRoutines((prev) => [data.routine, ...prev]);
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
      setRoutines((prev) => [data.routine, ...prev]);
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
        prev.map((item) => (item.id === routine.id ? data.routine : item))
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
          const exerciseToggleLabel = isExpanded
            ? `Hide exercises (${routine.exercises.length})`
            : `Show exercises (${routine.exercises.length})`;
          return (
            <motion.div
              key={routine.id}
              className="card"
              variants={motionConfig.variants.listItem}
            >
              <div className="routine-card-header">
                <div className="routine-card-title-wrap">
                  <div className="section-title">{routine.name}</div>
                  {routineNotes ? <div className="muted">{routineNotes}</div> : null}
                </div>
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
              <AnimatePresence initial={false}>
                {isExpanded ? (
                  <motion.div
                    className="set-list motion-collapse"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={motionConfig.transition.fast}
                  >
                    {routine.exercises.map((exercise, index) => (
                      <div key={exercise.id} className="set-row workout-preview-row routine-workout-preview-row">
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
                            {exercise.supersetGroup ? <span className="badge badge-superset">Superset</span> : null}
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
                    ))}
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
          <AnimatedModal onClose={() => setRoutineModal(null)} panelClassName="routine-modal">
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
            <div style={{ marginTop: '1rem' }}>
              <RoutineEditor
                routine={routineModal.routine || undefined}
                exercises={exercises}
                onSave={handleSave}
              />
            </div>
          </AnimatedModal>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

function RoutineEditor({ routine, exercises, onSave }) {
  const [name, setName] = useState(routine?.name || '');
  const [notes, setNotes] = useState(routine?.notes || '');
  const [formError, setFormError] = useState(null);
  const [dragIndex, setDragIndex] = useState(null);
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
    if (!routine?.exercises?.length) return [];
    const sourceItems = routine.exercises.map((item) => {
      const repBounds = resolveTargetRepBounds(item.targetReps, item.targetRepsRange);
      return {
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

  const itemHasSuperset = (index) => (
    Boolean(items[index]?.pairWithNext) || Boolean(items[index - 1]?.pairWithNext)
  );

  const addItem = () => {
    updateItems((prev) => {
      const previousItem = prev[prev.length - 1];
      const inheritedRest = String(previousItem?.targetRestSeconds || '');
      const nextRestSeconds = ROUTINE_REST_OPTION_VALUES.includes(inheritedRest)
        ? inheritedRest
        : DEFAULT_TARGET_REST_SECONDS;
      return [
        ...prev,
        {
          exerciseId: '',
          equipment: '',
          targetSets: DEFAULT_TARGET_SETS,
          targetRepsMin: DEFAULT_TARGET_REPS_MIN,
          targetRepsMax: DEFAULT_TARGET_REPS_MAX,
          targetRestSeconds: nextRestSeconds,
          targetWeight: '',
          targetBandLabel: '',
          notes: '',
          position: prev.length,
          supersetGroup: null,
          pairWithNext: false,
        },
      ];
    });
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

  const removeItem = (index) => {
    const item = items[index];
    if (!item) return;
    const selectedExercise = exercises.find((exercise) => String(exercise.id) === String(item.exerciseId));
    const itemName = [item.equipment, selectedExercise?.name].filter(Boolean).join(' ').trim();
    const confirmed = window.confirm(
      `Remove "${itemName || `exercise ${index + 1}`}" from this routine?`
    );
    if (!confirmed) return;

    updateItems((prev) => prev.filter((_, idx) => idx !== index));
    setFormError(null);
  };

  const moveItem = (fromIndex, toIndex) => {
    if (fromIndex === toIndex) return;
    if (toIndex < 0 || toIndex >= items.length) return;
    updateItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
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
          minValue > 20 ||
          maxValue > 24 ||
          maxValue < minValue
        );
      }
    );
    if (invalidReps) {
      setFormError('Target reps must be 1-20, with range max up to 24.');
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

  return (
    <form className="stack" onSubmit={handleSubmit}>
      {formError ? <div className="notice">{formError}</div> : null}
      <div className="form-row">
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
      </div>
      <div className="stack">
        {items.map((item, index) => (
          <div
            key={`${item.exerciseId}-${index}`}
            className={`card ${itemHasSuperset(index) ? 'routine-editor-item-paired' : ''}`}
            style={{ boxShadow: 'none' }}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (dragIndex === null) return;
              moveItem(dragIndex, index);
              setDragIndex(null);
            }}
            onDragEnd={() => setDragIndex(null)}
          >
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
            <div className="stack" style={{ marginTop: '0.6rem' }}>
              {itemHasSuperset(index) ? (
                <div className="inline">
                  <span className="badge badge-superset">Superset</span>
                </div>
              ) : null}
              <input
                className="input"
                value={item.notes}
                onChange={(event) => updateItem(index, 'notes', event.target.value)}
                placeholder="Notes or cues"
              />
              <div className="inline routine-item-actions">
                {index < items.length - 1 ? (
                  <button
                    type="button"
                    className="button ghost"
                    onClick={() => togglePairWithNext(index)}
                  >
                    {item.pairWithNext ? 'Unpair' : 'Pair with next'}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="button ghost icon-button"
                  onClick={() => moveItem(index, index - 1)}
                  aria-label="Move exercise up"
                  title="Move up"
                  disabled={index === 0}
                >
                  <FaArrowUp aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="button ghost icon-button"
                  onClick={() => moveItem(index, index + 1)}
                  aria-label="Move exercise down"
                  title="Move down"
                  disabled={index === items.length - 1}
                >
                  <FaArrowDown aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="button ghost icon-button"
                  onClick={() => removeItem(index)}
                  aria-label="Remove exercise"
                  title="Remove"
                >
                  <FaTrashCan aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="routine-editor-footer">
        <button type="button" className="button ghost" onClick={addItem}>
          + Add exercise
        </button>
        <button type="submit" className="button routine-editor-save">
          Save
        </button>
      </div>
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
          apiFetch('/api/stats/overview'),
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
  }, []);

  useEffect(() => {
    let active = true;
    const loadAnalytics = async () => {
      setAnalyticsLoading(true);
      setError(null);
      try {
        const progressionPath = selectedExerciseId
          ? `/api/stats/progression?exerciseId=${selectedExerciseId}&window=${progressionWindow}`
          : null;
        const requests = await Promise.all([
          apiFetch(`/api/stats/timeseries?bucket=${timeseriesBucket}&window=${timeseriesWindow}`),
          progressionPath ? apiFetch(progressionPath) : Promise.resolve(null),
          apiFetch(`/api/stats/distribution?metric=${distributionMetric}&window=${distributionWindow}`),
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
        <h2 className="section-title">Stats</h2>
        <p className="muted">Progression insights with weekly and monthly trend lines.</p>
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
          <div className="set-list">
            {stats.topExercises.map((exercise) => (
              <div key={exercise.exerciseId} className="set-row">
                <div className="set-chip">{exercise.name}</div>
                <div>
                  {formatNumber(exercise.maxWeight)} kg · {formatNumber(exercise.maxReps)} reps
                </div>
              </div>
            ))}
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
