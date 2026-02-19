import {
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  OFFLINE_STORE,
} from './constants.js';

let offlineDbPromise = null;
const memoryQueue = [];

export async function openOfflineDb() {
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

export async function enqueueQueuedOperation(operation) {
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

export async function listQueuedOperations() {
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

export async function removeQueuedOperations(operationIds) {
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
