import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import os from 'node:os';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { assertInside, repositoryRoot, qaGradleHome } from './prepare.mjs';
import { fixedConnectedTarget } from './connectedServer.mjs';
import { connectedAppId, connectedRoot, connectedProjectRoot, createConnectedBuildEnvironment, createConnectedFirebaseClient, connectedNetworkSecurityXml, connectedDiagnosticsSource, fixtureInputFingerprint, assertFrozenFixtureInputs } from './connectedPrepare.mjs';

describe('native connected fixture bootstrap', () => {
  it('keeps the connected identity and output separate and excludes host credentials', () => {
    const env = createConnectedBuildEnvironment({ Path: 'public tools', GOOGLE_APPLICATION_CREDENTIALS: 'secret', FIREBASE_TOKEN: 'secret', EXPO_PUBLIC_ORBIT_API_URL: 'https://live.invalid', EXPO_PUBLIC_APP_CHECK_ENABLED: 'true' });
    expect(connectedAppId).toBe('com.orbit.player.qa.connected');
    expect(connectedRoot).toBe(path.join(repositoryRoot, 'out/player-android-connected-qa'));
    expect(connectedProjectRoot).toBe(path.join(repositoryRoot, 'out/c'));
    expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined(); expect(env.FIREBASE_TOKEN).toBeUndefined();
    expect(env.EXPO_PUBLIC_ORBIT_API_URL).toBe('http://127.0.0.1:14639'); expect(env.EXPO_PUBLIC_APP_CHECK_ENABLED).toBe('false');
    expect(env.EXPO_NO_DOTENV).toBe('1'); expect(env.GRADLE_USER_HOME).toBe(qaGradleHome);
    expect(env.ANDROID_HOME).toBe(path.join(connectedRoot, 'sdk'));
  });
  it('validates all targets before initialization and connects real SDKs before caller operations', () => {
    const original = fs.readFileSync(path.join(repositoryRoot, 'player-app/src/data/firebase/firebaseClient.ts'), 'utf8');
    const copy = createConnectedFirebaseClient(original);
    expect(copy.indexOf('Connected QA target mismatch')).toBeLessThan(copy.indexOf('export const firebaseApp'));
    expect(copy).toContain('connectFirestoreEmulator(db, "127.0.0.1", 18085)');
    expect(copy).toContain('connectAuthEmulator(auth, "http://127.0.0.1:19099", { disableWarnings: true })');
    expect(copy.indexOf('connectAuthEmulator(auth')).toBeGreaterThan(copy.indexOf('export const auth = initializePlayerAuth'));
    expect(copy).not.toContain('mockUserToken'); expect(copy).not.toContain('signInWithCustomToken');
    expect(() => createConnectedFirebaseClient(original, { ...fixedConnectedTarget, projectId: 'live-project' })).toThrow(/exact demo/);
    expect(() => createConnectedFirebaseClient(original.replace('export const db =', 'const changedDb ='))).toThrow(/review/);
  });
  it('allows cleartext only for the explicitly reversed loopback host', () => {
    const xml = connectedNetworkSecurityXml();
    expect(xml).toContain('<base-config cleartextTrafficPermitted="false"');
    expect(xml).toContain('<domain includeSubdomains="false">127.0.0.1</domain>');
    expect(xml).not.toContain('10.0.2.2'); expect(xml).not.toContain('trust-anchors');
  });
  it('observes actual completed durable operations and accepted listeners without sensitive payloads', () => {
    const source = connectedDiagnosticsSource();
    expect(source).toContain("await saveJournal(uid, journal); emit('journal-durable'");
    expect(source).toContain("const state = await mutate(uid, operation); emit('http-mutation'");
    expect(source).toContain('subscribe(uid, state =>'); expect(source).toContain('onState(state)'); expect(source).toContain('dispose()');
    expect(source).not.toMatch(/getIdToken|password|email|latitude|longitude|console\.log\(journal|JSON\.stringify\(state/);
    expect(source).toContain('ownerRole: ownerRole(uid)');
  });
  it('returns null, valid and malformed stored values unchanged without an observation exception', async () => {
    const shared = createRequire(import.meta.url)('../../../apps/api/src/shared/orbitMatchState.cjs');
    const confirmed = shared.createMatchState();
    const valid = { uid: 'native-owner-a', confirmed, pending: [{ mutationId: 'qa-pending-event-0001', type: 'event', event: { kind: 'opened' } }] };
    const malformed = [{ pending: 'invalid', confirmed: {} }, { pending: [null, {}], confirmed: null }, 4, 'untrusted', null];
    for (const value of [valid, ...malformed]) {
      const observations = [];
      const port = { loadJournal: async () => value, saveJournal: async () => undefined, fetchState: async () => confirmed, mutate: async () => confirmed, subscribe: () => () => undefined };
      const output = ts.transpileModule(connectedDiagnosticsSource(), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
      vm.runInNewContext(output, { exports: {}, require: name => name.includes('playerMatchRepository') ? { playerMatchPersistence: port } : shared, console: { info: observation => observations.push(JSON.parse(observation.replace('ORBIT_CONNECTED_QA ', ''))) } });
      await expect(port.loadJournal('native-owner-a')).resolves.toBe(value);
      expect(observations[0].ownerRole).toBe('a');
      expect(observations[0].pending).toEqual(value === valid ? [{ mutationId: 'qa-pending-event-0001', type: 'event' }] : []);
      expect(JSON.stringify(observations)).not.toContain('native-owner-a');
    }
  });
  it('preserves durable failure and does not emit a successful write or alter listener cleanup', async () => {
    const shared = createRequire(import.meta.url)('../../../apps/api/src/shared/orbitMatchState.cjs');
    const observations = []; const confirmed = shared.createMatchState(); let callback; let stopped = 0;
    const failure = new Error('secure storage failed');
    const port = { loadJournal: async () => null, saveJournal: async () => { throw failure; }, fetchState: async () => confirmed, mutate: async () => confirmed, subscribe: (_uid, onState) => { callback = onState; return () => { stopped++; }; } };
    const output = ts.transpileModule(connectedDiagnosticsSource(), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(output, { exports: {}, require: name => name.includes('playerMatchRepository') ? { playerMatchPersistence: port } : shared, console: { info: observation => observations.push(observation) } });
    await expect(port.saveJournal('native-owner-a', { confirmed, pending: [] })).rejects.toBe(failure);
    expect(observations).toEqual([]);
    const accepted = []; const dispose = port.subscribe('native-owner-a', state => accepted.push(state), () => undefined); callback(confirmed); dispose();
    expect(accepted).toEqual([confirmed]); expect(stopped).toBe(1);
    expect(observations.some(value => value.includes('listener-accepted'))).toBe(true);
  });
  it('fingerprints copied domain, shared reducer and native inputs while ignoring generated outputs and fixture keys', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-connected-fingerprint-'));
    const app = path.join(root, 'player-app');
    const write = (name, content) => { const target = path.join(app, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); };
    try {
      write('src/application/playerMatchController.ts', 'original'); write('../apps/api/src/shared/orbitMatchState.cjs', 'reducer'); write('android/app/build.gradle', 'gradle'); write('android/app/src/main/AndroidManifest.xml', 'manifest');
      const original = fixtureInputFingerprint(app);
      expect(() => assertFrozenFixtureInputs({ sha256: original }, app)).not.toThrow();
      write('android/app/build/generated/output', 'cache'); write('android/app/.cxx/native/cache', 'cache'); write('android/.kotlin/sessions/compiler.salive', 'generated compiler session'); write('android/app/debug.keystore', 'synthetic test key'); write('node_modules/library/index.js', 'dependency');
      expect(fixtureInputFingerprint(app)).toBe(original);
      for (const name of ['src/application/playerMatchController.ts', '../apps/api/src/shared/orbitMatchState.cjs', 'android/app/build.gradle', 'android/app/src/main/AndroidManifest.xml']) {
        const before = fixtureInputFingerprint(app); write(name, 'changed'); expect(fixtureInputFingerprint(app), name).not.toBe(before);
        expect(() => assertFrozenFixtureInputs({ sha256: before }, app)).toThrow(/Copied fixture inputs changed/);
      }
    } finally { assertInside(os.tmpdir(), fs.realpathSync(root)); fs.rmSync(root, { recursive: true, force: true }); }
  });
});
