import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { setupApiIntegrationSuite } from '../helpers/api-integration-helpers.js';

const { app, fetchCsrfToken, registerUser } = await setupApiIntegrationSuite('auth');

const THIRTY_DAY_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function extractSessionCookieExpiry(cookieHeaders) {
  const sessionCookie = (cookieHeaders || []).find(
    (value) => typeof value === 'string' && value.startsWith('connect.sid=')
  );
  if (!sessionCookie) return null;
  const expiresMatch = sessionCookie.match(/;\s*Expires=([^;]+)/i);
  if (!expiresMatch) return null;
  const expiresAt = Date.parse(expiresMatch[1]);
  return Number.isFinite(expiresAt) ? expiresAt : null;
}

function expectThirtyDayCookieLifetime(response) {
  const expiresAt = extractSessionCookieExpiry(response.headers['set-cookie']);
  expect(expiresAt).not.toBeNull();
  const serverTimestamp = Date.parse(response.headers.date || '');
  const responseAt = Number.isFinite(serverTimestamp) ? serverTimestamp : Date.now();
  const lifetimeMs = expiresAt - responseAt;
  expect(lifetimeMs).toBeGreaterThanOrEqual(THIRTY_DAY_COOKIE_MAX_AGE_MS - 60_000);
  expect(lifetimeMs).toBeLessThanOrEqual(THIRTY_DAY_COOKIE_MAX_AGE_MS + 60_000);
}

describe('API integration auth', () => {
  it('rejects mutating requests without CSRF token', async () => {
    const agent = request.agent(app);
    const response = await agent
      .post('/api/auth/register')
      .send({ username: 'coach', password: 'secret123' });
    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/CSRF/i);
  });

  it('supports auth lifecycle and password updates', async () => {
    const agent = request.agent(app);
    const username = 'coach-auth-lifecycle';
    const registerCsrf = await fetchCsrfToken(agent);
    const register = await agent
      .post('/api/auth/register')
      .set('x-csrf-token', registerCsrf)
      .send({ username, password: 'secret123' });
    expect(register.status).toBe(200);
    expect(register.body.user?.username).toBe(username);
    expectThirtyDayCookieLifetime(register);

    const whoAmI = await agent.get('/api/auth/me');
    expect(whoAmI.status).toBe(200);
    expect(whoAmI.body.user?.username).toBe(username);

    const passwordCsrf = await fetchCsrfToken(agent);
    const wrongPassword = await agent
      .post('/api/auth/password')
      .set('x-csrf-token', passwordCsrf)
      .send({ currentPassword: 'wrong', nextPassword: 'secret456' });
    expect(wrongPassword.status).toBe(401);

    const updatePassword = await agent
      .post('/api/auth/password')
      .set('x-csrf-token', passwordCsrf)
      .send({ currentPassword: 'secret123', nextPassword: 'secret456' });
    expect(updatePassword.status).toBe(200);
    expect(updatePassword.body.ok).toBe(true);

    const logoutCsrf = await fetchCsrfToken(agent);
    const logout = await agent
      .post('/api/auth/logout')
      .set('x-csrf-token', logoutCsrf)
      .send({});
    expect(logout.status).toBe(200);

    const unauthRoutines = await agent.get('/api/routines');
    expect(unauthRoutines.status).toBe(401);

    const loginCsrf = await fetchCsrfToken(agent);
    const login = await agent
      .post('/api/auth/login')
      .set('x-csrf-token', loginCsrf)
      .send({ username, password: 'secret456' });
    expect(login.status).toBe(200);
    expect(login.body.user?.username).toBe(username);
    expectThirtyDayCookieLifetime(login);
  });

});
