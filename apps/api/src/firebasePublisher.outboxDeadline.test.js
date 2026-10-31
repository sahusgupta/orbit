import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rootRequire = createRequire(__filename);
const sourcePath = rootRequire.resolve('./firebasePublisher.js');
const connection = rootRequire('./db/connection.js');
const outbox = rootRequire('./db/publicationOutbox.js');
const stateStore = rootRequire('./db/state.js');
const projectId = 'demo-orbit-deadline-outbox';
const accountKey = 'synthetic-outbox-club';
const prefix = `projects/${projectId}/databases/(default)/documents/`;
const restPrefix = `https://firestore.googleapis.com/v1/${prefix.slice(0, -1)}`;
/** @type {Array<{ cleanup(): Promise<void> }>} */
const fixtures = [];
/** @type {unknown[][]} */
const warnings = [];

/** @typedef {NonNullable<Awaited<ReturnType<typeof outbox.claimNextPublication>>>} PublicationClaim */
/** @typedef {Awaited<ReturnType<typeof outbox.publishClaimed>>} PublicationResult */
/** @typedef {Awaited<ReturnType<typeof connection.getDatabase>>} TestDatabase */
/** @typedef {{ settled: boolean, value?: PublicationResult, error?: unknown, promise: Promise<void> }} PublicationObservation */
/** @typedef {{ url: string, method: string, signal?: AbortSignal | null, body?: RequestInit['body'] }} RecordedRequest */

function state(name = 'Synthetic Player') {
  return {
    settings: { clubAccount: { clubName: 'Synthetic Outbox Club' }, pilotAccess: { licenseId: accountKey } },
    profiles: name ? [{ id: 'profile-0', name }] : [],
    games: [], sessions: [], playerSessions: [], interests: [], buyIns: [], drops: [],
    ...(name ? {} : { playerPrivacyTombstones: ['synthetic-deleted-subject'] })
  };
}

async function flush() {
  for (let index = 0; index < 256; index += 1) await Promise.resolve();
}

/** @param {'network' | 'headers' | 'body'} mode */
function fixture(mode) {
  /** @type {RecordedRequest[]} */
  const requests = [];
  /** @type {Array<{ savedAt: string, syncRevision: string }>} */
  const publicationOptions = [];
  /** @type {Array<{ reject(reason: unknown): void }>} */
  const controls = [];
  /** @type {Promise<void>[]} */
  const tasks = [];
  const finalizer = vi.fn();
  const scheduler = vi.fn();
  let intercepted = false;
  /** @param {AbortSignal | null | undefined} signal */
  function hold(signal) {
    /** @type {(reason: unknown) => void} */
    let rejectPromise = () => undefined;
    /** @type {Promise<unknown>} */
    const promise = new Promise((_yes, no) => { rejectPromise = no; });
    const aborted = () => rejectPromise(new DOMException('Synthetic transport aborted.', 'AbortError'));
    signal?.addEventListener('abort', aborted, { once: true });
    const cleanup = () => signal?.removeEventListener('abort', aborted);
    promise.then(cleanup, cleanup);
    controls.push({ reject: rejectPromise });
    return promise;
  }
  /** @param {unknown} payload */
  const json = payload => ({
    ok: true, status: 200,
    json: async () => structuredClone(payload), text: async () => '',
    body: { cancel: async () => undefined }
  });
  /** @param {string | URL} input @param {RequestInit} [init] */
  async function fetchFixture(input, init = {}) {
    const url = new URL(String(input));
    const method = init.method || 'GET';
    const request = { url: url.href, method, signal: init.signal, body: init.body };
    requests.push(request);
    if (url.href === 'https://oauth2.googleapis.com/token' && method === 'POST') {
      return json({ access_token: 'inert-outbox-fixture-token' });
    }
    assert.equal(url.origin, 'https://firestore.googleapis.com');
    if (url.href === `${restPrefix}:batchWrite` && method === 'POST') {
      const { writes } = JSON.parse(String(init.body));
      assert.ok(Array.isArray(writes) && writes.length > 0 && writes.length <= 250);
      const response = json({ status: writes.map(() => ({})) });
      if (!intercepted) {
        intercepted = true;
        if (mode === 'network') throw new Error('Synthetic network rejection.');
        if (mode === 'headers') return hold(init.signal);
        if (mode === 'body') return { ...response, json: () => hold(init.signal) };
      }
      return response;
    }
    if (url.href === `${restPrefix}/clubs/${accountKey}` && method === 'PATCH') return json({});
    assert.equal(method, 'GET');
    assert.equal(url.searchParams.get('pageSize'), '500');
    const collection = url.pathname.split('/').at(-1);
    assert.ok(['players', 'games', 'gameSessions', 'memberships', 'waitlists', 'notifications', 'tournaments', 'tournamentInterests'].includes(collection));
    assert.equal(url.origin + url.pathname, `${restPrefix}/clubs/${accountKey}/${collection}`);
    return json({ documents: [] });
  }
  /** @type {{ exports: Pick<typeof import('./firebasePublisher.js'), 'publishStateToFirebase'> }} */
  const module = { exports: { async publishStateToFirebase() { throw new Error('Synthetic publisher module did not load.'); } } };
  vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), {
    module, Buffer, Date, JSON, URL, URLSearchParams, Error, AbortController, AbortSignal, DOMException,
    setTimeout, clearTimeout,
    process: { env: { NODE_ENV: 'test', FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      project_id: projectId, client_email: 'synthetic-outbox@example.invalid', private_key: 'unused-fixture'
    }) } },
    fetch: fetchFixture,
    require(name) {
      if (name === 'crypto') return { ...crypto, createSign: () => ({ update() { return this; }, sign() { return 'synthetic-signature'; } }) };
      if (name === 'fs') return { readFileSync() { throw new Error('Credential file access forbidden.'); } };
      if (name === './orbitCore' || name === './operations/dataProtection') return rootRequire(name);
      throw new Error('Unexpected dependency in synthetic publisher VM.');
    }
  }, { filename: sourcePath });
  const dependencies = {
    scheduleDeletionFinalizationDrain: finalizer,
    schedulePublicationDrain: scheduler,
    /**
     * @param {Parameters<typeof module.exports.publishStateToFirebase>[0]} publishedState
     * @param {{ savedAt: string, syncRevision: string }} options
     */
    publishStateToFirebase(publishedState, options) {
      publicationOptions.push(structuredClone(options));
      return module.exports.publishStateToFirebase(publishedState, options);
    }
  };
  const api = {
    requests, controls, finalizer, scheduler, publicationOptions,
    /** @param {PublicationClaim} claim @param {TestDatabase} database */
    start(claim, database) {
      /** @type {PublicationObservation} */
      const result = { settled: false, promise: Promise.resolve() };
      result.promise = outbox.publishClaimed(claim, { ...dependencies, database }).then(
        value => { result.settled = true; result.value = value; },
        error => { result.settled = true; result.error = error; }
      );
      tasks.push(result.promise);
      return result;
    },
    async cleanup() {
      for (const control of controls) control.reject(new Error('Synthetic fixture final cleanup.'));
      await Promise.allSettled(tasks);
    }
  };
  fixtures.push(api);
  return api;
}

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('External network forbidden.'); }));
  // Select memory and disable alert delivery inside the test. Ordinary npm/CI
  // execution must not depend on an operator's environment or service settings.
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('ORBIT_FIRESTORE_MEMORY', 'true');
  vi.stubEnv('ORBIT_ALERT_WEBHOOK_URL', '');
  vi.stubEnv('VERCEL', '');
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.ORBIT_FIRESTORE_MEMORY, 'true');
  assert.equal(process.env.ORBIT_ALERT_WEBHOOK_URL, '');
  expect(connection.getDatabaseStatus()).toMatchObject({ mode: 'memory-test', durable: false, authoritative: true });
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-31T12:00:00.000Z'));
  warnings.length = 0;
  vi.spyOn(console, 'warn').mockImplementation((...args) => { warnings.push(args); });
  await connection.resetDatabaseForTests();
});

afterEach(async () => {
  try {
    for (const f of fixtures.splice(0)) await f.cleanup();
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  }
});

async function prepareTwoRevisions() {
  const database = await connection.getDatabase();
  const first = await stateStore.saveState(state(), { expectedRevision: 0, mutationId: 'synthetic-first' });
  expect(first.accountKey).toBe(accountKey);
  await stateStore.saveState(state('Synthetic Newer Player'), { expectedRevision: 1, mutationId: 'synthetic-second' });
  const claim = await outbox.claimNextPublication(new Date().toISOString(), { database });
  assert.ok(claim);
  expect(claim).toMatchObject({ accountKey, revision: 1, attempts: 1 });
  return { database, claim };
}

/**
 * @param {ReturnType<typeof fixture>} f
 * @param {TestDatabase} database
 * @param {PublicationObservation} initial
 * @param {string} expectedCategory
 */
async function assertRetryAndOrdering(f, database, initial, expectedCategory) {
  expect(initial.error).toBeUndefined();
  expect(initial.value).toMatchObject({ ok: false, error: expect.stringContaining(`category=${expectedCategory}`) });
  const failed = await database.getDocument(stateStore.publicationPath(accountKey, 1));
  expect(failed).toMatchObject({ status: 'failed', attempts: 1, claimId: null, error: expect.stringContaining(`category=${expectedCategory}`) });
  expect(Date.parse(failed.nextAttemptAt)).toBe(Date.now() + outbox.retryDelayMs(1));
  expect(await database.getDocument(stateStore.publicationPath(accountKey, 2))).toMatchObject({ status: 'pending', attempts: 0 });
  expect(await outbox.claimNextPublication(new Date().toISOString(), { database })).toBeNull();
  expect(f.requests).toHaveLength(2);
  expect(f.finalizer).not.toHaveBeenCalled();
  const retry = await outbox.claimNextPublication(failed.nextAttemptAt, { database });
  assert.ok(retry);
  expect(retry).toMatchObject({ accountKey, revision: 1, attempts: 2 });
  const outcome = f.start(retry, database);
  await outcome.promise;
  expect(outcome.value).toMatchObject({ ok: true });
  expect(f.publicationOptions).toEqual([
    { savedAt: retry.createdAt, syncRevision: `${accountKey}:1` },
    { savedAt: retry.createdAt, syncRevision: `${accountKey}:1` }
  ]);
  expect(await database.getDocument(stateStore.publicationPath(accountKey, 1))).toMatchObject({ status: 'published', attempts: 2 });
  expect(f.finalizer).toHaveBeenCalledTimes(1);
  expect(await outbox.claimNextPublication(failed.nextAttemptAt, { database })).toMatchObject({ revision: 2 });
  expect(JSON.stringify({ failed, result: initial.value, warnings })).not.toContain('inert-outbox-fixture-token');
}

describe('actual publisher and memory outbox characterization', () => {
  it('retains stable retry identity and predecessor ordering after an ordinary network rejection', async () => {
    const { database, claim } = await prepareTwoRevisions();
    const f = fixture('network');
    const initial = f.start(claim, database);
    await initial.promise;
    await assertRetryAndOrdering(f, database, initial, 'batch-write');
  });
});

describe('actual request deadline and memory outbox integration', () => {
  /** @type {Array<'headers' | 'body'>} */
  const stalledStages = ['headers', 'body'];
  it.each(stalledStages)('makes a projection %s deadline retryable without releasing its successor early', async mode => {
    const { database, claim } = await prepareTwoRevisions();
    const f = fixture(mode);
    const initial = f.start(claim, database);
    await flush();
    expect(f.requests).toHaveLength(2);
    expect(initial.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);
    await flush();
    expect(initial.settled).toBe(true);
    await assertRetryAndOrdering(f, database, initial, mode === 'body' ? 'batch-write-response-invalid' : 'batch-write');
  });

  it('keeps existing deletion-fence settlement after a timeout and requires sanitized publication separately', async () => {
    const database = await connection.getDatabase();
    await stateStore.saveState(state(), { expectedRevision: 0, mutationId: 'synthetic-private' });
    const claim = await outbox.claimNextPublication(new Date().toISOString(), { database });
    assert.ok(claim);
    const f = fixture('headers');
    const initial = f.start(claim, database);
    await flush();
    expect(f.requests).toHaveLength(2);
    await outbox.blockAccountPublications(database, [accountKey], 'synthetic-deleted-subject');
    const safe = await stateStore.saveState(state(''), {
      expectedRevision: 1, mutationId: 'synthetic-safe', invalidatePriorRevisions: true
    });
    await stateStore.invalidateAccountStateHistory(accountKey, safe.revision);
    await outbox.releaseAccountPublications(database, [accountKey], 'synthetic-deleted-subject', [{ accountKey, revision: safe.revision }]);
    expect(await outbox.claimNextPublication('2099-01-01T00:00:00.000Z', { database })).toBeNull();
    await vi.advanceTimersByTimeAsync(30_000);
    await flush();
    expect(initial.settled).toBe(true);
    expect(initial.value).toMatchObject({ ok: false, cancelled: true });
    expect(f.requests).toHaveLength(2);
    expect(f.finalizer).not.toHaveBeenCalled();
    expect(await database.getDocument(stateStore.publicationPath(accountKey, 1))).toMatchObject({ status: 'cancelled' });
    expect(await outbox.areRequiredPublicationsPublished(database, [{ accountKey, revision: 2 }])).toBe(false);
    const safeClaim = await outbox.claimNextPublication(new Date().toISOString(), { database });
    assert.ok(safeClaim);
    expect(safeClaim).toMatchObject({ revision: 2 });
    const final = f.start(safeClaim, database);
    await final.promise;
    expect(final.value).toMatchObject({ ok: true });
    expect(await outbox.areRequiredPublicationsPublished(database, [{ accountKey, revision: 2 }])).toBe(true);
    expect(f.finalizer).toHaveBeenCalledTimes(1);
    expect(f.publicationOptions.map(options => options.syncRevision)).toEqual([`${accountKey}:1`, `${accountKey}:2`]);
    // These assertions concern local claims and follow-on requests. An accepted
    // remote write may still be uncertain after transport abort; no rollback or
    // proof of remote cancellation is represented by this synthetic test.
  });
});
