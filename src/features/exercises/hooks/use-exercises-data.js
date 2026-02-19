import { useEffect, useState } from 'react';
import { apiFetch } from '../../../api.js';

export function useExercisesData() {
  const [exercises, setExercises] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filterMode, setFilterMode] = useState('active');

  const refresh = async (mode = filterMode) => {
    setLoading(true);
    setError(null);
    try {
      const query = mode === 'active' ? '/api/exercises' : `/api/exercises?mode=${mode}`;
      const data = await apiFetch(query);
      setExercises(data.exercises || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh(filterMode);
  }, [filterMode]);

  return {
    exercises,
    setExercises,
    error,
    setError,
    loading,
    setLoading,
    filterMode,
    setFilterMode,
    refresh,
  };
}
