import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';

const playerRoot = path.resolve(process.cwd(), 'player-app');
const playerRequire = createRequire(path.join(playerRoot, 'package.json'));
const glob = playerRequire('glob');
const minimatch = playerRequire('minimatch');
const temporaryDirectories = [];

function writeFixtureFile(directory, relativePath, contents = '') {
  const filename = path.resolve(directory, relativePath);
  assert.ok(filename.startsWith(directory + path.sep));
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, contents);
}

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-player-glob-'));
  temporaryDirectories.push(directory);
  for (const [filename, contents] of Object.entries({
    'package.json': '{"name":"synthetic-glob-fixture","private":true}',
    'src/file.ts': 'synthetic', 'src/nested/file.ts': 'synthetic', 'src/keep.js': 'synthetic',
    'src/.hidden.ts': 'synthetic', 'src/UPPER.TS': 'synthetic',
    'ios/Orbit.xcodeproj/project.pbxproj': '// synthetic',
    'ios/Orbit.xcodeproj/xcshareddata/xcschemes/Orbit.xcscheme': '<Scheme/>',
    'ios/Orbit/Info.plist': '<plist/>', 'ios/Orbit/Orbit.entitlements': '<plist/>',
    'ios/Orbit/AppDelegate.swift': '// synthetic',
    'ios/Pods/Ignored.xcodeproj/project.pbxproj': '// ignored',
    'android/app/src/main/AndroidManifest.xml': '<manifest package="synthetic"/>',
    'android/app/build.gradle': '// synthetic',
    'packages/one/package.json': '{"name":"one"}', 'packages/two/package.json': '{"name":"two"}',
    'packages/node_modules/ignored/package.json': '{"name":"ignored"}'
  })) writeFixtureFile(directory, filename, contents);
  return directory;
}

function installedHelper(relativePath) {
  const filename = path.join(playerRoot, 'node_modules', relativePath);
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, Buffer, Date, JSON, URL, __dirname: path.dirname(filename), __filename: filename,
    console: { ...console, warn() {} },
    process: { env: { NODE_ENV: 'test', EXPO_NO_DOTENV: '1', EXPO_NO_TELEMETRY: '1' }, platform: process.platform },
    require(name) {
      if (name === 'glob') return glob;
      if (name === 'minimatch') return minimatch;
      if (/^(?:node:)?(?:https?|net|tls|dgram|child_process)$/.test(name)) throw new Error('Network/process dependency forbidden in fixture.');
      return localRequire(name);
    }
  }, { filename });
  return module.exports;
}

const relativePaths = (directory, filenames) => Array.from(filenames, filename => path.relative(directory, filename).replaceAll('\\', '/')).sort();

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(resolved).startsWith('orbit-player-glob-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

describe('Player tooling glob consumer compatibility', () => {
  it('keeps Expo native project discovery and Metro workspace filtering', async () => {
    const directory = fixture();
    const config = installedHelper('@expo/config/build/Config.js');
    const ios = installedHelper('@expo/config-plugins/build/ios/Paths.js');
    const android = installedHelper('@expo/config-plugins/build/android/Paths.js');
    const metro = installedHelper('@expo/metro-config/build/getWatchFolders.js');
    expect(config.getDefaultTarget(directory, { sdkVersion: '58.0.0' })).toBe('bare');
    expect(relativePaths(directory, ios.getAllXcodeProjectPaths(directory))).toEqual(['ios/Orbit.xcodeproj']);
    expect(relativePaths(directory, ios.getAllPBXProjectPaths(directory))).toEqual(['ios/Orbit.xcodeproj/project.pbxproj']);
    expect(relativePaths(directory, ios.getAllInfoPlistPaths(directory))).toEqual(['ios/Orbit/Info.plist']);
    expect(relativePaths(directory, ios.getAllEntitlementsPaths(directory))).toEqual(['ios/Orbit/Orbit.entitlements']);
    expect(Array.from(ios.findSchemeNames(directory))).toEqual(['Orbit']);
    expect(relativePaths(directory, [ios.getAppDelegateFilePath(directory)])).toEqual(['ios/Orbit/AppDelegate.swift']);
    expect(relativePaths(directory, [await android.getAndroidManifestAsync(directory)]))
      .toEqual(['android/app/src/main/AndroidManifest.xml']);
    expect(relativePaths(directory, metro.globAllPackageJsonPaths(directory, ['packages/**'])))
      .toEqual(['packages/one/package.json', 'packages/two/package.json']);
  });

  it('retains fingerprint ignore negation and Windows path matching', () => {
    const helpers = installedHelper('@expo/fingerprint/build/utils/Path.js');
    const patterns = ['src/**', '!src/keep.js', '**/node_modules/**'];
    const objects = helpers.buildPathMatchObjects(patterns);
    expect(['src/file.ts', 'src/keep.js', 'node_modules/pkg/file.js', 'packages/one/file.ts']
      .map(filename => helpers.isIgnoredPathWithMatchObjects(filename, objects))).toEqual([true, false, true, false]);
    for (const [filename, pattern] of [
      ['C:/synthetic/src/file.ts', 'C:/**/file.ts'],
      ['//host/share/src/file.ts', '//host/share/**/*.ts'],
      ['src/file.ts', 'src\\**\\*.ts']
    ]) expect(new minimatch.Minimatch(pattern, { platform: 'win32', windowsPathsNoEscape: true }).match(filename)).toBe(true);
  });

  it('preserves named sync/async glob APIs, braces, extglobs and dotfile options', async () => {
    const directory = fixture();
    for (const [pattern, options, expected] of [
      ['src/**/@(file|keep).{js,ts}', {}, ['src/file.ts', 'src/keep.js', 'src/nested/file.ts']],
      ['src/**/*.ts', { dot: true }, ['src/.hidden.ts', 'src/file.ts', 'src/nested/file.ts']],
      ['src\\**\\*.ts', { windowsPathsNoEscape: true }, ['src/file.ts', 'src/nested/file.ts']]
    ]) {
      const settings = { cwd: directory, nodir: true, nocase: false, ...options };
      expect(glob.globSync(pattern, settings).map(filename => filename.replaceAll('\\', '/')).sort()).toEqual(expected);
      expect((await glob.glob(pattern, settings)).map(filename => filename.replaceAll('\\', '/')).sort()).toEqual(expected);
      expect(glob.sync(pattern, settings).map(filename => filename.replaceAll('\\', '/')).sort()).toEqual(expected);
    }
  });
});

describe('bounded Player tooling resource regressions', () => {
  it('limits globstar-parent preprocessing to the explicit expansion budget', () => {
    const runtimeNames = ['PATH', 'Path', 'SystemRoot', 'ComSpec', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'];
    const environment = Object.fromEntries(runtimeNames.filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]));
    const script = `const assert = require('node:assert/strict');
      const { Minimatch } = require(${JSON.stringify(playerRequire.resolve('minimatch'))});
      const result = new Minimatch(Array(8).fill('**/../a/b').join('/'), { optimizationLevel: 2, braceExpandMax: 64 });
      assert.ok(result.set.length <= 64, 'Compilation exceeded the explicit expansion budget.');`;
    expect(() => execFileSync(process.execPath, ['-e', script], {
      env: environment, windowsHide: true, encoding: 'utf8', timeout: 5000
    })).not.toThrow();
  });

  it('does not keep traversing directories after the async walk rejects cancellation', async () => {
    const directory = fixture();
    for (let one = 0; one < 4; one += 1) for (let two = 0; two < 4; two += 1) for (let three = 0; three < 4; three += 1) {
      writeFixtureFile(directory, `cancel/${one}/${two}/${three}/file.ts`, 'synthetic');
    }
    const controller = new AbortController();
    const reason = new Error('Synthetic cancelled glob');
    let reads = 0;
    const countedFs = { ...fs, promises: { ...fs.promises } };
    countedFs.readdir = (...args) => {
      if (++reads === 1) controller.abort(reason);
      return fs.readdir(...args);
    };
    countedFs.promises.readdir = async (...args) => {
      if (++reads === 1) controller.abort(reason);
      return fs.promises.readdir(...args);
    };
    await expect(glob.glob('**', { cwd: path.join(directory, 'cancel'), signal: controller.signal, fs: countedFs })).rejects.toBe(reason);
    const readsAtRejection = reads;
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(reads).toBe(readsAtRejection);
  });
});
