const crypto = require('crypto');
const fs = require('fs');
const nodemailer = require('nodemailer');
const path = require('path');
const { validatePendingRetryPolicy } = require('./pendingReplayPolicy.cjs');
const { findReplacementAccountRecord, migrateStateToPilotAccess } = require('./accountMigration.cjs');
const {
  getAccountKeyFromAccess,
  getAccountKeyFromState,
  isRecord,
  sanitizeAccountKey,
  validateStatePayload
} = require('./runtimeUtils.cjs');

const cacheFormat = 'orbit-local-cache-v1';

function createLocalStore(dependencies) {
  const app = dependencies.app;
  const environment = dependencies.environment || process.env;
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const fileSystem = dependencies.fileSystem || fs;
  const mailer = dependencies.mailer || nodemailer;
  const now = dependencies.now || (() => new Date());
  const encodeState = dependencies.encodeState || ((value) => value);
  const decodeState = dependencies.decodeState || ((value) => value);
  const randomUUID = dependencies.randomUUID || (() => crypto.randomUUID());
  const updateBackendReportCount = dependencies.updateBackendReportCount || ((reportCount) => ({ reportCount }));
  const userDataPath = dependencies.userDataPath || (() => app.getPath('userData'));

  let cache;

  function emptyCache() {
    return { format: cacheFormat, lastOpenedAccountKey: '', accounts: {}, reports: [] };
  }

  function parseState(value) {
    return JSON.parse(decodeState(String(value || '')));
  }

  function getLegacyDataPath() {
    return path.join(userDataPath(), 'tablemanager-db.json');
  }

  function getDataPath() {
    return path.join(userDataPath(), 'tablemanager-cache.json');
  }

  function getDatabase() {
    if (cache) return cache;
    const filePath = getDataPath();
    if (!fileSystem.existsSync(filePath)) {
      cache = emptyCache();
      return cache;
    }
    const parsed = JSON.parse(fileSystem.readFileSync(filePath, 'utf8'));
    if (parsed?.format !== cacheFormat || !isRecord(parsed.accounts) || !Array.isArray(parsed.reports)) {
      throw new Error('The Orbit local cache format is invalid.');
    }
    cache = parsed;
    return cache;
  }

  function persistCache(next = getDatabase()) {
    const filePath = getDataPath();
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    fileSystem.mkdirSync(path.dirname(filePath), { recursive: true });
    fileSystem.writeFileSync(temporaryPath, JSON.stringify(next), 'utf8');
    // Flush the complete replacement before rename. A terminated process can
    // leave an unused temporary file, never a partially replaced queue.
    if (fileSystem.openSync && fileSystem.fsyncSync && fileSystem.closeSync) {
      const descriptor = fileSystem.openSync(temporaryPath, 'r+');
      try { fileSystem.fsyncSync(descriptor); } finally { fileSystem.closeSync(descriptor); }
    }
    fileSystem.renameSync(temporaryPath, filePath);
    cache = next;
  }

  function closeDatabase() {
    cache = undefined;
  }

  function readLegacyLocalDatabase() {
    const filePath = getLegacyDataPath();
    if (!fileSystem.existsSync(filePath)) return null;
    return JSON.parse(fileSystem.readFileSync(filePath, 'utf8'));
  }

  function mapAccountRecord(record) {
    if (!record) return null;
    return {
      schemaVersion: Number(record.schemaVersion || 3),
      savedAt: record.savedAt,
      ...(Number.isSafeInteger(record.revision) ? { revision: record.revision } : {}),
      state: parseState(record.stateJson)
    };
  }

  function readLocalDatabase(accountKey) {
    const database = getDatabase();
    const normalizedAccountKey = sanitizeAccountKey(accountKey);
    const record = normalizedAccountKey
      ? database.accounts[normalizedAccountKey]
      : database.accounts[database.lastOpenedAccountKey];
    if (record) return mapAccountRecord(record);
    if (normalizedAccountKey) return null;

    const legacyRecord = readLegacyLocalDatabase();
    if (legacyRecord?.state) {
      writeLocalDatabase(legacyRecord.state);
      try {
        fileSystem.unlinkSync(getLegacyDataPath());
      } catch {
        // The encrypted cache copy remains usable if legacy JSON cleanup is unavailable.
      }
      return legacyRecord;
    }
    return null;
  }

  function migrateLocalAccountToPilotAccess(access) {
    const targetAccountKey = getAccountKeyFromAccess(access);
    if (!targetAccountKey || !String(access?.issuedTo || '').trim()) return null;
    if (readLocalDatabase(targetAccountKey)?.state) return null;
    readLocalDatabase();

    const records = Object.entries(getDatabase().accounts)
      .flatMap(([accountKey, record]) => {
        try {
          return [{ accountKey, ...mapAccountRecord(record) }];
        } catch {
          return [];
        }
      })
      .sort((left, right) => String(right.savedAt).localeCompare(String(left.savedAt)));
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

  function writeLocalDatabase(state, revision) {
    validateStatePayload(state);
    const database = getDatabase();
    const savedAt = now().toISOString();
    const accountKey = getAccountKeyFromState(state);
    // Remote refreshes, update preservation and offline fallback must never
    // replace the only durable copy of an unacknowledged local intent.
    if (database.accounts[accountKey]?.pendingSave) {
      return { ok: false, path: getDataPath(), engine: 'file-cache', accountKey, pending: true };
    }
    database.accounts[accountKey] = {
      schemaVersion: 3,
      savedAt,
      ...(Number.isSafeInteger(revision) && revision >= 0 ? { revision }
        : Number.isSafeInteger(database.accounts[accountKey]?.revision) ? { revision: database.accounts[accountKey].revision } : {}),
      stateJson: encodeState(JSON.stringify(state))
    };
    database.lastOpenedAccountKey = accountKey;
    persistCache();
    return { ok: true, path: getDataPath(), engine: 'file-cache', accountKey };
  }

  function readPendingState(accountKey) {
    const database = getDatabase();
    const key = sanitizeAccountKey(accountKey || database.lastOpenedAccountKey);
    const record = database.accounts[key];
    if (!record?.pendingSave) return null;
    const state = parseState(record.stateJson);
    validateStatePayload(state);
    const pending = record.pendingSave;
    if (getAccountKeyFromState(state) !== key || pending.schemaVersion !== 1
      || !Number.isSafeInteger(pending.expectedRevision) || pending.expectedRevision < 0
      || !/^[a-zA-Z0-9._:-]{1,180}$/.test(pending.mutationId)
      || !/^[a-f0-9]{64}$/.test(pending.sha256)
      || (pending.transport !== undefined && !['legacy', 'checkpoint-v1'].includes(pending.transport))
      || (pending.pauseCode !== undefined && pending.pauseCode !== 'CHECKPOINT_ACK_INVALID')
      || pending.sourceBytes !== Buffer.byteLength(JSON.stringify(state), 'utf8')
      || pending.sourceBytes > 33_554_432
      || crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex') !== pending.sha256) {
      throw new Error('The pending save cannot be recovered safely. Preserve the local cache for recovery.');
    }
    const retryPolicy = pending.retryPolicy === undefined ? undefined : validatePendingRetryPolicy(pending.retryPolicy, pending);
    return { ...pending, ...(retryPolicy ? { retryPolicy } : {}), accountKey: key, state };
  }

  function writePendingState(pending) {
    validateStatePayload(pending.state);
    const accountKey = getAccountKeyFromState(pending.state);
    if (accountKey !== pending.accountKey) throw new Error('Pending save account mismatch.');
    const serialized = JSON.stringify(pending.state);
    const sourceBytes = Buffer.byteLength(serialized, 'utf8');
    if (sourceBytes > 33_554_432) throw new Error('The pending save exceeds the 32 MiB recovery budget.');
    const database = getDatabase();
    const existing = readPendingState(accountKey);
    if (existing) {
      if (existing.mutationId !== pending.mutationId || existing.sha256 !== pending.sha256) {
        throw new Error('Resolve the retained pending save before accepting another change.');
      }
      return existing;
    }
    const pendingBytes = Object.values(database.accounts).reduce((total, record) => total + Number(record.pendingSave?.sourceBytes || 0), 0);
    if (pendingBytes + sourceBytes > 67_108_864) throw new Error('The pending save queue is full. Reconnect or recover pending venues before accepting this change.');
    const metadata = {
      schemaVersion: 1, mutationId: pending.mutationId, expectedRevision: pending.expectedRevision,
      sha256: pending.sha256, sourceBytes, createdAt: now().toISOString()
    };
    const next = {
      ...database, lastOpenedAccountKey: accountKey,
      accounts: { ...database.accounts, [accountKey]: {
        schemaVersion: 3, savedAt: metadata.createdAt, revision: pending.expectedRevision,
        stateJson: encodeState(serialized), pendingSave: metadata
      } }
    };
    if (Buffer.byteLength(JSON.stringify(next), 'utf8') > 134_217_728) throw new Error('The encrypted local recovery cache is full. Preserve existing pending work before retrying.');
    // Update the in-memory view only after the encrypted state and operation
    // metadata were atomically replaced together on disk.
    persistCache(next);
    return { ...metadata, accountKey, state: pending.state };
  }

  function acknowledgePendingState(accountKey, mutationId, revision) {
    const database = getDatabase();
    const key = sanitizeAccountKey(accountKey);
    const record = database.accounts[key];
    if (!record?.pendingSave || record.pendingSave.mutationId !== mutationId) return false;
    const nextRecord = { ...record };
    if (Number.isSafeInteger(revision) && revision >= 1) nextRecord.revision = revision;
    delete nextRecord.pendingSave;
    persistCache({ ...database, accounts: { ...database.accounts, [key]: nextRecord } });
    return true;
  }

  function selectPendingTransport(accountKey, mutationId, transport) {
    if (!['legacy', 'checkpoint-v1'].includes(transport)) throw new Error('Unknown pending save transport.');
    const database = getDatabase();
    const key = sanitizeAccountKey(accountKey);
    const record = database.accounts[key];
    if (!record?.pendingSave || record.pendingSave.mutationId !== mutationId) throw new Error('The pending operation changed before transport selection.');
    if (record.pendingSave.transport && record.pendingSave.transport !== transport) throw new Error('A pending operation cannot change its receipt namespace.');
    if (!record.pendingSave.transport) {
      const nextRecord = { ...record, pendingSave: { ...record.pendingSave, transport } };
      persistCache({ ...database, accounts: { ...database.accounts, [key]: nextRecord } });
    }
    return readPendingState(key);
  }

  function pausePendingState(accountKey, mutationId) {
    const database = getDatabase();
    const key = sanitizeAccountKey(accountKey);
    const record = database.accounts[key];
    if (!record?.pendingSave || record.pendingSave.mutationId !== mutationId) return false;
    if (!record.pendingSave.pauseCode) persistCache({ ...database, accounts: { ...database.accounts,
      [key]: { ...record, pendingSave: { ...record.pendingSave, pauseCode: 'CHECKPOINT_ACK_INVALID' } } } });
    return true;
  }

  function setPendingRetryPolicy(accountKey, mutationId, policy) {
    const key = sanitizeAccountKey(accountKey);
    const pending = readPendingState(key);
    if (!pending || pending.mutationId !== mutationId) return false;
    const nextPolicy = policy === null ? null : validatePendingRetryPolicy(policy, pending);
    const database = getDatabase();
    const record = database.accounts[key];
    const pendingSave = { ...record.pendingSave };
    if (nextPolicy === null) delete pendingSave.retryPolicy;
    else pendingSave.retryPolicy = nextPolicy;
    persistCache({ ...database, accounts: { ...database.accounts, [key]: { ...record, pendingSave } } });
    return true;
  }

  function getReportCount() {
    return getDatabase().reports.length;
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
      if (!response.ok) throw new Error(`Report endpoint returned ${response.status}`);
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
    return mailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
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
      attachments: [{
        filename: `tablemanager-report-${generatedDate}.json`,
        content: JSON.stringify(report, null, 2),
        contentType: 'application/json'
      }]
    });
  }

  async function storeAnalyticalReport(report) {
    validateReportPayload(report);
    const database = getDatabase();
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
    database.reports.push({
      id,
      accountKey,
      createdAt,
      reportJson: encodeState(JSON.stringify(report)),
      deliveryStatus: delivery.status,
      deliveredAt: delivery.deliveredAt ?? null,
      deliveryError
    });
    persistCache();
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
    readPendingState,
    readLegacyLocalDatabase,
    readLocalDatabase,
    sendReportEmail,
    storeAnalyticalReport,
    validateReportPayload,
    writePendingState,
    acknowledgePendingState,
    selectPendingTransport,
    pausePendingState,
    setPendingRetryPolicy,
    writeLocalDatabase
  };
}

module.exports = { createLocalStore };
