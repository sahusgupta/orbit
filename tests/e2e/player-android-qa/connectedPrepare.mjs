import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { allowedSnapshotPath, assertInside, assertWritableSdkContainers, createQaEnvironment, createSnapshotMetroConfiguration, qaRoot, qaGradleHome, repositoryRoot, requiredTooling, syntheticMapsKey } from './prepare.mjs';
import { assertConnectedTarget, fixedConnectedTarget } from './connectedServer.mjs';

export const connectedRoot = path.join(repositoryRoot, 'out/player-android-connected-qa');
export const connectedProjectRoot = path.join(repositoryRoot, 'out/c');
export const connectedAppId = 'com.orbit.player.qa.connected';
const appRoot = path.join(connectedProjectRoot, 'player-app');
const installedModules = path.join(repositoryRoot, 'player-app/node_modules');
const javaHome = 'C:/Program Files/Android/Android Studio/jbr';
const roots = ['src', 'assets', 'scripts', 'plugins'];
const files = ['App.tsx', 'app.json', 'app.config.js', 'package.json', 'package-lock.json', 'metro.config.js', 'release-config.cjs', 'tsconfig.json'];
const sharedFiles = ['orbitMatchState.cjs', 'orbitMatchState.d.cts'];
const apiOrigin = `http://${fixedConnectedTarget.api.host}:${fixedConnectedTarget.api.port}`;

export function createConnectedBuildEnvironment(host = process.env) {
  const environment = createQaEnvironment(host, connectedRoot);
  return Object.assign(environment, {
    GRADLE_USER_HOME: qaGradleHome,
    EXPO_PUBLIC_ORBIT_API_URL: apiOrigin, ORBIT_API_URL: apiOrigin,
    // Legal/support providers remain unreachable and are outside this scenario.
    ORBIT_CONNECTED_QA_BUILD: '1'
  });
}

export function createConnectedFirebaseClient(original, target = fixedConnectedTarget) {
  assertConnectedTarget(target);
  const authImport = "import { getAuth, initializeAuth } from 'firebase/auth';";
  const firestoreImport = "import { getFirestore } from 'firebase/firestore';";
  const appMarker = 'export const firebaseApp =';
  const databaseMarker = 'export const db = getFirestore(firebaseApp);';
  if (!original.includes(authImport) || !original.includes(firestoreImport) || !original.includes(appMarker) || !original.includes(databaseMarker)
    || !original.trimEnd().endsWith('});')) throw new Error('Firebase initialization changed; review the connected fixture overlay.');
  const guard = `// QA COPY ONLY: validate every target before any Firebase initialization.\nif (firebaseConfig.projectId !== ${JSON.stringify(target.projectId)} || process.env.EXPO_PUBLIC_ORBIT_API_URL !== ${JSON.stringify(apiOrigin)} || process.env.EXPO_PUBLIC_APP_CHECK_ENABLED !== 'false') throw new Error('Connected QA target mismatch.');\n`;
  return original.replace(authImport, "import { connectAuthEmulator, getAuth, initializeAuth } from 'firebase/auth';")
    .replace(firestoreImport, "import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';")
    .replace(appMarker, `${guard}${appMarker}`)
    .replace(databaseMarker, `${databaseMarker}\nconnectFirestoreEmulator(db, ${JSON.stringify(target.firestore.host)}, ${target.firestore.port});`)
    + `\n// Must run immediately after initializePlayerAuth, before a caller can use Auth.\nconnectAuthEmulator(auth, ${JSON.stringify(`http://${target.auth.host}:${target.auth.port}`)}, { disableWarnings: true });\n`;
}

export function connectedNetworkSecurityXml() {
  return '<?xml version="1.0" encoding="utf-8"?>\n<network-security-config>\n  <base-config cleartextTrafficPermitted="false" />\n  <domain-config cleartextTrafficPermitted="true"><domain includeSubdomains="false">127.0.0.1</domain></domain-config>\n</network-security-config>\n';
}

export function connectedDiagnosticsSource() {
  return `// QA COPY ONLY: observe real persistence results; never replace an operation.\nimport { playerMatchPersistence } from '../data/firebase/playerMatchRepository';\nimport { decodeMatchOperation, decodeMatchState } from '../../../apps/api/src/shared/orbitMatchState.cjs';\nimport type { MatchState } from '../domain/orbitMatchTypes';\nconst ownerRole = (uid: string) => uid === 'native-owner-a' ? 'a' : uid === 'native-owner-b' ? 'b' : 'other';\nconst counts = (state: MatchState | null) => ({ revision: state?.revision ?? null, preferencesRevision: state?.preferencesRevision ?? null, savedCount: state?.decisions.filter(d => d.decision === 'saved').length ?? 0, passedCount: state?.decisions.filter(d => d.decision === 'passed').length ?? 0, variants: state?.preferences.variants ?? [], preferredTime: state?.preferences.preferredTime ?? 'any' });\nconst emit = (kind: string, uid: string, state: MatchState | null, extra: Record<string, unknown> = {}) => console.info('ORBIT_CONNECTED_QA ' + JSON.stringify({ kind, ownerRole: ownerRole(uid), ...counts(state), ...extra }));\nconst loadJournal = playerMatchPersistence.loadJournal;\nplayerMatchPersistence.loadJournal = async uid => { const result = await loadJournal(uid); const confirmed = result && typeof result === 'object' && 'confirmed' in result ? decodeMatchState(Reflect.get(result, 'confirmed')) : null; const rawPending = result && typeof result === 'object' && 'pending' in result ? Reflect.get(result, 'pending') : null; const pending = Array.isArray(rawPending) && rawPending.length <= 100 ? rawPending.map(decodeMatchOperation).filter(op => op !== null).map(op => ({ mutationId: op.mutationId, type: op.type })) : []; emit('journal-restored', uid, confirmed, { pending }); return result; };\nconst saveJournal = playerMatchPersistence.saveJournal;\nplayerMatchPersistence.saveJournal = async (uid, journal) => { await saveJournal(uid, journal); emit('journal-durable', uid, journal.confirmed, { pending: journal.pending.map(op => ({ mutationId: op.mutationId, type: op.type })) }); };\nconst fetchState = playerMatchPersistence.fetchState;\nplayerMatchPersistence.fetchState = async uid => { const state = await fetchState(uid); emit('http-state', uid, state); return state; };\nconst mutate = playerMatchPersistence.mutate;\nplayerMatchPersistence.mutate = async (uid, operation) => { const state = await mutate(uid, operation); emit('http-mutation', uid, state, { mutationId: operation.mutationId, operationType: operation.type }); return state; };\nconst subscribe = playerMatchPersistence.subscribe;\nlet listenerSequence = 0;\nplayerMatchPersistence.subscribe = (uid, onState, onError) => { const listener = ++listenerSequence; let accepted = 0; emit('listener-started', uid, null, { listener }); const dispose = subscribe(uid, state => { emit('listener-accepted', uid, state, { listener, accepted: ++accepted }); onState(state); }, onError); return () => { dispose(); emit('listener-stopped', uid, null, { listener }); }; };\n`;
}

function copyTree(source, target, prefix = '') {
  assertConnectedMutationTarget(target);
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (!allowedSnapshotPath(relative)) continue;
    if (entry.isSymbolicLink()) throw new Error(`Unexpected source link: ${relative}`);
    if (entry.isDirectory()) copyTree(path.join(source, entry.name), path.join(target, entry.name), relative);
    else if (entry.isFile()) fs.copyFileSync(path.join(source, entry.name), path.join(target, entry.name));
  }
}

function assertConnectedMutationTarget(target) {
  const parent = path.relative(connectedRoot, target);
  return parent && !parent.startsWith('..') && !path.isAbsolute(parent) ? assertInside(connectedRoot, target) : assertInside(connectedProjectRoot, target);
}

export function currentConnectedSourceFingerprint() {
  const hash = createHash('sha256'); let count = 0;
  const add = (name, absolute) => { hash.update(name); hash.update(fs.readFileSync(absolute)); count++; };
  const visit = (root, prefix) => {
    for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = `${prefix}/${entry.name}`;
      if (!allowedSnapshotPath(name)) continue;
      if (entry.isDirectory()) visit(path.join(root, entry.name), name);
      else if (entry.isFile()) add(name, path.join(root, entry.name));
    }
  };
  for (const name of files) add(name, path.join(repositoryRoot, 'player-app', name));
  for (const name of roots) visit(path.join(repositoryRoot, 'player-app', name), name);
  for (const name of sharedFiles) add(name, path.join(repositoryRoot, 'apps/api/src/shared', name));
  return { sha256: hash.digest('hex'), files: count };
}

export function fixtureInputFingerprint(root = appRoot) {
  const hash = createHash('sha256');
  const add = (name, absolute) => { hash.update(name); hash.update(fs.readFileSync(absolute)); };
  const visit = (directory, prefix) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = `${prefix}/${entry.name}`;
      if (name.split('/').some(part => ['build', '.gradle', '.kotlin', '.cxx', '.expo', 'node_modules', '.git'].includes(part)) || /\.(?:jks|keystore|p12|pfx|pem|key)$/i.test(name)) continue;
      if (entry.isSymbolicLink()) throw new Error('Fixture authored inputs must not contain links.');
      if (entry.isDirectory()) visit(path.join(directory, entry.name), name);
      else if (entry.isFile()) add(name, path.join(directory, entry.name));
    }
  };
  // Include every copied authored file, synthetic override, public native build input and shared reducer.
  for (const name of [...files, 'google-services.json']) if (fs.existsSync(path.join(root, name))) add(name, path.join(root, name));
  for (const name of [...roots, 'android']) visit(path.join(root, name), name);
  for (const name of sharedFiles) {
    const absolute = path.join(root, '../apps/api/src/shared', name);
    if (fs.existsSync(absolute)) add(`shared/${name}`, absolute);
  }
  hash.update(JSON.stringify(createConnectedBuildEnvironment({})));
  return hash.digest('hex');
}

export function assertFrozenFixtureInputs(recorded, root = appRoot) {
  if (recorded?.sha256 !== fixtureInputFingerprint(root)) throw new Error('Copied fixture inputs changed since prebuild; review and freeze them before compiling.');
}

function refreshCopiedSource(nativeNames) {
  const selected = currentConnectedSourceFingerprint();
  for (const name of roots) {
    const destination = path.join(appRoot, name);
    if (fs.existsSync(destination)) {
      if (fs.lstatSync(destination).isSymbolicLink()) throw new Error('Authored refresh root must be ordinary.');
      const resolved = fs.realpathSync(destination);
      assertInside(fs.realpathSync(connectedProjectRoot), resolved);
      fs.rmSync(resolved, { recursive: true, force: true });
    }
    copyTree(path.join(repositoryRoot, 'player-app', name), destination, name);
  }
  for (const name of files) fs.copyFileSync(path.join(repositoryRoot, 'player-app', name), path.join(appRoot, name));
  const shared = path.join(connectedProjectRoot, 'apps/api/src/shared');
  for (const name of sharedFiles) fs.copyFileSync(path.join(repositoryRoot, 'apps/api/src/shared', name), path.join(shared, name));
  overlay(nativeNames);
  if (selected.sha256 !== currentConnectedSourceFingerprint().sha256) throw new Error('Selected source changed during connected refresh.');
  return selected;
}

function dependencies() {
  const native = JSON.parse(fs.readFileSync(path.join(qaRoot, 'snapshot.json'), 'utf8')).dependencies.copiedNativePackages;
  const nativeSet = new Set(native); let linked = 0;
  const root = path.join(appRoot, 'node_modules'); fs.mkdirSync(root, { recursive: true });
  function add(name) {
    const target = assertInside(connectedProjectRoot, path.join(root, name)); fs.mkdirSync(path.dirname(target), { recursive: true });
    if (nativeSet.has(name)) copyTree(path.join(installedModules, name), target);
    else { fs.symlinkSync(path.join(installedModules, name), target, 'junction'); linked++; }
  }
  for (const entry of fs.readdirSync(installedModules, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (entry.name.startsWith('@')) { for (const child of fs.readdirSync(path.join(installedModules, entry.name), { withFileTypes: true })) if (child.isDirectory()) add(`${entry.name}/${child.name}`); }
    else add(entry.name);
  }
  return { native, linked };
}

function prepareSdk() {
  const root = path.join(connectedRoot, 'sdk'); fs.mkdirSync(root, { recursive: true });
  for (const name of ['platforms', 'build-tools', 'ndk', 'cmake']) {
    const target = path.join(root, name); fs.mkdirSync(target, { recursive: true });
    for (const version of fs.readdirSync(path.join(qaRoot, 'sdk', name))) fs.symlinkSync(path.join(qaRoot, 'sdk', name, version), path.join(target, version), 'junction');
  }
  for (const name of ['platform-tools', 'cmdline-tools', 'emulator', 'system-images']) fs.symlinkSync(path.join(qaRoot, 'sdk', name), path.join(root, name), 'junction');
  copyTree(path.join(qaRoot, 'sdk/licenses'), path.join(root, 'licenses'));
  assertWritableSdkContainers(root);
}

function overlay(nativeNames) {
  const manifestPath = path.join(appRoot, 'app.json'); const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.expo.name = 'Orbit Player Connected QA'; manifest.expo.slug = 'orbit-player-connected-qa';
  manifest.expo.android.package = connectedAppId; manifest.expo.ios.bundleIdentifier = connectedAppId;
  manifest.expo.updates = { enabled: false }; delete manifest.expo.owner; delete manifest.expo.extra?.eas;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(appRoot, 'google-services.json'), JSON.stringify({ project_info: { project_number: '123456789012', project_id: fixedConnectedTarget.projectId, storage_bucket: `${fixedConnectedTarget.projectId}.invalid` }, client: [{ client_info: { mobilesdk_app_id: '1:123456789012:android:0000000000000000000000', android_client_info: { package_name: connectedAppId } }, oauth_client: [], api_key: [{ current_key: syntheticMapsKey }] }], configuration_version: '1' }, null, 2));
  fs.writeFileSync(path.join(appRoot, 'src/data/firebaseConfig.ts'), `export const firebaseConfig = { apiKey: ${JSON.stringify(syntheticMapsKey)}, authDomain: '${fixedConnectedTarget.projectId}.invalid', projectId: '${fixedConnectedTarget.projectId}', storageBucket: '${fixedConnectedTarget.projectId}.invalid', messagingSenderId: '123456789012', appId: '1:123456789012:web:0000000000000000000000' };\n`);
  fs.writeFileSync(path.join(appRoot, 'src/data/firebase/firebaseClient.ts'), createConnectedFirebaseClient(fs.readFileSync(path.join(repositoryRoot, 'player-app/src/data/firebase/firebaseClient.ts'), 'utf8')));
  fs.writeFileSync(path.join(appRoot, 'src/app/connectedQaDiagnostics.ts'), connectedDiagnosticsSource());
  const originalApp = fs.readFileSync(path.join(repositoryRoot, 'player-app/App.tsx'), 'utf8');
  fs.writeFileSync(path.join(appRoot, 'App.tsx'), `import './src/app/connectedQaDiagnostics';\n${originalApp}`);
  fs.writeFileSync(path.join(appRoot, 'metro.config.js'), createSnapshotMetroConfiguration(fs.readFileSync(path.join(repositoryRoot, 'player-app/metro.config.js'), 'utf8'), nativeNames, installedModules));
}

async function run(executable, args, name, cwd = appRoot) {
  const stream = fs.createWriteStream(path.join(connectedRoot, `${name}.log`), { flags: 'a' });
  stream.write(`\n--- ${name} ${new Date().toISOString()} ---\n`);
  const child = spawn(executable, args, { cwd, env: createConnectedBuildEnvironment(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const output of [child.stdout, child.stderr]) output.on('data', chunk => { stream.write(chunk); process.stdout.write(chunk); });
  await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => { stream.end(); code === 0 ? resolve() : reject(new Error(`${name} failed (${code}).`)); }); });
}

export async function main(command = 'prepare') {
  if (process.platform !== 'win32') throw new Error('This fixture uses the reviewed Windows toolchain.');
  assertConnectedTarget(fixedConnectedTarget); assertInside(path.join(repositoryRoot, 'out'), connectedRoot);
  assertInside(path.join(repositoryRoot, 'out'), connectedProjectRoot);
  for (const name of ['android-user', 'emulator-home', 'user-home', 'expo-home', 'tmp']) fs.mkdirSync(path.join(connectedRoot, name), { recursive: true });
  if (command === 'prepare') {
    if (fs.existsSync(appRoot)) throw new Error('Connected snapshot already exists; refuse replacement.');
    const selectedSource = currentConnectedSourceFingerprint();
    fs.mkdirSync(appRoot, { recursive: true });
    for (const name of roots) copyTree(path.join(repositoryRoot, 'player-app', name), path.join(appRoot, name), name);
    for (const name of files) fs.copyFileSync(path.join(repositoryRoot, 'player-app', name), path.join(appRoot, name));
    const shared = path.join(connectedProjectRoot, 'apps/api/src/shared'); fs.mkdirSync(shared, { recursive: true });
    for (const name of sharedFiles) fs.copyFileSync(path.join(repositoryRoot, 'apps/api/src/shared', name), path.join(shared, name));
    const dependencySummary = dependencies(); overlay(dependencySummary.native); prepareSdk();
    if (selectedSource.sha256 !== currentConnectedSourceFingerprint().sha256) throw new Error('Selected production source changed while creating the connected snapshot.');
    fs.writeFileSync(path.join(connectedRoot, 'source-fingerprint.json'), JSON.stringify(selectedSource, null, 2));
    fs.writeFileSync(path.join(connectedRoot, 'snapshot.json'), JSON.stringify({ appId: connectedAppId, target: fixedConnectedTarget, dependencies: dependencySummary, source: selectedSource, fixture: fixtureInputFingerprint(), limitations: ['Local real SDK Auth + emulator only; not a provider or production App Check proof', 'Cross-client sync; not two physical devices'] }, null, 2));
    console.log(JSON.stringify({ appId: connectedAppId, source: selectedSource, nativePackages: dependencySummary.native.length }));
  } else if (command === 'refresh') {
    const previous = JSON.parse(fs.readFileSync(path.join(connectedRoot, 'fixture-fingerprint.json'), 'utf8'));
    assertFrozenFixtureInputs(previous);
    const metadata = JSON.parse(fs.readFileSync(path.join(connectedRoot, 'snapshot.json'), 'utf8'));
    const source = refreshCopiedSource(metadata.dependencies.native);
    const fixture = { sha256: fixtureInputFingerprint() };
    fs.writeFileSync(path.join(connectedRoot, 'source-fingerprint.json'), JSON.stringify(source, null, 2));
    fs.writeFileSync(path.join(connectedRoot, 'fixture-fingerprint.json'), JSON.stringify(fixture));
    metadata.source = source; metadata.fixture = fixture.sha256; metadata.projectRoot = connectedProjectRoot;
    fs.writeFileSync(path.join(connectedRoot, 'snapshot.json'), JSON.stringify(metadata, null, 2));
    console.log(JSON.stringify({ source, fixture, preservedNativeConfiguration: true }));
  } else if (command === 'prebuild') {
    assertWritableSdkContainers(path.join(connectedRoot, 'sdk'));
    await run(process.execPath, [path.join(appRoot, 'node_modules/expo/bin/cli'), 'prebuild', '--platform', 'android', '--no-install', '--skip-dependency-update', 'react-native,react'], 'prebuild');
    fs.writeFileSync(path.join(appRoot, 'android/local.properties'), `sdk.dir=${path.join(connectedRoot, 'sdk').replaceAll('\\', '/')}\n`);
    fs.appendFileSync(path.join(appRoot, 'android/gradle.properties'), `\nreactNativeArchitectures=x86_64\nandroid.cmakeVersion=${requiredTooling.cmake}\norg.gradle.workers.max=2\n`);
    const manifestPath = path.join(appRoot, 'android/app/src/main/AndroidManifest.xml');
    const xml = fs.readFileSync(manifestPath, 'utf8'); if (xml.includes('android:networkSecurityConfig=')) throw new Error('Review existing network policy before overlay.');
    fs.writeFileSync(manifestPath, xml.replace('<application ', '<application android:networkSecurityConfig="@xml/connected_qa_network_security" '));
    const resourcePath = path.join(appRoot, 'android/app/src/main/res/xml/connected_qa_network_security.xml'); fs.mkdirSync(path.dirname(resourcePath), { recursive: true }); fs.writeFileSync(resourcePath, connectedNetworkSecurityXml());
    const keyPath = assertInside(connectedProjectRoot, path.join(appRoot, 'android/app/debug.keystore')); if (fs.existsSync(keyPath)) fs.unlinkSync(keyPath);
    await run(path.join(javaHome, 'bin/keytool.exe'), ['-genkeypair', '-keystore', keyPath, '-storepass', 'android', '-keypass', 'android', '-alias', 'androiddebugkey', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '30', '-dname', 'CN=Orbit Connected QA,OU=Local Test,O=Fictional QA,L=Test,ST=Test,C=US'], 'fixture-test-signing');
    fs.writeFileSync(path.join(connectedRoot, 'fixture-fingerprint.json'), JSON.stringify({ sha256: fixtureInputFingerprint() }));
  } else if (command === 'build') {
    assertWritableSdkContainers(path.join(connectedRoot, 'sdk'));
    const recorded = JSON.parse(fs.readFileSync(path.join(connectedRoot, 'source-fingerprint.json'), 'utf8'));
    const fixture = JSON.parse(fs.readFileSync(path.join(connectedRoot, 'fixture-fingerprint.json'), 'utf8'));
    if (recorded.sha256 !== currentConnectedSourceFingerprint().sha256) throw new Error('Production source changed since connected snapshot.');
    assertFrozenFixtureInputs(fixture);
    await run(createConnectedBuildEnvironment().ComSpec || 'C:/Windows/System32/cmd.exe', ['/d', '/c', path.join(appRoot, 'android/gradlew.bat'), 'assembleRelease', '--no-daemon', '--console=plain', '--max-workers=2', '-PreactNativeArchitectures=x86_64'], 'assemble-release', path.join(appRoot, 'android'));
    if (recorded.sha256 !== currentConnectedSourceFingerprint().sha256) throw new Error('Production source changed during compile.');
    assertFrozenFixtureInputs(fixture);
    const apk = path.join(appRoot, 'android/app/build/outputs/apk/release/app-release.apk');
    const artifact = { apk, appId: connectedAppId, source: recorded, fixture, sha256: createHash('sha256').update(fs.readFileSync(apk)).digest('hex'), bytes: fs.statSync(apk).size };
    fs.writeFileSync(path.join(connectedRoot, 'apk-artifact.json'), JSON.stringify(artifact, null, 2)); console.log(JSON.stringify(artifact));
  } else throw new Error('Unknown connected preparation command.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
