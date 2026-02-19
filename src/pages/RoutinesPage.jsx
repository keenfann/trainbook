import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FaArrowDown, FaArrowUp, FaCopy, FaPenToSquare, FaTrashCan, FaXmark } from 'react-icons/fa6';
import { apiFetch } from '../api.js';
import { getMotionConfig } from '../motion.js';
import { useMotionPreferences } from '../motion-preferences.jsx';
import {
  formatRoutineTypeLabel,
  normalizeRoutineForUi,
  formatRestTime,
  normalizeSupersetGroup,
  buildWorkoutPreviewBlocks,
} from '../features/routines/routine-utils.js';
import RoutineEditor from '../features/routines/components/routine-editor.jsx';
import AnimatedModal from '../ui/modal/AnimatedModal.jsx';

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
            <div className="split modal-header">
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

export default RoutinesPage;
