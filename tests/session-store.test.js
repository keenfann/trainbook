import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prepareMock } = vi.hoisted(() => ({
  prepareMock: vi.fn(),
}));

vi.mock('../server/db.js', () => ({
  default: {
    prepare: prepareMock,
  },
}));

import SqliteSessionStore from '../server/session-store.js';

function withCallback(fn) {
  return new Promise((resolve) => {
    fn((error, data) => resolve({ error, data }));
  });
}

beforeEach(() => {
  prepareMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SqliteSessionStore', () => {
  it('returns null for missing sessions and expired sessions', async () => {
    const getMock = vi
      .fn()
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({
        sess: JSON.stringify({ user: 'coach' }),
        expires: Date.now() - 1,
      });

    const deleteRunMock = vi.fn();

    prepareMock.mockImplementation((sql) => {
      if (sql.includes('SELECT sess, expires')) {
        return { get: getMock };
      }
      if (sql.includes('DELETE FROM sessions_store WHERE sid = ?')) {
        return { run: deleteRunMock };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const store = new SqliteSessionStore({ cleanupIntervalMs: 0 });

    const first = await withCallback((cb) => store.get('sid-1', cb));
    expect(first.error).toBeNull();
    expect(first.data).toBeNull();

    const second = await withCallback((cb) => store.get('sid-2', cb));
    expect(second.error).toBeNull();
    expect(second.data).toBeNull();
    expect(deleteRunMock).toHaveBeenCalledWith('sid-2');
  });

  it('persists, touches, and destroys sessions', async () => {
    const insertRunMock = vi.fn();
    const touchRunMock = vi.fn();
    const deleteRunMock = vi.fn();

    prepareMock.mockImplementation((sql) => {
      if (sql.includes('INSERT INTO sessions_store')) {
        return { run: insertRunMock };
      }
      if (sql.includes('UPDATE sessions_store SET expires = ? WHERE sid = ?')) {
        return { run: touchRunMock };
      }
      if (sql.includes('DELETE FROM sessions_store WHERE sid = ?')) {
        return { run: deleteRunMock };
      }
      if (sql.includes('SELECT sess, expires')) {
        return {
          get: () => ({ sess: JSON.stringify({ user: 'coach' }), expires: null }),
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const store = new SqliteSessionStore({ cleanupIntervalMs: 0 });
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    const setResult = await withCallback((cb) => store.set('sid-1', {
      cookie: { maxAge: 5000 },
      user: 'coach',
    }, cb));
    expect(setResult.error).toBeNull();
    expect(insertRunMock).toHaveBeenCalledWith(
      'sid-1',
      JSON.stringify({ cookie: { maxAge: 5000 }, user: 'coach' }),
      now + 5000
    );

    const touchResult = await withCallback((cb) => store.touch('sid-1', {
      cookie: { expires: '2026-02-20T08:00:00.000Z' },
    }, cb));
    expect(touchResult.error).toBeNull();
    expect(touchRunMock).toHaveBeenCalledWith(
      Date.parse('2026-02-20T08:00:00.000Z'),
      'sid-1'
    );

    const getResult = await withCallback((cb) => store.get('sid-1', cb));
    expect(getResult.error).toBeNull();
    expect(getResult.data).toEqual({ user: 'coach' });

    const destroyResult = await withCallback((cb) => store.destroy('sid-1', cb));
    expect(destroyResult.error).toBeNull();
    expect(deleteRunMock).toHaveBeenCalledWith('sid-1');
  });

  it('returns callback errors for db failures and cleanup warnings', async () => {
    prepareMock.mockImplementation((sql) => {
      if (sql.includes('SELECT sess, expires')) {
        return {
          get: () => ({ sess: 'not-json', expires: null }),
        };
      }
      if (sql.includes('INSERT INTO sessions_store')) {
        return {
          run: () => {
            throw new Error('set failed');
          },
        };
      }
      if (sql.includes('UPDATE sessions_store SET expires = ? WHERE sid = ?')) {
        return {
          run: () => {
            throw new Error('touch failed');
          },
        };
      }
      if (sql.includes('DELETE FROM sessions_store WHERE sid = ?')) {
        return {
          run: () => {
            throw new Error('destroy failed');
          },
        };
      }
      if (sql.includes('DELETE FROM sessions_store WHERE expires IS NOT NULL')) {
        return {
          run: () => {
            throw new Error('cleanup failed');
          },
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const scheduled = [];
    const setIntervalSpy = vi.spyOn(global, 'setInterval').mockImplementation((fn) => {
      scheduled.push(fn);
      return { unref: vi.fn() };
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const store = new SqliteSessionStore({ cleanupIntervalMs: 10 });

    const getResult = await withCallback((cb) => store.get('sid-1', cb));
    expect(getResult.error).toBeInstanceOf(Error);

    const setResult = await withCallback((cb) => store.set('sid-1', { cookie: {} }, cb));
    expect(setResult.error).toBeInstanceOf(Error);

    const touchResult = await withCallback((cb) => store.touch('sid-1', { cookie: {} }, cb));
    expect(touchResult.error).toBeInstanceOf(Error);

    const destroyResult = await withCallback((cb) => store.destroy('sid-1', cb));
    expect(destroyResult.error).toBeInstanceOf(Error);

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(scheduled).toHaveLength(1);
    scheduled[0]();
    expect(warnSpy).toHaveBeenCalledWith('Session cleanup failed.', expect.any(Error));

    expect(store.cleanupIntervalMs).toBe(10);
  });
});
