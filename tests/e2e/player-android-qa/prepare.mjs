import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const qaRoot = path.join(repositoryRoot, 'out', 'player-android-qa');
export const qaGradleHome = path.join(repositoryRoot, 'out', 'g');
export const qaAppId = 'com.orbit.player.qa';
export const syntheticMapsKey = 'AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
export const requiredTooling = Object.freeze({ ndk: '27.1.12297006', cmake: '3.30.5', platform: 'android-36', buildTools: '36.0.0' });
const sourceSdk = 'C:/Users/herob/AppData/Local/Android/Sdk';
const javaHome = 'C:/Program Files/Android/Android Studio/jbr';
const projectRoot = path.join(qaRoot, 'project');
const appRoot = path.join(projectRoot, 'player-app');
const sdkRoot = path.join(qaRoot, 'sdk');
const installedModules = path.join(repositoryRoot, 'player-app', 'node_modules');
const sourceRoots = ['src', 'assets', 'scripts', 'plugins'];
const sourceFiles = ['App.tsx', 'app.json', 'app.config.js', 'package.json', 'package-lock.json', 'metro.config.js', 'release-config.cjs', 'tsconfig.json'];

export function assertInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error('QA mutation target must be strictly inside its isolated root.');
  }
  return target;
}

export function allowedSnapshotPath(relative) {
  const normalized = relative.replaceAll('\\', '/');
  const parts = normalized.split('/');
  if (parts.some(part => part.startsWith('.env') || ['.git', '.gradle', '.cxx', '.expo', '.cache'].includes(part))) return false;
  if (/(?:^|\/)(?:google-services\.json|GoogleService-Info\.plist|firebaseConfig\.ts)$/.test(normalized)) return false;
  if (/\.(?:jks|keystore|p12|pfx|pem|key)$/i.test(normalized)) return false;
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(normalized)) return false;
  // JavaScript distribution folders called build are required; omit only native outputs.
  if (/(?:^|\/)(?:android|ReactAndroid|ReactCommon)\/(?:build|\.cxx)(?:\/|$)/.test(normalized)) return false;
  return true;
}

export function createQaEnvironment(host = process.env, root = qaRoot) {
  const environment = {};
  for (const key of ['Path', 'PATH', 'SystemRoot', 'SystemDrive', 'ComSpec', 'PATHEXT', 'OS', 'WINDIR', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS']) {
    if (typeof host[key] === 'string') environment[key] = host[key];
  }
  const userHome = path.join(root, 'user-home');
  Object.assign(environment, {
    JAVA_HOME: javaHome, JAVA_TOOL_OPTIONS: `-Duser.home=${userHome}`, CMAKE_VERSION: requiredTooling.cmake,
    ANDROID_HOME: path.join(root, 'sdk'), ANDROID_SDK_ROOT: path.join(root, 'sdk'),
    GRADLE_USER_HOME: root === qaRoot ? qaGradleHome : path.join(root, 'gradle-home'),
    ANDROID_USER_HOME: path.join(root, 'android-user'), ANDROID_AVD_HOME: path.join(root, 'avd'),
    ANDROID_EMULATOR_HOME: path.join(root, 'emulator-home'), ANDROID_ADB_SERVER_PORT: '5039',
    USERPROFILE: userHome, APPDATA: path.join(userHome, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(userHome, 'AppData', 'Local'),
    TEMP: path.join(root, 'tmp'), TMP: path.join(root, 'tmp'), __UNSAFE_EXPO_HOME_DIRECTORY: path.join(root, 'expo-home'),
    EXPO_NO_DOTENV: '1', EXPO_NO_TELEMETRY: '1', EXPO_OFFLINE: '1', CI: '1', ORBIT_APP_ENV: 'development',
    EXPO_PUBLIC_ORBIT_API_URL: 'http://127.0.0.1:9', EXPO_PUBLIC_PRIVACY_POLICY_URL: 'http://127.0.0.1:9/privacy',
    EXPO_PUBLIC_SUPPORT_URL: 'http://127.0.0.1:9/support', EXPO_PUBLIC_TERMS_OF_SERVICE_URL: 'http://127.0.0.1:9/terms',
    EXPO_PUBLIC_APP_CHECK_ENABLED: 'false', EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY: syntheticMapsKey,
    VITE_ENABLE_FIREBASE_SYNC: 'false', ORBIT_API_URL: 'http://127.0.0.1:9'
  });
  return environment;
}

export function createSyntheticGoogleConfig() {
  return {
    project_info: { project_number: '123456789012', project_id: 'orbit-native-qa-invalid', storage_bucket: 'orbit-native-qa-invalid.invalid' },
    client: [{ client_info: { mobilesdk_app_id: '1:123456789012:android:0000000000000000000000', android_client_info: { package_name: qaAppId } }, oauth_client: [], api_key: [{ current_key: 'AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }], services: { appinvite_service: { other_platform_oauth_client: [] } } }],
    configuration_version: '1'
  };
}

function copyAllowedTree(from, to, relative = '') {
  assertInside(qaRoot, to);
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    if (!allowedSnapshotPath(childRelative)) continue;
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyAllowedTree(source, target, childRelative);
    else if (entry.isFile()) fs.copyFileSync(source, target);
    else throw new Error(`Unexpected source link: ${childRelative}`);
  }
}

function nativePackage(packagePath, packageName) {
  return packageName === 'react-native' || packageName === '@react-native/gradle-plugin'
    || fs.existsSync(path.join(packagePath, 'android'))
    || fs.existsSync(path.join(packagePath, 'expo-module-gradle-plugin'));
}

function nativePackageNames() {
  const names = [];
  for (const entry of fs.readdirSync(installedModules, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (entry.name.startsWith('@')) {
      for (const child of fs.readdirSync(path.join(installedModules, entry.name), { withFileTypes: true })) {
        const name = `${entry.name}/${child.name}`;
        if (child.isDirectory() && nativePackage(path.join(installedModules, name), name)) names.push(name);
      }
    } else if (nativePackage(path.join(installedModules, entry.name), entry.name)) names.push(entry.name);
  }
  return names;
}

export function createSnapshotMetroConfiguration(original, nativeNames, modulesRoot) {
  return `${original}\n// QA overlay only: keep native JS singletons in the copied project.\nmodule.exports.watchFolders.push(${JSON.stringify(modulesRoot)});\nconst qaNativePackages = new Set(${JSON.stringify([...nativeNames, 'react'])});\nconst qaResolveRequest = module.exports.resolver.resolveRequest;\nmodule.exports.resolver.resolveRequest = (context, moduleName, platform) => {\n  const parts = moduleName.split('/');\n  const packageName = moduleName.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];\n  const sourceContext = qaNativePackages.has(packageName) ? { ...context, originModulePath: path.join(__dirname, 'App.tsx') } : context;\n  return qaResolveRequest(sourceContext, moduleName, platform);\n};\n`;
}

function prepareDependencyOverlay() {
  const targetRoot = path.join(appRoot, 'node_modules');
  fs.mkdirSync(targetRoot, { recursive: true });
  const copied = [];
  const linked = [];
  function addPackage(name, source, target) {
    if (nativePackage(source, name)) {
      copyAllowedTree(source, target);
      copied.push(name);
    } else {
      fs.symlinkSync(source, assertInside(qaRoot, target), 'junction');
      linked.push(name);
    }
  }
  for (const entry of fs.readdirSync(installedModules, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const source = path.join(installedModules, entry.name);
    const target = path.join(targetRoot, entry.name);
    if (entry.name.startsWith('@')) {
      fs.mkdirSync(target, { recursive: true });
      for (const scoped of fs.readdirSync(source, { withFileTypes: true })) {
        if (scoped.isDirectory()) addPackage(`${entry.name}/${scoped.name}`, path.join(source, scoped.name), path.join(target, scoped.name));
      }
    } else addPackage(entry.name, source, target);
  }
  return { copiedNativePackages: copied, linkedJavaScriptPackages: linked.length };
}

function writeSyntheticConfiguration() {
  const manifest = JSON.parse(fs.readFileSync(path.join(appRoot, 'app.json'), 'utf8'));
  manifest.expo.name = 'Orbit Player QA';
  manifest.expo.slug = 'orbit-player-qa';
  manifest.expo.android.package = qaAppId;
  manifest.expo.ios.bundleIdentifier = qaAppId;
  manifest.expo.updates = { enabled: false };
  delete manifest.expo.owner;
  delete manifest.expo.extra?.eas;
  fs.writeFileSync(path.join(appRoot, 'app.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(appRoot, 'google-services.json'), `${JSON.stringify(createSyntheticGoogleConfig(), null, 2)}\n`);
  // Never read or copy the real Firebase configuration file.
  fs.writeFileSync(path.join(appRoot, 'src/data/firebaseConfig.ts'), "export const firebaseConfig = { apiKey: 'AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', authDomain: 'orbit-native-qa-invalid.invalid', projectId: 'orbit-native-qa-invalid', storageBucket: 'orbit-native-qa-invalid.invalid', messagingSenderId: '123456789012', appId: '1:123456789012:web:0000000000000000000000' };\n");
  const metroPath = path.join(appRoot, 'metro.config.js');
  const metro = fs.readFileSync(path.join(repositoryRoot, 'player-app/metro.config.js'), 'utf8');
  fs.writeFileSync(metroPath, createSnapshotMetroConfiguration(metro, nativePackageNames(), installedModules));
}

function sourceFingerprint() {
  const hash = createHash('sha256');
  let files = 0;
  function visit(directory, prefix) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = `${prefix}/${entry.name}`;
      if (!allowedSnapshotPath(relative)) continue;
      if (entry.isDirectory()) visit(path.join(directory, entry.name), relative);
      else if (entry.isFile()) { hash.update(relative); hash.update(fs.readFileSync(path.join(directory, entry.name))); files++; }
    }
  }
  for (const name of sourceFiles) { hash.update(name); hash.update(fs.readFileSync(path.join(repositoryRoot, 'player-app', name))); files++; }
  for (const name of sourceRoots) visit(path.join(repositoryRoot, 'player-app', name), name);
  for (const name of ['orbitMatchState.cjs', 'orbitMatchState.d.cts']) {
    hash.update(name); hash.update(fs.readFileSync(path.join(repositoryRoot, 'apps/api/src/shared', name))); files++;
  }
  return { sha256: hash.digest('hex'), files };
}

function refreshSource() {
  const selected = sourceFingerprint();
  for (const name of sourceRoots) copyAllowedTree(path.join(repositoryRoot, 'player-app', name), path.join(appRoot, name), name);
  for (const name of sourceFiles) fs.copyFileSync(path.join(repositoryRoot, 'player-app', name), assertInside(qaRoot, path.join(appRoot, name)));
  const shared = path.join(projectRoot, 'apps/api/src/shared');
  fs.mkdirSync(shared, { recursive: true });
  for (const name of ['orbitMatchState.cjs', 'orbitMatchState.d.cts']) fs.copyFileSync(path.join(repositoryRoot, 'apps/api/src/shared', name), path.join(shared, name));
  writeSyntheticConfiguration();
  const fingerprint = sourceFingerprint();
  if (selected.sha256 !== fingerprint.sha256) throw new Error('Source changed while refreshing the native QA snapshot.');
  fs.writeFileSync(path.join(qaRoot, 'source-fingerprint.json'), `${JSON.stringify(fingerprint, null, 2)}\n`);
  return fingerprint;
}

function prepareSdkOverlay() {
  fs.mkdirSync(sdkRoot, { recursive: true });
  for (const name of ['platforms', 'build-tools', 'platform-tools', 'cmdline-tools', 'emulator', 'system-images', 'cmake']) {
    const target = path.join(sdkRoot, name);
    if (['platforms', 'build-tools', 'cmake'].includes(name)) {
      fs.mkdirSync(target, { recursive: true });
      for (const version of fs.readdirSync(path.join(sourceSdk, name))) {
        const destination = path.join(target, version);
        if (!fs.existsSync(destination)) fs.symlinkSync(path.join(sourceSdk, name, version), destination, 'junction');
      }
    } else if (!fs.existsSync(target)) fs.symlinkSync(path.join(sourceSdk, name), target, 'junction');
  }
  fs.mkdirSync(path.join(sdkRoot, 'ndk'), { recursive: true });
  copyAllowedTree(path.join(sourceSdk, 'licenses'), path.join(sdkRoot, 'licenses'));
}

export function assertWritableSdkContainers(root, inspect = fs.lstatSync) {
  for (const name of ['platforms', 'build-tools', 'ndk', 'cmake']) {
    const target = path.join(root, name);
    const stat = inspect(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`SDK install container must be an isolated real directory: ${name}`);
  }
}

async function run(executable, args, name, { cwd = appRoot, stdin } = {}) {
  const logPath = path.join(qaRoot, `${name}.log`);
  const log = fs.createWriteStream(logPath, { flags: 'a' });
  log.write(`\n--- ${name} attempt ${new Date().toISOString()} ---\n`);
  console.log(`${name}: ${logPath}`);
  const child = spawn(executable, args, { cwd, env: createQaEnvironment(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log.write(chunk); process.stdout.write(chunk); });
  child.stdin.end(stdin);
  await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(`${name} failed (${code}); see ${logPath}`))); });
  log.end();
}

function recordApkArtifact() {
  const recorded = JSON.parse(fs.readFileSync(path.join(qaRoot, 'source-fingerprint.json'), 'utf8'));
  if (recorded.sha256 !== sourceFingerprint().sha256) throw new Error('Source changed during compile; refresh and rebuild before using this APK.');
  const apk = path.join(appRoot, 'android/app/build/outputs/apk/release/app-release.apk');
  const artifact = { apk, appId: qaAppId, source: recorded, sha256: createHash('sha256').update(fs.readFileSync(apk)).digest('hex'), bytes: fs.statSync(apk).size };
  fs.writeFileSync(path.join(qaRoot, 'apk-artifact.json'), `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify(artifact, null, 2));
}

export async function main(command = 'prepare') {
  if (process.platform !== 'win32') throw new Error('This harness records the reviewed Windows SDK/JDK setup.');
  assertInside(path.join(repositoryRoot, 'out'), qaGradleHome);
  fs.mkdirSync(qaGradleHome, { recursive: true });
  for (const name of ['gradle-home', 'android-user', 'emulator-home', 'user-home', 'expo-home', 'tmp']) fs.mkdirSync(path.join(qaRoot, name), { recursive: true });
  if (command === 'prepare') {
    if (fs.existsSync(appRoot)) throw new Error('Snapshot already exists; use refresh for source-only updates.');
    fs.mkdirSync(appRoot, { recursive: true });
    const fingerprint = refreshSource();
    const dependencies = prepareDependencyOverlay();
    prepareSdkOverlay();
    fs.writeFileSync(path.join(qaRoot, 'snapshot.json'), `${JSON.stringify({ appId: qaAppId, fingerprint, dependencies, requiredTooling, apk: path.join(appRoot, 'android/app/build/outputs/apk/release/app-release.apk'), limitations: ['Synthetic Firebase; no authentication/App Check evidence', 'Network-disabled fixture; no hosted maps or API proof'] }, null, 2)}\n`);
    console.log(JSON.stringify({ fingerprint, dependencies, requiredTooling }, null, 2));
  } else if (command === 'refresh') console.log(JSON.stringify(refreshSource()));
  else if (command === 'prebuild') {
    await run(process.execPath, [path.join(appRoot, 'node_modules/expo/bin/cli'), 'prebuild', '--platform', 'android', '--no-install', '--skip-dependency-update', 'react-native,react'], 'prebuild');
    fs.writeFileSync(path.join(appRoot, 'android/local.properties'), `sdk.dir=${sdkRoot.replaceAll('\\', '/')}\n`);
    const properties = path.join(appRoot, 'android/gradle.properties');
    fs.appendFileSync(properties, `\n# Isolated x86_64 emulator fixture; exact supported compiler versions retained.\nreactNativeArchitectures=x86_64\nandroid.cmakeVersion=${requiredTooling.cmake}\norg.gradle.workers.max=2\n`);
    // Template keys are discarded without reading; this fixture gets a fresh local test key.
    const keyPath = assertInside(qaRoot, path.join(appRoot, 'android/app/debug.keystore'));
    if (fs.existsSync(keyPath)) fs.unlinkSync(keyPath);
    await run(path.join(javaHome, 'bin/keytool.exe'), ['-genkeypair', '-keystore', keyPath, '-storepass', 'android', '-keypass', 'android', '-alias', 'androiddebugkey', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '30', '-dname', 'CN=Orbit QA,OU=Local Test,O=Fictional QA,L=Test,ST=Test,C=US'], 'fixture-test-signing');
  } else if (command === 'tools') {
    assertWritableSdkContainers(sdkRoot);
    const packages = [`ndk;${requiredTooling.ndk}`, `cmake;${requiredTooling.cmake}`].filter(item => !fs.existsSync(path.join(sdkRoot, ...item.split(';'))));
    if (packages.length) await run(createQaEnvironment().ComSpec || 'C:/Windows/System32/cmd.exe', ['/d', '/c', path.join(sourceSdk, 'cmdline-tools/latest/bin/sdkmanager.bat'), `--sdk_root=${sdkRoot}`, ...packages], 'sdk-tools');
    else console.log('Exact NDK and CMake already available in isolated SDK.');
  } else if (command === 'build') {
    assertWritableSdkContainers(sdkRoot);
    const recorded = JSON.parse(fs.readFileSync(path.join(qaRoot, 'source-fingerprint.json'), 'utf8'));
    if (recorded.sha256 !== sourceFingerprint().sha256) throw new Error('Source changed since snapshot; refresh before compiling.');
    if (!fs.existsSync(path.join(sdkRoot, 'ndk', requiredTooling.ndk))) throw new Error('Install the exact NDK into the isolated SDK first.');
    await run(createQaEnvironment().ComSpec || 'C:/Windows/System32/cmd.exe', ['/d', '/c', path.join(appRoot, 'android/gradlew.bat'), 'assembleRelease', '--no-daemon', '--console=plain', '--max-workers=2', '-PreactNativeArchitectures=x86_64'], 'assemble-release', { cwd: path.join(appRoot, 'android') });
    recordApkArtifact();
  } else if (command === 'artifact') recordApkArtifact();
  else throw new Error(`Unknown QA command: ${command}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
