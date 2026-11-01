import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sourceRequire = createRequire(__filename);
const sourcePath = sourceRequire.resolve('./firebasePublisher.js');
const projectId = 'demo-orbit-projection-mask';
const clubId = 'synthetic-mask-club';
const prefix = `projects/${projectId}/databases/(default)/documents/`;
const restPrefix = `https://firestore.googleapis.com/v1/${prefix.slice(0, -1)}`;
const savedAt = '2026-10-31T00:00:00.000Z';
const collections = ['players', 'games', 'gameSessions', 'memberships', 'waitlists', 'notifications', 'tournaments', 'tournamentInterests'];
const documentName = (collection, id) => `${prefix}clubs/${clubId}/${collection}/${id}`;
const sha = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** @typedef {{ name: string, fields?: Record<string, unknown>, createTime?: string, updateTime?: string }} FixtureDocument */
/** @typedef {{ delete: string } | { update: FixtureDocument }} FixtureWrite */
/** @typedef {{ kind: 'token' | 'list' | 'batch' | 'parent', collection?: string, phase?: string, token?: string | null, masks?: string[], stage?: string, writes?: FixtureWrite[], count?: number, responseBytes?: number, url?: string }} FixtureEvent */
/** @typedef {'full' | 'essential' | 'request'} ResponseMode */

/** @param {string} phase @param {string} collection */
function cleanupFields(phase, collection) {
  return phase === 'legacy' ? ['sourceProfileId']
    : collection === 'players' ? ['syncSource', 'sourceProfileId'] : ['syncSource'];
}

/**
 * Only this fake transport receives provider-shaped URLs. Its projection copies
 * returned fields; the full stored records, document metadata and page envelope
 * remain separate. No real signing, credential file or network is available.
 * @param {{ responseMode?: ResponseMode, players?: number, pageLength?: number, legacyRows?: boolean, changeLegacy?: boolean }} [options]
 */
function fixture({ responseMode = 'request', players = 3, pageLength = 2, legacyRows = true, changeLegacy = false } = {}) {
  const state = {
    settings: { clubAccount: { clubName: 'Synthetic Mask Club' }, pilotAccess: { licenseId: clubId } },
    profiles: Array.from({ length: players }, (_unused, index) => ({ id: `profile-${index}`, name: `Synthetic ${index}` })),
    games: [], sessions: [], playerSessions: [], interests: [], buyIns: [], drops: []
  };
  /** @type {Map<string, FixtureDocument>} */
  const documents = new Map();
  /** @type {FixtureEvent[]} */
  const events = [];
  const staleNames = new Set();
  const legacyNames = new Set();
  const foreignNames = new Set();
  const completedCollections = new Set();
  const listMetrics = { requests: 0, documents: 0, responseJsonBytes: 0 };
  /** @param {string} collection @param {string} id @param {Record<string, unknown>} [fields] */
  function insert(collection, id, fields) {
    const name = documentName(collection, id);
    documents.set(name, { name, createTime: '2000-01-01T00:00:00.000Z', updateTime: savedAt,
      ...(fields === undefined ? {} : { fields: structuredClone(fields) }) });
    return name;
  }
  for (const collection of collections) {
    staleNames.add(insert(collection, 'owned-stale', { syncSource: { stringValue: 'orbit-api' } }));
    foreignNames.add(insert(collection, 'foreign-padded', {
      syncSource: { stringValue: 'unrelated-source' },
      unusedSyntheticPadding: { stringValue: 'synthetic-padding-'.repeat(1024) },
      unrelatedNestedData: { mapValue: { fields: { preserved: { stringValue: collection } } } }
    }));
  }
  staleNames.add(insert('players', 'owned-and-legacy', {
    syncSource: { stringValue: 'orbit-api' }, sourceProfileId: { stringValue: 'profile-0' }
  }));
  if (legacyRows) {
    legacyNames.add(insert('players', 'legacy-linked', {
      syncSource: { stringValue: 'orbit-desktop' }, sourceProfileId: { stringValue: 'profile-0' }
    }));
    // Fresh legacy cleanup deliberately does not add a syncSource restriction.
    legacyNames.add(insert('players', 'legacy-without-source', { sourceProfileId: { stringValue: 'profile-0' } }));
  }
  foreignNames.add(insert('players', 'foreign-unlinked', {
    syncSource: { stringValue: 'orbit-desktop' }, sourceProfileId: { stringValue: 'unlinked-profile' }
  }));
  foreignNames.add(insert('players', 'foreign-no-fields'));
  foreignNames.add(insert('players', 'foreign-malformed-profile', {
    syncSource: { stringValue: 'orbit-desktop' }, sourceProfileId: { integerValue: '7' }
  }));
  const foreignBefore = [...foreignNames].map(name => structuredClone(documents.get(name)));
  const tokenFor = offset => `opaque +/?=&%#雪:${offset}`;
  const tokens = new Map(Array.from({ length: 2048 }, (_value, index) => [tokenFor(index * pageLength), index * pageLength]));
  /** @param {unknown} payload */
  const json = payload => {
    const serialized = JSON.stringify(payload);
    return { ok: true, status: 200, json: async () => JSON.parse(serialized), text: async () => serialized };
  };
  /** @param {FixtureDocument} document @param {string[]} fields */
  function project(document, fields) {
    const { fields: storedFields, ...metadata } = document;
    const selected = Object.fromEntries(fields.filter(field => Object.hasOwn(storedFields || {}, field))
      .map(field => [field, structuredClone(storedFields[field])]));
    return { ...metadata, ...(Object.keys(selected).length ? { fields: selected } : {}) };
  }
  /** @param {string | URL} input @param {RequestInit} [init] */
  async function fetchFixture(input, init = {}) {
    const url = new URL(String(input));
    const method = init.method || 'GET';
    if (url.href === 'https://oauth2.googleapis.com/token' && method === 'POST') {
      events.push({ kind: 'token' }); return json({ access_token: 'inert-mask-fixture-token' });
    }
    assert.equal(url.origin, 'https://firestore.googleapis.com');
    if (url.href === `${restPrefix}:batchWrite` && method === 'POST') {
      /** @type {{ writes: FixtureWrite[] }} */
      const body = JSON.parse(String(init.body));
      const writes = body.writes;
      assert.ok(Array.isArray(writes) && writes.length > 0 && writes.length <= 250);
      const deleting = writes.every(write => 'delete' in write);
      const stage = deleting ? (writes.every(write => 'delete' in write && staleNames.has(write.delete)) ? 'stale' : 'legacy') : 'projection';
      events.push({ kind: 'batch', stage, writes: structuredClone(writes) });
      for (const write of writes) {
        if ('delete' in write) {
          assert.ok(staleNames.has(write.delete) || legacyNames.has(write.delete));
          assert.ok(documents.delete(write.delete), 'A cleanup name is deleted exactly once.');
        } else {
          assert.ok(write.update.name.startsWith(prefix));
          documents.set(write.update.name, { ...structuredClone(write.update), createTime: savedAt, updateTime: savedAt });
        }
      }
      return json({ status: writes.map(() => ({})) });
    }
    if (url.href === `${restPrefix}/clubs/${clubId}` && method === 'PATCH') {
      const body = JSON.parse(String(init.body));
      documents.set(`${prefix}clubs/${clubId}`, { name: `${prefix}clubs/${clubId}`, fields: body.fields, createTime: savedAt, updateTime: savedAt });
      events.push({ kind: 'parent' }); return json({});
    }
    assert.equal(method, 'GET');
    const collection = url.pathname.split('/').at(-1);
    assert.ok(collections.includes(collection));
    assert.equal(url.origin + url.pathname, `${restPrefix}/clubs/${clubId}/${collection}`);
    assert.equal(url.searchParams.get('pageSize'), '500');
    const phase = collection === 'players' && completedCollections.size === collections.length ? 'legacy' : 'projection';
    if (changeLegacy && collection === 'games') {
      const candidate = documents.get(documentName('players', 'legacy-linked'));
      if (candidate?.fields) candidate.fields.sourceProfileId = { stringValue: 'now-unlinked-profile' };
    }
    const token = url.searchParams.get('pageToken');
    const offset = token === null ? 0 : tokens.get(token);
    assert.ok(Number.isInteger(offset), 'Opaque tokens must survive URL encoding exactly.');
    const all = [...documents.values()].filter(document => document.name.startsWith(`${prefix}clubs/${clubId}/${collection}/`))
      .sort((left, right) => left.name.localeCompare(right.name));
    const masks = url.searchParams.getAll('mask.fieldPaths');
    const chosen = responseMode === 'essential' ? cleanupFields(phase, collection) : masks;
    const page = all.slice(offset, offset + pageLength).map(document => responseMode === 'full' || !chosen.length
      ? structuredClone(document) : project(document, chosen));
    const nextPageToken = offset + pageLength < all.length ? tokenFor(offset + pageLength) : undefined;
    const payload = { documents: page, ...(nextPageToken ? { nextPageToken } : {}) };
    if (phase === 'projection' && !nextPageToken) completedCollections.add(collection);
    const responseBytes = Buffer.byteLength(JSON.stringify(payload));
    listMetrics.requests += 1; listMetrics.documents += page.length; listMetrics.responseJsonBytes += responseBytes;
    assert.ok(listMetrics.requests <= 100, 'A broken loop must fail finitely.');
    events.push({ kind: 'list', collection, phase, token, masks, count: page.length, responseBytes, url: url.href });
    return json(payload);
  }
  /** @type {{ exports: Pick<typeof import('./firebasePublisher.js'), 'publishStateToFirebase' | 'deleteStaleOwnedProjectionDocuments'> }} */
  const module = { exports: {
    async publishStateToFirebase() { throw new Error('Synthetic publisher did not load.'); },
    async deleteStaleOwnedProjectionDocuments() { throw new Error('Synthetic publisher did not load.'); }
  } };
  vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), {
    module, Buffer, Date, JSON, URL, URLSearchParams, Error, AbortController, setTimeout, clearTimeout,
    process: { env: { NODE_ENV: 'test', FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      project_id: projectId, client_email: 'synthetic-mask@example.invalid', private_key: 'unused-fixture'
    }) } },
    fetch: fetchFixture,
    require(name) {
      if (name === 'crypto') return { ...crypto, createSign: () => ({ update() { return this; }, sign() { return 'synthetic-signature'; } }) };
      if (name === 'fs') return { readFileSync() { throw new Error('Credential file access forbidden.'); } };
      if (name === './orbitCore') return sourceRequire(name);
      if (name === './operations/dataProtection') return { protectedIdentifier: value => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16) };
      throw new Error('Unexpected dependency in synthetic publisher VM.');
    }
  }, { filename: sourcePath });
  return {
    events, documents, foreignNames, foreignBefore, staleNames, legacyNames, listMetrics,
    publish() { return module.exports.publishStateToFirebase(state, { savedAt, syncRevision: 'mask-revision' }); },
    staleOnly() { return module.exports.deleteStaleOwnedProjectionDocuments(projectId, 'inert-mask-fixture-token', clubId, {}); },
    storeSha() { return sha([...documents.entries()].sort(([left], [right]) => left.localeCompare(right))); },
    foreignAfter() { return [...foreignNames].map(name => structuredClone(documents.get(name))); }
  };
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(savedAt));
  vi.stubGlobal('fetch', () => { throw new Error('Native network access is forbidden in this unit fixture.'); });
});
afterEach(() => {
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('cleanup listing projection characterization', () => {
  it('needs only cleanup fields while preserving opaque pages, ownership, counters, full store and marker order', async () => {
    const full = fixture({ responseMode: 'full' });
    const essential = fixture({ responseMode: 'essential' });
    const before = await full.publish(); const after = await essential.publish();
    expect(after).toEqual(before);
    expect(before).toMatchObject({ ok: true, staleProjectionDocumentsRemoved: 9, legacyPlayersRemoved: 2, publicationWriteCount: 19 });
    expect(essential.storeSha()).toBe(full.storeSha());
    expect(full.foreignAfter()).toEqual(full.foreignBefore); expect(essential.foreignAfter()).toEqual(essential.foreignBefore);
    for (const f of [full, essential]) {
      expect(f.events.filter(event => event.kind === 'batch').map(event => event.stage)).toEqual(['projection', 'stale', 'legacy']);
      expect(f.events.at(-1).kind).toBe('parent');
      expect(f.events.filter(event => event.kind === 'list' && event.phase === 'legacy').length).toBeGreaterThan(1);
      expect(f.events.some(event => event.kind === 'list' && event.token?.includes('opaque +/?=&%#雪'))).toBe(true);
    }
    expect(essential.listMetrics.requests).toBe(full.listMetrics.requests);
    expect(essential.listMetrics.documents).toBe(full.listMetrics.documents);
    expect(essential.listMetrics.responseJsonBytes).toBeLessThan(full.listMetrics.responseJsonBytes);
  });
  it('uses the fresh legacy sourceProfileId after earlier collection scans without changing foreign metadata', async () => {
    const full = fixture({ responseMode: 'full', changeLegacy: true });
    const essential = fixture({ responseMode: 'essential', changeLegacy: true });
    expect(await essential.publish()).toEqual(await full.publish());
    expect(essential.storeSha()).toBe(full.storeSha());
    expect(essential.documents.has(documentName('players', 'legacy-linked'))).toBe(true);
    expect(essential.documents.has(documentName('players', 'legacy-without-source'))).toBe(false);
    expect(essential.foreignAfter()).toEqual(essential.foreignBefore);
    expect(essential.events.at(-1).kind).toBe('parent');
  });
  it('retains the exported stale-only contract with missing/malformed fields and complete foreign records', async () => {
    const full = fixture({ responseMode: 'full' }); const essential = fixture({ responseMode: 'essential' });
    expect(await essential.staleOnly()).toBe(await full.staleOnly());
    expect(essential.storeSha()).toBe(full.storeSha());
    expect(essential.foreignAfter()).toEqual(essential.foreignBefore);
    expect(essential.documents.has(documentName('players', 'legacy-linked'))).toBe(true);
    expect(essential.events.some(event => event.kind === 'parent')).toBe(false);
  });
  it('measures only list JSON bytes for 1000 real canonical projections plus controlled synthetic foreign padding', async () => {
    const full = fixture({ responseMode: 'full', players: 1000, pageLength: 500, legacyRows: false });
    const essential = fixture({ responseMode: 'essential', players: 1000, pageLength: 500, legacyRows: false });
    expect(await essential.publish()).toEqual(await full.publish());
    expect(essential.storeSha()).toBe(full.storeSha());
    expect(essential.foreignAfter()).toEqual(essential.foreignBefore);
    const canonicalPlayers = [...essential.documents.values()].filter(document => document.name.includes('/players/') && document.fields?.syncSource?.['stringValue'] === 'orbit-api');
    expect(canonicalPlayers).toHaveLength(1000);
    expect(canonicalPlayers.every(document => Object.keys(document.fields).length > 2)).toBe(true);
    expect(essential.listMetrics.requests).toBe(full.listMetrics.requests);
    expect(essential.listMetrics.documents).toBe(full.listMetrics.documents);
    expect(essential.listMetrics.responseJsonBytes).toBeLessThan(full.listMetrics.responseJsonBytes);
  });
});

describe('cleanup listing DocumentMask contract', () => {
  it('requests only the required fields on every projection and fresh legacy page', async () => {
    const f = fixture();
    await f.publish();
    const lists = f.events.filter(event => event.kind === 'list');
    expect(lists.some(event => event.phase === 'legacy' && event.token !== null)).toBe(true);
    for (const event of lists) {
      expect(event.masks.slice().sort()).toEqual(cleanupFields(event.phase, event.collection).sort());
      const url = new URL(event.url);
      expect(url.searchParams.has('fields')).toBe(false);
      expect([...url.searchParams.keys()].every(key => ['pageSize', 'pageToken', 'mask.fieldPaths'].includes(key))).toBe(true);
    }
    expect(f.foreignAfter()).toEqual(f.foreignBefore);
    expect(f.events.at(-1).kind).toBe('parent');
  });
  it('retains the consistent player mask in the exported stale-only route without adding a legacy pass', async () => {
    const f = fixture();
    await expect(f.staleOnly()).resolves.toBe(9);
    const lists = f.events.filter(event => event.kind === 'list');
    expect(new Set(lists.map(event => event.collection))).toEqual(new Set(collections));
    for (const event of lists) expect(event.masks.slice().sort()).toEqual(cleanupFields('projection', event.collection).sort());
    expect(lists.every(event => event.phase === 'projection')).toBe(true);
    expect(f.documents.has(documentName('players', 'legacy-linked'))).toBe(true);
    expect(f.foreignAfter()).toEqual(f.foreignBefore);
  });
  it('reduces actual mask-aware synthetic list JSON while keeping 1000-player writes and full stored records identical', async () => {
    const full = fixture({ responseMode: 'full', players: 1000, pageLength: 500, legacyRows: false });
    const requested = fixture({ players: 1000, pageLength: 500, legacyRows: false });
    expect(await requested.publish()).toEqual(await full.publish());
    expect(requested.storeSha()).toBe(full.storeSha());
    expect(requested.foreignAfter()).toEqual(requested.foreignBefore);
    expect(requested.listMetrics.requests).toBe(full.listMetrics.requests);
    expect(requested.listMetrics.documents).toBe(full.listMetrics.documents);
    expect(requested.listMetrics.responseJsonBytes).toBeLessThan(full.listMetrics.responseJsonBytes);
  });
});
