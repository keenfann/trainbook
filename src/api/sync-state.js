import { SYNC_COMPLETE_EVENT, SYNC_STATE_EVENT } from './constants.js';

export const syncState = {
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  queueSize: 0,
  syncing: false,
  lastSyncAt: null,
  lastError: null,
};

export function emitSyncState() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(SYNC_STATE_EVENT, {
      detail: { ...syncState },
    })
  );
}

export function updateSyncState(patch) {
  Object.assign(syncState, patch);
  emitSyncState();
}

export function emitSyncComplete(detail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(SYNC_COMPLETE_EVENT, {
      detail,
    })
  );
}
