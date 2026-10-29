import { createRequire } from 'node:module';
import { once } from 'node:events';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import clientRoutes from './client.js';
import auth from '../http/auth.js';
import connection from '../db/connection.js';

const require = createRequire(path.resolve(__dirname, '../../package.json'));
const express = require('express');
const servers = [];
const controllers = [];
const key = 'synthetic-notification-client';
const credential = (overrides = {}) => ({
  id: 'events-client', key, accountKey: 'club-one', scopes: ['client:write'],
  expiresAt: '2099-01-01T00:00:00.000Z', ...overrides
});

beforeEach(async () => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('ORBIT_FIRESTORE_MEMORY', 'true');
  vi.stubEnv('ORBIT_ALLOW_INSECURE_LOOPBACK_AUTH', 'false');
  vi.stubEnv('ORBIT_MACHINE_CREDENTIALS_JSON', JSON.stringify([credential()]));
  await connection.resetDatabaseForTests();
});

afterEach(async () => {
  controllers.splice(0).forEach((controller) => controller.abort());
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  })));
  vi.unstubAllEnvs();
});

async function start(dependencies = {}) {
  const app = express();
  clientRoutes.registerClientRoutes(app, { broadcast: vi.fn() }, dependencies);
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await once(server, 'listening');
  const baseUrl = 'http://127.0.0.1:' + server.address().port;
  /** @param {string} pathname @param {Record<string, string>} [headers] */
  const request = (pathname, headers = { 'x-orbit-api-key': key }) => {
    const controller = new AbortController();
    controllers.push(controller);
    return fetch(baseUrl + pathname, { headers, signal: controller.signal });
  };
  return request;
}

function watcher() {
  const streams = [];
  const watchStateHeader = vi.fn((accountKey, changed, failed) => {
    const unsubscribe = vi.fn();
    streams.push({ accountKey, changed, failed, unsubscribe });
    changed({ revision: 1 });
    return unsubscribe;
  });
  return { streams, watchStateHeader };
}

async function readUntil(reader, expected, initial = '') {
  let text = initial;
  while (!text.includes(expected)) {
    const item = await reader.read();
    if (item.done) throw new Error('Notification stream ended before the expected event.');
    text += new TextDecoder().decode(item.value);
  }
  return text;
}

async function readRest(reader, initial = '') {
  let text = initial;
  for (;;) {
    const item = await reader.read();
    if (item.done) return text;
    text += new TextDecoder().decode(item.value);
  }
}

describe('tenant-scoped management notification route', () => {
  it('preserves the existing client-auth boundary and never accepts query credentials', async () => {
    const fixture = watcher();
    const request = await start({ managementStateEvents: fixture });
    for (const pathname of ['/state/club-one', '/state/club-one/events', '/state/club-one/events?apiKey=' + key]) {
      const response = await request(pathname, {});
      expect(response.status, pathname).toBe(401);
    }
    expect(fixture.watchStateHeader).not.toHaveBeenCalled();
  });

  it('applies the same tenant guard to state reads and event streams before watching', async () => {
    const fixture = watcher();
    const request = await start({ managementStateEvents: fixture });
    for (const pathname of ['/state/club-two', '/state/club-two/events']) {
      const response = await request(pathname);
      expect(response.status, pathname).toBe(403);
      expect(await response.json()).toEqual({ ok: false, error: 'Authenticated tenant cannot read another venue account.' });
    }
    expect(fixture.watchStateHeader).not.toHaveBeenCalled();
  });

  it('returns explicit unavailability for the default memory datastore', async () => {
    const request = await start();
    const response = await request('/state/club-one/events');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: 'MANAGEMENT_STATE_EVENTS_UNAVAILABLE' });
  });

  it('streams only the authenticated tenant header revision and ends on credential revocation', async () => {
    const fixture = watcher();
    const request = await start({ managementStateEvents: fixture });
    const response = await request('/state/club-one/events');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body.getReader();
    const initial = await readUntil(reader, 'event: change\ndata: {"revision":1}\n\n');
    expect(initial).toBe('event: ready\ndata: {}\n\nevent: change\ndata: {"revision":1}\n\n');
    expect(fixture.streams[0].accountKey).toBe('club-one');
    vi.stubEnv('ORBIT_MACHINE_CREDENTIALS_JSON', '[]');
    fixture.streams[0].changed({ revision: 2, state: { private: 'never-streamed' } });
    expect(await readRest(reader, initial)).toBe(initial);
    expect(fixture.streams[0].unsubscribe).toHaveBeenCalledOnce();
  });

  it('closes without another notification if reauthorization changes the credential tenant', async () => {
    const fixture = watcher();
    const request = await start({ managementStateEvents: fixture });
    const response = await request('/state/club-one/events');
    const reader = response.body.getReader();
    const initial = await readUntil(reader, 'event: change\ndata: {"revision":1}\n\n');
    vi.stubEnv('ORBIT_MACHINE_CREDENTIALS_JSON', JSON.stringify([credential({ accountKey: 'club-two' })]));
    fixture.streams[0].changed({ revision: 2 });
    expect(await readRest(reader, initial)).toBe(initial);
    expect(fixture.streams[0].unsubscribe).toHaveBeenCalledOnce();
  });

  it('unsubscribes the real HTTP stream when the client disconnects', async () => {
    const fixture = watcher();
    const request = await start({ managementStateEvents: fixture });
    const response = await request('/state/club-one/events');
    const reader = response.body.getReader();
    await readUntil(reader, 'event: change\ndata: {"revision":1}\n\n');
    await reader.cancel();
    await vi.waitFor(() => expect(fixture.streams[0].unsubscribe).toHaveBeenCalledOnce(), { timeout: 1_000, interval: 10 });
  });

  it('ends at the configured machine-credential expiry without waiting for another header', async () => {
    vi.stubEnv('ORBIT_MACHINE_CREDENTIALS_JSON', JSON.stringify([credential({ expiresAt: new Date(Date.now() + 1_000).toISOString() })]));
    const fixture = watcher();
    const request = await start({ managementStateEvents: fixture });
    const response = await request('/state/club-one/events');
    const body = await response.text();
    expect(body).toContain('event: change\ndata: {"revision":1}\n\n');
    expect(body).not.toContain('heartbeat');
    expect(fixture.streams[0].unsubscribe).toHaveBeenCalledOnce();
  });

  it('reuses pilot-license authentication before every notification and closes on revocation', async () => {
    const authenticatePilotLicense = vi.fn(async () => ({ managed: true, active: true, license: {
      accountKey: 'club-one', expiresAt: '2099-01-01T00:00:00.000Z'
    } }));
    const fixture = watcher();
    const request = await start({
      managementStateEvents: fixture,
      requireClientAuth: auth.createRequireClientAuth({ authenticatePilotLicense })
    });
    const response = await request('/state/club-one/events', { 'x-orbit-api-key': 'TT-PILOT-1234567890ABCDEF12345678' });
    const reader = response.body.getReader();
    const initial = await readUntil(reader, 'event: change\ndata: {"revision":1}\n\n');
    expect(authenticatePilotLicense).toHaveBeenCalledTimes(2);
    authenticatePilotLicense.mockResolvedValue({ managed: true, active: false, license: { accountKey: 'club-one', expiresAt: '2099-01-01T00:00:00.000Z' } });
    fixture.streams[0].changed({ revision: 2 });
    expect(await readRest(reader, initial)).toBe(initial);
    expect(authenticatePilotLicense).toHaveBeenCalledTimes(3);
    expect(fixture.streams[0].unsubscribe).toHaveBeenCalledOnce();
  });

  it('rejects an inactive pilot license before opening a watch', async () => {
    const fixture = watcher();
    const request = await start({
      managementStateEvents: fixture,
      requireClientAuth: auth.createRequireClientAuth({ authenticatePilotLicense: async () => ({
        managed: true, active: false, license: { accountKey: 'club-one', expiresAt: '2099-01-01T00:00:00.000Z' }
      }) })
    });
    const response = await request('/state/club-one/events', { 'x-orbit-api-key': 'TT-PILOT-1234567890ABCDEF12345678' });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'PILOT_LICENSE_INACTIVE' });
    expect(fixture.watchStateHeader).not.toHaveBeenCalled();
  });

  it('ends at pilot-license expiry without a header change', async () => {
    const authenticatePilotLicense = vi.fn(async () => ({ managed: true, active: true, license: {
      accountKey: 'club-one', expiresAt: new Date(Date.now() + 1_000).toISOString()
    } }));
    const fixture = watcher();
    const request = await start({
      managementStateEvents: fixture,
      requireClientAuth: auth.createRequireClientAuth({ authenticatePilotLicense })
    });
    const response = await request('/state/club-one/events', { 'x-orbit-api-key': 'TT-PILOT-1234567890ABCDEF12345678' });
    expect(await response.text()).toContain('event: change\ndata: {"revision":1}\n\n');
    expect(fixture.streams[0].unsubscribe).toHaveBeenCalledOnce();
  });
});
