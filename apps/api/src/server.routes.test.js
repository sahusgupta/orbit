import path from 'path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const host = '127.0.0.1';
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
      NODE_ENV: 'production',
      ORBIT_CLIENT_API_KEY: 'local-characterization-key',
      ORBIT_MACHINE_CREDENTIALS_JSON: JSON.stringify([{
        id: 'route-client',
        key: 'local-characterization-key',
        accountKey: 'route-venue',
        scopes: ['client:write'],
        expiresAt: '2099-01-01T00:00:00.000Z'
      }]),
      ORBIT_OWNER_API_KEY: 'local-owner-key',
      ORBIT_FIRESTORE_MEMORY: 'true',
      ORBIT_DASHBOARD_USER: 'character-admin',
      ORBIT_DASHBOARD_PASSWORD: 'local-dashboard-password',
      ORBIT_DASHBOARD_SESSION_SECRET: 'local-dashboard-session-secret-at-least-32',
      ORBIT_PUBLIC_ORIGIN: 'https://orbit-public-preview.invalid',
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
});

describe('API route composition', () => {
  it('applies a rate-limit policy before every public, protected, and missing route', async () => {
    const probes = [
      ['/health'],
      ['/privacy'],
      ['/player/public/discovery'],
      ['/dashboard'],
      ['/clients'],
      ['/missing-orbit-route']
    ];

    for (const [pathname] of probes) {
      const response = await request(pathname);
      const maximum = Number(response.headers.get('x-ratelimit-limit'));
      const remaining = Number(response.headers.get('x-ratelimit-remaining'));
      expect(maximum, pathname).toBeGreaterThan(0);
      expect(remaining, pathname).toBeGreaterThanOrEqual(0);
      expect(remaining, pathname).toBeLessThan(maximum);
    }
  });

  it('serves health and legal assets before client authentication', async () => {
    const health = await request('/health', { headers: { 'x-orbit-request-id': 'character-request' } });
    expect(health.status).toBe(200);
    expect(health.headers.get('x-orbit-request-id')).toBe('character-request');
    const healthPayload = await health.json();
    expect(healthPayload).toMatchObject({ ok: true, service: 'orbit-api' });
    expect(healthPayload).not.toHaveProperty('database');
    expect(healthPayload).not.toHaveProperty('environment');
    expect(health.headers.get('server-timing')).toMatch(/^orbit-api;dur=/);

    const privacy = await request('/privacy', { headers: { 'accept-encoding': 'gzip' } });
    expect(privacy.status).toBe(200);
    expect(privacy.headers.get('content-type')).toContain('text/html');
    expect(privacy.headers.get('content-encoding')).toBe('gzip');
    expect(privacy.headers.get('x-robots-tag')).toBe('noindex, follow');
    expect(privacy.headers.get('link')).toBe('<https://orbit-public-preview.invalid/privacy.html>; rel="canonical"');
    const privacyHtml = await privacy.text();
    expect(privacyHtml).toContain('Orbit Privacy Policy');
    expect(privacyHtml).toContain('Google Firebase and Google Cloud');
    expect(privacyHtml).toContain('built with assistance from AI development tools, including OpenAI Codex');
    expect(privacyHtml).not.toContain('Orbit Technologies LLC');
  });

  it('uses an HttpOnly dashboard session without browser-stored or query-string keys', async () => {
    const dashboard = await request('/dashboard');
    expect(dashboard.status).toBe(200);
    expect(dashboard.headers.get('content-type')).toContain('text/html');
    expect(await dashboard.text()).toContain('placeholder="Dashboard password (not API key)"');

    const unauthorized = await request('/dashboard/data');
    expect(unauthorized.status).toBe(401);
    const signIn = await request('/dashboard/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'local-dashboard-password' })
    });
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers.get('set-cookie');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
    const data = await request('/dashboard/history/events?limit=1', { headers: { cookie } });
    expect(data.status).toBe(200);

    const managementAccounts = await request('/dashboard/management-accounts', { headers: { cookie } });
    expect(managementAccounts.status).toBe(200);
    expect(await managementAccounts.json()).toMatchObject({ managementAccounts: [] });
    const securityHistory = await request('/dashboard/history/security?limit=10', { headers: { cookie } });
    expect(securityHistory.status).toBe(200);
    expect(await securityHistory.json()).toMatchObject({ events: [], hasMore: false });

    const mutationWithoutCsrf = await request('/dashboard/licenses/missing-license/revoke', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: '{}'
    });
    expect(mutationWithoutCsrf.status).toBe(403);
    expect(await mutationWithoutCsrf.json()).toEqual({ ok: false, error: 'Dashboard request verification failed.' });

    const unknownAccount = await request('/dashboard/management-accounts/missing-account/recovery', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', 'x-orbit-csrf': '1' },
      body: JSON.stringify({ durationMinutes: 15 })
    });
    expect(unknownAccount.status).toBe(404);
    expect(await unknownAccount.json()).toMatchObject({ ok: false, code: 'MANAGEMENT_ACCOUNT_NOT_FOUND' });
  });

  it('keeps Player and webhook routes ahead of client authentication without contacting services', async () => {
    const publicDiscovery = await request('/player/public/discovery');
    expect(publicDiscovery.status).toBe(200);
    expect(await publicDiscovery.json()).toMatchObject({
      ok: true,
      clubs: [],
      tournaments: [],
      registrations: [],
      page: { count: 0, hasMore: false }
    });

    const missingPublicClub = await request('/player/public/clubs/missing-club');
    expect(missingPublicClub.status).toBe(404);
    expect(await missingPublicClub.json()).toEqual({ ok: false, error: 'Club not found.' });

    const playerSnapshot = await request('/player/snapshot');
    expect(playerSnapshot.status).toBe(401);
    expect(await playerSnapshot.json()).toEqual({ ok: false, error: 'Firebase player sign-in is required.' });

    const membershipRequest = await request('/player/membership-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
    expect(membershipRequest.status).toBe(401);
    expect(await membershipRequest.json()).toEqual({ ok: false, error: 'Firebase player sign-in is required.' });

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

    const unauthorizedRecovery = await request('/management/recovery/status');
    expect(unauthorizedRecovery.status).toBe(401);
    const machineCredentialRecovery = await request('/management/recovery/status', { headers: withClientKey() });
    expect(machineCredentialRecovery.status).toBe(403);
    expect(await machineCredentialRecovery.json()).toEqual({
      ok: false,
      error: 'A current pilot license key is required for account recovery.'
    });

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
      client: { deviceId: 'route-venue:route-device', venueId: 'route-venue', currentUser: null }
    });

    const clients = await request('/clients', { headers: { 'x-orbit-api-key': 'local-owner-key' } });
    expect(clients.status).toBe(200);
    expect(await clients.json()).toMatchObject({
      ok: true,
      clients: [expect.objectContaining({ deviceId: 'route-venue:route-device' })]
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
    expect(await invalidHeartbeat.json()).toMatchObject({ ok: false, error: 'Request validation failed.', code: 'INVALID_REQUEST' });
  });

  it('enforces revision and idempotency contracts on authoritative state writes', async () => {
    const state = {
      games: [],
      sessions: [],
      playerSessions: [],
      profiles: [],
      settings: {
        clubAccount: { clubName: 'Revision Route', email: 'revision@example.com' },
        pilotAccess: { licenseId: 'route-venue' },
        accountLogin: {
          username: 'manager@example.com',
          passwordSalt: 'route-salt',
          passwordHash: 'pbkdf2-sha256$210000$route-hash',
          createdAt: '2026-08-11T00:00:00.000Z'
        }
      }
    };
    const missingPrecondition = await request('/state', {
      method: 'POST',
      headers: withClientKey({ 'content-type': 'application/json' }),
      body: JSON.stringify({ state })
    });
    expect(missingPrecondition.status).toBe(428);

    const first = await request('/state', {
      method: 'POST',
      headers: withClientKey({ 'content-type': 'application/json', 'x-orbit-mutation-id': 'route-mutation-1' }),
      body: JSON.stringify({ state, expectedRevision: 0, mutationId: 'route-mutation-1' })
    });
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({
      ok: true,
      accountKey: 'route-venue',
      revision: 1,
      duplicate: false,
      publication: { status: 'pending' }
    });

    const duplicate = await request('/state', {
      method: 'POST',
      headers: withClientKey({ 'content-type': 'application/json', 'x-orbit-mutation-id': 'route-mutation-1' }),
      body: JSON.stringify({ state: { ...state, profiles: [{ id: 'ignored', name: 'Ignored' }] }, expectedRevision: 0, mutationId: 'route-mutation-1' })
    });
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ ok: true, revision: 1, duplicate: true });

    const stale = await request('/state', {
      method: 'POST',
      headers: withClientKey({ 'content-type': 'application/json', 'x-orbit-mutation-id': 'route-mutation-stale' }),
      body: JSON.stringify({ state, expectedRevision: 0, mutationId: 'route-mutation-stale' })
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      ok: false,
      code: 'STATE_REVISION_CONFLICT',
      expectedRevision: 0,
      currentRevision: 1
    });

    const loaded = await request('/state/route-venue', { headers: withClientKey() });
    expect(loaded.status).toBe(200);
    expect(await loaded.json()).toMatchObject({ revision: 1, state: { profiles: [] } });

    const signIn = await request('/dashboard/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'local-dashboard-password' })
    });
    const dashboardData = await request('/dashboard/management-accounts', { headers: { cookie: signIn.headers.get('set-cookie') } });
    const dashboardPayload = /** @type {{ managementAccounts: Array<Record<string, unknown>> }} */ (await dashboardData.json());
    expect(dashboardData.status, `${JSON.stringify(dashboardPayload)}\n${output}`).toBe(200);
    expect(dashboardPayload.managementAccounts).toEqual([
      expect.objectContaining({ accountKey: 'route-venue', username: 'manager@example.com', hasManagementLogin: true })
    ]);
    expect(JSON.stringify(dashboardPayload.managementAccounts)).not.toContain('route-salt');
    expect(JSON.stringify(dashboardPayload.managementAccounts)).not.toContain('route-hash');
  });
});
