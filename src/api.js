const API_BASE = import.meta.env?.VITE_API_BASE || '';
const CSRF_HEADER = 'X-CSRF-Token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SYNC_STATE_EVENT = 'trainbook:sync-state';
const SYNC_COMPLETE_EVENT = 'trainbook:sync-complete';
const OFFLINE_DB_NAME = 'trainbook-offline';
const OFFLINE_STORE = 'mutation_queue';
const OFFLINE_DB_VERSION = 1;
const SYNC_BATCH_LIMIT = 50;
let csrfToken = null;
let csrfPromise = null;
let offlineDbPromise = null;
let offlineSyncInitialized = false;
const memoryQueue = [];
const syncState = {
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  queueSize: 0,
  syncing: false,
  lastSyncAt: null,
  lastError: null,
};

function nowIso() {
  return new Date().toISOString();
}

function emitSyncState() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(SYNC_STATE_EVENT, {
      detail: { ...syncState },
    })
  );
}

function updateSyncState(patch) {
  Object.assign(syncState, patch);
  emitSyncState();
}

function randomOperationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseJsonBody(body) {
  if (!body) return {};
  if (typeof body === 'object') return body;
  if (typeof body !== 'string') return {};
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function toSyncOperation(path, method, body) {
  if (method === 'POST') {
    const createSetMatch = path.match(/^\/api\/sessions\/(\d+)\/sets$/);
    if (createSetMatch) {
      const sessionId = Number(createSetMatch[1]);
      return {
        operationType: 'session_set.create',
        payload: {
          sessionId,
          exerciseId: Number(body.exerciseId),
          reps: Number(body.reps),
          weight:
            body.weight === null || body.weight === undefined || body.weight === ''
              ? 0
              : Number(body.weight),
          bandLabel: body.bandLabel || null,
          startedAt: body.startedAt || null,
          completedAt: body.completedAt || body.createdAt || nowIso(),
        },
      };
    }

    const startExerciseMatch = path.match(/^\/api\/sessions\/(\d+)\/exercises\/(\d+)\/start$/);
    if (startExerciseMatch) {
      return {
        operationType: 'session_exercise.start',
        payload: {
          sessionId: Number(startExerciseMatch[1]),
          exerciseId: Number(startExerciseMatch[2]),
          startedAt: body.startedAt || nowIso(),
        },
      };
    }

    const completeExerciseMatch = path.match(/^\/api\/sessions\/(\d+)\/exercises\/(\d+)\/complete$/);
    if (completeExerciseMatch) {
      return {
        operationType: 'session_exercise.complete',
        payload: {
          sessionId: Number(completeExerciseMatch[1]),
          exerciseId: Number(completeExerciseMatch[2]),
          completedAt: body.completedAt || nowIso(),
        },
      };
    }

    if (path === '/api/weights') {
      return {
        operationType: 'bodyweight.create',
        payload: {
          weight: Number(body.weight),
          measuredAt: body.measuredAt || nowIso(),
          notes: body.notes ?? null,
        },
      };
    }
  }

  if (method === 'PUT') {
    const updateSessionMatch = path.match(/^\/api\/sessions\/(\d+)$/);
    if (updateSessionMatch) {
      const sessionId = Number(updateSessionMatch[1]);
      const payload = { sessionId };
      if (Object.prototype.hasOwnProperty.call(body, 'name')) {
        payload.name = body.name;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'notes')) {
        payload.notes = body.notes;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'endedAt')) {
        payload.endedAt = body.endedAt;
      }
      return {
        operationType: 'session.update',
        payload,
      };
    }

    const updateSetMatch = path.match(/^\/api\/sets\/(\d+)$/);
    if (updateSetMatch) {
      const payload = { setId: Number(updateSetMatch[1]) };
      if (Object.prototype.hasOwnProperty.call(body, 'reps')) {
        payload.reps = body.reps;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'weight')) {
        payload.weight = body.weight;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'bandLabel')) {
        payload.bandLabel = body.bandLabel;
      }
      return {
        operationType: 'session_set.update',
        payload,
      };
    }
  }

  if (method === 'DELETE') {
    const deleteSetMatch = path.match(/^\/api\/sets\/(\d+)$/);
    if (deleteSetMatch) {
      return {
        operationType: 'session_set.delete',
        payload: {
          setId: Number(deleteSetMatch[1]),
        },
      };
    }
  }

  return null;
}

function buildQueuedResponse(operation, operationId) {
  if (operation.operationType === 'session_set.create') {
    const completedAt = operation.payload.completedAt || nowIso();
    return {
      queued: true,
      offline: true,
      set: {
        id: `offline-${operationId}`,
        sessionId: operation.payload.sessionId,
        exerciseId: operation.payload.exerciseId,
        setIndex: 1,
        reps: operation.payload.reps,
        weight: operation.payload.weight,
        bandLabel: operation.payload.bandLabel || null,
        startedAt: operation.payload.startedAt || null,
        completedAt,
        createdAt: completedAt,
        pending: true,
      },
      exerciseProgress: {
        exerciseId: operation.payload.exerciseId,
        status: 'in_progress',
        startedAt: operation.payload.startedAt || completedAt,
        completedAt: null,
        pending: true,
      },
    };
  }

  if (operation.operationType === 'session_exercise.start') {
    return {
      queued: true,
      offline: true,
      exerciseProgress: {
        exerciseId: operation.payload.exerciseId,
        status: 'in_progress',
        startedAt: operation.payload.startedAt || nowIso(),
        completedAt: null,
        pending: true,
      },
    };
  }

  if (operation.operationType === 'session_exercise.complete') {
    return {
      queued: true,
      offline: true,
      exerciseProgress: {
        exerciseId: operation.payload.exerciseId,
        status: 'completed',
        completedAt: operation.payload.completedAt || nowIso(),
        pending: true,
      },
    };
  }

  if (operation.operationType === 'bodyweight.create') {
    return {
      queued: true,
      offline: true,
      entry: {
        id: `offline-${operationId}`,
        weight: operation.payload.weight,
        measuredAt: operation.payload.measuredAt || nowIso(),
        notes: operation.payload.notes || null,
        pending: true,
      },
    };
  }

  if (operation.operationType === 'session.update') {
    return {
      queued: true,
      offline: true,
      session: {
        id: operation.payload.sessionId,
        name: operation.payload.name ?? null,
        notes: operation.payload.notes ?? null,
        endedAt: operation.payload.endedAt ?? null,
        pending: true,
      },
    };
  }

  if (operation.operationType === 'session_set.update') {
    return {
      queued: true,
      offline: true,
      set: {
        id: operation.payload.setId,
        reps: operation.payload.reps,
        weight: operation.payload.weight,
        bandLabel: operation.payload.bandLabel || null,
        pending: true,
      },
    };
  }

  if (operation.operationType === 'session_set.delete') {
    return {
      queued: true,
      offline: true,
      ok: true,
    };
  }

  return { queued: true, offline: true, ok: true };
}

function isNetworkError(error) {
  if (error instanceof TypeError) return true;
  const message = String(error?.message || '');
  return /fetch|network/i.test(message);
}

async function openOfflineDb() {
  if (typeof indexedDB === 'undefined') {
    return null;
  }
  if (!offlineDbPromise) {
    offlineDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(OFFLINE_STORE)) {
          database.createObjectStore(OFFLINE_STORE, {
            keyPath: 'operationId',
          });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return offlineDbPromise;
}

async function enqueueQueuedOperation(operation) {
  if (typeof indexedDB === 'undefined') {
    memoryQueue.push(operation);
    return;
  }
  const database = await openOfflineDb();
  if (!database) {
    memoryQueue.push(operation);
    return;
  }
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(OFFLINE_STORE, 'readwrite');
    transaction.objectStore(OFFLINE_STORE).put(operation);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function listQueuedOperations() {
  if (typeof indexedDB === 'undefined') {
    return [...memoryQueue].sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  }
  const database = await openOfflineDb();
  if (!database) {
    return [...memoryQueue].sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  }
  const rows = await new Promise((resolve, reject) => {
    const transaction = database.transaction(OFFLINE_STORE, 'readonly');
    const request = transaction.objectStore(OFFLINE_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error);
  });
  return rows.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

async function removeQueuedOperations(operationIds) {
  if (!operationIds.length) return;
  if (typeof indexedDB === 'undefined') {
    const keep = new Set(operationIds);
    for (let index = memoryQueue.length - 1; index >= 0; index -= 1) {
      if (keep.has(memoryQueue[index].operationId)) {
        memoryQueue.splice(index, 1);
      }
    }
    return;
  }
  const database = await openOfflineDb();
  if (!database) return;
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(OFFLINE_STORE, 'readwrite');
    const store = transaction.objectStore(OFFLINE_STORE);
    operationIds.forEach((operationId) => {
      store.delete(operationId);
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

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
      csrfToken = null;
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
    if (resolvedOperationIds.length && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(SYNC_COMPLETE_EVENT, {
          detail: { applied: resolvedOperationIds.length },
        })
      );
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

async function loadCsrfToken() {
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
    csrfToken = data.csrfToken;
  }
  if (!response.ok) {
    if (
      response.status === 403 &&
      data?.error === 'Invalid CSRF token' &&
      !_csrfRetry &&
      !SAFE_METHODS.has(method)
    ) {
      csrfToken = null;
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
