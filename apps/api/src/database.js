const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { getAccountKeyFromState, sanitizeAccountKey, validateStatePayload } = require('./orbitCore');

let database;

function getDatabasePath() {
  const defaultDatabaseUrl = process.env.VERCEL ? 'file:/tmp/orbit-api.sqlite3' : 'file:./data/orbit-api.sqlite3';
  const configured = process.env.DATABASE_URL || defaultDatabaseUrl;
  if (configured.startsWith('file:')) {
    return path.resolve(process.cwd(), configured.slice('file:'.length));
  }
  if (/^postgres(?:ql)?:\/\//i.test(configured)) {
    throw new Error('Postgres DATABASE_URL is reserved for a future adapter. Use file:./data/orbit-api.sqlite3 for local SQLite.');
  }
  return path.resolve(process.cwd(), configured);
}

function getDatabase() {
  if (database) return database;
  const filePath = getDatabasePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  database = new DatabaseSync(filePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS clients (
      device_id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      venue_name TEXT,
      device_name TEXT,
      app_version TEXT NOT NULL,
      platform TEXT NOT NULL,
      environment TEXT NOT NULL,
      update_status TEXT,
      update_event TEXT,
      last_seen_at TEXT NOT NULL,
      last_error TEXT,
      current_user_json TEXT,
      first_seen_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS clients_venue_id_idx ON clients (venue_id);
    CREATE INDEX IF NOT EXISTS clients_last_seen_at_idx ON clients (last_seen_at);

    CREATE TABLE IF NOT EXISTS client_update_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      venue_id TEXT NOT NULL,
      event TEXT NOT NULL,
      status TEXT,
      app_version TEXT,
      details_json TEXT,
      error TEXT,
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (device_id) REFERENCES clients(device_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS client_telemetry_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      venue_id TEXT NOT NULL,
      event TEXT NOT NULL,
      category TEXT NOT NULL,
      route TEXT,
      app_version TEXT,
      platform TEXT,
      details_json TEXT,
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS client_telemetry_events_occurred_at_idx ON client_telemetry_events (occurred_at);
    CREATE INDEX IF NOT EXISTS client_telemetry_events_venue_id_idx ON client_telemetry_events (venue_id);

    CREATE TABLE IF NOT EXISTS client_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      venue_id TEXT NOT NULL,
      message TEXT NOT NULL,
      source TEXT,
      route TEXT,
      stack TEXT,
      app_version TEXT,
      platform TEXT,
      details_json TEXT,
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS client_errors_occurred_at_idx ON client_errors (occurred_at);
    CREATE INDEX IF NOT EXISTS client_errors_venue_id_idx ON client_errors (venue_id);

    CREATE TABLE IF NOT EXISTS account_state (
      account_key TEXT PRIMARY KEY,
      venue_name TEXT,
      schema_version INTEGER NOT NULL,
      saved_at TEXT NOT NULL,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS account_profiles (
      account_key TEXT NOT NULL,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (account_key, id),
      FOREIGN KEY (account_key) REFERENCES account_state(account_key) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS analytical_reports (
      id TEXT PRIMARY KEY,
      account_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      report_json TEXT NOT NULL,
      delivery_status TEXT NOT NULL DEFAULT 'stored',
      delivery_error TEXT
    );
  `);
  return database;
}

function normalizeClientPayload(payload) {
  const now = new Date().toISOString();
  const deviceId = String(payload.deviceId || '').trim();
  const venueId = sanitizeAccountKey(payload.venueId || payload.venueName || 'unassigned');
  const appVersion = String(payload.appVersion || '').trim();
  const platform = String(payload.platform || '').trim();
  if (!deviceId) throw new Error('deviceId is required.');
  if (!appVersion) throw new Error('appVersion is required.');
  if (!platform) throw new Error('platform is required.');
  return {
    venueId,
    venueName: String(payload.venueName || '').trim(),
    deviceId,
    deviceName: String(payload.deviceName || '').trim(),
    appVersion,
    platform,
    environment: String(payload.environment || process.env.NODE_ENV || 'development').trim(),
    updateStatus: String(payload.updateStatus || '').trim(),
    updateEvent: String(payload.updateEvent || '').trim(),
    lastSeenAt: payload.lastSeenAt ? new Date(payload.lastSeenAt).toISOString() : now,
    lastError: String(payload.lastError || '').trim(),
    currentUser: payload.currentUser && typeof payload.currentUser === 'object' ? payload.currentUser : null
  };
}

function upsertClient(payload) {
  const db = getDatabase();
  const client = normalizeClientPayload(payload);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO clients (
      device_id, venue_id, venue_name, device_name, app_version, platform, environment,
      update_status, update_event, last_seen_at, last_error, current_user_json, first_seen_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(device_id) DO UPDATE SET
      venue_id = excluded.venue_id,
      venue_name = excluded.venue_name,
      device_name = excluded.device_name,
      app_version = excluded.app_version,
      platform = excluded.platform,
      environment = excluded.environment,
      update_status = COALESCE(NULLIF(excluded.update_status, ''), clients.update_status),
      update_event = COALESCE(NULLIF(excluded.update_event, ''), clients.update_event),
      last_seen_at = excluded.last_seen_at,
      last_error = excluded.last_error,
      current_user_json = excluded.current_user_json,
      updated_at = excluded.updated_at
  `).run(
    client.deviceId,
    client.venueId,
    client.venueName,
    client.deviceName,
    client.appVersion,
    client.platform,
    client.environment,
    client.updateStatus,
    client.updateEvent,
    client.lastSeenAt,
    client.lastError,
    client.currentUser ? JSON.stringify(client.currentUser) : null,
    now,
    now
  );
  return getClient(client.deviceId);
}

function recordUpdateEvent(payload) {
  const client = upsertClient(payload);
  const event = String(payload.updateEvent || payload.event || '').trim();
  if (!event) throw new Error('updateEvent is required.');
  const now = new Date().toISOString();
  getDatabase().prepare(`
    INSERT INTO client_update_events (
      device_id, venue_id, event, status, app_version, details_json, error, occurred_at, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    client.deviceId,
    client.venueId,
    event,
    String(payload.updateStatus || '').trim(),
    String(payload.appVersion || client.appVersion || '').trim(),
    payload.details ? JSON.stringify(payload.details) : null,
    String(payload.lastError || payload.error || '').trim(),
    payload.occurredAt ? new Date(payload.occurredAt).toISOString() : now,
    now
  );
  recordTelemetryEvent({
    ...payload,
    event,
    category: 'update',
    details: payload.details || { status: payload.updateStatus || '' }
  });
  return client;
}

function recordTelemetryEvent(payload) {
  const client = upsertClient(payload);
  const event = String(payload.event || payload.action || '').trim();
  if (!event) throw new Error('event is required.');
  const now = new Date().toISOString();
  const occurredAt = payload.occurredAt ? new Date(payload.occurredAt).toISOString() : now;
  getDatabase().prepare(`
    INSERT INTO client_telemetry_events (
      device_id, venue_id, event, category, route, app_version, platform, details_json, occurred_at, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    client.deviceId,
    client.venueId,
    event,
    String(payload.category || 'usage').trim(),
    String(payload.route || '').trim(),
    String(payload.appVersion || client.appVersion || '').trim(),
    String(payload.platform || client.platform || '').trim(),
    payload.details ? JSON.stringify(payload.details) : null,
    occurredAt,
    now
  );
  return listTelemetryEvents({ limit: 1 })[0];
}

function recordClientError(payload) {
  const client = upsertClient({ ...payload, lastError: payload.message || payload.error || payload.lastError || '' });
  const message = String(payload.message || payload.error || payload.lastError || '').trim();
  if (!message) throw new Error('message is required.');
  const now = new Date().toISOString();
  const occurredAt = payload.occurredAt ? new Date(payload.occurredAt).toISOString() : now;
  getDatabase().prepare(`
    INSERT INTO client_errors (
      device_id, venue_id, message, source, route, stack, app_version, platform, details_json, occurred_at, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    client.deviceId,
    client.venueId,
    message.slice(0, 2000),
    String(payload.source || '').trim(),
    String(payload.route || '').trim(),
    String(payload.stack || '').slice(0, 8000),
    String(payload.appVersion || client.appVersion || '').trim(),
    String(payload.platform || client.platform || '').trim(),
    payload.details ? JSON.stringify(payload.details) : null,
    occurredAt,
    now
  );
  return listClientErrors({ limit: 1 })[0];
}

function mapClientRow(row) {
  if (!row) return null;
  return {
    deviceId: row.device_id,
    venueId: row.venue_id,
    venueName: row.venue_name || '',
    deviceName: row.device_name || '',
    appVersion: row.app_version,
    platform: row.platform,
    environment: row.environment,
    updateStatus: row.update_status || '',
    updateEvent: row.update_event || '',
    lastSeenAt: row.last_seen_at,
    lastError: row.last_error || '',
    currentUser: row.current_user_json ? JSON.parse(row.current_user_json) : null,
    firstSeenAt: row.first_seen_at,
    updatedAt: row.updated_at
  };
}

function listClients(filters = {}) {
  const params = [];
  let where = '';
  if (filters.venueId) {
    where = 'WHERE venue_id = ?';
    params.push(sanitizeAccountKey(filters.venueId));
  }
  return getDatabase()
    .prepare(`SELECT * FROM clients ${where} ORDER BY last_seen_at DESC`)
    .all(...params)
    .map(mapClientRow);
}

function getClient(deviceId) {
  const row = getDatabase().prepare('SELECT * FROM clients WHERE device_id = ?').get(String(deviceId || '').trim());
  return mapClientRow(row);
}

function listClientUpdateEvents(deviceId) {
  return getDatabase()
    .prepare('SELECT * FROM client_update_events WHERE device_id = ? ORDER BY occurred_at DESC LIMIT 100')
    .all(String(deviceId || '').trim())
    .map((row) => ({
      id: row.id,
      deviceId: row.device_id,
      venueId: row.venue_id,
      event: row.event,
      status: row.status || '',
      appVersion: row.app_version || '',
      details: row.details_json ? JSON.parse(row.details_json) : null,
      error: row.error || '',
      occurredAt: row.occurred_at,
      createdAt: row.created_at
    }));
}

function listTelemetryEvents(filters = {}) {
  const params = [];
  const where = [];
  if (filters.venueId) {
    where.push('venue_id = ?');
    params.push(sanitizeAccountKey(filters.venueId));
  }
  if (filters.deviceId) {
    where.push('device_id = ?');
    params.push(String(filters.deviceId || '').trim());
  }
  const limit = Math.min(Math.max(Number(filters.limit || 200), 1), 1000);
  return getDatabase()
    .prepare(`
      SELECT * FROM client_telemetry_events
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY occurred_at DESC
      LIMIT ${limit}
    `)
    .all(...params)
    .map((row) => ({
      id: row.id,
      deviceId: row.device_id,
      venueId: row.venue_id,
      event: row.event,
      category: row.category,
      route: row.route || '',
      appVersion: row.app_version || '',
      platform: row.platform || '',
      details: row.details_json ? JSON.parse(row.details_json) : null,
      occurredAt: row.occurred_at,
      createdAt: row.created_at
    }));
}

function listClientErrors(filters = {}) {
  const params = [];
  const where = [];
  if (filters.venueId) {
    where.push('venue_id = ?');
    params.push(sanitizeAccountKey(filters.venueId));
  }
  if (filters.deviceId) {
    where.push('device_id = ?');
    params.push(String(filters.deviceId || '').trim());
  }
  const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 500);
  return getDatabase()
    .prepare(`
      SELECT * FROM client_errors
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY occurred_at DESC
      LIMIT ${limit}
    `)
    .all(...params)
    .map((row) => ({
      id: row.id,
      deviceId: row.device_id,
      venueId: row.venue_id,
      message: row.message,
      source: row.source || '',
      route: row.route || '',
      stack: row.stack || '',
      appVersion: row.app_version || '',
      platform: row.platform || '',
      details: row.details_json ? JSON.parse(row.details_json) : null,
      occurredAt: row.occurred_at,
      createdAt: row.created_at
    }));
}

function getTelemetrySummary() {
  const db = getDatabase();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const clients = listClients();
  const activeClients24h = clients.filter((client) => client.lastSeenAt >= since24h).length;
  const eventCountRow = db.prepare('SELECT COUNT(*) AS count FROM client_telemetry_events').get();
  const errorCountRow = db.prepare('SELECT COUNT(*) AS count FROM client_errors').get();
  const tableStarts24h = db
    .prepare("SELECT COUNT(*) AS count FROM client_telemetry_events WHERE event = 'table-started' AND occurred_at >= ?")
    .get(since24h);
  return {
    clients: clients.length,
    activeClients24h,
    events: Number(eventCountRow?.count || 0),
    errors: Number(errorCountRow?.count || 0),
    tableStarts24h: Number(tableStarts24h?.count || 0)
  };
}

function saveState(state) {
  validateStatePayload(state);
  const db = getDatabase();
  const accountKey = getAccountKeyFromState(state);
  const savedAt = new Date().toISOString();
  const venueName = state.settings?.clubAccount?.clubName || '';
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      INSERT INTO account_state (account_key, venue_name, schema_version, saved_at, state_json, updated_at)
      VALUES (?, ?, 1, ?, ?, ?)
      ON CONFLICT(account_key) DO UPDATE SET
        venue_name = excluded.venue_name,
        schema_version = excluded.schema_version,
        saved_at = excluded.saved_at,
        state_json = excluded.state_json,
        updated_at = excluded.updated_at
    `).run(accountKey, venueName, savedAt, JSON.stringify(state), savedAt);
    db.prepare('DELETE FROM account_profiles WHERE account_key = ?').run(accountKey);
    const insertProfile = db.prepare(`
      INSERT INTO account_profiles (account_key, id, name, raw_json, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const profile of state.profiles || []) {
      insertProfile.run(accountKey, profile.id, profile.name || '', JSON.stringify(profile), savedAt);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { accountKey, savedAt };
}

function loadState(accountKey) {
  const normalized = sanitizeAccountKey(accountKey);
  const row = getDatabase()
    .prepare('SELECT account_key, venue_name, schema_version, saved_at, state_json FROM account_state WHERE account_key = ?')
    .get(normalized);
  if (!row) return null;
  return {
    accountKey: row.account_key,
    venueName: row.venue_name || '',
    schemaVersion: row.schema_version,
    savedAt: row.saved_at,
    state: JSON.parse(row.state_json)
  };
}

function loadLatestState() {
  const row = getDatabase()
    .prepare('SELECT account_key, venue_name, schema_version, saved_at, state_json FROM account_state ORDER BY saved_at DESC LIMIT 1')
    .get();
  if (!row) return null;
  return {
    accountKey: row.account_key,
    venueName: row.venue_name || '',
    schemaVersion: row.schema_version,
    savedAt: row.saved_at,
    state: JSON.parse(row.state_json)
  };
}

function listVenues() {
  return getDatabase()
    .prepare(`
      SELECT
        account_state.account_key AS venue_id,
        account_state.venue_name AS venue_name,
        account_state.saved_at AS saved_at,
        COUNT(DISTINCT clients.device_id) AS client_count
      FROM account_state
      LEFT JOIN clients ON clients.venue_id = account_state.account_key
      GROUP BY account_state.account_key
      ORDER BY account_state.saved_at DESC
    `)
    .all()
    .map((row) => ({
      venueId: row.venue_id,
      venueName: row.venue_name || '',
      savedAt: row.saved_at,
      clientCount: Number(row.client_count || 0)
    }));
}

function storeAnalyticalReport(report) {
  if (!report || typeof report !== 'object') throw new Error('Report payload must be an object.');
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const accountKey = sanitizeAccountKey(report.account?.accountKey || report.account?.license || report.account?.email || report.account?.clubName || 'unlicensed-local');
  getDatabase().prepare(`
    INSERT INTO analytical_reports (id, account_key, created_at, report_json, delivery_status, delivery_error)
    VALUES (?, ?, ?, ?, 'stored', '')
  `).run(id, accountKey, createdAt, JSON.stringify(report));
  return { ok: true, id, accountKey, createdAt, deliveryStatus: 'stored' };
}

function closeDatabase() {
  if (database) {
    database.close();
    database = undefined;
  }
}

module.exports = {
  closeDatabase,
  getClient,
  getDatabasePath,
  listClients,
  listClientErrors,
  listClientUpdateEvents,
  listTelemetryEvents,
  listVenues,
  loadLatestState,
  loadState,
  getTelemetrySummary,
  recordClientError,
  recordTelemetryEvent,
  recordUpdateEvent,
  saveState,
  storeAnalyticalReport,
  upsertClient
};
