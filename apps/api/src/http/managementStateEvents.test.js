import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import eventsModule from './managementStateEvents.js';
import adminProviderModule from '../services/firebaseAdmin.js';

const { createManagementStateEvents } = eventsModule;

function connection() {
  const request = new EventEmitter();
  const writes = [];
  const response = Object.assign(new EventEmitter(), {
    writableEnded: false,
    statusCode: 200,
    body: undefined,
    set: vi.fn(),
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    writeHead: vi.fn(),
    write: vi.fn((body) => { writes.push(body); return true; }),
    end: vi.fn(function end() { this.writableEnded = true; })
  });
  return { request, response, writes };
}

function harness(options = {}) {
  const streams = [];
  const watchStateHeader = vi.fn((accountKey, changed, failed) => {
    const unsubscribe = vi.fn();
    streams.push({ accountKey, changed, failed, unsubscribe });
    return unsubscribe;
  });
  const updates = createManagementStateEvents({ watchStateHeader, ...options });
  const revalidate = vi.fn(async () => true);
  const getExpiresAt = vi.fn(() => undefined);
  const connect = () => {
    const client = connection();
    updates.connect(client.request, client.response, { accountKey: 'club-one', revalidate, getExpiresAt });
    return client;
  };
  return { streams, watchStateHeader, updates, revalidate, getExpiresAt, connect };
}

const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
const changes = (client) => client.writes.filter((body) => body.startsWith('event: change\n'));
const databaseStatus = (mode) => ({ engine: 'firestore', authoritative: true, durable: mode !== 'memory-test', mode });

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('authoritative management header notifications', () => {
  it('sends only allowlisted ready/change metadata and ignores duplicate header revisions', async () => {
    const fixture = harness();
    const client = fixture.connect();
    fixture.streams[0].changed({ revision: 7, state: { balance: 999 }, accountKey: 'private', token: 'secret' });
    await settle();
    fixture.streams[0].changed({ revision: 7 });
    await settle();
    expect(client.writes).toEqual(['event: ready\ndata: {}\n\n', 'event: change\ndata: {"revision":7}\n\n']);
    expect(fixture.revalidate).toHaveBeenCalledTimes(1);
    expect(client.response.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'private, no-store, no-transform'
    }));
    client.response.emit('close');
  });

  it('notifies a missing header as revision zero and emits a fresh initial revision after reconnect', async () => {
    const fixture = harness();
    const first = fixture.connect();
    fixture.streams[0].changed(null);
    await settle();
    expect(changes(first)).toEqual(['event: change\ndata: {"revision":0}\n\n']);
    first.response.emit('close');
    const second = fixture.connect();
    fixture.streams[1].changed(null);
    await settle();
    expect(changes(second)).toEqual(changes(first));
    second.response.emit('close');
  });

  it('observes external header writes independently in different API instances', async () => {
    const watchers = [];
    const watchStateHeader = vi.fn((accountKey, changed) => {
      watchers.push(changed);
      changed({ revision: 1 });
      return vi.fn();
    });
    const first = harness({ watchStateHeader });
    const second = harness({ watchStateHeader });
    const firstClient = first.connect();
    const secondClient = second.connect();
    await settle();
    watchers.forEach((changed) => changed({ revision: 2 }));
    await settle();
    expect(changes(firstClient)).toEqual(['event: change\ndata: {"revision":1}\n\n', 'event: change\ndata: {"revision":2}\n\n']);
    expect(changes(secondClient)).toEqual(changes(firstClient));
    firstClient.response.emit('close');
    secondClient.response.emit('close');
  });

  it('watches exactly the authoritative header through the existing Admin provider', async () => {
    const unsubscribe = vi.fn();
    const onSnapshot = vi.fn((changed) => {
      changed({ exists: true, data: () => ({ revision: 3, venueName: 'private' }) });
      return unsubscribe;
    });
    const doc = vi.fn(() => ({ onSnapshot }));
    const firestore = vi.fn(() => ({ doc }));
    const app = {};
    const provider = adminProviderModule.createFirebaseAdminProvider({ loadAdminSdk: () => ({
      apps: [app], app: () => app, firestore
    }) });
    const getAdminApp = vi.spyOn(provider, 'getAdminApp');
    const updates = createManagementStateEvents({
      getDatabaseStatus: () => databaseStatus('firebase-admin'), getAdminSdk: provider.getAdminSdk, getAdminApp
    });
    const client = connection();
    updates.connect(client.request, client.response, { accountKey: 'club-one', revalidate: async () => true, getExpiresAt: () => undefined });
    await settle();
    expect(doc).toHaveBeenCalledExactlyOnceWith('orbitAccountStates/club-one');
    expect(firestore).toHaveBeenCalledWith(app);
    expect(getAdminApp).toHaveBeenCalledWith({ allowCredentialsFile: true });
    expect(changes(client)).toEqual(['event: change\ndata: {"revision":3}\n\n']);
    client.response.emit('close');
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('returns explicit unavailability in memory mode without initializing Admin', () => {
    const getAdminApp = vi.fn();
    const getAdminSdk = vi.fn();
    const updates = createManagementStateEvents({ getDatabaseStatus: () => databaseStatus('memory-test'), getAdminApp, getAdminSdk });
    const client = connection();
    updates.connect(client.request, client.response, { accountKey: 'club-one', revalidate: async () => true, getExpiresAt: () => undefined });
    expect(client.response).toMatchObject({ statusCode: 503, body: { code: 'MANAGEMENT_STATE_EVENTS_UNAVAILABLE' } });
    expect(getAdminApp).not.toHaveBeenCalled();
    expect(getAdminSdk).not.toHaveBeenCalled();
    expect(updates.getConnectionCount()).toBe(0);
  });

  it('heartbeats at fifteen seconds and releases the watch at the forty-five-second session limit', async () => {
    vi.useFakeTimers();
    const fixture = harness();
    const client = fixture.connect();
    await vi.advanceTimersByTimeAsync(44_999);
    expect(client.writes.filter((body) => body === 'event: heartbeat\ndata: {}\n\n')).toHaveLength(2);
    expect(fixture.streams[0].unsubscribe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.streams[0].unsubscribe).toHaveBeenCalledOnce();
    expect(client.response.end).toHaveBeenCalledOnce();
    expect(fixture.updates.getConnectionCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('closes at credential expiry and honors a shortened expiry after reauthorization', async () => {
    vi.useFakeTimers();
    const fixture = harness();
    fixture.getExpiresAt.mockReturnValue(Date.now() + 40_000);
    const client = fixture.connect();
    fixture.getExpiresAt.mockReturnValue(Date.now() + 1_000);
    fixture.streams[0].changed({ revision: 1 });
    await settle();
    await vi.advanceTimersByTimeAsync(999);
    expect(client.response.end).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(client.response.end).toHaveBeenCalledOnce();
    expect(fixture.streams[0].unsubscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects an already expired credential before starting the watch', () => {
    const fixture = harness();
    fixture.getExpiresAt.mockReturnValue(Date.now() - 1);
    const client = fixture.connect();
    expect(client.response.statusCode).toBe(403);
    expect(fixture.watchStateHeader).not.toHaveBeenCalled();
  });

  it.each(['response-close', 'response-error', 'request-aborted', 'request-error'])('cleans up exactly once on %s', async (reason) => {
    vi.useFakeTimers();
    const fixture = harness();
    const client = fixture.connect();
    if (reason === 'response-close') client.response.emit('close');
    if (reason === 'response-error') client.response.emit('error', new Error('private'));
    if (reason === 'request-aborted') client.request.emit('aborted');
    if (reason === 'request-error') client.request.emit('error', new Error('private'));
    fixture.streams[0].changed({ revision: 8 });
    fixture.streams[0].failed();
    await settle();
    expect(fixture.streams[0].unsubscribe).toHaveBeenCalledOnce();
    expect(changes(client)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(client.request.listenerCount('aborted')).toBe(0);
    expect(client.response.listenerCount('close')).toBe(0);
  });

  it('retires a slow client on change-event backpressure', async () => {
    const fixture = harness();
    const client = fixture.connect();
    client.response.write.mockReturnValueOnce(false);
    fixture.streams[0].changed({ revision: 4 });
    await settle();
    expect(client.response.end).toHaveBeenCalledOnce();
    expect(fixture.streams[0].unsubscribe).toHaveBeenCalledOnce();
  });

  it('never creates a watch when the initial ready write applies backpressure', () => {
    const fixture = harness();
    const client = connection();
    client.response.write.mockReturnValue(false);
    fixture.updates.connect(client.request, client.response, { accountKey: 'club-one', revalidate: async () => true, getExpiresAt: () => undefined });
    expect(fixture.watchStateHeader).not.toHaveBeenCalled();
    expect(fixture.updates.getConnectionCount()).toBe(0);
  });

  it('releases connection capacity when headers cannot be written', () => {
    const fixture = harness();
    const client = connection();
    client.response.writeHead.mockImplementation(() => { throw new Error('Disconnected transport'); });
    fixture.updates.connect(client.request, client.response, { accountKey: 'club-one', revalidate: async () => true, getExpiresAt: () => undefined });
    expect(fixture.watchStateHeader).not.toHaveBeenCalled();
    expect(fixture.updates.getConnectionCount()).toBe(0);
    expect(client.request.listenerCount('aborted')).toBe(0);
  });

  it('cleans up a synchronous watch failure and never streams its error', () => {
    const unsubscribe = vi.fn();
    const fixture = harness({ watchStateHeader: (_account, _changed, failed) => { failed(); return unsubscribe; } });
    const client = fixture.connect();
    expect(client.response.end).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(client.writes).toEqual(['event: ready\ndata: {}\n\n']);
  });

  it('closes quietly when a watch setup or auth recheck throws', async () => {
    const failingWatch = harness({ watchStateHeader: () => { throw new Error('private provider error'); } });
    const failed = failingWatch.connect();
    expect(failed.response.end).toHaveBeenCalledOnce();
    expect(failed.writes).toEqual(['event: ready\ndata: {}\n\n']);
    const fixture = harness();
    fixture.revalidate.mockRejectedValue(new Error('private auth error'));
    const client = fixture.connect();
    fixture.streams[0].changed({ revision: 2 });
    await settle();
    expect(client.response.end).toHaveBeenCalledOnce();
    expect(changes(client)).toEqual([]);
  });

  it('stops revision activity immediately when reauthorization is denied', async () => {
    const fixture = harness();
    const client = fixture.connect();
    fixture.streams[0].changed({ revision: 1 });
    await settle();
    fixture.revalidate.mockResolvedValue(false);
    fixture.streams[0].changed({ revision: 2 });
    await settle();
    expect(changes(client)).toEqual(['event: change\ndata: {"revision":1}\n\n']);
    expect(client.response.end).toHaveBeenCalledOnce();
    expect(fixture.streams[0].unsubscribe).toHaveBeenCalledOnce();
  });

  it('serializes rechecks, coalesces pending revisions, and ignores late auth after disconnect', async () => {
    /** @type {{ finish?: (allowed: boolean) => void }} */
    const pending = {};
    const fixture = harness();
    fixture.revalidate.mockImplementationOnce(() => new Promise((resolve) => { pending.finish = resolve; }));
    const client = fixture.connect();
    fixture.streams[0].changed({ revision: 1 });
    fixture.streams[0].changed({ revision: 2 });
    fixture.streams[0].changed({ revision: 3 });
    expect(fixture.revalidate).toHaveBeenCalledTimes(1);
    if (!pending.finish) throw new Error('Expected an in-flight authorization check.');
    pending.finish(true);
    await settle();
    await settle();
    expect(changes(client)).toEqual(['event: change\ndata: {"revision":1}\n\n', 'event: change\ndata: {"revision":3}\n\n']);
    fixture.revalidate.mockImplementationOnce(() => new Promise((resolve) => { pending.finish = resolve; }));
    fixture.streams[0].changed({ revision: 4 });
    client.response.emit('close');
    pending.finish(true);
    await settle();
    expect(changes(client)).toHaveLength(2);
  });

  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, undefined])('closes instead of emitting invalid revision %s', async (revision) => {
    const fixture = harness();
    const client = fixture.connect();
    fixture.streams[0].changed({ revision });
    await settle();
    expect(changes(client)).toEqual([]);
    expect(client.response.end).toHaveBeenCalledOnce();
    expect(fixture.streams[0].unsubscribe).toHaveBeenCalledOnce();
  });

  it('bounds connection count and releases capacity after disconnect', () => {
    const fixture = harness({ maximumConnections: 1 });
    const first = fixture.connect();
    const rejected = fixture.connect();
    expect(rejected.response.statusCode).toBe(503);
    expect(rejected.response.body).toEqual({ ok: false, code: 'MANAGEMENT_STATE_EVENTS_CAPACITY' });
    expect(fixture.watchStateHeader).toHaveBeenCalledTimes(1);
    first.response.emit('close');
    const next = fixture.connect();
    expect(fixture.watchStateHeader).toHaveBeenCalledTimes(2);
    next.response.emit('close');
  });
});
