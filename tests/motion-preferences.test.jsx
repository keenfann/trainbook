// @vitest-environment jsdom
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MotionPreferenceProvider,
  MOTION_PREFERENCE_STORAGE_KEY,
  useMotionPreferences,
} from '../src/motion-preferences.jsx';

function Probe() {
  const { preference, setPreference, resolvedReducedMotion, motionMode } = useMotionPreferences();
  return (
    <div>
      <div data-testid="preference">{preference}</div>
      <div data-testid="reduced">{String(resolvedReducedMotion)}</div>
      <div data-testid="mode">{motionMode}</div>
      <button type="button" onClick={() => setPreference('reduced')}>
        Set reduced
      </button>
      <button type="button" onClick={() => setPreference('full')}>
        Set full
      </button>
      <button type="button" onClick={() => setPreference('invalid-value')}>
        Set invalid
      </button>
    </div>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('motion preferences', () => {
  it('throws when hook is used outside the provider', () => {
    expect(() => render(<Probe />)).toThrow(
      'useMotionPreferences must be used within MotionPreferenceProvider.'
    );
  });

  it('initializes from storage, updates preference, and writes motion mode to document', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(MOTION_PREFERENCE_STORAGE_KEY, 'full');

    render(
      <MotionPreferenceProvider>
        <Probe />
      </MotionPreferenceProvider>
    );

    expect(screen.getByTestId('preference')).toHaveTextContent('full');
    expect(screen.getByTestId('reduced')).toHaveTextContent('false');
    expect(screen.getByTestId('mode')).toHaveTextContent('full');
    expect(document.documentElement.getAttribute('data-motion-mode')).toBe('full');

    await user.click(screen.getByRole('button', { name: 'Set reduced' }));

    expect(screen.getByTestId('preference')).toHaveTextContent('reduced');
    expect(screen.getByTestId('reduced')).toHaveTextContent('true');
    expect(screen.getByTestId('mode')).toHaveTextContent('reduced');
    expect(window.localStorage.getItem(MOTION_PREFERENCE_STORAGE_KEY)).toBe('reduced');
    expect(document.documentElement.getAttribute('data-motion-mode')).toBe('reduced');
  });

  it('falls back to system preference when localStorage fails or invalid values are provided', async () => {
    const user = userEvent.setup();
    const originalLocalStorage = window.localStorage;
    const getItemMock = vi.fn(() => {
      throw new Error('storage read blocked');
    });
    const setItemMock = vi.fn(() => {
      throw new Error('storage write blocked');
    });
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: getItemMock,
        setItem: setItemMock,
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
    });

    render(
      <MotionPreferenceProvider>
        <Probe />
      </MotionPreferenceProvider>
    );

    expect(screen.getByTestId('preference')).toHaveTextContent('system');

    await user.click(screen.getByRole('button', { name: 'Set invalid' }));

    expect(screen.getByTestId('preference')).toHaveTextContent('system');
    expect(getItemMock).toHaveBeenCalled();
    expect(setItemMock).toHaveBeenCalled();

    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: originalLocalStorage,
    });
  });

  it('reacts to matchMedia changes and supports addListener fallback', async () => {
    let mediaChangeHandler;
    const addListener = vi.fn((handler) => {
      mediaChangeHandler = handler;
    });
    const removeListener = vi.fn();

    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn(() => ({
      matches: false,
      addListener,
      removeListener,
    }));

    const { unmount } = render(
      <MotionPreferenceProvider>
        <Probe />
      </MotionPreferenceProvider>
    );

    expect(screen.getByTestId('mode')).toHaveTextContent('full');

    act(() => {
      mediaChangeHandler?.({ matches: true });
    });

    await waitFor(() => {
      expect(screen.getByTestId('reduced')).toHaveTextContent('true');
      expect(screen.getByTestId('mode')).toHaveTextContent('reduced');
    });

    unmount();
    expect(removeListener).toHaveBeenCalledTimes(1);

    window.matchMedia = originalMatchMedia;
  });
});
