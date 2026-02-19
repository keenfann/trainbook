import { describe, expect, it } from 'vitest';
import { isLocalDevRequest, shouldApplyDevAutologin } from '../server/dev-autologin.js';

function buildRequest({
  ip = '127.0.0.1',
  hostname = 'localhost',
  forwardedFor = '',
} = {}) {
  return {
    ip,
    hostname,
    get(name) {
      if (name.toLowerCase() === 'x-forwarded-for') {
        return forwardedFor;
      }
      return '';
    },
  };
}

describe('shouldApplyDevAutologin', () => {
  it('allows local requests when dev autologin is enabled', () => {
    const req = buildRequest();
    const allowed = shouldApplyDevAutologin(req, {
      enabled: true,
      allowRemote: false,
    });
    expect(allowed).toBe(true);
  });

  it('blocks non-local requests when remote bypass is disabled', () => {
    const req = buildRequest({
      ip: '10.0.0.8',
      hostname: 'trainbook.test',
      forwardedFor: '203.0.113.5',
    });
    const allowed = shouldApplyDevAutologin(req, {
      enabled: true,
      allowRemote: false,
    });
    expect(allowed).toBe(false);
  });

  it('allows non-local requests only when remote bypass is enabled', () => {
    const req = buildRequest({
      ip: '10.0.0.8',
      hostname: 'trainbook.test',
      forwardedFor: '203.0.113.5',
    });
    const allowed = shouldApplyDevAutologin(req, {
      enabled: true,
      allowRemote: true,
    });
    expect(allowed).toBe(true);
  });
});

describe('isLocalDevRequest', () => {
  it('returns false when request is missing', () => {
    expect(isLocalDevRequest()).toBe(false);
  });

  it('allows localhost hostname without forwarded header when req.get is unavailable', () => {
    const req = {
      ip: '10.0.0.8',
      hostname: 'localhost',
      headers: {},
    };
    expect(isLocalDevRequest(req)).toBe(true);
  });

  it('blocks localhost hostname when x-forwarded-for is present', () => {
    const req = {
      ip: '10.0.0.8',
      hostname: 'localhost',
      headers: {
        'x-forwarded-for': '203.0.113.7',
      },
    };
    expect(isLocalDevRequest(req)).toBe(false);
  });

  it('accepts loopback ipv6 format', () => {
    const req = {
      ip: '::ffff:127.0.0.1',
      hostname: 'trainbook.local',
      headers: {},
    };
    expect(isLocalDevRequest(req)).toBe(true);
  });
});
