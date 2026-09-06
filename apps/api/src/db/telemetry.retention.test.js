import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(__filename);

function telemetryHarness() {
  const writes = [];
  const database = { createDocument: async (path, data) => { writes.push({ path, data }); } };
  const module = { exports: {} };
  // Exercise real telemetry serialization with transport doubles. The real
  // connection correctly forbids an in-memory database when VERCEL is set.
  vm.runInNewContext(fs.readFileSync(require.resolve('./telemetry.js'), 'utf8'), {
    module, process, Date,
    require(name) {
      if (name === './connection') return { firestoreDocumentId: encodeURIComponent, getDatabase: async () => database };
      if (name === './clients') return { ...require('./clients.js'), upsertClient: async (payload) => payload };
      return require(name);
    }
  });
  return { telemetry: module.exports, writes };
}

afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('telemetry persistence privacy and expiration', () => {
  it('persists only fingerprints on hosted instances despite development stack opt-in', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('ORBIT_STORE_ERROR_STACKS', 'true');
    vi.stubEnv('ORBIT_LOG_HASH_SECRET', 'telemetry-log-hash-secret-with-at-least-32-characters');
    const { telemetry, writes } = telemetryHarness();
    await telemetry.recordClientError({
      message: 'Private operational detail',
      stack: 'Error: Private operational detail\n at requestHandler (private-module.js:17:1)'
    });
    expect(writes[0].data.stack).toMatch(/^fingerprint:[a-f0-9]{16}$/);
    expect(JSON.stringify(writes)).not.toContain('Private operational detail');
    expect(JSON.stringify(writes)).not.toContain('private-module.js');
  });

  it('expires all operational event categories 30 days after server receipt, ignoring client timestamps', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-06T12:00:00Z'));
    const { telemetry, writes } = telemetryHarness();
    const update = await telemetry.recordUpdateEvent({ event: 'update-available', occurredAt: '2099-01-01T00:00:00Z' });
    const usage = await telemetry.recordTelemetryEvent({ event: 'app-opened', occurredAt: '2099-01-01T00:00:00Z' });
    const error = await telemetry.recordClientError({ message: 'Example error', occurredAt: '2099-01-01T00:00:00Z' });
    expect(writes).toHaveLength(4);
    for (const { data } of writes) expect(data.expiresAt).toEqual(new Date('2026-10-06T12:00:00Z'));
    for (const response of [update, usage, error]) expect(response).not.toHaveProperty('expiresAt');
  });
});
