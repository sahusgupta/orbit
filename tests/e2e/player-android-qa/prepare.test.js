import { describe, expect, it } from 'vitest';
import path from 'node:path';
import vm from 'node:vm';
import { allowedSnapshotPath, assertInside, assertWritableSdkContainers, createQaEnvironment, createSnapshotMetroConfiguration, createSyntheticGoogleConfig, qaAppId, qaGradleHome, repositoryRoot, requiredTooling, syntheticMapsKey } from './prepare.mjs';

describe('isolated Android QA snapshot boundaries', () => {
  it('rejects root or escaping mutation targets', () => {
    const root = path.resolve('out/native-fixture');
    expect(assertInside(root, path.join(root, 'project/app.json'))).toBe(path.join(root, 'project/app.json'));
    expect(() => assertInside(root, root)).toThrow(/strictly inside/);
    expect(() => assertInside(root, path.join(root, '../production'))).toThrow(/strictly inside/);
  });

  it('rejects SDK install containers that would write through a host directory junction', () => {
    const checked = [];
    assertWritableSdkContainers('isolated/sdk', target => { checked.push(path.basename(target)); return { isDirectory: () => true, isSymbolicLink: () => false }; });
    expect(checked).toEqual(['platforms', 'build-tools', 'ndk', 'cmake']);
    expect(() => assertWritableSdkContainers('isolated/sdk', target => ({ isDirectory: () => true, isSymbolicLink: () => path.basename(target) === 'build-tools' }))).toThrow(/build-tools/);
    expect(() => assertWritableSdkContainers('isolated/sdk', () => ({ isDirectory: () => false, isSymbolicLink: () => false }))).toThrow(/isolated real directory/);
  });

  it('excludes real configuration, credentials and generated native caches before reading files', () => {
    for (const name of ['.env', '.env.production', 'src/data/firebaseConfig.ts', 'google-services.json', 'GoogleService-Info.plist', 'android/debug.keystore', 'private.pem', '.git/config', 'android/build/classes', 'android/.cxx/output', '.gradle/cache', 'src/a.test.tsx']) expect(allowedSnapshotPath(name), name).toBe(false);
    for (const name of ['src/PlayerApp.tsx', 'assets/icon.png', 'build/src/index.js', 'node_modules/@expo/cli/build/src/index.js', 'android/src/main/AndroidManifest.xml']) expect(allowedSnapshotPath(name), name).toBe(true);
  });

  it('inherits only explicitly safe system values and isolates homes and services', () => {
    const root = path.resolve('out/native-fixture');
    const environment = createQaEnvironment({ Path: 'tools', SystemRoot: 'C:/Windows', GOOGLE_APPLICATION_CREDENTIALS: 'private', EXPO_TOKEN: 'private', ORBIT_API_URL: 'https://production.invalid', JAVA_HOME: 'host', GRADLE_USER_HOME: 'host', EXPO_PUBLIC_APP_CHECK_ENABLED: 'true', EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY: 'private' }, root);
    expect(environment.Path).toBe('tools');
    expect(environment.EXPO_TOKEN).toBeUndefined();
    expect(environment.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();
    expect(environment.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY).toBe(syntheticMapsKey);
    expect(environment.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY).not.toBe('private');
    expect(environment.ORBIT_API_URL).toBe('http://127.0.0.1:9');
    expect(environment.EXPO_PUBLIC_APP_CHECK_ENABLED).toBe('false');
    expect(environment.EXPO_NO_DOTENV).toBe('1');
    expect(environment.__UNSAFE_EXPO_HOME_DIRECTORY).toBe(path.join(root, 'expo-home'));
    expect(environment.GRADLE_USER_HOME).toBe(path.join(root, 'gradle-home'));
    expect(environment.ANDROID_AVD_HOME).toBe(path.join(root, 'avd'));
    expect(environment.JAVA_TOOL_OPTIONS).toBe(`-Duser.home=${path.join(root, 'user-home')}`);
    expect(createQaEnvironment({}).GRADLE_USER_HOME).toBe(qaGradleHome);
    expect(qaGradleHome).toBe(path.join(repositoryRoot, 'out', 'g'));
  });

  it('uses a distinct synthetic identity and exact React Native compiler versions', () => {
    const config = createSyntheticGoogleConfig();
    expect(config.client[0].client_info.android_client_info.package_name).toBe(qaAppId);
    expect(qaAppId).toBe('com.orbit.player.qa');
    expect(config.project_info.project_id).toBe('orbit-native-qa-invalid');
    expect(config.client[0].oauth_client).toEqual([]);
    expect(requiredTooling).toEqual({ ndk: '27.1.12297006', cmake: '3.30.5', platform: 'android-36', buildTools: '36.0.0' });
  });

  it('resolves linked-package native imports from the copied project without changing relative import origins', () => {
    const context = { originModulePath: 'installed/vector-icons/icon.js', extra: 'preserved' };
    const module = { exports: {} };
    const original = 'module.exports = { watchFolders: [], resolver: { resolveRequest: (context, name, platform) => ({ context, name, platform }) } };';
    vm.runInNewContext(createSnapshotMetroConfiguration(original, ['react-native', '@expo/dom-webview'], 'installed/node_modules'), { module, path, __dirname: 'snapshot/player-app' });
    const native = module.exports.resolver.resolveRequest(context, 'react-native/Libraries/Core/ReactNativeVersion', 'android');
    expect(native.context.originModulePath).toBe(path.join('snapshot/player-app', 'App.tsx'));
    expect(native.context.extra).toBe('preserved');
    expect(native.name).toBe('react-native/Libraries/Core/ReactNativeVersion');
    expect(module.exports.resolver.resolveRequest(context, '@expo/dom-webview', 'android').context.originModulePath).toBe(path.join('snapshot/player-app', 'App.tsx'));
    expect(module.exports.resolver.resolveRequest(context, '../local', 'android').context.originModulePath).toBe(context.originModulePath);
    expect(module.exports.watchFolders).toEqual(['installed/node_modules']);
  });
});
