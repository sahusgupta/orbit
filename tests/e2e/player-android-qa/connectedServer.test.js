import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  assertConnectedEnvironment, assertConnectedFixtureMode, assertConnectedSocket, assertConnectedTarget, assertConnectedUrl,
  connectedBootstrapPhases, connectedFixtureAccounts, connectedFixtureVenue, createConnectedBootstrapObserver, createConnectedEnvironment, createConnectedListenerObserver, createConnectedProfile,
  createConnectedVenueState, createConnectedSeatAttemptCounter, createConnectedSeatIdentity, createConnectedSeatVenueState, createConnectedSeatReplayBody,
  denyConnectedSeatOwnership, fixedConnectedTarget, inspectConnectedSeatState, inspectConnectedState, installConnectedNetworkGuard,
  pauseConnectedApi, projectConnectedSeatInterests, replayConnectedSeatRequest, signInConnectedPeer, startConnectedServer,
  stripConnectedPlatformEnvironment, summarizeConnectedState, transitionConnectedSeatVenueState, transitionConnectedVenueState, updateConnectedSeatVenue
} from './connectedServer.mjs';

describe('native connected QA isolation and fixture contracts', () => {
  it('accepts only the dedicated demo project, host and complete fixed port tuple', () => {
    expect(() => assertConnectedTarget(fixedConnectedTarget)).not.toThrow();
    for (const change of [{ projectId: 'tabletalk-s' }, { projectId: 'demo-orbit-release-ci' }, { firestore: { host: '127.0.0.1', port: 8085 } }, { auth: { host: 'localhost', port: 19099 } }, { api: { host: 'orbitapp-one.vercel.app', port: 443 } }, { api: { host: '127.0.0.1', port: 14640 } }, { extra: true }]) {
      expect(() => assertConnectedTarget({ ...fixedConnectedTarget, ...change })).toThrow('exact demo project');
    }
    expect(() => assertConnectedTarget(undefined)).toThrow();
  });
  it('constructs a clean child environment without reading or forwarding unrelated host values', () => {
    const host = { Path: 'approved-node-path', SystemRoot: 'os-root' };
    Object.defineProperty(host, 'FIREBASE_SERVICE_ACCOUNT_JSON', { enumerable: true, get() { throw new Error('Must never read host credential.'); } });
    Object.defineProperty(host, 'GOOGLE_APPLICATION_CREDENTIALS', { enumerable: true, get() { throw new Error('Must never read ADC path.'); } });
    const environment = createConnectedEnvironment(host);
    expect(environment.Path).toBe('approved-node-path');
    expect(environment.FIREBASE_AUTH_EMULATOR_HOST).toBe('127.0.0.1:19099');
    expect(environment.FIRESTORE_EMULATOR_HOST).toBe('127.0.0.1:18085');
    expect(environment.NODE_ENV).toBe('development');
    expect(environment.ORBIT_FIRESTORE_MEMORY).toBe('false');
    expect(environment.ORBIT_REQUIRE_PLAYER_APP_CHECK).toBe('false');
    expect(environment).not.toHaveProperty('GOOGLE_APPLICATION_CREDENTIALS');
    expect(environment).not.toHaveProperty('FIREBASE_SERVICE_ACCOUNT_JSON');
    expect(() => assertConnectedEnvironment(environment)).not.toThrow();
  });
  it('rejects altered emulator configuration and inherited provider/auth settings before startup', async () => {
    for (const change of [{ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085' }, { FIREBASE_AUTH_EMULATOR_HOST: 'auth.example.invalid:19099' }, { GOOGLE_CLOUD_PROJECT: 'tabletalk-s' }, { NODE_ENV: 'test' }, { ORBIT_FIRESTORE_MEMORY: 'true' }, { ORBIT_REQUIRE_PLAYER_APP_CHECK: 'true' }, { VERCEL: '1' }, { FIREBASE_SERVICE_ACCOUNT_JSON: 'fixture-must-not-pass' }, { ORBIT_LOG_HASH_SECRET: '' }, { STRIPE_SECRET_KEY: 'fixture-must-not-pass' }]) {
      await expect(startConnectedServer({ environment: { ...createConnectedEnvironment(), ...change } })).rejects.toThrow('Connected QA');
    }
    await expect(startConnectedServer({ environment: createConnectedEnvironment() })).rejects.toThrow('own clean child process');
  });
  it('strips Windows automatically injected account metadata without reading values before SDK initialization', () => {
    const environment = createConnectedEnvironment();
    for (const key of ['HOMEDRIVE', 'HOMEPATH', 'LOGONSERVER', 'USERDOMAIN', 'USERNAME']) Object.defineProperty(environment, key, { configurable: true, enumerable: true, get() { throw new Error('Do not read Windows account metadata.'); } });
    expect(() => stripConnectedPlatformEnvironment(environment, 'win32')).not.toThrow();
    expect(() => assertConnectedEnvironment(environment)).not.toThrow();
    expect(environment.USERPROFILE).toContain('player-android-connected-qa');
  });
  it('permits exact plain loopback HTTP destinations and blocks credentials, aliases, TLS and other ports', () => {
    for (const port of [18085, 19099, 14639]) expect(assertConnectedUrl(`http://127.0.0.1:${port}/fixture`).port).toBe(String(port));
    for (const url of ['https://127.0.0.1:18085/', 'http://localhost:18085/', 'http://127.0.0.1:8085/', 'https://firestore.googleapis.com/', 'http://fixture@127.0.0.1:18085/', 'http://127.0.0.1:18085.example.invalid/', 'http://[::1]:18085/']) {
      expect(() => assertConnectedUrl(url)).toThrow();
    }
  });
  it('guards both Node socket overloads including normalized argument arrays and rejects sockets/pipes without explicit owned host', () => {
    for (const args of [[{ host: '127.0.0.1', port: 18085 }], [19099, '127.0.0.1'], [[{ host: '127.0.0.1', port: '14639' }, () => {}]]]) expect(() => assertConnectedSocket(args)).not.toThrow();
    for (const args of [[{ host: 'firestore.googleapis.com', port: 443 }], [{ host: '127.0.0.1', port: 8085 }], [{ port: 18085 }], [18085], ['credential-pipe'], [{ path: 'local-pipe', host: '127.0.0.1', port: 18085 }]]) expect(() => assertConnectedSocket(args)).toThrow('socket destination');
  });
  it('blocks egress before any original transport and forbids following redirects while restoring every patched port', async () => {
    const originalFetch = vi.fn(async () => ({ ok: true }));
    const connect = vi.fn(); const lookup = vi.fn(); const dnsResolve = vi.fn();
    const ports = { socketPrototype: { connect }, tls: { connect: vi.fn() }, http2: { connect: vi.fn() }, dns: { lookup, resolve: dnsResolve, reverse: vi.fn() }, dnsPromises: { lookup: vi.fn(), resolve: vi.fn() }, datagramPrototype: { send: vi.fn() }, fetchOwner: { fetch: originalFetch } };
    const oldTls = ports.tls.connect, oldHttp2 = ports.http2.connect, oldDnsPromise = ports.dnsPromises.lookup, oldUdp = ports.datagramPrototype.send;
    const restore = installConnectedNetworkGuard(fixedConnectedTarget, ports);
    try {
      await expect(ports.fetchOwner.fetch('https://example.invalid/')).rejects.toThrow('network destination');
      expect(originalFetch).not.toHaveBeenCalled();
      await ports.fetchOwner.fetch('http://127.0.0.1:14639/player/match', { redirect: 'follow' });
      expect(originalFetch).toHaveBeenCalledWith('http://127.0.0.1:14639/player/match', { redirect: 'error' });
      expect(() => ports.socketPrototype.connect({ host: 'example.invalid', port: 443 })).toThrow();
      expect(connect).not.toHaveBeenCalled();
      ports.socketPrototype.connect({ host: '127.0.0.1', port: 18085 }); expect(connect).toHaveBeenCalledOnce();
      expect(() => ports.tls.connect({ host: '127.0.0.1', port: 18085 })).toThrow('TLS'); expect(oldTls).not.toHaveBeenCalled();
      expect(() => ports.http2.connect('https://example.invalid/')).toThrow(); expect(oldHttp2).not.toHaveBeenCalled();
      expect(() => ports.dns.lookup('example.invalid')).toThrow('DNS'); expect(lookup).not.toHaveBeenCalled();
      expect(() => ports.dns.resolve('example.invalid')).toThrow('DNS'); expect(dnsResolve).not.toHaveBeenCalled();
      await expect(ports.dnsPromises.lookup('example.invalid')).rejects.toThrow('DNS'); expect(oldDnsPromise).not.toHaveBeenCalled();
      expect(() => ports.datagramPrototype.send('test', 53, 'example.invalid')).toThrow('UDP'); expect(oldUdp).not.toHaveBeenCalled();
    } finally { restore(); }
    expect(ports.fetchOwner.fetch).toBe(originalFetch); expect(ports.socketPrototype.connect).toBe(connect); expect(ports.tls.connect).toBe(oldTls); expect(ports.http2.connect).toBe(oldHttp2); expect(ports.dns.lookup).toBe(lookup); expect(ports.dns.resolve).toBe(dnsResolve); expect(ports.dnsPromises.lookup).toBe(oldDnsPromise); expect(ports.datagramPrototype.send).toBe(oldUdp);
  });
  it('seeds public synthetic identities with valid profile declarations without assigning identity/provider/age outcomes', () => {
    const timestamp = { toDate: () => new Date(0) };
    const profile = createConnectedProfile(connectedFixtureAccounts.a, timestamp, Date.parse('2026-10-12T12:00:00Z'));
    expect(profile).toEqual({ id: 'native-owner-a', uid: 'native-owner-a', name: 'Native QA Owner A', email: 'native-a@example.invalid', preferredGameIds: [], favoriteClubIds: [], adultDeclaredAt: '2026-10-12T12:00:00.000Z', adultDeclarationVersion: 'v1', updatedAt: timestamp });
    expect(profile).not.toHaveProperty('ageEligible'); expect(profile).not.toHaveProperty('identity'); expect(profile).not.toHaveProperty('password');
    expect(() => createConnectedProfile({ ...connectedFixtureAccounts.a }, timestamp)).toThrow('owned profile');
    const venue = createConnectedVenueState(Date.parse('2026-10-12T12:00:00Z'));
    expect(venue.settings.pilotAccess.licenseId).toBe(connectedFixtureVenue.clubId);
    expect(venue.settings.pilotAccess.authorizationCode).toMatch(/^TT-PILOT-[A-F0-9]{24}$/);
    expect(venue.games).toHaveLength(2); expect(venue.sessions.every(table => table.status === 'Running')).toBe(true);
    expect(venue.profiles).toEqual([]); expect(venue.playerSessions).toEqual([]);
  });
  it('rejects foreign/inherited account names before inspector reads or SDK startup', async () => {
    const database = { getDocument: vi.fn(), queryCollection: vi.fn() };
    const runtime = { target: fixedConnectedTarget, database, adminApp: {} };
    for (const owner of ['foreign', '__proto__', 'constructor', '../native-owner-a']) {
      await expect(inspectConnectedState(runtime, { owner })).rejects.toThrow('owned account');
      await expect(signInConnectedPeer(owner)).rejects.toThrow('owned account');
    }
    expect(database.getDocument).not.toHaveBeenCalled();
    await expect(signInConnectedPeer('a')).rejects.toThrow('guarded server child');
  });
  it('pauses only the listener and retains the real datastore and owner state for retry', async () => {
    const database = { retained: true };
    const server = { listening: true, close: vi.fn(callback => callback()), closeAllConnections: vi.fn() };
    const runtime = { target: fixedConnectedTarget, adminApp: {}, database, server };
    await expect(pauseConnectedApi(runtime)).resolves.toEqual({ apiListening: false });
    expect(server.close).toHaveBeenCalledOnce(); expect(server.closeAllConnections).toHaveBeenCalledOnce();
    expect(runtime.database).toBe(database); expect(runtime.server).toBeUndefined();
    await expect(pauseConnectedApi(runtime)).resolves.toEqual({ apiListening: false });
    expect(server.close).toHaveBeenCalledOnce();
  });
  it('reports bounded state counters without contacts, labels, credentials or payloads', () => {
    expect(summarizeConnectedState(null)).toEqual({ exists: false });
    const summary = summarizeConnectedState({ revision: 3, preferencesRevision: 1, decisions: [{ decision: 'saved', summary: { gameName: 'Do not include' } }, { decision: 'passed' }], events: [{}], recentMutationIds: ['Do not include'] });
    expect(summary).toEqual({ exists: true, revision: 3, preferencesRevision: 1, savedCount: 1, passedCount: 1, eventCount: 1, recentMutationCount: 1 });
    expect(JSON.stringify(summary)).not.toContain('Do not include');
  });
  it('counts only server-confirmed SDK snapshots and retires callbacks after listener disposal', () => {
    let onState, onError; const dispose = vi.fn();
    const peer = { uid: connectedFixtureAccounts.a.uid, listenMatch: (state, error) => { onState = state; onError = error; return dispose; } };
    const require = createRequire(new URL('../../../apps/api/package.json', import.meta.url));
    const state = require('./src/shared/orbitMatchState.cjs').createMatchState();
    const observer = createConnectedListenerObserver(peer, 'a');
    const snapshot = metadata => ({ metadata, exists: () => true, data: () => state });
    onState(snapshot({ fromCache: true, hasPendingWrites: false })); onState(snapshot({ fromCache: false, hasPendingWrites: true }));
    expect(observer.status().accepted).toBe(0);
    onState(snapshot({ fromCache: false, hasPendingWrites: false }));
    expect(observer.status()).toMatchObject({ owner: 'a', active: true, accepted: 1, errors: 0, latest: { revision: 0, savedCount: 0 } });
    onError(); expect(observer.status().errors).toBe(1);
    observer.stop(); observer.stop(); expect(dispose).toHaveBeenCalledOnce();
    onState(snapshot({ fromCache: false, hasPendingWrites: false })); onError();
    expect(observer.status()).toMatchObject({ active: false, accepted: 1, errors: 1 });
    expect(() => createConnectedListenerObserver(peer, 'b')).toThrow('owned SDK peer');
  });
  it('changes only the owned NLH availability/end stages while retaining PLO and private fixture data', () => {
    const initial = createConnectedVenueState(1000);
    initial.privateFixture = { marker: 'Keep fictional private item' };
    const original = JSON.stringify(initial);
    const next = transitionConnectedVenueState({ accountKey: connectedFixtureVenue.clubId, revision: 1, state: initial }, { kind: 'availability', expectedRevision: 1 }, 2000);
    expect(JSON.stringify(initial)).toBe(original);
    expect(next.sessions[0]).toMatchObject({ status: 'Running', seatsFilled: 8 });
    expect(next.sessions[1]).toBe(initial.sessions[1]); expect(next.privateFixture).toBe(initial.privateFixture);
    expect(next.interests).toHaveLength(7); expect(next.interests[0]).toBe(initial.interests[0]);
    const ended = transitionConnectedVenueState({ accountKey: connectedFixtureVenue.clubId, revision: 2, state: next }, { kind: 'ended', expectedRevision: 2 }, 3000);
    expect(ended.sessions[0]).toMatchObject({ status: 'Ended', seatsFilled: 8, endedAt: '1970-01-01T00:00:03.000Z' });
    expect(ended.sessions[1]).toBe(initial.sessions[1]); expect(ended.interests).toBe(next.interests); expect(ended.privateFixture).toBe(initial.privateFixture);
    expect(next.sessions[0].status).toBe('Running');
    for (const [record, update] of [[{ accountKey: 'foreign', revision: 1, state: initial }, { kind: 'availability', expectedRevision: 1 }], [{ accountKey: connectedFixtureVenue.clubId, revision: 2, state: initial }, { kind: 'availability', expectedRevision: 1 }], [{ accountKey: connectedFixtureVenue.clubId, revision: 1, state: initial }, { kind: 'ended', expectedRevision: 1 }], [{ accountKey: connectedFixtureVenue.clubId, revision: 1, state: initial }, { kind: 'availability', expectedRevision: 1, state: {} }]]) expect(() => transitionConnectedVenueState(record, update)).toThrow('exact owned fixture');
  });
  it('uses the real app and real client SDK and does not add an identity injection or publication timer', () => {
    const source = readFileSync(new URL('./connectedServer.mjs', import.meta.url), 'utf8');
    expect(source).toContain("apiRequire('./src/app.js')");
    expect(source).toContain('authSdk.signInWithEmailAndPassword(auth, account.email, account.password)');
    expect(source).toContain('accepted.user.getIdToken()');
    expect(source).toContain('firestoreSdk.onSnapshot');
    expect(source).not.toContain("apiRequire('./src/server.js')");
    expect(source).not.toContain('x-local-test-uid'); expect(source).not.toContain('request.orbitPlayer =');
    expect(source).not.toContain('publishStateToFirebase');
  });

  it('keeps the existing fixture unchanged and requires explicit seat-request mode before local eligibility or controls', async () => {
    expect(assertConnectedFixtureMode('match')).toBe('match'); expect(assertConnectedFixtureMode('seat-request')).toBe('seat-request');
    for (const mode of [undefined, 'production', 'seat-request --other', {}, true]) {
      expect(() => assertConnectedFixtureMode(mode)).toThrow('explicit supported fixture');
      await expect(startConnectedServer({ fixtureMode: mode, environment: createConnectedEnvironment() })).rejects.toThrow('Connected QA');
    }
    const database = { getDocument: vi.fn(), queryCollection: vi.fn() };
    const runtime = { target: fixedConnectedTarget, database, adminApp: {}, fixtureMode: 'match', seeded: true };
    await expect(inspectConnectedSeatState(runtime)).rejects.toThrow('seat-request fixture');
    await expect(updateConnectedSeatVenue(runtime, { kind: 'end-game', expectedRevision: 1 })).rejects.toThrow('seat-request fixture');
    await expect(replayConnectedSeatRequest(runtime, {}, 'a')).rejects.toThrow('seat-request fixture');
    await expect(denyConnectedSeatOwnership(runtime, {}, 'b')).rejects.toThrow('seat-request fixture');
    expect(database.getDocument).not.toHaveBeenCalled(); expect(database.queryCollection).not.toHaveBeenCalled();
    expect(createConnectedVenueState().profiles).toEqual([]);
  });

  it('counts only the actual local waitlist POST attempts without reading bodies, tokens or identity headers', () => {
    const counter = createConnectedSeatAttemptCounter();
    const request = { method: 'POST', url: '/player/waitlist-requests' };
    for (const key of ['headers', 'body', 'socket', 'orbitPlayer']) Object.defineProperty(request, key, { get() { throw new Error('Do not inspect request identity or payload.'); } });
    expect(counter.count()).toBe(0); expect(counter.observe(request)).toBe(true); expect(counter.count()).toBe(1);
    expect(counter.observe({ method: 'POST', url: '/player/waitlist-requests?local=fixture' })).toBe(true);
    for (const value of [{ method: 'GET', url: '/player/waitlist-requests' }, { method: 'POST', url: '/player/match/operations' }, { method: 'POST', url: '/player/waitlist-requests-extra' }, { method: 'POST', url: 'http://127.0.0.1:18085/player/waitlist-requests' }]) expect(counter.observe(value)).toBe(false);
    for (const url of ['https://orbitapp-one.vercel.app/player/waitlist-requests', 'http://localhost:14639/player/waitlist-requests', 'http://127.0.0.1:14640/player/waitlist-requests', 'http://fixture@127.0.0.1:14639/player/waitlist-requests']) expect(() => counter.observe({ method: 'POST', url })).toThrow('network destination');
    expect(counter.count()).toBe(2);
    expect(() => createConnectedSeatAttemptCounter({ ...fixedConnectedTarget, projectId: 'tabletalk-s' })).toThrow('exact demo project');
  });

  it('emits only bounded allowlisted bootstrap phase timings and rejects raw detail or invalid clocks', () => {
    let clock = 1_000;
    const records = [];
    const observer = createConnectedBootstrapObserver({ now: () => clock, onPhase: record => records.push(record) });
    expect(Object.isFrozen(connectedBootstrapPhases)).toBe(true); expect(connectedBootstrapPhases).toHaveLength(19);
    observer.mark('start'); clock = 1_012; observer.mark('admin-ready');
    expect(records).toEqual([{ type: 'bootstrap', phase: 'start', elapsedMs: 0 }, { type: 'bootstrap', phase: 'admin-ready', elapsedMs: 12 }]);
    expect(() => observer.mark('start')).toThrow('unreviewed or repeated phase');
    expect(() => observer.mark('raw response or account data')).toThrow('unreviewed or repeated phase');
    clock = 999; expect(() => observer.mark('api-listening')).toThrow('clock moved backwards');
    clock = 1_020;
    for (const phase of connectedBootstrapPhases.filter(value => !['start', 'admin-ready'].includes(value))) observer.mark(phase);
    expect(records).toHaveLength(19);
    expect(records.every(record => Object.keys(record).join(',') === 'type,phase,elapsedMs' && Number.isSafeInteger(record.elapsedMs))).toBe(true);
    expect(() => createConnectedBootstrapObserver({ now: () => NaN })).toThrow('integer clock');
  });

  it('uses server-owned fictional provisional eligibility and an exact active membership without claiming provider verification', () => {
    const require = createRequire(new URL('../../../apps/api/package.json', import.meta.url));
    const { getPublicIdentityStatus } = require('./src/identityService.js');
    const { buildPlayerClubSnapshot, validateStatePayload } = require('./src/orbitCore.js');
    const nowMs = Date.parse('2026-10-13T08:00:00Z');
    for (const owner of ['a', 'b']) {
      const identity = createConnectedSeatIdentity(owner, nowMs);
      expect(getPublicIdentityStatus(identity, new Date(nowMs))).toMatchObject({ status: 'provisional', ageEligible: true, ageVerified: false, ageLevel: 21, reviewStatus: 'pending-in-person' });
      expect(identity).not.toHaveProperty('providerSessionId'); expect(identity).not.toHaveProperty('password');
    }
    expect(() => createConnectedSeatIdentity('foreign', nowMs)).toThrow('owned account');
    const state = createConnectedSeatVenueState(nowMs);
    expect(() => validateStatePayload(state)).not.toThrow();
    expect(state.profiles).toEqual([{ id: 'native-qa-profile-a', orbitPlayerId: connectedFixtureAccounts.a.uid,
      name: connectedFixtureAccounts.a.name, membershipStatus: 'Active', membershipExpirationDate: '2099-01-01', preferredGameIds: [] }]);
    const a = buildPlayerClubSnapshot(state, { id: connectedFixtureAccounts.a.uid });
    const b = buildPlayerClubSnapshot(state, { id: connectedFixtureAccounts.b.uid });
    expect(a.memberships).toHaveLength(1); expect(a.memberships[0]).toMatchObject({ playerId: connectedFixtureAccounts.a.uid, status: 'Active', expiresAt: '2099-01-01' });
    expect(b.memberships).toEqual([]); expect(state.playerSessions).toEqual([]);
  });

  it('projects only accepted owned seat fields and rebuilds replay from the canonical PLO arrival without caller bodies', () => {
    const nowMs = Date.parse('2026-10-13T08:00:00Z');
    const state = createConnectedSeatVenueState(nowMs);
    state.interests.push({ id: 'wait_550e8400-e29b-41d4-a716-446655440000', profileId: 'native-qa-profile-a',
      gameId: connectedFixtureVenue.secondGameId, tableId: 'native-qa-table-1', status: 'Arrived', timestamp: new Date(nowMs).toISOString(),
      playerName: 'Do not expose', identitySummary: { dateOfBirth: 'Do not expose' } });
    const record = { accountKey: connectedFixtureVenue.clubId, revision: 2, state };
    const projected = projectConnectedSeatInterests(record, 'a');
    expect(projected).toEqual([{ id: state.interests[1].id, gameId: connectedFixtureVenue.secondGameId, tableId: 'native-qa-table-1', status: 'Arrived', attendance: 'arrived', requestedAt: new Date(nowMs).toISOString() }]);
    expect(projectConnectedSeatInterests(record, 'b')).toEqual([]); expect(JSON.stringify(projected)).not.toContain('Do not expose');
    const body = createConnectedSeatReplayBody(record, 'a');
    const require = createRequire(new URL('../../../apps/api/package.json', import.meta.url));
    const { buildAuthenticatedPlayerRequest } = require('./src/playerRequestSecurity.js');
    expect(buildAuthenticatedPlayerRequest(body, { uid: connectedFixtureAccounts.a.uid, email: connectedFixtureAccounts.a.email, email_verified: true, name: connectedFixtureAccounts.a.name })).toMatchObject({ ok: true, value: { id: state.interests[1].id, attendance: 'arrived', gameId: connectedFixtureVenue.secondGameId, tableId: 'native-qa-table-1' } });
    expect(body).not.toHaveProperty('matchAttribution'); expect(body).not.toHaveProperty('identitySummary');
    expect(() => createConnectedSeatReplayBody(record, 'b')).toThrow('original owner');
    expect(() => projectConnectedSeatInterests({ ...record, accountKey: 'foreign' }, 'a')).toThrow('exact owned venue');
    expect(() => projectConnectedSeatInterests(record, '__proto__')).toThrow('owned account');
    state.interests[1].tableId = 'foreign-table'; expect(() => projectConnectedSeatInterests(record, 'a')).toThrow('unexpected fixture request');
  });

  it('expires only the exact A membership or ends only NLH at the expected revision while retaining accepted PLO', () => {
    const nowMs = Date.parse('2026-10-13T08:00:00Z');
    const state = createConnectedSeatVenueState(nowMs);
    state.interests.push({ id: 'wait_550e8400-e29b-41d4-a716-446655440000', profileId: 'native-qa-profile-a', gameId: connectedFixtureVenue.secondGameId, tableId: 'native-qa-table-1', status: 'Arrived', timestamp: new Date(nowMs).toISOString() });
    const record = { accountKey: connectedFixtureVenue.clubId, revision: 2, state };
    const original = JSON.stringify(state);
    const expired = transitionConnectedSeatVenueState(record, { kind: 'expire-membership', expectedRevision: 2 }, nowMs);
    expect(expired.profiles[0]).toMatchObject({ membershipStatus: 'Expired', membershipExpirationDate: '2026-10-12' });
    expect(expired.sessions).toBe(state.sessions); expect(expired.interests).toBe(state.interests); expect(JSON.stringify(state)).toBe(original);
    const ended = transitionConnectedSeatVenueState({ ...record, revision: 3, state: expired }, { kind: 'end-game', expectedRevision: 3 }, nowMs);
    expect(ended.sessions[0]).toMatchObject({ status: 'Ended', endedAt: '2026-10-13T08:00:00.000Z' });
    expect(ended.sessions[1]).toBe(state.sessions[1]); expect(ended.profiles).toBe(expired.profiles); expect(ended.interests).toBe(state.interests);
    expect(() => transitionConnectedSeatVenueState({ ...record, state: expired }, { kind: 'expire-membership', expectedRevision: 2 }, nowMs)).toThrow('already unavailable');
    for (const update of [{ kind: 'end-game', expectedRevision: 1 }, { kind: 'availability', expectedRevision: 2 }, { kind: 'end-game', expectedRevision: 2, body: {} }, { kind: 'end-game', expectedRevision: 21 }]) expect(() => transitionConnectedSeatVenueState(record, update, nowMs)).toThrow('exact fixture revision');
    expect(() => transitionConnectedSeatVenueState({ ...record, state: { ...state, profiles: [{ ...state.profiles[0], orbitPlayerId: connectedFixtureAccounts.b.uid }] } }, { kind: 'end-game', expectedRevision: 2 }, nowMs)).toThrow('owned fixture');
  });
});
