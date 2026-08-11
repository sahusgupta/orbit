const { sanitizeAccountKey } = require('../orbitCore');
const { getDatabase } = require('./connection');
const { redactText } = require('../http/dataProtection');

const boundedText = (value, maximum) => String(value || '').trim().slice(0, maximum);

function normalizeClientPayload(payload) {
  const now = new Date().toISOString();
  const deviceId = boundedText(payload.deviceId, 180);
  const venueId = sanitizeAccountKey(payload.venueId || payload.venueName || 'unassigned');
  const appVersion = boundedText(payload.appVersion, 80);
  const platform = boundedText(payload.platform, 80);
  if (!deviceId) throw new Error('deviceId is required.');
  if (!appVersion) throw new Error('appVersion is required.');
  if (!platform) throw new Error('platform is required.');
  return {
    venueId,
    venueName: boundedText(payload.venueName, 160),
    deviceId,
    deviceName: boundedText(payload.deviceName, 160),
    appVersion,
    platform,
    environment: boundedText(payload.environment || process.env.NODE_ENV || 'development', 40),
    updateStatus: boundedText(payload.updateStatus, 80),
    updateEvent: boundedText(payload.updateEvent, 100),
    lastSeenAt: payload.lastSeenAt ? new Date(payload.lastSeenAt).toISOString() : now,
    lastError: redactText(payload.lastError, 500),
    currentUser: null
  };
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

async function getClient(deviceId) {
  const database = await getDatabase();
  const row = await database.get('SELECT * FROM clients WHERE device_id = $1', [String(deviceId || '').trim()]);
  return mapClientRow(row);
}

async function upsertClient(payload) {
  const db = await getDatabase();
  const client = normalizeClientPayload(payload);
  const now = new Date().toISOString();
  await db.run(`
    INSERT INTO clients (
      device_id, venue_id, venue_name, device_name, app_version, platform, environment,
      update_status, update_event, last_seen_at, last_error, current_user_json, first_seen_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
  `, [
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
  ]);
  return getClient(client.deviceId);
}

async function listClients(filters = {}) {
  const params = [];
  const conditions = [];
  if (filters.venueId) {
    conditions.push(`venue_id = $${params.length + 1}`);
    params.push(sanitizeAccountKey(filters.venueId));
  }
  if (filters.beforeLastSeenAt) {
    const index = params.length + 1;
    conditions.push(`(last_seen_at < $${index} OR (last_seen_at = $${index + 1} AND device_id > $${index + 2}))`);
    params.push(String(filters.beforeLastSeenAt), String(filters.beforeLastSeenAt), String(filters.beforeDeviceId || ''));
  }
  const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 251);
  const database = await getDatabase();
  const rows = await database.all(`
    SELECT * FROM clients
    ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
    ORDER BY last_seen_at DESC, device_id ASC
    LIMIT ${limit}
  `, params);
  return rows.map(mapClientRow);
}

module.exports = {
  getClient,
  listClients,
  upsertClient
};
