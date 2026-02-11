export function getCalendarDayDiff(then, now) {
  const thenStart = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const nowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.floor((nowStart.getTime() - thenStart.getTime()) / (24 * 60 * 60 * 1000)));
}

export function formatElapsedSince(value, now = new Date()) {
  if (!value) return '—';
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return '—';
  const diffMs = now.getTime() - then.getTime();
  if (diffMs <= 0) return 'Just now';

  const calendarDayDiff = getCalendarDayDiff(then, now);
  if (!calendarDayDiff) {
    const totalMinutes = Math.floor(diffMs / (60 * 1000));
    if (totalMinutes < 60) return `${totalMinutes}m`;

    const totalHours = Math.floor(totalMinutes / 60);
    return `${totalHours}h`;
  }

  if (calendarDayDiff === 1) return 'Yesterday';
  if (calendarDayDiff < 7) return `${calendarDayDiff}d`;

  const weeks = Math.floor(calendarDayDiff / 7);
  const days = calendarDayDiff % 7;
  return days ? `${weeks}w ${days}d` : `${weeks}w`;
}

export function formatRoutineLastUsedDaysAgo(value, now = new Date()) {
  if (!value) return 'Never trained';
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return 'Never trained';
  const days = getCalendarDayDiff(then, now);
  if (!days) return 'Trained today';
  if (days === 1) return 'Trained yesterday';
  return `Trained ${days} day${days === 1 ? '' : 's'} ago`;
}

export function formatDaysAgoLabel(value, now = new Date()) {
  if (!value) return '—';
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return '—';
  const days = getCalendarDayDiff(then, now);
  if (!days) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
