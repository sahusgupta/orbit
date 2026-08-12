const crypto = require('crypto');
const { sanitizeAccountKey } = require('../orbitCore');
const { listClients, upsertClient } = require('./clients');
const { firestoreDocumentId, getDatabase } = require('./connection');
const { protectedIdentifier, redactDetails, redactText } = require('../operations/dataProtection');

const updateEventsCollection = 'orbitClientUpdateEvents';
const telemetryCollection = 'orbitTelemetryEvents';
const errorsCollection = 'orbitClientErrors';
const boundedText = (value, maximum) => String(value || '').trim().slice(0, maximum);

function eventPath(collection, id) {
  return `${collection}/${firestoreDocumentId(id)}`;
}

function cursorOptions(filters, defaultLimit, maximumLimit) {
  const orders = [
    { field: 'occurredAt', direction: 'desc' },
    { field: '__name__', direction: 'desc' }
  ];
  return {
    orders,
    startAfter: filters.beforeOccurredAt
      ? [String(filters.beforeOccurredAt), firestoreDocumentId(filters.beforeId || 'cursor')]
      : undefined,
    limit: Math.min(Math.max(Number(filters.limit || defaultLimit), 1), maximumLimit)
  };
}

async function recordUpdateEvent(payload) {
  const client = await upsertClient(payload);
  const event = boundedText(payload.updateEvent || payload.event, 100);
  if (!event) throw new Error('updateEvent is required.');
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const record = {
    id,
    deviceId: client.deviceId,
    venueId: client.venueId,
    event,
    status: boundedText(payload.updateStatus, 80),
    appVersion: boundedText(payload.appVersion || client.appVersion, 80),
    details: payload.details ? redactDetails(payload.details) : null,
    error: redactText(payload.lastError || payload.error, 500),
    occurredAt: payload.occurredAt ? new Date(payload.occurredAt).toISOString() : now,
    createdAt: now
  };
  const database = await getDatabase();
  await database.createDocument(eventPath(updateEventsCollection, id), record);
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
  const id = crypto.randomUUID();
  const record = {
    id,
    deviceId: client.deviceId,
    venueId: client.venueId,
    event,
    category: boundedText(payload.category || 'usage', 60),
    route: boundedText(payload.route, 100),
    appVersion: boundedText(payload.appVersion || client.appVersion, 80),
    platform: boundedText(payload.platform || client.platform, 80),
    details: payload.details ? redactDetails(payload.details) : null,
    occurredAt: payload.occurredAt ? new Date(payload.occurredAt).toISOString() : now,
    createdAt: now
  };
  const database = await getDatabase();
  await database.createDocument(eventPath(telemetryCollection, id), record);
  return record;
}

async function recordClientError(payload) {
  const client = await upsertClient({ ...payload, lastError: payload.message || payload.error || payload.lastError || '' });
  const message = redactText(payload.message || payload.error || payload.lastError, 500).trim();
  if (!message) throw new Error('message is required.');
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const record = {
    id,
    deviceId: client.deviceId,
    venueId: client.venueId,
    message,
    source: boundedText(payload.source, 100),
    route: boundedText(payload.route, 100),
    stack: process.env.ORBIT_STORE_ERROR_STACKS === 'true' && process.env.NODE_ENV !== 'production'
      ? redactText(payload.stack, 4000)
      : `fingerprint:${protectedIdentifier(payload.stack || message)}`,
    appVersion: boundedText(payload.appVersion || client.appVersion, 80),
    platform: boundedText(payload.platform || client.platform, 80),
    details: payload.details ? redactDetails(payload.details) : null,
    occurredAt: payload.occurredAt ? new Date(payload.occurredAt).toISOString() : now,
    createdAt: now
  };
  const database = await getDatabase();
  await database.createDocument(eventPath(errorsCollection, id), record);
  return record;
}

async function queryEvents(collection, filters, defaults) {
  const database = await getDatabase();
  const queryFilters = [];
  if (filters.venueId) queryFilters.push({ field: 'venueId', op: '==', value: sanitizeAccountKey(filters.venueId) });
  if (filters.deviceId) queryFilters.push({ field: 'deviceId', op: '==', value: String(filters.deviceId || '').trim() });
  const options = cursorOptions(filters, defaults.defaultLimit, defaults.maximumLimit);
  const documents = await database.queryCollection(collection, { ...options, filters: queryFilters });
  return documents.map((document) => document.data);
}

async function listClientUpdateEvents(deviceId, filters = {}) {
  return queryEvents(updateEventsCollection, { ...filters, deviceId }, { defaultLimit: 100, maximumLimit: 251 });
}

async function listTelemetryEvents(filters = {}) {
  return queryEvents(telemetryCollection, filters, { defaultLimit: 200, maximumLimit: 1000 });
}

async function listClientErrors(filters = {}) {
  return queryEvents(errorsCollection, filters, { defaultLimit: 100, maximumLimit: 500 });
}

async function getTelemetrySummary() {
  const database = await getDatabase();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [clients, activeClients24h, events, errors, tableStarts24h] = await Promise.all([
    database.countCollection('orbitClients'),
    database.countCollection('orbitClients', [{ field: 'lastSeenAt', op: '>=', value: since24h }]),
    database.countCollection(telemetryCollection),
    database.countCollection(errorsCollection),
    database.countCollection(telemetryCollection, [
      { field: 'event', op: '==', value: 'table-started' },
      { field: 'occurredAt', op: '>=', value: since24h }
    ])
  ]);
  return { clients, activeClients24h, events, errors, tableStarts24h };
}

async function getOperationalQueryPlans() {
  return {
    engine: 'firestore',
    indexes: [
      'orbitClients: venueId ASC, lastSeenAt DESC, __name__ ASC',
      'orbitTelemetryEvents: venueId/deviceId ASC, occurredAt DESC, __name__ DESC',
      'orbitClientErrors: venueId/deviceId ASC, occurredAt DESC, __name__ DESC'
    ]
  };
}

module.exports = {
  errorsCollection,
  getOperationalQueryPlans,
  getTelemetrySummary,
  listClientErrors,
  listClientUpdateEvents,
  listTelemetryEvents,
  recordClientError,
  recordTelemetryEvent,
  recordUpdateEvent,
  telemetryCollection,
  updateEventsCollection
};
