import { describe, expect, it } from 'vitest';

import {
  formatDaysAgoLabel,
  formatElapsedSince,
  formatRoutineLastUsedDaysAgo,
} from '../src/date-labels.js';

describe('date labels', () => {
  it('uses calendar-day boundaries for recent workouts', () => {
    const now = new Date(2026, 1, 11, 20, 39, 0);
    const trainedAt = new Date(2026, 1, 10, 20, 58, 0).toISOString();

    expect(formatDaysAgoLabel(trainedAt, now)).toBe('Yesterday');
  });

  it('uses calendar-day boundaries for routine last used labels', () => {
    const now = new Date(2026, 1, 11, 20, 39, 0);
    const trainedAt = new Date(2026, 1, 10, 20, 58, 0).toISOString();

    expect(formatRoutineLastUsedDaysAgo(trainedAt, now)).toBe('Trained Yesterday');
  });

  it('uses calendar-day boundaries for elapsed labels', () => {
    const now = new Date(2026, 1, 11, 20, 39, 0);
    const trainedAt = new Date(2026, 1, 10, 20, 58, 0).toISOString();

    expect(formatElapsedSince(trainedAt, now)).toBe('Yesterday');
  });


  it('shows plural day labels after yesterday', () => {
    const now = new Date(2026, 1, 11, 20, 39, 0);
    const trainedAt = new Date(2026, 1, 9, 20, 58, 0).toISOString();

    expect(formatDaysAgoLabel(trainedAt, now)).toBe('2 days ago');
    expect(formatRoutineLastUsedDaysAgo(trainedAt, now)).toBe('Trained 2 days ago');
    expect(formatElapsedSince(trainedAt, now)).toBe('2d');
  });

  it('keeps same-day elapsed labels in minutes and hours', () => {
    const now = new Date(2026, 1, 11, 20, 39, 0);

    expect(formatElapsedSince(new Date(2026, 1, 11, 20, 35, 0).toISOString(), now)).toBe('4m');
    expect(formatElapsedSince(new Date(2026, 1, 11, 8, 35, 0).toISOString(), now)).toBe('12h');
  });
});
