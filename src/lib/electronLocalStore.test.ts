import path from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const electronMainSource = readFileSync(new URL('../../electron/main.cjs', import.meta.url), 'utf8');

function extractFunctionSource(name: string) {
  const asyncStart = electronMainSource.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : electronMainSource.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Could not find ${name} in electron/main.cjs.`);
  const parametersStart = electronMainSource.indexOf('(', start);
  let parameterDepth = 0;
  let parametersEnd = -1;
  for (let index = parametersStart; index < electronMainSource.length; index += 1) {
    if (electronMainSource[index] === '(') parameterDepth += 1;
    if (electronMainSource[index] === ')') parameterDepth -= 1;
    if (parameterDepth === 0) {
      parametersEnd = index;
      break;
    }
  }
  const bodyStart = electronMainSource.indexOf('{', parametersEnd);
  let depth = 0;
  for (let index = bodyStart; index < electronMainSource.length; index += 1) {
    if (electronMainSource[index] === '{') depth += 1;
    if (electronMainSource[index] === '}') depth -= 1;
    if (depth === 0) return electronMainSource.slice(start, index + 1);
  }
  throw new Error(`Could not find the end of ${name} in electron/main.cjs.`);
}

function loadFunction<T>(name: string, globals: Record<string, unknown> = {}): T {
  const names = Object.keys(globals);
  const factory = Function(...names, `${extractFunctionSource(name)}; return ${name};`);
  return factory(...names.map((key) => globals[key])) as T;
}

class FixedDate extends Date {
  constructor() {
    super('2026-08-07T13:00:00.000Z');
  }
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

describe('Electron local SQLite characterization', () => {
  it('resolves the legacy JSON and SQLite paths under Electron userData', () => {
    const globals = { app: { getPath: () => 'C:\\isolated-user-data' }, path };
    const getLegacyDataPath = loadFunction<() => string>('getLegacyDataPath', globals);
    const getDataPath = loadFunction<() => string>('getDataPath', globals);

    expect(getLegacyDataPath()).toBe(path.join('C:\\isolated-user-data', 'tablemanager-db.json'));
    expect(getDataPath()).toBe(path.join('C:\\isolated-user-data', 'tablemanager.sqlite3'));
  });

  it('creates and caches one SQLite connection with the exact schema families enabled', () => {
    const exec = vi.fn();
    const databaseInstance = { exec };
    const DatabaseSync = vi.fn(function DatabaseConstructor() {
      return databaseInstance;
    });
    const fs = { mkdirSync: vi.fn() };
    const getDatabase = loadFunction<() => typeof databaseInstance>('getDatabase', {
      DatabaseSync,
      database: undefined,
      fs,
      getDataPath: () => 'C:\\isolated\\tablemanager.sqlite3',
      path
    });

    expect(getDatabase()).toBe(databaseInstance);
    expect(getDatabase()).toBe(databaseInstance);
    expect(DatabaseSync).toHaveBeenCalledOnce();
    expect(DatabaseSync).toHaveBeenCalledWith('C:\\isolated\\tablemanager.sqlite3');
    expect(fs.mkdirSync).toHaveBeenCalledWith('C:\\isolated', { recursive: true });
    const schema = String(exec.mock.calls[0][0]);
    expect(schema).toContain('PRAGMA journal_mode = WAL');
    expect(schema).toContain('PRAGMA foreign_keys = ON');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS app_state');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS account_state');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS account_profiles');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS account_profile_companions');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS analytical_reports');
  });

  it('reads a normalized account row without consulting either legacy store', () => {
    const get = vi.fn().mockReturnValue({
      schema_version: 4,
      saved_at: '2026-08-07T12:00:00.000Z',
      state_json: '{"settings":{"clubAccount":{"clubName":"Orbit"}}}'
    });
    const prepare = vi.fn().mockReturnValue({ get });
    const readLegacyLocalDatabase = vi.fn();
    const writeLocalDatabase = vi.fn();
    const readLocalDatabase = loadFunction<(accountKey?: string) => unknown>('readLocalDatabase', {
      getDatabase: () => ({ prepare }),
      readLegacyLocalDatabase,
      sanitizeAccountKey: () => 'club-one',
      writeLocalDatabase
    });

    expect(readLocalDatabase(' Club One ')).toEqual({
      schemaVersion: 4,
      savedAt: '2026-08-07T12:00:00.000Z',
      state: { settings: { clubAccount: { clubName: 'Orbit' } } }
    });
    expect(prepare).toHaveBeenCalledWith('SELECT schema_version, saved_at, state_json FROM account_state WHERE account_key = ?');
    expect(get).toHaveBeenCalledWith('club-one');
    expect(readLegacyLocalDatabase).not.toHaveBeenCalled();
    expect(writeLocalDatabase).not.toHaveBeenCalled();
  });

  it('does not cross account boundaries when a requested account row is absent', () => {
    const prepare = vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });
    const readLegacyLocalDatabase = vi.fn();
    const writeLocalDatabase = vi.fn();
    const readLocalDatabase = loadFunction<(accountKey?: string) => unknown>('readLocalDatabase', {
      getDatabase: () => ({ prepare }),
      readLegacyLocalDatabase,
      sanitizeAccountKey: () => 'missing-club',
      writeLocalDatabase
    });

    expect(readLocalDatabase('missing-club')).toBeNull();
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(readLegacyLocalDatabase).not.toHaveBeenCalled();
    expect(writeLocalDatabase).not.toHaveBeenCalled();
  });

  it('migrates the legacy singleton SQLite row only after the last-opened account lookup misses', () => {
    const legacyState = { settings: { clubAccount: { clubName: 'Legacy Room' } } };
    const prepare = vi.fn((sql: string) => ({
      get: vi.fn().mockReturnValue(sql.includes('FROM app_state')
        ? { schema_version: 2, saved_at: 'legacy-time', state_json: JSON.stringify(legacyState) }
        : undefined)
    }));
    const writeLocalDatabase = vi.fn();
    const readLegacyLocalDatabase = vi.fn();
    const readLocalDatabase = loadFunction<() => unknown>('readLocalDatabase', {
      getDatabase: () => ({ prepare }),
      readLegacyLocalDatabase,
      sanitizeAccountKey: () => '',
      writeLocalDatabase
    });

    expect(readLocalDatabase()).toEqual({ schemaVersion: 2, savedAt: 'legacy-time', state: legacyState });
    expect(prepare.mock.calls.map((call) => call[0])).toEqual([
      'SELECT schema_version, saved_at, state_json FROM account_state WHERE is_last_opened = 1 ORDER BY saved_at DESC LIMIT 1',
      'SELECT schema_version, saved_at, state_json FROM app_state WHERE id = 1'
    ]);
    expect(writeLocalDatabase).toHaveBeenCalledWith(legacyState);
    expect(readLegacyLocalDatabase).not.toHaveBeenCalled();
  });

  it('falls back to and migrates the legacy JSON record when both SQLite lookups miss', () => {
    const legacyRecord = { schemaVersion: 1, savedAt: 'json-time', state: { settings: {} } };
    const prepare = vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });
    const writeLocalDatabase = vi.fn();
    const readLocalDatabase = loadFunction<() => unknown>('readLocalDatabase', {
      getDatabase: () => ({ prepare }),
      readLegacyLocalDatabase: () => legacyRecord,
      sanitizeAccountKey: () => '',
      writeLocalDatabase
    });

    expect(readLocalDatabase()).toBe(legacyRecord);
    expect(writeLocalDatabase).toHaveBeenCalledWith(legacyRecord.state);
  });

  it('writes account state and profile projections transactionally while filtering invalid companions', () => {
    const runs = new Map<string, ReturnType<typeof vi.fn>>();
    const prepare = vi.fn((sql: string) => {
      const run = vi.fn();
      runs.set(sql.trim().replace(/\s+/g, ' '), run);
      return { run };
    });
    const exec = vi.fn();
    const writeLocalDatabase = loadFunction<(state: typeof validState) => unknown>('writeLocalDatabase', {
      Date: FixedDate,
      getAccountKeyFromState: () => 'club-one',
      getDataPath: () => 'C:\\isolated\\tablemanager.sqlite3',
      getDatabase: () => ({ exec, prepare }),
      validateStatePayload: vi.fn()
    });

    expect(writeLocalDatabase(validState)).toEqual({
      ok: true,
      path: 'C:\\isolated\\tablemanager.sqlite3',
      engine: 'sqlite',
      accountKey: 'club-one'
    });
    expect(exec.mock.calls.map((call) => call[0])).toEqual(['BEGIN IMMEDIATE', 'COMMIT']);

    const statement = (prefix: string) => [...runs.entries()].find(([sql]) => sql.startsWith(prefix))?.[1];
    expect(statement('UPDATE account_state')?.mock.calls[0]).toEqual([]);
    expect(statement('INSERT INTO account_state')?.mock.calls[0]).toEqual([
      'club-one',
      '2026-08-07T13:00:00.000Z',
      JSON.stringify(validState)
    ]);
    expect(statement('DELETE FROM account_profiles')?.mock.calls[0]).toEqual(['club-one']);
    expect(statement('INSERT INTO account_profiles')?.mock.calls).toEqual([
      [
        'club-one', 'player-1', 'Alex', '1990-01-01', '2026-01-01', '2026-12-31', 42, 3.5,
        'nlh', '1/2', 'Regular', JSON.stringify(validState.profiles[0]), '2026-08-07T13:00:00.000Z'
      ],
      [
        'club-one', 'player-2', 'Blair', '', '', '', 0, 0,
        '', '', '', JSON.stringify(validState.profiles[1]), '2026-08-07T13:00:00.000Z'
      ]
    ]);
    expect(statement('INSERT OR IGNORE INTO account_profile_companions')?.mock.calls).toEqual([
      ['club-one', 'player-1', 'player-2']
    ]);
  });

  it('rolls back and rethrows a failed transactional state projection', () => {
    const exec = vi.fn();
    const prepare = vi.fn((sql: string) => ({
      run: sql.startsWith('UPDATE account_state') ? vi.fn(() => { throw new Error('write failed'); }) : vi.fn()
    }));
    const writeLocalDatabase = loadFunction<(state: typeof validState) => unknown>('writeLocalDatabase', {
      Date: FixedDate,
      getAccountKeyFromState: () => 'club-one',
      getDataPath: vi.fn(),
      getDatabase: () => ({ exec, prepare }),
      validateStatePayload: vi.fn()
    });

    expect(() => writeLocalDatabase(validState)).toThrow('write failed');
    expect(exec.mock.calls.map((call) => call[0])).toEqual(['BEGIN IMMEDIATE', 'ROLLBACK']);
  });
});

describe('Electron analytical report characterization', () => {
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
    const validateReportPayload = loadFunction<(value: unknown) => void>('validateReportPayload', {
      isRecord: (value: unknown) => Boolean(value && typeof value === 'object' && !Array.isArray(value))
    });

    expect(() => validateReportPayload(report)).not.toThrow();
    expect(() => validateReportPayload(null)).toThrow('Report payload must be an object.');
    expect(() => validateReportPayload({ ...report, account: null })).toThrow('Report payload is missing account details.');
    expect(() => validateReportPayload({ ...report, operational: null })).toThrow('Report payload is missing operational metrics.');
    expect(() => validateReportPayload({ ...report, usage: null })).toThrow('Report payload is missing usage metrics.');
  });

  it('keeps unconfigured delivery stored and preserves endpoint-before-email delivery order', async () => {
    const noDelivery = loadFunction<(value: unknown) => Promise<unknown>>('forwardReportIfConfigured', {
      Date: FixedDate,
      fetch: vi.fn(),
      process: { env: {} },
      sendReportEmail: vi.fn()
    });
    await expect(noDelivery(report)).resolves.toEqual({ status: 'stored' });

    const order: string[] = [];
    const fetch = vi.fn(async () => {
      order.push('endpoint');
      return { ok: true, status: 200 };
    });
    const sendReportEmail = vi.fn(async () => {
      order.push('email');
    });
    const configuredDelivery = loadFunction<(value: unknown) => Promise<unknown>>('forwardReportIfConfigured', {
      Date: FixedDate,
      fetch,
      process: { env: { TABLEMANAGER_REPORT_ENDPOINT: 'http://127.0.0.1:4311/report', TABLEMANAGER_REPORT_EMAIL_TO: 'local@example.test' } },
      sendReportEmail
    });

    await expect(configuredDelivery(report)).resolves.toEqual({
      status: 'delivered',
      deliveredAt: '2026-08-07T13:00:00.000Z',
      channels: ['endpoint', 'email']
    });
    expect(order).toEqual(['endpoint', 'email']);
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:4311/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report)
    });
    expect(sendReportEmail).toHaveBeenCalledWith(report, 'local@example.test');
  });

  it('creates SMTP transport only from complete configuration and selects TLS for port 465', () => {
    const createTransport = vi.fn().mockReturnValue({ sendMail: vi.fn() });
    const missingConfig = loadFunction<() => unknown>('getSmtpTransport', {
      nodemailer: { createTransport },
      process: { env: {} }
    });
    expect(() => missingConfig()).toThrow('Email delivery requires TABLEMANAGER_SMTP_HOST, TABLEMANAGER_SMTP_USER, and TABLEMANAGER_SMTP_PASS.');

    const configured = loadFunction<() => unknown>('getSmtpTransport', {
      nodemailer: { createTransport },
      process: {
        env: {
          TABLEMANAGER_SMTP_HOST: '127.0.0.1',
          TABLEMANAGER_SMTP_PORT: '465',
          TABLEMANAGER_SMTP_USER: 'local-user',
          TABLEMANAGER_SMTP_PASS: 'local-pass'
        }
      }
    });
    configured();
    expect(createTransport).toHaveBeenCalledWith({
      host: '127.0.0.1',
      port: 465,
      secure: true,
      auth: { user: 'local-user', pass: 'local-pass' }
    });
  });

  it('builds the report email and caps feature/action summaries at eight entries', async () => {
    const buildReportEmailText = loadFunction<(value: typeof report) => string>('buildReportEmailText');
    const text = buildReportEmailText(report);
    expect(text).toContain('Orbit report for Orbit Room');
    expect(text).toContain('Occupied seat-hours: 10');
    expect(text).toContain('- Feature 7: 7');
    expect(text).not.toContain('Feature 8');
    expect(text).toContain('- Action 7 (Tables): 7');
    expect(text).not.toContain('Action 8');

    const sendMail = vi.fn().mockResolvedValue(undefined);
    const sendReportEmail = loadFunction<(value: typeof report, email: string) => Promise<void>>('sendReportEmail', {
      Date: FixedDate,
      buildReportEmailText,
      getSmtpTransport: () => ({ sendMail }),
      process: { env: { TABLEMANAGER_SMTP_FROM: 'reports@example.test', TABLEMANAGER_SMTP_USER: 'fallback@example.test' } }
    });
    await sendReportEmail(report, 'recipient@example.test');
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
    const getReportCount = vi.fn().mockReturnValue(9);
    const storeAnalyticalReport = loadFunction<(value: typeof report) => Promise<unknown>>('storeAnalyticalReport', {
      Date: FixedDate,
      crypto: { randomUUID: () => 'report-001' },
      embeddedBackendStatus: { running: true, host: '127.0.0.1', port: 4312, reportCount: 8 },
      forwardReportIfConfigured: vi.fn().mockResolvedValue({
        status: 'delivered',
        deliveredAt: '2026-08-07T12:59:00.000Z',
        channels: ['endpoint']
      }),
      getDatabase: () => ({ prepare: vi.fn().mockReturnValue({ run }) }),
      getReportCount,
      sanitizeAccountKey: () => 'club-one',
      validateReportPayload: vi.fn()
    });

    await expect(storeAnalyticalReport(report)).resolves.toEqual({
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
      '2026-08-07T12:59:00.000Z',
      ''
    );
  });

  it('queues delivery failures while still storing the report and exact error', async () => {
    const run = vi.fn();
    const storeAnalyticalReport = loadFunction<(value: typeof report) => Promise<unknown>>('storeAnalyticalReport', {
      Date: FixedDate,
      crypto: { randomUUID: () => 'report-002' },
      embeddedBackendStatus: { running: false, host: '127.0.0.1', port: 0, reportCount: 0 },
      forwardReportIfConfigured: vi.fn().mockRejectedValue(new Error('Report endpoint returned 503')),
      getDatabase: () => ({ prepare: vi.fn().mockReturnValue({ run }) }),
      getReportCount: () => 1,
      sanitizeAccountKey: () => 'club-one',
      validateReportPayload: vi.fn()
    });

    await expect(storeAnalyticalReport(report)).resolves.toMatchObject({
      ok: true,
      id: 'report-002',
      deliveryStatus: 'queued',
      backend: { reportCount: 1 }
    });
    expect(run.mock.calls[0].slice(4)).toEqual(['queued', null, 'Report endpoint returned 503']);
  });
});
