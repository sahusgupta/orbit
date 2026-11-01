import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(__filename);
const projectId = 'demo-orbit-publication-cleanup';
const clubId = 'synthetic-cleanup-club';
const prefix = `projects/${projectId}/databases/(default)/documents/`;
const restPrefix = `https://firestore.googleapis.com/v1/${prefix.slice(0, -1)}`;
const playerName = (id) => `${prefix}clubs/${clubId}/players/${id}`;
const gameName = (id) => `${prefix}clubs/${clubId}/games/${id}`;
const collections = ['players', 'games', 'gameSessions', 'memberships', 'waitlists', 'notifications', 'tournaments', 'tournamentInterests'];

/**
 * @param {{
 *   players?: number, stalePlayers?: number, legacyPlayers?: number, overlap?: boolean,
 *   listFailure?: { collection: string, onOccurrence?: number, mode?: string, payload?: unknown },
 *   deleteFailure?: string,
 *   onList?: (details: {
 *     collection: string, documents: Map<string, { name: string, fields: Record<string, unknown> }>,
 *     events: readonly unknown[], legacyNames: Set<string>
 *   }) => void
 * }} [options]
 */
function fixture({ players = 3, stalePlayers = 1, legacyPlayers = 1, overlap = true, listFailure, deleteFailure, onList } = {}) {
  const state = {
    settings: { clubAccount: { clubName: 'Synthetic Cleanup Club' }, pilotAccess: { licenseId: clubId } },
    profiles: Array.from({ length: players }, (_unused, index) => ({ id: `profile-${index}`, name: `Synthetic ${index}` })),
    games: [], sessions: [], playerSessions: [], interests: [], buyIns: [], drops: []
  };
  const documents = new Map();
  const staleNames = new Set();
  const legacyNames = new Set();
  const events = [];
  const insert = (name, syncSource, sourceProfileId) => {
    documents.set(name, { name, fields: {
      syncSource: { stringValue: syncSource },
      ...(sourceProfileId === undefined ? {} : { sourceProfileId: { stringValue: sourceProfileId } })
    } });
  };
  for (let index = 0; index < stalePlayers; index += 1) {
    const name = playerName(`stale-owned-${String(index).padStart(4, '0')}`);
    insert(name, 'orbit-api');
    staleNames.add(name);
  }
  for (let index = 0; index < legacyPlayers; index += 1) {
    const name = playerName(`legacy-${String(index).padStart(4, '0')}`);
    insert(name, 'orbit-desktop', 'profile-0');
    legacyNames.add(name);
  }
  if (overlap) {
    insert(playerName('owned-and-legacy'), 'orbit-api', 'profile-0');
    staleNames.add(playerName('owned-and-legacy'));
  }
  insert(gameName('stale-game'), 'orbit-api');
  staleNames.add(gameName('stale-game'));
  insert(gameName('foreign-game'), 'orbit-desktop');
  insert(playerName('foreign-unlinked'), 'orbit-desktop', 'unlinked-profile');
  insert(playerName('foreign-no-profile'), 'unrelated-source');

  const json = (body) => ({ ok: true, status: 200, json: async () => structuredClone(body) });
  async function fetchFixture(input, init = {}) {
    const url = new URL(String(input));
    const method = init.method || 'GET';
    if (url.href === 'https://oauth2.googleapis.com/token' && method === 'POST') {
      events.push({ kind: 'token' });
      return json({ access_token: 'inert-cleanup-fixture-token' });
    }
    assert.equal(url.origin, 'https://firestore.googleapis.com');
    if (url.href === `${restPrefix}:batchWrite` && method === 'POST') {
      const { writes } = JSON.parse(String(init.body));
      assert.ok(Array.isArray(writes) && writes.length > 0 && writes.length <= 250);
      const deleting = writes.every((write) => typeof write.delete === 'string');
      const stage = deleting ? (staleNames.has(writes[0].delete) ? 'stale' : 'legacy') : 'projection';
      events.push({ kind: 'batch', stage, writes });
      if (stage === deleteFailure) return json({ status: writes.map((_write, index) => index ? {} : { code: 7 }) });
      for (const write of writes) {
        if (deleting) {
          assert.ok(stage === 'stale' ? staleNames.has(write.delete) : legacyNames.has(write.delete));
          assert.ok(documents.delete(write.delete), 'A cleanup path must be deleted exactly once.');
        } else {
          assert.ok(write.update.name.startsWith(prefix));
          documents.set(write.update.name, structuredClone(write.update));
        }
      }
      return json({ status: writes.map(() => ({})) });
    }
    if (url.href === `${restPrefix}/clubs/${clubId}` && method === 'PATCH') {
      documents.set(`${prefix}clubs/${clubId}`, { name: `${prefix}clubs/${clubId}`, fields: JSON.parse(String(init.body)).fields });
      events.push({ kind: 'parent' });
      return json({});
    }
    const collection = url.pathname.split('/').at(-1);
    assert.ok(collections.includes(collection));
    assert.equal(url.origin + url.pathname, `${restPrefix}/clubs/${clubId}/${collection}`);
    assert.equal(method, 'GET');
    assert.equal(url.searchParams.get('pageSize'), '500');
    const offset = Number(url.searchParams.get('pageToken') || 0);
    const collectionPrefix = `${prefix}clubs/${clubId}/${collection}/`;
    const page = [...documents.values()].filter((document) => document.name.startsWith(collectionPrefix))
      .sort((left, right) => left.name.localeCompare(right.name));
    events.push({ kind: 'list', collection, offset, count: page.slice(offset, offset + 500).length });
    onList?.({ collection, documents, events, legacyNames });
    const collectionOccurrence = events.filter((event) => event.kind === 'list' && event.collection === collection).length;
    if (listFailure?.collection === collection && (!listFailure.onOccurrence || listFailure.onOccurrence === collectionOccurrence)) {
      if (listFailure.mode === 'http') return { ok: false, status: 403, text: async () => 'Synthetic denied response' };
      if (listFailure.mode === 'json') return { ok: true, json: async () => { throw new Error('Synthetic malformed JSON'); } };
      return json(listFailure.payload);
    }
    return json({ documents: page.slice(offset, offset + 500), ...(offset + 500 < page.length ? { nextPageToken: String(offset + 500) } : {}) });
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
    publisher: module.exports, documents, staleNames, legacyNames, events, state,
    publish() { return module.exports.publishStateToFirebase(state, { savedAt: '2026-10-31T00:00:00.000Z', syncRevision: 'cleanup-revision' }); }
  };
}

describe('publication cleanup characterization', () => {
  it('preserves ownership, separates overlapping cleanup counters and publishes the marker last', async () => {
    const f = fixture();
    const result = await f.publish();
    expect(result).toMatchObject({ ok: true, players: 3, staleProjectionDocumentsRemoved: 3, legacyPlayersRemoved: 1, publicationWriteCount: 12 });
    const deletes = f.events.filter((event) => event.kind === 'batch' && event.stage !== 'projection');
    expect(deletes.map((event) => event.stage)).toEqual(['stale', 'legacy']);
    expect(new Set(deletes[0].writes.map((write) => write.delete))).toEqual(f.staleNames);
    expect(new Set(deletes[1].writes.map((write) => write.delete))).toEqual(f.legacyNames);
    expect(f.events.at(-1).kind).toBe('parent');
    expect(f.documents.has(playerName('foreign-unlinked'))).toBe(true);
    expect(f.documents.has(playerName('foreign-no-profile'))).toBe(true);
    expect(f.documents.has(gameName('foreign-game'))).toBe(true);
    const marker = f.documents.get(`${prefix}clubs/${clubId}`).fields;
    expect(marker.syncProtocolVersion).toEqual({ integerValue: '2' });
    expect(marker.syncRevision).toEqual({ stringValue: 'cleanup-revision' });
  });

  it('retains paginated cleanup, bounded delete batches and stale-before-legacy ordering', async () => {
    const f = fixture({ players: 1, stalePlayers: 501, legacyPlayers: 501, overlap: false });
    const result = await f.publish();
    expect(result).toMatchObject({ staleProjectionDocumentsRemoved: 502, legacyPlayersRemoved: 501 });
    const deletes = f.events.filter((event) => event.kind === 'batch' && event.stage !== 'projection');
    expect(deletes.map((event) => [event.stage, event.writes.length])).toEqual([
      ['stale', 250], ['stale', 250], ['stale', 2], ['legacy', 250], ['legacy', 250], ['legacy', 1]
    ]);
    expect(new Set(deletes.flatMap((event) => event.writes.map((write) => write.delete))).size).toBe(1003);
    expect(f.events.at(-1).kind).toBe('parent');
  });

  it.each(['stale', 'legacy'])('stops subsequent phases and the parent marker after %s deletion failure', async (stage) => {
    const f = fixture({ deleteFailure: stage });
    await expect(f.publish()).rejects.toMatchObject({ category: 'batch-write-partial-failure' });
    expect(f.events.some((event) => event.kind === 'parent')).toBe(false);
    if (stage === 'stale') expect(f.events.some((event) => event.kind === 'batch' && event.stage === 'legacy')).toBe(false);
  });

  it.each([
    { collection: 'players', mode: 'json' },
    { collection: 'players', payload: null },
    { collection: 'players', payload: [] },
    { collection: 'players', payload: { documents: {} } },
    { collection: 'games', mode: 'http' }
  ])('fails closed before cleanup and the parent marker for invalid provider listing %j', async (listFailure) => {
    const f = fixture({ listFailure });
    await expect(f.publish()).rejects.toMatchObject({ category: listFailure.mode === 'http' ? 'projection-list' : 'projection-list-response-invalid' });
    expect(f.events.filter((event) => event.kind === 'batch').map((event) => event.stage)).toEqual(['projection']);
    expect(f.events.some((event) => event.kind === 'parent')).toBe(false);
  });

  it('retains the exported stale-only cleanup contract without deleting legacy foreign players', async () => {
    const f = fixture();
    await expect(f.publisher.deleteStaleOwnedProjectionDocuments(projectId, 'inert-fixture', clubId, {})).resolves.toBe(3);
    expect(f.documents.has(playerName('legacy-0000'))).toBe(true);
    expect(f.events.some((event) => event.kind === 'parent')).toBe(false);
  });

  it('keeps unlinked legacy rows when no canonical profile can authorize legacy cleanup', async () => {
    const f = fixture({ players: 0, overlap: false });
    const result = await f.publish();
    expect(result.legacyPlayersRemoved).toBe(0);
    expect(f.documents.has(playerName('legacy-0000'))).toBe(true);
    expect(f.events.filter((event) => event.kind === 'list' && event.collection === 'players')).toHaveLength(1);
  });

  it('rechecks a foreign legacy candidate after other collection scans before deleting it', async () => {
    const f = fixture({ onList({ collection, documents }) {
      if (collection === 'games') {
        documents.get(playerName('legacy-0000')).fields.sourceProfileId = { stringValue: 'now-unlinked-profile' };
      }
    } });
    const result = await f.publish();
    expect(result.legacyPlayersRemoved).toBe(0);
    expect(f.documents.has(playerName('legacy-0000'))).toBe(true);
    expect(f.events.at(-1).kind).toBe('parent');
  });

  it.each(['http', 'json', 'malformed'])('retains fresh legacy-list %s failures after stale cleanup and before the marker', async (mode) => {
    const f = fixture({ listFailure: { collection: 'players', onOccurrence: 2, mode, payload: null } });
    await expect(f.publish()).rejects.toMatchObject({ category: mode === 'http' ? 'player-list' : 'player-list-response-invalid' });
    for (const name of f.staleNames) expect(f.documents.has(name)).toBe(false);
    expect(f.documents.has(playerName('legacy-0000'))).toBe(true);
    expect(f.events.some((event) => event.kind === 'parent')).toBe(false);
  });
});

describe('common-path cleanup read reduction', () => {
  it.each([3, 501])('enumerates players once when %i canonical players have no foreign legacy candidate', async (players) => {
    const f = fixture({ players, stalePlayers: 0, legacyPlayers: 0, overlap: false });
    const result = await f.publish();
    expect(result).toMatchObject({ ok: true, staleProjectionDocumentsRemoved: 1, legacyPlayersRemoved: 0 });
    expect(f.events.filter((event) => event.kind === 'list' && event.collection === 'players'))
      .toHaveLength(Math.ceil((players + 2) / 500));
    expect(f.events.at(-1).kind).toBe('parent');
  });

  it('does not rescan player rows already removed by owned-stale cleanup', async () => {
    const f = fixture({ players: 1, stalePlayers: 1, legacyPlayers: 0, overlap: true });
    const result = await f.publish();
    expect(result).toMatchObject({ staleProjectionDocumentsRemoved: 3, legacyPlayersRemoved: 0 });
    expect(f.events.filter((event) => event.kind === 'list' && event.collection === 'players')).toHaveLength(1);
    expect(f.documents.has(playerName('owned-and-legacy'))).toBe(false);
  });

  it('defers a legacy row introduced after a clean first scan until the next publication', async () => {
    let introduced = false;
    const lateName = playerName('legacy-late');
    const f = fixture({ stalePlayers: 0, legacyPlayers: 0, overlap: false, onList({ collection, documents, legacyNames }) {
      if (collection === 'games' && !introduced) {
        introduced = true;
        legacyNames.add(lateName);
        documents.set(lateName, { name: lateName, fields: {
          syncSource: { stringValue: 'orbit-desktop' }, sourceProfileId: { stringValue: 'profile-0' }
        } });
      }
    } });
    expect((await f.publish()).legacyPlayersRemoved).toBe(0);
    expect(f.documents.has(lateName)).toBe(true);
    expect((await f.publish()).legacyPlayersRemoved).toBe(1);
    expect(f.documents.has(lateName)).toBe(false);
  });
});
