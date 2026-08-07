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

type RequestLike = {
  headers: { host?: string };
  method?: string;
  socket: { remoteAddress?: string };
  url?: string;
};

type ResponseLike = {
  body: string;
  end: ReturnType<typeof vi.fn>;
  headers?: Record<string, string>;
  statusCode?: number;
  writeHead: ReturnType<typeof vi.fn>;
};

type RequestHandler = (request: RequestLike, response: ResponseLike) => Promise<void>;

function createResponse(): ResponseLike {
  const result: ResponseLike = {
    body: '',
    end: vi.fn((body: string) => {
      result.body = body;
    }),
    writeHead: vi.fn((statusCode: number, headers: Record<string, string>) => {
      result.statusCode = statusCode;
      result.headers = headers;
    })
  };
  return result;
}

function payload(response: ResponseLike) {
  return JSON.parse(response.body) as Record<string, unknown>;
}

function request(method: string, url: string, remoteAddress = '127.0.0.1'): RequestLike {
  return { method, url, headers: { host: '127.0.0.1:4629' }, socket: { remoteAddress } };
}

function createHarness(options: { environment?: Record<string, string>; overrides?: Record<string, unknown> } = {}) {
  let handler: RequestHandler | undefined;
  const listeners = new Map<string, () => void>();
  const server = {
    address: vi.fn().mockReturnValue({ address: '127.0.0.1', family: 'IPv4', port: 4631 }),
    listen: vi.fn((_port: number, _host: string, callback: () => void) => callback()),
    on: vi.fn((event: string, callback: () => void) => listeners.set(event, callback))
  };
  const createServer = vi.fn((callback: RequestHandler) => {
    handler = callback;
    return server;
  });
  const sendJson = loadFunction<(response: ResponseLike, statusCode: number, value: unknown) => void>('sendJson');
  const dependencies = {
    URL,
    applyMembershipRequestToState: vi.fn((state: Record<string, unknown>) => ({ ...state, membershipApplied: true })),
    applyWaitlistRequestToState: vi.fn((state: Record<string, unknown>) => ({ ...state, waitlistApplied: true })),
    buildPlayerClubSnapshot: vi.fn((_state: unknown, player: unknown) => ({ player })),
    embeddedBackend: undefined,
    embeddedBackendStatus: { running: false, host: '127.0.0.1', port: 0, reportCount: 0 },
    getAccountKeyFromState: vi.fn().mockReturnValue('club-one'),
    getReportCount: vi.fn().mockReturnValue(3),
    http: { createServer },
    loadStateWithFirebaseFallback: vi.fn().mockResolvedValue(null),
    process: { env: options.environment || {} },
    readRequestBody: vi.fn().mockResolvedValue('{}'),
    sanitizeAccountKey: vi.fn((value: unknown) => String(value || '').trim().toLowerCase()),
    saveStateEverywhere: vi.fn().mockResolvedValue({ ok: true }),
    sendJson,
    storeAnalyticalReport: vi.fn().mockResolvedValue({ ok: true, id: 'report-1' }),
    syncStateWithFirebaseRequests: vi.fn(async (state: unknown) => state),
    ...options.overrides
  };
  const startEmbeddedBackend = loadFunction<() => void>('startEmbeddedBackend', dependencies);
  startEmbeddedBackend();
  if (!handler) throw new Error('Embedded backend did not register a request handler.');
  return { dependencies, handler, listeners, server, startEmbeddedBackend };
}

describe('Electron embedded backend characterization', () => {
  it('writes JSON with the exact CORS and no-store response headers', () => {
    const sendJson = loadFunction<(response: ResponseLike, statusCode: number, value: unknown) => void>('sendJson');
    const response = createResponse();

    sendJson(response, 201, { ok: true });

    expect(response.writeHead).toHaveBeenCalledWith(201, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
      'cache-control': 'no-store'
    });
    expect(response.end).toHaveBeenCalledWith('{"ok":true}');
  });

  it('reads UTF-8 request chunks and rejects/destroys bodies above two million characters', async () => {
    const readRequestBody = loadFunction<(request: { setEncoding: (value: string) => void; on: (event: string, callback: (value?: string | Error) => void) => void; destroy: () => void }) => Promise<string>>('readRequestBody');
    const listeners = new Map<string, (value?: string | Error) => void>();
    const request = {
      destroy: vi.fn(),
      on: vi.fn((event: string, callback: (value?: string | Error) => void) => listeners.set(event, callback)),
      setEncoding: vi.fn()
    };
    const successfulRead = readRequestBody(request);
    listeners.get('data')?.('first');
    listeners.get('data')?.('-second');
    listeners.get('end')?.();
    await expect(successfulRead).resolves.toBe('first-second');
    expect(request.setEncoding).toHaveBeenCalledWith('utf8');

    const oversizedListeners = new Map<string, (value?: string | Error) => void>();
    const oversizedRequest = {
      destroy: vi.fn(),
      on: vi.fn((event: string, callback: (value?: string | Error) => void) => oversizedListeners.set(event, callback)),
      setEncoding: vi.fn()
    };
    const oversizedRead = readRequestBody(oversizedRequest);
    oversizedListeners.get('data')?.('x'.repeat(2_000_001));
    await expect(oversizedRead).rejects.toThrow('Request body is too large.');
    expect(oversizedRequest.destroy).toHaveBeenCalledOnce();
  });

  it('binds once to the configured host/port and reflects listen/close status through health', async () => {
    const harness = createHarness({
      environment: { TABLEMANAGER_SYNC_HOST: '127.0.0.1', TABLEMANAGER_SYNC_PORT: '4630' }
    });
    expect(harness.server.listen).toHaveBeenCalledWith(4630, '127.0.0.1', expect.any(Function));

    harness.startEmbeddedBackend();
    expect(harness.server.listen).toHaveBeenCalledOnce();

    const runningResponse = createResponse();
    await harness.handler(request('GET', '/health'), runningResponse);
    expect(runningResponse.statusCode).toBe(200);
    expect(payload(runningResponse)).toEqual({
      ok: true,
      running: true,
      host: '127.0.0.1',
      port: 4631,
      reportCount: 3
    });

    harness.listeners.get('close')?.();
    const closedResponse = createResponse();
    await harness.handler(request('GET', '/health'), closedResponse);
    expect(payload(closedResponse)).toMatchObject({ running: false, host: '127.0.0.1', port: 0, reportCount: 3 });
  });

  it('rejects non-loopback clients before routing unless LAN player sync is explicitly enabled', async () => {
    const restricted = createHarness();
    const deniedResponse = createResponse();
    await restricted.handler(request('OPTIONS', '/health', '192.0.2.10'), deniedResponse);
    expect(deniedResponse.statusCode).toBe(403);
    expect(payload(deniedResponse)).toEqual({ ok: false, error: 'Embedded backend only accepts loopback requests.' });

    const allowed = createHarness({ environment: { TABLEMANAGER_PLAYER_SYNC_ALLOW_LAN: 'true' } });
    const optionsResponse = createResponse();
    await allowed.handler(request('OPTIONS', '/health', '192.0.2.10'), optionsResponse);
    expect(optionsResponse.statusCode).toBe(204);
    expect(payload(optionsResponse)).toEqual({});
  });

  it('loads a sanitized snapshot account, persists newly synchronized state, and scopes the player projection', async () => {
    const state = { id: 'state-1' };
    const syncedState = { id: 'state-1', synced: true };
    const loadStateWithFirebaseFallback = vi.fn().mockResolvedValue({ savedAt: 'saved-time', state });
    const syncStateWithFirebaseRequests = vi.fn().mockResolvedValue(syncedState);
    const saveStateEverywhere = vi.fn().mockResolvedValue({ ok: true });
    const buildPlayerClubSnapshot = vi.fn().mockReturnValue({ games: [], playerId: 'player-1' });
    const harness = createHarness({ overrides: {
      buildPlayerClubSnapshot,
      loadStateWithFirebaseFallback,
      saveStateEverywhere,
      syncStateWithFirebaseRequests
    } });
    const response = createResponse();

    await harness.handler(request('GET', '/player/snapshot?accountKey=%20CLUB-ONE%20&playerId=player-1&playerName=Alex'), response);

    expect(loadStateWithFirebaseFallback).toHaveBeenCalledWith('club-one');
    expect(syncStateWithFirebaseRequests).toHaveBeenCalledWith(state);
    expect(saveStateEverywhere).toHaveBeenCalledWith(syncedState);
    expect(buildPlayerClubSnapshot).toHaveBeenCalledWith(syncedState, { id: 'player-1', name: 'Alex' });
    expect(response.statusCode).toBe(200);
    expect(payload(response)).toEqual({
      ok: true,
      accountKey: 'club-one',
      savedAt: 'saved-time',
      snapshot: { games: [], playerId: 'player-1' }
    });
  });

  it('returns the exact missing-state statuses for snapshot, membership, and waitlist requests', async () => {
    const readRequestBody = vi.fn()
      .mockResolvedValueOnce('{"clubId":"club-one"}')
      .mockResolvedValueOnce('{"clubId":"club-one"}');
    const harness = createHarness({ overrides: { readRequestBody } });

    const snapshotResponse = createResponse();
    await harness.handler(request('GET', '/player/snapshot?accountKey=club-one'), snapshotResponse);
    expect(snapshotResponse.statusCode).toBe(404);
    expect(payload(snapshotResponse)).toEqual({ ok: false, error: 'No Orbit club database is available yet.' });

    const membershipResponse = createResponse();
    await harness.handler(request('POST', '/player/membership-requests'), membershipResponse);
    expect(membershipResponse.statusCode).toBe(404);
    expect(payload(membershipResponse)).toEqual({ ok: false, error: 'No matching club database was found for this membership request.' });

    const waitlistResponse = createResponse();
    await harness.handler(request('POST', '/player/waitlist-requests'), waitlistResponse);
    expect(waitlistResponse.statusCode).toBe(404);
    expect(payload(waitlistResponse)).toEqual({ ok: false, error: 'No matching club database was found for this waitlist request.' });
  });

  it('delegates membership and waitlist mutations by payload club and returns the persisted player snapshot', async () => {
    const membershipPayload = { clubId: 'club-one', player: { id: 'player-1', name: 'Alex' } };
    const waitlistPayload = { clubId: 'club-two', player: { id: 'player-2', name: 'Blair' } };
    const readRequestBody = vi.fn()
      .mockResolvedValueOnce(JSON.stringify(membershipPayload))
      .mockResolvedValueOnce(JSON.stringify(waitlistPayload));
    const state = { id: 'initial' };
    const loadStateWithFirebaseFallback = vi.fn().mockResolvedValue({ state });
    const applyMembershipRequestToState = vi.fn().mockReturnValue({ id: 'membership-state' });
    const applyWaitlistRequestToState = vi.fn().mockReturnValue({ id: 'waitlist-state' });
    const saveStateEverywhere = vi.fn().mockResolvedValue({ ok: true });
    const buildPlayerClubSnapshot = vi.fn((nextState: { id: string }, player: { id: string }) => ({ stateId: nextState.id, playerId: player.id }));
    const harness = createHarness({ overrides: {
      applyMembershipRequestToState,
      applyWaitlistRequestToState,
      buildPlayerClubSnapshot,
      loadStateWithFirebaseFallback,
      readRequestBody,
      saveStateEverywhere
    } });

    const membershipResponse = createResponse();
    await harness.handler(request('POST', '/player/membership-requests'), membershipResponse);
    expect(loadStateWithFirebaseFallback).toHaveBeenNthCalledWith(1, 'club-one');
    expect(applyMembershipRequestToState).toHaveBeenCalledWith(state, membershipPayload);
    expect(saveStateEverywhere).toHaveBeenNthCalledWith(1, { id: 'membership-state' });
    expect(membershipResponse.statusCode).toBe(201);
    expect(payload(membershipResponse)).toMatchObject({ ok: true, snapshot: { stateId: 'membership-state', playerId: 'player-1' } });

    const waitlistResponse = createResponse();
    await harness.handler(request('POST', '/player/waitlist-requests'), waitlistResponse);
    expect(loadStateWithFirebaseFallback).toHaveBeenNthCalledWith(2, 'club-two');
    expect(applyWaitlistRequestToState).toHaveBeenCalledWith(state, waitlistPayload);
    expect(saveStateEverywhere).toHaveBeenNthCalledWith(2, { id: 'waitlist-state' });
    expect(waitlistResponse.statusCode).toBe(201);
    expect(payload(waitlistResponse)).toMatchObject({ ok: true, snapshot: { stateId: 'waitlist-state', playerId: 'player-2' } });
  });

  it('delegates analytical reports, returns not-found for unknown routes, and maps handler failures to 400', async () => {
    const report = { account: {}, operational: {}, usage: {} };
    const readRequestBody = vi.fn()
      .mockResolvedValueOnce(JSON.stringify(report))
      .mockResolvedValueOnce('{invalid-json');
    const storeAnalyticalReport = vi.fn().mockResolvedValue({ ok: true, id: 'report-1' });
    const harness = createHarness({ overrides: { readRequestBody, storeAnalyticalReport } });

    const reportResponse = createResponse();
    await harness.handler(request('POST', '/analytical-reports'), reportResponse);
    expect(storeAnalyticalReport).toHaveBeenCalledWith(report);
    expect(reportResponse.statusCode).toBe(201);
    expect(payload(reportResponse)).toEqual({ ok: true, id: 'report-1' });

    const unknownResponse = createResponse();
    await harness.handler(request('GET', '/unknown'), unknownResponse);
    expect(unknownResponse.statusCode).toBe(404);
    expect(payload(unknownResponse)).toEqual({ ok: false, error: 'Not found.' });

    const failureResponse = createResponse();
    await harness.handler(request('POST', '/analytical-reports'), failureResponse);
    expect(failureResponse.statusCode).toBe(400);
    expect(payload(failureResponse)).toEqual({
      ok: false,
      error: "Expected property name or '}' in JSON at position 1 (line 1 column 2)"
    });
  });
});
