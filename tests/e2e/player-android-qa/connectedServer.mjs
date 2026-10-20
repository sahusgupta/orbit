import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import http2 from 'node:http2';
import dns from 'node:dns';
import dgram from 'node:dgram';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const apiRequire = createRequire(new URL('../../../apps/api/package.json', import.meta.url));
const playerRequire = createRequire(new URL('../../../player-app/package.json', import.meta.url));
export const fixedConnectedTarget = Object.freeze({
  projectId: 'demo-orbit-native-match-qa',
  firestore: Object.freeze({ host: '127.0.0.1', port: 18085 }),
  auth: Object.freeze({ host: '127.0.0.1', port: 19099 }),
  api: Object.freeze({ host: '127.0.0.1', port: 14639 })
});
const originFor = (target, service) => `http://${target[service].host}:${target[service].port}`;
const hostFor = (target, service) => `${target[service].host}:${target[service].port}`;
// These public, synthetic fixtures are not credentials for a real service.
export const connectedFixtureAccounts = Object.freeze({
  a: Object.freeze({ uid: 'native-owner-a', email: 'native-a@example.invalid', password: 'OrbitNativeQA_passphrase_26', name: 'Native QA Owner A' }),
  b: Object.freeze({ uid: 'native-owner-b', email: 'native-b@example.invalid', password: 'OrbitNativeQA_passphrase_26', name: 'Native QA Owner B' })
});
export const connectedFixtureVenue = Object.freeze({ clubId: 'native-qa-card-house', gameId: 'native-qa-nlh', secondGameId: 'native-qa-plo', name: 'Native QA Card House' });
const connectedSeatProfileId = 'native-qa-profile-a';
export function assertConnectedFixtureMode(mode) {
  if (mode !== 'match' && mode !== 'seat-request') throw new Error('Connected QA requires an explicit supported fixture mode.');
  return mode;
}
export function createConnectedSeatAttemptCounter(target = fixedConnectedTarget) {
  assertConnectedTarget(target);
  let attempts = 0;
  return {
    observe(request) {
      if (request.method !== 'POST') return false;
      const url = assertConnectedUrl(new URL(request.url, originFor(target, 'api')), target);
      if (url.port !== String(target.api.port) || url.pathname !== '/player/waitlist-requests') return false;
      attempts += 1;
      return true;
    },
    count: () => attempts
  };
}
export const connectedBootstrapPhases = Object.freeze(['start', 'admin-ready', 'api-listening',
  'a-profile-checked', 'a-eligibility-checked', 'a-auth-created', 'a-profile-written', 'a-eligibility-written',
  'b-profile-checked', 'b-eligibility-checked', 'b-auth-created', 'b-profile-written', 'b-eligibility-written',
  'venue-checked', 'license-written', 'venue-written', 'ready', 'cleanup-start', 'cleanup-done']);
const bootstrapPhases = new Set(connectedBootstrapPhases);
export function createConnectedBootstrapObserver({ now = () => Math.floor(performance.now()), onPhase = () => undefined } = {}) {
  const startedAt = now();
  if (!Number.isSafeInteger(startedAt)) throw new Error('Connected QA bootstrap requires an integer clock.');
  const phases = new Set();
  return { mark(phase) {
    if (!bootstrapPhases.has(phase) || phases.has(phase)) throw new Error('Connected QA bootstrap refuses an unreviewed or repeated phase.');
    const elapsedMs = now() - startedAt;
    if (!Number.isSafeInteger(elapsedMs) || elapsedMs < 0) throw new Error('Connected QA bootstrap clock moved backwards.');
    phases.add(phase);
    onPhase({ type: 'bootstrap', phase, elapsedMs });
  } };
}
const fixtureAuthorizationCode = `TT-PILOT-${createHash('sha256').update('fictional-native-connected-qa-only').digest('hex').slice(0, 24).toUpperCase()}`;
const osEnvironmentKeys = ['Path', 'PATH', 'SystemRoot', 'SystemDrive', 'ComSpec', 'PATHEXT', 'OS', 'WINDIR', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS'];
const fixtureEnvironmentKeys = ['USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'CI', 'NODE_ENV', 'VERCEL', 'ORBIT_CONNECTED_QA_SERVER', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT', 'FIREBASE_CONFIG', 'ORBIT_FIRESTORE_MEMORY', 'ORBIT_REQUIRE_PLAYER_APP_CHECK', 'API_HOST', 'API_PORT', 'ORBIT_API_URL'];
const allowedEnvironmentKeys = new Set([...osEnvironmentKeys, ...fixtureEnvironmentKeys]);
const windowsInjectedProfileKeys = ['HOMEDRIVE', 'HOMEPATH', 'LOGONSERVER', 'USERDOMAIN', 'USERNAME'];
let startedOnce = false;
let runtimeNetworkGuardActive = false;
function fixtureAccountFor(owner) {
  if (owner !== 'a' && owner !== 'b') throw new Error('Connected QA requires an owned account fixture.');
  return connectedFixtureAccounts[owner];
}

export function assertConnectedTarget(target) {
  if (!target || Object.keys(target).length !== 4 || target.projectId !== fixedConnectedTarget.projectId
    || ['firestore', 'auth', 'api'].some(service => !target[service] || Object.keys(target[service]).length !== 2
      || target[service].host !== fixedConnectedTarget[service].host || target[service].port !== fixedConnectedTarget[service].port)) {
    throw new Error('Connected QA requires its exact demo project and fixed 127.0.0.1 ports.');
  }
  return target;
}
export function createConnectedEnvironment(host = {}) {
  const root = path.join(repositoryRoot, 'out/player-android-connected-qa/server');
  const environment = Object.fromEntries(osEnvironmentKeys.filter(key => typeof host[key] === 'string').map(key => [key, host[key]]));
  return Object.assign(environment, {
    USERPROFILE: path.join(root, 'user-home'), APPDATA: path.join(root, 'user-home/AppData/Roaming'),
    LOCALAPPDATA: path.join(root, 'user-home/AppData/Local'), TEMP: path.join(root, 'tmp'), TMP: path.join(root, 'tmp'),
    XDG_CONFIG_HOME: path.join(root, 'config'), XDG_DATA_HOME: path.join(root, 'data'),
    CI: '1', NODE_ENV: 'development', VERCEL: '', ORBIT_CONNECTED_QA_SERVER: '1',
    FIRESTORE_EMULATOR_HOST: hostFor(fixedConnectedTarget, 'firestore'),
    FIREBASE_AUTH_EMULATOR_HOST: hostFor(fixedConnectedTarget, 'auth'),
    GOOGLE_CLOUD_PROJECT: fixedConnectedTarget.projectId, GCLOUD_PROJECT: fixedConnectedTarget.projectId,
    FIREBASE_CONFIG: JSON.stringify({ projectId: fixedConnectedTarget.projectId }),
    ORBIT_FIRESTORE_MEMORY: 'false', ORBIT_REQUIRE_PLAYER_APP_CHECK: 'false',
    API_HOST: fixedConnectedTarget.api.host, API_PORT: String(fixedConnectedTarget.api.port), ORBIT_API_URL: originFor(fixedConnectedTarget, 'api')
  });
}
export function assertConnectedEnvironment(environment, target = fixedConnectedTarget) {
  assertConnectedTarget(target);
  const required = createConnectedEnvironment();
  for (const [key, value] of Object.entries(required)) {
    if (!osEnvironmentKeys.includes(key) && environment[key] !== value) throw new Error('Connected QA environment is not the fixed clean fixture.');
  }
  if (Object.keys(environment).some(key => !allowedEnvironmentKeys.has(key))) throw new Error('Connected QA refuses inherited or unreviewed environment variables.');
}
export function stripConnectedPlatformEnvironment(environment, platform = process.platform) {
  // Windows adds these even to an explicit clean child block. Remove them
  // without reading values, before loading any SDK; USERPROFILE stays isolated.
  if (platform === 'win32' && environment.ORBIT_CONNECTED_QA_SERVER === '1') {
    for (const key of windowsInjectedProfileKeys) delete environment[key];
  }
}
export function assertConnectedUrl(input, target = fixedConnectedTarget) {
  assertConnectedTarget(target);
  const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input?.url);
  if (url.protocol !== 'http:' || url.username || url.password
    || !['firestore', 'auth', 'api'].some(service => url.hostname === target[service].host && Number(url.port) === target[service].port)) {
    throw new Error('Connected QA blocked a non-fixture network destination.');
  }
  return url;
}
export function assertConnectedSocket(args, target = fixedConnectedTarget) {
  assertConnectedTarget(target);
  const values = Array.isArray(args[0]) ? args[0] : args;
  const options = values[0] && typeof values[0] === 'object' ? values[0] : { port: values[0], host: values[1] };
  if (options.path || !['firestore', 'auth', 'api'].some(service => options.host === target[service].host && Number(options.port) === target[service].port)) {
    throw new Error('Connected QA blocked a non-fixture socket destination.');
  }
}
export function installConnectedNetworkGuard(target = fixedConnectedTarget, ports = { socketPrototype: net.Socket.prototype, tls, http2, dns, dnsPromises: dns.promises, datagramPrototype: dgram.Socket.prototype, fetchOwner: globalThis }) {
  assertConnectedTarget(target);
  const restores = [];
  const replace = (object, key, replacement) => { const original = object[key]; object[key] = replacement(original); restores.push(() => { object[key] = original; }); };
  replace(ports.socketPrototype, 'connect', original => function (...args) { assertConnectedSocket(args, target); return original.apply(this, args); });
  replace(ports.tls, 'connect', () => function () { throw new Error('Connected QA blocks all TLS destinations.'); });
  replace(ports.http2, 'connect', original => function (authority, ...args) { assertConnectedUrl(authority, target); return original.call(this, authority, ...args); });
  replace(ports.fetchOwner, 'fetch', original => async function (input, init = {}) {
    assertConnectedUrl(input, target); return original.call(this, input, { ...init, redirect: 'error' });
  });
  replace(ports.dns, 'lookup', original => function (hostname, ...args) {
    if (hostname !== target.api.host) throw new Error('Connected QA blocks non-fixture DNS lookup.');
    return original.call(this, hostname, ...args);
  });
  for (const object of [ports.dns, ports.dnsPromises]) {
    for (const key of Object.keys(object).filter(name => /^(?:resolve|reverse)/.test(name))) {
      if (typeof object[key] === 'function') replace(object, key, () => function () { throw new Error('Connected QA blocks DNS resolution.'); });
    }
  }
  replace(ports.dnsPromises, 'lookup', original => async function (hostname, ...args) {
    if (hostname !== target.api.host) throw new Error('Connected QA blocks non-fixture DNS lookup.');
    return original.call(this, hostname, ...args);
  });
  replace(ports.datagramPrototype, 'send', () => function () { throw new Error('Connected QA blocks UDP destinations.'); });
  return () => { for (const restore of restores.reverse()) restore(); };
}

export function createConnectedVenueState(nowMs = Date.now()) {
  if (!Number.isFinite(nowMs)) throw new Error('Connected QA requires a valid fixture time.');
  const { clubId, gameId, secondGameId, name } = connectedFixtureVenue;
  return {
    settings: {
      clubAccount: { clubName: name, email: 'native-venue@example.invalid', address: 'Fictional QA venue, Austin, TX', coordinate: { latitude: 30.2672, longitude: -97.7431 }, minimumPlayerAge: 21 },
      pilotAccess: { authorized: true, licenseId: clubId, authorizationCode: fixtureAuthorizationCode, expiresAt: '2099-01-01T00:00:00.000Z' },
      collectionProfiles: [{ gameId, collectionMode: 'Time' }, { gameId: secondGameId, collectionMode: 'Time' }], defaultCollectionMode: 'Time'
    },
    games: [{ id: gameId, name: '$1/$2 No Limit Holdem', maxSeats: 9 }, { id: secondGameId, name: '$2/$5 Pot Limit Omaha', maxSeats: 9 }],
    sessions: [gameId, secondGameId].map((id, index) => ({ id: `native-qa-table-${index}`, gameId: id, label: `QA Table ${index + 1}`, status: 'Running', seatsFilled: 6 + index, maxSeats: 9, collectionMode: 'Time', startedAt: new Date(nowMs - 60_000).toISOString(), tags: [] })),
    profiles: [], playerSessions: [], buyIns: [], drops: [], tournaments: [],
    interests: [{ id: 'native-qa-queue', gameId, playerName: 'Fictional QA queue', status: 'Interested', interestedAt: new Date(nowMs).toISOString() }]
  };
}
export function createConnectedProfile(account, timestamp, nowMs = Date.now()) {
  if (!Object.values(connectedFixtureAccounts).includes(account) || !timestamp || !Number.isFinite(nowMs)) throw new Error('Connected QA requires an owned profile fixture.');
  return { id: account.uid, uid: account.uid, name: account.name, email: account.email, preferredGameIds: [], favoriteClubIds: [], adultDeclaredAt: new Date(nowMs).toISOString(), adultDeclarationVersion: 'v1', updatedAt: timestamp };
}
export function createConnectedSeatIdentity(owner, nowMs = Date.now()) {
  const account = fixtureAccountFor(owner);
  if (!Number.isFinite(nowMs)) throw new Error('Connected QA requires a valid synthetic identity time.');
  // Server-owned, explicitly fictional provisional eligibility. No camera,
  // physical-ID review, identity provider or verified-age outcome is claimed.
  return { status: 'provisional', ageVerified: false, ageEligible: true, ageLevel: 21,
    captureMethod: 'camera-pdf417', reviewStatus: 'pending-in-person', capturedAt: new Date(nowMs).toISOString(),
    verifiedDetails: { fullName: account.name, dateOfBirth: '1990-01-01', address: 'Fictional QA address' } };
}
export function createConnectedSeatVenueState(nowMs = Date.now()) {
  const state = createConnectedVenueState(nowMs);
  return { ...state, profiles: [{ id: connectedSeatProfileId, orbitPlayerId: connectedFixtureAccounts.a.uid,
    name: connectedFixtureAccounts.a.name, membershipStatus: 'Active', membershipExpirationDate: '2099-01-01', preferredGameIds: [] }] };
}
const fixtureLicensePath = () => `pilotLicenses/${createHash('sha256').update(fixtureAuthorizationCode).digest('hex')}`;
function requireRuntime(runtime) { assertConnectedTarget(runtime?.target); if (!runtime?.database || !runtime?.adminApp) throw new Error('Connected QA runtime is unavailable.'); }
function requireSeatRuntime(runtime) {
  requireRuntime(runtime);
  if (runtime.fixtureMode !== 'seat-request' || !runtime.seeded) throw new Error('Connected QA seat controls require the explicitly seeded seat-request fixture.');
}
export async function seedConnectedFixture(runtime) {
  requireRuntime(runtime);
  const fixtureMode = assertConnectedFixtureMode(runtime.fixtureMode ?? 'match');
  if (runtime.seeded) throw new Error('Connected QA fixture was already seeded.');
  const nowMs = Date.now();
  for (const account of Object.values(connectedFixtureAccounts)) {
    const owner = account === connectedFixtureAccounts.a ? 'a' : 'b';
    const existing = await runtime.database.getDocument(`players/${account.uid}`);
    runtime.bootstrap?.mark(`${owner}-profile-checked`);
    let identityExists = false;
    if (fixtureMode === 'seat-request') {
      identityExists = Boolean(await runtime.database.getDocument(`players/${account.uid}/private/identity`));
      runtime.bootstrap?.mark(`${owner}-eligibility-checked`);
    }
    if (existing || identityExists) throw new Error('Connected QA refuses to overwrite an existing owner profile.');
    await runtime.admin.auth(runtime.adminApp).createUser({ uid: account.uid, email: account.email, password: account.password, displayName: account.name, emailVerified: true });
    runtime.bootstrap?.mark(`${owner}-auth-created`);
    runtime.seededUids.add(account.uid);
    runtime.seededPaths.add(`players/${account.uid}`);
    await runtime.database.createDocument(`players/${account.uid}`, createConnectedProfile(account, runtime.admin.firestore.Timestamp.now(), nowMs));
    runtime.bootstrap?.mark(`${owner}-profile-written`);
    if (fixtureMode === 'seat-request') {
      await runtime.database.createDocument(`players/${account.uid}/private/identity`, createConnectedSeatIdentity(owner, nowMs));
      runtime.bootstrap?.mark(`${owner}-eligibility-written`);
    }
  }
  const state = fixtureMode === 'seat-request' ? createConnectedSeatVenueState(nowMs) : createConnectedVenueState(nowMs);
  const venueState = apiRequire('./src/db/state.js');
  const accountPath = venueState.accountPath(connectedFixtureVenue.clubId);
  if (await runtime.database.getDocument(accountPath) || await runtime.database.getDocument(fixtureLicensePath())) throw new Error('Connected QA refuses to overwrite an existing venue fixture.');
  runtime.bootstrap?.mark('venue-checked');
  runtime.seededPaths.add(fixtureLicensePath());
  await runtime.database.createDocument(fixtureLicensePath(), { accountKey: connectedFixtureVenue.clubId, licenseId: connectedFixtureVenue.clubId, status: 'active', expiresAt: state.settings.pilotAccess.expiresAt });
  runtime.bootstrap?.mark('license-written');
  runtime.seededPaths.add(accountPath);
  runtime.seededPaths.add(venueState.publicationPath(connectedFixtureVenue.clubId, 1));
  const saved = await venueState.saveState(state, { expectedRevision: 0, mutationId: 'native-qa-fixture-seed', mutationType: 'qa-fixture-seed' });
  runtime.bootstrap?.mark('venue-written');
  runtime.seeded = true;
  return { projectId: runtime.target.projectId, apiOrigin: originFor(runtime.target, 'api'), ownerCount: runtime.seededUids.size, clubId: connectedFixtureVenue.clubId, gameIds: state.games.map(game => game.id), venueRevision: saved.revision, publicationDrained: false,
    ...(fixtureMode === 'seat-request' ? { fixtureMode } : {}) };
}
export async function inspectConnectedState(runtime, { owner = 'a' } = {}) {
  requireRuntime(runtime);
  const account = fixtureAccountFor(owner);
  const state = await runtime.database.getDocument(`players/${account.uid}/orbitMatch/state`);
  const decoder = apiRequire('./src/shared/orbitMatchState.cjs').decodeMatchState;
  const decoded = state === null ? null : decoder(state);
  if (state !== null && !decoded) throw new Error('Connected QA found invalid Match state.');
  const receipts = await runtime.database.queryCollection(`players/${account.uid}/orbitMatch/state/receipts`, { limit: 100 });
  return { owner, uid: account.uid, state: decoded, summary: summarizeConnectedState(decoded), receiptCount: receipts.length, receiptCountCappedAt: 100 };
}
export function summarizeConnectedState(state) {
  return state === null ? { exists: false } : {
    exists: true, revision: state.revision, preferencesRevision: state.preferencesRevision,
    savedCount: state.decisions.filter(decision => decision.decision === 'saved').length,
    passedCount: state.decisions.filter(decision => decision.decision === 'passed').length,
    eventCount: state.events.length, recentMutationCount: state.recentMutationIds.length
  };
}
export function createConnectedListenerObserver(peer, owner) {
  const account = fixtureAccountFor(owner);
  if (peer?.uid !== account.uid) throw new Error('Connected QA listener requires its owned SDK peer.');
  const decode = apiRequire('./src/shared/orbitMatchState.cjs').decodeMatchState;
  let active = true, accepted = 0, errors = 0, last = null;
  const dispose = peer.listenMatch(snapshot => {
    if (!active || snapshot.metadata?.fromCache !== false || snapshot.metadata?.hasPendingWrites !== false) return;
    const state = snapshot.exists() ? decode(snapshot.data()) : null;
    if (snapshot.exists() && state === null) { errors++; return; }
    accepted++; last = summarizeConnectedState(state);
  }, () => { if (active) errors++; });
  return {
    status: () => ({ owner, active, accepted, errors, latest: last }),
    stop: () => { if (active) { active = false; dispose(); } return { owner, active, accepted, errors, latest: last }; }
  };
}
export async function pauseConnectedApi(runtime) {
  requireRuntime(runtime);
  if (runtime.server) {
    const server = runtime.server;
    if (server.listening) {
      const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      server.closeAllConnections(); await closed;
    }
    runtime.server = undefined;
  }
  return { apiListening: false };
}
export async function resumeConnectedApi(runtime) {
  requireRuntime(runtime);
  if (runtime.server) throw new Error('Connected QA API is already listening.');
  runtime.server = listenConnectedApi(runtime);
  await once(runtime.server, 'listening');
  return { apiListening: true, apiOrigin: originFor(runtime.target, 'api') };
}
function listenConnectedApi(runtime) {
  if (!runtime.seatAttemptCounter) return runtime.app.listen(runtime.target.api.port, runtime.target.api.host);
  return http.createServer((request, response) => {
    // Count attempts without inspecting identity headers or request bodies;
    // the unchanged Express handler retains every authorization middleware.
    try { runtime.seatAttemptCounter.observe(request); }
    catch { response.statusCode = 400; response.end('Invalid local QA request.'); return; }
    runtime.app(request, response);
  }).listen(runtime.target.api.port, runtime.target.api.host);
}
export function transitionConnectedVenueState(record, update, nowMs = Date.now()) {
  if (!update || Object.keys(update).length !== 2 || !['availability', 'ended'].includes(update.kind)
    || update.expectedRevision !== (update.kind === 'availability' ? 1 : 2)
    || record?.accountKey !== connectedFixtureVenue.clubId || record.revision !== update.expectedRevision
    || record.state?.settings?.pilotAccess?.licenseId !== connectedFixtureVenue.clubId || !Number.isFinite(nowMs)) {
    throw new Error('Connected QA venue control requires its exact owned fixture and expected stage revision.');
  }
  const state = record.state;
  if (!Array.isArray(state.sessions) || !Array.isArray(state.interests)) throw new Error('Connected QA venue fixture is invalid.');
  const tables = state.sessions.filter(table => table.id === 'native-qa-table-0' && table.gameId === connectedFixtureVenue.gameId);
  if (tables.length !== 1 || tables[0].status !== 'Running' || tables[0].maxSeats !== 9
    || tables[0].seatsFilled !== (update.kind === 'availability' ? 6 : 8)) throw new Error('Connected QA venue table does not match the expected fixture stage.');
  return {
    ...state,
    sessions: state.sessions.map(table => table !== tables[0] ? table : update.kind === 'availability'
      ? { ...table, seatsFilled: 8 } : { ...table, status: 'Ended', endedAt: new Date(nowMs).toISOString() }),
    // Add only six plainly fictional fixture entries. Existing queue/private
    // records, the PLO table and every other source field stay intact.
    interests: update.kind === 'availability' ? [...state.interests, ...Array.from({ length: 6 }, (_, index) => ({ id: `native-qa-added-queue-${index}`, gameId: connectedFixtureVenue.gameId, playerName: 'Fictional QA queue', status: 'Interested', interestedAt: new Date(nowMs + index).toISOString() }))] : state.interests
  };
}
export async function updateConnectedVenue(runtime, update) {
  requireRuntime(runtime);
  if (!runtime.seeded) throw new Error('Connected QA venue is not seeded.');
  const venueState = apiRequire('./src/db/state.js');
  const current = await venueState.loadState(connectedFixtureVenue.clubId);
  const next = transitionConnectedVenueState(current, update);
  runtime.seededPaths.add(venueState.publicationPath(connectedFixtureVenue.clubId, update.expectedRevision + 1));
  const saved = await venueState.saveState(next, { expectedRevision: update.expectedRevision, mutationId: `native-qa-fixture-${update.kind}`, mutationType: `qa-fixture-${update.kind}` });
  return { venueRevision: saved.revision, gameId: connectedFixtureVenue.gameId, stage: update.kind, publicationDrained: false };
}
function requireSeatRecord(record) {
  if (record?.accountKey !== connectedFixtureVenue.clubId || !Number.isInteger(record.revision) || record.revision < 1
    || record.state?.settings?.pilotAccess?.licenseId !== connectedFixtureVenue.clubId
    || !Array.isArray(record.state.profiles) || !Array.isArray(record.state.interests) || !Array.isArray(record.state.sessions)) {
    throw new Error('Connected QA seat control requires its exact owned venue record.');
  }
  const profiles = record.state.profiles.filter(profile => profile.id === connectedSeatProfileId);
  if (profiles.length !== 1 || profiles[0].orbitPlayerId !== connectedFixtureAccounts.a.uid) throw new Error('Connected QA seat membership is not the owned fixture.');
  return profiles[0];
}
export function projectConnectedSeatInterests(record, owner) {
  fixtureAccountFor(owner);
  requireSeatRecord(record);
  const interests = owner === 'a' ? record.state.interests.filter(entry => entry.profileId === connectedSeatProfileId) : [];
  if (interests.length > 10) throw new Error('Connected QA seat inspection exceeds the bounded fixture.');
  return interests.map(entry => {
    const attendance = { Arrived: 'arrived', 'Confirmed Coming': 'confirmed', Interested: 'interested' }[entry.status];
    const requestedAt = entry.timestamp || entry.interestedAt;
    if (!/^wait_[A-Za-z0-9_-]{16,175}$/.test(entry.id) || ![connectedFixtureVenue.gameId, connectedFixtureVenue.secondGameId].includes(entry.gameId)
      || !attendance || !Number.isFinite(Date.parse(requestedAt))
      || attendance !== 'interested' && entry.tableId !== (entry.gameId === connectedFixtureVenue.gameId ? 'native-qa-table-0' : 'native-qa-table-1')) {
      throw new Error('Connected QA seat inspection found an unexpected fixture request.');
    }
    return { id: entry.id, gameId: entry.gameId, ...(entry.tableId ? { tableId: entry.tableId } : {}), status: entry.status, attendance, requestedAt };
  });
}
export function createConnectedSeatReplayBody(record, owner) {
  const account = fixtureAccountFor(owner);
  if (owner !== 'a') throw new Error('Connected QA seat replay requires the original owner.');
  const entries = projectConnectedSeatInterests(record, owner).filter(entry => entry.gameId === connectedFixtureVenue.secondGameId && entry.attendance === 'arrived');
  if (entries.length !== 1) throw new Error('Connected QA seat replay requires one accepted owned PLO arrival.');
  const entry = entries[0];
  return { id: entry.id, clubId: connectedFixtureVenue.clubId, type: 'waitlist-request', action: 'join', gameId: entry.gameId,
    tableId: entry.tableId, attendance: entry.attendance, requestedAt: entry.requestedAt,
    player: { id: account.uid, name: account.name, email: account.email, preferredGameIds: [] } };
}
export async function inspectConnectedSeatState(runtime, { owner = 'a' } = {}) {
  requireSeatRuntime(runtime);
  const account = fixtureAccountFor(owner);
  const venueState = apiRequire('./src/db/state.js');
  const record = await venueState.loadState(connectedFixtureVenue.clubId);
  const interests = projectConnectedSeatInterests(record, owner);
  let receiptCount = 0;
  for (const entry of interests) {
    const scope = apiRequire('./src/routes/player.js').opaqueStateMutationId('waitlist', connectedFixtureVenue.clubId, account.uid, entry.id);
    const receiptPath = venueState.globalMutationPath(scope);
    const receipt = await runtime.database.getDocument(receiptPath);
    if (receipt) {
      if (receipt.accountKey !== connectedFixtureVenue.clubId || receipt.result?.operation !== 'waitlist-join') throw new Error('Connected QA seat receipt does not match its owned request.');
      receiptCount++;
      runtime.seededPaths.add(receiptPath);
    }
  }
  const match = await inspectConnectedState(runtime, { owner });
  const events = (match.state?.events ?? []).filter(event => event.kind === 'waitlist-success');
  if (events.length > 10) throw new Error('Connected QA seat event inspection exceeds its bounded fixture.');
  return { fixtureMode: 'seat-request', venueRevision: record.revision, waitlistAttemptCount: runtime.seatAttemptCounter.count(), interestCount: interests.length, interests, receiptCount,
    match: { savedCount: match.summary.savedCount ?? 0, waitlistSuccessEvents: events.map(({ eventId, at, ref, saveMutationId }) => ({ eventId, at, ref, saveMutationId })) } };
}
export function transitionConnectedSeatVenueState(record, update, nowMs = Date.now()) {
  const profile = requireSeatRecord(record);
  if (!update || Object.keys(update).length !== 2 || !['expire-membership', 'end-game'].includes(update.kind)
    || !Number.isInteger(update.expectedRevision) || update.expectedRevision < 1 || update.expectedRevision > 20
    || update.expectedRevision !== record.revision || !Number.isFinite(nowMs)) throw new Error('Connected QA seat update requires an exact fixture revision and stage.');
  const state = record.state;
  if (update.kind === 'expire-membership') {
    if (profile.membershipStatus !== 'Active' || Date.parse(profile.membershipExpirationDate) <= nowMs) throw new Error('Connected QA membership is already unavailable.');
    const expiredAt = new Date(nowMs - 86_400_000).toISOString();
    return { ...state, profiles: state.profiles.map(entry => entry !== profile ? entry : { ...entry,
      membershipStatus: 'Expired', membershipExpirationDate: expiredAt.slice(0, 10),
      ...(entry.membershipExpiresAt ? { membershipExpiresAt: expiredAt } : {}) }) };
  }
  const tables = state.sessions.filter(table => table.id === 'native-qa-table-0' && table.gameId === connectedFixtureVenue.gameId);
  if (tables.length !== 1 || tables[0].status !== 'Running') throw new Error('Connected QA NLH table is already unavailable.');
  return { ...state, sessions: state.sessions.map(table => table !== tables[0] ? table : { ...table, status: 'Ended', endedAt: new Date(nowMs).toISOString() }) };
}
export async function updateConnectedSeatVenue(runtime, update) {
  requireSeatRuntime(runtime);
  const venueState = apiRequire('./src/db/state.js');
  const record = await venueState.loadState(connectedFixtureVenue.clubId);
  const next = transitionConnectedSeatVenueState(record, update);
  runtime.seededPaths.add(venueState.publicationPath(connectedFixtureVenue.clubId, update.expectedRevision + 1));
  const saved = await venueState.saveState(next, { expectedRevision: update.expectedRevision,
    mutationId: `native-qa-seat-${update.kind}`, mutationType: `qa-seat-${update.kind}` });
  return { fixtureMode: 'seat-request', stage: update.kind, venueRevision: saved.revision, gameId: connectedFixtureVenue.gameId, publicationDrained: false };
}
export async function replayConnectedSeatRequest(runtime, peer, owner) {
  requireSeatRuntime(runtime);
  if (owner !== 'a' || peer?.uid !== connectedFixtureAccounts.a.uid) throw new Error('Connected QA replay requires its original authenticated peer.');
  const venueState = apiRequire('./src/db/state.js');
  const before = await inspectConnectedSeatState(runtime, { owner });
  const record = await venueState.loadState(connectedFixtureVenue.clubId);
  const result = await peer.submitSeatRequest(createConnectedSeatReplayBody(record, owner));
  const after = await inspectConnectedSeatState(runtime, { owner });
  return { status: result.status, venueUnchanged: before.venueRevision === after.venueRevision && JSON.stringify(before.interests) === JSON.stringify(after.interests),
    receiptUnchanged: before.receiptCount === after.receiptCount, interestCount: after.interestCount, receiptCount: after.receiptCount };
}
export async function denyConnectedSeatOwnership(runtime, peer, owner) {
  requireSeatRuntime(runtime);
  if (owner !== 'b' || peer?.uid !== connectedFixtureAccounts.b.uid) throw new Error('Connected QA ownership negatives require the authenticated second fixture.');
  const venueState = apiRequire('./src/db/state.js');
  const record = await venueState.loadState(connectedFixtureVenue.clubId);
  const body = createConnectedSeatReplayBody(record, 'a');
  const before = await inspectConnectedSeatState(runtime, { owner: 'a' });
  const spoof = await peer.submitSeatRequest(body);
  const cancel = await peer.submitSeatRequest({ ...body, id: `wait_${randomUUID()}`, action: 'cancel',
    player: { id: connectedFixtureAccounts.b.uid, name: connectedFixtureAccounts.b.name, email: connectedFixtureAccounts.b.email, preferredGameIds: [] } });
  const afterRecord = await venueState.loadState(connectedFixtureVenue.clubId);
  const after = await inspectConnectedSeatState(runtime, { owner: 'a' });
  return { spoofStatus: spoof.status, cancelStatus: cancel.status,
    venueUnchanged: record.revision === afterRecord.revision && JSON.stringify(record.state) === JSON.stringify(afterRecord.state),
    receiptUnchanged: before.receiptCount === after.receiptCount };
}
async function captureConnectedSeatCleanupPaths(runtime) {
  if (runtime.fixtureMode !== 'seat-request' || !runtime.seeded) return;
  for (const collection of ['orbitGlobalMutationReceipts', 'orbitPublicationOutbox']) {
    const documents = await runtime.database.queryCollection(collection, { filters: [{ field: 'accountKey', op: '==', value: connectedFixtureVenue.clubId }], limit: 50 });
    if (documents.length >= 50) throw new Error('Connected QA seat cleanup exceeds its bounded fixture.');
    for (const document of documents) {
      const ownedId = collection === 'orbitGlobalMutationReceipts' ? /^m_[a-f0-9]{64}$/.test(document.id) : /^native-qa-card-house~\d{12}$/.test(document.id);
      if (document.data?.accountKey !== connectedFixtureVenue.clubId || !ownedId) throw new Error('Connected QA seat cleanup found an unowned path.');
      runtime.seededPaths.add(`${collection}/${document.id}`);
    }
  }
}
export async function startConnectedServer({ target = fixedConnectedTarget, environment = process.env, fixtureMode = 'match', bootstrap } = {}) {
  assertConnectedFixtureMode(fixtureMode);
  assertConnectedTarget(target);
  if (environment === process.env) stripConnectedPlatformEnvironment(environment);
  assertConnectedEnvironment(environment, target);
  if (environment !== process.env) throw new Error('Connected QA startup requires its own clean child process.');
  if (startedOnce) throw new Error('Connected QA uses one API runtime per child process.');
  startedOnce = true;
  const restoreNetwork = installConnectedNetworkGuard(target);
  runtimeNetworkGuardActive = true;
  const runtime = { target, fixtureMode, bootstrap, restoreNetwork, seededPaths: new Set(), seededUids: new Set(), seeded: false,
    ...(fixtureMode === 'seat-request' ? { seatAttemptCounter: createConnectedSeatAttemptCounter(target) } : {}) };
  try {
    // The fresh default Admin app is shared by the unchanged API providers.
    // No ADC, user home credential, service-account file, or OAuth is used.
    const admin = apiRequire('firebase-admin');
    if (admin.apps.length) throw new Error('Connected QA requires a fresh Admin SDK process.');
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    runtime.admin = admin;
    runtime.adminApp = admin.initializeApp({ projectId: target.projectId, credential: admin.credential.cert({ projectId: target.projectId, clientEmail: 'native-qa@example.invalid', privateKey }) });
    runtime.firestore = admin.firestore(runtime.adminApp);
    runtime.firestore.settings({ host: hostFor(target, 'firestore'), ssl: false });
    process.env.ORBIT_LOG_HASH_SECRET = randomBytes(32).toString('hex');
    runtime.database = await apiRequire('./src/db/connection.js').getDatabase();
    if (runtime.database.mode !== 'firestore') throw new Error('Connected QA requires actual Admin Firestore.');
    runtime.bootstrap?.mark('admin-ready');
    // app.js preserves real Auth/App Check/deletion/rate-limit middleware;
    // server.js is deliberately excluded because it drains publication timers.
    runtime.app = apiRequire('./src/app.js');
    runtime.server = listenConnectedApi(runtime);
    await once(runtime.server, 'listening');
    runtime.bootstrap?.mark('api-listening');
    return runtime;
  } catch (error) {
    await stopConnectedServer(runtime).catch(() => undefined);
    throw new Error(`Connected QA startup failed (${safeErrorCode(error)}).`);
  }
}
export async function stopConnectedServer(runtime) {
  assertConnectedTarget(runtime?.target);
  runtime.bootstrap?.mark('cleanup-start');
  const failures = [];
  const attempt = async task => { try { await task(); } catch (error) { failures.push(error); } };
  try {
    if (runtime.server) {
      await attempt(() => pauseConnectedApi(runtime));
    }
    if (runtime.firestore) {
      await attempt(() => captureConnectedSeatCleanupPaths(runtime));
      for (const document of runtime.seededPaths) await attempt(() => runtime.firestore.recursiveDelete(runtime.firestore.doc(document)));
    }
    if (runtime.adminApp) {
      for (const uid of runtime.seededUids) await attempt(() => runtime.admin.auth(runtime.adminApp).deleteUser(uid));
      await attempt(() => runtime.adminApp.delete()); runtime.adminApp = undefined;
    }
  } finally { delete process.env.ORBIT_LOG_HASH_SECRET; runtime.restoreNetwork?.(); runtimeNetworkGuardActive = false; }
  if (failures.length) throw new Error('Connected QA cleanup was incomplete.');
  runtime.bootstrap?.mark('cleanup-done');
}
export async function signInConnectedPeer(owner, { target = fixedConnectedTarget } = {}) {
  assertConnectedTarget(target);
  const account = fixtureAccountFor(owner);
  if (!runtimeNetworkGuardActive) throw new Error('Connected QA peer requires the guarded server child process.');
  const sdk = playerRequire('firebase/app');
  const authSdk = playerRequire('firebase/auth');
  const firestoreSdk = playerRequire('firebase/firestore');
  const app = sdk.initializeApp({ apiKey: 'native-qa-fake-api-key', projectId: target.projectId, authDomain: 'native-qa.example.invalid' }, `native-qa-peer-${owner}-${randomUUID()}`);
  const auth = authSdk.getAuth(app);
  authSdk.connectAuthEmulator(auth, originFor(target, 'auth'), { disableWarnings: true });
  const db = firestoreSdk.getFirestore(app);
  firestoreSdk.connectFirestoreEmulator(db, target.firestore.host, target.firestore.port);
  try {
    const accepted = await authSdk.signInWithEmailAndPassword(auth, account.email, account.password);
    if (accepted.user.uid !== account.uid || !accepted.user.emailVerified) throw new Error('Connected QA peer identity did not match its verified fixture.');
    const request = async (endpoint, operation) => {
      const response = await fetch(`${originFor(target, 'api')}${endpoint}`, { method: operation === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { 'content-type': 'application/json', authorization: `Bearer ${await accepted.user.getIdToken()}` }, ...(operation === undefined ? {} : { body: JSON.stringify(operation) }) });
      return { status: response.status, body: await response.json() };
    };
    return {
      uid: accepted.user.uid,
      readMatch: () => request('/player/match'),
      operateMatch: operation => request('/player/match/operations', operation),
      submitSeatRequest: operation => request('/player/waitlist-requests', operation),
      discovery: () => request('/player/discovery?limit=50'),
      listenMatch: (onState, onError) => firestoreSdk.onSnapshot(firestoreSdk.doc(db, 'players', account.uid, 'orbitMatch', 'state'), onState, onError),
      proveIsolation: async () => {
        const other = fixtureAccountFor(owner === 'a' ? 'b' : 'a');
        const deny = async operation => {
          try { await operation(); } catch (error) {
            if (error?.code === 'permission-denied') return true;
            throw new Error(`Connected QA isolation failed (${safeErrorCode(error)}).`);
          }
          throw new Error('Connected QA expected a denied SDK operation.');
        };
        return {
          foreignMatchReadDenied: await deny(() => firestoreSdk.getDoc(firestoreSdk.doc(db, 'players', other.uid, 'orbitMatch', 'state'))),
          ownMatchWriteDenied: await deny(() => firestoreSdk.setDoc(firestoreSdk.doc(db, 'players', account.uid, 'orbitMatch', 'state'), { qaDeniedWrite: true })),
          ownReceiptReadDenied: await deny(() => firestoreSdk.getDoc(firestoreSdk.doc(db, 'players', account.uid, 'orbitMatch', 'state', 'receipts', 'native-qa-denied-receipt'))),
          ownReceiptWriteDenied: await deny(() => firestoreSdk.setDoc(firestoreSdk.doc(db, 'players', account.uid, 'orbitMatch', 'state', 'receipts', 'native-qa-denied-receipt'), { qaDeniedWrite: true }))
        };
      },
      close: async () => { await authSdk.signOut(auth); await firestoreSdk.terminate(db); await sdk.deleteApp(app); }
    };
  } catch (error) { await firestoreSdk.terminate(db); await sdk.deleteApp(app); throw new Error(`Connected QA peer sign-in failed (${safeErrorCode(error)}).`); }
}
function safeErrorCode(error) { return typeof error?.code === 'string' && /^[a-zA-Z0-9_/-]{1,80}$/.test(error.code) ? error.code : 'QA_LOCAL_FAILURE'; }

async function main() {
  const options = process.argv.slice(2).join(' ');
  if (!['--run', '--run --seat-request'].includes(options)) throw new Error('Connected QA server requires --run with only the optional --seat-request fixture.');
  const bootstrap = createConnectedBootstrapObserver({ onPhase: record => process.send?.(record) });
  bootstrap.mark('start');
  const runtime = await startConnectedServer({ fixtureMode: options === '--run --seat-request' ? 'seat-request' : 'match', bootstrap });
  const peers = new Map();
  const listeners = new Map();
  let closing;
  const close = () => closing ||= (async () => {
    for (const listener of listeners.values()) listener.stop();
    const peerResults = await Promise.allSettled([...peers.values()].map(async peer => (await peer).close()));
    await stopConnectedServer(runtime);
    if (peerResults.some(result => result.status === 'rejected')) throw new Error('Connected QA peer cleanup was incomplete.');
  })();
  try {
    const fixture = await seedConnectedFixture(runtime);
    bootstrap.mark('ready');
    const ready = { type: 'ready', ...fixture };
    console.log(JSON.stringify(ready)); process.send?.(ready);
    process.on('message', async message => {
      if (!message || typeof message.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(message.requestId)) return;
      try {
        if (Buffer.byteLength(JSON.stringify(message), 'utf8') > 20 * 1024) throw new Error('Connected QA command is too large.');
        if (message.type === 'stop') { await close(); process.send?.({ type: 'stopped', requestId: message.requestId }); process.exit(0); }
        if (message.type === 'pause-api' || message.type === 'resume-api') {
          const result = message.type === 'pause-api' ? await pauseConnectedApi(runtime) : await resumeConnectedApi(runtime);
          process.send?.({ type: 'result', requestId: message.requestId, result }); return;
        }
        if (message.type === 'fixture-venue-update') {
          const result = await updateConnectedVenue(runtime, message.update);
          process.send?.({ type: 'result', requestId: message.requestId, result }); return;
        }
        if (['fixture-seat-inspect', 'peer-seat-replay', 'peer-seat-owner-denial', 'fixture-seat-update'].includes(message.type)) {
          const allowed = message.type === 'fixture-seat-update' ? ['type', 'requestId', 'update'] : ['type', 'requestId', 'owner'];
          if (Object.keys(message).some(key => !allowed.includes(key))) throw new Error('Connected QA seat command has unreviewed fields.');
          requireSeatRuntime(runtime);
          let result;
          if (message.type === 'fixture-seat-inspect') result = await inspectConnectedSeatState(runtime, { owner: message.owner });
          else if (message.type === 'fixture-seat-update') result = await updateConnectedSeatVenue(runtime, message.update);
          else {
            fixtureAccountFor(message.owner);
            if (!peers.has(message.owner)) peers.set(message.owner, signInConnectedPeer(message.owner));
            const peer = await peers.get(message.owner);
            result = message.type === 'peer-seat-replay' ? await replayConnectedSeatRequest(runtime, peer, message.owner) : await denyConnectedSeatOwnership(runtime, peer, message.owner);
          }
          process.send?.({ type: 'result', requestId: message.requestId, result }); return;
        }
        if (!['inspect', 'peer-read', 'peer-operation', 'peer-discovery', 'peer-isolation', 'peer-listener-start', 'peer-listener-status', 'peer-listener-stop'].includes(message.type)) throw new Error('Connected QA rejected an unsupported command.');
        fixtureAccountFor(message.owner);
        let result;
        if (message.type === 'inspect') result = await inspectConnectedState(runtime, { owner: message.owner });
        else {
          if (!peers.has(message.owner)) peers.set(message.owner, signInConnectedPeer(message.owner));
          const peer = await peers.get(message.owner);
          if (message.type === 'peer-read') result = await peer.readMatch();
          else if (message.type === 'peer-operation') result = await peer.operateMatch(message.operation);
          else if (message.type === 'peer-discovery') result = await peer.discovery();
          else if (message.type === 'peer-isolation') result = await peer.proveIsolation();
          else {
            if (message.type === 'peer-listener-start') {
              if (listeners.has(message.owner)) throw new Error('Connected QA owner listener already exists.');
              listeners.set(message.owner, createConnectedListenerObserver(peer, message.owner));
            }
            const listener = listeners.get(message.owner);
            if (!listener) throw new Error('Connected QA owner listener is unavailable.');
            result = message.type === 'peer-listener-stop' ? listener.stop() : listener.status();
            if (message.type === 'peer-listener-stop') listeners.delete(message.owner);
          }
        }
        process.send?.({ type: 'result', requestId: message.requestId, result });
      } catch (error) { process.send?.({ type: 'error', requestId: message.requestId, code: safeErrorCode(error) }); }
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void close().then(() => process.exit(0), () => process.exit(1)); });
  } catch (error) { await close().catch(() => undefined); throw error; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(JSON.stringify({ type: 'failed', code: safeErrorCode(error) })); process.exitCode = 1; });
}
