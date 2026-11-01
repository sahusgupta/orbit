import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { getEventListeners } from 'node:events';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sourceRequire = createRequire(__filename);
const sourcePath = sourceRequire.resolve('./firebasePublisher.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const { protectedIdentifier } = sourceRequire('./operations/dataProtection');
const budget = 30_000;
const projectId = 'demo-orbit-deadline';
const clubId = 'synthetic-deadline-club';
const documentPrefix = `projects/${projectId}/databases/(default)/documents/`;
const restPrefix = `https://firestore.googleapis.com/v1/${documentPrefix.slice(0, -1)}`;
const batchEndpoint = `${restPrefix}:batchWrite`;
const playerPath = `clubs/${clubId}/players`;
const parentPath = `clubs/${clubId}`;
const sensitive = 'private.fixture@example.invalid /private/player/path inert-private-token';
const fixtures = [];

/**
 * @template T
 * @typedef {{ promise: Promise<T>, resolve: (value: T) => void, reject: (reason: unknown) => void }} Deferred
 */
/**
 * @typedef {{ delete?: string, update?: { name: string, fields: Record<string, unknown> } }} FixtureWrite
 * @typedef {{
 *   stage: string, method: string, url: string,
 *   init: { method?: string, headers?: Record<string, string>, body?: string | URLSearchParams, signal?: AbortSignal },
 *   writes?: FixtureWrite[], payload: unknown
 * }} FixtureRequest
 * @typedef {{
 *   ok: boolean, status: number,
 *   json: import('vitest').Mock<() => Promise<unknown>>,
 *   text: import('vitest').Mock<() => Promise<string>>,
 *   body: { cancel: import('vitest').Mock<() => Promise<void>> }
 * }} FixtureResponse
 * @typedef {<T>(value: T) => Deferred<T>} Hold
 * @typedef {{ ok: boolean, status: number, json: () => Promise<unknown>, text: () => Promise<string> }} ConsumedResponse
 */
/**
 * @template T
 * @typedef {{ request: FixtureRequest, control: Deferred<T> }} StalledRequest
 */
/** @template T @returns {Deferred<T>} */
function deferred() {
  /** @type {(value: T) => void} */
  let resolve;
  /** @type {(reason: unknown) => void} */
  let reject;
  /** @type {Promise<T>} */
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function observe(promise) {
  const result = { state: 'pending', value: undefined, error: undefined, observed: undefined };
  // Observe immediately so negative cases and late rejected losers cannot become
  // accidental unhandled rejections while an assertion is failing.
  result.observed = Promise.resolve(promise).then(
    value => { result.state = 'fulfilled'; result.value = value; },
    error => { result.state = 'rejected'; result.error = error; }
  );
  return result;
}

async function flush() {
  for (let index = 0; index < 256; index += 1) await Promise.resolve();
}

/**
 * Every request and signing operation is synthetic; credential-file access is
 * forbidden. Fake timers and standard AbortController globals live in the VM.
 * @param {{ intercept?: (details: {
 *   request: FixtureRequest, normal: FixtureResponse, hold: Hold,
 *   response: (request: FixtureRequest, payload: unknown, overrides?: Partial<FixtureResponse>) => FixtureResponse,
 *   reads: Array<{ kind: string, stage: string }>, cancellations: string[]
 * }) => unknown }} [options]
 */
function fixture({ intercept } = {}) {
  const requests = [];
  const reads = [];
  const cancellations = [];
  const tasks = [];
  /** @type {Array<() => void>} */
  const deferrals = [];
  const ownedTimers = new Set();
  let playerLists = 0;
  const state = {
    settings: { clubAccount: { clubName: 'Synthetic Deadline Club' }, pilotAccess: { licenseId: clubId } },
    profiles: [{ id: 'profile-0', name: 'Synthetic Player' }],
    games: [], sessions: [], playerSessions: [], interests: [], buyIns: [], drops: []
  };
  const document = (collection, id, fields) => ({ name: `${documentPrefix}clubs/${clubId}/${collection}/${id}`, fields });
  const legacyPlayer = document('players', 'legacy-0', { sourceProfileId: { stringValue: 'profile-0' }, syncSource: { stringValue: 'orbit-desktop' } });
  const staleGame = document('games', 'stale-0', { syncSource: { stringValue: 'orbit-api' } });
  /** @template T @param {T} value @returns {Deferred<T>} */
  function hold(value) {
    /** @type {Deferred<T>} */
    const control = deferred();
    deferrals.push(() => control.resolve(value));
    return control;
  }
  /** @param {FixtureRequest} request @param {unknown} payload @param {Partial<FixtureResponse>} [overrides] */
  function response(request, payload, overrides = {}) {
    return {
      ok: true, status: 200,
      json: vi.fn(async () => { reads.push({ kind: 'json', stage: request.stage }); return structuredClone(payload); }),
      text: vi.fn(async () => { reads.push({ kind: 'text', stage: request.stage }); return ''; }),
      body: { cancel: vi.fn(() => { cancellations.push(request.stage); return Promise.resolve(); }) },
      ...overrides
    };
  }
  async function fetchFixture(input, init = {}) {
    const url = new URL(String(input));
    const method = init.method || 'GET';
    let stage;
    let payload;
    let writes;
    if (url.href === 'https://oauth2.googleapis.com/token' && method === 'POST') {
      stage = 'token'; payload = { access_token: 'inert-deadline-token' };
    } else {
      assert.equal(url.origin, 'https://firestore.googleapis.com');
      if (url.href === batchEndpoint && method === 'POST') {
        writes = JSON.parse(String(init.body)).writes;
        assert.ok(writes.length > 0 && writes.length <= 250);
        stage = writes.every(write => typeof write.delete === 'string')
          ? (writes[0].delete.includes('/legacy-') ? 'legacy' : 'stale') : 'batch';
        payload = { status: writes.map(() => ({})) };
      } else if (url.href === `${restPrefix}/${parentPath}` && method === 'PATCH') {
        stage = 'parent'; payload = { fields: JSON.parse(String(init.body)).fields };
      } else {
        assert.equal(method, 'GET');
        assert.equal(url.searchParams.get('pageSize'), '500');
        const collection = url.pathname.split('/').at(-1);
        assert.ok(['players', 'games', 'gameSessions', 'memberships', 'waitlists', 'notifications', 'tournaments', 'tournamentInterests'].includes(collection));
        if (collection === 'players') playerLists += 1;
        stage = collection === 'players' && playerLists > 1 ? 'legacy-list' : 'projection-list';
        payload = { documents: collection === 'players' ? [legacyPlayer] : collection === 'games' ? [staleGame] : [] };
      }
    }
    const request = { stage, method, url: url.href, init, writes, payload };
    requests.push(request);
    const normal = response(request, payload);
    if (intercept) {
      const result = intercept({ request, normal, response, hold, reads, cancellations });
      if (result !== undefined) return result;
    }
    return normal;
  }
  const module = { exports: {} };
  const fixtureCrypto = { ...crypto, createSign: () => ({ update() { return this; }, sign() { return 'synthetic-signature'; } }) };
  // Expose the private helper only inside this VM; production exports stay intact.
  vm.runInNewContext(`${source}\nmodule.exports.__testWithFirebaseResponse = withFirebaseResponse;`, {
    module, Buffer, Date, JSON, URL, URLSearchParams, Error, AbortController, AbortSignal, DOMException,
    setTimeout(callback, delay, ...args) {
      const handle = setTimeout(() => { ownedTimers.delete(handle); callback(...args); }, delay);
      ownedTimers.add(handle); return handle;
    },
    clearTimeout(handle) { ownedTimers.delete(handle); clearTimeout(handle); },
    process: { env: { NODE_ENV: 'test', FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      project_id: projectId, client_email: 'synthetic-deadline@example.invalid', private_key: 'unused-fixture'
    }) } },
    fetch: fetchFixture,
    require(name) {
      if (name === 'crypto') return fixtureCrypto;
      if (name === 'fs') return { readFileSync() { throw new Error('Credential file access forbidden in deadline fixture.'); } };
      if (name === './orbitCore' || name === './operations/dataProtection') return sourceRequire(name);
      throw new Error('Unexpected publisher dependency in isolated deadline fixture.');
    }
  }, { filename: sourcePath });
  const publisher = module.exports;
  const api = {
    publisher, requests, reads, cancellations, ownedTimers, hold,
    track(promise) { const result = observe(promise); tasks.push(result); return result; },
    publish() { return api.track(publisher.publishStateToFirebase(state, { savedAt: '2026-10-31T00:00:00.000Z', syncRevision: 'deadline-revision' })); },
    batch(count = 251) { return api.track(publisher.batchWriteDocuments(projectId, 'inert-deadline-token',
      Array.from({ length: count }, (_, index) => ({ update: { name: `${documentPrefix}synthetic/${index}`, fields: {} } })))); },
    cleanup() { return api.track(publisher.deleteStaleOwnedProjectionDocuments(projectId, 'inert-deadline-token', clubId, {})); },
    patch() { return api.track(publisher.patchDocument(projectId, 'inert-deadline-token', parentPath, { syncRevision: 'deadline-revision' })); },
    /** @template T @param {AbortSignal} signal @param {(response: ConsumedResponse) => Promise<T>} consume */
    requestWithSignal(signal, consume) {
      return api.track(publisher.__testWithFirebaseResponse('caller-signal-probe', `${restPrefix}/${parentPath}`, {
        method: 'PATCH', headers: { authorization: 'Bearer inert-deadline-token', 'content-type': 'application/json' },
        body: JSON.stringify({ fields: {} }), signal
      }, parentPath, consume));
    },
    async finish() {
      // Release every stalled synthetic resource even when the OLD source fails
      // a deadline assertion. No deferred transport outlives the fixture.
      for (const release of deferrals) release();
      await flush();
      await vi.advanceTimersByTimeAsync(budget + 1);
      await flush();
      for (const task of tasks) {
        assert.notEqual(task.state, 'pending', 'Synthetic task did not settle during forced fixture cleanup.');
        await task.observed;
      }
      for (const handle of ownedTimers) clearTimeout(handle);
      ownedTimers.clear();
    }
  };
  fixtures.push(api);
  return api;
}

const cases = [
  { stage: 'token', invoke: f => f.publish(), category: 'token-request', jsonCategory: 'token-response-invalid', fetchPath: '', bodyPath: '' },
  { stage: 'batch', invoke: f => f.batch(), category: 'batch-write', jsonCategory: 'batch-write-response-invalid', fetchPath: '', bodyPath: batchEndpoint },
  { stage: 'projection-list', invoke: f => f.cleanup(), category: 'projection-list', jsonCategory: 'projection-list-response-invalid', fetchPath: playerPath, bodyPath: playerPath },
  { stage: 'legacy-list', invoke: f => f.publish(), category: 'player-list', jsonCategory: 'player-list-response-invalid', fetchPath: playerPath, bodyPath: playerPath },
  { stage: 'parent', invoke: f => f.patch(), category: 'document-write', fetchPath: '', bodyPath: parentPath }
];
const reference = value => value ? protectedIdentifier(value) : '';
function contract(error, category, status, pathValue) {
  expect(error).toMatchObject({ name: 'FirebasePublicationError', code: 'FIREBASE_PUBLICATION_FAILED',
    category, status, pathRef: reference(pathValue), responseRef: expect.stringMatching(/^[a-f0-9]{16}$/) });
  for (const forbidden of sensitive.split(' ')) expect(JSON.stringify({ error, message: error.message })).not.toContain(forbidden);
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(async () => {
  try { for (const f of fixtures.splice(0)) await f.finish(); }
  finally { vi.clearAllTimers(); vi.useRealTimers(); }
});

describe('private request caller cancellation', () => {
  it('rejects an already aborted caller before dispatch without retaining timers or listeners', async () => {
    const caller = new AbortController();
    caller.abort(new Error(sensitive));
    const f = fixture();
    const consume = vi.fn(async response => response.json());
    const outcome = f.requestWithSignal(caller.signal, consume); await flush();
    expect(outcome.state).toBe('rejected'); contract(outcome.error, 'caller-signal-probe', 0, parentPath);
    expect(outcome.error.responseRef).toBe(reference(sensitive));
    expect(f.requests).toEqual([]); expect(consume).not.toHaveBeenCalled();
    expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0); expect(f.ownedTimers.size).toBe(0);
  });

  it('rejects caller cancellation during headers and cancels a late response without consuming it', async () => {
    const caller = new AbortController();
    /** @type {(StalledRequest<FixtureResponse> & { normal: FixtureResponse }) | undefined} */
    let target;
    const f = fixture({ intercept: ({ request, normal, hold }) => {
      if (request.stage === 'parent') { target = { request, normal, control: hold(normal) }; return target.control.promise; }
    } });
    const consume = vi.fn(async response => response.json());
    const outcome = f.requestWithSignal(caller.signal, consume); await flush(); assert.ok(target);
    expect(outcome.state).toBe('pending'); expect(f.ownedTimers.size).toBe(1);
    expect(target.request.init.signal).not.toBe(caller.signal);
    expect(getEventListeners(caller.signal, 'abort')).toHaveLength(1);
    caller.abort(new Error(sensitive)); await flush();
    expect(outcome.state).toBe('rejected'); contract(outcome.error, 'caller-signal-probe', 0, parentPath);
    expect(outcome.error.responseRef).toBe(reference(sensitive)); expect(target.request.init.signal.aborted).toBe(true);
    expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0); expect(f.ownedTimers.size).toBe(0);
    target.control.resolve(target.normal); await flush();
    expect(consume).not.toHaveBeenCalled(); expect(target.normal.json).not.toHaveBeenCalled();
    expect(target.normal.text).not.toHaveBeenCalled(); expect(target.normal.body.cancel).toHaveBeenCalledTimes(1);
    expect(f.requests).toHaveLength(1); expect(outcome.state).toBe('rejected');
  });

  it('lets the consuming callback translate cancellation during a body without late continuation', async () => {
    const caller = new AbortController();
    /** @type {StalledRequest<unknown> | undefined} */
    let target;
    let continuations = 0;
    const f = fixture({ intercept: ({ request, normal, hold }) => {
      if (request.stage === 'parent') {
        const control = hold(request.payload); target = { request, control };
        return { ...normal, json: () => control.promise };
      }
    } });
    const outcome = f.requestWithSignal(caller.signal, async response => {
      try {
        const value = await response.json(); continuations += 1; return value;
      } catch (error) {
        throw new f.publisher.FirebasePublicationError('caller-body-response-invalid', {
          pathRef: reference(parentPath), responseRef: reference(error instanceof Error ? error.message : 'caller-body-failed')
        });
      }
    });
    await flush(); assert.ok(target);
    expect(outcome.state).toBe('pending'); expect(f.ownedTimers.size).toBe(1);
    expect(getEventListeners(caller.signal, 'abort')).toHaveLength(1);
    caller.abort(new Error(sensitive)); await flush();
    expect(outcome.state).toBe('rejected'); contract(outcome.error, 'caller-body-response-invalid', 0, parentPath);
    expect(outcome.error.responseRef).toBe(reference(sensitive)); expect(target.request.init.signal.aborted).toBe(true);
    const errorAtCancellation = outcome.error;
    target.control.resolve(target.request.payload); await flush();
    expect(continuations).toBe(0); expect(outcome.error).toBe(errorAtCancellation); expect(f.requests).toHaveLength(1);
    expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0); expect(f.ownedTimers.size).toBe(0);
  });

  it('removes caller listeners and timers after success or failure and ignores later caller abort', async () => {
    for (const mode of ['success', 'failure']) {
      const caller = new AbortController();
      const f = fixture({ intercept: ({ request }) => {
        if (mode === 'failure' && request.stage === 'parent') throw new Error(sensitive);
      } });
      const outcome = f.requestWithSignal(caller.signal, async response => response.json()); await flush();
      expect(outcome.state).toBe(mode === 'success' ? 'fulfilled' : 'rejected'); expect(f.requests).toHaveLength(1);
      if (mode === 'failure') contract(outcome.error, 'caller-signal-probe', 0, parentPath);
      const completed = { state: outcome.state, value: outcome.value, error: outcome.error,
        reason: f.requests[0].init.signal.reason, cancellations: [...f.cancellations] };
      expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0); expect(f.ownedTimers.size).toBe(0);
      caller.abort(new Error('Synthetic caller cancellation after completion.')); await flush();
      expect(outcome.state).toBe(completed.state); expect(outcome.value).toBe(completed.value);
      expect(outcome.error).toBe(completed.error); expect(f.requests[0].init.signal.reason).toBe(completed.reason);
      expect(f.cancellations).toEqual(completed.cancellations); expect(f.requests).toHaveLength(1);
      expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0); expect(f.ownedTimers.size).toBe(0);
    }
  });
});

describe('current transport characterization', () => {
  it('retains provider-bounded acknowledgements and unchanged write payloads', async () => {
    const f = fixture(); const outcome = f.batch(501); await flush();
    expect(outcome.state).toBe('fulfilled'); expect(outcome.value).toBe(501);
    expect(f.requests.map(request => request.writes.length)).toEqual([250, 250, 1]);
    expect(f.requests.every(request => request.url === batchEndpoint && request.method === 'POST'
      && request.init.headers.authorization === 'Bearer inert-deadline-token')).toBe(true);
    expect(f.reads).toEqual(Array.from({ length: 3 }, () => ({ kind: 'json', stage: 'batch' })));
    expect(f.ownedTimers.size).toBe(0);
  });
  it('retains token, projection, stale cleanup, fresh legacy cleanup and parent-last ordering', async () => {
    const f = fixture(); const outcome = f.publish(); await flush();
    expect(outcome.state).toBe('fulfilled');
    expect(outcome.value).toMatchObject({ ok: true, syncRevision: 'deadline-revision', staleProjectionDocumentsRemoved: 1, legacyPlayersRemoved: 1 });
    expect(f.requests.map(request => request.stage)).toEqual(['token', 'batch',
      ...Array(8).fill('projection-list'), 'stale', 'legacy-list', 'legacy', 'parent']);
    expect(JSON.parse(String(f.requests.at(-1).init.body)).fields.syncRevision).toEqual({ stringValue: 'deadline-revision' });
    expect(f.reads.some(read => read.stage === 'parent')).toBe(false);
    expect(f.ownedTimers.size).toBe(0);
  });
  it('acknowledges successful PATCH at headers without reading or validating its body', async () => {
    const f = fixture({ intercept: ({ request, normal }) => request.stage === 'parent'
      ? { ...normal, json: vi.fn(() => { throw new Error('PATCH JSON must remain unused.'); }), text: vi.fn(() => { throw new Error('PATCH text must remain unused.'); }) } : undefined });
    const outcome = f.patch(); await flush();
    expect(outcome.state).toBe('fulfilled'); expect(outcome.value).toBeUndefined();
    expect(f.reads).toEqual([]); expect(f.ownedTimers.size).toBe(0);
  });
  it.each(cases)('retains $stage HTTP error status, exact references and redaction', async item => {
    const f = fixture({ intercept: ({ request, normal }) => request.stage === item.stage
      ? { ...normal, ok: false, status: 403, text: async () => sensitive } : undefined });
    const outcome = item.invoke(f); await flush();
    expect(outcome.state).toBe('rejected'); contract(outcome.error, item.category, 403, item.bodyPath);
    expect(outcome.error.responseRef).toBe(reference(sensitive)); expect(f.ownedTimers.size).toBe(0);
  });
  it.each(cases)('retains $stage transport rejection category and original path-ref presence', async item => {
    const f = fixture({ intercept: ({ request }) => { if (request.stage === item.stage) throw new Error(sensitive); } });
    const outcome = item.invoke(f); await flush();
    expect(outcome.state).toBe('rejected'); contract(outcome.error, item.category, 0, item.fetchPath);
    expect(outcome.error.responseRef).toBe(reference(sensitive)); expect(f.ownedTimers.size).toBe(0);
  });
  it.each(cases)('retains $stage unreadable error-body fallback without losing HTTP status', async item => {
    const f = fixture({ intercept: ({ request, normal }) => request.stage === item.stage
      ? { ...normal, ok: false, status: 403, text: async () => { throw new Error(sensitive); } } : undefined });
    const outcome = item.invoke(f); await flush();
    expect(outcome.state).toBe('rejected'); contract(outcome.error, item.category, 403, item.bodyPath);
    expect(outcome.error.responseRef).toBe(reference('unreadable-provider-response')); expect(f.ownedTimers.size).toBe(0);
  });
  it.each(cases.filter(item => item.jsonCategory))('retains $stage JSON failure category with status zero', async item => {
    const f = fixture({ intercept: ({ request, normal }) => request.stage === item.stage
      ? { ...normal, json: async () => { throw new Error(sensitive); } } : undefined });
    const outcome = item.invoke(f); await flush();
    expect(outcome.state).toBe('rejected'); contract(outcome.error, item.jsonCategory, 0, item.bodyPath);
    expect(outcome.error.responseRef).toBe(reference(sensitive)); expect(f.ownedTimers.size).toBe(0);
  });
  it('retains partial batch failure and prevents the remaining batch', async () => {
    const f = fixture({ intercept: ({ request, normal }) => request.stage === 'batch'
      ? { ...normal, json: async () => ({ status: request.writes.map((_, index) => index ? {} : { code: 7, message: sensitive }) }) } : undefined });
    const outcome = f.batch(); await flush();
    expect(outcome.state).toBe('rejected'); contract(outcome.error, 'batch-write-partial-failure', 0, batchEndpoint);
    expect(f.requests.map(request => request.stage)).toEqual(['batch']); expect(f.ownedTimers.size).toBe(0);
  });
});

describe('missing shared request deadline regressions', () => {
  it.each(cases)('bounds stalled $stage headers even when fetch ignores abort', async item => {
    /** @type {StalledRequest<FixtureResponse> | undefined} */
    let target;
    const f = fixture({ intercept: ({ request, normal, hold }) => {
      if (request.stage === item.stage && !target) { target = { request, control: hold(normal) }; return target.control.promise; }
    } });
    const outcome = item.invoke(f); await flush(); assert.ok(target);
    await vi.advanceTimersByTimeAsync(budget - 1); expect(outcome.state).toBe('pending');
    await vi.advanceTimersByTimeAsync(1); await flush();
    expect(outcome.state).toBe('rejected'); contract(outcome.error, item.category, 0, item.fetchPath);
    expect(target.request.init.signal.aborted).toBe(true); expect(f.ownedTimers.size).toBe(0);
  });
  it.each(cases.filter(item => item.jsonCategory))('bounds stalled $stage 200 JSON without acknowledging it', async item => {
    /** @type {StalledRequest<unknown> | undefined} */
    let target;
    const f = fixture({ intercept: ({ request, normal, hold }) => {
      if (request.stage === item.stage && !target) {
        const control = hold(request.payload); target = { request, control };
        return { ...normal, json: () => control.promise };
      }
    } });
    const outcome = item.invoke(f); await flush(); assert.ok(target);
    await vi.advanceTimersByTimeAsync(budget); await flush();
    expect(outcome.state).toBe('rejected'); contract(outcome.error, item.jsonCategory, 0, item.bodyPath);
    expect(target.request.init.signal.aborted).toBe(true); expect(f.ownedTimers.size).toBe(0);
  });
  it.each(cases)('bounds stalled $stage error text while retaining HTTP status and unreadable-response reference', async item => {
    /** @type {StalledRequest<string> | undefined} */
    let target;
    const f = fixture({ intercept: ({ request, normal, hold }) => {
      if (request.stage === item.stage && !target) {
        const control = hold(sensitive); target = { request, control };
        return { ...normal, ok: false, status: 403, text: () => control.promise };
      }
    } });
    const outcome = item.invoke(f); await flush(); assert.ok(target);
    await vi.advanceTimersByTimeAsync(budget); await flush();
    expect(outcome.state).toBe('rejected'); contract(outcome.error, item.category, 403, item.bodyPath);
    expect(outcome.error.responseRef).toBe(reference('unreadable-provider-response'));
    expect(target.request.init.signal.aborted).toBe(true); expect(f.ownedTimers.size).toBe(0);
  });
  it('uses one total 30-second budget for slow headers plus the consumed JSON body', async () => {
    /** @type {Deferred<Omit<FixtureResponse, 'json'> & { json: () => Promise<unknown> }> | undefined} */
    let headers;
    /** @type {Deferred<unknown> | undefined} */
    let body;
    /** @type {Omit<FixtureResponse, 'json'> & { json: () => Promise<unknown> }} */
    let headerResponse;
    const f = fixture({ intercept: ({ request, normal, hold }) => {
      if (request.stage === 'batch' && !headers) {
        body = hold(request.payload); headerResponse = { ...normal, json: () => body.promise };
        headers = hold(headerResponse); return headers.promise;
      }
    } });
    const outcome = f.batch(); await flush(); assert.ok(headers);
    await vi.advanceTimersByTimeAsync(20_000); headers.resolve(headerResponse); await flush();
    expect(outcome.state).toBe('pending');
    await vi.advanceTimersByTimeAsync(9_999); expect(outcome.state).toBe('pending');
    await vi.advanceTimersByTimeAsync(1); await flush();
    expect(outcome.state).toBe('rejected'); contract(outcome.error, 'batch-write-response-invalid', 0, batchEndpoint);
    expect(f.requests).toHaveLength(1); expect(f.ownedTimers.size).toBe(0);
  });
  it('cancels a late response without reading it or starting another write', async () => {
    /** @type {(StalledRequest<FixtureResponse> & { normal: FixtureResponse }) | undefined} */
    let target;
    const f = fixture({ intercept: ({ request, normal, hold }) => {
      if (request.stage === 'batch' && !target) { target = { request, normal, control: hold(normal) }; return target.control.promise; }
    } });
    const outcome = f.batch(); await flush(); assert.ok(target); await vi.advanceTimersByTimeAsync(budget); await flush();
    const stateAtDeadline = outcome.state;
    target.control.resolve(target.normal); await flush();
    expect(stateAtDeadline).toBe('rejected'); expect(outcome.state).toBe('rejected');
    expect(target.normal.json).not.toHaveBeenCalled(); expect(target.normal.text).not.toHaveBeenCalled();
    expect(target.normal.body.cancel).toHaveBeenCalledTimes(1); expect(f.requests).toHaveLength(1);
    expect(f.ownedTimers.size).toBe(0);
  });
  it('ignores a late acknowledged child body without proceeding to cleanup or parent marker', async () => {
    /** @type {StalledRequest<unknown> | undefined} */
    let target;
    const f = fixture({ intercept: ({ request, normal, hold }) => {
      if (request.stage === 'batch' && !target) {
        const control = hold(request.payload); target = { request, control };
        return { ...normal, json: () => control.promise };
      }
    } });
    const outcome = f.publish(); await flush(); assert.ok(target); await vi.advanceTimersByTimeAsync(budget); await flush();
    const stateAtDeadline = outcome.state;
    target.control.resolve(target.request.payload); await flush();
    expect(stateAtDeadline).toBe('rejected'); expect(outcome.state).toBe('rejected');
    expect(f.requests.map(request => request.stage)).toEqual(['token', 'batch']); expect(f.ownedTimers.size).toBe(0);
  });
  it('observes a late rejected fetch without resuming the retired publication', async () => {
    /** @type {Deferred<FixtureResponse> | undefined} */
    let target;
    const f = fixture({ intercept: ({ request, normal, hold }) => {
      if (request.stage === 'batch' && !target) { target = hold(normal); return target.promise; }
    } });
    const outcome = f.publish(); await flush(); assert.ok(target); await vi.advanceTimersByTimeAsync(budget); await flush();
    const stateAtDeadline = outcome.state;
    target.reject(new Error(sensitive)); await flush();
    expect(stateAtDeadline).toBe('rejected'); expect(outcome.state).toBe('rejected');
    expect(f.requests.map(request => request.stage)).toEqual(['token', 'batch']); expect(f.ownedTimers.size).toBe(0);
  });
  it('observes late rejected JSON without changing the settled deadline failure', async () => {
    /** @type {Deferred<unknown> | undefined} */
    let target;
    const f = fixture({ intercept: ({ request, normal, hold }) => {
      if (request.stage === 'batch' && !target) {
        target = hold(request.payload); return { ...normal, json: () => target.promise };
      }
    } });
    const outcome = f.publish(); await flush(); assert.ok(target); await vi.advanceTimersByTimeAsync(budget); await flush();
    const stateAtDeadline = outcome.state; const errorAtDeadline = outcome.error;
    target.reject(new Error(sensitive)); await flush();
    expect(stateAtDeadline).toBe('rejected'); expect(outcome.error).toBe(errorAtDeadline);
    expect(f.requests.map(request => request.stage)).toEqual(['token', 'batch']); expect(f.ownedTimers.size).toBe(0);
  });
  it('ignores late error text without replacing the settled fallback reference', async () => {
    /** @type {Deferred<string> | undefined} */
    let target;
    const f = fixture({ intercept: ({ request, normal, hold }) => {
      if (request.stage === 'parent') {
        target = hold(sensitive); return { ...normal, ok: false, status: 403, text: () => target.promise };
      }
    } });
    const outcome = f.patch(); await flush(); assert.ok(target); await vi.advanceTimersByTimeAsync(budget); await flush();
    const stateAtDeadline = outcome.state; const errorAtDeadline = outcome.error;
    target.resolve(sensitive); await flush();
    expect(stateAtDeadline).toBe('rejected'); expect(outcome.error).toBe(errorAtDeadline);
    contract(outcome.error, 'document-write', 403, parentPath);
    expect(outcome.error.responseRef).toBe(reference('unreadable-provider-response')); expect(f.ownedTimers.size).toBe(0);
  });
  it.each(['resolve', 'reject', 'stall'])('releases an unused PATCH body without waiting for cancellation: %s', async mode => {
    /** @type {{ request: FixtureRequest, normal: FixtureResponse } | undefined} */
    let target;
    const f = fixture({ intercept: ({ request, normal, hold }) => {
      if (request.stage === 'parent') {
        const pending = hold(undefined);
        target = { request, normal };
        normal.body.cancel.mockImplementation(() => mode === 'reject' ? Promise.reject(new Error('Synthetic cleanup rejection.'))
          : mode === 'stall' ? pending.promise : Promise.resolve());
        return normal;
      }
    } });
    const outcome = f.patch(); await flush(); assert.ok(target);
    expect(outcome.state).toBe('fulfilled'); expect(outcome.value).toBeUndefined();
    expect(target.normal.json).not.toHaveBeenCalled(); expect(target.normal.text).not.toHaveBeenCalled();
    expect(target.request.init.signal?.aborted === true || target.normal.body.cancel.mock.calls.length === 1).toBe(true);
    expect(f.ownedTimers.size).toBe(0);
  });
  it('keeps concurrent request controllers and deadlines independent', async () => {
    /** @type {StalledRequest<FixtureResponse> | undefined} */
    let stalled;
    const f = fixture({ intercept: ({ request, normal, hold }) => {
      if (request.stage === 'batch' && !stalled) { stalled = { request, control: hold(normal) }; return stalled.control.promise; }
    } });
    const batch = f.batch(); await flush(); assert.ok(stalled);
    await vi.advanceTimersByTimeAsync(10_000); const patch = f.patch(); await flush();
    expect(patch.state).toBe('fulfilled');
    expect(stalled.request.init.signal?.aborted).toBe(false); expect(f.ownedTimers.size).toBe(1);
    await vi.advanceTimersByTimeAsync(19_999); expect(batch.state).toBe('pending');
    await vi.advanceTimersByTimeAsync(1); await flush();
    expect(batch.state).toBe('rejected'); expect(stalled.request.init.signal.aborted).toBe(true);
    expect(f.ownedTimers.size).toBe(0);
  });
});
