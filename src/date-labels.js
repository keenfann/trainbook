export function getCalendarDayDiff(then, now) {
  const thenStart = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const nowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.floor((nowStart.getTime() - thenStart.getTime()) / (24 * 60 * 60 * 1000)));
}

function formatCalendarDayLabel(days, { todayLabel, yesterdayLabel, formatDaysAgo }) {
  if (!days) return todayLabel;
  if (days === 1) return yesterdayLabel;
  return formatDaysAgo(days);
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

  if (calendarDayDiff < 7) {
    return formatCalendarDayLabel(calendarDayDiff, {
      todayLabel: 'Today',
      yesterdayLabel: 'Yesterday',
      formatDaysAgo: (days) => `${days}d`,
    });
  }

  const weeks = Math.floor(calendarDayDiff / 7);
  const days = calendarDayDiff % 7;
  return days ? `${weeks}w ${days}d` : `${weeks}w`;
}

export function formatRoutineLastUsedDaysAgo(value, now = new Date()) {
  if (!value) return 'Never trained';
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return 'Never trained';
  const days = getCalendarDayDiff(then, now);
  return formatCalendarDayLabel(days, {
    todayLabel: 'Trained today',
    yesterdayLabel: 'Trained Yesterday',
    formatDaysAgo: (dayCount) => `Trained ${dayCount} days ago`,
  });
}

export function formatDaysAgoLabel(value, now = new Date()) {
  if (!value) return '—';
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return '—';
  const days = getCalendarDayDiff(then, now);
  return formatCalendarDayLabel(days, {
    todayLabel: 'Today',
    yesterdayLabel: 'Yesterday',
    formatDaysAgo: (dayCount) => `${dayCount} days ago`,
  });
}
