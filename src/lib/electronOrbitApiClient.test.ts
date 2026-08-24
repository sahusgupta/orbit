import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);

type ApiResponse = { payload: Record<string, unknown> | null; responsePreview: string };
type OrbitApiClient = {
  buildClientTelemetryPayload: (overrides?: Record<string, unknown>) => Record<string, unknown>;
  getApiConfig: () => { apiUrl: string; apiKey: string };
  getClientUpdateState: () => { updateStatus: string; updateEvent: string };
  getManagementRecoveryStatusApi: (access: unknown) => Promise<Record<string, unknown>>;
  completeManagementRecoveryApi: (access: unknown, password: string) => Promise<Record<string, unknown>>;
  createSelfCheckInQrKitApi: (access: unknown) => Promise<Record<string, unknown>>;
  getOrCreateDeviceId: () => string;
  loadStateApiFirst: (accountKey?: string, access?: unknown) => Promise<unknown>;
  loadStateFromApi: (accountKey?: string, access?: unknown) => Promise<unknown>;
  peekStateFromApi: (accountKey?: string, access?: unknown) => Promise<unknown>;
  requestOrbitApi: (
    pathname: string,
    options?: { authKey?: string; method?: string; headers?: Record<string, string>; body?: unknown; timeoutMs?: number }
  ) => Promise<Record<string, unknown> | null>;
  saveStateApiFirst: (state: unknown) => Promise<unknown>;
  saveStateToApi: (state: unknown) => Promise<unknown>;
  sendClientError: (error: unknown, source?: string, details?: Record<string, unknown>) => void;
  sendClientEvent: (event: string, category?: string, details?: Record<string, unknown>, overrides?: Record<string, unknown>) => void;
  sendClientHeartbeat: (overrides?: Record<string, unknown>) => void;
  sendClientUpdateEvent: (event: string, status: string, details?: Record<string, unknown>) => void;
  startClientTelemetry: () => void;
  stopClientTelemetry: () => void;
  submitAnalyticalReportApiFirst: (report: unknown) => Promise<unknown>;
  submitAnalyticalReportToApi: (report: unknown) => Promise<unknown>;
  validatePilotAccessApi: (access: unknown) => Promise<Record<string, unknown>>;
};

type OrbitApiModule = {
  createOrbitApiClient: (dependencies: Record<string, unknown>) => OrbitApiClient;
  readApiResponse: (response: { text: () => Promise<string> }) => Promise<ApiResponse>;
};

const { createOrbitApiClient, readApiResponse }: OrbitApiModule = require('../../electron/orbitApiClient.cjs');

function response(text: string, options: { ok?: boolean; status?: number } = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    text: vi.fn().mockResolvedValue(text)
  };
}

function baseDependencies(overrides: Record<string, unknown> = {}) {
  return {
    app: { getVersion: () => '1.2.3', getLocale: () => 'en-US', isPackaged: true },
    buildPlayerClubSnapshot: () => ({ games: [] }),
    clearIntervalImpl: vi.fn(),
    clearTimeoutImpl: vi.fn(),
    environment: {
      NODE_ENV: 'test',
      ORBIT_API_URL: 'http://127.0.0.1:4310',
      ORBIT_CLIENT_API_KEY: 'configured-key'
    },
    fetchImpl: vi.fn().mockResolvedValue(response('{"ok":true}')),
    fileSystem: {
      existsSync: vi.fn().mockReturnValue(false),
      readFileSync: vi.fn(),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn()
    },
    getAppStartedAt: () => '2026-08-07T11:59:00.000Z',
    hostname: () => 'desk-one',
    isDev: false,
    isFirebaseConfigured: () => false,
    loadStateWithFirebaseFallback: vi.fn().mockResolvedValue(null),
    migrateLocalAccountToPilotAccess: vi.fn().mockReturnValue(null),
    now: () => new Date('2026-08-07T12:00:00.000Z'),
    nowMs: () => 1000,
    platform: 'win32',
    randomUUID: vi.fn().mockReturnValue('request-001'),
    readLocalDatabase: () => ({
      state: {
        settings: {
          pilotAccess: { licenseId: 'club-one', authorizationCode: 'pilot-code' },
          clubAccount: { clubName: 'Orbit Room' }
        }
      }
    }),
    saveStateEverywhere: vi.fn().mockResolvedValue({ ok: true, engine: 'file-cache' }),
    setIntervalImpl: vi.fn().mockReturnValue(71),
    setTimeoutImpl: vi.fn().mockReturnValue(41),
    storeAnalyticalReport: vi.fn().mockResolvedValue({ ok: true, reportId: 'local-1' }),
    userDataPath: () => 'C:\\isolated',
    writeLocalDatabase: vi.fn(),
    writeOrbitApiLog: vi.fn(),
    writeStateToFirebase: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

function requestBodies(fetch: ReturnType<typeof vi.fn>) {
  return fetch.mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>);
}

describe('Electron Orbit API transport', () => {
  it('parses JSON and bounds normalized non-JSON response previews', async () => {
    await expect(readApiResponse(response('{"ok":true}'))).resolves.toEqual({
      payload: { ok: true },
      responsePreview: ''
    });
    await expect(readApiResponse(response(''))).resolves.toEqual({ payload: null, responsePreview: '' });

    const invalid = `  gateway\n  unavailable ${'x'.repeat(400)}`;
    const result = await readApiResponse(response(invalid));
    expect(result.payload).toBeNull();
    expect(result.responsePreview).toHaveLength(300);
    expect(result.responsePreview).toBe(` gateway unavailable ${'x'.repeat(279)}`);
  });

  it('normalizes the configured URL and prefers the environment API key over the local authorization code', () => {
    const environmentClient = createOrbitApiClient(baseDependencies({
      environment: { ORBIT_API_URL: 'http://127.0.0.1:4310///', ORBIT_CLIENT_API_KEY: 'environment-key' },
      readLocalDatabase: vi.fn(() => {
        throw new Error('local state must not be read');
      })
    }));
    expect(environmentClient.getApiConfig()).toEqual({ apiUrl: 'http://127.0.0.1:4310', apiKey: 'environment-key' });

    const fallbackClient = createOrbitApiClient(baseDependencies({ environment: {} }));
    expect(fallbackClient.getApiConfig()).toEqual({ apiUrl: 'https://orbitapp-one.vercel.app', apiKey: 'pilot-code' });
  });

  it('builds authenticated JSON requests with request IDs, caller headers, bodies, and timeout cleanup', async () => {
    const fetch = vi.fn().mockResolvedValue(response('{"ok":true,"revision":7}'));
    const setTimeoutImpl = vi.fn().mockReturnValue(41);
    const clearTimeoutImpl = vi.fn();
    const writeOrbitApiLog = vi.fn();
    const client = createOrbitApiClient(baseDependencies({ fetchImpl: fetch, setTimeoutImpl, clearTimeoutImpl, writeOrbitApiLog }));

    await expect(client.requestOrbitApi('/state', {
      method: 'POST',
      authKey: 'access-key',
      headers: { 'x-orbit-api-key': 'caller-key', 'x-extra': 'value' },
      body: { state: { games: [] } },
      timeoutMs: 987
    })).resolves.toEqual({ ok: true, revision: 7 });

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:4310/state');
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-orbit-api-key': 'caller-key',
        'x-orbit-auth-key': 'access-key',
        'x-orbit-request-id': 'request-001',
        'x-extra': 'value'
      },
      body: '{"state":{"games":[]}}'
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(setTimeoutImpl).toHaveBeenCalledWith(expect.any(Function), 987);
    expect(clearTimeoutImpl).toHaveBeenCalledWith(41);
    expect(writeOrbitApiLog).not.toHaveBeenCalled();
  });

  it('returns null and projects timeout failures for mutations while GET failures remain log-silent', async () => {
    const writeOrbitApiLog = vi.fn();
    const setTimeoutImpl = vi.fn((callback: () => void) => {
      callback();
      return 51;
    });
    const clearTimeoutImpl = vi.fn();
    const fetch = vi.fn().mockRejectedValue(new Error('socket closed'));
    const client = createOrbitApiClient(baseDependencies({ fetchImpl: fetch, setTimeoutImpl, clearTimeoutImpl, writeOrbitApiLog }));

    await expect(client.requestOrbitApi('/state', { method: 'POST' })).resolves.toBeNull();
    expect(writeOrbitApiLog).toHaveBeenCalledWith('error', 'sync-update-failed', expect.objectContaining({
      requestId: 'request-001',
      method: 'POST',
      pathname: '/state',
      timedOut: true,
      errorName: 'Error',
      errorMessage: 'socket closed'
    }));

    writeOrbitApiLog.mockClear();
    await expect(client.requestOrbitApi('/state/latest')).resolves.toBeNull();
    expect(writeOrbitApiLog).not.toHaveBeenCalled();
    expect(clearTimeoutImpl).toHaveBeenCalledTimes(2);
  });

  it('projects pilot-license responses and uses both compatibility auth headers', async () => {
    const fetch = vi.fn().mockResolvedValue(response('{"ok":true,"managed":false,"active":true,"license":{"id":"license-1"}}'));
    const client = createOrbitApiClient(baseDependencies({ fetchImpl: fetch }));

    await expect(client.validatePilotAccessApi({ licenseId: 'club-one', authorizationCode: 'pilot-code' })).resolves.toEqual({
      ok: true,
      managed: true,
      active: true,
      license: { id: 'license-1' },
      error: ''
    });
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:4310/license/status?accountKey=club-one', expect.objectContaining({
      headers: {
        'x-orbit-api-key': 'pilot-code',
        'x-orbit-auth-key': 'pilot-code',
        'x-orbit-request-id': 'request-001'
      }
    }));
  });

  it('requests a tenant-authenticated self-check-in kit without exposing it to renderer logs', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(JSON.stringify({
        ok: true,
        accountKey: 'club-one',
        clubName: 'Orbit Room',
        checkInUrl: 'https://check-in.example.test/check-in#token=signed-capability',
        expiresAt: '2027-08-24T12:00:00.000Z',
        revision: 8,
        selfCheckIn: { capabilityGeneration: 'generation-one', generatedAt: '2026-08-24T12:00:00.000Z' },
        rotatedPreviousCode: true
      })))
      .mockResolvedValueOnce(response('{"ok":true,"accountKey":"club-one","revision":9}'));
    const writeOrbitApiLog = vi.fn();
    const client = createOrbitApiClient(baseDependencies({ fetchImpl: fetch, writeOrbitApiLog }));

    await expect(client.createSelfCheckInQrKitApi({ licenseId: 'club-one', authorizationCode: 'pilot-code' })).resolves.toEqual({
      ok: true,
      clubName: 'Orbit Room',
      checkInUrl: 'https://check-in.example.test/check-in#token=signed-capability',
      expiresAt: '2027-08-24T12:00:00.000Z',
      selfCheckIn: { capabilityGeneration: 'generation-one', generatedAt: '2026-08-24T12:00:00.000Z' },
      rotatedPreviousCode: true
    });
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4310/management/self-check-in/qr',
      expect.objectContaining({
        method: 'POST',
        body: '{"mutationId":"kit:request-001"}',
        headers: expect.objectContaining({ 'x-orbit-api-key': 'pilot-code' })
      })
    );
    await client.saveStateToApi({
      games: [],
      sessions: [],
      playerSessions: [],
      settings: { pilotAccess: { licenseId: 'club-one', authorizationCode: 'pilot-code' } }
    });
    expect(JSON.parse(String((fetch.mock.calls[1][1] as RequestInit).body))).toMatchObject({ expectedRevision: 0 });
    expect(writeOrbitApiLog).not.toHaveBeenCalled();
  });

  it('does not advance a writable revision from a partial QR issuance response', async () => {
    const staleState = {
      games: [],
      sessions: [],
      playerSessions: [],
      settings: { pilotAccess: { licenseId: 'club-one', authorizationCode: 'pilot-code' } }
    };
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(JSON.stringify({
        accountKey: 'club-one',
        revision: 7,
        state: staleState
      })))
      .mockResolvedValueOnce(response(JSON.stringify({
        ok: true,
        accountKey: 'club-one',
        clubName: 'Orbit Room',
        checkInUrl: 'https://check-in.example.test/check-in#token=signed-capability',
        expiresAt: '2027-08-24T12:00:00.000Z',
        revision: 8,
        selfCheckIn: { capabilityGeneration: 'generation-one', generatedAt: '2026-08-24T12:00:00.000Z' }
      })))
      .mockResolvedValueOnce(response(JSON.stringify({
        ok: false,
        code: 'STATE_REVISION_CONFLICT',
        error: 'Venue state changed elsewhere.',
        expectedRevision: 7,
        currentRevision: 8
      }), { ok: false, status: 409 }));
    const client = createOrbitApiClient(baseDependencies({ fetchImpl: fetch }));

    await client.loadStateFromApi('club-one', { authorizationCode: 'pilot-code' });
    await client.createSelfCheckInQrKitApi({ licenseId: 'club-one', authorizationCode: 'pilot-code' });
    await expect(client.saveStateToApi(staleState)).resolves.toMatchObject({
      conflict: true,
      expectedRevision: 7,
      currentRevision: 8
    });

    expect(JSON.parse(String((fetch.mock.calls[2][1] as RequestInit).body))).toMatchObject({ expectedRevision: 7 });
  });

  it('does not advance a writable revision when an authoritative preflight is only peeked', async () => {
    const staleState = {
      games: [],
      sessions: [],
      playerSessions: [],
      settings: { pilotAccess: { licenseId: 'club-one', authorizationCode: 'pilot-code' } }
    };
    const writeLocalDatabase = vi.fn();
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(JSON.stringify({
        accountKey: 'club-one',
        revision: 8,
        state: staleState
      })))
      .mockResolvedValueOnce(response(JSON.stringify({
        ok: false,
        code: 'STATE_REVISION_CONFLICT',
        error: 'Venue state changed elsewhere.',
        expectedRevision: 0,
        currentRevision: 8
      }), { ok: false, status: 409 }));
    const client = createOrbitApiClient(baseDependencies({ fetchImpl: fetch, writeLocalDatabase }));

    await expect(client.peekStateFromApi('club-one', { authorizationCode: 'pilot-code' })).resolves.toMatchObject({
      authoritative: true,
      revision: 8
    });
    await expect(client.saveStateToApi(staleState)).resolves.toMatchObject({
      conflict: true,
      expectedRevision: 0,
      currentRevision: 8
    });

    expect(writeLocalDatabase).not.toHaveBeenCalled();
    expect(JSON.parse(String((fetch.mock.calls[1][1] as RequestInit).body))).toMatchObject({ expectedRevision: 0 });
  });

  it('retries an ambiguous QR issuer transport with the same idempotency key', async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(response(JSON.stringify({
        ok: true,
        accountKey: 'club-one',
        clubName: 'Orbit Room',
        checkInUrl: 'https://check-in.example.test/check-in#token=reissued-capability',
        expiresAt: '2027-08-24T12:00:00.000Z',
        revision: 8,
        selfCheckIn: { capabilityGeneration: 'same-generation', generatedAt: '2026-08-24T12:00:00.000Z' },
        rotatedPreviousCode: false
      })));
    const client = createOrbitApiClient(baseDependencies({ fetchImpl: fetch }));

    await expect(client.createSelfCheckInQrKitApi({
      licenseId: 'club-one',
      authorizationCode: 'pilot-code'
    })).resolves.toMatchObject({ ok: true, selfCheckIn: { capabilityGeneration: 'same-generation' } });

    expect(fetch).toHaveBeenCalledTimes(2);
    const requestBodies = fetch.mock.calls.map((call) => String((call[1] as RequestInit).body));
    expect(requestBodies).toEqual([
      '{"mutationId":"kit:request-001"}',
      '{"mutationId":"kit:request-001"}'
    ]);
  });

  it('mirrors successful authoritative reads into the encrypted local cache', async () => {
    const writeLocalDatabase = vi.fn();
    const fetch = vi.fn().mockResolvedValue(response('{"accountKey":"club-one","revision":7,"state":{"games":[]}}'));
    const client = createOrbitApiClient(baseDependencies({ fetchImpl: fetch, writeLocalDatabase }));

    await client.loadStateFromApi('club-one', { authorizationCode: 'pilot-code' });
    await client.loadStateFromApi('club-one', { authorizationCode: 'pilot-code' });

    expect(writeLocalDatabase).toHaveBeenCalledOnce();
    expect(writeLocalDatabase).toHaveBeenCalledWith({ games: [] });
  });

  it('preserves state/report endpoint options and result projections', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response('{"schemaVersion":4,"savedAt":"2026-08-07T12:00:00.000Z","accountKey":"club-one","revision":7,"publication":{"status":"published"},"state":{"games":[]}}'))
      .mockResolvedValueOnce(response('{"ok":true,"accountKey":"club-one","savedAt":"2026-08-07T12:01:00.000Z","revision":8,"publication":{"status":"pending"}}'))
      .mockResolvedValueOnce(response('{"ok":true,"reportId":"report-1"}'))
      .mockRejectedValueOnce(new Error('health unavailable'));
    const client = createOrbitApiClient(baseDependencies({ fetchImpl: fetch }));
    const state = { games: [] };
    const report = { account: { accountKey: 'club-one' } };

    await expect(client.loadStateFromApi(' CLUB-ONE ', { authorizationCode: 'pilot-code' })).resolves.toEqual({
      schemaVersion: 4,
      savedAt: '2026-08-07T12:00:00.000Z',
      state,
      accountKey: 'club-one',
      source: 'api',
      authoritative: true,
      revision: 7,
      publication: { status: 'published' }
    });
    await expect(client.saveStateToApi(state)).resolves.toEqual({
      ok: true,
      path: 'orbit-api',
      engine: 'api',
      accountKey: 'club-one',
      savedAt: '2026-08-07T12:01:00.000Z',
      revision: 8,
      duplicate: false,
      publication: { status: 'pending' },
      authoritative: true
    });
    await expect(client.submitAnalyticalReportToApi(report)).resolves.toEqual({
      ok: true,
      reportId: 'report-1',
      backend: { running: true, host: 'api', port: 0, reportCount: 0, mode: 'api' }
    });

    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      'http://127.0.0.1:4310/state/club-one',
      'http://127.0.0.1:4310/state',
      'http://127.0.0.1:4310/analytical-reports',
      'http://127.0.0.1:4310/health'
    ]);
    expect((fetch.mock.calls[0][1] as RequestInit).headers).toMatchObject({ 'x-orbit-auth-key': 'pilot-code' });
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String((fetch.mock.calls[1][1] as RequestInit).body))).toMatchObject({ state, expectedRevision: 0 });
    expect(fetch.mock.calls[2][1]).toMatchObject({ method: 'POST', body: JSON.stringify(report) });
  });

  it('does not advance the writable revision after a conflict until authoritative state is reloaded', async () => {
    const conflict = response(JSON.stringify({
      ok: false,
      code: 'STATE_REVISION_CONFLICT',
      error: 'Venue state changed elsewhere.',
      expectedRevision: 0,
      currentRevision: 8
    }), { ok: false, status: 409 });
    const state = {
      games: [],
      sessions: [],
      playerSessions: [],
      settings: { pilotAccess: { licenseId: 'club-one', authorizationCode: 'pilot-code' } }
    };
    const fetch = vi.fn()
      .mockResolvedValueOnce(conflict)
      .mockResolvedValueOnce(conflict)
      .mockResolvedValueOnce(response(JSON.stringify({ accountKey: 'club-one', revision: 8, state })))
      .mockResolvedValueOnce(response('{"ok":true,"accountKey":"club-one","revision":9}'));
    const client = createOrbitApiClient(baseDependencies({ fetchImpl: fetch }));

    await expect(client.saveStateToApi(state)).resolves.toMatchObject({ conflict: true, expectedRevision: 0, currentRevision: 8 });
    await expect(client.saveStateToApi(state)).resolves.toMatchObject({ conflict: true, expectedRevision: 0, currentRevision: 8 });
    expect(JSON.parse(String((fetch.mock.calls[0][1] as RequestInit).body))).toMatchObject({ expectedRevision: 0 });
    expect(JSON.parse(String((fetch.mock.calls[1][1] as RequestInit).body))).toMatchObject({ expectedRevision: 0 });

    await client.loadStateFromApi('club-one', { authorizationCode: 'pilot-code' });
    await client.saveStateToApi(state);
    expect(JSON.parse(String((fetch.mock.calls[3][1] as RequestInit).body))).toMatchObject({ expectedRevision: 8 });
  });
});

describe('Electron API-first orchestration', () => {
  it('returns an API load immediately or seeds a missing API venue from the unchanged fallback record', async () => {
    const fallbackRecord = { schemaVersion: 4, savedAt: 'fallback-time', state: { id: 'fallback' } };
    const loadStateWithFirebaseFallback = vi.fn().mockResolvedValue(fallbackRecord);
    const fetch = vi.fn()
      .mockResolvedValueOnce(response('{"schemaVersion":4,"state":{"id":"remote"}}'))
      .mockResolvedValueOnce(response('{"ok":false}'))
      .mockResolvedValueOnce(response('{"ok":true,"accountKey":"club-one"}'));
    const client = createOrbitApiClient(baseDependencies({ fetchImpl: fetch, loadStateWithFirebaseFallback }));

    await expect(client.loadStateApiFirst('club-one', { authorizationCode: 'pilot-code' })).resolves.toMatchObject({
      source: 'api',
      state: { id: 'remote' }
    });
    expect(loadStateWithFirebaseFallback).not.toHaveBeenCalled();

    await expect(client.loadStateApiFirst('club-one', { authorizationCode: 'pilot-code' })).resolves.toEqual({
      ...fallbackRecord,
      accountKey: 'club-one',
      authoritative: true,
      publication: { status: 'pending' },
      revision: 1,
      source: 'api-cache-migration'
    });
    expect(loadStateWithFirebaseFallback).toHaveBeenCalledWith('club-one');
    expect(fetch).toHaveBeenLastCalledWith('http://127.0.0.1:4310/state', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(String((fetch.mock.calls.at(-1)?.[1] as RequestInit).body))).toMatchObject({ state: fallbackRecord.state, expectedRevision: 0 });
  });

  it('checks and completes a tenant-bound recovery override without putting the password in logs', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response('{"ok":true,"active":true,"expiresAt":"2026-08-07T12:30:00.000Z","username":"owner@example.com"}'))
      .mockResolvedValueOnce(response('{"ok":true,"accountKey":"club-one","revision":12,"accountLogin":{"username":"owner@example.com","passwordSalt":"new-salt","passwordHash":"new-hash","lastLoginAt":"2026-08-07T12:05:00.000Z"},"publication":{"status":"pending"}}'))
      .mockResolvedValueOnce(response('{"ok":true,"accountKey":"club-one","revision":13,"publication":{"status":"pending"}}'));
    const writeOrbitApiLog = vi.fn();
    const client = createOrbitApiClient(baseDependencies({ fetchImpl: fetch, writeOrbitApiLog }));
    const access = { licenseId: 'club-one', authorizationCode: 'pilot-code' };

    await expect(client.getManagementRecoveryStatusApi(access)).resolves.toEqual({
      ok: true,
      active: true,
      expiresAt: '2026-08-07T12:30:00.000Z',
      username: 'owner@example.com'
    });
    await expect(client.completeManagementRecoveryApi(access, 'Temporary password 2026')).resolves.toMatchObject({
      ok: true,
      accountKey: 'club-one',
      revision: 12,
      accountLogin: { passwordHash: 'new-hash', passwordSalt: 'new-salt' }
    });
    await client.saveStateToApi({
      games: [],
      settings: { pilotAccess: access }
    });

    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      'http://127.0.0.1:4310/management/recovery/status',
      'http://127.0.0.1:4310/management/recovery/complete',
      'http://127.0.0.1:4310/state'
    ]);
    expect(fetch.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({ 'x-orbit-api-key': 'pilot-code', 'x-orbit-auth-key': 'pilot-code' }),
      body: JSON.stringify({ password: 'Temporary password 2026' })
    });
    expect(JSON.parse(String((fetch.mock.calls[2][1] as RequestInit).body))).toMatchObject({ expectedRevision: 12 });
    expect(JSON.stringify(writeOrbitApiLog.mock.calls)).not.toContain('Temporary password 2026');
  });

  it('migrates a replacement-key local account only after API and ordinary fallback misses', async () => {
    const access = { authorizationCode: 'replacement-code', issuedTo: 'Orbit Room' };
    const migratedRecord = {
      schemaVersion: 3,
      savedAt: '2026-08-07T12:00:00.000Z',
      state: { settings: { pilotAccess: access } },
      source: 'local-account-migration'
    };
    const loadStateWithFirebaseFallback = vi.fn().mockResolvedValue(null);
    const migrateLocalAccountToPilotAccess = vi.fn().mockReturnValue(migratedRecord);
    const fetch = vi.fn()
      .mockResolvedValueOnce(response('{"ok":false}'))
      .mockResolvedValueOnce(response('{"ok":true,"accountKey":"replacement-code"}'));
    const client = createOrbitApiClient(baseDependencies({
      fetchImpl: fetch,
      loadStateWithFirebaseFallback,
      migrateLocalAccountToPilotAccess
    }));

    await expect(client.loadStateApiFirst('replacement-code', access)).resolves.toEqual({
      ...migratedRecord,
      accountKey: 'replacement-code',
      authoritative: true,
      publication: { status: 'pending' },
      revision: 1,
      source: 'api-cache-migration'
    });
    expect(loadStateWithFirebaseFallback).toHaveBeenCalledWith('replacement-code');
    expect(migrateLocalAccountToPilotAccess).toHaveBeenCalledWith(access);
    expect(fetch).toHaveBeenLastCalledWith('http://127.0.0.1:4310/state', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(String((fetch.mock.calls.at(-1)?.[1] as RequestInit).body))).toMatchObject({ state: migratedRecord.state, expectedRevision: 0 });
  });

  it('keeps accepted API saves authoritative and labels fallback writes as uncommitted cache', async () => {
    const state = {
      id: 'state-1',
      settings: { pilotAccess: { licenseId: 'club-one', authorizationCode: 'pilot-code' } }
    };
    const fetch = vi.fn()
      .mockResolvedValueOnce(response('{"ok":true,"accountKey":"club-one","revision":1,"publication":{"status":"pending"}}'))
      .mockResolvedValueOnce(response('{"ok":false}'));
    const writeLocalDatabase = vi.fn(() => {
      throw new Error('cache unavailable');
    });
    const writeStateToFirebase = vi.fn().mockResolvedValue(undefined);
    const saveStateEverywhere = vi.fn().mockResolvedValue({ ok: true, engine: 'file-cache' });
    const client = createOrbitApiClient(baseDependencies({
      fetchImpl: fetch,
      isFirebaseConfigured: () => true,
      saveStateEverywhere,
      writeLocalDatabase,
      writeStateToFirebase
    }));

    await expect(client.saveStateApiFirst(state)).resolves.toEqual({
      ok: true,
      path: 'orbit-api',
      engine: 'api',
      accountKey: 'club-one',
      savedAt: undefined,
      revision: 1,
      duplicate: false,
      publication: { status: 'pending' },
      authoritative: true
    });
    expect(writeStateToFirebase).not.toHaveBeenCalled();

    await expect(client.saveStateApiFirst(state)).resolves.toMatchObject({
      ok: false,
      engine: 'file-cache',
      conflict: false,
      error: 'Saved to offline cache; the server commit is still required.'
    });
    expect(saveStateEverywhere).toHaveBeenCalledWith(state);
  });

  it('falls back to local report storage only when the API report submission has no result', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('API unavailable'));
    const storeAnalyticalReport = vi.fn().mockResolvedValue({ ok: true, reportId: 'local-1' });
    const client = createOrbitApiClient(baseDependencies({ fetchImpl: fetch, storeAnalyticalReport }));
    const report = { account: { accountKey: 'club-one' } };

    await expect(client.submitAnalyticalReportApiFirst(report)).resolves.toEqual({ ok: true, reportId: 'local-1' });
    expect(storeAnalyticalReport).toHaveBeenCalledWith(report);
  });
});

describe('Electron client telemetry', () => {
  it('reuses a persisted device identifier without rewriting it', () => {
    const fileSystem = {
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: vi.fn().mockReturnValue('{"deviceId":"persisted-device"}'),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn()
    };
    const randomUUID = vi.fn().mockReturnValue('generated-device');
    const client = createOrbitApiClient(baseDependencies({ fileSystem, randomUUID }));

    expect(client.getOrCreateDeviceId()).toBe('persisted-device');
    expect(client.getOrCreateDeviceId()).toBe('persisted-device');
    expect(fileSystem.readFileSync).toHaveBeenCalledOnce();
    expect(fileSystem.mkdirSync).not.toHaveBeenCalled();
    expect(fileSystem.writeFileSync).not.toHaveBeenCalled();
    expect(randomUUID).not.toHaveBeenCalled();
  });

  it('generates, caches, and best-effort persists a missing device identifier with its creation timestamp', () => {
    const fileSystem = {
      existsSync: vi.fn().mockReturnValue(false),
      readFileSync: vi.fn(),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(() => {
        throw new Error('read-only directory');
      })
    };
    const randomUUID = vi.fn().mockReturnValue('generated-device');
    const client = createOrbitApiClient(baseDependencies({ fileSystem, randomUUID }));

    expect(client.getOrCreateDeviceId()).toBe('generated-device');
    expect(client.getOrCreateDeviceId()).toBe('generated-device');
    expect(randomUUID).toHaveBeenCalledOnce();
    expect(fileSystem.mkdirSync).toHaveBeenCalledWith('C:\\isolated', { recursive: true });
    expect(fileSystem.writeFileSync).toHaveBeenCalledWith(
      path.join('C:\\isolated', 'orbit-device.json'),
      '{\n  "deviceId": "generated-device",\n  "createdAt": "2026-08-07T12:00:00.000Z"\n}'
    );
  });

  it('builds base client identity/status fields and lets explicit overrides win', () => {
    const client = createOrbitApiClient(baseDependencies({
      environment: { NODE_ENV: 'test' },
      readLocalDatabase: () => ({
        state: {
          settings: {
            pilotAccess: { licenseId: 'club-one' },
            clubAccount: { clubName: 'Orbit Room' }
          }
        }
      })
    }));
    client.sendClientUpdateEvent('update-available', 'available');

    expect(client.buildClientTelemetryPayload({ venueName: 'Override Room', custom: 7 })).toEqual({
      venueId: 'club-one',
      venueName: 'Override Room',
      deviceId: 'request-001',
      deviceName: 'desk-one',
      appVersion: '1.2.3',
      platform: 'win32',
      environment: 'test',
      updateStatus: 'available',
      updateEvent: 'update-available',
      lastSeenAt: '2026-08-07T12:00:00.000Z',
      custom: 7
    });
  });

  it('routes heartbeat, usage, errors, and updates to exact telemetry endpoints and payload shapes', () => {
    const fetch = vi.fn().mockResolvedValue(response('{"ok":true}'));
    const client = createOrbitApiClient(baseDependencies({ fetchImpl: fetch }));

    client.sendClientHeartbeat({ route: 'floor' });
    client.sendClientEvent('table-started', 'tables', { tableId: 'table-1' }, { route: 'floor' });
    client.sendClientError(new Error('renderer failed'), 'renderer', { rendererStack: 'renderer-stack', route: 'table' });
    client.sendClientUpdateEvent('update-error', 'error', { message: 'download failed' });

    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      'http://127.0.0.1:4310/clients/heartbeat',
      'http://127.0.0.1:4310/clients/event',
      'http://127.0.0.1:4310/clients/error',
      'http://127.0.0.1:4310/clients/update-event'
    ]);
    const bodies = requestBodies(fetch);
    expect(bodies[0]).toMatchObject({ route: 'floor' });
    expect(bodies[1]).toMatchObject({
      event: 'table-started',
      category: 'tables',
      details: { tableId: 'table-1' },
      occurredAt: '2026-08-07T12:00:00.000Z',
      route: 'floor'
    });
    expect(bodies[2]).toMatchObject({
      message: 'renderer failed',
      stack: 'renderer-stack',
      source: 'renderer',
      route: 'table',
      lastError: 'renderer failed'
    });
    expect(bodies[3]).toMatchObject({
      updateEvent: 'update-error',
      updateStatus: 'error',
      details: { message: 'download failed' },
      lastError: 'download failed'
    });
    expect(client.getClientUpdateState()).toEqual({ updateStatus: 'error', updateEvent: 'update-error' });
  });

  it('starts telemetry with an immediate heartbeat/open event and owns the five-minute interval cleanup', () => {
    const fetch = vi.fn().mockResolvedValue(response('{"ok":true}'));
    const setIntervalImpl = vi.fn().mockReturnValue(71);
    const clearIntervalImpl = vi.fn();
    const client = createOrbitApiClient(baseDependencies({ fetchImpl: fetch, setIntervalImpl, clearIntervalImpl }));

    client.startClientTelemetry();

    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      'http://127.0.0.1:4310/clients/heartbeat',
      'http://127.0.0.1:4310/clients/event'
    ]);
    expect(requestBodies(fetch)[1]).toMatchObject({
      event: 'app-opened',
      category: 'lifecycle',
      details: {
        packaged: true,
        startedAt: '2026-08-07T11:59:00.000Z',
        locale: 'en-US'
      }
    });
    expect(setIntervalImpl).toHaveBeenCalledWith(expect.any(Function), 5 * 60 * 1000);

    client.stopClientTelemetry();
    expect(clearIntervalImpl).toHaveBeenCalledWith(71);
  });
});
