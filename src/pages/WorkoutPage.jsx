import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  FaArrowDown,
  FaArrowUp,
  FaCheck,
  FaChevronLeft,
  FaChevronRight,
  FaCircleInfo,
  FaFlagCheckered,
  FaForwardStep,
  FaListUl,
  FaStop,
  FaXmark,
} from 'react-icons/fa6';
import { apiFetch } from '../api.js';
import { getMotionConfig } from '../motion.js';
import { useMotionPreferences } from '../motion-preferences.jsx';
import { formatDaysAgoLabel } from '../date-labels.js';
import {
  buildChecklistRows,
  buildMissingSetPayloads,
  formatReadinessError,
  resolveExerciseStartAt,
  resolveTargetRepsValue,
  validateWorkoutReadiness,
} from '../workout-flow.js';
import {
  TARGET_REP_MAX_OPTIONS,
  SESSION_BAND_OPTIONS,
  ONE_WEEK_MS,
  SET_CELEBRATION_MS,
  EXERCISE_CELEBRATION_MS,
  PROGRESS_PULSE_MS,
  REDUCED_MOTION_FEEDBACK_MS,
  TARGET_WEIGHT_MIN,
  TARGET_WEIGHT_STATUS_CLEAR_MS,
  WARMUP_STEP_ID,
  normalizeRoutineType,
  formatRoutineTypeLabel,
  formatMuscleLabel,
  normalizeExerciseMetadataList,
  resolveExerciseImageUrl,
  formatDateTime,
  formatNumber,
  buildSessionSummary,
  sessionHasTrackedProgress,
  formatRestTime,
  formatDurationSeconds,
  normalizeEquipmentForComparison,
  normalizeRoutineExerciseId,
  buildSessionExerciseKey,
  resolveSessionExerciseKey,
  buildTargetWeightControlKey,
  resolveWeightStepForEquipment,
  roundWeight,
  formatTargetWeightInputValue,
  parseTargetWeightInput,
  isWeightedTargetEditable,
  resolveTargetWeightSaveStatusLabel,
  resolveSessionDurationSeconds,
  createWarmupStep,
  countSessionTrainedExercises,
  resolveRecentWorkoutCount,
  resolveSessionDetailPlaceholderWeight,
  resolveSessionDetailPlaceholderReps,
  buildSessionDetailSetRows,
  resolveSessionDetailExerciseState,
  formatSessionDetailExerciseStateLabel,
  resolveSessionDetailAggregateMetrics,
  normalizeSupersetGroup,
  buildSupersetPartnerLookup,
  buildWorkoutPreviewBlocks,
} from '../features/workout/workout-utils.js';
import StartWorkoutRoutineList from '../features/workout/components/start-workout-routine-list.jsx';
import { useWorkoutInitialData } from '../features/workout/hooks/use-workout-initial-data.js';
import AnimatedModal from '../ui/modal/AnimatedModal.jsx';

function WorkoutPage() {
  const { resolvedReducedMotion } = useMotionPreferences();
  const motionConfig = useMemo(
    () => getMotionConfig(resolvedReducedMotion),
    [resolvedReducedMotion]
  );
  const {
    routines,
    setRoutines,
    activeSession,
    setActiveSession,
    sessions,
    setSessions,
    weights,
    setWeights,
    loading,
    error,
    setError,
    refresh,
  } = useWorkoutInitialData();
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
  const [targetWeightSaveStatusByKey, setTargetWeightSaveStatusByKey] = useState({});
  const [targetWeightInputDraftByKey, setTargetWeightInputDraftByKey] = useState({});
  const [workoutPreviewOpen, setWorkoutPreviewOpen] = useState(false);
  const [finishConfirmOpen, setFinishConfirmOpen] = useState(false);
  const [isExerciseTransitioning, setIsExerciseTransitioning] = useState(false);
  const [celebratingSetKeys, setCelebratingSetKeys] = useState({});
  const [celebratingExerciseIds, setCelebratingExerciseIds] = useState({});
  const [isProgressPulsing, setIsProgressPulsing] = useState(false);
  const finishExerciseInFlightRef = useRef(false);
  const skipExerciseInFlightRef = useRef(false);
  const setCelebrationTimersRef = useRef(new Map());
  const exerciseCelebrationTimersRef = useRef(new Map());
  const progressPulseTimerRef = useRef(null);
  const previousWorkoutProgressCountRef = useRef(0);
  const targetWeightSaveQueueRef = useRef(new Map());
  const targetWeightOptimisticByKeyRef = useRef({});
  const pendingTargetWeightByKeyRef = useRef({});
  const targetWeightStatusTimersRef = useRef(new Map());

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

  const clearTargetWeightStatusTimeout = (key) => {
    const timer = targetWeightStatusTimersRef.current.get(key);
    if (!timer) return;
    clearTimeout(timer);
    targetWeightStatusTimersRef.current.delete(key);
  };

  const clearAllTargetWeightStatusTimeouts = () => {
    targetWeightStatusTimersRef.current.forEach((timer) => clearTimeout(timer));
    targetWeightStatusTimersRef.current.clear();
  };

  const setTargetWeightSaveStatus = (key, status, { autoClearMs = null } = {}) => {
    clearTargetWeightStatusTimeout(key);
    setTargetWeightSaveStatusByKey((prev) => ({
      ...prev,
      [key]: status,
    }));
    if (!autoClearMs) return;
    const timer = setTimeout(() => {
      setTargetWeightSaveStatusByKey((prev) => {
        if (!prev[key] || prev[key] !== status) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      targetWeightStatusTimersRef.current.delete(key);
    }, autoClearMs);
    targetWeightStatusTimersRef.current.set(key, timer);
  };

  const clearAllTargetWeightRuntimeState = () => {
    clearAllTargetWeightStatusTimeouts();
    targetWeightSaveQueueRef.current.clear();
    targetWeightOptimisticByKeyRef.current = {};
    pendingTargetWeightByKeyRef.current = {};
    setTargetWeightSaveStatusByKey({});
    setTargetWeightInputDraftByKey({});
  };

  const clearAllCelebrationTimers = () => {
    setCelebrationTimersRef.current.forEach((timer) => clearTimeout(timer));
    setCelebrationTimersRef.current.clear();
    exerciseCelebrationTimersRef.current.forEach((timer) => clearTimeout(timer));
    exerciseCelebrationTimersRef.current.clear();
    clearProgressPulseTimeout();
    clearAllTargetWeightStatusTimeouts();
  };

  useEffect(() => (
    () => {
      clearAllCelebrationTimers();
    }
  ), []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleSyncComplete = () => {
      refresh();
    };
    window.addEventListener('trainbook:sync-complete', handleSyncComplete);
    return () => {
      window.removeEventListener('trainbook:sync-complete', handleSyncComplete);
    };
  }, [refresh]);

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

  const startWorkoutRoutines = useMemo(() => {
    const resolveLastTrainedTime = (routine) => {
      if (!routine?.lastUsedAt) return null;
      const parsed = new Date(routine.lastUsedAt).getTime();
      return Number.isNaN(parsed) ? null : parsed;
    };

    return [...routines].sort((a, b) => {
      const aLastTrainedAt = resolveLastTrainedTime(a);
      const bLastTrainedAt = resolveLastTrainedTime(b);

      if (aLastTrainedAt === null && bLastTrainedAt === null) return 0;
      if (aLastTrainedAt === null) return 1;
      if (bLastTrainedAt === null) return -1;
      return bLastTrainedAt - aLastTrainedAt;
    });
  }, [routines]);

  const sessionExercises = useMemo(() => {
    if (!activeSession) return [];
    const shouldIncludeWarmup = normalizeRoutineType(activeSession.routineType) === 'standard';
    const fromSession = (activeSession.exercises || [])
      .map((exercise, index) => {
        const routineExerciseId = normalizeRoutineExerciseId(exercise.routineExerciseId);
        const sessionExerciseKey = buildSessionExerciseKey(exercise.exerciseId, routineExerciseId);
        return {
          ...exercise,
          routineExerciseId,
          sessionExerciseKey,
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
              .sort((a, b) => Number(a.setIndex) - Number(b.setIndex))
              .map((set) => ({
                ...set,
                routineExerciseId: normalizeRoutineExerciseId(
                  set?.routineExerciseId ?? routineExerciseId
                ),
                sessionExerciseKey:
                  set?.sessionExerciseKey
                  || buildSessionExerciseKey(
                    exercise.exerciseId,
                    set?.routineExerciseId ?? routineExerciseId
                  ),
              }));
          })(),
          targetRestSeconds:
            exercise.targetRestSeconds === null || exercise.targetRestSeconds === undefined
              ? null
              : Number(exercise.targetRestSeconds),
        };
      })
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
      routineExerciseId: normalizeRoutineExerciseId(exercise.id),
      sessionExerciseKey: buildSessionExerciseKey(exercise.exerciseId, exercise.id),
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
      const match = sessionExercises.find((exercise) => (
        resolveSessionExerciseKey(exercise) === currentExerciseId
      ));
      if (match) return match;
    }
    const inProgress = sessionExercises.find((exercise) => exercise.status === 'in_progress');
    if (inProgress) return inProgress;
    return sessionExercises.find((exercise) => !resolveIsExerciseCompleted(exercise)) || sessionExercises[0];
  }, [sessionExercises, currentExerciseId]);

  const supersetPartnerByExerciseId = useMemo(
    () => buildSupersetPartnerLookup(sessionExercises),
    [sessionExercises]
  );
  const currentSupersetPartner = useMemo(() => {
    if (!currentExercise) return null;
    return supersetPartnerByExerciseId.get(resolveSessionExerciseKey(currentExercise)) || null;
  }, [currentExercise, supersetPartnerByExerciseId]);
  const navigableWorkoutExercises = useMemo(
    () => sessionExercises.filter((exercise) => !exercise.isWarmupStep),
    [sessionExercises]
  );
  const currentNavigableWorkoutExerciseIndex = useMemo(() => {
    if (!currentExercise) return -1;
    return navigableWorkoutExercises.findIndex(
      (exercise) => resolveSessionExerciseKey(exercise) === resolveSessionExerciseKey(currentExercise)
    );
  }, [navigableWorkoutExercises, currentExercise]);
  const canNavigateToPreviousExercise = currentNavigableWorkoutExerciseIndex > 0;
  const canNavigateToNextExercise = (
    currentNavigableWorkoutExerciseIndex >= 0
    && currentNavigableWorkoutExerciseIndex < navigableWorkoutExercises.length - 1
  );
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
      clearAllTargetWeightRuntimeState();
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
    clearAllTargetWeightRuntimeState();
    const hasProgress = (activeSession.exercises || []).some(
      (exercise) =>
        exercise.status === 'in_progress'
        || exercise.status === 'completed'
        || exercise.status === 'skipped'
        || (exercise.sets || []).length > 0
    );
    setSessionMode(hasProgress ? 'workout' : 'preview');
    const prioritized = (activeSession.exercises || []).find((exercise) => exercise.status === 'in_progress')
      || (activeSession.exercises || []).find((exercise) => !resolveIsExerciseCompleted(exercise))
      || (activeSession.exercises || [])[0]
      || null;
    setCurrentExerciseId(prioritized ? buildSessionExerciseKey(
      prioritized.exerciseId,
      prioritized.routineExerciseId
    ) : null);
  }, [activeSession?.id]);

  useEffect(() => {
    if (sessionMode !== 'workout') {
      setWorkoutPreviewOpen(false);
    }
  }, [sessionMode]);

  useEffect(() => {
    if (!activeSession) return;
    const validExerciseIds = new Set(
      sessionExercises
        .map((exercise) => resolveSessionExerciseKey(exercise))
        .filter(Boolean)
    );
    const validTargetWeightKeys = new Set(
      sessionExercises
        .filter((exercise) => isWeightedTargetEditable(exercise))
        .map((exercise) => buildTargetWeightControlKey(
          activeSession.routineId,
          exercise.exerciseId,
          exercise.equipment,
          exercise.routineExerciseId
        ))
    );
    setSetChecklistByExerciseId((prev) => {
      const next = {};
      Object.entries(prev || {}).forEach(([exerciseId, checklist]) => {
        if (validExerciseIds.has(exerciseId)) {
          next[exerciseId] = checklist;
        }
      });
      return next;
    });
    setSetRepsByExerciseId((prev) => {
      const next = {};
      Object.entries(prev || {}).forEach(([exerciseId, repsBySetIndex]) => {
        if (validExerciseIds.has(exerciseId)) {
          next[exerciseId] = repsBySetIndex;
        }
      });
      return next;
    });
    setTargetWeightSaveStatusByKey((prev) => {
      const next = {};
      Object.entries(prev || {}).forEach(([key, status]) => {
        if (validTargetWeightKeys.has(key)) {
          next[key] = status;
        } else {
          clearTargetWeightStatusTimeout(key);
        }
      });
      return next;
    });
    setTargetWeightInputDraftByKey((prev) => {
      const next = {};
      Object.entries(prev || {}).forEach(([key, value]) => {
        if (validTargetWeightKeys.has(key)) {
          next[key] = value;
        }
      });
      return next;
    });
    Object.keys(targetWeightOptimisticByKeyRef.current || {}).forEach((key) => {
      if (!validTargetWeightKeys.has(key)) {
        delete targetWeightOptimisticByKeyRef.current[key];
      }
    });
    Object.keys(pendingTargetWeightByKeyRef.current || {}).forEach((key) => {
      if (!validTargetWeightKeys.has(key)) {
        delete pendingTargetWeightByKeyRef.current[key];
      }
    });
    targetWeightSaveQueueRef.current.forEach((_, key) => {
      if (!validTargetWeightKeys.has(key)) {
        targetWeightSaveQueueRef.current.delete(key);
      }
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
    const progressKey = progress.sessionExerciseKey
      || buildSessionExerciseKey(progress.exerciseId, progress.routineExerciseId);
    return {
      ...session,
      exercises: (session.exercises || []).map((exercise) => (
        buildSessionExerciseKey(exercise.exerciseId, exercise.routineExerciseId) === progressKey
          ? {
              ...exercise,
              routineExerciseId: normalizeRoutineExerciseId(
                progress.routineExerciseId ?? exercise.routineExerciseId
              ),
              sessionExerciseKey: progressKey,
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
        if (sessionHasTrackedProgress(endedSession)) {
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

  const handleStartExercise = async (exerciseId, routineExerciseId = null) => {
    if (!activeSession) return null;
    setError(null);
    try {
      const data = await apiFetch(`/api/sessions/${activeSession.id}/exercises/${exerciseId}/start`, {
        method: 'POST',
        body: JSON.stringify({
          routineExerciseId,
          startedAt: new Date().toISOString(),
        }),
      });
      setActiveSession((prev) => mergeExerciseProgressIntoSession(prev, data.exerciseProgress));
      setCurrentExerciseId(buildSessionExerciseKey(exerciseId, routineExerciseId));
      return data.exerciseProgress || null;
    } catch (err) {
      setError(err.message);
      return null;
    }
  };

  const persistChecklistEditsForExercise = async (exercise) => {
    if (!activeSession || !exercise || exercise.isWarmupStep) return true;
    const exerciseKey = resolveSessionExerciseKey(exercise);
    if (!Object.prototype.hasOwnProperty.call(setChecklistByExerciseId, exerciseKey)) {
      return true;
    }

    const localChecklist = setChecklistByExerciseId[exerciseKey] || {};
    const baselineRows = buildChecklistRows(exercise, {});
    const rows = buildChecklistRows(exercise, localChecklist);
    const hasChecklistStateChanges = rows.some(
      (row, index) => row.checked !== Boolean(baselineRows[index]?.checked)
    );
    if (!hasChecklistStateChanges) {
      clearLocalChecklistForExercise(exerciseKey);
      return true;
    }

    for (const row of rows) {
      if (!row.persistedSet || row.checked) continue;
      const deleted = await handleDeleteSet(row.persistedSet.id);
      if (!deleted) return false;
    }

    const completedAt = new Date().toISOString();
    const exerciseStartedAt = resolveExerciseStartAt(exercise, completedAt);
    const missingSetPayloads = buildMissingSetPayloads({
      exercise,
      checkedAtBySetIndex: localChecklist,
      exerciseStartedAt,
      exerciseFinishedAt: completedAt,
      defaultBandLabel: SESSION_BAND_OPTIONS[0]?.name || null,
      includeUnchecked: false,
    });

    for (const payload of missingSetPayloads) {
      const reps = resolveSelectedSetReps(exerciseKey, payload.setIndex, payload.reps);
      if (!Number.isInteger(reps) || reps <= 0) return false;
      const saved = await handleAddSet(
        exercise.exerciseId,
        exercise.routineExerciseId || null,
        reps,
        payload.weight,
        payload.bandLabel,
        payload.startedAt,
        payload.completedAt
      );
      if (!saved) return false;
    }

    const hasUncheckedRows = rows.some((row) => !row.checked);
    if (hasUncheckedRows && resolveIsExerciseCompleted(exercise)) {
      const started = await handleStartExercise(
        exercise.exerciseId,
        exercise.routineExerciseId || null
      );
      if (!started) return false;
    }

    clearLocalChecklistForExercise(exerciseKey);
    return true;
  };

  const handleNavigateExerciseByOffset = async (offset) => {
    if (!offset || !navigableWorkoutExercises.length) return;
    if (isExerciseTransitioning) return;

    setIsExerciseTransitioning(true);
    try {
      if (currentExercise) {
        const persisted = await persistChecklistEditsForExercise(currentExercise);
        if (!persisted) return;
      }
      if (currentNavigableWorkoutExerciseIndex < 0) {
        setCurrentExerciseId(resolveSessionExerciseKey(navigableWorkoutExercises[0]));
        return;
      }
      const nextIndex = currentNavigableWorkoutExerciseIndex + offset;
      if (nextIndex < 0 || nextIndex >= navigableWorkoutExercises.length) return;
      const nextExercise = navigableWorkoutExercises[nextIndex];
      setCurrentExerciseId(resolveSessionExerciseKey(nextExercise));
    } finally {
      setIsExerciseTransitioning(false);
    }
  };

  const handleCompleteExercise = async (
    exerciseId,
    routineExerciseId = null,
    completedAt = new Date().toISOString()
  ) => {
    if (!activeSession) return null;
    setError(null);
    try {
      const data = await apiFetch(`/api/sessions/${activeSession.id}/exercises/${exerciseId}/complete`, {
        method: 'POST',
        body: JSON.stringify({ routineExerciseId, completedAt }),
      });
      setActiveSession((prev) => mergeExerciseProgressIntoSession(prev, data.exerciseProgress));
      return data.exerciseProgress || null;
    } catch (err) {
      setError(err.message);
      return null;
    }
  };

  const handleSkipExerciseProgress = async (
    exerciseId,
    routineExerciseId = null,
    completedAt = new Date().toISOString()
  ) => {
    if (!activeSession) return null;
    setError(null);
    try {
      const data = await apiFetch(`/api/sessions/${activeSession.id}/exercises/${exerciseId}/complete`, {
        method: 'POST',
        body: JSON.stringify({ routineExerciseId, completedAt, skipped: true }),
      });
      setActiveSession((prev) => mergeExerciseProgressIntoSession(prev, data.exerciseProgress));
      return data.exerciseProgress || null;
    } catch (err) {
      setError(err.message);
      return null;
    }
  };

  function resolveIsExerciseCompleted(exercise) {
    if (!exercise) return true;
    const status = String(exercise.status || '').trim().toLowerCase();
    if (status === 'completed' || status === 'skipped') return true;
    if (status === 'in_progress' || status === 'pending') return false;
    const targetSets = Number(exercise.targetSets);
    if (Number.isInteger(targetSets) && targetSets > 0) {
      return (exercise.sets || []).length >= targetSets;
    }
    return false;
  }

  const resolveNextPendingExercise = (currentExerciseToComplete, additionallyCompletedExerciseIds = []) => {
    if (!currentExerciseToComplete) return null;
    const completedExerciseKeys = new Set(
      [resolveSessionExerciseKey(currentExerciseToComplete), ...additionallyCompletedExerciseIds]
        .map((value) => {
          if (!value) return null;
          if (typeof value === 'string' && value.includes(':')) return value;
          if (typeof value === 'object') return resolveSessionExerciseKey(value);
          return buildSessionExerciseKey(value);
        })
        .filter(Boolean)
    );
    const pending = sessionExercises
      .filter((exercise) => (
        !completedExerciseKeys.has(resolveSessionExerciseKey(exercise))
        && !resolveIsExerciseCompleted(exercise)
      ))
      .sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
    if (!pending.length) return null;
    const partner = supersetPartnerByExerciseId.get(resolveSessionExerciseKey(currentExerciseToComplete)) || null;
    if (
      partner
      && !completedExerciseKeys.has(resolveSessionExerciseKey(partner))
      && pending.some((exercise) => resolveSessionExerciseKey(exercise) === resolveSessionExerciseKey(partner))
    ) {
      return partner;
    }
    const currentPosition = Number(currentExerciseToComplete.position || 0);
    return pending.find((exercise) => Number(exercise.position || 0) > currentPosition) || pending[0];
  };

  const clearLocalChecklistForExercise = (exerciseId) => {
    const key = String(exerciseId);
    setSetChecklistByExerciseId((prev) => {
      if (!prev || !Object.prototype.hasOwnProperty.call(prev, key)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const clearLocalSetRepsForExercise = (exerciseId) => {
    const key = String(exerciseId);
    setSetRepsByExerciseId((prev) => {
      if (!prev || !Object.prototype.hasOwnProperty.call(prev, key)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const resolveSelectedSetReps = (exerciseId, setIndex, fallbackReps, setRepsOverridesByExerciseId = {}) => {
    const exerciseKey = String(exerciseId);
    const selected = Number(
      setRepsOverridesByExerciseId?.[exerciseKey]?.[setIndex]
      ?? setRepsByExerciseId?.[exerciseKey]?.[setIndex]
    );
    if (Number.isInteger(selected) && selected > 0) return selected;
    const fallback = Number(fallbackReps);
    if (Number.isInteger(fallback) && fallback > 0) return fallback;
    return null;
  };

  const handleSetRepsChange = (exerciseId, setIndex, value) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 60) return;
    const exerciseKey = String(exerciseId);
    const setRepsOverridesByExerciseId = {
      [exerciseKey]: {
        ...(setRepsByExerciseId?.[exerciseKey] || {}),
        [setIndex]: parsed,
      },
    };
    setSetRepsByExerciseId((prev) => ({
      ...(prev || {}),
      [exerciseKey]: {
        ...(prev?.[exerciseKey] || {}),
        [setIndex]: parsed,
      },
    }));
    if (setChecklistByExerciseId?.[exerciseKey]?.[setIndex]) return;
    handleToggleSetChecklist(exerciseKey, setIndex, null, { setRepsOverridesByExerciseId });
  };

  const updateExerciseTargetWeightInRoutines = ({
    routineId,
    exerciseId,
    routineExerciseId,
    equipment,
    targetWeight,
  }) => {
    const numericRoutineId = Number(routineId);
    const numericExerciseId = Number(exerciseId);
    const numericRoutineExerciseId = normalizeRoutineExerciseId(routineExerciseId);
    const normalizedEquipment = normalizeEquipmentForComparison(equipment);
    const resolveTargetIndex = (items = []) => {
      if (numericRoutineExerciseId) {
        const byRoutineExerciseId = items.findIndex(
          (entry) => normalizeRoutineExerciseId(entry?.id) === numericRoutineExerciseId
        );
        if (byRoutineExerciseId >= 0) return byRoutineExerciseId;
      }
      const byEquipment = items.findIndex((entry) => (
        Number(entry?.exerciseId) === numericExerciseId
        && normalizeEquipmentForComparison(entry?.equipment) === normalizedEquipment
      ));
      if (byEquipment >= 0) return byEquipment;
      return items.findIndex((entry) => Number(entry?.exerciseId) === numericExerciseId);
    };

    setRoutines((prev) => prev.map((routine) => {
      if (Number(routine.id) !== numericRoutineId) return routine;
      const nextExercises = [...(routine.exercises || [])];
      const targetIndex = resolveTargetIndex(nextExercises);
      if (targetIndex < 0) return routine;
      nextExercises[targetIndex] = {
        ...nextExercises[targetIndex],
        targetWeight,
      };
      return {
        ...routine,
        exercises: nextExercises,
      };
    }));
  };

  const enqueueTargetWeightSave = (key, task) => {
    const previous = targetWeightSaveQueueRef.current.get(key) || Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    targetWeightSaveQueueRef.current.set(key, next);
    next.finally(() => {
      if (targetWeightSaveQueueRef.current.get(key) === next) {
        targetWeightSaveQueueRef.current.delete(key);
      }
    });
    return next;
  };

  const persistPendingTargetWeightForExercise = async (exercise) => {
    if (!activeSession || !exercise || !isWeightedTargetEditable(exercise)) return true;
    const routineId = Number(activeSession.routineId);
    const exerciseId = Number(exercise.exerciseId);
    const routineExerciseId = normalizeRoutineExerciseId(exercise.routineExerciseId);
    const equipment = String(exercise.equipment || '').trim() || null;
    if (!routineId || !exerciseId || !equipment) return true;
    const key = buildTargetWeightControlKey(routineId, exerciseId, equipment, routineExerciseId);
    const pending = pendingTargetWeightByKeyRef.current[key];
    if (!pending) return true;

    return enqueueTargetWeightSave(key, async () => {
      const latestPending = pendingTargetWeightByKeyRef.current[key];
      if (!latestPending) return true;
      setTargetWeightSaveStatus(key, 'saving');
      try {
        const data = await apiFetch(
          `/api/routines/${latestPending.routineId}/exercises/${latestPending.exerciseId}/target`,
          {
            method: 'PUT',
            body: JSON.stringify({
              routineExerciseId: latestPending.routineExerciseId,
              equipment: latestPending.equipment,
              targetWeight: latestPending.targetWeight,
            }),
          }
        );
        const queuedOffline = Boolean(data?.queued && data?.offline);
        const persistedWeight = roundWeight(data?.target?.targetWeight ?? latestPending.targetWeight);
        if (Number.isFinite(persistedWeight)) {
          targetWeightOptimisticByKeyRef.current[key] = persistedWeight;
          updateExerciseTargetWeightInRoutines({
            routineId: latestPending.routineId,
            exerciseId: latestPending.exerciseId,
            routineExerciseId: latestPending.routineExerciseId,
            equipment: latestPending.equipment,
            targetWeight: persistedWeight,
          });
        }
        delete pendingTargetWeightByKeyRef.current[key];
        setTargetWeightSaveStatus(
          key,
          queuedOffline ? 'queued' : 'saved',
          { autoClearMs: queuedOffline ? null : TARGET_WEIGHT_STATUS_CLEAR_MS }
        );
        return true;
      } catch (err) {
        const rollbackWeight = roundWeight(latestPending.previousWeight);
        if (Number.isFinite(rollbackWeight)) {
          targetWeightOptimisticByKeyRef.current[key] = rollbackWeight;
        }
        delete pendingTargetWeightByKeyRef.current[key];
        setTargetWeightSaveStatus(
          key,
          'failed',
          { autoClearMs: TARGET_WEIGHT_STATUS_CLEAR_MS }
        );
        setError(err.message);
        return false;
      }
    });
  };

  const resolveTargetWeightControlContext = (exercise) => {
    if (!activeSession || !isWeightedTargetEditable(exercise)) return null;
    const routineId = Number(activeSession.routineId);
    const exerciseId = Number(exercise.exerciseId);
    const routineExerciseId = normalizeRoutineExerciseId(exercise.routineExerciseId);
    const equipment = String(exercise.equipment || '').trim() || null;
    if (!routineId || !exerciseId || !equipment) return null;
    const key = buildTargetWeightControlKey(routineId, exerciseId, equipment, routineExerciseId);
    return {
      key,
      routineId,
      exerciseId,
      routineExerciseId,
      equipment,
    };
  };

  const queueNextTargetWeightUpdate = (exercise, nextWeight) => {
    const context = resolveTargetWeightControlContext(exercise);
    if (!context) return null;
    const currentWeight = roundWeight(
      targetWeightOptimisticByKeyRef.current[context.key] ?? exercise.targetWeight
    );
    if (!Number.isFinite(currentWeight)) return null;
    const normalizedNextWeight = roundWeight(Math.max(TARGET_WEIGHT_MIN, Number(nextWeight)));
    if (!Number.isFinite(normalizedNextWeight)) return null;
    if (normalizedNextWeight === currentWeight) {
      setTargetWeightInputDraftByKey((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev, context.key)) return prev;
        const next = { ...prev };
        delete next[context.key];
        return next;
      });
      return normalizedNextWeight;
    }

    targetWeightOptimisticByKeyRef.current[context.key] = normalizedNextWeight;
    const previousWeight = roundWeight(
      pendingTargetWeightByKeyRef.current[context.key]?.previousWeight ?? currentWeight
    );
    pendingTargetWeightByKeyRef.current[context.key] = {
      routineId: context.routineId,
      exerciseId: context.exerciseId,
      routineExerciseId: context.routineExerciseId,
      equipment: context.equipment,
      targetWeight: normalizedNextWeight,
      previousWeight,
    };
    setTargetWeightInputDraftByKey((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, context.key)) return prev;
      const next = { ...prev };
      delete next[context.key];
      return next;
    });
    setError(null);
    setTargetWeightSaveStatus(context.key, 'pending');
    return normalizedNextWeight;
  };

  const handleAdjustNextTargetWeight = (exercise, direction) => {
    const context = resolveTargetWeightControlContext(exercise);
    if (!context) return;
    const step = resolveWeightStepForEquipment(context.equipment);
    const currentWeight = roundWeight(
      targetWeightOptimisticByKeyRef.current[context.key] ?? exercise.targetWeight
    );
    if (!Number.isFinite(currentWeight)) return;
    const nextWeight = roundWeight(
      Math.max(
        TARGET_WEIGHT_MIN,
        currentWeight + (Number(direction) < 0 ? -step : step)
      )
    );
    if (!Number.isFinite(nextWeight)) return;
    queueNextTargetWeightUpdate(exercise, nextWeight);
  };

  const handleNextTargetWeightInputChange = (exercise, value) => {
    const context = resolveTargetWeightControlContext(exercise);
    if (!context) return;
    setTargetWeightInputDraftByKey((prev) => ({
      ...prev,
      [context.key]: value,
    }));
  };

  const handleCommitNextTargetWeightInput = (exercise, value) => {
    const context = resolveTargetWeightControlContext(exercise);
    if (!context) return;
    const parsedWeight = parseTargetWeightInput(value);
    if (!Number.isFinite(parsedWeight)) {
      setTargetWeightInputDraftByKey((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev, context.key)) return prev;
        const next = { ...prev };
        delete next[context.key];
        return next;
      });
      return;
    }
    const clampedWeight = roundWeight(Math.max(TARGET_WEIGHT_MIN, parsedWeight));
    if (!Number.isFinite(clampedWeight)) return;
    queueNextTargetWeightUpdate(exercise, clampedWeight);
  };

  const triggerSetCelebration = (exerciseId, setIndex, routineExerciseId = null) => {
    const exerciseKey = typeof exerciseId === 'string' && exerciseId.includes(':')
      ? exerciseId
      : buildSessionExerciseKey(exerciseId, routineExerciseId);
    const key = `${exerciseKey}:${setIndex}`;
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

  const clearSetCelebration = (exerciseId, setIndex, routineExerciseId = null) => {
    const exerciseKey = typeof exerciseId === 'string' && exerciseId.includes(':')
      ? exerciseId
      : buildSessionExerciseKey(exerciseId, routineExerciseId);
    const key = `${exerciseKey}:${setIndex}`;
    clearSetCelebrationTimeout(key);
    setCelebratingSetKeys((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const triggerExerciseCelebration = (exerciseId, routineExerciseId = null) => {
    const key = typeof exerciseId === 'string' && exerciseId.includes(':')
      ? exerciseId
      : buildSessionExerciseKey(exerciseId, routineExerciseId);
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

  const handleToggleSetChecklist = (
    exerciseId,
    setIndex,
    routineExerciseId = null,
    { setRepsOverridesByExerciseId = {}, currentlyChecked = null } = {}
  ) => {
    if (
      exerciseId === WARMUP_STEP_ID
      || exerciseId === buildSessionExerciseKey(WARMUP_STEP_ID)
    ) return;
    const exerciseKey = typeof exerciseId === 'string' && exerciseId.includes(':')
      ? exerciseId
      : buildSessionExerciseKey(exerciseId, routineExerciseId);
    const currentChecklist = { ...(setChecklistByExerciseId?.[exerciseKey] || {}) };
    const isChecked = currentlyChecked === null
      ? Boolean(currentChecklist[setIndex])
      : Boolean(currentlyChecked);
    if (isChecked) {
      currentChecklist[setIndex] = false;
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
    const currentExerciseKey = resolveSessionExerciseKey(currentExercise);
    const currentSupersetPair = supersetPartnerByExerciseId.get(currentExerciseKey) || null;
    const isToggleOnCurrent = exerciseKey === currentExerciseKey;
    const isToggleOnCurrentPair = Boolean(
      currentSupersetPair && resolveSessionExerciseKey(currentSupersetPair) === exerciseKey
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
      const partnerExerciseKey = resolveSessionExerciseKey(currentSupersetPair);
      const partnerRows = buildChecklistRows(
        currentSupersetPair,
        checklistOverridesByExerciseId[partnerExerciseKey]
        || setChecklistByExerciseId[partnerExerciseKey]
        || {}
      );
      const partnerAllSetsDone = partnerRows.length > 0 && partnerRows.every((row) => row.checked);
      if (!partnerAllSetsDone) return;
    }
    void handleFinishExercise({ checklistOverridesByExerciseId, setRepsOverridesByExerciseId });
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
    setCurrentExerciseId(resolveSessionExerciseKey(first));
    setSessionMode('workout');
  };

  const handleFinishExercise = async ({ checklistOverridesByExerciseId = {}, setRepsOverridesByExerciseId = {} } = {}) => {
    if (!activeSession || !currentExercise) return;
    if (currentExercise.exerciseId === WARMUP_STEP_ID) {
      const done = await handleCompleteWarmupStep();
      if (!done) return;
      const nextExercise = resolveNextPendingExercise(currentExercise);
      if (nextExercise) {
        const started = await handleStartExercise(
          nextExercise.exerciseId,
          nextExercise.routineExerciseId || null
        );
        if (!started) return;
        setCurrentExerciseId(resolveSessionExerciseKey(nextExercise));
        return;
      }
      await handleEndSession(true);
      return;
    }
    if (finishExerciseInFlightRef.current) return;
    finishExerciseInFlightRef.current = true;
    setIsExerciseTransitioning(true);
    try {
      const currentExerciseKey = resolveSessionExerciseKey(currentExercise);
      const currentSupersetPair = supersetPartnerByExerciseId.get(currentExerciseKey) || null;
      const isFinalPendingSupersetPair = Boolean(
        currentSupersetPair
        && !resolveIsExerciseCompleted(currentSupersetPair)
        && !resolveNextPendingExercise(currentExercise, [resolveSessionExerciseKey(currentSupersetPair)])
      );
      const partnerRowsAllDone = (() => {
        if (!currentSupersetPair || resolveIsExerciseCompleted(currentSupersetPair)) return false;
        const partnerExerciseKey = resolveSessionExerciseKey(currentSupersetPair);
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
        shouldCompleteSupersetPairInline ? [resolveSessionExerciseKey(currentSupersetPair)] : []
      );

      const finishedAt = new Date().toISOString();
      const startAt = resolveExerciseStartAt(currentExercise, finishedAt);
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
        includeUnchecked: true,
      });

      for (const payload of missingSetPayloads) {
        const reps = resolveSelectedSetReps(
          currentExerciseKey,
          payload.setIndex,
          payload.reps,
          setRepsOverridesByExerciseId
        );
        if (!Number.isInteger(reps) || reps <= 0) return;
        const saved = await handleAddSet(
          currentExercise.exerciseId,
          currentExercise.routineExerciseId || null,
          reps,
          payload.weight,
          payload.bandLabel,
          payload.startedAt,
          payload.completedAt
        );
        if (!saved) return;
      }

      const completed = await handleCompleteExercise(
        currentExercise.exerciseId,
        currentExercise.routineExerciseId || null,
        finishedAt
      );
      if (!completed) return;
      await persistPendingTargetWeightForExercise(currentExercise);
      triggerExerciseCelebration(
        currentExercise.exerciseId,
        currentExercise.routineExerciseId || null
      );
      clearLocalChecklistForExercise(currentExerciseKey);
      clearLocalSetRepsForExercise(currentExerciseKey);

      if (shouldCompleteSupersetPairInline && currentSupersetPair) {
        const partnerFinishedAt = new Date().toISOString();
        const partnerStartAt = resolveExerciseStartAt(currentSupersetPair, partnerFinishedAt);
        const partnerExerciseKey = resolveSessionExerciseKey(currentSupersetPair);
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
          includeUnchecked: true,
        });

        for (const payload of partnerMissingSetPayloads) {
          const reps = resolveSelectedSetReps(
            partnerExerciseKey,
            payload.setIndex,
            payload.reps,
            setRepsOverridesByExerciseId
          );
          if (!Number.isInteger(reps) || reps <= 0) return;
          const saved = await handleAddSet(
            currentSupersetPair.exerciseId,
            currentSupersetPair.routineExerciseId || null,
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
          currentSupersetPair.routineExerciseId || null,
          partnerFinishedAt
        );
        if (!partnerCompleted) return;
        await persistPendingTargetWeightForExercise(currentSupersetPair);
        triggerExerciseCelebration(
          currentSupersetPair.exerciseId,
          currentSupersetPair.routineExerciseId || null
        );
        clearLocalChecklistForExercise(partnerExerciseKey);
        clearLocalSetRepsForExercise(partnerExerciseKey);
      }

      if (nextExercise) {
        const started = await handleStartExercise(
          nextExercise.exerciseId,
          nextExercise.routineExerciseId || null
        );
        if (!started) return;
        setCurrentExerciseId(resolveSessionExerciseKey(nextExercise));
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
    if (skipExerciseInFlightRef.current || finishExerciseInFlightRef.current) return;
    skipExerciseInFlightRef.current = true;
    setIsExerciseTransitioning(true);
    const currentExerciseKey = resolveSessionExerciseKey(currentExercise);
    const currentSupersetPair = supersetPartnerByExerciseId.get(currentExerciseKey) || null;
    const shouldSkipSupersetPair = Boolean(
      currentSupersetPair && !resolveIsExerciseCompleted(currentSupersetPair)
    );
    try {
      const completedAt = new Date().toISOString();
      const currentChecklist = setChecklistByExerciseId[currentExerciseKey] || {};
      const currentCheckedSetIndexes = new Set(
        Object.entries(currentChecklist)
          .filter(([, checkedAt]) => Boolean(checkedAt))
          .map(([setIndex]) => Number(setIndex))
          .filter((setIndex) => Number.isInteger(setIndex) && setIndex > 0)
      );
      const currentStartAt = resolveExerciseStartAt(currentExercise, completedAt);
      const currentMissingSetPayloads = buildMissingSetPayloads({
        exercise: currentExercise,
        checkedAtBySetIndex: currentChecklist,
        exerciseStartedAt: currentStartAt,
        exerciseFinishedAt: completedAt,
        defaultBandLabel: SESSION_BAND_OPTIONS[0]?.name || null,
        includeUnchecked: false,
      }).filter((payload) => currentCheckedSetIndexes.has(payload.setIndex));
      for (const payload of currentMissingSetPayloads) {
        const reps = resolveSelectedSetReps(
          currentExerciseKey,
          payload.setIndex,
          payload.reps
        );
        if (!Number.isInteger(reps) || reps <= 0) return;
        const saved = await handleAddSet(
          currentExercise.exerciseId,
          currentExercise.routineExerciseId || null,
          reps,
          payload.weight,
          payload.bandLabel,
          payload.startedAt,
          payload.completedAt
        );
        if (!saved) return;
      }
      const nextExercise = resolveNextPendingExercise(
        currentExercise,
        shouldSkipSupersetPair && currentSupersetPair ? [resolveSessionExerciseKey(currentSupersetPair)] : []
      );
      const completed = await handleSkipExerciseProgress(
        currentExercise.exerciseId,
        currentExercise.routineExerciseId || null,
        completedAt
      );
      if (!completed) return;
      await persistPendingTargetWeightForExercise(currentExercise);
      triggerExerciseCelebration(
        currentExercise.exerciseId,
        currentExercise.routineExerciseId || null
      );
      clearLocalChecklistForExercise(currentExerciseKey);
      clearLocalSetRepsForExercise(currentExerciseKey);
      if (shouldSkipSupersetPair && currentSupersetPair) {
        const partnerExerciseKey = resolveSessionExerciseKey(currentSupersetPair);
        const partnerChecklist = setChecklistByExerciseId[partnerExerciseKey] || {};
        const partnerCheckedSetIndexes = new Set(
          Object.entries(partnerChecklist)
            .filter(([, checkedAt]) => Boolean(checkedAt))
            .map(([setIndex]) => Number(setIndex))
            .filter((setIndex) => Number.isInteger(setIndex) && setIndex > 0)
        );
        const partnerStartAt = resolveExerciseStartAt(currentSupersetPair, completedAt);
        const partnerMissingSetPayloads = buildMissingSetPayloads({
          exercise: currentSupersetPair,
          checkedAtBySetIndex: partnerChecklist,
          exerciseStartedAt: partnerStartAt,
          exerciseFinishedAt: completedAt,
          defaultBandLabel: SESSION_BAND_OPTIONS[0]?.name || null,
          includeUnchecked: false,
        }).filter((payload) => partnerCheckedSetIndexes.has(payload.setIndex));
        for (const payload of partnerMissingSetPayloads) {
          const reps = resolveSelectedSetReps(
            partnerExerciseKey,
            payload.setIndex,
            payload.reps
          );
          if (!Number.isInteger(reps) || reps <= 0) return;
          const saved = await handleAddSet(
            currentSupersetPair.exerciseId,
            currentSupersetPair.routineExerciseId || null,
            reps,
            payload.weight,
            payload.bandLabel,
            payload.startedAt,
            payload.completedAt
          );
          if (!saved) return;
        }
        const partnerCompleted = await handleSkipExerciseProgress(
          currentSupersetPair.exerciseId,
          currentSupersetPair.routineExerciseId || null,
          completedAt
        );
        if (!partnerCompleted) return;
        await persistPendingTargetWeightForExercise(currentSupersetPair);
        triggerExerciseCelebration(
          currentSupersetPair.exerciseId,
          currentSupersetPair.routineExerciseId || null
        );
        clearLocalChecklistForExercise(partnerExerciseKey);
        clearLocalSetRepsForExercise(partnerExerciseKey);
      }
      if (nextExercise) {
        const started = await handleStartExercise(
          nextExercise.exerciseId,
          nextExercise.routineExerciseId || null
        );
        if (!started) return;
        setCurrentExerciseId(resolveSessionExerciseKey(nextExercise));
        return;
      }
      await handleEndSession(true);
    } finally {
      skipExerciseInFlightRef.current = false;
      setIsExerciseTransitioning(false);
    }
  };

  const handleAddSet = async (
    exerciseId,
    routineExerciseId = null,
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
          routineExerciseId,
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
        const setKey = data?.set?.sessionExerciseKey
          || buildSessionExerciseKey(exerciseId, routineExerciseId);
        const matchIndex = nextExercises.findIndex(
          (exercise) => resolveSessionExerciseKey(exercise) === setKey
        );
        if (matchIndex === -1) {
          nextExercises.push({
            exerciseId,
            routineExerciseId: normalizeRoutineExerciseId(
              data?.set?.routineExerciseId ?? routineExerciseId
            ),
            sessionExerciseKey: setKey,
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
            routineExerciseId: normalizeRoutineExerciseId(
              data?.set?.routineExerciseId ?? existing.routineExerciseId
            ),
            sessionExerciseKey: setKey,
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
    if (!activeSession) return false;
    setError(null);
    let deletedSetPayload = null;
    try {
      activeSession.exercises?.forEach((exercise) => {
        const found = (exercise.sets || []).find((set) => set.id === setId);
        if (found) {
          deletedSetPayload = {
            exerciseId: exercise.exerciseId,
            routineExerciseId: exercise.routineExerciseId || found.routineExerciseId || null,
            sessionExerciseKey: resolveSessionExerciseKey(exercise),
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
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  };

  const handleUndoDeleteSet = async () => {
    if (!recentlyDeletedSet) return;
    const payload = recentlyDeletedSet;
    setRecentlyDeletedSet(null);
    await handleAddSet(
      payload.exerciseId,
      payload.routineExerciseId || null,
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
    const localChecklist = setChecklistByExerciseId[resolveSessionExerciseKey(exercise)] || {};
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
    && pendingExercises.some(
      (exercise) => resolveSessionExerciseKey(exercise) === resolveSessionExerciseKey(currentExercise)
    )
    && pendingExercises.some(
      (exercise) => resolveSessionExerciseKey(exercise) === resolveSessionExerciseKey(currentSupersetPartner)
    )
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
        canInlineCompleteCurrentSupersetPair
          ? [resolveSessionExerciseKey(currentSupersetPartner)]
          : []
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
  const resolveExerciseWorkoutTargetWeight = (exercise) => {
    const rawTargetWeight = exercise?.targetWeight;
    if (rawTargetWeight === null || rawTargetWeight === undefined || rawTargetWeight === '') {
      return null;
    }
    const fallback = Number(rawTargetWeight);
    return Number.isFinite(fallback) ? fallback : null;
  };
  const resolveExerciseNextTargetWeight = (exercise) => {
    const fallback = resolveExerciseWorkoutTargetWeight(exercise);
    if (!activeSession || !exercise) return fallback;
    const key = buildTargetWeightControlKey(
      activeSession.routineId,
      exercise.exerciseId,
      exercise.equipment,
      exercise.routineExerciseId
    );
    const optimistic = roundWeight(targetWeightOptimisticByKeyRef.current[key]);
    if (Number.isFinite(optimistic)) return optimistic;
    return fallback;
  };
  const resolveTargetWeightControlModel = (exercise) => {
    if (!activeSession || !isWeightedTargetEditable(exercise)) return null;
    const key = buildTargetWeightControlKey(
      activeSession.routineId,
      exercise.exerciseId,
      exercise.equipment,
      exercise.routineExerciseId
    );
    const targetWeight = resolveExerciseNextTargetWeight(exercise);
    if (!Number.isFinite(targetWeight)) return null;
    return {
      key,
      targetWeight,
      status: targetWeightSaveStatusByKey[key] || null,
    };
  };
  const renderExerciseTargetBadges = (
    exercise,
    {
      includeSets = false,
      includeRest = false,
      showSupersetBadge = false,
    } = {}
  ) => {
    const displayWeight = resolveExerciseWorkoutTargetWeight(exercise);
    return (
      <>
        {Number.isFinite(displayWeight)
          ? <span className="badge">{formatNumber(displayWeight)} kg</span>
          : null}
        {includeSets && exercise.targetSets ? <span className="badge">{exercise.targetSets} sets</span> : null}
        {exercise.targetRepsRange ? <span className="badge">{exercise.targetRepsRange} reps</span> : null}
        {!exercise.targetRepsRange && exercise.targetReps ? <span className="badge">{exercise.targetReps} reps</span> : null}
        {exercise.targetBandLabel ? <span className="badge">{exercise.targetBandLabel}</span> : null}
        {includeRest && exercise.targetRestSeconds ? <span className="badge">Rest {formatRestTime(exercise.targetRestSeconds)}</span> : null}
        {showSupersetBadge ? <span className="badge badge-superset">Superset</span> : null}
      </>
    );
  };
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
            showSupersetBadge: Boolean(
              supersetPartnerByExerciseId.get(resolveSessionExerciseKey(exercise))
            ),
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
  const sessionDetailRoutineTypeLabel = formatRoutineTypeLabel(sessionDetailSummary?.routineType);
  const showSessionDetailWarmupCard = normalizeRoutineType(sessionDetailSummary?.routineType) === 'standard';
  const sessionDetailAggregateMetrics = useMemo(
    () => resolveSessionDetailAggregateMetrics(sessionDetailSummary),
    [sessionDetailSummary]
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
            key="workout-state-loading"
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
          key={`workout-state-active-${activeSession.id || 'current'}`}
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
                key={`guided-workout-${resolveSessionExerciseKey(currentExercise)}-${resolveSessionExerciseKey(currentSupersetPartner) || 'solo'}`}
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
                  const isActiveCard = resolveSessionExerciseKey(exercise) === resolveSessionExerciseKey(currentExercise);
                  const checklistRows = resolveChecklistRows(exercise);
                  const exerciseCelebrationKey = resolveSessionExerciseKey(exercise);
                  const exerciseNotes = typeof exercise.notes === 'string'
                    ? exercise.notes.trim()
                    : '';
                  const targetWeightControl = resolveTargetWeightControlModel(exercise);
                  const targetWeightInputValue = targetWeightControl
                    ? (
                        targetWeightInputDraftByKey[targetWeightControl.key]
                        ?? formatTargetWeightInputValue(targetWeightControl.targetWeight)
                      )
                    : '';
                  const targetWeightStatusLabel = resolveTargetWeightSaveStatusLabel(
                    targetWeightControl?.status
                  );
                  return (
                    <div
                      key={`guided-workout-card-${resolveSessionExerciseKey(exercise)}`}
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
                        <div className="guided-workout-header-actions">
                          {isActiveCard ? (
                            <div className="guided-workout-nav-actions" role="group" aria-label="Exercise navigation">
                              <button
                                className="button ghost icon-button guided-workout-nav-button"
                                type="button"
                                onClick={() => handleNavigateExerciseByOffset(-1)}
                                disabled={!canNavigateToPreviousExercise || isExerciseTransitioning}
                                aria-label="Previous exercise"
                                title="Previous exercise"
                              >
                                <FaChevronLeft aria-hidden="true" />
                              </button>
                              <button
                                className="button ghost icon-button guided-workout-nav-button"
                                type="button"
                                onClick={() => handleNavigateExerciseByOffset(1)}
                                disabled={!canNavigateToNextExercise || isExerciseTransitioning}
                                aria-label="Next exercise"
                                title="Next exercise"
                              >
                                <FaChevronRight aria-hidden="true" />
                              </button>
                            </div>
                          ) : null}
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
                      </div>
                      <div className="inline">
                        {renderExerciseTargetBadges(exercise, { includeRest: true })}
                      </div>
                      {targetWeightControl ? (
                        <div className="guided-next-target-adjuster">
                          <span className="guided-next-target-label muted">Set new target for next workout</span>
                          <div className="guided-next-target-controls">
                            <button
                              className="button ghost icon-button guided-next-target-button"
                              type="button"
                              aria-label={`Decrease next target weight for ${exercise.name}`}
                              title="Decrease next target weight"
                              onClick={() => handleAdjustNextTargetWeight(exercise, -1)}
                            >
                              -
                            </button>
                            <label className="guided-next-target-value" aria-label={`Set next target weight for ${exercise.name}`}>
                              <input
                                className="guided-next-target-input"
                                type="text"
                                inputMode="decimal"
                                aria-label={`Set next target weight for ${exercise.name}`}
                                value={targetWeightInputValue}
                                onChange={(event) => handleNextTargetWeightInputChange(exercise, event.target.value)}
                                onBlur={(event) => handleCommitNextTargetWeightInput(exercise, event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault();
                                    event.currentTarget.blur();
                                  }
                                }}
                              />
                              <span className="guided-next-target-unit">kg</span>
                            </label>
                            <button
                              className="button ghost icon-button guided-next-target-button"
                              type="button"
                              aria-label={`Increase next target weight for ${exercise.name}`}
                              title="Increase next target weight"
                              onClick={() => handleAdjustNextTargetWeight(exercise, 1)}
                            >
                              +
                            </button>
                          </div>
                          {targetWeightStatusLabel ? (
                            <span
                              className={`guided-next-target-status guided-next-target-status-${targetWeightControl.status}`}
                            >
                              {targetWeightStatusLabel}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
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
                            const canEditCompletedExercise = (
                              sessionMode === 'workout'
                              && !exercise.isWarmupStep
                              && resolveIsExerciseCompleted(exercise)
                            );
                            const rowLocked = row.locked && !canEditCompletedExercise;
                            const showSetRepsSelector = (
                              normalizeRoutineType(activeSession?.routineType) === 'standard'
                              && !exercise.isWarmupStep
                              && !row.persistedSet
                            );
                            const sessionExerciseKey = resolveSessionExerciseKey(exercise);
                            const targetReps = resolveTargetRepsValue(exercise);
                            const selectedSetReps = resolveSelectedSetReps(
                              sessionExerciseKey,
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
                            const statusLabel = row.locked ? 'Logged' : row.checked ? 'Done' : 'Queued';
                            const setCelebrationKey = `${sessionExerciseKey}:${row.setIndex}`;
                            return (
                              <div
                                key={`${sessionExerciseKey}-${row.setIndex}`}
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
                                  handleToggleSetChecklist(sessionExerciseKey, row.setIndex, null, { currentlyChecked: row.checked });
                                }}
                                onKeyDown={(event) => {
                                  if (rowLocked) return;
                                  if (event.key !== 'Enter' && event.key !== ' ') return;
                                  event.preventDefault();
                                  handleToggleSetChecklist(sessionExerciseKey, row.setIndex, null, { currentlyChecked: row.checked });
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
                                          sessionExerciseKey,
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
                <div className="split modal-header">
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
                  disabled={isExerciseTransitioning}
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
                  disabled={isExerciseTransitioning}
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
                <div className="split modal-header">
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
                <div className="split modal-header">
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
          key="workout-state-start"
          className="card"
          variants={motionConfig.variants.fadeUp}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <div className="section-title">Start a workout</div>
          <div className="start-workout-routine-list">
            <StartWorkoutRoutineList
              routines={startWorkoutRoutines}
              onStartSession={handleStartSession}
            />
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
                    <th>When</th>
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
                        <td>{resolveRecentWorkoutCount(session)}</td>
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
                <div className="split modal-header">
                  <div className="inline">
                    <div className="section-title" style={{ marginBottom: 0 }}>
                      Workout details
                    </div>
                    <span className="badge start-workout-routine-type-badge">
                      {sessionDetailRoutineTypeLabel}
                    </span>
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
                      {showSessionDetailWarmupCard ? (
                        <div className="card session-complete-metric">
                          <div className="muted stats-kpi-label">Warmup time</div>
                          <div className="section-title">{sessionDetailWarmupDurationSeconds !== null ? formatDurationSeconds(sessionDetailWarmupDurationSeconds) : '—'}</div>
                        </div>
                      ) : null}
                      <div className="card session-complete-metric">
                        <div className="muted stats-kpi-label">Exercises</div>
                        <div className="section-title">{sessionDetailExerciseCount} / {sessionDetailExerciseTotal || 0}</div>
                      </div>
                      <div className="card session-complete-metric">
                        <div className="muted stats-kpi-label">Sets</div>
                        <div className="section-title">{formatNumber(sessionDetailAggregateMetrics.totalSets || 0)}</div>
                      </div>
                      <div className="card session-complete-metric">
                        <div className="muted stats-kpi-label">Total reps</div>
                        <div className="section-title">{formatNumber(sessionDetailAggregateMetrics.totalReps || 0)}</div>
                      </div>
                      <div className="card session-complete-metric">
                        <div className="muted stats-kpi-label">Volume</div>
                        <div className="section-title">{formatNumber(sessionDetailAggregateMetrics.totalVolume || 0)} kg</div>
                      </div>
                    </div>
                    <div className="stack">
                      {buildWorkoutPreviewBlocks(sessionDetailSummary.exercises || []).map((block) => {
                        const blockExercises = (sessionDetailSummary.exercises || []).slice(block.startIndex, block.endIndex + 1);
                        const blockDurationSeconds = blockExercises.reduce((total, exercise) => {
                          const value = Number(exercise?.durationSeconds);
                          return Number.isFinite(value) && value > 0 ? total + value : total;
                        }, 0);
                        const renderSessionDetailExercise = (exercise, index, { grouped = false, showDuration = true } = {}) => {
                          const exerciseKey = `${exercise.exerciseId}-${exercise.position ?? index}-${index}`;
                          const isExpanded = expandedDetailExercises.includes(exerciseKey);
                          const exerciseState = resolveSessionDetailExerciseState(exercise, {
                            sessionEnded: Boolean(sessionDetailSummary.endedAt),
                          });
                          const detailSetRows = buildSessionDetailSetRows(exercise, { exerciseState });
                          const setCount = detailSetRows.length;
                          const exerciseStateLabel = formatSessionDetailExerciseStateLabel(exerciseState);

                          return (
                            <div key={exerciseKey} className={`set-list${grouped ? ' session-detail-exercise-grouped' : ''}`}>
                              <div className="session-detail-exercise-header">
                                <div className="section-title session-detail-exercise-title" style={{ fontSize: '1rem' }}>
                                  {exercise.name}
                                  {showDuration && exercise.durationSeconds ? ` · ${formatDurationSeconds(exercise.durationSeconds)}` : ''}
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
                                  <span
                                    className={`muted session-detail-skipped-note session-detail-state-note-${exerciseState}`}
                                  >
                                    {exerciseStateLabel}
                                  </span>
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
                                          <th scope="col">Weight</th>
                                          <th scope="col">Reps</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {detailSetRows.map((row, setIndex) => (
                                          <tr
                                            key={
                                              row.kind === 'logged'
                                                ? `${row.set?.id ?? 'set'}-${row.set?.setIndex ?? 'na'}-${row.set?.createdAt || row.set?.completedAt || setIndex}`
                                                : `${row.kind}-${exercise.exerciseId}-${row.setIndex}`
                                            }
                                            className={`session-detail-set-row${row.kind === 'skipped' ? ' session-detail-set-row-skipped' : ''}`}
                                          >
                                            <td>
                                              <span className="set-chip">Set {row.setIndex}</span>
                                            </td>
                                            <td>
                                              {row.kind === 'skipped'
                                                ? '—'
                                                : row.kind === 'completed_unlogged'
                                                  ? resolveSessionDetailPlaceholderWeight(exercise)
                                                : row.set?.bandLabel
                                                  ? row.set.bandLabel
                                                  : Number(row.set?.weight) === 0
                                                    ? 'Bodyweight'
                                                    : `${formatNumber(row.set?.weight)} kg`}
                                            </td>
                                            <td>
                                              {row.kind === 'skipped'
                                                ? 'Skipped'
                                                : row.kind === 'completed_unlogged'
                                                  ? resolveSessionDetailPlaceholderReps(exercise)
                                                : `${formatNumber(row.set?.reps)} reps`}
                                              {row.kind === 'logged' && row.set?.durationSeconds
                                                ? ` · ${formatDurationSeconds(row.set.durationSeconds)}`
                                                : ''}
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
                        };

                        if (!block.isSuperset) {
                          const exercise = blockExercises[0];
                          return renderSessionDetailExercise(exercise, block.startIndex, {
                            grouped: false,
                            showDuration: true,
                          });
                        }

                        const blockKey = `session-detail-superset-${block.startIndex}-${block.endIndex}`;
                        return (
                          <div key={blockKey} className="workout-preview-superset-block session-detail-superset-block">
                            <div className="inline workout-preview-superset-header session-detail-superset-header">
                              <span className="badge badge-superset">Superset</span>
                              {blockDurationSeconds > 0 ? (
                                <span className="muted session-detail-superset-duration">{formatDurationSeconds(blockDurationSeconds)}</span>
                              ) : null}
                            </div>
                            <div className="stack workout-preview-superset-items session-detail-superset-items">
                              {blockExercises.map((exercise, offset) =>
                                renderSessionDetailExercise(exercise, block.startIndex + offset, {
                                  grouped: true,
                                  showDuration: false,
                                })
                              )}
                            </div>
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

export default WorkoutPage;
