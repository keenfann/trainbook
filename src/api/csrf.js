import { API_BASE } from './constants.js';

let csrfToken = null;
let csrfPromise = null;

export function getCsrfToken() {
  return csrfToken;
}

export function setCsrfToken(value) {
  csrfToken = value || null;
}

export function clearCsrfToken() {
  csrfToken = null;
}

export async function loadCsrfToken() {
  if (csrfToken) return csrfToken;
  if (!csrfPromise) {
    csrfPromise = fetch(`${API_BASE}/api/csrf`, { credentials: 'include' })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          const message = data?.error || 'Failed to fetch CSRF token';
          throw new Error(message);
        }
        csrfToken = data?.csrfToken || null;
        return csrfToken;
      })
      .finally(() => {
        csrfPromise = null;
      });
  }
  return csrfPromise;
}
