const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const { assertIsolatedWorker, loadCommonJs, root } = require('./runtime.cjs');

const savedAt = '2026-10-01T12:00:00.000Z';
const nowMs = Date.parse('2026-10-31T00:00:00.000Z');

function syntheticState(index, profiles, hidden) {
  const accountKey = `synthetic-club-${String(index).padStart(4, '0')}`;
  return {
    games: [], sessions: [], playerSessions: [],
    profiles: Array.from({ length: profiles }, (_, position) => ({
      id: `synthetic-player-${position}`, name: `Synthetic Player ${position}`
    })),
    settings: {
      clubAccount: { clubName: hidden ? 'test club' : `Synthetic Club ${index}`, email: `${accountKey}@example.invalid` },
      pilotAccess: { authorized: true, licenseId: accountKey, authorizationCode: `synthetic-license:${accountKey}`, expiresAt: '2099-01-01T00:00:00.000Z' }
    }
  };
}

function countStore(store) {
  const counts = { singleReadRequests: 0, batchReadRequests: 0, queryRequests: 0,
    publicationDocumentsRequested: 0, chunkDocumentsRequested: 0, otherDocumentsRequested: 0,
    queryDocumentsReturned: 0, missingDocuments: 0, writes: 0 };
  const countPaths = (paths) => {
    for (const documentPath of paths) {
      const key = documentPath.startsWith('orbitPublicationOutbox/') ? 'publicationDocumentsRequested'
        : documentPath.includes('/stateChunks/') ? 'chunkDocumentsRequested' : 'otherDocumentsRequested';
      counts[key] += 1;
    }
  };
  return {
    counts,
    store: {
      async getDocument(documentPath) {
        counts.singleReadRequests += 1;
        countPaths([documentPath]);
        const result = await store.getDocument(documentPath);
        if (result === null) counts.missingDocuments += 1;
        return result;
      },
      async getDocuments(paths) {
        counts.batchReadRequests += 1;
        countPaths(paths);
        // Invoke the original store, whose internal individual reads are not counted twice.
        const result = await store.getDocuments(paths);
        counts.missingDocuments += result.filter((record) => record === null).length;
        return result;
      },
      async queryCollection(collectionPath, options) {
        counts.queryRequests += 1;
        const result = await store.queryCollection(collectionPath, options);
        counts.queryDocumentsReturned += result.length;
        return result;
      },
      async setDocument(...args) { counts.writes += 1; return store.setDocument(...args); },
      async createDocument(...args) { counts.writes += 1; return store.createDocument(...args); },
      async updateDocument(...args) { counts.writes += 1; return store.updateDocument(...args); },
      async deleteDocument(...args) { counts.writes += 1; return store.deleteDocument(...args); }
    }
  };
}

async function createDiscoveryScenario({ venues, profilesPerVenue = 10, limit = 25, hidden = false }) {
  assertIsolatedWorker();
  const connection = require(path.join(root, 'apps/api/src/db/connection.js'));
  await connection.resetDatabaseForTests();
  const rawStore = await connection.getDatabase();
  const counted = countStore(rawStore);
  const stateStore = loadCommonJs('apps/api/src/db/state.js', {
    './connection': { firestoreDocumentId: connection.firestoreDocumentId, getDatabase: async () => counted.store }
  });
  const routes = require(path.join(root, 'apps/api/src/routes/player.js'));
  let sourceBytes = 0;
  let compressedBytes = 0;
  for (let index = 0; index < venues; index += 1) {
    const state = syntheticState(index, profilesPerVenue, hidden);
    const accountKey = state.settings.pilotAccess.licenseId;
    const source = Buffer.from(JSON.stringify(state));
    const compressed = gzipSync(source, { level: 6 });
    const chunks = [];
    for (let offset = 0; offset < compressed.length; offset += 400_000) chunks.push(compressed.subarray(offset, offset + 400_000));
    sourceBytes += source.length;
    compressedBytes += compressed.length;
    await rawStore.setDocument(stateStore.accountPath(accountKey), {
      accountKey, venueName: state.settings.clubAccount.clubName, schemaVersion: 2, savedAt,
      revision: 1, stateChunkCount: chunks.length
    });
    for (let index = 0; index < chunks.length; index += 1) {
      await rawStore.setDocument(`${stateStore.accountPath(accountKey)}/stateChunks/000000000001_${String(index).padStart(4, '0')}`, {
        revision: 1, index, payload: chunks[index]
      });
    }
    await rawStore.setDocument(stateStore.publicationPath(accountKey, 1), {
      status: 'published', attempts: 1, publishedAt: savedAt
    });
  }
  const setup = { venues, profilesPerVenue, responseLimit: limit, hidden, sourceBytes, compressedBytes };
  return async function run() {
    for (const key of Object.keys(counted.counts)) counted.counts[key] = 0;
    let licenseCheckBatches = 0;
    let licensesChecked = 0;
    let responseBody;
    let status = 200;
    const headers = {};
    await routes.handlePublicPlayerDiscovery({ query: { limit } }, {
      set(name, value) { headers[name] = value; return this; },
      status(value) { status = value; return this; },
      json(value) { responseBody = value; return this; }
    }, {
      listStatePage: stateStore.listStatePage,
      nowMs: () => nowMs,
      inspectPilotLicenses: async (codes) => {
        licenseCheckBatches += 1;
        licensesChecked += codes.length;
        return codes.map((code) => ({ managed: true, active: true, license: {
          accountKey: code.slice('synthetic-license:'.length), status: 'active', expiresAt: '2099-01-01T00:00:00.000Z'
        } }));
      }
    });
    assert.equal(status, 200);
    assert.equal(responseBody.ok, true);
    assert.equal(counted.counts.writes, 0);
    assert.equal(responseBody.clubs.length, hidden ? 0 : Math.min(venues, limit));
    const responseBytes = Buffer.byteLength(JSON.stringify(responseBody));
    // Projection timestamps are intentionally live. Normalize only that known
    // volatile field for comparison; actual response bytes are measured above.
    const canonical = { ...responseBody, clubs: responseBody.clubs.map((club) => ({ ...club, generatedAt: savedAt })) };
    const serialized = JSON.stringify(canonical);
    return { kind: 'discovery', setup, operations: { ...counted.counts, licenseCheckBatches, licensesChecked },
      response: { status, bytes: responseBytes, sha256: createHash('sha256').update(serialized).digest('hex'),
        returnedClubs: responseBody.clubs.length, page: responseBody.page, cacheControl: headers['cache-control'] } };
  };
}

module.exports = { countStore, createDiscoveryScenario, syntheticState };
