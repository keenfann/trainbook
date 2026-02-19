import {
  API_BASE,
  CSRF_HEADER,
  SAFE_METHODS,
  SYNC_BATCH_LIMIT,
} from './constants.js';
import {
  emitSyncComplete,
  emitSyncState,
  syncState,
  updateSyncState,
} from './sync-state.js';
import {
  enqueueQueuedOperation,
  listQueuedOperations,
  removeQueuedOperations,
} from './offline-queue.js';
import {
  buildQueuedResponse,
  isNetworkError,
  nowIso,
  parseJsonBody,
  randomOperationId,
  toSyncOperation,
} from './sync-operations.js';
import {
  clearCsrfToken,
  loadCsrfToken,
  setCsrfToken,
} from './csrf.js';

let offlineSyncInitialized = false;

async function refreshQueueSize() {
  const queue = await listQueuedOperations();
  updateSyncState({ queueSize: queue.length });
  return queue.length;
}

async function enqueueSyncOperation(operation) {
  const queuedOperation = {
    operationId: randomOperationId(),
    operationType: operation.operationType,
    payload: operation.payload,
    queuedAt: nowIso(),
  };
  await enqueueQueuedOperation(queuedOperation);
  const queueSize = await refreshQueueSize();
  updateSyncState({
    queueSize,
    lastError: null,
  });
  return queuedOperation;
}

async function flushQueuedOperations() {
  if (syncState.syncing || !syncState.online) return;
  const queue = await listQueuedOperations();
  updateSyncState({ queueSize: queue.length });
  if (!queue.length) return;

  updateSyncState({ syncing: true, lastError: null });
  try {
    const batch = queue.slice(0, SYNC_BATCH_LIMIT);
    const sendRequest = async (token) =>
      fetch(`${API_BASE}/api/sync/batch`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          [CSRF_HEADER]: token,
        },
        body: JSON.stringify({
          operations: batch.map((operation) => ({
            operationId: operation.operationId,
            operationType: operation.operationType,
            payload: operation.payload,
          })),
        }),
      });

    let token = await loadCsrfToken();
    let response = await sendRequest(token);
    let data = await response.json().catch(() => null);
    if (
      response.status === 403 &&
      data?.error === 'Invalid CSRF token'
    ) {
      clearCsrfToken();
      token = await loadCsrfToken();
      response = await sendRequest(token);
      data = await response.json().catch(() => null);
    }
    if (!response.ok) {
      throw new Error(data?.error || 'Failed to sync offline changes.');
    }

    const resolvedOperationIds = (data?.results || [])
      .filter((result) => result.status === 'applied' || result.status === 'duplicate')
      .map((result) => result.operationId)
      .filter(Boolean);
    await removeQueuedOperations(resolvedOperationIds);
    const remaining = await listQueuedOperations();
    updateSyncState({
      queueSize: remaining.length,
      lastSyncAt: nowIso(),
      lastError: (data?.summary?.rejected || 0) > 0 ? 'Some queued changes were rejected.' : null,
    });
    if (resolvedOperationIds.length) {
      emitSyncComplete({ applied: resolvedOperationIds.length });
    }
    if (remaining.length) {
      flushQueuedOperations().catch(() => undefined);
    }
  } catch (error) {
    updateSyncState({ lastError: error.message || 'Failed to sync offline changes.' });
  } finally {
    updateSyncState({ syncing: false });
  }
}

function initializeOfflineSync() {
  if (offlineSyncInitialized) return;
  offlineSyncInitialized = true;
  if (typeof window === 'undefined') return;

  refreshQueueSize().catch(() => undefined);
  emitSyncState();

  window.addEventListener('online', () => {
    updateSyncState({ online: true, lastError: null });
    flushQueuedOperations().catch(() => undefined);
  });
  window.addEventListener('offline', () => {
    updateSyncState({ online: false });
  });

  if (syncState.online) {
    flushQueuedOperations().catch(() => undefined);
  }
}

export async function apiFetch(path, options = {}) {
  initializeOfflineSync();
  const { _csrfRetry, ...fetchOptions } = options;
  const method = (fetchOptions.method || 'GET').toUpperCase();
  const parsedBody = parseJsonBody(fetchOptions.body);
  const syncOperation = SAFE_METHODS.has(method)
    ? null
    : toSyncOperation(path, method, parsedBody);
  const headers = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers || {}),
  };
  const hasCsrfHeader = Object.keys(headers).some(
    (key) => key.toLowerCase() === 'x-csrf-token'
  );
  if (!SAFE_METHODS.has(method) && !hasCsrfHeader) {
    const token = await loadCsrfToken();
    if (token) {
      headers[CSRF_HEADER] = token;
    }
  }
  if (syncOperation && !syncState.online) {
    const queuedOperation = await enqueueSyncOperation(syncOperation);
    return buildQueuedResponse(syncOperation, queuedOperation.operationId);
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      ...fetchOptions,
      headers,
    });
  } catch (error) {
    if (syncOperation && isNetworkError(error)) {
      updateSyncState({ online: false });
      const queuedOperation = await enqueueSyncOperation(syncOperation);
      return buildQueuedResponse(syncOperation, queuedOperation.operationId);
    }
    throw error;
  }

  if (response.status === 204) {
    if (syncState.online) {
      flushQueuedOperations().catch(() => undefined);
    }
    return null;
  }

  const data = await response.json().catch(() => null);
  if (data?.csrfToken) {
    setCsrfToken(data.csrfToken);
  }
  if (!response.ok) {
    if (
      response.status === 403 &&
      data?.error === 'Invalid CSRF token' &&
      !_csrfRetry &&
      !SAFE_METHODS.has(method)
    ) {
      clearCsrfToken();
      const token = await loadCsrfToken();
      return apiFetch(path, {
        ...fetchOptions,
        headers: {
          ...headers,
          [CSRF_HEADER]: token,
        },
        _csrfRetry: true,
      });
    }
    const message = data?.error || 'Request failed';
    throw new Error(message);
  }
  if (syncState.online) {
    flushQueuedOperations().catch(() => undefined);
  }
  return data;
}
