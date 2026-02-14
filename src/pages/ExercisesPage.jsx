import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FaPenToSquare, FaXmark } from 'react-icons/fa6';
import { apiFetch } from '../api.js';
import { getMotionConfig } from '../motion.js';
import { useMotionPreferences } from '../motion-preferences.jsx';
import {
  PRIMARY_MUSCLE_OPTIONS,
  normalizeExercisePrimaryMuscles,
  formatMuscleLabel,
  formatInstructionsForTextarea,
  parseInstructionsFromTextarea,
  resolveExerciseImageUrl,
  formatDateTime,
  formatExerciseImpact,
} from '../features/workout/workout-utils.js';
import AnimatedModal from '../ui/modal/AnimatedModal.jsx';

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
            <div className="split modal-header">
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
            <div className="split modal-header">
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
              <div className="routine-editor-footer modal-footer">
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

export default ExercisesPage;
