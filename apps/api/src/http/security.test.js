import { afterEach, describe, expect, it, vi } from 'vitest';
import security from './security.js';

const { applySecurityHeaders, createRateLimit, enforceCors, rejectUnexpectedFileUploads } = security;

function harness({ headers = {}, method = 'GET', secure = false } = {}) {
  const result = { headers: {}, payload: null, statusCode: 200 };
  const request = {
    get: (name) => headers[name.toLowerCase()] || '',
    ip: '203.0.113.1',
    method,
    secure,
    socket: { remoteAddress: '203.0.113.1' }
  };
  const response = {
    end: vi.fn(),
    json(payload) { result.payload = payload; return this; },
    set(name, value) {
      if (typeof name === 'object') Object.assign(result.headers, name);
      else result.headers[name] = value;
      return this;
    },
    status(code) { result.statusCode = code; return this; }
  };
  return { request, response, result };
}

afterEach(() => {
  delete process.env.NODE_ENV;
  delete process.env.ORBIT_ALLOWED_ORIGINS;
});

describe('API perimeter security', () => {
  it('rejects multipart bodies until a quarantined non-executable upload architecture exists', () => {
    const { request, response, result } = harness({ headers: { 'content-type': 'multipart/form-data; boundary=test' }, method: 'POST' });
    const next = vi.fn();
    rejectUnexpectedFileUploads(request, response, next);
    expect(result.statusCode).toBe(415);
    expect(result.payload).toMatchObject({ code: 'FILE_UPLOADS_NOT_SUPPORTED' });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects disallowed origins and permits configured credentialed origins', () => {
    process.env.NODE_ENV = 'production';
    process.env.ORBIT_ALLOWED_ORIGINS = 'https://preview.example';
    const denied = harness({ headers: { origin: 'https://attacker.example', host: 'api.example' } });
    const deniedNext = vi.fn();
    enforceCors(denied.request, denied.response, deniedNext);
    expect(denied.result).toMatchObject({ statusCode: 403, payload: { ok: false, error: 'Origin is not allowed.' } });
    expect(deniedNext).not.toHaveBeenCalled();

    const allowed = harness({ headers: { origin: 'https://preview.example', host: 'api.example' } });
    const allowedNext = vi.fn();
    enforceCors(allowed.request, allowed.response, allowedNext);
    expect(allowedNext).toHaveBeenCalledOnce();
    expect(allowed.result.headers).toMatchObject({
      'access-control-allow-origin': 'https://preview.example',
      'access-control-allow-credentials': 'true'
    });
  });

  it('permits an HTTPS request from the API host when a trusted proxy resolves the public protocol', () => {
    process.env.NODE_ENV = 'production';
    const sameOrigin = harness({
      headers: { origin: 'https://dashboard.example', host: 'dashboard.example' },
      secure: true
    });
    const next = vi.fn();

    enforceCors(sameOrigin.request, sameOrigin.response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(sameOrigin.result.statusCode).toBe(200);
    expect(sameOrigin.result.headers).toMatchObject({
      'access-control-allow-origin': 'https://dashboard.example',
      'access-control-allow-credentials': 'true'
    });
  });

  it('adds production response hardening headers', () => {
    process.env.NODE_ENV = 'production';
    const { request, response, result } = harness();
    const next = vi.fn();
    applySecurityHeaders(request, response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(result.headers).toMatchObject({
      'content-security-policy': expect.stringContaining("default-src 'self'"),
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY'
    });
  });

  it('returns a stable 429 after an identity exhausts its quota', () => {
    const limit = createRateLimit({ name: 'test', maximum: 2, windowMs: 60_000 });
    const next = vi.fn();
    const first = harness();
    const second = harness();
    const third = harness();
    limit(first.request, first.response, next);
    limit(second.request, second.response, next);
    limit(third.request, third.response, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(third.result).toMatchObject({
      statusCode: 429,
      payload: { ok: false, code: 'RATE_LIMITED' }
    });
    expect(third.result.headers).toHaveProperty('retry-after');
  });

  it('does not let rotating unverified credential headers bypass an address-only quota', () => {
    const limit = createRateLimit({ name: 'public-address', identity: 'address', maximum: 1, windowMs: 60_000 });
    const next = vi.fn();
    const first = harness({ headers: { authorization: 'bogus-authorization-one' } });
    const second = harness({ headers: { 'x-orbit-api-key': 'bogus-api-key-two' } });
    const third = harness({ headers: { 'x-orbit-auth-key': 'bogus-auth-key-three' } });

    limit(first.request, first.response, next);
    limit(second.request, second.response, next);
    limit(third.request, third.response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(second.result).toMatchObject({ statusCode: 429, payload: { code: 'RATE_LIMITED' } });
    expect(third.result).toMatchObject({ statusCode: 429, payload: { code: 'RATE_LIMITED' } });
  });
});
