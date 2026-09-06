import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(__filename);
const { consumeRateLimit } = require('./rateLimits.js');
const { getDatabase, resetDatabaseForTests } = require('./connection.js');
const quota = { key: 'test:opaque-subject', maximum: 2, windowMs: 60_000 };

beforeEach(async () => {
  vi.stubEnv('NODE_ENV', 'test');
  await resetDatabaseForTests();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('durable rate-limit storage', () => {
  it('rejects memory storage in hosted production even with the local test flag', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('ORBIT_FIRESTORE_MEMORY', 'true');
    await expect(consumeRateLimit(quota, async () => ({ mode: 'memory' })))
      .rejects.toThrow('authoritative Firestore');
  });

  it('rejects corrupt counters rather than granting a fresh quota', async () => {
    const store = await getDatabase();
    await store.setDocument('orbitRateLimits/test:opaque-subject', { count: 'invalid', resetAt: Date.now() + 60_000 });
    await expect(consumeRateLimit(quota)).rejects.toThrow('Invalid durable rate-limit state');
    expect((await store.getDocument('orbitRateLimits/test:opaque-subject')).count).toBe('invalid');
  });

  it('samples expiration again when Firestore retries a transaction', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const writes = [];
    const store = {
      mode: 'firestore',
      async runTransaction(operation) {
        const transaction = {
          getDocument: async () => ({ count: 2, resetAt: 11_000 }),
          setDocument: async (_path, data) => { writes.push(data); }
        };
        await operation(transaction);
        vi.setSystemTime(11_000);
        return operation(transaction);
      }
    };
    const result = await consumeRateLimit(quota, async () => store);
    expect(result.count).toBe(1);
    expect(result.firstRejection).toBe(false);
    expect(result.resetAt).toBe(71_000);
    expect(writes.at(-1).expiresAt.getTime()).toBe(71_000);
  });

  it('does not extend expired-data retention on repeated denied requests', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    await consumeRateLimit(quota);
    await consumeRateLimit(quota);
    expect((await consumeRateLimit(quota)).firstRejection).toBe(true);
    vi.setSystemTime(20_000);
    expect((await consumeRateLimit(quota)).firstRejection).toBe(false);
    const store = await getDatabase();
    const record = await store.getDocument('orbitRateLimits/test:opaque-subject');
    expect(record.count).toBe(3);
    expect(record.expiresAt.getTime()).toBe(70_000);
  });
});
