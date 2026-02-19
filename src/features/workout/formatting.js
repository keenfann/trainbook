import { LOCALE } from './constants.js';

const RELEASE_TIMESTAMP_WITHOUT_TZ_REGEX =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/;
const RELEASE_TIMESTAMP_HAS_TZ_REGEX = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;

export function resolveExerciseImageUrl(relativePath) {
  const normalized = String(relativePath || '').trim();
  if (!normalized) return '';
  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (normalized.startsWith('/')) return normalized;
  return `https://raw.githubusercontent.com/keenfann/free-exercise-db/main/exercises/${normalized}`;
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(LOCALE, {
    month: 'short',
    day: 'numeric',
  });
}

export function parseReleaseTimestamp(value) {
  const rawValue = String(value || '').trim();
  if (!rawValue) return null;

  const hasTimezone = RELEASE_TIMESTAMP_HAS_TZ_REGEX.test(rawValue);
  if (!hasTimezone && RELEASE_TIMESTAMP_WITHOUT_TZ_REGEX.test(rawValue)) {
    const utcLikeValue = `${rawValue.replace(' ', 'T')}Z`;
    const utcLikeDate = new Date(utcLikeValue);
    if (!Number.isNaN(utcLikeDate.getTime())) return utcLikeDate;
  }

  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function formatReleaseTimestamp(value) {
  if (!value) return 'Unknown';
  const parsed = parseReleaseTimestamp(value);
  if (!parsed) return value;
  return parsed.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });
}

export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(LOCALE, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatNumber(value) {
  if (value === null || value === undefined) return '—';
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return '—';
  return numberValue.toLocaleString(LOCALE, { maximumFractionDigits: 1 });
}

export function formatExerciseImpact(impact) {
  if (!impact) return 'Impact unavailable.';
  return `${impact.routineReferences} routine links (${impact.routineUsers} users), ${impact.setReferences} logged sets (${impact.setUsers} users)`;
}

export function formatRestTime(targetRestSeconds) {
  const totalSeconds = Number(targetRestSeconds);
  if (!Number.isInteger(totalSeconds) || totalSeconds <= 0) return null;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatDurationSeconds(value) {
  const totalSeconds = Number(value);
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return null;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function resolveTargetWeightSaveStatusLabel(status) {
  if (status === 'pending') return 'Save on finish';
  if (status === 'saving') return 'Saving';
  if (status === 'saved') return 'Saved';
  if (status === 'queued') return 'Queued offline';
  if (status === 'failed') return 'Failed';
  return null;
}

export function formatSessionDetailExerciseStateLabel(state) {
  if (state === 'completed') return 'Completed';
  if (state === 'in_progress') return 'In progress';
  return 'Skipped';
}

export function formatDurationMinutes(value) {
  const totalMinutes = Number(value);
  if (!Number.isFinite(totalMinutes) || totalMinutes < 0) return '—';
  const rounded = Math.round(totalMinutes);
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (!hours) return `${minutes}m`;
  if (!minutes) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}
