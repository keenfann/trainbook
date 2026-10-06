import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../api.js';
import { normalizeRoutineForUi } from '../workout-utils.js';

export function useWorkoutInitialData() {
  const [routines, setRoutines] = useState([]);
  const [activeSession, setActiveSessionState] = useState(null);
  const activeSessionRef = useRef(null);
  // Async finish handlers need the latest sets/progress before React renders again.
  const setActiveSession = useCallback((update) => {
    const next = typeof update === 'function' ? update(activeSessionRef.current) : update;
    activeSessionRef.current = next;
    setActiveSessionState(next);
  }, []);
  const [sessions, setSessions] = useState([]);
  const [weights, setWeights] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
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
      setSessions(sessionList.sessions || []);
      setWeights(weightData.weights || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [setActiveSession]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    routines,
    setRoutines,
    activeSession,
    activeSessionRef,
    setActiveSession,
    sessions,
    setSessions,
    weights,
    setWeights,
    loading,
    setLoading,
    error,
    setError,
    refresh,
  };
}
