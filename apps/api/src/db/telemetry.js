const { sanitizeAccountKey } = require('../orbitCore');
const { listClients, upsertClient } = require('./clients');
const { getDatabase } = require('./connection');
const { protectedIdentifier, redactDetails, redactText } = require('../operations/dataProtection');
const boundedText = (value, maximum) => String(value || '').trim().slice(0, maximum);

async function recordUpdateEvent(payload) {
  const client = await upsertClient(payload);
  const event = boundedText(payload.updateEvent || payload.event, 100);
  if (!event) throw new Error('updateEvent is required.');
  const now = new Date().toISOString();
  const database = await getDatabase();
  await database.run(`
    INSERT INTO client_update_events (
      device_id, venue_id, event, status, app_version, details_json, error, occurred_at, created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [
    client.deviceId,
    client.venueId,
    event,
    boundedText(payload.updateStatus, 80),
    boundedText(payload.appVersion || client.appVersion, 80),
    payload.details ? JSON.stringify(redactDetails(payload.details)) : null,
    redactText(payload.lastError || payload.error, 500),
    payload.occurredAt ? new Date(payload.occurredAt).toISOString() : now,
    now
  ]);
  await recordTelemetryEvent({
    ...payload,
    event,
    category: 'update',
    details: payload.details || { status: payload.updateStatus || '' }
  });
  return client;
}

async function recordTelemetryEvent(payload) {
  const client = await upsertClient(payload);
  const event = boundedText(payload.event || payload.action, 100);
  if (!event) throw new Error('event is required.');
  const now = new Date().toISOString();
  const occurredAt = payload.occurredAt ? new Date(payload.occurredAt).toISOString() : now;
  const database = await getDatabase();
  await database.run(`
    INSERT INTO client_telemetry_events (
      device_id, venue_id, event, category, route, app_version, platform, details_json, occurred_at, created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `, [
    client.deviceId,
    client.venueId,
    event,
    boundedText(payload.category || 'usage', 60),
    boundedText(payload.route, 100),
    boundedText(payload.appVersion || client.appVersion, 80),
    boundedText(payload.platform || client.platform, 80),
    payload.details ? JSON.stringify(redactDetails(payload.details)) : null,
    occurredAt,
    now
  ]);
  return (await listTelemetryEvents({ limit: 1 }))[0];
}

async function recordClientError(payload) {
  const client = await upsertClient({ ...payload, lastError: payload.message || payload.error || payload.lastError || '' });
  const message = redactText(payload.message || payload.error || payload.lastError, 500).trim();
  if (!message) throw new Error('message is required.');
  const now = new Date().toISOString();
  const occurredAt = payload.occurredAt ? new Date(payload.occurredAt).toISOString() : now;
  const database = await getDatabase();
  await database.run(`
    INSERT INTO client_errors (
      device_id, venue_id, message, source, route, stack, app_version, platform, details_json, occurred_at, created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  `, [
    client.deviceId,
    client.venueId,
    message,
    boundedText(payload.source, 100),
    boundedText(payload.route, 100),
    process.env.ORBIT_STORE_ERROR_STACKS === 'true' && process.env.NODE_ENV !== 'production'
      ? redactText(payload.stack, 4000)
      : `fingerprint:${protectedIdentifier(payload.stack || message)}`,
    boundedText(payload.appVersion || client.appVersion, 80),
    boundedText(payload.platform || client.platform, 80),
    payload.details ? JSON.stringify(redactDetails(payload.details)) : null,
    occurredAt,
    now
  ]);
  return (await listClientErrors({ limit: 1 }))[0];
}

async function listClientUpdateEvents(deviceId, filters = {}) {
  const database = await getDatabase();
  /** @type {Array<string | number>} */
  const params = [String(deviceId || '').trim()];
  let cursor = '';
  if (filters.beforeOccurredAt) {
    cursor = 'AND (occurred_at < $2 OR (occurred_at = $3 AND id < $4))';
    params.push(String(filters.beforeOccurredAt), String(filters.beforeOccurredAt), Number(filters.beforeId || Number.MAX_SAFE_INTEGER));
  }
  const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 251);
  const rows = await database.all(`
    SELECT * FROM client_update_events
    WHERE device_id = $1 ${cursor}
    ORDER BY occurred_at DESC, id DESC
    LIMIT ${limit}
  `, params);
  return rows.map((row) => ({
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

async function listTelemetryEvents(filters = {}) {
  const params = [];
  const where = [];
  if (filters.venueId) {
    where.push(`venue_id = $${params.length + 1}`);
    params.push(sanitizeAccountKey(filters.venueId));
  }
  if (filters.deviceId) {
    where.push(`device_id = $${params.length + 1}`);
    params.push(String(filters.deviceId || '').trim());
  }
  if (filters.beforeOccurredAt) {
    const start = params.length + 1;
    where.push(`(occurred_at < $${start} OR (occurred_at = $${start + 1} AND id < $${start + 2}))`);
    params.push(
      String(filters.beforeOccurredAt),
      String(filters.beforeOccurredAt),
      Number(filters.beforeId || Number.MAX_SAFE_INTEGER)
    );
  }
  const limit = Math.min(Math.max(Number(filters.limit || 200), 1), 1000);
  const database = await getDatabase();
  const rows = await database.all(`
      SELECT * FROM client_telemetry_events
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY occurred_at DESC, id DESC
      LIMIT ${limit}
    `, params);
  return rows.map((row) => ({
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

async function listClientErrors(filters = {}) {
  const params = [];
  const where = [];
  if (filters.venueId) {
    where.push(`venue_id = $${params.length + 1}`);
    params.push(sanitizeAccountKey(filters.venueId));
  }
  if (filters.deviceId) {
    where.push(`device_id = $${params.length + 1}`);
    params.push(String(filters.deviceId || '').trim());
  }
  if (filters.beforeOccurredAt) {
    const start = params.length + 1;
    where.push(`(occurred_at < $${start} OR (occurred_at = $${start + 1} AND id < $${start + 2}))`);
    params.push(String(filters.beforeOccurredAt), String(filters.beforeOccurredAt), Number(filters.beforeId || Number.MAX_SAFE_INTEGER));
  }
  const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 500);
  const database = await getDatabase();
  const rows = await database.all(`
      SELECT * FROM client_errors
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY occurred_at DESC, id DESC
      LIMIT ${limit}
    `, params);
  return rows.map((row) => ({
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

async function getTelemetrySummary() {
  const db = await getDatabase();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [clientCountRow, activeClientCountRow, eventCountRow, errorCountRow, tableStarts24h] = await Promise.all([
    db.get('SELECT COUNT(*) AS count FROM clients'),
    db.get('SELECT COUNT(*) AS count FROM clients WHERE last_seen_at >= $1', [since24h]),
    db.get('SELECT COUNT(*) AS count FROM client_telemetry_events'),
    db.get('SELECT COUNT(*) AS count FROM client_errors'),
    db.get("SELECT COUNT(*) AS count FROM client_telemetry_events WHERE event = 'table-started' AND occurred_at >= $1", [since24h])
  ]);
  return {
    clients: Number(clientCountRow?.count || 0),
    activeClients24h: Number(activeClientCountRow?.count || 0),
    events: Number(eventCountRow?.count || 0),
    errors: Number(errorCountRow?.count || 0),
    tableStarts24h: Number(tableStarts24h?.count || 0)
  };
}

async function getOperationalQueryPlans() {
  const db = await getDatabase();
  if (db.engine !== 'sqlite') return null;
  const venueTelemetry = await db.all(`
    EXPLAIN QUERY PLAN
    SELECT * FROM client_telemetry_events
    WHERE venue_id = $1
    ORDER BY occurred_at DESC, id DESC
    LIMIT 100
  `, ['query-plan-evidence']);
  const venueClients = await db.all(`
    EXPLAIN QUERY PLAN
    SELECT * FROM clients
    WHERE venue_id = $1
    ORDER BY last_seen_at DESC, device_id ASC
    LIMIT 100
  `, ['query-plan-evidence']);
  return { venueClients, venueTelemetry };
}

module.exports = {
  getOperationalQueryPlans,
  getTelemetrySummary,
  listClientErrors,
  listClientUpdateEvents,
  listTelemetryEvents,
  recordClientError,
  recordTelemetryEvent,
  recordUpdateEvent
};
