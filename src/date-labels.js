export function getCalendarDayDiff(then, now) {
  const thenStart = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const nowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.floor((nowStart.getTime() - thenStart.getTime()) / (24 * 60 * 60 * 1000)));
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
