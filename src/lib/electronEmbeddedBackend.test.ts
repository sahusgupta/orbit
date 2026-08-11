import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);

type RequestLike = {
  destroy: ReturnType<typeof vi.fn>;
  emit: (event: string, value?: string | Error) => void;
  headers: { host?: string };
  method?: string;
  on: ReturnType<typeof vi.fn>;
  setEncoding: ReturnType<typeof vi.fn>;
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
type EmbeddedBackend = {
  getStatus: () => { running: boolean; host: string; port: number; reportCount: number };
  start: () => void;
  stop: () => void;
  updateReportCount: (reportCount: number) => { running: boolean; host: string; port: number; reportCount: number };
};
type EmbeddedBackendModule = {
  createEmbeddedBackend: (dependencies: Record<string, unknown>) => EmbeddedBackend;
  readRequestBody: (request: RequestLike) => Promise<string>;
  sendJson: (response: ResponseLike, statusCode: number, payload: unknown) => void;
};

const { createEmbeddedBackend, readRequestBody, sendJson }: EmbeddedBackendModule = require('../../electron/embeddedBackend.cjs');

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
  const listeners = new Map<string, (value?: string | Error) => void>();
  return {
    destroy: vi.fn(),
    emit: (event, value) => listeners.get(event)?.(value),
    headers: { host: '127.0.0.1:4629' },
    method,
    on: vi.fn((event: string, callback: (value?: string | Error) => void) => listeners.set(event, callback)),
    setEncoding: vi.fn(),
    socket: { remoteAddress },
    url
  };
}

async function invoke(handler: RequestHandler, requestValue: RequestLike, response: ResponseLike, body?: string) {
  const result = handler(requestValue, response);
  if (body !== undefined) {
    requestValue.emit('data', body);
    requestValue.emit('end');
  }
  await result;
}

function createHarness(options: { environment?: Record<string, string>; overrides?: Record<string, unknown> } = {}) {
  let handler: RequestHandler | undefined;
  const listeners = new Map<string, () => void>();
  const server = {
    address: vi.fn().mockReturnValue({ address: '127.0.0.1', family: 'IPv4', port: 4631 }),
    close: vi.fn(),
    listen: vi.fn((_port: number, _host: string, callback: () => void) => callback()),
    on: vi.fn((event: string, callback: () => void) => listeners.set(event, callback))
  };
  const createServer = vi.fn((callback: RequestHandler) => {
    handler = callback;
    return server;
  });
  const dependencies = {
    applyMembershipRequestToState: vi.fn((state: Record<string, unknown>) => ({ ...state, membershipApplied: true })),
    applyWaitlistRequestToState: vi.fn((state: Record<string, unknown>) => ({ ...state, waitlistApplied: true })),
    buildPlayerClubSnapshot: vi.fn((_state: unknown, player: unknown) => ({ player })),
    environment: options.environment || {},
    getAccountKeyFromState: vi.fn().mockReturnValue('club-one'),
    getReportCount: vi.fn().mockReturnValue(3),
    http: { createServer },
    loadStateWithFirebaseFallback: vi.fn().mockResolvedValue(null),
    saveStateEverywhere: vi.fn().mockResolvedValue({ ok: true }),
    storeAnalyticalReport: vi.fn().mockResolvedValue({ ok: true, id: 'report-1' }),
    syncStateWithFirebaseRequests: vi.fn(async (state: unknown) => state),
    ...options.overrides
  };
  const backend = createEmbeddedBackend(dependencies);
  backend.start();
  if (!handler) throw new Error('Embedded backend did not register a request handler.');
  return { backend, dependencies, handler, listeners, server };
}

describe('Electron embedded backend', () => {
  it('writes JSON with the exact CORS and no-store response headers', () => {
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
    const successfulRequest = request('POST', '/');
    const successfulRead = readRequestBody(successfulRequest);
    successfulRequest.emit('data', 'first');
    successfulRequest.emit('data', '-second');
    successfulRequest.emit('end');
    await expect(successfulRead).resolves.toBe('first-second');
    expect(successfulRequest.setEncoding).toHaveBeenCalledWith('utf8');

    const oversizedRequest = request('POST', '/');
    const oversizedRead = readRequestBody(oversizedRequest);
    oversizedRequest.emit('data', 'x'.repeat(2_000_001));
    await expect(oversizedRead).rejects.toThrow('Request body is too large.');
    expect(oversizedRequest.destroy).toHaveBeenCalledOnce();
  });

  it('binds once to the configured host/port and reflects listen/close status through health', async () => {
    const harness = createHarness({ environment: { TABLEMANAGER_SYNC_HOST: '127.0.0.1', TABLEMANAGER_SYNC_PORT: '4630' } });
    expect(harness.server.listen).toHaveBeenCalledWith(4630, '127.0.0.1', expect.any(Function));

    harness.backend.start();
    expect(harness.server.listen).toHaveBeenCalledOnce();

    const runningResponse = createResponse();
    await invoke(harness.handler, request('GET', '/health'), runningResponse);
    expect(runningResponse.statusCode).toBe(200);
    expect(payload(runningResponse)).toEqual({ ok: true, running: true, host: '127.0.0.1', port: 4631, reportCount: 3 });
    expect(harness.backend.getStatus()).toEqual({ running: true, host: '127.0.0.1', port: 4631, reportCount: 3 });

    harness.listeners.get('close')?.();
    const closedResponse = createResponse();
    await invoke(harness.handler, request('GET', '/health'), closedResponse);
    expect(payload(closedResponse)).toMatchObject({ running: false, host: '127.0.0.1', port: 0, reportCount: 3 });

    expect(harness.backend.updateReportCount(5)).toMatchObject({ running: false, port: 0, reportCount: 5 });
    harness.backend.stop();
    harness.backend.stop();
    expect(harness.server.close).toHaveBeenCalledOnce();
  });

  it('rejects non-loopback clients before routing unless LAN player sync is explicitly enabled', async () => {
    const restricted = createHarness();
    const deniedResponse = createResponse();
    await invoke(restricted.handler, request('OPTIONS', '/health', '192.0.2.10'), deniedResponse);
    expect(deniedResponse.statusCode).toBe(403);
    expect(payload(deniedResponse)).toEqual({ ok: false, error: 'Embedded backend only accepts loopback requests.' });

    const allowed = createHarness({ environment: { TABLEMANAGER_PLAYER_SYNC_ALLOW_LAN: 'true' } });
    const optionsResponse = createResponse();
    await invoke(allowed.handler, request('OPTIONS', '/health', '192.0.2.10'), optionsResponse);
    expect(optionsResponse.statusCode).toBe(204);
    expect(payload(optionsResponse)).toEqual({});
  });

  it('loads a sanitized offline snapshot without mutating or publishing cached state', async () => {
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

    await invoke(harness.handler, request('GET', '/player/snapshot?accountKey=%20CLUB-ONE%20&playerId=player-1&playerName=Alex'), response);

    expect(loadStateWithFirebaseFallback).toHaveBeenCalledWith('club-one');
    expect(syncStateWithFirebaseRequests).not.toHaveBeenCalled();
    expect(saveStateEverywhere).not.toHaveBeenCalled();
    expect(buildPlayerClubSnapshot).toHaveBeenCalledWith(state, { id: 'player-1', name: 'Alex' });
    expect(response.statusCode).toBe(200);
    expect(payload(response)).toEqual({
      ok: true,
      accountKey: 'club-one',
      savedAt: 'saved-time',
      snapshot: { games: [], playerId: 'player-1' },
      source: 'offline-cache',
      authoritative: false
    });
  });

  it('returns the exact missing-state status for snapshots and rejects embedded player mutations', async () => {
    const harness = createHarness();

    const snapshotResponse = createResponse();
    await invoke(harness.handler, request('GET', '/player/snapshot?accountKey=club-one'), snapshotResponse);
    expect(snapshotResponse.statusCode).toBe(404);
    expect(payload(snapshotResponse)).toEqual({ ok: false, error: 'No Orbit club database is available yet.' });

    const membershipResponse = createResponse();
    await invoke(harness.handler, request('POST', '/player/membership-requests'), membershipResponse, '{"clubId":"club-one"}');
    expect(membershipResponse.statusCode).toBe(503);
    expect(payload(membershipResponse)).toEqual({ ok: false, error: 'Player mutations require the authoritative Orbit API.' });

    const waitlistResponse = createResponse();
    await invoke(harness.handler, request('POST', '/player/waitlist-requests'), waitlistResponse, '{"clubId":"club-one"}');
    expect(waitlistResponse.statusCode).toBe(503);
    expect(payload(waitlistResponse)).toEqual({ ok: false, error: 'Player mutations require the authoritative Orbit API.' });
  });

  it('does not delegate membership or waitlist mutations to the offline cache', async () => {
    const membershipPayload = { clubId: 'club-one', player: { id: 'player-1', name: 'Alex' } };
    const waitlistPayload = { clubId: 'club-two', player: { id: 'player-2', name: 'Blair' } };
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
      saveStateEverywhere
    } });

    const membershipResponse = createResponse();
    await invoke(harness.handler, request('POST', '/player/membership-requests'), membershipResponse, JSON.stringify(membershipPayload));
    expect(membershipResponse.statusCode).toBe(503);
    expect(payload(membershipResponse)).toEqual({ ok: false, error: 'Player mutations require the authoritative Orbit API.' });

    const waitlistResponse = createResponse();
    await invoke(harness.handler, request('POST', '/player/waitlist-requests'), waitlistResponse, JSON.stringify(waitlistPayload));
    expect(waitlistResponse.statusCode).toBe(503);
    expect(payload(waitlistResponse)).toEqual({ ok: false, error: 'Player mutations require the authoritative Orbit API.' });
    expect(loadStateWithFirebaseFallback).not.toHaveBeenCalled();
    expect(applyMembershipRequestToState).not.toHaveBeenCalled();
    expect(applyWaitlistRequestToState).not.toHaveBeenCalled();
    expect(saveStateEverywhere).not.toHaveBeenCalled();
    expect(buildPlayerClubSnapshot).not.toHaveBeenCalled();
  });

  it('delegates analytical reports, returns not-found for unknown routes, and maps handler failures to 400', async () => {
    const report = { account: {}, operational: {}, usage: {} };
    const storeAnalyticalReport = vi.fn().mockResolvedValue({ ok: true, id: 'report-1' });
    const harness = createHarness({ overrides: { storeAnalyticalReport } });

    const reportResponse = createResponse();
    await invoke(harness.handler, request('POST', '/analytical-reports'), reportResponse, JSON.stringify(report));
    expect(storeAnalyticalReport).toHaveBeenCalledWith(report);
    expect(reportResponse.statusCode).toBe(201);
    expect(payload(reportResponse)).toEqual({ ok: true, id: 'report-1' });

    const unknownResponse = createResponse();
    await invoke(harness.handler, request('GET', '/unknown'), unknownResponse);
    expect(unknownResponse.statusCode).toBe(404);
    expect(payload(unknownResponse)).toEqual({ ok: false, error: 'Not found.' });

    const failureResponse = createResponse();
    await invoke(harness.handler, request('POST', '/analytical-reports'), failureResponse, '{invalid-json');
    expect(failureResponse.statusCode).toBe(400);
    expect(payload(failureResponse)).toEqual({
      ok: false,
      error: "Expected property name or '}' in JSON at position 1 (line 1 column 2)"
    });
  });
});
