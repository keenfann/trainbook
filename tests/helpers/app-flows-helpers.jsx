import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { expect } from 'vitest';
import App from '../../src/App.jsx';
import { MotionPreferenceProvider } from '../../src/motion-preferences.jsx';

export function renderAppAt(pathname) {
  window.history.pushState({}, '', pathname);
  return render(
    <MotionPreferenceProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </MotionPreferenceProvider>
  );
}

export async function beginWorkoutThroughWarmup(user) {
  await user.click(await screen.findByRole('button', { name: 'Begin workout' }));
  await waitFor(() => {
    expect(
      screen.queryByText('Complete this warmup step before your first exercise.')
      || screen.queryByRole('button', { name: 'Finish warmup' })
      || screen.queryByRole('button', { name: 'Finish exercise' })
      || screen.queryByRole('button', { name: 'Finish workout' })
      || screen.queryByText(/Cannot begin workout/i)
    ).toBeTruthy();
  });
  if (screen.queryByText('Complete this warmup step before your first exercise.')) {
    await user.click(await screen.findByRole('button', { name: 'Finish warmup' }));
    await waitFor(() => {
      expect(screen.queryByText('Complete this warmup step before your first exercise.')).not.toBeInTheDocument();
    });
    return;
  }
  await waitFor(() => {
    expect(
      screen.queryByRole('button', { name: 'Finish warmup' })
      || screen.queryByRole('button', { name: 'Finish exercise' })
      || screen.queryByRole('button', { name: 'Finish workout' })
      || screen.queryByText(/Cannot begin workout/i)
    ).toBeTruthy();
  });
  const finishWarmupButton = screen.queryByRole('button', { name: 'Finish warmup' });
  if (finishWarmupButton) {
    await user.click(finishWarmupButton);
  }
}

export { screen, waitFor };
