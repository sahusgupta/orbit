import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createManagementSessionStore, parseLicenseExpiration } = require('../../electron/managementSessionStore.cjs') as {
  createManagementSessionStore: (dependencies: Record<string, unknown>) => {
    clearSession(accountKey: string): { ok: boolean; active: boolean };
    getDataPath(): string;
    restoreSession(binding: SessionBinding): { ok: boolean; active: boolean; expiresAt?: string };
    saveSession(binding: SessionBinding): { ok: boolean; active: boolean; expiresAt?: string };
  };
  parseLicenseExpiration(value: string): number;
};

type SessionBinding = {
  accountKey: string;
  credentialFingerprint: string;
  licenseExpiresAt: string;
};

function createFileSystem() {
  const files = new Map<string, string>();
  return {
    files,
    existsSync: (filePath: string) => files.has(filePath),
    mkdirSync: () => undefined,
    readFileSync: (filePath: string) => files.get(filePath) ?? '',
    renameSync: (source: string, destination: string) => {
      const value = files.get(source);
      if (value === undefined) throw new Error('Missing temporary file.');
      files.set(destination, value);
      files.delete(source);
    },
    writeFileSync: (filePath: string, value: string) => files.set(filePath, value)
  };
}

const binding = (overrides: Partial<SessionBinding> = {}): SessionBinding => ({
  accountKey: 'club-one',
  credentialFingerprint: 'a'.repeat(64),
  licenseExpiresAt: '2026-08-31',
  ...overrides
});

describe('OS-encrypted management session store', () => {
  it('persists an encrypted credential-bound session and restores it after a process restart', () => {
    const fileSystem = createFileSystem();
    const now = () => Date.parse('2026-08-23T12:00:00.000Z');
    const encodeState = (value: string) => `safe-storage:v1:${Buffer.from(value).toString('base64')}`;
    const decodeState = (value: string) => Buffer.from(value.slice('safe-storage:v1:'.length), 'base64').toString('utf8');
    const dependencies = {
      app: { getPath: () => 'C:/orbit-test' },
      decodeState,
      encodeState,
      fileSystem,
      now
    };
    const first = createManagementSessionStore(dependencies);

    expect(first.saveSession(binding())).toMatchObject({ ok: true, active: true });
    const stored = fileSystem.files.get(first.getDataPath()) ?? '';
    expect(stored).toMatch(/^safe-storage:v1:/);
    expect(stored).not.toContain('club-one');
    expect(stored).not.toContain('a'.repeat(64));

    const restored = createManagementSessionStore(dependencies);
    expect(restored.restoreSession(binding())).toMatchObject({ ok: true, active: true });
  });

  it('invalidates expired, changed-credential, changed-license, and explicitly cleared sessions', () => {
    const fileSystem = createFileSystem();
    let nowMs = Date.parse('2026-08-23T12:00:00.000Z');
    const dependencies = {
      app: { getPath: () => 'C:/orbit-test' },
      decodeState: (value: string) => Buffer.from(value, 'base64').toString('utf8'),
      encodeState: (value: string) => Buffer.from(value).toString('base64'),
      fileSystem,
      now: () => nowMs
    };
    const store = createManagementSessionStore(dependencies);

    store.saveSession(binding());
    expect(store.restoreSession(binding({ credentialFingerprint: 'b'.repeat(64) }))).toEqual({ ok: true, active: false });
    store.saveSession(binding());
    expect(store.restoreSession(binding({ licenseExpiresAt: '2026-09-01' }))).toEqual({ ok: true, active: false });
    store.saveSession(binding());
    expect(store.clearSession('club-one')).toEqual({ ok: true, active: false });
    expect(store.restoreSession(binding())).toEqual({ ok: true, active: false });

    store.saveSession(binding());
    nowMs = Date.parse('2026-09-01T06:00:00.000Z');
    expect(store.restoreSession(binding())).toEqual({ ok: true, active: false });
  });

  it('treats date-only licenses as valid through local end-of-day and rejects malformed bindings', () => {
    expect(new Date(parseLicenseExpiration('2026-08-23')).getHours()).toBe(23);
    expect(new Date(parseLicenseExpiration('2026-08-23')).getMinutes()).toBe(59);
    const store = createManagementSessionStore({
      app: { getPath: () => 'C:/orbit-test' },
      decodeState: (value: string) => value,
      encodeState: (value: string) => value,
      fileSystem: createFileSystem(),
      now: () => Date.parse('2026-08-23T12:00:00.000Z')
    });
    expect(() => store.saveSession(binding({ accountKey: '../escape' }))).toThrow('Management session binding is invalid.');
    expect(() => store.saveSession(binding({ credentialFingerprint: 'not-a-hash' }))).toThrow('Management session binding is invalid.');
  });
});
