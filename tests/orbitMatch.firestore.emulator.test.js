import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, onSnapshot } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url));
const projectId = 'demo-orbit-release-ci';
const localHost = '127.0.0.1:8085';
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || process.env.ORBIT_RULES_EMULATOR_HOST;

function assertLocalTarget(host, project) {
  if (host !== localHost || project !== projectId) {
    throw new Error('Match integration requires Firestore at 127.0.0.1:8085 and project demo-orbit-release-ci.');
  }
}

// The publisher has a REST transport rather than an injected datastore. Keep
// its real serializer/batches/cleanup/commit marker, but redirect only reviewed
// fixture paths to the emulator. OAuth is an explicit local response double.
// The emulator's privileged `owner` marker is not a production credential.
function createLocalPublisherTransport(transport, { clubId, apiOrigin }) {
  if (!/^[a-z0-9._-]{1,96}$/.test(clubId)
    || apiOrigin && !/^http:\/\/127\.0\.0\.1:\d+$/.test(apiOrigin)) {
    throw new Error('The local publisher transport requires an owned fixture and a loopback API origin.');
  }
  const restPrefix = `/v1/projects/${projectId}/databases/(default)/documents`;
  const resourcePrefix = `projects/${projectId}/databases/(default)/documents`;
  const ownedDocument = (resource) => typeof resource === 'string'
    && (resource === `${resourcePrefix}/clubs/${clubId}` || resource.startsWith(`${resourcePrefix}/clubs/${clubId}/`)
      || resource === `${resourcePrefix}/clubStates/${clubId}`);
  return async (input, init = {}) => {
    const url = new URL(String(input));
    if (apiOrigin && url.origin === apiOrigin) return transport(url, { ...init, redirect: 'error' });
    if (url.href === 'https://oauth2.googleapis.com/token' && init.method === 'POST') {
      return Response.json({ access_token: 'owner' });
    }
    if (url.origin !== 'https://firestore.googleapis.com' || !url.pathname.startsWith(restPrefix)) {
      throw new Error('The local publisher transport rejected an external or foreign-project request.');
    }
    if (url.pathname === `${restPrefix}:batchWrite`) {
      const payload = JSON.parse(String(init.body));
      if (!Array.isArray(payload.writes) || !payload.writes.length
        || payload.writes.some((write) => !ownedDocument(write.update?.name || write.delete))) {
        throw new Error('The local publisher transport rejected a foreign fixture document.');
      }
    } else if (!(url.pathname === `${restPrefix}/clubs/${clubId}` || url.pathname.startsWith(`${restPrefix}/clubs/${clubId}/`))) {
      throw new Error('The local publisher transport rejected a foreign fixture collection.');
    }
    url.protocol = 'http:';
    url.host = localHost;
    return transport(url, { ...init, signal: init.signal || AbortSignal.timeout(10_000), redirect: 'error' });
  };
}

describe('Match emulator target isolation', () => {
  it('accepts only the fixed local demo target', () => expect(() => assertLocalTarget(localHost, projectId)).not.toThrow());
  it.each(['firestore.googleapis.com:443', '127.0.0.1:8086', 'localhost.example.test:8085', undefined])(
    'rejects a foreign or absent emulator host (%s)', (host) => expect(() => assertLocalTarget(host, projectId)).toThrow('Match integration requires')
  );
  it.each(['orbit-production', 'demo-other-project', undefined])(
    'rejects a foreign or absent project (%s)', (project) => expect(() => assertLocalTarget(localHost, project)).toThrow('Match integration requires')
  );

  it('redirects only the exact demo publisher fixture and never forwards OAuth', async () => {
    const transport = vi.fn(async () => Response.json({ status: [{}] }));
    const local = createLocalPublisherTransport(transport, { clubId: 'fixture-club' });
    expect(await (await local('https://oauth2.googleapis.com/token', { method: 'POST' })).json()).toEqual({ access_token: 'owner' });
    expect(transport).not.toHaveBeenCalled();
    await local(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:batchWrite`, {
      method: 'POST', body: JSON.stringify({ writes: [{ update: {
        name: `projects/${projectId}/databases/(default)/documents/clubs/fixture-club/games/fixture-game`, fields: {}
      } }] })
    });
    expect(String(transport.mock.calls[0][0])).toBe(`http://${localHost}/v1/projects/${projectId}/databases/(default)/documents:batchWrite`);
    expect(transport.mock.calls[0][1].redirect).toBe('error');
  });

  it.each([
    ['https://firestore.googleapis.com/v1/projects/production/databases/(default)/documents/clubs/fixture-club', undefined],
    [`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/clubs/another-club`, undefined],
    ['https://unreviewed.example.test/token', { method: 'POST' }],
    [`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:batchWrite`, {
      method: 'POST', body: JSON.stringify({ writes: [{ delete: `projects/${projectId}/databases/(default)/documents/players/other-owner` }] })
    }]
  ])('rejects unreviewed publisher targets before transport (%s)', async (url, init) => {
    const transport = vi.fn();
    await expect(createLocalPublisherTransport(transport, { clubId: 'fixture-club' })(url, init)).rejects.toThrow('local publisher transport rejected');
    expect(transport).not.toHaveBeenCalled();
  });

  it('rejects a configured external API escape or path-traversing fixture before creating the transport', () => {
    expect(() => createLocalPublisherTransport(vi.fn(), { clubId: 'fixture-club', apiOrigin: 'https://unreviewed.example.test' }))
      .toThrow('loopback API origin');
    expect(() => createLocalPublisherTransport(vi.fn(), { clubId: '../players/other' })).toThrow('owned fixture');
  });
});

const integrationSuite = emulatorHost ? describe : describe.skip;
const now = Date.parse('2026-10-12T12:00:00Z');
let adminApp;
let firestore;
let database;
let connection;
let match;
let deletion;
let server;
let baseUrl;
let uid;
let otherUid;
let rulesEnvironment;
let publisherFixtureAccount;
let publisher;
let venueState;
let playerRoutes;
const seededOwners = new Set();
const seededVenuePaths = new Set();

const decision = (suffix, gameId = 'game-one', value = 'saved') => ({
  mutationId: `emulator-match-${suffix}`, type: 'decide',
  ref: { clubId: 'published-club', gameId, kind: 'cash' },
  summary: { venueName: 'Published Club', gameName: '$1/$2 NLH' }, decision: value
});

// These are the real HTTP handlers and real Admin-backed adapter. The local
// header below is explicitly a verified-UID test stub, not Firebase Auth.
async function startHttpServer(store = database) {
  const express = apiRequire('express');
  const app = express();
  const handlers = match.createOrbitMatchHandlers({ database: store, nowMs: () => now });
  app.use(express.json());
  app.use((request, _response, next) => {
    request.orbitPlayer = { uid: request.get('x-local-test-uid'), email: 'emulator@example.test', email_verified: true };
    next();
  });
  app.get('/player/match', (request, response, next) => handlers.read(request, response).catch(next));
  app.post('/player/match/operations', (request, response, next) => handlers.operate(request, response).catch(next));
  app.get('/player/public/discovery', (request, response, next) => playerRoutes.handlePublicPlayerDiscovery(request, response).catch(next));
  app.use((error, _request, response, _next) => response.status(500).json({ ok: false, error: String(error.message) }));
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

async function httpRequest(path, operation, owner = uid) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: operation ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-local-test-uid': owner },
    ...(operation ? { body: JSON.stringify(operation) } : {}), signal: AbortSignal.timeout(15_000)
  });
  return { status: response.status, cacheControl: response.headers.get('cache-control'), body: await response.json() };
}

function withDeadline(promise, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after 10 seconds.`)), 10_000);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

integrationSuite('Match real Firestore transaction and local REST integration', () => {
  beforeAll(async () => {
    assertLocalTarget(emulatorHost, projectId);
    for (const configuredHost of [process.env.FIRESTORE_EMULATOR_HOST, process.env.ORBIT_RULES_EMULATOR_HOST].filter(Boolean)) {
      assertLocalTarget(configuredHost, projectId);
    }
    for (const configuredProject of [process.env.GCLOUD_PROJECT, process.env.GOOGLE_CLOUD_PROJECT].filter(Boolean)) {
      assertLocalTarget(emulatorHost, configuredProject);
    }
    // No secrets are read. Blank every credential source before loading the
    // provider; initialize a demo-only app with an ephemeral fixture certificate.
    for (const name of ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_SERVICE_ACCOUNT_JSON', 'FIREBASE_SERVICE_ACCOUNT_BASE64', 'VERCEL']) vi.stubEnv(name, '');
    vi.stubEnv('FIRESTORE_EMULATOR_HOST', localHost);
    vi.stubEnv('GOOGLE_CLOUD_PROJECT', projectId);
    vi.stubEnv('GCLOUD_PROJECT', projectId);
    vi.stubEnv('FIREBASE_CONFIG', JSON.stringify({ projectId }));
    vi.stubEnv('ORBIT_FIRESTORE_MEMORY', 'false');
    // NODE_ENV=test intentionally selects the memory adapter in ordinary unit
    // tests; only this guarded emulator worker opts into the real adapter.
    vi.stubEnv('NODE_ENV', 'development');
    const admin = apiRequire('firebase-admin');
    if (admin.apps.length) throw new Error('Match emulator integration requires a fresh, isolated Admin SDK instance.');
    // Admin Firestore requires a recognized certificate/ADC class even when
    // emulated. Generate this local fixture only in memory; never read ADC,
    // load a credential file, print a key, or persist key material.
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' }
    });
    adminApp = admin.initializeApp({ projectId, credential: admin.credential.cert({
      projectId, clientEmail: 'emulator@example.test', privateKey
    }) });
    publisherFixtureAccount = { project_id: projectId, client_email: 'emulator@example.test', private_key: privateKey };
    firestore = admin.firestore(adminApp);
    firestore.settings({ host: localHost, ssl: false });
    connection = apiRequire('./src/db/connection.js');
    match = apiRequire('./src/orbitMatchService.js');
    deletion = apiRequire('./src/playerDeletionGuard.js');
    publisher = apiRequire('./src/firebasePublisher.js');
    venueState = apiRequire('./src/db/state.js');
    playerRoutes = apiRequire('./src/routes/player.js');
    database = await connection.getDatabase();
    expect(database.mode).toBe('firestore');
    expect(firestore.projectId).toBe(projectId);
  }, 30_000);

  beforeEach(async () => {
    uid = `match-emulator-${randomUUID()}`;
    otherUid = `match-emulator-${randomUUID()}`;
    seededOwners.add(uid);
    seededOwners.add(otherUid);
    await startHttpServer();
  });

  afterEach(async () => {
    if (server) {
      const closing = new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      server.closeAllConnections();
      await closing;
      server = undefined;
    }
  });

  afterAll(async () => {
    await rulesEnvironment?.cleanup();
    if (firestore) {
      assertLocalTarget(process.env.FIRESTORE_EMULATOR_HOST, firestore.projectId);
      for (const owner of seededOwners) {
        await firestore.recursiveDelete(firestore.doc(`players/${owner}`));
        await database.deleteDocument(deletion.playerDeletionMarkerPath(owner));
        await database.deleteDocument(deletion.playerDeletionBlockPath(owner));
      }
      for (const path of seededVenuePaths) await firestore.recursiveDelete(firestore.doc(path));
      await firestore.terminate();
    }
    await connection?.closeDatabase();
    await adminApp?.delete();
    publisherFixtureAccount = undefined;
    vi.unstubAllEnvs();
  }, 30_000);

  it('projects a real authoritative venue revision, discovers it through licensing, and reconciles Player saves after update/end/revocation', async () => {
    const clubId = `pipeline-emulator-${randomUUID()}`;
    const gameId = 'pipeline-nlh';
    const authorizationCode = `TT-PILOT-${randomUUID().replaceAll('-', '').slice(0, 24).toUpperCase()}`;
    const licensePath = `pilotLicenses/${createHash('sha256').update(authorizationCode).digest('hex')}`;
    for (const path of [`clubs/${clubId}`, `clubStates/${clubId}`, venueState.accountPath(clubId), licensePath]) seededVenuePaths.add(path);
    await database.setDocument(licensePath, { accountKey: clubId, licenseId: clubId, status: 'active', expiresAt: '2099-01-01T00:00:00.000Z' });
    const state = {
      settings: {
        clubAccount: { clubName: 'Fictional Pipeline Card House', email: 'private-venue@example.test',
          address: 'Fictional venue, Austin, TX', coordinate: { latitude: 30.2672, longitude: -97.7431 }, minimumPlayerAge: 21 },
        pilotAccess: { authorized: true, licenseId: clubId, authorizationCode, expiresAt: '2099-01-01T00:00:00.000Z' },
        collectionProfiles: [{ gameId, collectionMode: 'Time' }], defaultCollectionMode: 'Time'
      },
      games: [{ id: gameId, name: '$1/$2 No Limit Holdem', maxSeats: 9 }],
      sessions: [{ id: 'fixture-table', gameId, label: 'Fictional Table', status: 'Running', seatsFilled: 6, maxSeats: 9,
        collectionMode: 'Time', startedAt: new Date(now - 60_000).toISOString(), tags: [] }],
      profiles: [{ id: 'private-profile', name: 'PRIVATE_PLAYER_SENTINEL', email: 'private-player@example.test',
        membershipExpirationDate: '2099-01-01' }],
      playerSessions: [], buyIns: [], drops: [], tournaments: [],
      interests: Array.from({ length: 2 }, (_, index) => ({ id: `queue-${index}`, gameId, profileId: 'private-profile',
        playerName: 'PRIVATE_QUEUE_SENTINEL', status: 'Interested', interestedAt: new Date(now + index).toISOString() }))
    };
    const { decodeDiscoveryResponse } = await import('../player-app/src/domain/decoders/playerBoundaryDecoders');
    const { buildMatchCandidates, rankMatchCandidates, resolveSavedMatchGames } = await import('../player-app/src/domain/orbitMatchCandidates');
    const { defaultMatchPreferences } = await import('../player-app/src/domain/orbitMatchTypes');
    const player = { id: uid, name: 'Local Pipeline Reviewer', email: 'reviewer@example.test', preferredGameIds: [], favoriteClubIds: [], searchRadiusMiles: 50 };
    const nativeFetch = globalThis.fetch;
    // The only credential introduced is the already-created in-memory demo
    // fixture. The wrapper never forwards the signed OAuth request externally.
    vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_JSON', JSON.stringify(publisherFixtureAccount));
    vi.stubGlobal('fetch', createLocalPublisherTransport(nativeFetch, { clubId, apiOrigin: baseUrl }));
    try {
      const publishRevision = async (nextState, expectedRevision) => {
        seededVenuePaths.add(venueState.publicationPath(clubId, expectedRevision + 1));
        const saved = await venueState.saveState(nextState, { expectedRevision, mutationId: `pipeline-state-${expectedRevision + 1}` });
        const authoritative = await venueState.loadState(clubId);
        expect(authoritative).toMatchObject({ accountKey: clubId, revision: saved.revision, state: nextState });
        expect(saved.publication.status).toBe('pending');
        const revision = `${clubId}:${saved.revision}`;
        const projected = await publisher.publishStateToFirebase(authoritative.state, { savedAt: saved.savedAt, syncRevision: revision });
        expect(projected).toMatchObject({ ok: true, accountKey: clubId, syncRevision: revision, games: 1 });
        const [parent, game] = await Promise.all([database.getDocument(`clubs/${clubId}`), database.getDocument(`clubs/${clubId}/games/${gameId}`)]);
        expect(parent).toMatchObject({ id: clubId, syncProtocolVersion: 2, syncRevision: revision,
          coordinate: state.settings.clubAccount.coordinate });
        expect(game).toMatchObject({ id: gameId, syncProtocolVersion: 2, syncRevision: parent.syncRevision });
        // Discovery reads the authoritative revision, not the projection docs.
        // This test does not run the outbox scheduler or claim hosted delivery.
        const response = await httpRequest('/player/public/discovery?limit=50');
        expect(response.status).toBe(200);
        expect(response.cacheControl).toContain('public');
        const wire = JSON.stringify(response.body);
        for (const privateValue of ['PRIVATE_PLAYER_SENTINEL', 'PRIVATE_QUEUE_SENTINEL', 'private-player@example.test',
          'private-venue@example.test', authorizationCode, 'stateJson', 'entityJson']) expect(wire).not.toContain(privateValue);
        const decoded = decodeDiscoveryResponse(response.body);
        expect(decoded).not.toBeNull();
        const club = decoded.clubs.find((item) => item.club.id === clubId);
        expect(club).toMatchObject({ club: { coordinate: state.settings.clubAccount.coordinate }, memberships: [], waitlists: [], notifications: [] });
        const catalog = buildMatchCandidates({ clubs: [club], player, activeGameKeys: new Set(), nowMs: now,
          origin: state.settings.clubAccount.coordinate, tournaments: decoded.tournaments });
        expect(catalog).toHaveLength(1);
        expect(catalog[0]).toMatchObject({ ref: { clubId, gameId, kind: 'cash' }, variant: 'nlh', bigBlind: 2, distanceMiles: 0 });
        return { catalog, game };
      };
      const first = await publishRevision(state, 0);
      expect(first.game).toMatchObject({ availableSeats: 3, waitlistCount: 2 });
      expect(first.catalog[0]).toMatchObject({ status: 'live', availableSeats: 3, waitlistCount: 2 });
      expect(rankMatchCandidates({ candidates: first.catalog, preferences: defaultMatchPreferences, decisions: [] })).toHaveLength(1);
      const saved = await httpRequest('/player/match/operations', { ...decision('pipeline-save-one'),
        ref: first.catalog[0].ref, summary: first.catalog[0].summary });
      expect(saved.status).toBe(200);
      const updatedState = { ...state, sessions: state.sessions.map((table) => ({ ...table, seatsFilled: 8 })),
        interests: Array.from({ length: 5 }, (_, index) => ({ ...state.interests[0], id: `queue-${index}`, interestedAt: new Date(now + index).toISOString() })) };
      const updated = await publishRevision(updatedState, 1);
      expect(updated.game).toMatchObject({ availableSeats: 1, waitlistCount: 5 });
      const currentSaved = resolveSavedMatchGames({ candidates: updated.catalog, decisions: saved.body.state.decisions, catalogComplete: true });
      expect(currentSaved).toMatchObject([{ unavailableReason: null, candidate: { availableSeats: 1, waitlistCount: 5 } }]);
      const ended = await publishRevision({ ...updatedState, sessions: updatedState.sessions.map((table) => ({ ...table, status: 'Ended', endedAt: new Date(now).toISOString() })) }, 2);
      expect(ended.game).toMatchObject({ openTables: [], availableSeats: 0 });
      expect(ended.catalog[0].status).toBe('inactive');
      expect(rankMatchCandidates({ candidates: ended.catalog, preferences: defaultMatchPreferences, decisions: [] })).toEqual([]);
      expect(resolveSavedMatchGames({ candidates: ended.catalog, decisions: saved.body.state.decisions, catalogComplete: true }))
        .toMatchObject([{ record: saved.body.state.decisions[0], unavailableReason: 'This game has no active published table or upcoming event.' }]);
      expect((await httpRequest('/player/match')).body.state.decisions).toEqual(saved.body.state.decisions);
      await database.updateDocument(licensePath, { status: 'revoked' });
      const revoked = await httpRequest('/player/public/discovery?limit=50');
      expect(revoked.status).toBe(200);
      expect(revoked.body.clubs.some((club) => club.club.id === clubId)).toBe(false);
      expect(await database.getDocument(licensePath)).toMatchObject({ status: 'revoked' });
      expect(resolveSavedMatchGames({ candidates: [], decisions: saved.body.state.decisions, catalogComplete: true }))
        .toMatchObject([{ record: saved.body.state.decisions[0], candidate: null, unavailableReason: 'This game is no longer in the published catalog.' }]);
      expect(await database.getDocument(match.matchStatePath(otherUid))).toBeNull();
    } finally {
      vi.unstubAllGlobals();
      vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_JSON', '');
    }
  }, 45_000);

  it('seeds once through GET, persists POST across a new adapter/session, and keeps owners and live availability separate', async () => {
    const profile = { id: uid, uid, favoriteClubIds: ['published-club'], preferredGameIds: ['nlh-1-2'], preferredStakes: '$1/$2' };
    await database.setDocument(`players/${uid}`, profile);
    const venuePath = `clubs/match-emulator-${randomUUID()}`;
    seededVenuePaths.add(venuePath);
    const liveGamePath = `${venuePath}/games/game-one`;
    const live = { id: 'game-one', availableSeats: 3, waitlistCount: 7 };
    await database.setDocument(liveGamePath, live);
    const initial = await httpRequest('/player/match');
    expect(initial).toMatchObject({ status: 200, body: { ok: true, state: { revision: 0, preferencesRevision: 0,
      preferences: { favoriteClubIds: ['published-club'], variants: ['nlh'], stakes: { minBigBlind: 2, maxBigBlind: 2 } }
    } } });
    const operation = { ...decision('persistent-one'), ref: { clubId: venuePath.slice(6), gameId: 'game-one', kind: 'cash' } };
    const saved = await httpRequest('/player/match/operations', operation);
    expect(saved).toMatchObject({ status: 200, body: { ok: true, state: { revision: 1, decisions: [{ mutationId: operation.mutationId }] } } });
    expect(saved.cacheControl).toContain('no-store');
    expect(saved.body.state).not.toHaveProperty('receipts');
    expect(saved.body.state.decisions[0]).not.toHaveProperty('availableSeats');
    await connection.closeDatabase();
    const newAdapter = await connection.getDatabase();
    const restored = await match.createOrbitMatchService({ database: newAdapter, nowMs: () => now + 1 }).read(uid);
    expect(newAdapter).not.toBe(database);
    expect(restored).toEqual(saved.body.state);
    expect(await database.getDocument(`players/${uid}`)).toEqual(profile);
    expect(await database.getDocument(liveGamePath)).toEqual(live);
    expect(await database.getDocument(match.matchStatePath(otherUid))).toBeNull();
    expect((await httpRequest('/player/match', undefined, otherUid)).body.state.decisions).toEqual([]);
  }, 30_000);

  it('deduplicates simultaneous HTTP retries and rejects an ID reused for different content', async () => {
    const operation = decision('same-id-one');
    const results = await Promise.all([httpRequest('/player/match/operations', operation), httpRequest('/player/match/operations', operation)]);
    results.forEach((result) => expect(result).toMatchObject({ status: 200, body: { state: { revision: 1 } } }));
    const current = await httpRequest('/player/match');
    expect(current.body.state.decisions).toHaveLength(1);
    expect(current.body.state.events.filter((event) => event.kind === 'saved')).toHaveLength(1);
    expect(await database.queryCollection(`${match.matchStatePath(uid)}/receipts`)).toHaveLength(1);
    const conflict = await httpRequest('/player/match/operations', { ...operation, decision: 'passed' });
    expect(conflict).toMatchObject({ status: 409, body: { ok: false, code: 'MATCH_MUTATION_ID_REUSED' } });
    expect((await httpRequest('/player/match')).body.state).toEqual(current.body.state);
  }, 30_000);

  it('retries an aborted real transaction while another device writes without losing either save', async () => {
    let attempts = 0;
    const retryingAdapter = { ...database, runTransaction: (operation) => database.runTransaction(async (transaction) => {
      attempts += 1;
      const result = await operation(transaction);
      if (attempts === 1) throw Object.assign(new Error('Local injected Firestore ABORTED retry'), { code: 10 });
      return result;
    }) };
    const first = match.createOrbitMatchService({ database: retryingAdapter, nowMs: () => now });
    const second = match.createOrbitMatchService({ database, nowMs: () => now + 1 });
    await Promise.all([first.operate(uid, decision('retry-device-one')), second.operate(uid, decision('retry-device-two', 'game-two'))]);
    expect(attempts).toBeGreaterThanOrEqual(2);
    const current = await match.createOrbitMatchService({ database, nowMs: () => now + 2 }).read(uid);
    expect(current.revision).toBe(2);
    expect(current.decisions.map((item) => item.ref.gameId).sort()).toEqual(['game-one', 'game-two']);
    expect(current.events).toHaveLength(2);
    expect(await database.queryCollection(`${match.matchStatePath(uid)}/receipts`)).toHaveLength(2);
  }, 30_000);

  it('keeps stale preference, undo, and remove requests from overwriting a newer device', async () => {
    const first = await httpRequest('/player/match/operations', decision('old-device-one'));
    const newer = await httpRequest('/player/match/operations', decision('new-device-one', 'game-one', 'passed'));
    const undo = await httpRequest('/player/match/operations', { mutationId: 'emulator-stale-undo-one', type: 'undo', targetMutationId: first.body.state.undo.mutationId });
    expect(undo).toMatchObject({ status: 409, body: { code: 'MATCH_UNDO_CONFLICT' } });
    const remove = await httpRequest('/player/match/operations', { mutationId: 'emulator-stale-remove-one', type: 'remove', ref: decision('unused').ref,
      expectedDecisionMutationId: first.body.state.decisions[0].mutationId });
    expect(remove).toMatchObject({ status: 409, body: { code: 'MATCH_DECISION_CONFLICT' } });
    const preferences = { ...newer.body.state.preferences, requireSeatsNow: true };
    const updated = await httpRequest('/player/match/operations', { mutationId: 'emulator-preferences-one', type: 'preferences', basePreferencesRevision: 0, preferences });
    expect(updated).toMatchObject({ status: 200, body: { state: { revision: 3, preferencesRevision: 1 } } });
    const stale = await httpRequest('/player/match/operations', { mutationId: 'emulator-preferences-two', type: 'preferences', basePreferencesRevision: 0,
      preferences: { ...preferences, requireSeatsNow: false } });
    expect(stale).toMatchObject({ status: 409, body: { code: 'MATCH_PREFERENCES_CONFLICT' } });
    expect((await httpRequest('/player/match')).body.state).toEqual(updated.body.state);
    expect(await database.queryCollection(`${match.matchStatePath(uid)}/receipts`)).toHaveLength(3);
  }, 30_000);

  it('observes a deletion marker introduced between real transaction attempts and rolls back all private writes', async () => {
    let attempts = 0;
    const racingAdapter = { ...database, runTransaction: (operation) => database.runTransaction(async (transaction) => {
      attempts += 1;
      if (attempts === 2) await deletion.markPlayerDeletion(database, uid, { nowMs: () => now + 1 });
      const result = await operation(transaction);
      if (attempts === 1) throw Object.assign(new Error('Local injected Firestore ABORTED before deletion fence'), { code: 10 });
      return result;
    }) };
    await expect(match.createOrbitMatchService({ database: racingAdapter, nowMs: () => now }).operate(uid, decision('deleted-device-one')))
      .rejects.toMatchObject({ status: 410, code: 'PLAYER_ACCOUNT_DELETION_IN_PROGRESS' });
    expect(attempts).toBe(2);
    expect(await database.getDocument(deletion.playerDeletionMarkerPath(uid))).toMatchObject({ status: 'blocked' });
    expect(await database.getDocument(match.matchStatePath(uid))).toBeNull();
    expect(await database.getDocument(match.operationReceiptPath(uid, 'emulator-match-deleted-device-one'))).toBeNull();
    expect(await httpRequest('/player/match')).toMatchObject({ status: 410, body: { code: 'PLAYER_ACCOUNT_DELETION_IN_PROGRESS' } });
    expect(await httpRequest('/player/match/operations', decision('deleted-retry-one')))
      .toMatchObject({ status: 410, body: { code: 'PLAYER_ACCOUNT_DELETION_IN_PROGRESS' } });
  }, 30_000);

  it('delivers API revisions to the real owner listener and rejects another owner under the committed rules', async () => {
    // Rules contexts supply local test claims; they do not authenticate against
    // Firebase Auth and do not establish device sign-in behavior.
    rulesEnvironment = await initializeTestEnvironment({ projectId, firestore: {
      host: '127.0.0.1', port: 8085,
      rules: readFileSync(new URL('../player-app/firestore.rules', import.meta.url), 'utf8')
    } });
    await httpRequest('/player/match');
    const owner = rulesEnvironment.authenticatedContext(uid, { email: 'owner@example.test', email_verified: true }).firestore();
    const other = rulesEnvironment.authenticatedContext(otherUid, { email: 'other@example.test', email_verified: true }).firestore();
    const ownerReference = doc(owner, match.matchStatePath(uid));
    const revisions = [];
    let resolveInitial;
    let resolveSaved;
    let rejectInitial;
    let rejectSaved;
    const initial = new Promise((resolve, reject) => { resolveInitial = resolve; rejectInitial = reject; });
    const saved = new Promise((resolve, reject) => { resolveSaved = resolve; rejectSaved = reject; });
    // An initial-listener error may reject both promises before saved is awaited.
    saved.catch(() => undefined);
    const unsubscribeOwner = onSnapshot(ownerReference, { includeMetadataChanges: true }, (snapshot) => {
      if (snapshot.metadata.fromCache) return;
      const state = snapshot.data();
      if (revisions.at(-1) !== state?.revision) revisions.push(state?.revision);
      if (state?.revision === 0) resolveInitial(snapshot);
      if (state?.revision === 1) resolveSaved(state);
    }, (error) => { rejectInitial(error); rejectSaved(error); });
    let unsubscribeOther;
    try {
      expect((await withDeadline(initial, 'Owner initial snapshot')).metadata.fromCache).toBe(false);
      const response = await httpRequest('/player/match/operations', decision('listener-owner-one'));
      expect(await withDeadline(saved, 'Owner API revision snapshot')).toEqual(response.body.state);
      expect(revisions).toEqual([0, 1]);
      const denied = await withDeadline(new Promise((resolve, reject) => {
        unsubscribeOther = onSnapshot(doc(other, match.matchStatePath(uid)), () => reject(new Error('Another owner read Match state.')), resolve);
      }), 'Foreign owner listener rejection');
      expect(denied).toMatchObject({ code: 'permission-denied' });
    } finally {
      unsubscribeOwner();
      unsubscribeOther?.();
    }
  }, 30_000);
});
