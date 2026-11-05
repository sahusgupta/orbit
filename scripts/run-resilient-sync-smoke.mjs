import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const accountKey = 'resilient-sync-smoke';
const syntheticKey = 'synthetic-resilient-smoke-machine-key';
const allowedEnvironment = ['PATH', 'Path', 'SystemRoot', 'ComSpec', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
  'HOMEDRIVE', 'HOMEPATH', 'LOGONSERVER', 'SYSTEMDRIVE', 'USERDOMAIN', 'USERNAME', 'WINDIR', 'DISPLAY', 'XAUTHORITY', 'CI'];

// Re-execute before importing app code. Developer .env files, service credentials,
// and hosted endpoints are excluded rather than inherited and overridden.
if (!process.argv.includes('--isolated-child')) {
  const inherited = Object.fromEntries(allowedEnvironment.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--isolated-child'], {
    cwd: workspaceRoot, stdio: 'inherit', windowsHide: true,
    env: { ...inherited, NODE_ENV: 'test', ORBIT_RESILIENT_SMOKE_ISOLATED: '1', ORBIT_FIRESTORE_MEMORY: 'true',
      ORBIT_ENABLE_FIREBASE_SYNC: 'false', VITE_ENABLE_FIREBASE_SYNC: 'false', ORBIT_ENABLE_EMBEDDED_BACKEND: 'false',
      ORBIT_MACHINE_CREDENTIALS_JSON: JSON.stringify([{ id: 'synthetic-resilient-smoke', key: syntheticKey, accountKey, scopes: ['client:write'] }]) }
  });
  child.once('error', (error) => { throw error; });
  const [code] = await once(child, 'exit');
  process.exitCode = code ?? 1;
} else {
  assert.equal(process.env.ORBIT_RESILIENT_SMOKE_ISOLATED, '1');
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.ORBIT_FIRESTORE_MEMORY, 'true');
  assert.equal(process.env.VITE_ENABLE_FIREBASE_SYNC, 'false');
  const permitted = new Set([...allowedEnvironment, 'NODE_ENV', 'ORBIT_RESILIENT_SMOKE_ISOLATED', 'ORBIT_FIRESTORE_MEMORY', 'ORBIT_ENABLE_FIREBASE_SYNC',
    'VITE_ENABLE_FIREBASE_SYNC', 'ORBIT_ENABLE_EMBEDDED_BACKEND', 'ORBIT_MACHINE_CREDENTIALS_JSON']);
  assert.deepEqual(Object.keys(process.env).filter((key) => !permitted.has(key)), [], 'Unexpected inherited environment variables.');
  await runIsolatedSmoke();
}

function createSyntheticState() {
  const state = Object.fromEntries(['games', 'physicalTables', 'profiles', 'tournaments', 'interests', 'sessions', 'playerSessions', 'buyIns', 'dropLogs',
    'dealerAssignments', 'handCountLogs', 'timeFeeLogs', 'revenueTransactions', 'playerLedger', 'tableEvents', 'inAppNotifications', 'staffRequests',
    'history', 'nightCloses', 'feedback', 'scriptTemplates', 'correctionLog', 'usageEvents'].map((field) => [field, []]));
  const timestamp = '2026-11-03T12:00:00.000Z';
  state.settings = {
    lowLight: false, defaultCollectionMode: 'Drop', defaultTableCap: 8, defaultHourlyFee: 0, defaultEstimatedDropPerSeatHour: 0,
    collectionProfiles: [], membershipPlans: [], showPlayerGrid: true, showDashboardKpis: false, showRecentPlayers: true,
    pilotAccess: { authorized: true, licenseId: accountKey, authorizationCode: 'synthetic-smoke-pilot-secret', activatedAt: timestamp, expiresAt: '2099-01-01' },
    accountLogin: { username: 'synthetic@example.test', passwordSalt: 'synthetic-smoke-login-salt', passwordHash: 'synthetic-smoke-login-verifier', createdAt: timestamp },
    staffAccounts: [{ id: 'synthetic-staff', name: 'Synthetic Staff', role: 'Manager', pinSalt: 'synthetic-smoke-pin-salt', pinHash: 'synthetic-smoke-pin-verifier', active: true, createdAt: timestamp }]
  };
  state.games = [{ id: 'synthetic-game', name: 'Synthetic Game', maxSeats: 8, minInRoomForLikely: 2, minFlexibleForLikely: 3, minTotalForViable: 6 }];
  state.playerLedger = Array.from({ length: 3000 }, (_, index) => ({ id: `retained-${index}`, type: 'Buy-In', playerName: 'Synthetic Historical Player',
    amount: 1, timestamp, note: '♠'.repeat(250) }));
  return state;
}

async function runIsolatedSmoke() {
  const started = performance.now();
  const require = createRequire(import.meta.url);
  const app = require('../apps/api/src/app.js');
  const database = require('../apps/api/src/database.js');
  const outbox = require('../apps/api/src/db/publicationOutbox.js');
  const { chromium } = await import('@playwright/test');
  const { createServer: createViteServer } = await import('vite');
  assert.equal(database.getDatabaseStatus().mode, 'memory-test');
  const initialState = createSyntheticState();
  await database.saveState(initialState, { expectedRevision: 0, mutationId: 'synthetic-seed' });
  const retainedBytes = Buffer.byteLength(JSON.stringify(initialState));
  assert.ok(retainedBytes > 2_000_000);
  let legacyWrites = 0;
  let finalizeRequests = 0;
  const api = createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/state') legacyWrites += 1;
    if (request.url?.endsWith('/finalize')) {
      finalizeRequests += 1;
    }
    app(request, response);
  });
  api.listen(0, '127.0.0.1');
  await once(api, 'listening');
  const apiTarget = `http://127.0.0.1:${api.address().port}`;
  const vite = await createViteServer({
    configFile: false, envDir: false, root: workspaceRoot,
    optimizeDeps: { noDiscovery: true, include: [], entries: [] },
    define: { 'import.meta.env.VITE_ENABLE_FIREBASE_SYNC': '"false"' },
    server: { host: '127.0.0.1', port: 0, strictPort: false, watch: null },
    plugins: [{ name: 'isolated-resilient-sync-harness', configureServer(server) {
      server.middlewares.use('/__resilient-sync-smoke', (_request, response) => {
        response.setHeader('content-type', 'text/html');
        response.end('<!doctype html><html><head><title>Isolated resilient sync</title></head><body>Isolated synthetic checkpoint verification</body></html>');
      });
    } }]
  });
  const profileDirectory = await mkdtemp(path.join(tmpdir(), 'orbit-resilient-sync-'));
  let context;
  const blockedNetwork = [];
  try {
    await vite.listen();
    const browserTarget = `http://127.0.0.1:${vite.httpServer.address().port}`;
    const launchBrowser = async () => {
      const browserContext = await chromium.launchPersistentContext(profileDirectory, { headless: true });
      await browserContext.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.origin === browserTarget || url.origin === apiTarget) return route.continue();
        blockedNetwork.push(`${url.protocol}//${url.host}`);
        return route.abort();
      });
      return browserContext;
    };
    const openPage = async () => {
      const page = await context.newPage();
      await page.goto(`${browserTarget}/__resilient-sync-smoke`);
      await page.evaluate(async ({ state, apiTarget, syntheticKey, accountKey }) => {
        const journalModule = await import('/src/app/persistence/browserCheckpointJournal.ts');
        const transport = await import('/src/app/persistence/checkpointTransport.ts');
        const journal = journalModule.createBrowserCheckpointJournal({ databaseName: 'orbit-resilient-smoke' });
        const operational = structuredClone(state);
        operational.playerLedger.push({ id: 'ordinary-accounting', type: 'Buy-In', playerName: 'Synthetic New Player', amount: 10, timestamp: '2026-11-03T12:01:00.000Z', note: 'Single business effect' });
        operational.interests.push({ id: 'ordinary-check-in', profileId: 'synthetic-new-player', playerName: 'Synthetic New Player', gameId: 'synthetic-game', status: 'Arrived', timestamp: '2026-11-03T12:01:00.000Z' });
        operational.playerSessions.push({ id: 'ordinary-session', profileId: 'synthetic-new-player', playerName: 'Synthetic New Player', gameId: 'synthetic-game', startedAt: '2026-11-03T12:01:00.000Z' });
        let maximumEnvelopeBytes = 0;
        const requests = [];
        const request = async (route, body) => {
          if (body !== undefined) maximumEnvelopeBytes = Math.max(maximumEnvelopeBytes, new TextEncoder().encode(JSON.stringify(body)).byteLength);
          requests.push(route);
          try {
            const response = await fetch(`${apiTarget}${route}`, { method: body === undefined ? 'GET' : 'POST',
              headers: { 'content-type': 'application/json', 'x-orbit-api-key': syntheticKey }, body: body === undefined ? undefined : JSON.stringify(body) });
            return { ...await response.json(), httpStatus: response.status };
          } catch { return { ok: false, error: 'Synthetic interrupted connection' }; }
        };
        window.resilientSmoke = {
          async stage() {
            const input = { state: operational, mutationId: 'browser:synthetic-operation', expectedRevision: 1, previousState: state };
            const otherTabJournal = journalModule.createBrowserCheckpointJournal({ databaseName: 'orbit-resilient-smoke' });
            const [pending, raced] = await Promise.all([journal.store(input), otherTabJournal.store(input)]);
            return { sourceHash: pending.sourceHash, bytes: new TextEncoder().encode(JSON.stringify(pending.state)).byteLength,
              concurrentEnqueueMatched: pending.mutationId === raced.mutationId && pending.sourceHash === raced.sourceHash }; },
          async inspectStorage() {
            const db = await new Promise((resolve, reject) => { const opening = indexedDB.open('orbit-resilient-smoke', 1); opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error); });
            try {
              const read = (store, key) => new Promise((resolve, reject) => { const request = db.transaction(store, 'readonly').objectStore(store).get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
              const key = await read('keys', 'encryption');
              const reference = await transport.checkpointSha256(new TextEncoder().encode(accountKey));
              const encrypted = await read('pending', reference);
              const plain = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: encrypted.iv, additionalData: new TextEncoder().encode(reference) }, key, encrypted.ciphertext));
              return { extractable: key.extractable, encryptedBytes: encrypted.ciphertext.byteLength,
                restrictedFound: ['synthetic-smoke-pilot-secret', 'synthetic-smoke-login-salt', 'synthetic-smoke-login-verifier', 'synthetic-smoke-pin-salt', 'synthetic-smoke-pin-verifier'].some((value) => plain.includes(value)),
                operationalPresent: plain.includes('ordinary-accounting') };
            } finally { db.close(); }
          },
          async resume(interruptChunk = false, loseAcknowledgement = false) {
            const pending = await journal.load(state);
            if (!pending) return { missing: true };
            const cap = transport.parseCheckpointCapabilities(await request('/state/capabilities'));
            if (!cap) throw new Error('Compatible checkpoints were not advertised.');
            const before = performance.now();
            const identity = { accountKey: pending.accountKey, mutationId: pending.mutationId, expectedRevision: pending.expectedRevision };
            const result = await transport.uploadCheckpoint(pending.state, identity, cap, async (route, body) => {
              if (interruptChunk && route.endsWith('/chunks/3')) return { ok: false, error: 'Synthetic chunk interruption' };
              const response = await request(route, body);
              // Discard the committed response at the transport boundary. Raw
              // resets can be retried transparently by Chromium before restart.
              return loseAcknowledgement && route.endsWith('/finalize')
                ? { ok: false, error: 'Synthetic lost commit acknowledgement' } : response;
            });
            if (result.ok) await journal.acknowledge(state, pending.mutationId);
            return { result, durationMs: performance.now() - before, sourceHash: pending.sourceHash, maximumEnvelopeBytes,
              sentChunks: requests.filter((route) => /\/chunks\/\d+$/.test(route)).length,
              journalPending: Boolean(await journal.load(state)) };
          },
          async download() {
            const cap = transport.parseCheckpointCapabilities(await request('/state/capabilities'));
            const recovered = await transport.downloadCheckpoint(accountKey, cap, request);
            return { revision: recovered?.revision, equal: JSON.stringify(recovered?.state) === JSON.stringify(operational) };
          }
        };
      }, { state: initialState, apiTarget, syntheticKey, accountKey });
      return page;
    };

    context = await launchBrowser();
    let page = await openPage();
    const staged = await page.evaluate(() => window.resilientSmoke.stage());
    assert.equal(staged.concurrentEnqueueMatched, true);
    const encryption = await page.evaluate(() => window.resilientSmoke.inspectStorage());
    assert.equal(encryption.extractable, false);
    assert.equal(encryption.restrictedFound, false);
    assert.equal(encryption.operationalPresent, true);
    const interrupted = await page.evaluate(() => window.resilientSmoke.resume(true));
    assert.equal(interrupted.result.ok, false);
    assert.equal(interrupted.sentChunks, 3);
    assert.equal(interrupted.journalPending, true);
    assert.equal((await database.loadState(accountKey)).revision, 1);
    await context.close();
    context = await launchBrowser();
    page = await openPage();
    const lostAcknowledgement = await page.evaluate(() => window.resilientSmoke.resume(false, true));
    assert.equal(lostAcknowledgement.result.ok, false);
    assert.equal(lostAcknowledgement.journalPending, true);
    assert.equal(lostAcknowledgement.sourceHash, staged.sourceHash);
    assert.equal((await database.loadState(accountKey)).revision, 2);
    await page.close();
    page = await openPage();
    const replay = await page.evaluate(() => window.resilientSmoke.resume());
    assert.equal(replay.result.ok, true);
    assert.equal(replay.result.duplicate, true);
    assert.equal(replay.result.revision, 2);
    assert.equal(replay.journalPending, false);
    assert.equal(replay.sourceHash, staged.sourceHash);
    assert.equal(replay.sentChunks, 0);
    assert.ok(lostAcknowledgement.maximumEnvelopeBytes <= 400_000);
    assert.equal(finalizeRequests, 1);
    assert.equal(legacyWrites, 0);
    const canonical = await database.loadState(accountKey);
    assert.equal(canonical.revision, 2);
    assert.deepEqual(canonical.state.playerLedger.slice(0, 3000), initialState.playerLedger);
    assert.equal(canonical.state.playerLedger.filter((entry) => entry.id === 'ordinary-accounting').length, 1);
    assert.equal(canonical.state.interests.filter((entry) => entry.id === 'ordinary-check-in').length, 1);
    assert.equal(canonical.state.playerSessions.filter((entry) => entry.id === 'ordinary-session').length, 1);
    const downloaded = await page.evaluate(() => window.resilientSmoke.download());
    assert.deepEqual(downloaded, { revision: 2, equal: true });

    // Inject only the publication transport. No Firebase/provider call is made.
    const seedPublication = await outbox.claimNextPublication();
    assert.equal(seedPublication.revision, 1);
    assert.equal((await outbox.publishClaimed(seedPublication, { publishStateToFirebase: async () => ({ ok: true }) })).ok, true);
    const publication = await outbox.claimNextPublication();
    assert.equal(publication.revision, 2);
    const failure = await outbox.publishClaimed(publication, { publishStateToFirebase: async () => { throw new Error('Synthetic downstream outage'); } });
    assert.equal(failure.ok, false);
    assert.equal((await database.loadState(accountKey)).revision, 2);
    assert.equal((await database.getPublicationStatus(accountKey, 2)).status, 'failed');
    const retry = await outbox.claimNextPublication(new Date(Date.now() + 20 * 60 * 1000).toISOString());
    assert.equal((await outbox.publishClaimed(retry, { publishStateToFirebase: async () => ({ ok: true }) })).ok, true);
    assert.equal((await database.getPublicationStatus(accountKey, 2)).status, 'published');
    assert.equal((await database.loadState(accountKey)).revision, 2);
    assert.equal((await database.listPublicationOutbox({ accountKey })).length, 2);
    assert.deepEqual(blockedNetwork, []);
    console.log(JSON.stringify({ check: 'resilient-sync-smoke', passed: true, retainedSourceBytes: retainedBytes,
      checkpointSourceBytes: staged.bytes, encryptedJournalBytes: encryption.encryptedBytes,
      maximumRequestEnvelopeBytes: lostAcknowledgement.maximumEnvelopeBytes, retainedLedgerEntries: 3000,
      authoritativeRevision: 2, businessEffects: 1, legacyStateRequests: legacyWrites,
      interruptedChunksRetried: true, browserRestartRecovery: true, lostCommitAcknowledgementRecovered: true,
      injectedPublicationFailureRecovered: true, resumeUploadMs: Math.round(lostAcknowledgement.durationMs),
      duplicateAcknowledgementMs: Math.round(replay.durationMs), totalMs: Math.round(performance.now() - started) }));
  } finally {
    if (context) await context.close();
    await vite.close();
    await new Promise((resolve) => api.close(resolve));
    await database.closeDatabase();
    const resolvedProfile = path.resolve(profileDirectory);
    if (!resolvedProfile.startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(resolvedProfile).startsWith('orbit-resilient-sync-')) throw new Error('Unexpected smoke profile cleanup target.');
    await rm(resolvedProfile, { recursive: true, force: true });
  }
}
