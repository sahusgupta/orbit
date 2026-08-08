const { sanitizeAccountKey } = require('../orbitCore');
const { getDatabase } = require('./connection');

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

function getClient(deviceId) {
  const row = getDatabase().prepare('SELECT * FROM clients WHERE device_id = ?').get(String(deviceId || '').trim());
  return mapClientRow(row);
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

module.exports = {
  getClient,
  listClients,
  upsertClient
};
