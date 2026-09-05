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
      ORBIT_LOG_HASH_SECRET: 'local-route-log-hash-secret-at-least-32-characters',
      ORBIT_PUBLIC_ORIGIN: 'https://orbit-public-preview.invalid',
      ORBIT_SELF_CHECK_IN_ORIGIN: 'https://self-check-in-route-test.invalid',
      ORBIT_SELF_CHECK_IN_SECRET: 'local-self-check-in-signing-secret-at-least-32-characters',
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
  it('does not expose standalone identity deletion in the conservative Player release', async () => {
    const response = await request('/player/identity', { method: 'DELETE' });
    expect(response.status).toBe(404);
  });

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
    expect(privacyHtml).not.toMatch(/OpenAI Codex|AI-development disclosure|AI-assisted development/);
    expect(privacyHtml).not.toContain('Orbit Technologies LLC');
  });

  it('serves the self-check-in page and external assets with private security headers', async () => {
    const page = await request('/check-in');
    const stylesheet = await request('/self-check-in.css');
    const script = await request('/self-check-in.js');

    for (const { pathname, response } of [
      { pathname: '/check-in', response: page },
      { pathname: '/self-check-in.css', response: stylesheet },
      { pathname: '/self-check-in.js', response: script }
    ]) {
      expect(response.status, pathname).toBe(200);
      expect(response.headers.get('cache-control'), pathname).toContain('no-store');
      expect(response.headers.get('x-robots-tag'), pathname).toBe('noindex, nofollow');
      const contentSecurityPolicy = response.headers.get('content-security-policy') || '';
      expect(contentSecurityPolicy, pathname).toContain("script-src 'self'");
      expect(contentSecurityPolicy, pathname).toContain("style-src 'self'");
      expect(contentSecurityPolicy, pathname).not.toContain("'unsafe-inline'");
      expect(contentSecurityPolicy, pathname).not.toContain("'unsafe-eval'");
    }

    expect(page.headers.get('content-type')).toContain('text/html');
    const pageHtml = await page.text();
    expect(pageHtml).toContain('<link rel="stylesheet" href="/self-check-in.css" />');
    expect(pageHtml).toContain('<script src="/self-check-in.js" defer></script>');
    expect(pageHtml).not.toMatch(/<style\b/i);
    expect(pageHtml).not.toMatch(/<script(?!\s+src=)[^>]*>/i);

    expect(stylesheet.headers.get('content-type')).toContain('text/css');
    expect(await stylesheet.text()).toContain('min-height: 48px');
    expect(script.headers.get('content-type')).toMatch(/javascript/);
    const scriptSource = await script.text();
    expect(pageHtml).toContain('Printed self-check-in is unavailable');
    expect(pageHtml).toContain('short-lived membership QR');
    expect(scriptSource).toContain("removeItem('orbit.selfCheckIn.capability')");
    expect(scriptSource).not.toContain('fetch(');
    expect(scriptSource).not.toContain('/player/check-in/');
    expect(scriptSource).not.toContain('innerHTML');
  });

  it('protects self-check-in issuance and rejects malformed lookup requests behind dedicated limits', async () => {
    const unauthorizedIssuer = await request('/management/self-check-in/qr', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
    expect(unauthorizedIssuer.status).toBe(401);
    expect(Number(unauthorizedIssuer.headers.get('x-ratelimit-limit'))).toBe(10);
    expect(unauthorizedIssuer.headers.get('cache-control')).toContain('no-store');
    expect(unauthorizedIssuer.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(Number(unauthorizedIssuer.headers.get('x-ratelimit-remaining'))).toBeGreaterThanOrEqual(0);

    const invalidContext = await request('/player/check-in/context', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-orbit-check-in-token': 'invalid-token-that-is-long-enough'
      },
      body: '{}'
    });
    expect(invalidContext.status).toBe(410);
    expect(await invalidContext.json()).toMatchObject({ ok: false, code: 'PUBLIC_PLAYER_CHECK_IN_DISABLED' });
    expect(Number(invalidContext.headers.get('x-ratelimit-limit'))).toBe(120);
    expect(invalidContext.headers.get('cache-control')).toContain('no-store');
    expect(invalidContext.headers.get('x-robots-tag')).toBe('noindex, nofollow');

    const nonJsonLookup = await request('/player/check-in/lookup', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'Alex Player'
    });
    expect(nonJsonLookup.status).toBe(410);
    expect(await nonJsonLookup.json()).toMatchObject({ ok: false, code: 'PUBLIC_PLAYER_CHECK_IN_DISABLED' });
    expect(Number(nonJsonLookup.headers.get('x-ratelimit-limit'))).toBe(120);
    expect(Number(nonJsonLookup.headers.get('x-ratelimit-remaining'))).toBeGreaterThanOrEqual(0);
    expect(nonJsonLookup.headers.get('cache-control')).toContain('no-store');
    expect(nonJsonLookup.headers.get('x-robots-tag')).toBe('noindex, nofollow');

    const malformedLookup = await request('/player/check-in/lookup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"name":'
    });
    expect(malformedLookup.status).toBe(400);
    expect(await malformedLookup.json()).toMatchObject({
      ok: false, error: 'Request validation failed.', code: 'INVALID_REQUEST'
    });
    expect(Number(malformedLookup.headers.get('x-ratelimit-limit'))).toBe(120);
    expect(Number(malformedLookup.headers.get('x-ratelimit-remaining'))).toBeGreaterThanOrEqual(0);
    expect(malformedLookup.headers.get('cache-control')).toContain('no-store');
    expect(malformedLookup.headers.get('x-robots-tag')).toBe('noindex, nofollow');

    const impersonationLookup = await request('/player/check-in/lookup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Another Player' })
    });
    expect(impersonationLookup.status).toBe(410);
    expect(await impersonationLookup.json()).toMatchObject({
      ok: false, code: 'PUBLIC_PLAYER_CHECK_IN_DISABLED'
    });
    const impersonationSeat = await request('/player/check-in/seat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Another Player', tableId: 'table-one' })
    });
    expect(impersonationSeat.status).toBe(410);
    expect(await impersonationSeat.json()).toMatchObject({
      ok: false, code: 'PUBLIC_PLAYER_CHECK_IN_DISABLED'
    });

    const authenticatedIssuer = await request('/management/self-check-in/qr', {
      method: 'POST',
      headers: withClientKey({ 'content-type': 'application/json' }),
      body: JSON.stringify({ mutationId: 'opaque-kit-request' })
    });
    expect(authenticatedIssuer.status).toBe(410);
    expect(await authenticatedIssuer.json()).toMatchObject({
      ok: false, code: 'PUBLIC_SELF_CHECK_IN_KIT_DISABLED'
    });

    let limitedIssuer;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      limitedIssuer = await request('/management/self-check-in/qr', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      });
    }
    expect(limitedIssuer.status).toBe(429);
    expect(limitedIssuer.headers.get('cache-control')).toContain('no-store');
    expect(limitedIssuer.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it('applies the credential-scoped membership QR redemption limit before authentication', async () => {
    const response = await request('/management/membership-qr/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-orbit-api-key': 'unrecognized-tenant-key' },
      body: JSON.stringify({ token: `omq1_${'A'.repeat(43)}`, mutationId: 'opaque-scan-request' })
    });
    expect(response.status).toBe(401);
    expect(Number(response.headers.get('x-ratelimit-limit'))).toBe(30);
    expect(Number(response.headers.get('x-ratelimit-remaining'))).toBe(29);
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
      interests: [],
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
  }, 15_000);

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
    const heartbeatPayload = /** @type {any} */ (await heartbeat.json());
    expect(heartbeatPayload).toMatchObject({
      ok: true,
      client: {
        deviceId: expect.stringMatching(/^protected:[a-f0-9]{16}$/),
        venueId: 'route-venue',
        currentUser: null
      }
    });

    const clients = await request('/clients', { headers: { 'x-orbit-api-key': 'local-owner-key' } });
    expect(clients.status).toBe(200);
    expect(await clients.json()).toMatchObject({
      ok: true,
      clients: [expect.objectContaining({ deviceId: heartbeatPayload.client.deviceId })]
    });

    const state = await request('/state/route-venue', { headers: withClientKey() });
    expect(state.status).toBe(404);
    expect(await state.json()).toEqual({ ok: false, error: 'Venue state not found.' });
  });

  it('never returns raw credential or identity/payment material from production error telemetry', async () => {
    const fixtures = [
      'route-private-bearer-token',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJyb3V0ZSJ9.signature12345',
      'sk_live_routeProviderSecret123',
      'RAW-ROUTE-PDF417',
      'ROUTE-DOCUMENT-123',
      '4111 1111 1111 1111',
      'route-private-key-body',
      '@\nANSI 636026080102DL00410288ZA03290015DLDAQROUTE123',
      'q9Wm3Kp8Vx2Lt7Rf5Hs1Jd6Nc4By0Ua9Ei3Og7Pz2Qw8Mn5'
    ];
    const errorResponse = await request('/clients/error', {
      method: 'POST',
      headers: withClientKey({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        deviceId: 'sensitive-route-device',
        deviceName: `Bearer ${fixtures[0]}`,
        appVersion: fixtures[2],
        platform: fixtures[1],
        environment: `barcode=${fixtures[3]}`,
        updateStatus: `documentNumber=${fixtures[4]}`,
        updateEvent: `cardNumber=${fixtures[5]}`,
        source: `paymentToken=${fixtures[2]}`,
        route: `barcode=${fixtures[3]}`,
        message: `Bearer ${fixtures[0]}; ${fixtures[1]}; ${fixtures[2]}; barcode=${fixtures[3]}; documentNumber=${fixtures[4]}; ${fixtures[5]}`,
        stack: `-----BEGIN PRIVATE KEY-----\n${fixtures[6]}\n-----END PRIVATE KEY-----`,
        details: {
          rawBarcode: fixtures[3],
          note: fixtures[7],
          opaqueValue: fixtures[8],
          paymentCard: fixtures[5]
        }
      })
    });
    expect(errorResponse.status).toBe(202);
    const recorded = /** @type {any} */ (await errorResponse.json());
    expect(recorded).toMatchObject({
      ok: true,
      error: {
        message: expect.stringMatching(/^Client error recorded\. reference:[a-f0-9]{16}$/),
        errorRef: expect.stringMatching(/^[a-f0-9]{16}$/),
        stack: expect.stringMatching(/^fingerprint:[a-f0-9]{16}$/)
      }
    });

    const historyResponse = await request(
      '/telemetry/errors?deviceId=route-venue%3Asensitive-route-device',
      { headers: { 'x-orbit-api-key': 'local-owner-key' } }
    );
    expect(historyResponse.status).toBe(200);
    const history = /** @type {any} */ (await historyResponse.json());
    expect(history).toMatchObject({ ok: true, errors: [expect.objectContaining({ errorRef: recorded.error.errorRef })] });

    const serialized = JSON.stringify({ recorded, history, output });
    for (const fixture of fixtures) expect(serialized).not.toContain(fixture);
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
