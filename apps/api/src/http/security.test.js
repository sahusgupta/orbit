import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import security from './security.js';
const require = createRequire(__filename);
const connection = require('../db/connection.js');

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

beforeEach(async () => {
  vi.stubEnv('NODE_ENV', 'test');
  await connection.resetDatabaseForTests();
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.NODE_ENV;
  delete process.env.ORBIT_ALLOWED_ORIGINS;
  vi.unstubAllEnvs();
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

  it('returns a stable 429 after an identity exhausts its quota', async () => {
    const limit = createRateLimit({ name: 'test', maximum: 2, windowMs: 60_000 });
    const next = vi.fn();
    const first = harness();
    const second = harness();
    const third = harness();
    await limit(first.request, first.response, next);
    await limit(second.request, second.response, next);
    await limit(third.request, third.response, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(third.result).toMatchObject({
      statusCode: 429,
      payload: { ok: false, code: 'RATE_LIMITED' }
    });
    expect(third.result.headers).toHaveProperty('retry-after');
  });

  it('does not let rotating unverified credential headers bypass an address-only quota', async () => {
    const limit = createRateLimit({ name: 'public-address', identity: 'address', maximum: 1, windowMs: 60_000 });
    const next = vi.fn();
    const first = harness({ headers: { authorization: 'bogus-authorization-one' } });
    const second = harness({ headers: { 'x-orbit-api-key': 'bogus-api-key-two' } });
    const third = harness({ headers: { 'x-orbit-auth-key': 'bogus-auth-key-three' } });

    await limit(first.request, first.response, next);
    await limit(second.request, second.response, next);
    await limit(third.request, third.response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(second.result).toMatchObject({ statusCode: 429, payload: { code: 'RATE_LIMITED' } });
    expect(third.result).toMatchObject({ statusCode: 429, payload: { code: 'RATE_LIMITED' } });
  });

  it('uses hosted CORS and HTTPS protection even if NODE_ENV is development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('VERCEL', '1');
    const local = harness({ headers: { origin: 'http://localhost:5173', host: 'api.example' } });
    const next = vi.fn();
    enforceCors(local.request, local.response, next);
    expect(local.result.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
    applySecurityHeaders(local.request, local.response, next);
    expect(local.result.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
  });

  it('resets a quota at the expiration boundary and keeps named quotas independent', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-06T12:00:00Z'));
    const limit = createRateLimit({ name: 'expiry', maximum: 1, windowMs: 2_000 });
    const other = createRateLimit({ name: 'independent', maximum: 1, windowMs: 2_000 });
    const next = vi.fn();
    const first = harness();
    await limit(first.request, first.response, next);
    expect(first.result.headers['x-ratelimit-remaining']).toBe('0');
    vi.advanceTimersByTime(1_999);
    const denied = harness();
    await limit(denied.request, denied.response, next);
    expect(denied.result.statusCode).toBe(429);
    expect(denied.result.headers['retry-after']).toBe('1');
    const separate = harness();
    await other(separate.request, separate.response, next);
    expect(separate.result.statusCode).toBe(200);
    vi.advanceTimersByTime(1);
    const reset = harness();
    await limit(reset.request, reset.response, next);
    expect(reset.result.statusCode).toBe(200);
    expect(next).toHaveBeenCalledTimes(3);
  });

  it('shares one atomic quota between concurrent middleware instances and restarts', async () => {
    const options = { name: 'shared', maximum: 8, windowMs: 60_000 };
    const replicas = [createRateLimit(options), createRateLimit(options)];
    const next = vi.fn();
    const requests = Array.from({ length: 30 }, () => harness());
    await Promise.all(requests.map(({ request, response }, index) => replicas[index % 2](request, response, next)));
    expect(next).toHaveBeenCalledTimes(8);
    expect(requests.filter(({ result }) => result.statusCode === 429)).toHaveLength(22);
    const restarted = harness();
    await createRateLimit(options)(restarted.request, restarted.response, next);
    expect(restarted.result.statusCode).toBe(429);
    const store = await connection.getDatabase();
    const records = await store.queryCollection('orbitRateLimits');
    expect(records).toHaveLength(1);
    expect(records[0].data).toEqual({ count: 9, resetAt: expect.any(Number), expiresAt: expect.any(Date) });
    expect(records[0].data.expiresAt.getTime()).toBe(records[0].data.resetAt);
    expect(JSON.stringify(records)).not.toContain('203.0.113.1');
  });

  it('uses an address quota by default before credentials have been authenticated', async () => {
    const limit = createRateLimit({ name: 'unauthenticated', maximum: 1 });
    const next = vi.fn();
    const first = harness({ headers: { authorization: 'unverified-one' } });
    const second = harness({ headers: { authorization: 'unverified-two' } });
    await limit(first.request, first.response, next);
    await limit(second.request, second.response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(second.result.statusCode).toBe(429);
  });

  it('fails closed on shared-store failure without disclosing the cause', async () => {
    const limit = createRateLimit({ consume: async () => { throw new Error('restricted provider detail'); } });
    const next = vi.fn();
    const { request, response, result } = harness();
    await limit(request, response, next);
    expect(next).not.toHaveBeenCalled();
    expect(result.statusCode).toBe(503);
    expect(result.payload.code).toBe('RATE_LIMIT_UNAVAILABLE');
    expect(JSON.stringify(result)).not.toContain('restricted provider detail');
  });
});
