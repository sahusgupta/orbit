const { sanitizeAccountKey } = require('../orbitCore');
const { listClients, upsertClient } = require('./clients');
const { getDatabase } = require('./connection');

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
  if (filters.beforeOccurredAt) {
    where.push('(occurred_at < ? OR (occurred_at = ? AND id < ?))');
    params.push(
      String(filters.beforeOccurredAt),
      String(filters.beforeOccurredAt),
      Number(filters.beforeId || Number.MAX_SAFE_INTEGER)
    );
  }
  const limit = Math.min(Math.max(Number(filters.limit || 200), 1), 1000);
  return getDatabase()
    .prepare(`
      SELECT * FROM client_telemetry_events
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY occurred_at DESC, id DESC
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

module.exports = {
  getTelemetrySummary,
  listClientErrors,
  listClientUpdateEvents,
  listTelemetryEvents,
  recordClientError,
  recordTelemetryEvent,
  recordUpdateEvent
};
