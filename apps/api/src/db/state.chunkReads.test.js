import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const require = createRequire(resolve(process.cwd(), 'apps/api/src/db/state.chunkReads.test.js'));
const accountKey = 'synthetic-example.test';
const savedAt = '2026-10-01T12:00:00.000Z';

function sampleState(name = 'Synthetic Player') {
  return {
    games: [], sessions: [], playerSessions: [], profiles: [{ id: 'synthetic-player', name }],
    settings: { clubAccount: { clubName: 'Synthetic Read Club', email: 'synthetic@example.test' } }
  };
}

function chunkPath(revision, index) {
  return `orbitAccountStates/${accountKey}/stateChunks/${String(revision).padStart(12, '0')}_${String(index).padStart(4, '0')}`;
}

function seedRevision(documents, revision, chunkCount, state = sampleState()) {
  const compressed = gzipSync(Buffer.from(JSON.stringify(state)));
  for (let index = 0; index < chunkCount; index += 1) {
    documents.set(chunkPath(revision, index), {
      revision, index,
      payload: compressed.subarray(Math.floor(index * compressed.length / chunkCount), Math.floor((index + 1) * compressed.length / chunkCount))
    });
  }
  documents.set(`orbitAccountStates/${accountKey}`, {
    accountKey, venueName: 'Synthetic Read Club', schemaVersion: 2, revision, savedAt, stateChunkCount: chunkCount
  });
  documents.set(`orbitPublicationOutbox/${accountKey}~${String(revision).padStart(12, '0')}`, {
    status: 'pending', attempts: 2, error: 'Synthetic retry marker', nextAttemptAt: savedAt
  });
}

function loadStateModule(store) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('./state.js'), 'utf8'), {
    module, Buffer, Date, JSON,
    require(name) {
      if (name === './connection') return { firestoreDocumentId: encodeURIComponent, getDatabase: async () => store };
      return require(name);
    }
  });
  return module.exports;
}

function serialHarness() {
  const documents = new Map();
  const calls = [];
  const failures = new Map();
  const store = {
    async getDocument(path) {
      calls.push({ type: 'read', path });
      if (failures.has(path)) throw failures.get(path);
      return documents.get(path) || null;
    },
    async queryCollection(collectionPath, options = {}) {
      const prefix = `${collectionPath}/`;
      return [...documents.entries()]
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, options.limit || 100)
        .map(([path, data]) => ({ id: path.slice(prefix.length), data }));
    },
    async runTransaction(operation) {
      const writes = [];
      const result = await operation({
        async getDocument(path) {
          if (writes.length) throw new Error('A transaction read followed a queued write.');
          return store.getDocument(path);
        },
        setDocument(path, value) { calls.push({ type: 'write', path }); writes.push(() => documents.set(path, value)); },
        createDocument(path, value) {
          if (documents.has(path)) throw new Error('A transaction created an existing document.');
          calls.push({ type: 'write', path }); writes.push(() => documents.set(path, value));
        },
        deleteDocument(path) { calls.push({ type: 'write', path }); writes.push(() => documents.delete(path)); }
      });
      writes.forEach((write) => write());
      return result;
    }
  };
  return { documents, calls, failures, store, state: loadStateModule(store) };
}

function nativeHarness() {
  const documents = new Map();
  const calls = [];
  const failures = new Map();
  const dataFailures = new Map();
  const snapshot = (reference) => ({
    ref: reference, exists: documents.has(reference.path),
    data() {
      if (dataFailures.has(reference.path)) throw dataFailures.get(reference.path);
      return documents.get(reference.path);
    }
  });
  const nativeTransaction = {
    writes: [],
    async get(reference) {
      if (this.writes.length) throw new Error('A transaction read followed a queued write.');
      calls.push({ type: 'transaction-single', paths: [reference.path] });
      if (failures.has(reference.path)) throw failures.get(reference.path);
      return snapshot(reference);
    },
    async getAll(...references) {
      if (this.writes.length) throw new Error('A transaction batch read followed a queued write.');
      calls.push({ type: 'transaction-batch', paths: references.map((reference) => reference.path) });
      const failure = references.find((reference) => failures.has(reference.path));
      if (failure) throw failures.get(failure.path);
      return references.map(snapshot);
    },
    set(reference, value) { calls.push({ type: 'write', paths: [reference.path] }); this.writes.push(() => documents.set(reference.path, value)); },
    create(reference, value) {
      if (documents.has(reference.path)) throw new Error('A transaction created an existing document.');
      calls.push({ type: 'write', paths: [reference.path] }); this.writes.push(() => documents.set(reference.path, value));
    },
    update(reference, value) { this.writes.push(() => documents.set(reference.path, { ...documents.get(reference.path), ...value })); },
    delete(reference) { this.writes.push(() => documents.delete(reference.path)); }
  };
  const nativeDatabase = {
    doc(path) {
      const reference = { path, async get() {
        calls.push({ type: 'single', paths: [path] });
        if (failures.has(path)) throw failures.get(path);
        return snapshot(reference);
      } };
      return reference;
    },
    async getAll(...references) {
      calls.push({ type: 'batch', paths: references.map((reference) => reference.path) });
      const failure = references.find((reference) => failures.has(reference.path));
      if (failure) throw failures.get(failure.path);
      return references.map(snapshot);
    },
    async runTransaction(operation) {
      nativeTransaction.writes = [];
      const result = await operation(nativeTransaction);
      nativeTransaction.writes.forEach((write) => write());
      return result;
    }
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('./connection.js'), 'utf8'), {
    module, Buffer, Date, structuredClone, process: { env: { NODE_ENV: 'development' } },
    require(name) {
      if (name === '../services/firebaseAdmin') return {
        getAdminSdk: () => ({ firestore: () => nativeDatabase }), getAdminApp: () => ({}), readServiceAccount: () => null
      };
      return require(name);
    }
  });
  return { documents, calls, failures, dataFailures, connection: module.exports };
}

describe('authoritative chunk-read characterization', () => {
  it.each([0, -1, Number.NaN])('returns null without document reads for chunk count %s', async (chunkCount) => {
    const harness = serialHarness();
    expect(await harness.state.loadStateRevision(accountKey, 1, chunkCount)).toBeNull();
    expect(harness.calls).toEqual([]);
  });

  it.each([1, 3, 20, 21])('preserves ordered decoding and serial-reader compatibility for %i chunks', async (chunkCount) => {
    const harness = serialHarness();
    const expected = sampleState();
    seedRevision(harness.documents, 1, chunkCount, expected);
    expect(await harness.state.loadStateRevision(accountKey, 1, chunkCount)).toEqual(expected);
    expect(harness.calls).toEqual(Array.from({ length: chunkCount }, (_, index) => ({ type: 'read', path: chunkPath(1, index) })));
  });

  it.each([null, {}, { payload: '' }])('reports the first missing payload with the same index: %j', async (missing) => {
    const harness = serialHarness();
    seedRevision(harness.documents, 1, 3);
    harness.documents.set(chunkPath(1, 1), missing);
    await expect(harness.state.loadStateRevision(accountKey, 1, 3)).rejects.toThrow('Authoritative Firestore state chunk 1 is missing.');
    expect(harness.calls.map((call) => call.path)).toEqual([chunkPath(1, 0), chunkPath(1, 1)]);
  });

  it('retains invalid payload, gzip and JSON failure categories', async () => {
    const harness = serialHarness();
    harness.documents.set(chunkPath(1, 0), { payload: 123 });
    await expect(harness.state.loadStateRevision(accountKey, 1, 1)).rejects.toMatchObject({ code: 'ERR_INVALID_ARG_TYPE' });
    harness.documents.set(chunkPath(1, 0), { payload: Buffer.from('Synthetic invalid gzip') });
    await expect(harness.state.loadStateRevision(accountKey, 1, 1)).rejects.toMatchObject({ code: 'Z_DATA_ERROR' });
    harness.documents.set(chunkPath(1, 0), { payload: gzipSync(Buffer.from('{ invalid JSON')) });
    await expect(harness.state.loadStateRevision(accountKey, 1, 1)).rejects.toMatchObject({ name: 'SyntaxError' });
  });

  it('propagates a serial read failure without later reads or fallback', async () => {
    const harness = serialHarness();
    seedRevision(harness.documents, 1, 3);
    const failure = new Error('Synthetic unavailable document');
    harness.failures.set(chunkPath(1, 1), failure);
    await expect(harness.state.loadStateRevision(accountKey, 1, 3)).rejects.toBe(failure);
    expect(harness.calls.map((call) => call.path)).toEqual([chunkPath(1, 0), chunkPath(1, 1)]);
  });

  it('keeps publication failure ahead of chunk loading', async () => {
    const harness = serialHarness();
    seedRevision(harness.documents, 1, 3);
    const publicationPath = harness.state.publicationPath(accountKey, 1);
    const failure = new Error('Synthetic unavailable publication status');
    harness.failures.set(publicationPath, failure);
    await expect(harness.state.loadState(accountKey)).rejects.toBe(failure);
    expect(harness.calls.map((call) => call.path)).toEqual([harness.state.accountPath(accountKey), publicationPath]);
  });

  it('retains the full public state/publication shape and status-before-chunks ordering', async () => {
    const harness = serialHarness();
    const expected = sampleState();
    seedRevision(harness.documents, 1, 3, expected);
    expect(await harness.state.loadState(accountKey)).toEqual({
      accountKey, venueName: 'Synthetic Read Club', schemaVersion: 2, savedAt, revision: 1,
      publication: { status: 'pending', attempts: 2, error: 'Synthetic retry marker', publishedAt: null, nextAttemptAt: savedAt },
      state: expected
    });
    expect(harness.calls.slice(0, 2).map((call) => call.path)).toEqual([
      harness.state.accountPath(accountKey), harness.state.publicationPath(accountKey, 1)
    ]);
  });

  it('keeps previous-state/precondition reads ahead of every transaction write', async () => {
    const harness = serialHarness();
    const previous = sampleState();
    seedRevision(harness.documents, 1, 20, previous);
    const next = sampleState('Changed Synthetic Player');
    const result = await harness.state.saveState(next, {
      expectedRevision: 1, mutationId: 'synthetic-chunk-commit',
      async transactionPrecondition({ transaction, currentState }) {
        expect(currentState).toEqual(previous);
        await transaction.getDocument('syntheticGuards/fence');
        return { result: { observedPreviousState: true } };
      }
    });
    expect(result).toMatchObject({ revision: 2, duplicate: false, transactionResult: { observedPreviousState: true } });
    const firstWrite = harness.calls.findIndex((call) => call.type === 'write');
    expect(firstWrite).toBeGreaterThan(0);
    expect(harness.calls.slice(firstWrite).every((call) => call.type === 'write')).toBe(true);
    expect(await harness.state.loadStateRevision(accountKey, 2, 1)).toEqual(next);
  });

  it('preserves historical revision order and the excluded revision', async () => {
    const harness = serialHarness();
    seedRevision(harness.documents, 3, 3, sampleState('Revision 3'));
    seedRevision(harness.documents, 1, 3, sampleState('Revision 1'));
    seedRevision(harness.documents, 2, 3, sampleState('Revision 2'));
    expect(await harness.state.listHistoricalStates(accountKey, 2)).toEqual([
      { revision: 1, state: sampleState('Revision 1') }, { revision: 3, state: sampleState('Revision 3') }
    ]);
  });

  it('uses native single-document and transaction readers with the same state result', async () => {
    const harness = nativeHarness();
    seedRevision(harness.documents, 1, 3);
    const store = await harness.connection.getDatabase();
    const state = loadStateModule(store);
    expect(await state.loadStateRevision(accountKey, 1, 3)).toEqual(sampleState());
    expect(harness.calls.flatMap((call) => call.paths)).toEqual([chunkPath(1, 0), chunkPath(1, 1), chunkPath(1, 2)]);
    harness.calls.length = 0;
    await store.runTransaction(async (transaction) => {
      expect(await transaction.getDocument(chunkPath(1, 0))).toEqual(harness.documents.get(chunkPath(1, 0)));
    });
    expect(harness.calls.map((call) => call.type)).toEqual(['transaction-single']);
  });
});

describe('bounded native chunk-read RPCs', () => {
  it('loads a valid twenty-chunk state with one native batch RPC and the same document paths', async () => {
    const harness = nativeHarness();
    seedRevision(harness.documents, 1, 20);
    const store = await harness.connection.getDatabase();
    const state = loadStateModule(store);

    expect(await state.loadStateRevision(accountKey, 1, 20)).toEqual(sampleState());
    expect(harness.calls).toEqual([
      { type: 'batch', paths: Array.from({ length: 20 }, (_, index) => chunkPath(1, index)) }
    ]);
  });

  it('uses one native transaction batch for prior chunks while retaining all reads before writes', async () => {
    const harness = nativeHarness();
    seedRevision(harness.documents, 1, 20);
    const store = await harness.connection.getDatabase();
    const state = loadStateModule(store);
    const next = sampleState('Changed Synthetic Player');

    expect(await state.saveState(next, {
      expectedRevision: 1, mutationId: 'synthetic-batch-commit',
      async transactionPrecondition({ transaction, currentState }) {
        expect(currentState).toEqual(sampleState());
        await transaction.getDocument('syntheticGuards/fence');
      }
    })).toMatchObject({ revision: 2 });
    expect(harness.calls.filter((call) => call.paths.some((path) => path.includes('/stateChunks/000000000001_')))).toEqual([
      { type: 'transaction-batch', paths: Array.from({ length: 20 }, (_, index) => chunkPath(1, index)) }
    ]);
    const firstWrite = harness.calls.findIndex((call) => call.type === 'write');
    expect(firstWrite).toBeGreaterThan(0);
    expect(harness.calls.slice(firstWrite).every((call) => call.type === 'write')).toBe(true);
  });

  it('keeps each native RPC bounded while reading a larger legacy header', async () => {
    const harness = nativeHarness();
    seedRevision(harness.documents, 1, 21);
    const state = loadStateModule(await harness.connection.getDatabase());

    expect(await state.loadStateRevision(accountKey, 1, 21)).toEqual(sampleState());
    expect(harness.calls).toEqual([
      { type: 'batch', paths: Array.from({ length: 20 }, (_, index) => chunkPath(1, index)) },
      { type: 'batch', paths: [chunkPath(1, 20)] }
    ]);
  });

  it('reports the earliest missing index and does not fetch the next batch', async () => {
    const harness = nativeHarness();
    seedRevision(harness.documents, 1, 21);
    harness.documents.delete(chunkPath(1, 0));
    harness.documents.delete(chunkPath(1, 1));
    const state = loadStateModule(await harness.connection.getDatabase());

    await expect(state.loadStateRevision(accountKey, 1, 21)).rejects.toThrow('Authoritative Firestore state chunk 0 is missing.');
    expect(harness.calls).toEqual([
      { type: 'batch', paths: Array.from({ length: 20 }, (_, index) => chunkPath(1, index)) }
    ]);
  });

  it('propagates a native batch failure without retrying individual documents', async () => {
    const harness = nativeHarness();
    seedRevision(harness.documents, 1, 21);
    const failure = new Error('Synthetic batch read unavailable');
    harness.failures.set(chunkPath(1, 1), failure);
    const state = loadStateModule(await harness.connection.getDatabase());

    await expect(state.loadStateRevision(accountKey, 1, 21)).rejects.toBe(failure);
    expect(harness.calls).toEqual([
      { type: 'batch', paths: Array.from({ length: 20 }, (_, index) => chunkPath(1, index)) }
    ]);
  });

  it.each(['rpc', 'data'])('fails closed when a later %s error prevents an earlier missing slot from being returned', async (kind) => {
    const harness = nativeHarness();
    seedRevision(harness.documents, 1, 3);
    harness.documents.delete(chunkPath(1, 0));
    const failure = new Error(`Synthetic later ${kind} failure`);
    (kind === 'rpc' ? harness.failures : harness.dataFailures).set(chunkPath(1, 1), failure);
    const store = await harness.connection.getDatabase();
    const serialStore = { ...store };
    delete serialStore.getDocuments;

    await expect(loadStateModule(serialStore).loadStateRevision(accountKey, 1, 3)).rejects.toThrow('Authoritative Firestore state chunk 0 is missing.');
    expect(harness.calls).toEqual([{ type: 'single', paths: [chunkPath(1, 0)] }]);
    harness.calls.length = 0;
    await expect(loadStateModule(store).loadStateRevision(accountKey, 1, 3)).rejects.toBe(failure);
    expect(harness.calls).toEqual([{ type: 'batch', paths: [chunkPath(1, 0), chunkPath(1, 1), chunkPath(1, 2)] }]);
  });

  it('retains invalid payload and decoder errors on the native batch path', async () => {
    const harness = nativeHarness();
    const state = loadStateModule(await harness.connection.getDatabase());
    harness.documents.set(chunkPath(1, 0), { payload: 123 });
    await expect(state.loadStateRevision(accountKey, 1, 1)).rejects.toMatchObject({ code: 'ERR_INVALID_ARG_TYPE' });
    harness.documents.set(chunkPath(1, 0), { payload: Buffer.from('Synthetic invalid gzip') });
    await expect(state.loadStateRevision(accountKey, 1, 1)).rejects.toMatchObject({ code: 'Z_DATA_ERROR' });
    harness.documents.set(chunkPath(1, 0), { payload: gzipSync(Buffer.from('{ invalid JSON')) });
    await expect(state.loadStateRevision(accountKey, 1, 1)).rejects.toMatchObject({ name: 'SyntaxError' });
    expect(harness.calls.every((call) => call.type === 'batch')).toBe(true);
  });

  it('keeps publication failure ahead of any native chunk batch', async () => {
    const harness = nativeHarness();
    seedRevision(harness.documents, 1, 20);
    const state = loadStateModule(await harness.connection.getDatabase());
    const publicationPath = state.publicationPath(accountKey, 1);
    const failure = new Error('Synthetic unavailable publication status');
    harness.failures.set(publicationPath, failure);

    await expect(state.loadState(accountKey)).rejects.toBe(failure);
    expect(harness.calls).toEqual([
      { type: 'single', paths: [state.accountPath(accountKey)] },
      { type: 'single', paths: [publicationPath] }
    ]);
  });

  it('retains full state/publication shape with status preceding native chunks', async () => {
    const harness = nativeHarness();
    seedRevision(harness.documents, 1, 20);
    const state = loadStateModule(await harness.connection.getDatabase());

    expect(await state.loadState(accountKey)).toEqual({
      accountKey, venueName: 'Synthetic Read Club', schemaVersion: 2, savedAt, revision: 1,
      publication: { status: 'pending', attempts: 2, error: 'Synthetic retry marker', publishedAt: null, nextAttemptAt: savedAt },
      state: sampleState()
    });
    expect(harness.calls).toEqual([
      { type: 'single', paths: [state.accountPath(accountKey)] },
      { type: 'single', paths: [state.publicationPath(accountKey, 1)] },
      { type: 'batch', paths: Array.from({ length: 20 }, (_, index) => chunkPath(1, index)) }
    ]);
  });
});

describe('optional ordered document-reader adapters', () => {
  it('returns empty native and transaction batches without RPCs', async () => {
    const harness = nativeHarness();
    const store = await harness.connection.getDatabase();
    expect(await store.getDocuments([])).toEqual([]);
    await store.runTransaction(async (transaction) => {
      expect(await transaction.getDocuments([])).toEqual([]);
    });
    expect(harness.calls).toEqual([]);
  });

  it('retains missing slots and duplicates in native request order', async () => {
    const harness = nativeHarness();
    harness.documents.set('syntheticValues/first', { value: 1 });
    harness.documents.set('syntheticValues/second', { value: 2 });
    const store = await harness.connection.getDatabase();
    const paths = ['syntheticValues/second', 'syntheticValues/missing', 'syntheticValues/first', 'syntheticValues/second'];
    const expected = [{ value: 2 }, null, { value: 1 }, { value: 2 }];

    expect(await store.getDocuments(paths)).toEqual(expected);
    await store.runTransaction(async (transaction) => {
      expect(await transaction.getDocuments(paths)).toEqual(expected);
    });
    expect(harness.calls).toEqual([{ type: 'batch', paths }, { type: 'transaction-batch', paths }]);
  });

  it('does not silently replace a rejected native transaction batch with single reads', async () => {
    const harness = nativeHarness();
    const store = await harness.connection.getDatabase();
    const failure = new Error('Synthetic transaction batch failure');
    harness.failures.set('syntheticValues/first', failure);

    await expect(store.runTransaction(async (transaction) => transaction.getDocuments(['syntheticValues/first']))).rejects.toBe(failure);
    expect(harness.calls).toEqual([{ type: 'transaction-batch', paths: ['syntheticValues/first'] }]);
  });

  it('retains native transaction rejection of reads after queued writes', async () => {
    const harness = nativeHarness();
    const store = await harness.connection.getDatabase();

    await expect(store.runTransaction(async (transaction) => {
      transaction.setDocument('syntheticValues/new', { value: 1 });
      await transaction.getDocuments(['syntheticValues/first']);
    })).rejects.toThrow('A transaction batch read followed a queued write.');
    expect(harness.documents.has('syntheticValues/new')).toBe(false);
  });

  it('validates all native paths before issuing a batch RPC', async () => {
    const harness = nativeHarness();
    const store = await harness.connection.getDatabase();
    await expect(store.getDocuments(['syntheticValues/first', 'invalid-document-path'])).rejects.toThrow('A valid Firestore document path is required.');
    expect(harness.calls).toEqual([]);
  });

  it('preserves memory-store missing slots, duplicates, clones and transaction-local reads', async () => {
    const connection = require('./connection.js');
    await connection.resetDatabaseForTests();
    const store = await connection.getDatabase();
    await store.setDocument('syntheticValues/first', { nested: { value: 1 } });
    const values = await store.getDocuments(['syntheticValues/first', 'syntheticValues/missing', 'syntheticValues/first']);
    expect(values).toEqual([{ nested: { value: 1 } }, null, { nested: { value: 1 } }]);
    values[0].nested.value = 99;
    expect(values[2].nested.value).toBe(1);
    expect(await store.getDocument('syntheticValues/first')).toEqual({ nested: { value: 1 } });
    expect(await store.getDocuments([])).toEqual([]);
    await store.runTransaction(async (transaction) => {
      expect(await transaction.getDocuments(['syntheticValues/first', 'syntheticValues/missing'])).toEqual([{ nested: { value: 1 } }, null]);
      transaction.setDocument('syntheticValues/second', { value: 2 });
    });
    expect(await store.getDocument('syntheticValues/second')).toEqual({ value: 2 });
  });
});
