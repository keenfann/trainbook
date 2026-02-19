// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SettingsPage from '../src/pages/SettingsPage.jsx';
import { apiFetch } from '../src/api.js';
import { MotionPreferenceProvider } from '../src/motion-preferences.jsx';

vi.mock('../src/api.js', () => ({
  apiFetch: vi.fn(),
}));

function renderSettingsPage({ onLogout } = {}) {
  const logout = onLogout || vi.fn().mockResolvedValue(undefined);
  const view = render(
    <MotionPreferenceProvider>
      <SettingsPage user={{ username: 'coach' }} onLogout={logout} />
    </MotionPreferenceProvider>
  );

  return {
    ...view,
    onLogout: logout,
  };
}

function getImportInput(container) {
  return container.querySelector('input[type="file"]');
}

function createMockImportFile(name, content) {
  return {
    name,
    text: vi.fn().mockResolvedValue(content),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SettingsPage', () => {
  it('shows logout errors and password update errors', async () => {
    const user = userEvent.setup();
    const onLogout = vi.fn().mockRejectedValue(new Error('Logout failed'));
    apiFetch.mockRejectedValue(new Error('Password update failed'));

    renderSettingsPage({ onLogout });

    await user.type(screen.getByPlaceholderText('Current password'), 'old-pass');
    await user.type(screen.getByPlaceholderText('New password'), 'new-pass');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(await screen.findByText('Password update failed')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Log out' }));

    expect(await screen.findByText('Logout failed')).toBeInTheDocument();
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('updates password successfully and clears inputs', async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue({ ok: true });

    renderSettingsPage();

    const currentInput = screen.getByPlaceholderText('Current password');
    const nextInput = screen.getByPlaceholderText('New password');
    await user.type(currentInput, 'old-pass');
    await user.type(nextInput, 'new-pass');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/api/auth/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: 'old-pass', nextPassword: 'new-pass' }),
      });
    });

    expect(currentInput).toHaveValue('');
    expect(nextInput).toHaveValue('');
  });

  it('exports data to a downloadable json file', async () => {
    const user = userEvent.setup();
    const createObjectUrl = vi.fn(() => 'blob:test-export');
    const revokeObjectUrl = vi.fn();
    URL.createObjectURL = createObjectUrl;
    URL.revokeObjectURL = revokeObjectUrl;

    const nativeCreateElement = document.createElement.bind(document);
    const anchorClick = vi.fn();
    vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
      if (tagName.toLowerCase() === 'a') {
        return {
          click: anchorClick,
          set href(value) {
            this._href = value;
          },
          set download(value) {
            this._download = value;
          },
        };
      }
      return nativeCreateElement(tagName, options);
    });

    apiFetch.mockResolvedValue({ routines: [], sessions: [] });

    renderSettingsPage();

    await user.click(screen.getByRole('button', { name: 'Export JSON' }));

    expect(apiFetch).toHaveBeenCalledWith('/api/export');
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:test-export');
  });

  it('validates imports, supports clear validation, and confirms valid import', async () => {
    const user = userEvent.setup();

    apiFetch.mockImplementation(async (path) => {
      if (path === '/api/import/validate') {
        return {
          valid: false,
          errors: ['Invalid import payload.'],
          warnings: ['Some values were ignored.'],
          summary: {
            toCreate: { exercises: 1, routines: 2, sessions: 3, weights: 4 },
            skipped: { exercises: 0, routines: 0, weights: 0 },
            toReuse: { exercises: 5, routines: 6, sessions: 7, weights: 8 },
          },
        };
      }
      throw new Error(`Unexpected path ${path}`);
    });

    const { container } = renderSettingsPage();
    let fileInput = getImportInput(container);
    expect(fileInput).toBeTruthy();

    fireEvent.change(fileInput, {
      target: {
        files: [createMockImportFile('invalid.json', JSON.stringify({ bad: true }))],
      },
    });

    expect(await screen.findByText('Invalid import payload.')).toBeInTheDocument();
    expect(screen.getByText('Validation summary for invalid.json')).toBeInTheDocument();
    expect(screen.getByText('Warnings: Some values were ignored.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear validation' }));
    await waitFor(() => {
      expect(screen.queryByText('Validation summary for invalid.json')).not.toBeInTheDocument();
    });

    apiFetch.mockImplementation(async (path) => {
      if (path === '/api/import/validate') {
        return {
          valid: true,
          summary: {
            toCreate: { exercises: 1, routines: 1, sessions: 1, weights: 1 },
            skipped: { exercises: 0, routines: 0, weights: 0 },
            toReuse: { exercises: 0, routines: 0, sessions: 0, weights: 0 },
          },
          warnings: [],
        };
      }
      if (path === '/api/import') {
        return {
          importedCount: {
            exercises: 1,
            routines: 1,
            sessions: 1,
            weights: 1,
          },
        };
      }
      throw new Error(`Unexpected path ${path}`);
    });

    fileInput = getImportInput(container);
    fireEvent.change(fileInput, {
      target: {
        files: [createMockImportFile('valid.json', JSON.stringify({ good: true }))],
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Confirm import' }));

    expect(await screen.findByText(/Imported 1 exercises, 1 routines, 1 workouts, 1 bodyweight entries\./))
      .toBeInTheDocument();
  });
});
