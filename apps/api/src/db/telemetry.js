const crypto = require('crypto');
const {
  normalizeAppVersion,
  normalizeDeviceIdentifier,
  normalizeVenueIdentifier,
  upsertClient
} = require('./clients');
const { firestoreDocumentId, getDatabase } = require('./connection');
const {
  isHostedOrProduction,
  protectedIdentifier,
  redactDetails,
  redactStoredError,
  redactText
} = require('../operations/dataProtection');

const updateEventsCollection = 'orbitClientUpdateEvents';
const telemetryCollection = 'orbitTelemetryEvents';
const errorsCollection = 'orbitClientErrors';
const containsOpaqueMaterial = (value) => /[A-Za-z0-9._~+/=-]{33,}/.test(value);
const knownCategories = new Set(['usage', 'lifecycle', 'tables', 'outreach', 'settings', 'security', 'update', 'operations']);
const knownPlatforms = new Set(['win32', 'darwin', 'linux']);
const knownRoutes = new Set([
  'access', 'floor', 'table', 'builder', 'profiles', 'signals', 'summary',
  'customization', 'kpis', 'tournaments', 'tournament-tv'
]);
const knownSources = new Set(['main', 'renderer', 'renderer-window-error', 'renderer-unhandled-rejection']);
const knownUpdateStatuses = new Set(['checking', 'available', 'current', 'downloaded', 'installing', 'error', 'idle']);
const knownUpdateEvents = new Set([
  'checking-for-update', 'update-available', 'update-not-available', 'update-downloaded',
  'update-install-requested', 'update-install-approved', 'update-install-blocked', 'update-error'
]);
const knownTelemetryEvents = new Set([
  ...knownUpdateEvents,
  'app-opened', 'app-closed', 'table-started', 'update-download-progress', 'update-installing',
  'player-outreach-texts', 'self-check-in-kit-saved', 'self-check-in-kit-save-failed',
  'staff-verification-succeeded', 'staff-verification-failed',
  'staff-authorization-succeeded', 'staff-authorization-failed'
]);
const boundedText = (value, maximum) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const redacted = redactText(raw, maximum).trim();
  if (redacted !== raw || containsOpaqueMaterial(raw) || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(raw)) {
    return `protected:${protectedIdentifier(raw)}`;
  }
  return raw.slice(0, maximum);
};
const allowlistedCode = (value, maximum, allowed) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (!isHostedOrProduction(process.env)) return boundedText(raw, maximum);
  if (/^protected:[a-f0-9]{16}$/.test(raw)) return raw;
  return allowed.has(raw) ? raw.slice(0, maximum) : `protected:${protectedIdentifier(raw)}`;
};
const telemetryDetails = (details) => {
  if (!details || isHostedOrProduction(process.env)) return null;
  return redactDetails(details);
};

function normalizedTimestamp(value) {
  if (!value) return undefined;
  try {
    return new Date(value).toISOString();
  } catch {
    return undefined;
  }
}

function safeReference(value) {
  const raw = String(value || '').trim();
  return /^[a-f0-9]{16}$/.test(raw) ? raw : protectedIdentifier(raw);
}

function safeRecordId(value) {
  const raw = String(value || '').trim();
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(raw)
    ? raw
    : boundedText(raw, 180);
}

function safeStoredError(value, label) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^[A-Za-z0-9 ]{1,80}\. reference:[a-f0-9]{16}$/.test(raw)) return raw;
  return redactStoredError(raw, { maximum: 500, label });
}

function baseEventRecord(record) {
  return {
    id: safeRecordId(record?.id),
    deviceId: normalizeDeviceIdentifier(record?.deviceId),
    venueId: normalizeVenueIdentifier(record?.venueId),
    event: allowlistedCode(record?.event, 100, knownTelemetryEvents),
    appVersion: normalizeAppVersion(record?.appVersion),
    details: telemetryDetails(record?.details),
    occurredAt: normalizedTimestamp(record?.occurredAt),
    createdAt: normalizedTimestamp(record?.createdAt)
  };
}

function mapUpdateEvent(record) {
  return {
    ...baseEventRecord(record),
    status: allowlistedCode(record?.status, 80, knownUpdateStatuses),
    error: safeStoredError(record?.error, 'Client update error recorded')
  };
}

function mapTelemetryEvent(record) {
  return {
    ...baseEventRecord(record),
    category: allowlistedCode(record?.category, 60, knownCategories),
    route: allowlistedCode(record?.route, 100, knownRoutes),
    platform: allowlistedCode(record?.platform, 80, knownPlatforms)
  };
}

function mapClientError(record) {
  const rawStack = String(record?.stack || '').trim();
  const stack = process.env.ORBIT_STORE_ERROR_STACKS === 'true' && !isHostedOrProduction(process.env)
    ? redactText(rawStack, 4_000)
    : /^fingerprint:[a-f0-9]{16}$/.test(rawStack)
      ? rawStack
      : `fingerprint:${protectedIdentifier(rawStack || record?.message)}`;
  return {
    id: safeRecordId(record?.id),
    deviceId: normalizeDeviceIdentifier(record?.deviceId),
    venueId: normalizeVenueIdentifier(record?.venueId),
    message: safeStoredError(record?.message, 'Client error recorded'),
    errorRef: safeReference(record?.errorRef || rawStack || record?.message),
    source: allowlistedCode(record?.source, 100, knownSources),
    route: allowlistedCode(record?.route, 100, knownRoutes),
    stack,
    appVersion: normalizeAppVersion(record?.appVersion),
    platform: allowlistedCode(record?.platform, 80, knownPlatforms),
    details: telemetryDetails(record?.details),
    occurredAt: normalizedTimestamp(record?.occurredAt),
    createdAt: normalizedTimestamp(record?.createdAt)
  };
}

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
  const event = allowlistedCode(payload.updateEvent || payload.event, 100, knownUpdateEvents);
  if (!event) throw new Error('updateEvent is required.');
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const record = {
    id,
    deviceId: client.deviceId,
    venueId: client.venueId,
    event,
    status: allowlistedCode(payload.updateStatus, 80, knownUpdateStatuses),
    appVersion: normalizeAppVersion(payload.appVersion || client.appVersion),
    details: telemetryDetails(payload.details),
    error: redactStoredError(payload.lastError || payload.error, {
      maximum: 500,
      label: 'Client update error recorded'
    }),
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
  const event = allowlistedCode(payload.event || payload.action, 100, knownTelemetryEvents);
  if (!event) throw new Error('event is required.');
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const record = {
    id,
    deviceId: client.deviceId,
    venueId: client.venueId,
    event,
    category: allowlistedCode(payload.category || 'usage', 60, knownCategories),
    route: allowlistedCode(payload.route, 100, knownRoutes),
    appVersion: normalizeAppVersion(payload.appVersion || client.appVersion),
    platform: allowlistedCode(payload.platform || client.platform, 80, knownPlatforms),
    details: telemetryDetails(payload.details),
    occurredAt: payload.occurredAt ? new Date(payload.occurredAt).toISOString() : now,
    createdAt: now
  };
  const database = await getDatabase();
  await database.createDocument(eventPath(telemetryCollection, id), record);
  return record;
}

async function recordClientError(payload) {
  const client = await upsertClient({ ...payload, lastError: payload.message || payload.error || payload.lastError || '' });
  const rawMessage = String(payload.message || payload.error || payload.lastError || '').trim();
  const message = redactStoredError(rawMessage, { maximum: 500, label: 'Client error recorded' });
  if (!message) throw new Error('message is required.');
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const record = {
    id,
    deviceId: client.deviceId,
    venueId: client.venueId,
    message,
    errorRef: protectedIdentifier(payload.stack || rawMessage),
    source: allowlistedCode(payload.source, 100, knownSources),
    route: allowlistedCode(payload.route, 100, knownRoutes),
    stack: process.env.ORBIT_STORE_ERROR_STACKS === 'true' && process.env.NODE_ENV !== 'production'
      ? redactText(payload.stack, 4000)
      : `fingerprint:${protectedIdentifier(payload.stack || message)}`,
    appVersion: normalizeAppVersion(payload.appVersion || client.appVersion),
    platform: allowlistedCode(payload.platform || client.platform, 80, knownPlatforms),
    details: telemetryDetails(payload.details),
    occurredAt: payload.occurredAt ? new Date(payload.occurredAt).toISOString() : now,
    createdAt: now
  };
  const database = await getDatabase();
  await database.createDocument(eventPath(errorsCollection, id), record);
  return record;
}

async function queryEvents(collection, filters, defaults, mapRecord, dependencies = {}) {
  const database = dependencies.database || await getDatabase();
  const queryFilters = [];
  if (filters.venueId) queryFilters.push({ field: 'venueId', op: '==', value: normalizeVenueIdentifier(filters.venueId) });
  const rawDeviceId = String(filters.deviceId || '').trim();
  const normalizedDeviceId = normalizeDeviceIdentifier(rawDeviceId);
  if (rawDeviceId) queryFilters.push({ field: 'deviceId', op: '==', value: normalizedDeviceId });
  const options = cursorOptions(filters, defaults.defaultLimit, defaults.maximumLimit);
  let documents = await database.queryCollection(collection, { ...options, filters: queryFilters });
  if (!documents.length && rawDeviceId && normalizedDeviceId !== rawDeviceId) {
    const legacyFilters = queryFilters.map((filter) => filter.field === 'deviceId'
      ? { ...filter, value: rawDeviceId }
      : filter);
    documents = await database.queryCollection(collection, { ...options, filters: legacyFilters });
  }
  return documents.map((document) => mapRecord(document.data));
}

async function listClientUpdateEvents(deviceId, filters = {}, dependencies = {}) {
  return queryEvents(
    updateEventsCollection,
    { ...filters, deviceId },
    { defaultLimit: 100, maximumLimit: 251 },
    mapUpdateEvent,
    dependencies
  );
}

async function listTelemetryEvents(filters = {}, dependencies = {}) {
  return queryEvents(
    telemetryCollection,
    filters,
    { defaultLimit: 200, maximumLimit: 1000 },
    mapTelemetryEvent,
    dependencies
  );
}

async function listClientErrors(filters = {}, dependencies = {}) {
  return queryEvents(errorsCollection, filters, { defaultLimit: 100, maximumLimit: 500 }, mapClientError, dependencies);
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
