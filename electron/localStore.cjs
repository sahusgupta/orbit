const crypto = require('crypto');
const fs = require('fs');
const nodemailer = require('nodemailer');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { findReplacementAccountRecord, migrateStateToPilotAccess } = require('./accountMigration.cjs');
const {
  getAccountKeyFromAccess,
  getAccountKeyFromState,
  isRecord,
  sanitizeAccountKey,
  validateStatePayload
} = require('./runtimeUtils.cjs');

function createLocalStore(dependencies) {
  const app = dependencies.app;
  const Database = dependencies.DatabaseSync || DatabaseSync;
  const environment = dependencies.environment || process.env;
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const fileSystem = dependencies.fileSystem || fs;
  const mailer = dependencies.mailer || nodemailer;
  const now = dependencies.now || (() => new Date());
  const encodeState = dependencies.encodeState || ((value) => value);
  const decodeState = dependencies.decodeState || ((value) => value);
  const randomUUID = dependencies.randomUUID || (() => crypto.randomUUID());
  const updateBackendReportCount = dependencies.updateBackendReportCount;
  const userDataPath = dependencies.userDataPath || (() => app.getPath('userData'));

  let database;

  function parseState(value) {
    return JSON.parse(decodeState(String(value || '')));
  }

  function getLegacyDataPath() {
    return path.join(userDataPath(), 'tablemanager-db.json');
  }

  function getDataPath() {
    return path.join(userDataPath(), 'tablemanager.sqlite3');
  }

  function getDatabase() {
    if (database) return database;
    const filePath = getDataPath();
    fileSystem.mkdirSync(path.dirname(filePath), { recursive: true });
    database = new Database(filePath);
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS app_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        schema_version INTEGER NOT NULL,
        saved_at TEXT NOT NULL,
        state_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS account_state (
        account_key TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        saved_at TEXT NOT NULL,
        state_json TEXT NOT NULL,
        is_last_opened INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        birthday TEXT,
        membership_start_date TEXT,
        membership_expiration_date TEXT,
        total_time_played_hours REAL NOT NULL DEFAULT 0,
        last_session_time_played_hours REAL NOT NULL DEFAULT 0,
        preferred_game_id TEXT,
        preferred_stakes TEXT,
        notes TEXT,
        raw_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS profile_companions (
        profile_id TEXT NOT NULL,
        companion_profile_id TEXT NOT NULL,
        PRIMARY KEY (profile_id, companion_profile_id),
        FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
        FOREIGN KEY (companion_profile_id) REFERENCES profiles(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS account_profiles (
        account_key TEXT NOT NULL,
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        birthday TEXT,
        membership_start_date TEXT,
        membership_expiration_date TEXT,
        total_time_played_hours REAL NOT NULL DEFAULT 0,
        last_session_time_played_hours REAL NOT NULL DEFAULT 0,
        preferred_game_id TEXT,
        preferred_stakes TEXT,
        notes TEXT,
        raw_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (account_key, id),
        FOREIGN KEY (account_key) REFERENCES account_state(account_key) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS account_profile_companions (
        account_key TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        companion_profile_id TEXT NOT NULL,
        PRIMARY KEY (account_key, profile_id, companion_profile_id),
        FOREIGN KEY (account_key, profile_id) REFERENCES account_profiles(account_key, id) ON DELETE CASCADE,
        FOREIGN KEY (account_key, companion_profile_id) REFERENCES account_profiles(account_key, id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS analytical_reports (
        id TEXT PRIMARY KEY,
        account_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        report_json TEXT NOT NULL,
        delivery_status TEXT NOT NULL DEFAULT 'stored',
        delivered_at TEXT,
        delivery_error TEXT
      );
    `);
    return database;
  }

  function closeDatabase() {
    if (!database) return;
    database.close();
    database = undefined;
  }

  function readLegacyLocalDatabase() {
    const filePath = getLegacyDataPath();
    if (!fileSystem.existsSync(filePath)) return null;
    return JSON.parse(fileSystem.readFileSync(filePath, 'utf8'));
  }

  function readLocalDatabase(accountKey) {
    const db = getDatabase();
    const normalizedAccountKey = sanitizeAccountKey(accountKey);
    const row = normalizedAccountKey
      ? db.prepare('SELECT schema_version, saved_at, state_json FROM account_state WHERE account_key = ?').get(normalizedAccountKey)
      : db.prepare('SELECT schema_version, saved_at, state_json FROM account_state WHERE is_last_opened = 1 ORDER BY saved_at DESC LIMIT 1').get();
    if (row) {
      const state = parseState(row.state_json);
      if (dependencies.encodeState && !String(row.state_json).startsWith('safe-storage:v1:')) {
        writeLocalDatabase(state);
      }
      return {
        schemaVersion: row.schema_version,
        savedAt: row.saved_at,
        state
      };
    }

    if (normalizedAccountKey) return null;

    const legacySqliteRow = db.prepare('SELECT schema_version, saved_at, state_json FROM app_state WHERE id = 1').get();
    if (legacySqliteRow) {
      const state = parseState(legacySqliteRow.state_json);
      writeLocalDatabase(state);
      db.exec('DELETE FROM app_state WHERE id = 1');
      return {
        schemaVersion: legacySqliteRow.schema_version,
        savedAt: legacySqliteRow.saved_at,
        state
      };
    }

    const legacyRecord = readLegacyLocalDatabase();
    if (legacyRecord?.state) {
      writeLocalDatabase(legacyRecord.state);
      try {
        fileSystem.unlinkSync(getLegacyDataPath());
      } catch {
        // The verified encrypted database copy remains usable if legacy cleanup is unavailable.
      }
      return legacyRecord;
    }

    return null;
  }

  function migrateLocalAccountToPilotAccess(access) {
    const targetAccountKey = getAccountKeyFromAccess(access);
    if (!targetAccountKey || !String(access?.issuedTo || '').trim()) return null;
    if (readLocalDatabase(targetAccountKey)?.state) return null;

    // Import an older single-account store before searching account_state.
    readLocalDatabase();

    const records = getDatabase()
      .prepare('SELECT account_key, schema_version, saved_at, state_json FROM account_state ORDER BY saved_at DESC')
      .all()
      .flatMap((row) => {
        try {
          return [{
            accountKey: row.account_key,
            schemaVersion: row.schema_version,
            savedAt: row.saved_at,
            state: parseState(row.state_json)
          }];
        } catch {
          return [];
        }
      });
    const source = findReplacementAccountRecord(records, access, targetAccountKey);
    if (!source?.state) return null;

    const state = migrateStateToPilotAccess(source.state, access);
    const savedAt = now().toISOString();
    const result = writeLocalDatabase(state);
    return {
      schemaVersion: source.schemaVersion || 3,
      savedAt,
      state,
      accountKey: result.accountKey,
      source: 'local-account-migration'
    };
  }

  function writeLocalDatabase(state) {
    validateStatePayload(state);
    const db = getDatabase();
    const savedAt = now().toISOString();
    const stateJson = encodeState(JSON.stringify(state));
    const accountKey = getAccountKeyFromState(state);
    const clearLastOpened = db.prepare('UPDATE account_state SET is_last_opened = 0');
    const saveState = db.prepare(`
      INSERT INTO account_state (account_key, schema_version, saved_at, state_json, is_last_opened)
      VALUES (?, 3, ?, ?, 1)
      ON CONFLICT(account_key) DO UPDATE SET
        schema_version = excluded.schema_version,
        saved_at = excluded.saved_at,
        state_json = excluded.state_json,
        is_last_opened = 1
    `);
    const clearAccountProfileCompanions = db.prepare('DELETE FROM account_profile_companions');
    const clearAccountProfiles = db.prepare('DELETE FROM account_profiles');
    const clearLegacyProfileCompanions = db.prepare('DELETE FROM profile_companions');
    const clearLegacyProfiles = db.prepare('DELETE FROM profiles');
    db.exec('BEGIN IMMEDIATE');
    try {
      clearLastOpened.run();
      saveState.run(accountKey, savedAt, stateJson);
      clearAccountProfileCompanions.run();
      clearAccountProfiles.run();
      clearLegacyProfileCompanions.run();
      clearLegacyProfiles.run();
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return { ok: true, path: getDataPath(), engine: 'sqlite', accountKey };
  }

  function getReportCount() {
    const row = getDatabase().prepare('SELECT COUNT(*) AS count FROM analytical_reports').get();
    return Number(row?.count ?? 0);
  }

  function validateReportPayload(report) {
    if (!isRecord(report)) throw new Error('Report payload must be an object.');
    if (!isRecord(report.account)) throw new Error('Report payload is missing account details.');
    if (!isRecord(report.operational)) throw new Error('Report payload is missing operational metrics.');
    if (!isRecord(report.usage)) throw new Error('Report payload is missing usage metrics.');
  }

  async function forwardReportIfConfigured(report) {
    const endpoint = environment.TABLEMANAGER_REPORT_ENDPOINT;
    const emailTo = environment.TABLEMANAGER_REPORT_EMAIL_TO;
    const deliveryResults = [];

    if (endpoint) {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(report)
      });

      if (!response.ok) {
        throw new Error(`Report endpoint returned ${response.status}`);
      }
      deliveryResults.push('endpoint');
    }

    if (emailTo) {
      await sendReportEmail(report, emailTo);
      deliveryResults.push('email');
    }

    if (!deliveryResults.length) return { status: 'stored' };
    return { status: 'delivered', deliveredAt: now().toISOString(), channels: deliveryResults };
  }

  function getSmtpTransport() {
    const host = environment.TABLEMANAGER_SMTP_HOST;
    const user = environment.TABLEMANAGER_SMTP_USER;
    const pass = environment.TABLEMANAGER_SMTP_PASS;
    if (!host || !user || !pass) {
      throw new Error('Email delivery requires TABLEMANAGER_SMTP_HOST, TABLEMANAGER_SMTP_USER, and TABLEMANAGER_SMTP_PASS.');
    }

    const port = Number(environment.TABLEMANAGER_SMTP_PORT || 587);
    return mailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass }
    });
  }

  function buildReportEmailText(report) {
    const operational = report.operational ?? {};
    const usage = report.usage ?? {};
    const features = Array.isArray(usage.features) ? usage.features.slice(0, 8) : [];
    const actions = Array.isArray(usage.actions) ? usage.actions.slice(0, 8) : [];
    return [
      `Orbit report for ${report.account?.clubName || report.account?.accountName || 'Unknown club'}`,
      `Generated: ${report.generatedAt}`,
      '',
      `Occupied seat-hours: ${operational.occupiedSeatHours ?? 0}`,
      `Estimated time-fee revenue: $${operational.estimatedTimeFeeRevenue ?? 0}`,
      `Recorded table drop: $${operational.recordedDropTotal ?? 0}`,
      `Estimated drop revenue: $${operational.estimatedDropRevenue ?? 0}`,
      `Average wait: ${operational.averageWaitMinutes ?? 0}m`,
      `Waitlist conversion: ${operational.waitlistConversionRate ?? 0}%`,
      `Games started: ${operational.gamesStarted ?? 0}`,
      `Failed starts: ${operational.failedStarts ?? 0}`,
      `Table breaks: ${operational.tableBreaks ?? 0}`,
      '',
      'Feature usage:',
      ...features.map((entry) => `- ${entry.feature}: ${entry.count}`),
      '',
      'Action usage:',
      ...actions.map((entry) => `- ${entry.action} (${entry.feature}): ${entry.count}`),
      '',
      'Full JSON report is attached.'
    ].join('\n');
  }

  async function sendReportEmail(report, emailTo) {
    const transport = getSmtpTransport();
    const clubName = report.account?.clubName || report.account?.accountName || 'Orbit';
    const generatedDate = String(report.generatedAt || now().toISOString()).slice(0, 10);
    await transport.sendMail({
      from: environment.TABLEMANAGER_SMTP_FROM || environment.TABLEMANAGER_SMTP_USER,
      to: emailTo,
      subject: `Orbit report - ${clubName} - ${generatedDate}`,
      text: buildReportEmailText(report),
      attachments: [
        {
          filename: `tablemanager-report-${generatedDate}.json`,
          content: JSON.stringify(report, null, 2),
          contentType: 'application/json'
        }
      ]
    });
  }

  async function storeAnalyticalReport(report) {
    validateReportPayload(report);
    const db = getDatabase();
    const id = randomUUID();
    const createdAt = now().toISOString();
    const accountKey = sanitizeAccountKey(report.account.accountKey || report.account.license || report.account.email || report.account.clubName || 'unlicensed-local') || 'unlicensed-local';
    let delivery = { status: 'stored' };
    let deliveryError = '';

    try {
      delivery = await forwardReportIfConfigured(report);
    } catch (error) {
      delivery = { status: 'queued' };
      deliveryError = error instanceof Error ? error.message : 'Unable to deliver report.';
    }

    db.prepare(`
      INSERT INTO analytical_reports (
        id,
        account_key,
        created_at,
        report_json,
        delivery_status,
        delivered_at,
        delivery_error
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      accountKey,
      createdAt,
      JSON.stringify(report),
      delivery.status,
      delivery.deliveredAt ?? null,
      deliveryError
    );

    const backend = updateBackendReportCount(getReportCount());
    return { ok: true, id, accountKey, createdAt, deliveryStatus: delivery.status, backend };
  }

  return {
    buildReportEmailText,
    closeDatabase,
    forwardReportIfConfigured,
    getDataPath,
    getDatabase,
    getLegacyDataPath,
    getReportCount,
    getSmtpTransport,
    migrateLocalAccountToPilotAccess,
    readLegacyLocalDatabase,
    readLocalDatabase,
    sendReportEmail,
    storeAnalyticalReport,
    validateReportPayload,
    writeLocalDatabase
  };
}

module.exports = { createLocalStore };
