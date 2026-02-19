import fs from 'fs';
import path from 'path';
import { afterAll, beforeEach, expect } from 'vitest';

function buildTestDbPath(suiteId) {
  const normalizedSuiteId = String(suiteId || 'suite')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return path.resolve(
    process.cwd(),
    'db',
    `test-api-${process.pid}-${normalizedSuiteId || 'suite'}.sqlite`
  );
}

export async function setupApiIntegrationSuite(suiteId) {
  const testDbPath = buildTestDbPath(suiteId);

  process.env.NODE_ENV = 'test';
  process.env.DB_PATH = testDbPath;
  process.env.SESSION_SECRET = 'test-session-secret';
  process.env.DEV_AUTOLOGIN = 'false';
  process.env.DEV_AUTOLOGIN_ALLOW_REMOTE = 'false';

  if (fs.existsSync(testDbPath)) {
    fs.rmSync(testDbPath, { force: true });
  }

  const [{ app }, { default: db }] = await Promise.all([
    import('../../server/index.js'),
    import('../../server/db.js'),
  ]);

  function resetDatabase() {
    db.exec(`
      DELETE FROM sync_operations;
      DELETE FROM session_sets;
      DELETE FROM sessions;
      DELETE FROM routine_exercises;
      DELETE FROM routines;
      DELETE FROM user_bands;
      DELETE FROM bodyweight_entries;
      DELETE FROM exercises;
      DELETE FROM users;
      DELETE FROM sessions_store;
      DELETE FROM sqlite_sequence;
    `);
  }

  async function fetchCsrfToken(agent) {
    const response = await agent.get('/api/csrf');
    expect(response.status).toBe(200);
    expect(response.body.csrfToken).toBeTypeOf('string');
    return response.body.csrfToken;
  }

  async function registerUser(agent, username, password = 'secret123') {
    const csrfToken = await fetchCsrfToken(agent);
    const response = await agent
      .post('/api/auth/register')
      .set('x-csrf-token', csrfToken)
      .send({ username, password });
    expect(response.status).toBe(200);
    return response.body.user;
  }

  beforeEach(() => {
    resetDatabase();
  });

  afterAll(() => {
    try {
      db.close?.();
    } catch {
      // no-op
    }
    if (fs.existsSync(testDbPath)) {
      fs.rmSync(testDbPath, { force: true });
    }
  });

  return {
    app,
    db,
    fetchCsrfToken,
    registerUser,
    resetDatabase,
    testDbPath,
  };
}
