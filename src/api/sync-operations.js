export function nowIso() {
  return new Date().toISOString();
}

export function randomOperationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function parseJsonBody(body) {
  if (!body) return {};
  if (typeof body === 'object') return body;
  if (typeof body !== 'string') return {};
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

export function toSyncOperation(path, method, body) {
  if (method === 'POST') {
    const createSetMatch = path.match(/^\/api\/sessions\/(\d+)\/sets$/);
    if (createSetMatch) {
      const sessionId = Number(createSetMatch[1]);
      return {
        operationType: 'session_set.create',
        payload: {
          sessionId,
          exerciseId: Number(body.exerciseId),
          routineExerciseId: Number(body.routineExerciseId) || null,
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
          routineExerciseId: Number(body.routineExerciseId) || null,
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
          routineExerciseId: Number(body.routineExerciseId) || null,
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
      if (Object.prototype.hasOwnProperty.call(body, 'warmupStartedAt')) {
        payload.warmupStartedAt = body.warmupStartedAt;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'warmupCompletedAt')) {
        payload.warmupCompletedAt = body.warmupCompletedAt;
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

    const updateRoutineExerciseTargetMatch = path.match(
      /^\/api\/routines\/(\d+)\/exercises\/(\d+)\/target$/
    );
    if (updateRoutineExerciseTargetMatch) {
      return {
        operationType: 'routine_exercise.target_weight.update',
        payload: {
          routineId: Number(updateRoutineExerciseTargetMatch[1]),
          exerciseId: Number(updateRoutineExerciseTargetMatch[2]),
          routineExerciseId: Number(body.routineExerciseId) || null,
          equipment: body.equipment,
          targetWeight: Number(body.targetWeight),
        },
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

export function buildQueuedResponse(operation, operationId) {
  if (operation.operationType === 'session_set.create') {
    const completedAt = operation.payload.completedAt || nowIso();
    return {
      queued: true,
      offline: true,
      set: {
        id: `offline-${operationId}`,
        sessionId: operation.payload.sessionId,
        exerciseId: operation.payload.exerciseId,
        routineExerciseId: operation.payload.routineExerciseId || null,
        sessionExerciseKey: operation.payload.routineExerciseId
          ? `routine:${operation.payload.routineExerciseId}`
          : `exercise:${operation.payload.exerciseId}`,
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
        routineExerciseId: operation.payload.routineExerciseId || null,
        sessionExerciseKey: operation.payload.routineExerciseId
          ? `routine:${operation.payload.routineExerciseId}`
          : `exercise:${operation.payload.exerciseId}`,
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
        routineExerciseId: operation.payload.routineExerciseId || null,
        sessionExerciseKey: operation.payload.routineExerciseId
          ? `routine:${operation.payload.routineExerciseId}`
          : `exercise:${operation.payload.exerciseId}`,
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
        routineExerciseId: operation.payload.routineExerciseId || null,
        sessionExerciseKey: operation.payload.routineExerciseId
          ? `routine:${operation.payload.routineExerciseId}`
          : `exercise:${operation.payload.exerciseId}`,
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

  if (operation.operationType === 'routine_exercise.target_weight.update') {
    return {
      queued: true,
      offline: true,
      target: {
        routineId: operation.payload.routineId,
        exerciseId: operation.payload.exerciseId,
        equipment: operation.payload.equipment || null,
        targetWeight: operation.payload.targetWeight,
        updatedAt: nowIso(),
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

export function isNetworkError(error) {
  if (error instanceof TypeError) return true;
  const message = String(error?.message || '');
  return /fetch|network/i.test(message);
}
