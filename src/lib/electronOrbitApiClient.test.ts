import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const electronMainSource = readFileSync(new URL('../../electron/main.cjs', import.meta.url), 'utf8');

function extractFunctionSource(name: string) {
  const asyncStart = electronMainSource.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : electronMainSource.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Could not find ${name} in electron/main.cjs.`);
  const parametersStart = electronMainSource.indexOf('(', start);
  let parameterDepth = 0;
  let parametersEnd = -1;
  for (let index = parametersStart; index < electronMainSource.length; index += 1) {
    if (electronMainSource[index] === '(') parameterDepth += 1;
    if (electronMainSource[index] === ')') parameterDepth -= 1;
    if (parameterDepth === 0) {
      parametersEnd = index;
      break;
    }
  }
  const bodyStart = electronMainSource.indexOf('{', parametersEnd);
  let depth = 0;
  for (let index = bodyStart; index < electronMainSource.length; index += 1) {
    if (electronMainSource[index] === '{') depth += 1;
    if (electronMainSource[index] === '}') depth -= 1;
    if (depth === 0) return electronMainSource.slice(start, index + 1);
  }
  throw new Error(`Could not find the end of ${name} in electron/main.cjs.`);
}

function loadFunction<T>(name: string, globals: Record<string, unknown> = {}): T {
  const names = Object.keys(globals);
  const factory = Function(...names, `${extractFunctionSource(name)}; return ${name};`);
  return factory(...names.map((key) => globals[key])) as T;
}

function response(text: string, options: { ok?: boolean; status?: number } = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    text: vi.fn().mockResolvedValue(text)
  };
}

type ApiResponse = { payload: Record<string, unknown> | null; responsePreview: string };
type ReadApiResponse = (response: { text: () => Promise<string> }) => Promise<ApiResponse>;
type RequestOrbitApi = (
  pathname: string,
  options?: { authKey?: string; method?: string; headers?: Record<string, string>; body?: unknown; timeoutMs?: number }
) => Promise<Record<string, unknown> | null>;

describe('Electron Orbit API transport characterization', () => {
  it('parses JSON and bounds normalized non-JSON response previews', async () => {
    const readApiResponse = loadFunction<ReadApiResponse>('readApiResponse');

    await expect(readApiResponse(response('{"ok":true}') as never)).resolves.toEqual({
      payload: { ok: true },
      responsePreview: ''
    });
    await expect(readApiResponse(response('') as never)).resolves.toEqual({ payload: null, responsePreview: '' });

    const invalid = `  gateway\n  unavailable ${'x'.repeat(400)}`;
    const result = await readApiResponse(response(invalid) as never);
    expect(result.payload).toBeNull();
    expect(result.responsePreview).toHaveLength(300);
    expect(result.responsePreview).toBe(` gateway unavailable ${'x'.repeat(279)}`);
  });

  it('normalizes the configured URL and prefers the environment API key over the local authorization code', () => {
    const localKey = vi.fn().mockReturnValue('local-license-key');
    const getApiConfig = loadFunction<() => { apiUrl: string; apiKey: string }>('getApiConfig', {
      process: { env: { ORBIT_API_URL: 'http://127.0.0.1:4310///', ORBIT_CLIENT_API_KEY: 'environment-key' } },
      getLocalClientAuthKey: localKey
    });

    expect(getApiConfig()).toEqual({ apiUrl: 'http://127.0.0.1:4310', apiKey: 'environment-key' });
    expect(localKey).not.toHaveBeenCalled();

    const getFallbackConfig = loadFunction<() => { apiUrl: string; apiKey: string }>('getApiConfig', {
      process: { env: {} },
      getLocalClientAuthKey: localKey
    });
    expect(getFallbackConfig()).toEqual({ apiUrl: 'https://orbitapp-one.vercel.app', apiKey: 'local-license-key' });
  });

  it('builds authenticated JSON requests with request IDs, caller headers, bodies, and timeout cleanup', async () => {
    const fetch = vi.fn().mockResolvedValue(response('{"ok":true,"revision":7}'));
    const setTimeout = vi.fn().mockReturnValue(41);
    const clearTimeout = vi.fn();
    const writeOrbitApiLog = vi.fn();
    const requestOrbitApi = loadFunction<RequestOrbitApi>('requestOrbitApi', {
      AbortController,
      Date,
      clearTimeout,
      fetch,
      getApiConfig: () => ({ apiUrl: 'http://127.0.0.1:4310', apiKey: 'configured-key' }),
      orbitApiErrorDetails: vi.fn(),
      readApiResponse: loadFunction<ReadApiResponse>('readApiResponse'),
      setTimeout,
      writeOrbitApiLog,
      crypto: { randomUUID: () => 'request-001' }
    });

    await expect(requestOrbitApi('/state', {
      method: 'POST',
      authKey: 'access-key',
      headers: { 'x-orbit-api-key': 'caller-key', 'x-extra': 'value' },
      body: { state: { games: [] } },
      timeoutMs: 987
    })).resolves.toEqual({ ok: true, revision: 7 });

    expect(fetch).toHaveBeenCalledOnce();
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
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 987);
    expect(clearTimeout).toHaveBeenCalledWith(41);
    expect(writeOrbitApiLog).not.toHaveBeenCalled();
  });

  it('returns null and projects timeout failures for mutations while GET failures remain log-silent', async () => {
    const writeOrbitApiLog = vi.fn();
    const setTimeout = vi.fn((callback: () => void) => {
      callback();
      return 51;
    });
    const clearTimeout = vi.fn();
    const fetch = vi.fn().mockRejectedValue(new Error('socket closed'));
    const requestOrbitApi = loadFunction<RequestOrbitApi>('requestOrbitApi', {
      AbortController,
      Date,
      clearTimeout,
      fetch,
      getApiConfig: () => ({ apiUrl: 'http://127.0.0.1:4310', apiKey: 'configured-key' }),
      orbitApiErrorDetails: () => ({ errorName: 'Error', errorMessage: 'socket closed', errorCode: 'ECONNRESET', cause: '' }),
      readApiResponse: vi.fn(),
      setTimeout,
      writeOrbitApiLog,
      crypto: { randomUUID: () => 'request-002' }
    });

    await expect(requestOrbitApi('/state', { method: 'POST' })).resolves.toBeNull();
    expect(writeOrbitApiLog).toHaveBeenCalledWith('error', 'sync-update-failed', expect.objectContaining({
      requestId: 'request-002',
      method: 'POST',
      pathname: '/state',
      timedOut: true,
      errorName: 'Error',
      errorMessage: 'socket closed',
      errorCode: 'ECONNRESET'
    }));

    writeOrbitApiLog.mockClear();
    await expect(requestOrbitApi('/state/latest')).resolves.toBeNull();
    expect(writeOrbitApiLog).not.toHaveBeenCalled();
    expect(clearTimeout).toHaveBeenCalledTimes(2);
  });

  it('projects pilot-license responses and uses both compatibility auth headers', async () => {
    const fetch = vi.fn().mockResolvedValue(response('{"ok":true,"managed":false,"active":true,"license":{"id":"license-1"}}'));
    const validatePilotAccessApi = loadFunction<(access: unknown) => Promise<Record<string, unknown>>>('validatePilotAccessApi', {
      AbortController,
      clearTimeout: vi.fn(),
      encodeURIComponent,
      fetch,
      getAccountKeyFromAccess: () => 'club-one',
      getApiConfig: () => ({ apiUrl: 'http://127.0.0.1:4310' }),
      getClientAuthKeyFromAccess: () => 'pilot-code',
      readApiResponse: loadFunction<ReadApiResponse>('readApiResponse'),
      setTimeout: vi.fn().mockReturnValue(61),
      crypto: { randomUUID: () => 'request-003' }
    });

    await expect(validatePilotAccessApi({ authorizationCode: 'pilot-code' })).resolves.toEqual({
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
        'x-orbit-request-id': 'request-003'
      }
    }));
  });

  it('preserves state/report endpoint options and result projections', async () => {
    const requestOrbitApi = vi.fn()
      .mockResolvedValueOnce({ schemaVersion: 4, savedAt: '2026-08-07T12:00:00.000Z', accountKey: 'club-one', state: { games: [] } })
      .mockResolvedValueOnce({ ok: true, accountKey: 'club-one', savedAt: '2026-08-07T12:01:00.000Z' })
      .mockResolvedValueOnce({ ok: true, reportId: 'report-1' });
    const loadStateFromApi = loadFunction<(key: string, access: unknown) => Promise<unknown>>('loadStateFromApi', {
      Date,
      encodeURIComponent,
      getClientAuthKeyFromAccess: () => 'pilot-code',
      getLocalAccountKey: () => '',
      requestOrbitApi,
      sanitizeAccountKey: (value: unknown) => String(value).trim().toLowerCase()
    });
    const saveStateToApi = loadFunction<(state: unknown) => Promise<unknown>>('saveStateToApi', {
      getClientAuthKeyFromState: () => 'pilot-code',
      requestOrbitApi
    });
    const submitAnalyticalReportToApi = loadFunction<(report: unknown) => Promise<unknown>>('submitAnalyticalReportToApi', {
      getRemoteBackendStatus: vi.fn().mockResolvedValue(null),
      requestOrbitApi
    });
    const state = { games: [] };
    const report = { account: { accountKey: 'club-one' } };

    await expect(loadStateFromApi(' CLUB-ONE ', {})).resolves.toEqual({
      schemaVersion: 4,
      savedAt: '2026-08-07T12:00:00.000Z',
      state,
      accountKey: 'club-one',
      source: 'api'
    });
    expect(requestOrbitApi).toHaveBeenNthCalledWith(1, '/state/club-one', { authKey: 'pilot-code' });

    await expect(saveStateToApi(state)).resolves.toEqual({
      ok: true,
      path: 'orbit-api',
      engine: 'api',
      accountKey: 'club-one',
      savedAt: '2026-08-07T12:01:00.000Z'
    });
    expect(requestOrbitApi).toHaveBeenNthCalledWith(2, '/state', {
      method: 'POST',
      body: { state },
      authKey: 'pilot-code',
      timeoutMs: 5000
    });

    await expect(submitAnalyticalReportToApi(report)).resolves.toEqual({
      ok: true,
      reportId: 'report-1',
      backend: { running: true, host: 'api', port: 0, reportCount: 0, mode: 'api' }
    });
    expect(requestOrbitApi).toHaveBeenNthCalledWith(3, '/analytical-reports', {
      method: 'POST',
      body: report,
      timeoutMs: 5000
    });
  });
});

describe('Electron API-first orchestration characterization', () => {
  it('returns an API load immediately or seeds a missing API venue from the unchanged fallback record', async () => {
    const apiRecord = { source: 'api', state: { id: 'remote' } };
    const loadStateFromApi = vi.fn().mockResolvedValueOnce(apiRecord).mockResolvedValueOnce(null);
    const fallbackRecord = { schemaVersion: 4, savedAt: 'fallback-time', state: { id: 'fallback' } };
    const loadStateWithFirebaseFallback = vi.fn().mockResolvedValue(fallbackRecord);
    const saveStateToApi = vi.fn().mockResolvedValue({ ok: true });
    const loadStateApiFirst = loadFunction<(key: string, access: unknown) => Promise<unknown>>('loadStateApiFirst', {
      loadStateFromApi,
      loadStateWithFirebaseFallback,
      saveStateToApi
    });

    await expect(loadStateApiFirst('club-one', { code: 'one' })).resolves.toBe(apiRecord);
    expect(loadStateWithFirebaseFallback).not.toHaveBeenCalled();

    await expect(loadStateApiFirst('club-one', { code: 'one' })).resolves.toBe(fallbackRecord);
    expect(loadStateWithFirebaseFallback).toHaveBeenCalledWith('club-one');
    expect(saveStateToApi).toHaveBeenCalledWith(fallbackRecord.state);
  });

  it('keeps accepted API saves authoritative, treats cache/Firebase work as pending, and falls back after an API miss', async () => {
    const state = { id: 'state-1' };
    const apiResult = { ok: true, engine: 'api', accountKey: 'club-one' };
    const saveStateToApi = vi.fn().mockResolvedValueOnce(apiResult).mockResolvedValueOnce(null);
    const writeLocalDatabase = vi.fn(() => {
      throw new Error('cache unavailable');
    });
    const writeStateToFirebase = vi.fn().mockResolvedValue(undefined);
    const saveStateEverywhere = vi.fn().mockResolvedValue({ ok: true, engine: 'sqlite' });
    const saveStateApiFirst = loadFunction<(value: unknown) => Promise<unknown>>('saveStateApiFirst', {
      buildPlayerClubSnapshot: () => ({ games: [] }),
      getAccountKeyFromState: () => 'club-one',
      isFirebaseConfigured: () => true,
      saveStateEverywhere,
      saveStateToApi,
      writeLocalDatabase,
      writeStateToFirebase
    });

    await expect(saveStateApiFirst(state)).resolves.toEqual({
      ...apiResult,
      firebase: { ok: true, engine: 'firebase', accountKey: 'club-one', pending: true }
    });
    expect(writeStateToFirebase).toHaveBeenCalledWith('club-one', state, { games: [] });

    await expect(saveStateApiFirst(state)).resolves.toEqual({ ok: true, engine: 'sqlite' });
    expect(saveStateEverywhere).toHaveBeenCalledWith(state);
  });

  it('falls back to local report storage only when the API report submission has no result', async () => {
    const apiResult = { ok: true, reportId: 'report-1' };
    const submitAnalyticalReportToApi = vi.fn().mockResolvedValueOnce(apiResult).mockResolvedValueOnce(null);
    const storeAnalyticalReport = vi.fn().mockResolvedValue({ ok: true, reportId: 'local-1' });
    const submitAnalyticalReportApiFirst = loadFunction<(report: unknown) => Promise<unknown>>('submitAnalyticalReportApiFirst', {
      storeAnalyticalReport,
      submitAnalyticalReportToApi
    });
    const report = { account: { accountKey: 'club-one' } };

    await expect(submitAnalyticalReportApiFirst(report)).resolves.toBe(apiResult);
    expect(storeAnalyticalReport).not.toHaveBeenCalled();
    await expect(submitAnalyticalReportApiFirst(report)).resolves.toEqual({ ok: true, reportId: 'local-1' });
    expect(storeAnalyticalReport).toHaveBeenCalledWith(report);
  });
});

describe('Electron client telemetry characterization', () => {
  it('builds base client identity/status fields and lets explicit overrides win', () => {
    class FixedDate extends Date {
      constructor() {
        super('2026-08-07T12:00:00.000Z');
      }
    }
    const buildClientTelemetryPayload = loadFunction<(overrides?: Record<string, unknown>) => Record<string, unknown>>('buildClientTelemetryPayload', {
      Date: FixedDate,
      app: { getVersion: () => '1.2.3' },
      getOrCreateDeviceId: () => 'device-1',
      getTelemetryVenueInfo: () => ({ venueId: 'club-one', venueName: 'Orbit Room' }),
      isDev: false,
      lastUpdateEvent: 'update-available',
      lastUpdateStatus: 'available',
      os: { hostname: () => 'desk-one' },
      process: { platform: 'win32', env: { NODE_ENV: 'test' } }
    });

    expect(buildClientTelemetryPayload({ venueName: 'Override Room', custom: 7 })).toEqual({
      venueId: 'club-one',
      venueName: 'Override Room',
      deviceId: 'device-1',
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
    const postClientTelemetry = vi.fn();
    const buildClientTelemetryPayload = vi.fn((overrides = {}) => ({ base: true, ...overrides }));
    const sendClientHeartbeat = loadFunction<(overrides?: Record<string, unknown>) => void>('sendClientHeartbeat', {
      buildClientTelemetryPayload,
      postClientTelemetry
    });
    const sendClientEvent = loadFunction<(event: string, category?: string, details?: Record<string, unknown>, overrides?: Record<string, unknown>) => void>('sendClientEvent', {
      Date: class extends Date { constructor() { super('2026-08-07T12:01:00.000Z'); } },
      buildClientTelemetryPayload,
      postClientTelemetry
    });
    const sendClientError = loadFunction<(error: unknown, source?: string, details?: Record<string, unknown>) => void>('sendClientError', {
      Date: class extends Date { constructor() { super('2026-08-07T12:02:00.000Z'); } },
      buildClientTelemetryPayload,
      postClientTelemetry
    });
    const sendClientUpdateEvent = loadFunction<(event: string, status: string, details?: Record<string, unknown>) => void>('sendClientUpdateEvent', {
      buildClientTelemetryPayload,
      lastUpdateEvent: '',
      lastUpdateStatus: '',
      postClientTelemetry
    });

    sendClientHeartbeat({ route: 'floor' });
    sendClientEvent('table-started', 'tables', { tableId: 'table-1' }, { route: 'floor' });
    sendClientError(new Error('renderer failed'), 'renderer', { rendererStack: 'renderer-stack', route: 'table' });
    sendClientUpdateEvent('update-error', 'error', { message: 'download failed' });

    expect(postClientTelemetry.mock.calls).toEqual([
      ['/clients/heartbeat', { base: true, route: 'floor' }],
      ['/clients/event', {
        base: true,
        event: 'table-started',
        category: 'tables',
        details: { tableId: 'table-1' },
        occurredAt: '2026-08-07T12:01:00.000Z',
        route: 'floor'
      }],
      ['/clients/error', {
        base: true,
        message: 'renderer failed',
        stack: 'renderer-stack',
        source: 'renderer',
        route: 'table',
        details: { rendererStack: 'renderer-stack', route: 'table' },
        occurredAt: '2026-08-07T12:02:00.000Z',
        lastError: 'renderer failed'
      }],
      ['/clients/update-event', {
        base: true,
        updateEvent: 'update-error',
        updateStatus: 'error',
        details: { message: 'download failed' },
        lastError: 'download failed'
      }]
    ]);
  });

  it('starts telemetry with an immediate heartbeat/open event and a five-minute heartbeat interval', () => {
    const sendClientHeartbeat = vi.fn();
    const sendClientEvent = vi.fn();
    const setInterval = vi.fn().mockReturnValue(71);
    const startClientTelemetry = loadFunction<() => void>('startClientTelemetry', {
      app: { isPackaged: true, getLocale: () => 'en-US' },
      appStartedAt: '2026-08-07T11:59:00.000Z',
      clientHeartbeatTimer: undefined,
      sendClientEvent,
      sendClientHeartbeat,
      setInterval
    });

    startClientTelemetry();

    expect(sendClientHeartbeat).toHaveBeenCalledOnce();
    expect(sendClientEvent).toHaveBeenCalledWith('app-opened', 'lifecycle', {
      packaged: true,
      startedAt: '2026-08-07T11:59:00.000Z',
      locale: 'en-US'
    });
    expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 5 * 60 * 1000);
  });
});
