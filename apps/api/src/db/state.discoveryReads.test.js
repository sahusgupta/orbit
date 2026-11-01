import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const require = createRequire(__filename);
const savedAt = '2026-10-01T12:00:00.000Z';
const nowMs = Date.parse('2026-10-31T00:00:00.000Z');

function syntheticState(accountKey, name = `Synthetic ${accountKey}`) {
  return {
    games: [], sessions: [], playerSessions: [], profiles: [], interests: [], tournaments: [],
    settings: {
      clubAccount: { clubName: name },
      pilotAccess: {
        authorized: true, licenseId: accountKey, authorizationCode: `synthetic:${accountKey}`,
        expiresAt: '2099-01-01T00:00:00.000Z'
      }
    }
  };
}

function harness() {
  const documents = new Map();
  const calls = [];
  const failures = new Map();
  const read = (documentPath) => {
    if (failures.has(documentPath)) throw failures.get(documentPath);
    return documents.get(documentPath) || null;
  };
  const store = {
    async getDocument(documentPath) {
      calls.push({ kind: 'single', path: documentPath });
      return read(documentPath);
    },
    async getDocuments(paths) {
      calls.push({ kind: 'batch', paths });
      return paths.map(read);
    },
    async queryCollection(collectionPath, options = {}) {
      calls.push({ kind: 'query', collectionPath, options });
      const prefix = `${collectionPath}/`;
      return [...documents.entries()]
        .filter(([documentPath]) => documentPath.startsWith(prefix) && !documentPath.slice(prefix.length).includes('/'))
        .map(([documentPath, data]) => ({ id: documentPath.slice(prefix.length), data }))
        .sort((left, right) => left.id.localeCompare(right.id))
        .filter((document) => !options.startAfter?.length || document.id > options.startAfter[0])
        .slice(0, options.limit || 100);
    }
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('./state.js'), 'utf8'), {
    module, Buffer, Date, JSON,
    require(name) {
      if (name === './connection') return { firestoreDocumentId: encodeURIComponent, getDatabase: async () => store };
      return require(name);
    }
  });
  const stateStore = module.exports;
  function seed(accountKey, { state = syntheticState(accountKey), revision = 1 } = {}) {
    const chunkPath = `${stateStore.accountPath(accountKey)}/stateChunks/${String(revision).padStart(12, '0')}_0000`;
    const publicationPath = stateStore.publicationPath(accountKey, revision);
    documents.set(stateStore.accountPath(accountKey), {
      accountKey, venueName: state.settings.clubAccount.clubName, schemaVersion: 2,
      savedAt, revision, stateChunkCount: revision ? 1 : 0
    });
    if (revision) {
      documents.set(chunkPath, { payload: gzipSync(Buffer.from(JSON.stringify(state))) });
      documents.set(publicationPath, { status: 'pending', attempts: 2, error: 'Synthetic retry', nextAttemptAt: savedAt });
    }
    return { state, chunkPath, publicationPath };
  }
  return { stateStore, seed, documents, failures, calls };
}

function publicationReads(calls) {
  return calls.filter((call) => call.kind === 'single' && call.path.startsWith('orbitPublicationOutbox/'));
}

function responseHarness() {
  return {
    statusCode: 200, headers: {}, body: null,
    status(value) { this.statusCode = value; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    json(body) { this.body = body; return this; }
  };
}

function normalizedResponse(response) {
  return {
    statusCode: response.statusCode, headers: response.headers,
    body: { ...response.body, clubs: (response.body.clubs || []).map((club) => ({ ...club, generatedAt: savedAt })) }
  };
}

function syntheticLicenseInspections(codes) {
  return codes.map((code) => ({
    managed: true, active: !code.endsWith('club-051'),
    license: { accountKey: code.slice('synthetic:'.length), status: 'active', expiresAt: '2099-01-01T00:00:00.000Z' }
  }));
}

describe('state read hydration characterization', () => {
  it('preserves complete default page records, publication details and source pagination', async () => {
    const fixture = harness();
    const first = fixture.seed('club-a');
    fixture.seed('club-b');
    expect(await fixture.stateStore.listStatePage({ limit: 1 })).toEqual({
      records: [{
        accountKey: 'club-a', venueName: 'Synthetic club-a', schemaVersion: 2, savedAt, revision: 1,
        publication: { status: 'pending', attempts: 2, error: 'Synthetic retry', publishedAt: null, nextAttemptAt: savedAt },
        state: first.state
      }], hasMore: true, nextCursor: 'club-a', queryCount: 2
    });
    expect(publicationReads(fixture.calls)).toHaveLength(1);
    expect(fixture.calls.map((call) => call.kind)).toEqual(['query', 'single', 'batch']);
    expect(fixture.calls[0].options).toEqual({ orders: [{ field: '__name__', direction: 'asc' }], startAfter: undefined, limit: 2 });
  });

  it.each(['loadState', 'loadLatestState'])('keeps publication details on %s', async (method) => {
    const fixture = harness();
    const { state } = fixture.seed('club-a');
    expect(await fixture.stateStore[method]('club-a')).toMatchObject({
      accountKey: 'club-a', state, publication: { status: 'pending', attempts: 2, error: 'Synthetic retry' }
    });
    expect(publicationReads(fixture.calls)).toHaveLength(1);
  });

  it('retains not-queued publication semantics when its document is absent', async () => {
    const fixture = harness();
    const { publicationPath } = fixture.seed('club-a');
    fixture.documents.delete(publicationPath);
    expect((await fixture.stateStore.listStatePage()).records[0].publication)
      .toEqual({ status: 'not-queued', attempts: 0, error: '' });
    expect(publicationReads(fixture.calls)).toHaveLength(1);
  });

  it('does not request publication or chunks for an uncommitted revision', async () => {
    const fixture = harness();
    fixture.seed('club-a', { revision: 0 });
    expect((await fixture.stateStore.listStatePage()).records[0]).toMatchObject({
      revision: 0, publication: { status: 'not-queued', attempts: 0, error: '' }, state: null
    });
    expect(fixture.calls.map((call) => call.kind)).toEqual(['query']);
  });

  it.each(['listStatePage', 'loadState'])('keeps publication errors before chunk reads in %s', async (method) => {
    const fixture = harness();
    const { publicationPath, chunkPath } = fixture.seed('club-a');
    const failure = new Error('Synthetic publication unavailable');
    fixture.failures.set(publicationPath, failure);
    fixture.failures.set(chunkPath, new Error('Synthetic chunk unavailable'));
    await expect(fixture.stateStore[method](method === 'loadState' ? 'club-a' : {})).rejects.toBe(failure);
    expect(fixture.calls.some((call) => call.kind === 'batch')).toBe(false);
  });

  it.each(['listStatePage', 'loadState'])('propagates chunk errors after publication in %s', async (method) => {
    const fixture = harness();
    const { chunkPath } = fixture.seed('club-a');
    const failure = new Error('Synthetic chunk unavailable');
    fixture.failures.set(chunkPath, failure);
    await expect(fixture.stateStore[method](method === 'loadState' ? 'club-a' : {})).rejects.toBe(failure);
    expect(publicationReads(fixture.calls)).toHaveLength(1);
    expect(fixture.calls.at(-1).kind).toBe('batch');
  });

  it('retains an empty terminal page without auxiliary reads', async () => {
    const fixture = harness();
    expect(await fixture.stateStore.listStatePage()).toEqual({ records: [], hasMore: false, nextCursor: null, queryCount: 1 });
    expect(fixture.calls.map((call) => call.kind)).toEqual(['query']);
  });
});

describe('discovery publication-status read omission', () => {
  it('omits only publication when explicitly disabled, retaining source pagination and decoded state', async () => {
    const fixture = harness();
    fixture.seed('club-a');
    fixture.seed('club-b');
    const baseline = await fixture.stateStore.listStatePage({ limit: 1 });
    fixture.calls.length = 0;
    const result = await fixture.stateStore.listStatePage({ limit: 1, includePublication: false });
    expect(result).toEqual({
      ...baseline,
      records: baseline.records.map(({ publication: _publication, ...record }) => record)
    });
    expect(Object.hasOwn(result.records[0], 'publication')).toBe(false);
    expect(publicationReads(fixture.calls)).toHaveLength(0);
    expect(fixture.calls.map((call) => call.kind)).toEqual(['query', 'batch']);
  });

  it.each([true, undefined, null, 0])('retains publication hydration for includePublication=%s', async (includePublication) => {
    const fixture = harness();
    fixture.seed('club-a');
    const result = await fixture.stateStore.listStatePage({ includePublication });
    expect(result.records[0].publication).toMatchObject({ status: 'pending', attempts: 2 });
    expect(publicationReads(fixture.calls)).toHaveLength(1);
  });

  it('does not depend on unused publication availability when explicitly omitted', async () => {
    const fixture = harness();
    const { publicationPath, state } = fixture.seed('club-a');
    fixture.failures.set(publicationPath, new Error('Synthetic unused publication unavailable'));
    const result = await fixture.stateStore.listStatePage({ includePublication: false });
    expect(result.records[0].state).toEqual(state);
    expect(Object.hasOwn(result.records[0], 'publication')).toBe(false);
    expect(publicationReads(fixture.calls)).toHaveLength(0);
  });

  it('still rejects an authoritative chunk transport failure without returning a partial page', async () => {
    const fixture = harness();
    const { chunkPath } = fixture.seed('club-a');
    const failure = new Error('Synthetic authoritative chunk unavailable');
    fixture.failures.set(chunkPath, failure);
    await expect(fixture.stateStore.listStatePage({ includePublication: false })).rejects.toBe(failure);
    expect(publicationReads(fixture.calls)).toHaveLength(0);
  });

  it('still rejects missing authoritative chunks', async () => {
    const fixture = harness();
    const { chunkPath } = fixture.seed('club-a');
    fixture.documents.delete(chunkPath);
    await expect(fixture.stateStore.listStatePage({ includePublication: false }))
      .rejects.toThrow('Authoritative Firestore state chunk 0 is missing.');
    expect(publicationReads(fixture.calls)).toHaveLength(0);
  });

  it.each(['public', 'authenticated'])('keeps %s responses, filtering, license decisions and resumable pagination identical', async (mode) => {
    const fixture = harness();
    const playerRoutes = require('../routes/player.js');
    for (let index = 0; index < 53; index += 1) {
      const accountKey = `club-${String(index).padStart(3, '0')}`;
      fixture.seed(accountKey, { state: syntheticState(accountKey, index < 50 ? 'Stress Fixture' : 'Shared Club Name') });
    }
    const handle = mode === 'public' ? playerRoutes.handlePublicPlayerDiscovery : playerRoutes.handlePlayerDiscovery;
    const dependencies = {
      nowMs: () => nowMs, inspectPilotLicenses: async (codes) => syntheticLicenseInspections(codes)
    };
    const request = { query: { limit: 1 }, orbitPlayer: { uid: 'synthetic-player', email_verified: true, email: 'synthetic@example.invalid' } };
    const baseline = responseHarness();
    await handle(request, baseline, {
      ...dependencies,
      listStatePage: (options) => fixture.stateStore.listStatePage({ ...options, includePublication: true })
    });
    expect(publicationReads(fixture.calls)).toHaveLength(53);
    fixture.calls.length = 0;
    const optimized = responseHarness();
    await handle(request, optimized, { ...dependencies, listStatePage: fixture.stateStore.listStatePage });
    expect(normalizedResponse(optimized)).toEqual(normalizedResponse(baseline));
    expect(optimized.body.page).toEqual({ count: 1, hasMore: true, nextCursor: 'club-050' });
    expect(optimized.body.clubs[0].club.id).toBe('club-050');
    expect(publicationReads(fixture.calls)).toHaveLength(0);
    const nextRequest = { ...request, query: { limit: 1, cursor: optimized.body.page.nextCursor } };
    const nextBaseline = responseHarness();
    await handle(nextRequest, nextBaseline, {
      ...dependencies,
      listStatePage: (options) => fixture.stateStore.listStatePage({ ...options, includePublication: true })
    });
    fixture.calls.length = 0;
    const nextOptimized = responseHarness();
    await handle(nextRequest, nextOptimized, { ...dependencies, listStatePage: fixture.stateStore.listStatePage });
    expect(normalizedResponse(nextOptimized)).toEqual(normalizedResponse(nextBaseline));
    expect(nextOptimized.body.clubs.map((club) => club.club.id)).toEqual(['club-052']);
    expect(nextOptimized.body.page).toEqual({ count: 1, hasMore: false, nextCursor: null });
    expect(publicationReads(fixture.calls)).toHaveLength(0);
  });

  it.each(['public', 'authenticated'])('keeps licensing failures fail-closed for %s discovery', async (mode) => {
    const fixture = harness();
    fixture.seed('club-a');
    const playerRoutes = require('../routes/player.js');
    const handle = mode === 'public' ? playerRoutes.handlePublicPlayerDiscovery : playerRoutes.handlePlayerDiscovery;
    const response = responseHarness();
    await handle({ query: {}, orbitPlayer: { uid: 'synthetic-player' } }, response, {
      listStatePage: fixture.stateStore.listStatePage, nowMs: () => nowMs,
      inspectPilotLicenses: async () => { throw new Error('Synthetic licensing unavailable'); }
    });
    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual({ ok: false, code: 'PLAYER_VENUE_LICENSE_UNAVAILABLE', error: 'Venue availability cannot be verified right now.' });
    expect(publicationReads(fixture.calls)).toHaveLength(0);
  });
});
