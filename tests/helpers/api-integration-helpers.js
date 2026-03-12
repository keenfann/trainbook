import fs from 'fs';
import path from 'path';
import { beforeEach, expect } from 'vitest';

const SHARED_TEST_DB_PATH = path.resolve(process.cwd(), 'db', `test-api-${process.pid}.sqlite`);
let sharedContextPromise = null;

async function initSharedContext() {
  process.env.NODE_ENV = 'test';
  process.env.DB_PATH = SHARED_TEST_DB_PATH;
  process.env.SESSION_SECRET = 'test-session-secret';
  process.env.DEV_AUTOLOGIN = 'false';
  process.env.DEV_AUTOLOGIN_ALLOW_REMOTE = 'false';

  if (fs.existsSync(SHARED_TEST_DB_PATH)) {
    fs.rmSync(SHARED_TEST_DB_PATH, { force: true });
  }

  const [{ app }, { default: db }] = await Promise.all([
    import('../../server/index.js'),
    import('../../server/db.js'),
  ]);

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

  return {
    app,
    db,
    fetchCsrfToken,
    registerUser,
    testDbPath: SHARED_TEST_DB_PATH,
  };
}

export async function setupApiIntegrationSuite(suiteId) {
  if (!sharedContextPromise) {
    sharedContextPromise = initSharedContext();
  }
  const { app, db, fetchCsrfToken, registerUser, testDbPath } = await sharedContextPromise;

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

  beforeEach(() => {
    resetDatabase();
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
