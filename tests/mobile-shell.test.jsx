// @vitest-environment jsdom
import React from 'react';
import { act, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../src/api.js';
import { renderAppAt } from './helpers/app-flows-helpers.jsx';

vi.mock('../src/api.js', () => ({ apiFetch: vi.fn() }));

beforeEach(() => {
  apiFetch.mockImplementation(async (path) => {
    if (path === '/api/auth/me') return { user: { id: 1, username: 'coach' } };
    if (path === '/api/routines') return { routines: [] };
    if (path === '/api/exercises' || path.startsWith('/api/exercises?')) return { exercises: [] };
    if (path === '/api/sessions/active') return { session: null };
    if (path === '/api/sessions?limit=15') return { sessions: [] };
    if (path.startsWith('/api/weights?')) return { weights: [] };
    if (path === '/api/bands') return { bands: [] };
    if (path.startsWith('/api/stats/')) return { summary: {}, points: [], rows: [] };
    throw new Error(`Unhandled path: ${path}`);
  });
});

function sync(detail) {
  act(() => window.dispatchEvent(new CustomEvent('trainbook:sync-state', { detail })));
}

describe('Mobile app shell', () => {
  it('navigates through every main destination and keeps the existing routes', async () => {
    const user = userEvent.setup();
    renderAppAt('/workout');
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    const scroll = vi.spyOn(window, 'scrollTo');
    for (const [name, heading, route] of [
      ['Routines', 'Routines', '/routines'],
      ['Exercises', 'Exercises', '/exercises'],
      ['Progress', 'Progress', '/stats'],
      ['Workout', "Today's workout", '/workout'],
    ]) {
      await user.click(within(nav).getByRole('link', { name }));
      await waitFor(() => expect(screen.getByRole('heading', { name: heading })).toBeVisible());
      expect(window.location.pathname).toBe(route);
      expect(scroll).toHaveBeenLastCalledWith(0, 0);
      expect(within(nav).getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
    }
    scroll.mockRestore();
  });

  it('distinguishes offline, queued, syncing, and failed saves in the header', async () => {
    renderAppAt('/workout');
    await screen.findByRole('heading', { name: "Today's workout" });
    sync({ online: false, queueSize: 2 });
    expect(screen.getByText('Offline')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('changes are queued on this device');
    sync({ online: true, queueSize: 2, syncing: false });
    expect(screen.getByText('Queued')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('2 changes queued');
    sync({ syncing: true });
    expect(screen.getByText('Syncing')).toBeVisible();
    sync({ syncing: false, queueSize: 2, lastError: 'Sync needs a connection' });
    expect(screen.getByText('Sync error')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Sync needs a connection 2 changes still queued.');
    sync({ queueSize: 0, lastError: null });
    expect(screen.getByText('Online')).toBeVisible();
  });

  it('allows the account menu to close with Escape and restores the trigger focus', async () => {
    const user = userEvent.setup();
    renderAppAt('/workout');
    const trigger = await screen.findByRole('button', { name: 'coach' });
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.tab();
    await user.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });
});
