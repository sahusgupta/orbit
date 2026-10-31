const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');

const repositoryRoot = path.resolve(__dirname, '../..');
const projectId = 'demo-orbit-resource-baseline';
const clubId = 'synthetic-club';
const savedAt = '2026-10-31T00:00:00.000Z';
const syncRevision = 'synthetic-baseline-revision';
const resourcePrefix = `projects/${projectId}/databases/(default)/documents/`;
const restPrefix = `https://firestore.googleapis.com/v1/${resourcePrefix.slice(0, -1)}`;
const collections = ['players', 'games', 'gameSessions', 'memberships', 'waitlists', 'notifications', 'tournaments', 'tournamentInterests'];
const defaultSizes = Object.freeze([0, 10, 250, 1000]);

function count(value, label, maximum = 10_000) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label} must be an integer between 0 and ${maximum}.`);
  }
  return value;
}

class FixtureDate extends Date {
  constructor(...args) { super(...(args.length ? args : [savedAt])); }
  static now() { return Date.parse(savedAt); }
}

function loadIsolatedModule(relativePath, dependencies, globals = {}) {
  const filename = path.join(repositoryRoot, relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  const exported = { exports: {} };
  const context = vm.createContext({
    module: exported, exports: exported.exports, Buffer, URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    Date: FixtureDate,
    require(name) {
      if (!Object.hasOwn(dependencies, name)) throw new Error(`Unexpected baseline dependency: ${name}`);
      return dependencies[name];
    },
    ...globals
  });
  new vm.Script(source, { filename }).runInContext(context, { timeout: 10_000 });
  return { value: exported.exports, sourceSha256: crypto.createHash('sha256').update(source).digest('hex') };
}

function fixtureState(players) {
  return {
    settings: {
      clubAccount: { clubName: 'Synthetic Baseline Club' },
      pilotAccess: { licenseId: clubId, expiresAt: '2099-01-01' },
      collectionProfiles: []
    },
    profiles: Array.from({ length: players }, (_unused, index) => ({
      id: `player-${String(index).padStart(5, '0')}`,
      name: `Synthetic Player ${index}`,
      membershipStartDate: '2026-01-01', membershipExpirationDate: '2099-01-01',
      totalTimePlayedHours: 0
    })),
    games: [], sessions: [], playerSessions: [], buyIns: [], drops: [], interests: [],
    tournaments: [], tournamentInterests: [], inAppNotifications: []
  };
}

function createTransport(state, { stalePlayers, legacyPlayers, foreignPlayers }) {
  const documents = new Map();
  const expectedDeleted = new Set();
  const preservedNames = new Set();
  const events = [];
  const metrics = {
    requests: 0, tokenRequests: 0, listRequests: 0, listedDocuments: 0,
    updateBatchRequests: 0, deleteBatchRequests: 0, documentUpdates: 0,
    documentDeletes: 0, parentWrites: 0, requestBodyBytes: 0, responseBodyBytes: 0,
    listRequestsByCollection: Object.fromEntries(collections.map((name) => [name, 0])),
    listedDocumentsByCollection: Object.fromEntries(collections.map((name) => [name, 0]))
  };
  let sampledHeapUsedMax = process.memoryUsage().heapUsed;
  const nameFor = (id) => `${resourcePrefix}clubs/${clubId}/players/${id}`;
  for (let index = 0; index < stalePlayers; index += 1) {
    const name = nameFor(`stale-owned-${index}`);
    documents.set(name, { name, fields: { syncSource: { stringValue: 'orbit-api' } } });
    expectedDeleted.add(name);
  }
  for (let index = 0; index < legacyPlayers; index += 1) {
    const name = nameFor(`legacy-player-${index}`);
    documents.set(name, { name, fields: {
      syncSource: { stringValue: 'legacy-fixture' },
      sourceProfileId: { stringValue: state.profiles[index].id }
    } });
    expectedDeleted.add(name);
  }
  for (let index = 0; index < foreignPlayers; index += 1) {
    const name = nameFor(`foreign-player-${index}`);
    documents.set(name, { name, fields: { syncSource: { stringValue: 'foreign-fixture' } } });
    preservedNames.add(name);
  }
  const response = (body) => {
    const serialized = JSON.stringify(body);
    metrics.responseBodyBytes += Buffer.byteLength(serialized);
    return { ok: true, status: 200, json: async () => JSON.parse(serialized), text: async () => serialized };
  };
  const validateResourceName = (name) => {
    assert.equal(typeof name, 'string');
    assert.ok(name.startsWith(resourcePrefix));
    assert.ok(name.startsWith(`${resourcePrefix}clubs/${clubId}/`) || name === `${resourcePrefix}clubStates/${clubId}`);
  };
  async function fetchFixture(input, init = {}) {
    metrics.requests += 1;
    sampledHeapUsedMax = Math.max(sampledHeapUsedMax, process.memoryUsage().heapUsed);
    if (init.body) metrics.requestBodyBytes += Buffer.byteLength(String(init.body));
    const endpoint = new URL(String(input));
    const method = init.method || 'GET';
    if (endpoint.href === 'https://oauth2.googleapis.com/token' && method === 'POST') {
      metrics.tokenRequests += 1;
      events.push({ kind: 'token' });
      return response({ access_token: 'inert-synthetic-transport-token' });
    }
    assert.equal(endpoint.origin, 'https://firestore.googleapis.com', 'Unexpected transport origin');
    if (endpoint.href === `${restPrefix}:batchWrite` && method === 'POST') {
      const { writes } = JSON.parse(String(init.body));
      assert.ok(Array.isArray(writes) && writes.length > 0 && writes.length <= 250);
      const deleting = writes.every((write) => typeof write.delete === 'string');
      assert.ok(deleting || writes.every((write) => write.update));
      metrics[deleting ? 'deleteBatchRequests' : 'updateBatchRequests'] += 1;
      for (const write of writes) {
        if (deleting) {
          validateResourceName(write.delete);
          assert.ok(expectedDeleted.has(write.delete), 'Unexpected fixture deletion');
          assert.ok(documents.delete(write.delete), 'Duplicate or absent fixture deletion');
          metrics.documentDeletes += 1;
        } else {
          validateResourceName(write.update.name);
          documents.set(write.update.name, structuredClone(write.update));
          metrics.documentUpdates += 1;
        }
      }
      events.push({ kind: deleting ? 'delete-batch' : 'update-batch', count: writes.length });
      return response({ status: writes.map(() => ({})) });
    }
    if (endpoint.href === `${restPrefix}/clubs/${clubId}` && method === 'PATCH') {
      const parent = { name: `${resourcePrefix}clubs/${clubId}`, fields: JSON.parse(String(init.body)).fields };
      documents.set(parent.name, parent);
      metrics.parentWrites += 1;
      events.push({ kind: 'parent-marker' });
      return response({});
    }
    const collectionName = endpoint.pathname.split('/').at(-1);
    assert.ok(collections.includes(collectionName), 'Unexpected collection');
    assert.equal(endpoint.origin + endpoint.pathname, `${restPrefix}/clubs/${clubId}/${collectionName}`);
    assert.equal(method, 'GET');
    assert.equal(endpoint.searchParams.get('pageSize'), '500');
    const pageToken = endpoint.searchParams.get('pageToken') || '';
    assert.match(pageToken, /^(?:offset-[1-9]\d*)?$/);
    const offset = pageToken ? Number(pageToken.slice(7)) : 0;
    const prefix = `${resourcePrefix}clubs/${clubId}/${collectionName}/`;
    const snapshot = [...documents.values()].filter((item) => item.name.startsWith(prefix))
      .sort((left, right) => left.name.localeCompare(right.name));
    const page = snapshot.slice(offset, offset + 500);
    metrics.listRequests += 1;
    metrics.listRequestsByCollection[collectionName] += 1;
    metrics.listedDocuments += page.length;
    metrics.listedDocumentsByCollection[collectionName] += page.length;
    events.push({ kind: 'list', collection: collectionName, count: page.length });
    return response({ documents: page, ...(offset + 500 < snapshot.length ? { nextPageToken: `offset-${offset + 500}` } : {}) });
  }
  return {
    fetchFixture, documents, metrics, events, expectedDeleted, preservedNames,
    getSampledHeapUsedMax: () => sampledHeapUsedMax
  };
}

function createTimedPublicationScenario({ players, ...options }) {
  count(players, 'players');
  const stalePlayers = count(options.stalePlayers ?? 0, 'stalePlayers');
  const legacyPlayers = count(options.legacyPlayers ?? 0, 'legacyPlayers', players);
  const foreignPlayers = count(options.foreignPlayers ?? 0, 'foreignPlayers');
  const state = fixtureState(players);
  let transport;
  const environment = {
    NODE_ENV: 'test', ORBIT_FIRESTORE_MEMORY: 'true', ORBIT_ENABLE_FIREBASE_SYNC: 'false',
    VITE_ENABLE_FIREBASE_SYNC: 'false', ORBIT_API_URL: 'http://127.0.0.1:9',
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      project_id: projectId, client_email: 'synthetic-publisher@example.invalid', private_key: 'unused-fixture'
    })
  };
  const deniedFs = { readFileSync() { throw new Error('Credential filesystem access is forbidden in the baseline.'); } };
  const isolatedProcess = { env: Object.freeze(environment) };
  const core = loadIsolatedModule('apps/api/src/shared/orbitCore.cjs', {}).value;
  const protection = loadIsolatedModule('apps/api/src/operations/dataProtection.js', { crypto, fs: deniedFs }, { process: isolatedProcess }).value;
  let signingCalls = 0;
  const fixtureCrypto = {
    ...crypto,
    createSign(algorithm) {
      assert.equal(algorithm, 'RSA-SHA256');
      return {
        update() { return this; },
        sign(key, encoding) {
          assert.equal(key, 'unused-fixture');
          assert.equal(encoding, 'base64');
          signingCalls += 1;
          return 'synthetic-signature';
        }
      };
    }
  };
  const publisher = loadIsolatedModule('apps/api/src/firebasePublisher.js', {
    crypto: fixtureCrypto, fs: deniedFs, './orbitCore': core, './operations/dataProtection': protection
  }, { process: isolatedProcess, fetch: (...args) => transport.fetchFixture(...args) });
  return async function run() {
    // Reset/reseed and invariant assertions are included in the outer worker's
    // measurement; VM loading and the immutable input fixture are prepared once.
    transport = createTransport(state, { stalePlayers, legacyPlayers, foreignPlayers });
    signingCalls = 0;
    const before = process.memoryUsage();
    const startedAt = performance.now();
    const result = await publisher.value.publishStateToFirebase(state, { savedAt, syncRevision });
    const durationMs = performance.now() - startedAt;
    const after = process.memoryUsage();
    assert.equal(result.ok, true);
    assert.equal(result.players, players);
    assert.equal(signingCalls, 1);
    assert.equal(transport.metrics.tokenRequests, 1);
    assert.equal(transport.metrics.documentUpdates, 1 + 2 * players);
    assert.equal(transport.metrics.parentWrites, 1);
    assert.equal(result.publicationWriteCount, transport.metrics.documentUpdates + transport.metrics.documentDeletes + 1);
    assert.equal(result.staleProjectionDocumentsRemoved, stalePlayers);
    assert.equal(result.legacyPlayersRemoved, legacyPlayers);
    assert.equal(transport.events.at(-1).kind, 'parent-marker');
    for (const name of transport.expectedDeleted) assert.equal(transport.documents.has(name), false);
    for (const name of transport.preservedNames) assert.equal(transport.documents.has(name), true);
    assert.equal(transport.documents.size, 2 * players + 2 + foreignPlayers);
    const marker = transport.documents.get(`${resourcePrefix}clubs/${clubId}`);
    assert.equal(marker.fields.syncProtocolVersion.integerValue, '2');
    assert.equal(marker.fields.syncRevision.stringValue, syncRevision);
    for (const profile of state.profiles) {
      for (const collection of ['players', 'memberships']) {
        const document = transport.documents.get(`${resourcePrefix}clubs/${clubId}/${collection}/${profile.id}`);
        assert.ok(document, `Missing canonical ${collection} document`);
        assert.equal(document.fields.syncRevision.stringValue, syncRevision);
      }
    }
    return {
      players, stalePlayers, legacyPlayers, foreignPlayers,
      sourceSha256: publisher.sourceSha256, operations: transport.metrics,
      fixtureInputBytes: Buffer.byteLength(JSON.stringify(state)),
      finalDocumentCount: transport.documents.size,
      finalDocumentsSha256: crypto.createHash('sha256').update(JSON.stringify([...transport.documents.values()]
        .sort((left, right) => left.name.localeCompare(right.name)))).digest('hex'),
      parentMarkerLast: true, unexpectedRequests: 0, durationMs,
      memory: {
        heapUsedBefore: before.heapUsed, heapUsedAfter: after.heapUsed,
        heapUsedDelta: after.heapUsed - before.heapUsed,
        sampledHeapUsedMax: Math.max(before.heapUsed, after.heapUsed, transport.getSampledHeapUsedMax()),
        rssBefore: before.rss, rssAfter: after.rss
      }
    };
  };
}

async function runPublicationScenario(players, options = {}) {
  return createTimedPublicationScenario({ players, ...options })();
}

function createPublicationScenario(options) {
  const run = createTimedPublicationScenario(options);
  return async function measureStablePublication() {
    const { players, stalePlayers, legacyPlayers, foreignPlayers, sourceSha256, operations,
      fixtureInputBytes, finalDocumentCount, finalDocumentsSha256, parentMarkerLast, unexpectedRequests } = await run();
    return {
      kind: 'publication',
      setup: { players, stalePlayers, legacyPlayers, foreignPlayers, fixtureInputBytes, sourceSha256 },
      operations,
      response: { finalDocumentCount, sha256: finalDocumentsSha256, parentMarkerLast, unexpectedRequests },
      measurementIncludes: 'Stateful REST reset/reseed, local serialization, invariants and memory sampling; module/input setup excluded.'
    };
  };
}

async function measurePublication({ players, sampleCount = 1, ...options }) {
  count(sampleCount, 'sampleCount', 25);
  if (!sampleCount) throw new Error('sampleCount must be positive.');
  const samples = [];
  const run = createTimedPublicationScenario({ players, ...options });
  for (let index = 0; index < sampleCount; index += 1) samples.push(await run());
  for (const sample of samples.slice(1)) {
    assert.deepEqual(sample.operations, samples[0].operations);
    assert.equal(sample.finalDocumentsSha256, samples[0].finalDocumentsSha256);
  }
  const durations = samples.map((sample) => sample.durationMs).sort((left, right) => left - right);
  return {
    ...samples[0], sampleCount,
    durationMs: durations[Math.floor(durations.length / 2)],
    samples: samples.map(({ durationMs, memory }) => ({ durationMs, memory }))
  };
}

module.exports = { createPublicationScenario, defaultSizes, measurePublication, runPublicationScenario };
