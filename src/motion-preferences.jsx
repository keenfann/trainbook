import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export const MOTION_PREFERENCE_STORAGE_KEY = 'trainbook.motionPreference';
const VALID_MOTION_PREFERENCES = new Set(['system', 'reduced', 'full']);

const MotionPreferenceContext = createContext(null);

function isTestMode() {
  if (typeof import.meta !== 'undefined' && import.meta?.env?.MODE === 'test') {
    return true;
  }
  if (typeof process !== 'undefined' && process?.env?.NODE_ENV === 'test') {
    return true;
  }
  return false;
}

function readStoredMotionPreference() {
  if (typeof window === 'undefined') return 'system';
  try {
    const value = window.localStorage.getItem(MOTION_PREFERENCE_STORAGE_KEY);
    if (VALID_MOTION_PREFERENCES.has(value)) {
      return value;
    }
  } catch {
    return 'system';
  }
  return 'system';
}

function readInitialSystemReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return isTestMode();
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function MotionPreferenceProvider({ children }) {
  const [preference, setPreferenceState] = useState(readStoredMotionPreference);
  const [systemReducedMotion, setSystemReducedMotion] = useState(readInitialSystemReducedMotion);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMediaChange = (event) => {
      setSystemReducedMotion(Boolean(event.matches));
    };

    setSystemReducedMotion(mediaQuery.matches);
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', onMediaChange);
      return () => mediaQuery.removeEventListener('change', onMediaChange);
    }
    mediaQuery.addListener(onMediaChange);
    return () => mediaQuery.removeListener(onMediaChange);
  }, []);

  const setPreference = useCallback((nextValue) => {
    const normalized = VALID_MOTION_PREFERENCES.has(nextValue) ? nextValue : 'system';
    setPreferenceState(normalized);
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(MOTION_PREFERENCE_STORAGE_KEY, normalized);
    } catch {
      // Ignore localStorage write failures.
    }
  }, []);

  const resolvedReducedMotion = preference === 'system'
    ? systemReducedMotion
    : preference === 'reduced';
  const motionMode = resolvedReducedMotion ? 'reduced' : 'full';

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-motion-mode', motionMode);
  }, [motionMode]);

  const value = useMemo(() => ({
    preference,
    setPreference,
    resolvedReducedMotion,
    motionMode,
  }), [motionMode, preference, resolvedReducedMotion, setPreference]);

  return (
    <MotionPreferenceContext.Provider value={value}>
      {children}
    </MotionPreferenceContext.Provider>
  );
}

export function useMotionPreferences() {
  const context = useContext(MotionPreferenceContext);
  if (!context) {
    throw new Error('useMotionPreferences must be used within MotionPreferenceProvider.');
  }
  return context;
}
