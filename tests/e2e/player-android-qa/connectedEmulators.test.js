import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { connectedRoot } from './connectedPrepare.mjs';
import { createEmulatorEnvironment, connectedEmulatorConfiguration, emulatorNetworkGuardSource, assertPortsUnused } from './connectedEmulators.mjs';

describe('connected emulator isolation', () => {
  it('uses only fixed demo loopback listeners and reviewed rules, without UI or hosted fallback', () => {
    const config = connectedEmulatorConfiguration();
    expect(config.firestore).toEqual({ rules: './firestore.rules', indexes: './firestore.indexes.json' });
    expect(config.emulators.auth).toEqual({ host: '127.0.0.1', port: 19099 });
    expect(config.emulators.firestore).toEqual({ host: '127.0.0.1', port: 18085, websocketPort: 18150 });
    expect(config.emulators.ui.enabled).toBe(false); expect(config.emulators.singleProjectMode).toBe(true);
    expect(() => connectedEmulatorConfiguration({ projectId: 'live' })).toThrow(/exact demo/);
  });
  it('isolates CLI credentials, configuration and public emulator cache', () => {
    const env = createEmulatorEnvironment({ PATH: 'public-tools', FIREBASE_TOKEN: 'private', GOOGLE_APPLICATION_CREDENTIALS: 'private', HTTP_PROXY: 'host', USERPROFILE: 'host' });
    expect(env.PATH).toContain('public-tools'); expect(env.PATH).toContain(path.join(env.JAVA_HOME, 'bin')); expect(env.FIREBASE_TOKEN).toBeUndefined(); expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined(); expect(env.HTTP_PROXY).toBeUndefined();
    expect(env.XDG_CONFIG_HOME).toBe(path.join(connectedRoot, 'emulators/config'));
    expect(env.GCLOUD_PROJECT).toBe('demo-orbit-native-match-qa'); expect(env.NO_UPDATE_NOTIFIER).toBe('1');
    expect(env.FIREBASE_EMULATORS_PATH).toBe(path.join(connectedRoot, 'emulators/public-cache'));
    const windows = createEmulatorEnvironment({ Path: 'preferred-host-path', PATH: 'duplicate-host-path' });
    expect(windows.Path).toBeUndefined(); expect(windows.PATH).toContain('preferred-host-path'); expect(windows.PATH).not.toContain('duplicate-host-path');
  });
  it('refuses an existing listener rather than adopting or stopping it', async () => {
    const inspected = [];
    const create = () => { const server = new EventEmitter(); server.listen = (port, host, done) => { inspected.push([port, host]); queueMicrotask(() => port === 19099 ? server.emit('error', new Error('owned elsewhere')) : done()); }; server.close = done => done(); return server; };
    await expect(assertPortsUnused([18085, 19099, 14639], create)).rejects.toThrow(/19099.*another listener/);
    expect(inspected).toEqual([[18085, '127.0.0.1'], [19099, '127.0.0.1']]);
    await expect(assertPortsUnused([NaN], create)).rejects.toThrow(/Invalid/);
  });
  it('preloads a loopback-only guard before CLI imports, blocking TLS, DNS, UDP and redirects', () => {
    const source = emulatorNetworkGuardSource();
    expect(source).toContain('new Set([18085,19099,14400,14500,18150])');
    expect(source).toContain('tls.connect ='); expect(source).toContain('Socket.prototype.connect'); expect(source).toContain("redirect: 'error'");
    expect(source).toContain('blocked DNS'); expect(source).toContain('blocked UDP'); expect(source).not.toContain('googleapis.com');
  });
});
