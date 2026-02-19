import { formatRoutineLastUsedDaysAgo } from '../../../date-labels.js';
import { formatRoutineTypeLabel } from '../workout-utils.js';

function StartWorkoutRoutineList({ routines, onStartSession }) {
  if (!routines.length) {
    return (
      <div className="muted">
        Create a routine in the Routines tab before starting a workout.
      </div>
    );
  }

  return routines.map((routine) => {
    const routineNote = typeof routine.notes === 'string' ? routine.notes.trim() : '';
    const routineLastUsedLabel = formatRoutineLastUsedDaysAgo(routine.lastUsedAt);
    const routineTypeLabel = formatRoutineTypeLabel(routine.routineType);
    return (
      <button
        key={routine.id}
        className="button start-workout-routine-button"
        type="button"
        aria-label={routine.name}
        onClick={() => onStartSession(routine.id)}
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
  });
}

export default StartWorkoutRoutineList;
