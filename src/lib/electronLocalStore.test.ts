import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createLocalStore } = require('../../electron/localStore.cjs') as {
  createLocalStore: (dependencies: Record<string, unknown>) => Record<string, (...args: unknown[]) => unknown>;
};

const now = new Date('2026-08-07T13:00:00.000Z');
const state = {
  games: [],
  sessions: [],
  playerSessions: [],
  profiles: [{ id: 'player-1', name: 'Ada' }],
  settings: { clubAccount: { clubName: 'Orbit Room', email: 'owner@example.com' } }
};
const secondState = {
  ...state,
  settings: { clubAccount: { clubName: 'Second Room', email: 'second@example.com' } }
};
const report = {
  id: 'report-001',
  generatedAt: now.toISOString(),
  account: { accountKey: 'club-one', clubName: 'Orbit Room' },
  operational: {
    occupiedSeatHours: 10,
    estimatedTimeFeeRevenue: 100,
    recordedDropTotal: 50,
    estimatedDropRevenue: 60,
    averageWaitMinutes: 5,
    waitlistConversionRate: 80,
    gamesStarted: 3,
    failedStarts: 1,
    tableBreaks: 1
  },
  usage: {
    features: Array.from({ length: 9 }, (_value, index) => ({ feature: `Feature ${index}`, count: index })),
    actions: Array.from({ length: 9 }, (_value, index) => ({ action: `Action ${index}`, feature: 'Tables', count: index }))
  }
};

function createMemoryFileSystem(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    existsSync: vi.fn((filePath: string) => files.has(filePath)),
    readFileSync: vi.fn((filePath: string) => files.get(filePath)),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn((filePath: string, contents: string) => { files.set(filePath, contents); }),
    renameSync: vi.fn((source: string, target: string) => {
      const contents = files.get(source);
      if (contents === undefined) throw new Error('Temporary cache was not written.');
      files.set(target, contents);
      files.delete(source);
    }),
    unlinkSync: vi.fn((filePath: string) => { files.delete(filePath); })
  };
}

function baseDependencies(overrides: Record<string, unknown> = {}) {
  return {
    app: { getPath: () => 'C:\\isolated-user-data' },
    fileSystem: createMemoryFileSystem(),
    now: () => now,
    randomUUID: () => 'report-001',
    updateBackendReportCount: (reportCount: number) => ({ running: true, reportCount }),
    ...overrides
  };
}

describe('Electron encrypted offline file cache', () => {
  it('uses an atomic JSON cache path and preserves account partitions across reopen', () => {
    const fileSystem = createMemoryFileSystem();
    const store = createLocalStore(baseDependencies({ fileSystem }));
    expect(store.getDataPath()).toBe(path.join('C:\\isolated-user-data', 'tablemanager-cache.json'));

    expect(store.writeLocalDatabase(state)).toEqual({
      ok: true,
      path: path.join('C:\\isolated-user-data', 'tablemanager-cache.json'),
      engine: 'file-cache',
      accountKey: 'owner-example.com'
    });
    store.writeLocalDatabase(secondState);
    expect(store.readLocalDatabase('owner-example.com')).toMatchObject({ state });
    expect(store.readLocalDatabase()).toMatchObject({ state: secondState });
    expect(fileSystem.renameSync).toHaveBeenCalled();

    store.closeDatabase();
    expect(store.readLocalDatabase('owner-example.com')).toMatchObject({ state });
  });

  it('encrypts cached state through the trusted Electron safe-storage boundary', () => {
    const fileSystem = createMemoryFileSystem();
    const encodeState = vi.fn((value: string) => `encrypted:${Buffer.from(value).toString('base64')}`);
    const decodeState = vi.fn((value: string) => Buffer.from(value.slice('encrypted:'.length), 'base64').toString('utf8'));
    const store = createLocalStore(baseDependencies({ fileSystem, encodeState, decodeState }));
    store.writeLocalDatabase(state);
    const cacheText = fileSystem.files.get(path.join('C:\\isolated-user-data', 'tablemanager-cache.json')) || '';
    expect(cacheText).not.toContain('Ada');
    store.closeDatabase();
    expect(store.readLocalDatabase()).toMatchObject({ state });
    expect(encodeState).toHaveBeenCalled();
    expect(decodeState).toHaveBeenCalled();
  });

  it('imports the legacy JSON cache once and removes it after the new cache is durable', () => {
    const legacyPath = path.join('C:\\isolated-user-data', 'tablemanager-db.json');
    const fileSystem = createMemoryFileSystem({
      [legacyPath]: JSON.stringify({ schemaVersion: 3, savedAt: now.toISOString(), state })
    });
    const store = createLocalStore(baseDependencies({ fileSystem }));
    expect(store.readLocalDatabase()).toMatchObject({ state });
    expect(fileSystem.files.has(legacyPath)).toBe(false);
    expect(fileSystem.files.has(path.join('C:\\isolated-user-data', 'tablemanager-cache.json'))).toBe(true);
  });

  it('rejects malformed state before changing the cache', () => {
    const store = createLocalStore(baseDependencies());
    expect(() => store.writeLocalDatabase({ ...state, games: null })).toThrow('State payload is missing games.');
    expect(store.getReportCount()).toBe(0);
  });

  it('requires complete SMTP configuration and builds bounded report summaries', async () => {
    const createTransport = vi.fn(() => ({ sendMail: vi.fn().mockResolvedValue(undefined) }));
    const missing = createLocalStore(baseDependencies({ mailer: { createTransport } }));
    expect(() => missing.getSmtpTransport()).toThrow('Email delivery requires TABLEMANAGER_SMTP_HOST');

    const sendMail = vi.fn().mockResolvedValue(undefined);
    const configured = createLocalStore(baseDependencies({
      environment: {
        TABLEMANAGER_SMTP_HOST: '127.0.0.1',
        TABLEMANAGER_SMTP_PORT: '465',
        TABLEMANAGER_SMTP_USER: 'local-user',
        TABLEMANAGER_SMTP_PASS: 'local-pass',
        TABLEMANAGER_SMTP_FROM: 'reports@example.test'
      },
      mailer: { createTransport: () => ({ sendMail }) }
    }));
    expect(configured.buildReportEmailText(report)).toContain('- Feature 7: 7');
    expect(configured.buildReportEmailText(report)).not.toContain('Feature 8');
    await configured.sendReportEmail(report, 'recipient@example.test');
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: 'reports@example.test',
      to: 'recipient@example.test',
      subject: 'Orbit report - Orbit Room - 2026-08-07'
    }));
  });

  it('stores only an encrypted offline report queue while Firestore remains the server datastore', async () => {
    const fileSystem = createMemoryFileSystem();
    const encodeState = vi.fn((value: string) => `encrypted:${Buffer.from(value).toString('base64')}`);
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    const store = createLocalStore(baseDependencies({
      environment: { TABLEMANAGER_REPORT_ENDPOINT: 'http://127.0.0.1:4311/report' },
      fileSystem,
      fetchImpl,
      encodeState,
      randomUUID: () => 'report-002'
    }));
    await expect(store.storeAnalyticalReport(report)).resolves.toMatchObject({
      ok: true,
      id: 'report-002',
      deliveryStatus: 'queued',
      backend: { reportCount: 1 }
    });
    expect(store.getReportCount()).toBe(1);
    const cacheText = fileSystem.files.get(path.join('C:\\isolated-user-data', 'tablemanager-cache.json')) || '';
    expect(cacheText).not.toContain('Orbit Room');
  });
});
