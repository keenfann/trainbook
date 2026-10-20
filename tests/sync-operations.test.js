import { describe, expect, it } from 'vitest';
import { buildQueuedResponse, toSyncOperation } from '../src/api/sync-operations.js';

describe('Queued session updates', () => {
  it('keeps only supplied fields so partial updates do not clear the local workout', () => {
    const operation = toSyncOperation('/api/sessions/810', 'PUT', { notes: 'Felt strong' });
    expect(buildQueuedResponse(operation, 'notes-save')).toEqual({
      queued: true,
      offline: true,
      session: { id: 810, notes: 'Felt strong', pending: true },
    });
  });

  it('preserves explicit clears and warmup timestamps in a queued finish response', () => {
    const fields = {
      name: null,
      notes: null,
      endedAt: '2026-10-06T10:30:00.000Z',
      warmupStartedAt: '2026-10-06T10:00:00.000Z',
      warmupCompletedAt: '2026-10-06T10:05:00.000Z',
    };
    const operation = toSyncOperation('/api/sessions/810', 'PUT', fields);
    expect(buildQueuedResponse(operation, 'finish-save').session).toEqual({
      id: 810,
      ...fields,
      pending: true,
    });
  });
});
