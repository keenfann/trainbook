import { describe, expect, it } from 'vitest';

import { formatDaysAgoLabel, formatRoutineLastUsedDaysAgo } from '../src/date-labels.js';

describe('date labels', () => {
  it('uses calendar-day boundaries for recent workouts', () => {
    const now = new Date(2026, 1, 11, 20, 39, 0);
    const trainedAt = new Date(2026, 1, 10, 20, 58, 0).toISOString();

    expect(formatDaysAgoLabel(trainedAt, now)).toBe('Yesterday');
  });

  it('uses calendar-day boundaries for routine last used labels', () => {
    const now = new Date(2026, 1, 11, 20, 39, 0);
    const trainedAt = new Date(2026, 1, 10, 20, 58, 0).toISOString();

    expect(formatRoutineLastUsedDaysAgo(trainedAt, now)).toBe('Trained yesterday');
  });
});
