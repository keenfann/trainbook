import { useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { apiFetch } from './api.js';

const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
const MUSCLE_GROUPS = ['Corrective', 'Core', 'Legs', 'Pull', 'Push'];
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

const LOCALE = 'sv-SE';

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

function formatExerciseImpact(impact) {
  if (!impact) return 'Impact unavailable.';
  return `${impact.routineReferences} routine links (${impact.routineUsers} users), ${impact.setReferences} logged sets (${impact.setUsers} users)`;
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
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="app-shell" onClick={() => menuOpen && setMenuOpen(false)}>
      <header className="app-header">
        <div className="app-header-inner">
          <div className="brand">Trainbook</div>
          <div className="header-menu">
            <button
              type="button"
              className="header-chip"
              onClick={(event) => {
                event.stopPropagation();
                setMenuOpen((prev) => !prev);
              }}
            >
              {user?.username}
            </button>
            {menuOpen ? (
              <div
                className="menu-panel"
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
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <main className="page">
        {error ? <div className="notice">{error}</div> : null}
        <Routes>
          <Route path="/" element={<Navigate to="/log" replace />} />
          <Route path="/log" element={<LogPage />} />
          <Route path="/routines" element={<RoutinesPage />} />
          <Route path="/exercises" element={<ExercisesPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/settings" element={<SettingsPage user={user} onLogout={onLogout} />} />
        </Routes>
      </main>

      <nav className="navbar">
        <NavLink className="nav-link" to="/log">
          Log
        </NavLink>
        <NavLink className="nav-link" to="/routines">
          Routines
        </NavLink>
        <NavLink className="nav-link" to="/exercises">
          Exercises
        </NavLink>
        <NavLink className="nav-link" to="/stats">
          Stats
        </NavLink>
      </nav>
    </div>
  );
}

function AuthPage({ mode, onAuth }) {
  const navigate = useNavigate();
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
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="auth-title">{isLogin ? 'Welcome back' : 'Create account'}</div>
        <p className="muted">
          {isLogin
            ? 'Log in to keep training momentum.'
            : 'Start logging sessions and watch progress stack up.'}
        </p>
        {error ? <div className="notice">{error}</div> : null}
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
      </form>
    </div>
  );
}

function LogPage() {
  const [routines, setRoutines] = useState([]);
  const [exercises, setExercises] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [weights, setWeights] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [startRoutineId, setStartRoutineId] = useState('');
  const [startName, setStartName] = useState('');
  const [extraExerciseIds, setExtraExerciseIds] = useState([]);
  const [weightInput, setWeightInput] = useState('');

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [routineData, exerciseData, sessionData, sessionList, weightData] =
        await Promise.all([
          apiFetch('/api/routines'),
          apiFetch('/api/exercises'),
          apiFetch('/api/sessions/active'),
          apiFetch('/api/sessions?limit=6'),
          apiFetch('/api/weights?limit=6'),
        ]);
      setRoutines(routineData.routines || []);
      setExercises(exerciseData.exercises || []);
      setActiveSession(sessionData.session || null);
      setSessions(sessionList.sessions || []);
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

  const routineById = useMemo(() => {
    const map = new Map();
    routines.forEach((routine) => map.set(routine.id, routine));
    return map;
  }, [routines]);

  const exerciseById = useMemo(() => {
    const map = new Map();
    exercises.forEach((exercise) => map.set(exercise.id, exercise));
    return map;
  }, [exercises]);

  const sessionExercises = useMemo(() => {
    if (!activeSession) return [];
    const routine = activeSession.routineId
      ? routineById.get(activeSession.routineId)
      : null;
    const base = routine
      ? routine.exercises.map((item) => ({
          exerciseId: item.exerciseId,
          name: item.name,
          equipment: item.equipment || null,
          targetSets: item.targetSets,
          targetReps: item.targetReps,
          targetWeight: item.targetWeight,
        }))
      : exercises.map((exercise) => ({
          exerciseId: exercise.id,
          name: exercise.name,
          equipment: null,
          targetSets: null,
          targetReps: null,
          targetWeight: null,
        }));

    const byId = new Map();
    base.forEach((item) => byId.set(item.exerciseId, { ...item, sets: [] }));
    (activeSession.exercises || []).forEach((exercise) => {
      if (!byId.has(exercise.exerciseId)) {
        byId.set(exercise.exerciseId, {
          exerciseId: exercise.exerciseId,
          name: exercise.name,
          equipment: null,
          targetSets: null,
          targetReps: null,
          targetWeight: null,
          sets: exercise.sets || [],
        });
      } else {
        const existing = byId.get(exercise.exerciseId);
        existing.sets = exercise.sets || [];
      }
    });

    extraExerciseIds.forEach((id) => {
      if (byId.has(id)) return;
      const exercise = exerciseById.get(id);
      if (!exercise) return;
      byId.set(id, {
        exerciseId: id,
        name: exercise.name,
        equipment: null,
        targetSets: null,
        targetReps: null,
        targetWeight: null,
        sets: [],
      });
    });

    return Array.from(byId.values());
  }, [activeSession, routineById, exercises, extraExerciseIds, exerciseById]);

  const handleStartSession = async () => {
    setError(null);
    try {
      const payload = {
        routineId: startRoutineId ? Number(startRoutineId) : null,
        name: startName || null,
      };
      const data = await apiFetch('/api/sessions', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setActiveSession(data.session);
      setExtraExerciseIds([]);
      setStartName('');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleEndSession = async () => {
    if (!activeSession) return;
    setError(null);
    try {
      const data = await apiFetch(`/api/sessions/${activeSession.id}`, {
        method: 'PUT',
        body: JSON.stringify({ endedAt: new Date().toISOString() }),
      });
      setActiveSession(null);
      setSessions((prev) => [data.session, ...prev]);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAddSet = async (exerciseId, reps, weight) => {
    if (!activeSession) return;
    setError(null);
    try {
      const data = await apiFetch(`/api/sessions/${activeSession.id}/sets`, {
        method: 'POST',
        body: JSON.stringify({ exerciseId, reps, weight }),
      });
      setActiveSession((prev) => {
        if (!prev) return prev;
        const nextExercises = [...(prev.exercises || [])];
        const matchIndex = nextExercises.findIndex(
          (exercise) => exercise.exerciseId === exerciseId
        );
        if (matchIndex === -1) {
          const exercise = exerciseById.get(exerciseId);
          nextExercises.push({
            exerciseId,
            name: exercise?.name || 'Exercise',
            equipment: null,
            sets: [data.set],
          });
        } else {
          const existing = nextExercises[matchIndex];
          nextExercises[matchIndex] = {
            ...existing,
            sets: [...(existing.sets || []), data.set],
          };
        }
        return { ...prev, exercises: nextExercises };
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteSet = async (setId) => {
    if (!activeSession) return;
    setError(null);
    try {
      await apiFetch(`/api/sets/${setId}`, { method: 'DELETE' });
      setActiveSession((prev) => {
        if (!prev) return prev;
        const nextExercises = (prev.exercises || []).map((exercise) => ({
          ...exercise,
          sets: (exercise.sets || []).filter((set) => set.id !== setId),
        }));
        return { ...prev, exercises: nextExercises };
      });
    } catch (err) {
      setError(err.message);
    }
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

  const availableExtras = exercises.filter(
    (exercise) => !sessionExercises.some((item) => item.exerciseId === exercise.id)
  );

  return (
    <div className="stack">
      <div className="split">
        <div>
          <h2 className="section-title">Today&apos;s session</h2>
          <p className="muted">Log fast, stay in flow, keep the lift going.</p>
        </div>
        {activeSession ? (
          <button className="button secondary" onClick={handleEndSession}>
            Finish session
          </button>
        ) : null}
      </div>

      {error ? <div className="notice">{error}</div> : null}

      {loading ? (
        <div className="card">Loading workout workspace…</div>
      ) : activeSession ? (
        <div className="stack">
          <div className="card">
            <div className="split">
              <div>
                <div className="section-title">
                  {activeSession.name || activeSession.routineName || 'Workout'}
                </div>
                <div className="muted">
                  Started {formatDateTime(activeSession.startedAt)}
                </div>
              </div>
              <div className="tag">Active</div>
            </div>
            <div className="inline" style={{ marginTop: '0.8rem' }}>
              <label className="muted">Add exercise:</label>
              <select
                value=""
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value)) {
                    setExtraExerciseIds((prev) => [...prev, value]);
                  }
                }}
              >
                <option value="">Select</option>
                {availableExtras.map((exercise) => (
                  <option key={exercise.id} value={exercise.id}>
                    {exercise.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="session-grid">
            {sessionExercises.map((exercise) => (
              <ExerciseCard
                key={exercise.exerciseId}
                exercise={exercise}
                exerciseMeta={exerciseById.get(exercise.exerciseId)}
                onAddSet={handleAddSet}
                onDeleteSet={handleDeleteSet}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="section-title">Start a session</div>
          <div className="stack">
            <div>
              <label>Routine (optional)</label>
              <select
                value={startRoutineId}
                onChange={(event) => setStartRoutineId(event.target.value)}
              >
                <option value="">Quick session</option>
                {routines.map((routine) => (
                  <option key={routine.id} value={routine.id}>
                    {routine.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Session name</label>
              <input
                className="input"
                value={startName}
                onChange={(event) => setStartName(event.target.value)}
                placeholder="Upper body, Pull day, etc."
              />
            </div>
            <button className="button" onClick={handleStartSession}>
              Start now
            </button>
          </div>
        </div>
      )}

      <div className="card-grid two">
        <div className="card">
          <div className="section-title">Bodyweight</div>
          <div className="form-row">
            <input
              className="input"
              type="number"
              step="0.1"
              placeholder="Enter weight"
              value={weightInput}
              onChange={(event) => setWeightInput(event.target.value)}
            />
            <button className="button" onClick={handleAddWeight}>
              Log weight
            </button>
          </div>
          <div className="set-list">
            {weights.length ? (
              weights.map((entry) => (
                <div key={entry.id} className="set-row">
                  <div className="set-chip">{formatNumber(entry.weight)} kg</div>
                  <div className="muted">{formatDate(entry.measuredAt)}</div>
                </div>
              ))
            ) : (
              <div className="muted">No weight entries yet.</div>
            )}
          </div>
        </div>
        <div className="card">
          <div className="section-title">Recent sessions</div>
          {sessions.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Volume</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.id}>
                    <td>{session.routineName || session.name || 'Workout'}</td>
                    <td>{formatNumber(session.totalVolume)}</td>
                    <td>{formatDate(session.startedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="muted">No sessions logged yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function ExerciseCard({ exercise, exerciseMeta, onAddSet, onDeleteSet }) {
  const [reps, setReps] = useState('');
  const [weight, setWeight] = useState('');

  useEffect(() => {
    const lastSet = exerciseMeta?.lastSet;
    if (lastSet) {
      setReps(String(lastSet.reps ?? ''));
      setWeight(String(lastSet.weight ?? ''));
      return;
    }
    if (exercise.targetReps) {
      setReps(String(exercise.targetReps));
    }
    if (exercise.targetWeight) {
      setWeight(String(exercise.targetWeight));
    }
  }, [
    exercise.exerciseId,
    exercise.targetReps,
    exercise.targetWeight,
    exerciseMeta?.lastSet?.reps,
    exerciseMeta?.lastSet?.weight,
  ]);

  const handleAdd = () => {
    const repsValue = Number(reps);
    const weightValue = Number(weight);
    if (!Number.isFinite(repsValue) || !Number.isFinite(weightValue)) {
      return;
    }
    onAddSet(exercise.exerciseId, repsValue, weightValue);
  };

  return (
    <div className="exercise-card">
      <div className="exercise-header">
        <div>
          <div className="section-title" style={{ marginBottom: '0.2rem' }}>
            {[exercise.equipment, exercise.name].filter(Boolean).join(' ')}
          </div>
          <div className="inline">
            {exercise.targetSets ? <span className="badge">{exercise.targetSets} sets</span> : null}
            {exercise.targetReps ? <span className="badge">{exercise.targetReps} reps</span> : null}
            {exercise.targetWeight ? (
              <span className="badge">{exercise.targetWeight} kg</span>
            ) : null}
          </div>
        </div>
        {exerciseMeta?.lastSet ? (
          <div className="tag">
            Last: {exerciseMeta.lastSet.weight} kg × {exerciseMeta.lastSet.reps}
          </div>
        ) : null}
      </div>

      <div className="set-list">
        {(exercise.sets || []).length ? (
          exercise.sets.map((set) => (
            <div key={set.id} className="set-row">
              <div className="set-chip">Set {set.setIndex}</div>
              <div>
                {formatNumber(set.weight)} kg × {formatNumber(set.reps)} reps
              </div>
              <button
                className="button ghost"
                onClick={() => onDeleteSet(set.id)}
                style={{ padding: '0.3rem 0.6rem' }}
              >
                Delete
              </button>
            </div>
          ))
        ) : (
          <div className="muted">No sets yet. Add one below.</div>
        )}
      </div>

      <div className="quick-set">
        <input
          className="input"
          type="number"
          placeholder="Reps"
          value={reps}
          onChange={(event) => setReps(event.target.value)}
        />
        <input
          className="input"
          type="number"
          step="0.5"
          placeholder="Weight"
          value={weight}
          onChange={(event) => setWeight(event.target.value)}
        />
        <button className="button" onClick={handleAdd}>
          + Add
        </button>
      </div>
    </div>
  );
}

function RoutinesPage() {
  const [routines, setRoutines] = useState([]);
  const [exercises, setExercises] = useState([]);
  const [editing, setEditing] = useState(null);
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
      setEditing(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (routineId) => {
    setError(null);
    try {
      await apiFetch(`/api/routines/${routineId}`, { method: 'DELETE' });
      setRoutines((prev) => prev.filter((routine) => routine.id !== routineId));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="stack">
      <div>
        <h2 className="section-title">Routines</h2>
        <p className="muted">Build your templates for effortless sessions.</p>
      </div>
      {error ? <div className="notice">{error}</div> : null}

      <div className="card">
        <div className="section-title">Create routine</div>
        <RoutineEditor
          exercises={exercises}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      </div>

      {loading ? (
        <div className="card">Loading routines…</div>
      ) : routines.length ? (
        routines.map((routine) => (
          <div key={routine.id} className="card">
            <div className="split">
              <div>
                <div className="section-title">{routine.name}</div>
                <div className="muted">{routine.notes || 'No notes'}</div>
              </div>
              <div className="inline">
                <button className="button ghost" onClick={() => setEditing(routine)}>
                  Edit
                </button>
                <button className="button ghost" onClick={() => handleDelete(routine.id)}>
                  Delete
                </button>
              </div>
            </div>
            <div className="set-list">
              {routine.exercises.map((exercise) => (
                <div key={exercise.id} className="set-row">
                  <div className="set-chip">#{exercise.position + 1}</div>
                  <div>
                    {[exercise.equipment, exercise.name].filter(Boolean).join(' ')}
                    {exercise.targetSets ? ` · ${exercise.targetSets} sets` : ''}
                    {exercise.targetReps ? ` · ${exercise.targetReps} reps` : ''}
                    {exercise.targetWeight ? ` · ${exercise.targetWeight} kg` : ''}
                  </div>
                </div>
              ))}
            </div>
            {editing?.id === routine.id ? (
              <div style={{ marginTop: '1rem' }}>
                <RoutineEditor
                  routine={editing}
                  exercises={exercises}
                  onSave={handleSave}
                  onCancel={() => setEditing(null)}
                />
              </div>
            ) : null}
          </div>
        ))
      ) : (
        <div className="empty">No routines yet. Create your first template.</div>
      )}
    </div>
  );
}

function RoutineEditor({ routine, exercises, onSave, onCancel }) {
  const [name, setName] = useState(routine?.name || '');
  const [notes, setNotes] = useState(routine?.notes || '');
  const [formError, setFormError] = useState(null);
  const [items, setItems] = useState(
    routine?.exercises?.length
      ? routine.exercises.map((item) => ({
          exerciseId: item.exerciseId,
          equipment: item.equipment || '',
          targetSets: item.targetSets || '',
          targetReps: item.targetReps || '',
          targetWeight: item.targetWeight || '',
          notes: item.notes || '',
          position: item.position || 0,
        }))
      : []
  );

  const addItem = () => {
    setItems((prev) => [
      ...prev,
      {
        exerciseId: '',
        equipment: '',
        targetSets: '',
        targetReps: '',
        targetWeight: '',
        notes: '',
        position: prev.length,
      },
    ]);
    setFormError(null);
  };

  const updateItem = (index, key, value) => {
    setItems((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, [key]: value } : item))
    );
    setFormError(null);
  };

  const removeItem = (index) => {
    setItems((prev) => prev.filter((_, idx) => idx !== index));
    setFormError(null);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const missingEquipment = items.some((item) => item.exerciseId && !item.equipment);
    if (missingEquipment) {
      setFormError('Select equipment for each exercise in the routine.');
      return;
    }
    setFormError(null);
    const payload = {
      id: routine?.id,
      name,
      notes,
      exercises: items
        .filter((item) => item.exerciseId)
        .map((item, index) => ({
          exerciseId: Number(item.exerciseId),
          equipment: item.equipment || null,
          targetSets: item.targetSets ? Number(item.targetSets) : null,
          targetReps: item.targetReps ? Number(item.targetReps) : null,
          targetWeight: item.targetWeight ? Number(item.targetWeight) : null,
          notes: item.notes || null,
          position: index,
        })),
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
          <div key={`${item.exerciseId}-${index}`} className="card" style={{ boxShadow: 'none' }}>
            <div className="form-row">
              <div>
                <label>Exercise</label>
                <select
                  value={item.exerciseId}
                  onChange={(event) => updateItem(index, 'exerciseId', event.target.value)}
                >
                  <option value="">Select exercise</option>
                  {exercises.map((exercise) => (
                    <option key={exercise.id} value={exercise.id}>
                      {exercise.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label>Equipment</label>
                <select
                  value={item.equipment}
                  onChange={(event) => updateItem(index, 'equipment', event.target.value)}
                >
                  <option value="">Select equipment</option>
                  {EQUIPMENT_TYPES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label>Sets</label>
                <input
                  className="input"
                  type="number"
                  value={item.targetSets}
                  onChange={(event) => updateItem(index, 'targetSets', event.target.value)}
                />
              </div>
              <div>
                <label>Reps</label>
                <input
                  className="input"
                  type="number"
                  value={item.targetReps}
                  onChange={(event) => updateItem(index, 'targetReps', event.target.value)}
                />
              </div>
              <div>
                <label>Weight</label>
                <input
                  className="input"
                  type="number"
                  value={item.targetWeight}
                  onChange={(event) => updateItem(index, 'targetWeight', event.target.value)}
                />
              </div>
            </div>
            <div className="inline" style={{ marginTop: '0.6rem' }}>
              <input
                className="input"
                value={item.notes}
                onChange={(event) => updateItem(index, 'notes', event.target.value)}
                placeholder="Notes or cues"
              />
              <button type="button" className="button ghost" onClick={() => removeItem(index)}>
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="inline">
        <button type="button" className="button ghost" onClick={addItem}>
          + Add exercise
        </button>
        <button type="submit" className="button">
          {routine ? 'Update routine' : 'Save routine'}
        </button>
        {routine ? (
          <button type="button" className="button ghost" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

function ExercisesPage() {
  const [exercises, setExercises] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', muscleGroup: '', notes: '' });
  const [editingId, setEditingId] = useState(null);
  const [editingForm, setEditingForm] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);
  const [highlightId, setHighlightId] = useState(null);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [impactSummary, setImpactSummary] = useState(null);
  const [impactLoading, setImpactLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch('/api/exercises');
      setExercises(data.exercises || []);
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

  const createExercise = async (payload) => {
    setError(null);
    if (!payload.muscleGroup) {
      setError('Muscle group is required.');
      return;
    }
    try {
      const data = await apiFetch('/api/exercises', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setExercises((prev) => [...prev, data.exercise]);
      setForm({ name: '', muscleGroup: '', notes: '' });
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
      await apiFetch(`/api/exercises/${exerciseId}`, {
        method: 'PUT',
        body: JSON.stringify(editingForm),
      });
      setExercises((prev) =>
        prev.map((exercise) =>
          exercise.id === exerciseId ? { ...exercise, ...editingForm } : exercise
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


  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredExercises = exercises.filter((exercise) => {
    if (!normalizedQuery) return true;
    const searchable = [exercise.name, exercise.muscleGroup]
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
  const canSaveExercise = form.name.trim() && form.muscleGroup && !exactFormMatch;

  return (
    <div className="stack">
      <div>
        <h2 className="section-title">Exercises</h2>
        <p className="muted">Curate your library for fast logging.</p>
      </div>
      {error ? <div className="notice">{error}</div> : null}

      <div className="card">
        <div className="section-title">Find or add exercise</div>
        <div className="stack">
          <div>
            <label>Filter exercises</label>
            <input
              className="input"
              placeholder="Search by name or muscle group"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
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
          ) : (
            <div className="muted">Start typing to add or find an exercise.</div>
          )}
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
                <label>Muscle group</label>
                <select
                  value={form.muscleGroup}
                  onChange={(event) => setForm({ ...form, muscleGroup: event.target.value })}
                  required
                >
                  <option value="">Select group</option>
                  {MUSCLE_GROUPS.map((group) => (
                    <option key={group} value={group}>
                      {group}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label>Notes</label>
              <textarea
                rows="2"
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
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
                              {exercise.muscleGroup ? (
                                <span
                                  className={`badge badge-group badge-${exercise.muscleGroup
                                    .toLowerCase()
                                    .replace(/\s+/g, '-')}`}
                                >
                                  {exercise.muscleGroup}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="inline">
                            <button
                              className="button ghost"
                              type="button"
                              onClick={() => {
                                setEditingId(exercise.id);
                                setEditingForm({
                                  name: exercise.name,
                                  muscleGroup: exercise.muscleGroup || '',
                                  notes: exercise.notes || '',
                                });
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

      {loading ? (
        <div className="card">Loading exercises…</div>
      ) : filteredExercises.length ? (
        filteredExercises.map((exercise) => (
          <div key={exercise.id} className="card">
            <div className="split">
              <div>
                <div className="section-title">{exercise.name}</div>
                <div className="inline">
                  {exercise.muscleGroup ? (
                    <span
                      className={`badge badge-group badge-${exercise.muscleGroup
                        .toLowerCase()
                        .replace(/\s+/g, '-')}`}
                    >
                      {exercise.muscleGroup}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="inline">
                <button
                  className="button ghost"
                  onClick={() => {
                    setEditingId(exercise.id);
                    setEditingForm({
                      name: exercise.name,
                      muscleGroup: exercise.muscleGroup || '',
                      notes: exercise.notes || '',
                    });
                  }}
                >
                  Edit
                </button>
              </div>
            </div>
            {exercise.notes ? <div className="muted">Notes: {exercise.notes}</div> : null}
            {exercise.lastSet ? (
              <div className="tag" style={{ marginTop: '0.6rem' }}>
                Last: {exercise.lastSet.weight} kg × {exercise.lastSet.reps}
              </div>
            ) : null}
            {editingId === exercise.id ? (
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
                    <label>Muscle group</label>
                    <select
                      value={editingForm.muscleGroup}
                      onChange={(event) =>
                        setEditingForm({ ...editingForm, muscleGroup: event.target.value })
                      }
                      required
                    >
                      <option value="">Select group</option>
                      {MUSCLE_GROUPS.map((group) => (
                        <option key={group} value={group}>
                          {group}
                        </option>
                      ))}
                    </select>
                  </div>
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
                <div className="stack">
                  <div className="section-title" style={{ fontSize: '1rem' }}>
                    Merge exercise
                  </div>
                  <div className="muted">
                    Merging moves routines and session history into the target exercise, then
                    archives this one. Use it to clean up duplicates.
                  </div>
                  {impactLoading ? (
                    <div className="muted">Loading impact…</div>
                  ) : impactSummary ? (
                    <div className="tag">Impact: {formatExerciseImpact(impactSummary)}</div>
                  ) : null}
                  {exercises.filter(
                    (item) => item.id !== exercise.id && !item.archivedAt && !item.mergedIntoId
                  ).length ? (
                    <div className="inline">
                      <select
                        value={mergeTargetId}
                        onChange={(event) => setMergeTargetId(event.target.value)}
                      >
                        <option value="">Select target exercise</option>
                        {exercises
                          .filter(
                            (item) =>
                              item.id !== exercise.id &&
                              !item.archivedAt &&
                              !item.mergedIntoId
                          )
                          .map((item) => (
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
                <div className="stack">
                  <div className="section-title" style={{ fontSize: '1rem' }}>
                    Archive exercise
                  </div>
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
                <div className="inline">
                  <button className="button" onClick={() => handleSave(exercise.id)}>
                    Save
                  </button>
                  <button className="button ghost" onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ))
      ) : (
        <div className="empty">
          {exercises.length
            ? `No exercises match "${searchQuery.trim()}".`
            : 'No exercises yet. Add your first movement.'}
        </div>
      )}
    </div>
  );
}

function StatsPage() {
  const [stats, setStats] = useState(null);
  const [weights, setWeights] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [statsData, weightData] = await Promise.all([
          apiFetch('/api/stats/overview'),
          apiFetch('/api/weights?limit=8'),
        ]);
        if (!active) return;
        setStats(statsData);
        setWeights(weightData.weights || []);
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

  if (loading) {
    return <div className="card">Loading stats…</div>;
  }

  if (error) {
    return <div className="notice">{error}</div>;
  }

  return (
    <div className="stack">
      <div>
        <h2 className="section-title">Stats</h2>
        <p className="muted">Volume, streaks, and best lifts at a glance.</p>
      </div>

      <div className="card-grid three">
        <div className="card">
          <div className="muted">Total sessions</div>
          <div className="section-title">{stats?.summary?.totalSessions ?? 0}</div>
        </div>
        <div className="card">
          <div className="muted">Volume · 7 days</div>
          <div className="section-title">{formatNumber(stats?.summary?.volumeWeek)}</div>
        </div>
        <div className="card">
          <div className="muted">Volume · 30 days</div>
          <div className="section-title">{formatNumber(stats?.summary?.volumeMonth)}</div>
        </div>
      </div>

      <div className="card-grid two">
        <div className="card">
          <div className="section-title">Top lifts</div>
          {stats?.topExercises?.length ? (
            <div className="set-list">
              {stats.topExercises.map((exercise) => (
                <div key={exercise.exerciseId} className="set-row">
                  <div className="set-chip">{exercise.name}</div>
                  <div>
                    {formatNumber(exercise.maxWeight)} kg × {formatNumber(exercise.maxReps)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted">No PRs yet.</div>
          )}
        </div>
        <div className="card">
          <div className="section-title">Weekly volume</div>
          {stats?.weeklyVolume?.length ? (
            <div className="stack">
              {stats.weeklyVolume.map((week) => (
                <div key={week.week} className="set-row">
                  <div className="set-chip">{week.week}</div>
                  <div>{formatNumber(week.volume)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted">Log sessions to see trends.</div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="section-title">Recent bodyweight</div>
        <div className="set-list">
          {weights.length ? (
            weights.map((entry) => (
              <div key={entry.id} className="set-row">
                <div className="set-chip">{formatNumber(entry.weight)} kg</div>
                <div className="muted">{formatDate(entry.measuredAt)}</div>
              </div>
            ))
          ) : (
            <div className="muted">Log weight in the workout view.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsPage({ user, onLogout }) {
  const [error, setError] = useState(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

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
    setImporting(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const data = await apiFetch('/api/import', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setImportResult(data.importedCount || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="stack">
      <div>
        <h2 className="section-title">Settings</h2>
        <p className="muted">Account controls, backups, and environment.</p>
      </div>
      {error ? <div className="notice">{error}</div> : null}

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
            <input type="file" accept="application/json" onChange={handleImport} />
            {importing ? <div className="muted">Importing…</div> : null}
            {importResult ? (
              <div className="tag">
                Imported {importResult.exercises} exercises, {importResult.routines} routines,
                {importResult.sessions} sessions.
              </div>
            ) : null}
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
    </div>
  );
}

export default App;
