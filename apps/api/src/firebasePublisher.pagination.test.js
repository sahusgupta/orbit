import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(__filename);
const projectId = 'demo-orbit-pagination';
const clubId = 'synthetic-pagination-club';
const prefix = `projects/${projectId}/databases/(default)/documents/`;
const restPrefix = `https://firestore.googleapis.com/v1/${prefix.slice(0, -1)}`;
const collections = ['players', 'games', 'gameSessions', 'memberships', 'waitlists', 'notifications', 'tournaments', 'tournamentInterests'];
const opaqueToken = 'opaque +/?=&%#雪';

function document(collection, id, sourceProfileId, syncSource = 'orbit-api') {
  return {
    name: `${prefix}clubs/${clubId}/${collection}/${id}`,
    fields: {
      syncSource: { stringValue: syncSource },
      ...(sourceProfileId === undefined ? {} : { sourceProfileId: { stringValue: sourceProfileId } })
    }
  };
}

/**
 * All network and signing operations are synthetic. The real publisher source
 * executes in a VM; its filesystem double rejects credential-file access.
 * @param {(request: { collection: string, phase: string, token: string | null, occurrence: number }) => unknown} page
 * @param {{ requestLimit?: number }} [options]
 */
function fixture(page, { requestLimit = 40 } = {}) {
  const events = [];
  const completedCollections = new Set();
  const occurrences = new Map();
  const state = {
    settings: { clubAccount: { clubName: 'Synthetic Pagination Club' }, pilotAccess: { licenseId: clubId } },
    profiles: [{ id: 'profile-0', name: 'Synthetic Player' }],
    games: [], sessions: [], playerSessions: [], interests: [], buyIns: [], drops: []
  };
  const json = (body) => ({ ok: true, status: 200, json: async () => structuredClone(body) });
  async function fetchFixture(input, init = {}) {
    const url = new URL(String(input));
    const method = init.method || 'GET';
    if (url.href === 'https://oauth2.googleapis.com/token' && method === 'POST') {
      events.push({ kind: 'token' });
      return json({ access_token: 'inert-pagination-fixture' });
    }
    assert.equal(url.origin, 'https://firestore.googleapis.com');
    if (url.href === `${restPrefix}:batchWrite` && method === 'POST') {
      const { writes } = JSON.parse(String(init.body));
      assert.ok(Array.isArray(writes) && writes.length > 0 && writes.length <= 250);
      const stage = writes.every((write) => typeof write.delete === 'string')
        ? (completedCollections.size === collections.length && events.some((event) => event.kind === 'list' && event.phase === 'legacy') ? 'legacy' : 'stale')
        : 'projection';
      events.push({ kind: 'batch', stage, writes });
      return json({ status: writes.map(() => ({})) });
    }
    if (url.href === `${restPrefix}/clubs/${clubId}` && method === 'PATCH') {
      events.push({ kind: 'parent' });
      return json({});
    }
    const collection = url.pathname.split('/').at(-1);
    assert.ok(collections.includes(collection));
    assert.equal(url.origin + url.pathname, `${restPrefix}/clubs/${clubId}/${collection}`);
    assert.equal(method, 'GET');
    assert.equal(url.searchParams.get('pageSize'), '500');
    const token = url.searchParams.get('pageToken');
    const phase = collection === 'players' && completedCollections.size === collections.length ? 'legacy' : 'projection';
    const key = `${phase}:${collection}`;
    const occurrence = (occurrences.get(key) || 0) + 1;
    occurrences.set(key, occurrence);
    events.push({ kind: 'list', collection, phase, token, occurrence, url: url.href });
    // A broken production loop must fail deterministically, never hang the suite.
    if (occurrence > requestLimit) throw new Error('Synthetic provider request cap reached.');
    const payload = page({ collection, phase, token, occurrence });
    const returnedToken = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? Reflect.get(payload, 'nextPageToken') : undefined;
    if (phase === 'projection' && !String(returnedToken || '')) completedCollections.add(collection);
    return json(payload);
  }
  const fixtureCrypto = {
    ...crypto,
    createSign() { return { update() { return this; }, sign() { return 'synthetic-signature'; } }; }
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('./firebasePublisher.js'), 'utf8'), {
    module, Buffer, Date, JSON, URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    process: { env: { NODE_ENV: 'test', FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      project_id: projectId, client_email: 'synthetic-publisher@example.invalid', private_key: 'unused-fixture'
    }) } },
    fetch: fetchFixture,
    require(name) {
      if (name === 'crypto') return fixtureCrypto;
      if (name === 'fs') return { readFileSync() { throw new Error('Credential file access is forbidden in this fixture.'); } };
      return require(name);
    }
  });
  return {
    events,
    staleCleanup(expected = {}) {
      return module.exports.deleteStaleOwnedProjectionDocuments(projectId, 'inert-pagination-fixture', clubId, expected);
    },
    publish() {
      return module.exports.publishStateToFirebase(state, { savedAt: '2026-10-31T00:00:00.000Z', syncRevision: 'pagination-revision' });
    }
  };
}

describe('publisher pagination characterization', () => {
  it('treats opaque tokens as exact URL-encoded values independently for each collection', async () => {
    const f = fixture(({ collection, token }) => token === null
      ? { documents: [document(collection, 'stale-first')], nextPageToken: opaqueToken }
      : { documents: [document(collection, 'stale-last')] });
    await expect(f.staleCleanup()).resolves.toBe(collections.length * 2);
    const lists = f.events.filter((event) => event.kind === 'list');
    for (const collection of collections) {
      expect(lists.filter((event) => event.collection === collection).map((event) => event.token)).toEqual([null, opaqueToken]);
    }
    const encoded = new URLSearchParams({ pageToken: opaqueToken }).toString();
    expect(lists.filter((event) => event.token !== null).every((event) => event.url.includes(encoded))).toBe(true);
    const deletion = f.events.filter((event) => event.kind === 'batch');
    expect(deletion).toHaveLength(1);
    expect(deletion[0].writes.map((write) => write.delete)).toEqual(collections.flatMap((collection) => [
      document(collection, 'stale-first').name, document(collection, 'stale-last').name
    ]));
    expect(f.events.at(-1).kind).toBe('batch');
  });

  it('reuses the same tokens in a fresh legacy recheck and preserves counters, cleanup phases and marker order', async () => {
    const f = fixture(({ collection, phase, token }) => {
      if (collection === 'players') {
        if (phase === 'legacy') return token === null
          ? { documents: [document('players', 'legacy-first', 'profile-0', 'orbit-desktop')], nextPageToken: opaqueToken }
          : { documents: [document('players', 'legacy-last', 'profile-0', 'orbit-desktop')] };
        return token === null
          ? { documents: [document('players', 'owned-stale-first'), document('players', 'legacy-first', 'profile-0', 'orbit-desktop')], nextPageToken: opaqueToken }
          : { documents: [document('players', 'owned-stale-last'), document('players', 'legacy-last', 'profile-0', 'orbit-desktop')] };
      }
      if (collection === 'games') return token === null
        ? { documents: [document('games', 'stale-first')], nextPageToken: opaqueToken }
        : { documents: [document('games', 'stale-last')] };
      return { documents: [] };
    });
    const result = await f.publish();
    expect(result).toMatchObject({ ok: true, staleProjectionDocumentsRemoved: 4, legacyPlayersRemoved: 2 });
    const batches = f.events.filter((event) => event.kind === 'batch');
    expect(batches.map((event) => event.stage)).toEqual(['projection', 'stale', 'legacy']);
    expect(batches[1].writes.map((write) => write.delete)).toEqual([
      document('players', 'owned-stale-first').name, document('players', 'owned-stale-last').name,
      document('games', 'stale-first').name, document('games', 'stale-last').name
    ]);
    expect(batches[2].writes.map((write) => write.delete)).toEqual([
      document('players', 'legacy-first').name, document('players', 'legacy-last').name
    ]);
    expect(result.publicationWriteCount).toBe(batches.reduce((count, batch) => count + batch.writes.length, 0) + 1);
    expect(f.events.filter((event) => event.kind === 'list' && event.collection === 'players')
      .map((event) => [event.phase, event.token])).toEqual([
      ['projection', null], ['projection', opaqueToken], ['legacy', null], ['legacy', opaqueToken]
    ]);
    expect(f.events.at(-1).kind).toBe('parent');
  });

  it.each([undefined, null, '', false, 0, NaN])('keeps the current terminal-token semantics for %s in stale cleanup', async (nextPageToken) => {
    const f = fixture(() => ({ documents: [], nextPageToken }));
    await expect(f.staleCleanup()).resolves.toBe(0);
    expect(f.events.filter((event) => event.kind === 'list')).toHaveLength(collections.length);
    expect(f.events.every((event) => event.kind === 'list' && event.token === null)).toBe(true);
  });

  it.each([undefined, null, '', false, 0, NaN])('keeps the current terminal-token semantics for %s in legacy rechecks', async (nextPageToken) => {
    const f = fixture(({ collection }) => ({
      documents: collection === 'players' ? [document('players', 'legacy-row', 'profile-0', 'orbit-desktop')] : [],
      nextPageToken
    }));
    await expect(f.publish()).resolves.toMatchObject({ ok: true, legacyPlayersRemoved: 1 });
    const lists = f.events.filter((event) => event.kind === 'list');
    expect(lists).toHaveLength(collections.length + 1);
    expect(lists.every((event) => event.token === null)).toBe(true);
    expect(f.events.at(-1).kind).toBe('parent');
  });
});

describe('publisher pagination cycle recovery', () => {
  const cycles = [
    { kind: 'same token', requests: 2 },
    { kind: 'multi-token cycle', requests: 3 }
  ];
  const secondToken = 'second opaque private +/?=&%#';
  const nextToken = (kind, token) => kind === 'same token' || token === null || token === secondToken
    ? opaqueToken : secondToken;
  function expectRedactedFailure(error, category) {
    expect(error).toMatchObject({
      name: 'FirebasePublicationError', code: 'FIREBASE_PUBLICATION_FAILED', category,
      pathRef: expect.stringMatching(/^[a-f0-9]{16}$/)
    });
    const serialized = JSON.stringify({ error, message: error.message });
    for (const forbidden of [opaqueToken, secondToken, clubId, projectId, 'provider-only-legacy-row', 'provider-only-stale-row']) {
      expect(serialized).not.toContain(forbidden);
    }
  }

  it.each(cycles)('rejects a projection $kind without any cleanup writes', async ({ kind, requests }) => {
    const f = fixture(({ collection, token }) => ({
      documents: [document(collection, 'provider-only-stale-row')],
      ...(collection === 'games' ? { nextPageToken: nextToken(kind, token) } : {})
    }), { requestLimit: requests });
    const error = await f.staleCleanup().catch((value) => value);
    expectRedactedFailure(error, 'projection-list-response-invalid');
    expect(f.events.filter((event) => event.kind === 'list' && event.collection === 'games')).toHaveLength(requests);
    expect(f.events.some((event) => event.kind === 'batch' || event.kind === 'parent')).toBe(false);
  });

  it.each(cycles)('rejects a legacy $kind after completed stale cleanup but before legacy deletes or the marker', async ({ kind, requests }) => {
    const f = fixture(({ collection, phase, token }) => {
      if (phase === 'legacy') return {
        documents: [document('players', 'provider-only-legacy-row', 'profile-0', 'orbit-desktop')],
        nextPageToken: nextToken(kind, token)
      };
      return { documents: collection === 'players'
        ? [document('players', 'provider-only-legacy-row', 'profile-0', 'orbit-desktop')]
        : collection === 'games' ? [document('games', 'provider-only-stale-row')] : [] };
    }, { requestLimit: requests });
    const error = await f.publish().catch((value) => value);
    expectRedactedFailure(error, 'player-list-response-invalid');
    expect(f.events.filter((event) => event.kind === 'list' && event.phase === 'legacy')).toHaveLength(requests);
    const batches = f.events.filter((event) => event.kind === 'batch');
    expect(batches.map((event) => event.stage)).toEqual(['projection', 'stale']);
    expect(batches[1].writes.map((write) => write.delete)).toEqual([document('games', 'provider-only-stale-row').name]);
    expect(f.events.some((event) => event.kind === 'parent')).toBe(false);
  });
});
