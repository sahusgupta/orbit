import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const host = '127.0.0.1';
const databasePath = path.join(os.tmpdir(), `orbit-api-routes-${process.pid}-${Date.now()}.sqlite3`);
const serverEntrypoint = path.join(__dirname, 'server.js');

/** @type {import('node:child_process').ChildProcessWithoutNullStreams | undefined} */
let childProcess;
let baseUrl = '';
let output = '';

function reservePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, host, () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Could not reserve an isolated API port.'));
        return;
      }
      probe.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForApi() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (childProcess?.exitCode !== null) {
      throw new Error(`Isolated API exited before becoming ready.\n${output}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // The child has not bound its localhost socket yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for the isolated API.\n${output}`);
}

function request(pathname, options = {}) {
  return fetch(`${baseUrl}${pathname}`, options);
}

function withClientKey(headers = {}) {
  return { 'x-orbit-api-key': 'local-characterization-key', ...headers };
}

beforeAll(async () => {
  const port = await reservePort();
  baseUrl = `http://${host}:${port}`;
  childProcess = spawn(process.execPath, [serverEntrypoint], {
    cwd: path.resolve(__dirname, '../../..'),
    env: {
      ...process.env,
      API_HOST: host,
      API_PORT: String(port),
      DATABASE_URL: `file:${databasePath}`,
      NODE_ENV: 'production',
      ORBIT_CLIENT_API_KEY: 'local-characterization-key',
      ORBIT_DASHBOARD_USER: 'character-admin',
      ORBIT_DASHBOARD_PASSWORD: 'local-dashboard-password',
      ORBIT_DASHBOARD_API_KEY: '',
      FIREBASE_SERVICE_ACCOUNT_JSON: '',
      FIREBASE_SERVICE_ACCOUNT_BASE64: '',
      GOOGLE_APPLICATION_CREDENTIALS: '',
      STRIPE_SECRET_KEY: '',
      STRIPE_WEBHOOK_SECRET: '',
      REVENUECAT_WEBHOOK_AUTH_TOKEN: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  childProcess.stdout.on('data', (chunk) => { output += chunk.toString(); });
  childProcess.stderr.on('data', (chunk) => { output += chunk.toString(); });
  await waitForApi();
}, 15_000);

afterAll(async () => {
  if (childProcess && childProcess.exitCode === null) {
    childProcess.kill();
    await Promise.race([
      once(childProcess, 'exit'),
      new Promise((resolve) => setTimeout(resolve, 5_000))
    ]);
    if (childProcess.exitCode === null) childProcess.kill('SIGKILL');
  }
  for (const suffix of ['', '-shm', '-wal']) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
});

describe('API route composition', () => {
  it('serves health and legal assets before client authentication', async () => {
    const health = await request('/health', { headers: { 'x-orbit-request-id': 'character-request' } });
    expect(health.status).toBe(200);
    expect(health.headers.get('x-orbit-request-id')).toBe('character-request');
    expect(await health.json()).toMatchObject({
      ok: true,
      service: 'orbit-api',
      environment: 'production',
      database: path.resolve(databasePath)
    });

    const privacy = await request('/privacy');
    expect(privacy.status).toBe(200);
    expect(privacy.headers.get('content-type')).toContain('text/html');
    expect(await privacy.text()).toContain('Orbit Privacy Policy');
  });

  it('preserves dashboard authentication and protected static delivery', async () => {
    const unauthorized = await request('/dashboard');
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get('www-authenticate')).toContain('Basic realm="Orbit Dashboard"');

    const credentials = Buffer.from('character-admin:local-dashboard-password').toString('base64');
    const dashboard = await request('/dashboard', {
      headers: { authorization: `Basic ${credentials}` }
    });
    expect(dashboard.status).toBe(200);
    expect(dashboard.headers.get('content-type')).toContain('text/html');
  });

  it('keeps Player and webhook routes ahead of client authentication without contacting services', async () => {
    const playerSnapshot = await request('/player/snapshot');
    expect(playerSnapshot.status).toBe(401);
    expect(await playerSnapshot.json()).toEqual({ ok: false, error: 'Firebase player sign-in is required.' });

    const membershipRequest = await request('/player/membership-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
    expect(membershipRequest.status).toBe(400);
    expect(await membershipRequest.json()).toEqual({
      ok: false,
      error: 'A club, request ID, and player identity are required.'
    });

    const revenueCat = await request('/webhooks/revenuecat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
    expect(revenueCat.status).toBe(401);
    expect(await revenueCat.json()).toEqual({ ok: false, error: 'Invalid RevenueCat webhook authorization.' });
  });

  it('preserves client auth, telemetry persistence, owner reads, and state misses', async () => {
    const unauthorized = await request('/clients/heartbeat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
    expect(unauthorized.status).toBe(401);

    const heartbeat = await request('/clients/heartbeat', {
      method: 'POST',
      headers: withClientKey({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        deviceId: 'route-device',
        venueId: 'Route Venue',
        venueName: 'Route Venue',
        deviceName: 'Route Workstation',
        appVersion: '2.0.0',
        platform: 'win32',
        environment: 'test'
      })
    });
    expect(heartbeat.status).toBe(202);
    expect(await heartbeat.json()).toMatchObject({
      ok: true,
      client: { deviceId: 'route-device', venueId: 'route-venue' }
    });

    const clients = await request('/clients', { headers: withClientKey() });
    expect(clients.status).toBe(200);
    expect(await clients.json()).toMatchObject({
      ok: true,
      clients: [expect.objectContaining({ deviceId: 'route-device' })]
    });

    const state = await request('/state/route-venue', { headers: withClientKey() });
    expect(state.status).toBe(404);
    expect(await state.json()).toEqual({ ok: false, error: 'Venue state not found.' });
  });

  it('preserves report storage and centralized JSON error responses', async () => {
    const report = await request('/analytical-reports', {
      method: 'POST',
      headers: withClientKey({ 'content-type': 'application/json' }),
      body: JSON.stringify({ account: { accountKey: 'Route Venue' }, summary: { tables: 2 } })
    });
    expect(report.status).toBe(201);
    expect(await report.json()).toMatchObject({
      ok: true,
      accountKey: 'route-venue',
      deliveryStatus: 'stored'
    });

    const invalidHeartbeat = await request('/clients/heartbeat', {
      method: 'POST',
      headers: withClientKey({
        'content-type': 'application/json',
        'x-orbit-request-id': 'invalid-heartbeat'
      }),
      body: '{}'
    });
    expect(invalidHeartbeat.status).toBe(400);
    expect(invalidHeartbeat.headers.get('x-orbit-request-id')).toBe('invalid-heartbeat');
    expect(await invalidHeartbeat.json()).toEqual({ ok: false, error: 'deviceId is required.' });
  });
});
