import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);

type LocalStore = {
  buildReportEmailText: (report: Record<string, unknown>) => string;
  closeDatabase: () => void;
  forwardReportIfConfigured: (report: Record<string, unknown>) => Promise<unknown>;
  getDataPath: () => string;
  getDatabase: () => unknown;
  getLegacyDataPath: () => string;
  getReportCount: () => number;
  getSmtpTransport: () => unknown;
  readLegacyLocalDatabase: () => unknown;
  readLocalDatabase: (accountKey?: string) => unknown;
  sendReportEmail: (report: Record<string, unknown>, emailTo: string) => Promise<void>;
  storeAnalyticalReport: (report: Record<string, unknown>) => Promise<unknown>;
  validateReportPayload: (report: unknown) => void;
  writeLocalDatabase: (state: Record<string, unknown>) => unknown;
};

const { createLocalStore }: { createLocalStore: (dependencies: Record<string, unknown>) => LocalStore } = require('../../electron/localStore.cjs');

function createDefaultDatabase() {
  return {
    close: vi.fn(),
    exec: vi.fn(),
    prepare: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(undefined), run: vi.fn() })
  };
}

function baseDependencies(overrides: Record<string, unknown> = {}) {
  const database = createDefaultDatabase();
  return {
    app: { getPath: () => 'C:\\isolated-user-data' },
    DatabaseSync: vi.fn(function DatabaseConstructor() { return database; }),
    environment: {},
    fetchImpl: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    fileSystem: {
      existsSync: vi.fn().mockReturnValue(false),
      readFileSync: vi.fn(),
      mkdirSync: vi.fn()
    },
    mailer: { createTransport: vi.fn().mockReturnValue({ sendMail: vi.fn().mockResolvedValue(undefined) }) },
    now: () => new Date('2026-08-07T13:00:00.000Z'),
    randomUUID: () => 'report-001',
    updateBackendReportCount: (reportCount: number) => ({ running: true, host: '127.0.0.1', port: 4312, reportCount }),
    userDataPath: () => 'C:\\isolated-user-data',
    ...overrides
  };
}

const validState = {
  games: [],
  sessions: [],
  playerSessions: [],
  settings: { pilotAccess: { licenseId: 'Club One' } },
  profiles: [
    {
      id: 'player-1',
      name: 'Alex',
      birthday: '1990-01-01',
      membershipStartDate: '2026-01-01',
      membershipExpirationDate: '2026-12-31',
      totalTimePlayedHours: 42,
      lastSessionTimePlayedHours: 3.5,
      preferredGameIds: ['nlh'],
      preferredStakes: '1/2',
      notes: 'Regular',
      commonlyPlaysWithProfileIds: ['player-2', 'missing-player']
    },
    { id: 'player-2', name: 'Blair' }
  ]
};

describe('Electron local SQLite store', () => {
  it('decodes an OS-protected account cache without exposing a cleartext profile projection', () => {
    const encrypted = 'safe-storage:v1:local-test-ciphertext';
    const decodeState = vi.fn(() => JSON.stringify(validState));
    const prepare = vi.fn((sql: string) => ({
      get: vi.fn().mockReturnValue(sql.includes('is_last_opened = 1')
        ? { schema_version: 2, saved_at: '2026-08-07T13:00:00.000Z', state_json: encrypted }
        : undefined),
      run: vi.fn()
    }));
    const store = createLocalStore(baseDependencies({
      DatabaseSync: vi.fn(function DatabaseConstructor() { return { close: vi.fn(), exec: vi.fn(), prepare }; }),
      decodeState
    }));

    expect(store.readLocalDatabase()).toMatchObject({ state: validState });
    expect(decodeState).toHaveBeenCalledWith(encrypted);
    expect(prepare.mock.calls.some(([sql]) => sql.includes('INSERT INTO account_profiles'))).toBe(false);
  });

  it('resolves the legacy JSON and SQLite paths under Electron userData', () => {
    const store = createLocalStore(baseDependencies());

    expect(store.getLegacyDataPath()).toBe(path.join('C:\\isolated-user-data', 'tablemanager-db.json'));
    expect(store.getDataPath()).toBe(path.join('C:\\isolated-user-data', 'tablemanager.sqlite3'));
  });

  it('creates, caches, closes, and reopens SQLite with the exact schema families enabled', () => {
    const exec = vi.fn();
    const close = vi.fn();
    const databaseInstance = { close, exec, prepare: vi.fn() };
    const DatabaseSync = vi.fn(function DatabaseConstructor() { return databaseInstance; });
    const fileSystem = { existsSync: vi.fn(), readFileSync: vi.fn(), mkdirSync: vi.fn() };
    const store = createLocalStore(baseDependencies({ DatabaseSync, fileSystem }));

    expect(store.getDatabase()).toBe(databaseInstance);
    expect(store.getDatabase()).toBe(databaseInstance);
    expect(DatabaseSync).toHaveBeenCalledOnce();
    expect(DatabaseSync).toHaveBeenCalledWith('C:\\isolated-user-data\\tablemanager.sqlite3');
    expect(fileSystem.mkdirSync).toHaveBeenCalledWith('C:\\isolated-user-data', { recursive: true });
    const schema = String(exec.mock.calls[0][0]);
    expect(schema).toContain('PRAGMA journal_mode = WAL');
    expect(schema).toContain('PRAGMA foreign_keys = ON');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS app_state');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS account_state');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS account_profiles');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS account_profile_companions');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS analytical_reports');

    store.closeDatabase();
    store.closeDatabase();
    expect(close).toHaveBeenCalledOnce();
    expect(store.getDatabase()).toBe(databaseInstance);
    expect(DatabaseSync).toHaveBeenCalledTimes(2);
  });

  it('reads a normalized account row without consulting the legacy file', () => {
    const get = vi.fn().mockReturnValue({
      schema_version: 4,
      saved_at: '2026-08-07T12:00:00.000Z',
      state_json: '{"settings":{"clubAccount":{"clubName":"Orbit"}}}'
    });
    const prepare = vi.fn().mockReturnValue({ get });
    const fileSystem = { existsSync: vi.fn(), readFileSync: vi.fn(), mkdirSync: vi.fn() };
    const store = createLocalStore(baseDependencies({
      DatabaseSync: vi.fn(function DatabaseConstructor() { return { close: vi.fn(), exec: vi.fn(), prepare }; }),
      fileSystem
    }));

    expect(store.readLocalDatabase(' Club One ')).toEqual({
      schemaVersion: 4,
      savedAt: '2026-08-07T12:00:00.000Z',
      state: { settings: { clubAccount: { clubName: 'Orbit' } } }
    });
    expect(prepare).toHaveBeenCalledWith('SELECT schema_version, saved_at, state_json FROM account_state WHERE account_key = ?');
    expect(get).toHaveBeenCalledWith('club-one');
    expect(fileSystem.existsSync).not.toHaveBeenCalled();
  });

  it('does not cross account boundaries when a requested account row is absent', () => {
    const prepare = vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });
    const fileSystem = { existsSync: vi.fn(), readFileSync: vi.fn(), mkdirSync: vi.fn() };
    const store = createLocalStore(baseDependencies({
      DatabaseSync: vi.fn(function DatabaseConstructor() { return { close: vi.fn(), exec: vi.fn(), prepare }; }),
      fileSystem
    }));

    expect(store.readLocalDatabase('missing-club')).toBeNull();
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(fileSystem.existsSync).not.toHaveBeenCalled();
  });

  it('migrates the legacy singleton SQLite row only after the last-opened account lookup misses', () => {
    const legacyState = { games: [], sessions: [], playerSessions: [], settings: { clubAccount: { clubName: 'Legacy Room' } } };
    const exec = vi.fn();
    const prepare = vi.fn((sql: string) => {
      if (sql.includes('FROM app_state')) {
        return { get: vi.fn().mockReturnValue({ schema_version: 2, saved_at: 'legacy-time', state_json: JSON.stringify(legacyState) }) };
      }
      if (sql.startsWith('SELECT')) return { get: vi.fn().mockReturnValue(undefined) };
      return { run: vi.fn() };
    });
    const store = createLocalStore(baseDependencies({
      DatabaseSync: vi.fn(function DatabaseConstructor() { return { close: vi.fn(), exec, prepare }; })
    }));

    expect(store.readLocalDatabase()).toEqual({ schemaVersion: 2, savedAt: 'legacy-time', state: legacyState });
    expect(prepare.mock.calls.slice(0, 2).map((call) => call[0])).toEqual([
      'SELECT schema_version, saved_at, state_json FROM account_state WHERE is_last_opened = 1 ORDER BY saved_at DESC LIMIT 1',
      'SELECT schema_version, saved_at, state_json FROM app_state WHERE id = 1'
    ]);
    expect(exec.mock.calls.slice(-3).map((call) => call[0])).toEqual([
      'BEGIN IMMEDIATE',
      'COMMIT',
      'DELETE FROM app_state WHERE id = 1'
    ]);
  });

  it('falls back to and migrates the legacy JSON record when both SQLite lookups miss', () => {
    const legacyRecord = {
      schemaVersion: 1,
      savedAt: 'json-time',
      state: { games: [], sessions: [], playerSessions: [], settings: {} }
    };
    const exec = vi.fn();
    const prepare = vi.fn((sql: string) => sql.startsWith('SELECT')
      ? { get: vi.fn().mockReturnValue(undefined) }
      : { run: vi.fn() });
    const fileSystem = {
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: vi.fn().mockReturnValue(JSON.stringify(legacyRecord)),
      mkdirSync: vi.fn()
    };
    const store = createLocalStore(baseDependencies({
      DatabaseSync: vi.fn(function DatabaseConstructor() { return { close: vi.fn(), exec, prepare }; }),
      fileSystem
    }));

    expect(store.readLocalDatabase()).toEqual(legacyRecord);
    expect(fileSystem.readFileSync).toHaveBeenCalledWith('C:\\isolated-user-data\\tablemanager-db.json', 'utf8');
    expect(exec.mock.calls.slice(-2).map((call) => call[0])).toEqual(['BEGIN IMMEDIATE', 'COMMIT']);
  });

  it('writes one cache envelope and removes duplicate plaintext profile projections', () => {
    const runs = new Map<string, ReturnType<typeof vi.fn>>();
    const prepare = vi.fn((sql: string) => {
      const run = vi.fn();
      runs.set(sql.trim().replace(/\s+/g, ' '), run);
      return { run };
    });
    const exec = vi.fn();
    const store = createLocalStore(baseDependencies({
      DatabaseSync: vi.fn(function DatabaseConstructor() { return { close: vi.fn(), exec, prepare }; })
    }));

    expect(store.writeLocalDatabase(validState)).toEqual({
      ok: true,
      path: 'C:\\isolated-user-data\\tablemanager.sqlite3',
      engine: 'sqlite',
      accountKey: 'club-one'
    });
    expect(exec.mock.calls.slice(-2).map((call) => call[0])).toEqual(['BEGIN IMMEDIATE', 'COMMIT']);

    const statement = (prefix: string) => [...runs.entries()].find(([sql]) => sql.startsWith(prefix))?.[1];
    expect(statement('UPDATE account_state')?.mock.calls[0]).toEqual([]);
    expect(statement('INSERT INTO account_state')?.mock.calls[0]).toEqual([
      'club-one',
      '2026-08-07T13:00:00.000Z',
      JSON.stringify(validState)
    ]);
    expect(statement('DELETE FROM account_profile_companions')?.mock.calls[0]).toEqual([]);
    expect(statement('DELETE FROM account_profiles')?.mock.calls[0]).toEqual([]);
    expect(statement('DELETE FROM profile_companions')?.mock.calls[0]).toEqual([]);
    expect(statement('DELETE FROM profiles')?.mock.calls[0]).toEqual([]);
    expect(statement('INSERT INTO account_profiles')).toBeUndefined();
    expect(statement('INSERT OR IGNORE INTO account_profile_companions')).toBeUndefined();
  });

  it('rolls back and rethrows a failed transactional state projection', () => {
    const exec = vi.fn();
    const prepare = vi.fn((sql: string) => ({
      run: sql.startsWith('UPDATE account_state') ? vi.fn(() => { throw new Error('write failed'); }) : vi.fn()
    }));
    const store = createLocalStore(baseDependencies({
      DatabaseSync: vi.fn(function DatabaseConstructor() { return { close: vi.fn(), exec, prepare }; })
    }));

    expect(() => store.writeLocalDatabase(validState)).toThrow('write failed');
    expect(exec.mock.calls.slice(-2).map((call) => call[0])).toEqual(['BEGIN IMMEDIATE', 'ROLLBACK']);
  });
});

describe('Electron analytical report store', () => {
  const report = {
    account: { accountKey: ' Club One ', clubName: 'Orbit Room' },
    operational: {
      occupiedSeatHours: 10,
      estimatedTimeFeeRevenue: 20,
      recordedDropTotal: 30,
      estimatedDropRevenue: 40,
      averageWaitMinutes: 5,
      waitlistConversionRate: 60,
      gamesStarted: 7,
      failedStarts: 1,
      tableBreaks: 2
    },
    usage: {
      features: Array.from({ length: 10 }, (_, index) => ({ feature: `Feature ${index}`, count: index })),
      actions: Array.from({ length: 10 }, (_, index) => ({ action: `Action ${index}`, feature: 'Tables', count: index }))
    },
    generatedAt: '2026-08-07T12:30:00.000Z'
  };

  it('validates each required report object with exact failures', () => {
    const store = createLocalStore(baseDependencies());

    expect(() => store.validateReportPayload(report)).not.toThrow();
    expect(() => store.validateReportPayload(null)).toThrow('Report payload must be an object.');
    expect(() => store.validateReportPayload({ ...report, account: null })).toThrow('Report payload is missing account details.');
    expect(() => store.validateReportPayload({ ...report, operational: null })).toThrow('Report payload is missing operational metrics.');
    expect(() => store.validateReportPayload({ ...report, usage: null })).toThrow('Report payload is missing usage metrics.');
  });

  it('keeps unconfigured delivery stored and preserves endpoint-before-email delivery order', async () => {
    const noDelivery = createLocalStore(baseDependencies());
    await expect(noDelivery.forwardReportIfConfigured(report)).resolves.toEqual({ status: 'stored' });

    const order: string[] = [];
    const fetchImpl = vi.fn(async () => {
      order.push('endpoint');
      return { ok: true, status: 200 };
    });
    const sendMail = vi.fn(async () => {
      order.push('email');
    });
    const mailer = { createTransport: vi.fn().mockReturnValue({ sendMail }) };
    const configuredDelivery = createLocalStore(baseDependencies({
      environment: {
        TABLEMANAGER_REPORT_ENDPOINT: 'http://127.0.0.1:4311/report',
        TABLEMANAGER_REPORT_EMAIL_TO: 'local@example.test',
        TABLEMANAGER_SMTP_HOST: '127.0.0.1',
        TABLEMANAGER_SMTP_USER: 'local-user',
        TABLEMANAGER_SMTP_PASS: 'local-pass'
      },
      fetchImpl,
      mailer
    }));

    await expect(configuredDelivery.forwardReportIfConfigured(report)).resolves.toEqual({
      status: 'delivered',
      deliveredAt: '2026-08-07T13:00:00.000Z',
      channels: ['endpoint', 'email']
    });
    expect(order).toEqual(['endpoint', 'email']);
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:4311/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report)
    });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'local@example.test' }));
  });

  it('creates SMTP transport only from complete configuration and selects TLS for port 465', () => {
    const createTransport = vi.fn().mockReturnValue({ sendMail: vi.fn() });
    const missingConfig = createLocalStore(baseDependencies({ mailer: { createTransport } }));
    expect(() => missingConfig.getSmtpTransport()).toThrow('Email delivery requires TABLEMANAGER_SMTP_HOST, TABLEMANAGER_SMTP_USER, and TABLEMANAGER_SMTP_PASS.');

    const configured = createLocalStore(baseDependencies({
      environment: {
        TABLEMANAGER_SMTP_HOST: '127.0.0.1',
        TABLEMANAGER_SMTP_PORT: '465',
        TABLEMANAGER_SMTP_USER: 'local-user',
        TABLEMANAGER_SMTP_PASS: 'local-pass'
      },
      mailer: { createTransport }
    }));
    configured.getSmtpTransport();
    expect(createTransport).toHaveBeenCalledWith({
      host: '127.0.0.1',
      port: 465,
      secure: true,
      auth: { user: 'local-user', pass: 'local-pass' }
    });
  });

  it('builds the report email and caps feature/action summaries at eight entries', async () => {
    const sendMail = vi.fn().mockResolvedValue(undefined);
    const store = createLocalStore(baseDependencies({
      environment: {
        TABLEMANAGER_SMTP_HOST: '127.0.0.1',
        TABLEMANAGER_SMTP_USER: 'local-user',
        TABLEMANAGER_SMTP_PASS: 'local-pass',
        TABLEMANAGER_SMTP_FROM: 'reports@example.test'
      },
      mailer: { createTransport: () => ({ sendMail }) }
    }));
    const text = store.buildReportEmailText(report);
    expect(text).toContain('Orbit report for Orbit Room');
    expect(text).toContain('Occupied seat-hours: 10');
    expect(text).toContain('- Feature 7: 7');
    expect(text).not.toContain('Feature 8');
    expect(text).toContain('- Action 7 (Tables): 7');
    expect(text).not.toContain('Action 8');

    await store.sendReportEmail(report, 'recipient@example.test');
    expect(sendMail).toHaveBeenCalledWith({
      from: 'reports@example.test',
      to: 'recipient@example.test',
      subject: 'Orbit report - Orbit Room - 2026-08-07',
      text,
      attachments: [{
        filename: 'tablemanager-report-2026-08-07.json',
        content: JSON.stringify(report, null, 2),
        contentType: 'application/json'
      }]
    });
  });

  it('stores successful delivery metadata and returns the updated backend report count', async () => {
    const run = vi.fn();
    const prepare = vi.fn((sql: string) => sql.includes('COUNT(*)')
      ? { get: vi.fn().mockReturnValue({ count: 9 }) }
      : { run });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const updateBackendReportCount = vi.fn((reportCount: number) => ({ running: true, host: '127.0.0.1', port: 4312, reportCount }));
    const store = createLocalStore(baseDependencies({
      DatabaseSync: vi.fn(function DatabaseConstructor() { return { close: vi.fn(), exec: vi.fn(), prepare }; }),
      environment: { TABLEMANAGER_REPORT_ENDPOINT: 'http://127.0.0.1:4311/report' },
      fetchImpl,
      updateBackendReportCount
    }));

    await expect(store.storeAnalyticalReport(report)).resolves.toEqual({
      ok: true,
      id: 'report-001',
      accountKey: 'club-one',
      createdAt: '2026-08-07T13:00:00.000Z',
      deliveryStatus: 'delivered',
      backend: { running: true, host: '127.0.0.1', port: 4312, reportCount: 9 }
    });
    expect(run).toHaveBeenCalledWith(
      'report-001',
      'club-one',
      '2026-08-07T13:00:00.000Z',
      JSON.stringify(report),
      'delivered',
      '2026-08-07T13:00:00.000Z',
      ''
    );
    expect(updateBackendReportCount).toHaveBeenCalledWith(9);
  });

  it('queues delivery failures while still storing the report and exact error', async () => {
    const run = vi.fn();
    const prepare = vi.fn((sql: string) => sql.includes('COUNT(*)')
      ? { get: vi.fn().mockReturnValue({ count: 1 }) }
      : { run });
    const store = createLocalStore(baseDependencies({
      DatabaseSync: vi.fn(function DatabaseConstructor() { return { close: vi.fn(), exec: vi.fn(), prepare }; }),
      environment: { TABLEMANAGER_REPORT_ENDPOINT: 'http://127.0.0.1:4311/report' },
      fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 503 }),
      randomUUID: () => 'report-002'
    }));

    await expect(store.storeAnalyticalReport(report)).resolves.toMatchObject({
      ok: true,
      id: 'report-002',
      deliveryStatus: 'queued',
      backend: { reportCount: 1 }
    });
    expect(run.mock.calls[0].slice(4)).toEqual(['queued', null, 'Report endpoint returned 503']);
  });
});
