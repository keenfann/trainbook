import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FaArrowDown, FaArrowUp, FaTrashCan } from 'react-icons/fa6';
import {
  BASE_EQUIPMENT_TYPES,
  TARGET_SET_OPTIONS,
  TARGET_REP_MIN_OPTIONS,
  TARGET_REP_MAX_OPTIONS,
  ROUTINE_BAND_OPTIONS,
  ROUTINE_REST_OPTIONS,
  ROUTINE_REST_OPTION_VALUES,
  DEFAULT_TARGET_REST_SECONDS,
  DEFAULT_TARGET_SETS,
  normalizeRoutineType,
  normalizeExercisePrimaryMuscles,
  formatMuscleLabel,
  resolveTargetRepBounds,
  resolveAutoTargetRepMax,
  resolveRoutineRestOptionValue,
  createRoutineEditorItem,
  encodeRoutineEquipmentValue,
  decodeRoutineEquipmentValue,
  normalizeSupersetGroup,
} from '../../routines/routine-utils.js';

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
  const [isSaving, setIsSaving] = useState(false);
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

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSaving) return;
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
    setIsSaving(true);
    try {
      await onSave(payload);
    } finally {
      setIsSaving(false);
    }
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
                          <div className="section-title">Exercise ({itemIndex + 1}/{items.length})</div>
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
          disabled={isSaving}
          whileTap={motionConfig.reducedMotion ? undefined : { scale: motionConfig.tapScale }}
        >
          {isSaving ? 'Saving…' : 'Save'}
        </motion.button>
      </motion.div>
    </form>
  );
}

export default RoutineEditor;
