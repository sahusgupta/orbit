const { sanitizeAccountKey } = require('../orbitCore');
const { firestoreDocumentId, getDatabase } = require('./connection');
const {
  isHostedOrProduction,
  protectedIdentifier,
  redactStoredError,
  redactText
} = require('../operations/dataProtection');

const clientsCollection = 'orbitClients';
const containsOpaqueMaterial = (value) => /[A-Za-z0-9._~+/=-]{33,}/.test(value);
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const scopedUuidPattern = /^[a-z0-9][a-z0-9-]{0,79}:[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const protectedValuePattern = /^protected:[a-f0-9]{16}$/;
const knownPlatforms = new Set(['win32', 'darwin', 'linux']);
const knownEnvironments = new Set(['development', 'production', 'test']);
const knownUpdateStatuses = new Set(['checking', 'available', 'current', 'downloaded', 'installing', 'error', 'idle']);
const knownUpdateEvents = new Set([
  'checking-for-update',
  'update-available',
  'update-not-available',
  'update-downloaded',
  'update-install-requested',
  'update-install-approved',
  'update-install-blocked',
  'update-error'
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
const boundedDisplayText = (value, maximum) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^Protected client label [a-f0-9]{16}$/.test(raw)) return raw;
  const redacted = redactText(raw, maximum).trim();
  if (
    isHostedOrProduction(process.env)
    || redacted !== raw
    || /[\r\n\u0000-\u001f]/.test(raw)
    || containsOpaqueMaterial(raw)
  ) {
    return `Protected client label ${protectedIdentifier(raw)}`;
  }
  return redacted.slice(0, maximum);
};

function allowlistedCode(value, maximum, allowed, validator) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (!isHostedOrProduction(process.env)) return boundedText(raw, maximum);
  if (protectedValuePattern.test(raw)) return raw;
  if (allowed?.has(raw) || (typeof validator === 'function' && validator(raw))) return raw.slice(0, maximum);
  return `protected:${protectedIdentifier(raw)}`;
}

function normalizeDeviceIdentifier(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (!isHostedOrProduction(process.env)) return boundedText(raw, 180);
  if (uuidPattern.test(raw) || scopedUuidPattern.test(raw) || protectedValuePattern.test(raw)) return raw;
  return `protected:${protectedIdentifier(raw)}`;
}

const normalizeAppVersion = (value) => allowlistedCode(
  value,
  80,
  null,
  (raw) => /^v?\d{1,4}\.\d{1,4}\.\d{1,4}(?:[-+][0-9A-Za-z.-]{1,40})?$/.test(raw)
);

function normalizeVenueIdentifier(value) {
  const raw = String(value || 'unassigned').trim() || 'unassigned';
  const redacted = redactText(raw, 180).trim();
  return redacted === raw && !containsOpaqueMaterial(raw)
    ? sanitizeAccountKey(raw)
    : `protected-${protectedIdentifier(raw)}`;
}

function normalizedTimestamp(value) {
  if (!value) return undefined;
  try {
    return new Date(value).toISOString();
  } catch {
    return undefined;
  }
}

function safeStoredError(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^[A-Za-z0-9 ]{1,80}\. reference:[a-f0-9]{16}$/.test(raw)) return raw;
  return redactStoredError(raw, { maximum: 500, label: 'Client error recorded' });
}

function normalizeClientPayload(payload) {
  const now = new Date().toISOString();
  const deviceId = normalizeDeviceIdentifier(payload.deviceId);
  const venueId = normalizeVenueIdentifier(payload.venueId || payload.venueName);
  const appVersion = normalizeAppVersion(payload.appVersion);
  const platform = allowlistedCode(payload.platform, 80, knownPlatforms);
  if (!deviceId) throw new Error('deviceId is required.');
  if (!appVersion) throw new Error('appVersion is required.');
  if (!platform) throw new Error('platform is required.');
  return {
    venueId,
    venueName: boundedDisplayText(payload.venueName, 160),
    deviceId,
    deviceName: boundedDisplayText(payload.deviceName, 160),
    appVersion,
    platform,
    environment: allowlistedCode(payload.environment || process.env.NODE_ENV || 'development', 40, knownEnvironments),
    updateStatus: allowlistedCode(payload.updateStatus, 80, knownUpdateStatuses),
    updateEvent: allowlistedCode(payload.updateEvent, 100, knownUpdateEvents),
    lastSeenAt: payload.lastSeenAt ? new Date(payload.lastSeenAt).toISOString() : now,
    lastError: redactStoredError(payload.lastError, { maximum: 500, label: 'Client error recorded' }),
    currentUser: null
  };
}

function clientPath(deviceId) {
  return `${clientsCollection}/${firestoreDocumentId(deviceId)}`;
}

function mapClient(record) {
  if (!record) return null;
  return {
    deviceId: normalizeDeviceIdentifier(record.deviceId),
    venueId: normalizeVenueIdentifier(record.venueId),
    venueName: boundedDisplayText(record.venueName, 160),
    deviceName: boundedDisplayText(record.deviceName, 160),
    appVersion: normalizeAppVersion(record.appVersion),
    platform: allowlistedCode(record.platform, 80, knownPlatforms),
    environment: allowlistedCode(record.environment, 40, knownEnvironments),
    updateStatus: allowlistedCode(record.updateStatus, 80, knownUpdateStatuses),
    updateEvent: allowlistedCode(record.updateEvent, 100, knownUpdateEvents),
    lastSeenAt: normalizedTimestamp(record.lastSeenAt),
    lastError: safeStoredError(record.lastError),
    currentUser: null,
    firstSeenAt: normalizedTimestamp(record.firstSeenAt),
    updatedAt: normalizedTimestamp(record.updatedAt)
  };
}

async function getClient(deviceId, dependencies = {}) {
  const database = dependencies.database || await getDatabase();
  const rawDeviceId = String(deviceId || '').trim();
  const normalizedDeviceId = normalizeDeviceIdentifier(rawDeviceId);
  let record = await database.getDocument(clientPath(normalizedDeviceId));
  if (!record && normalizedDeviceId !== rawDeviceId) {
    // Exact legacy lookup compatibility; the returned record is still mapped
    // through the production-safe output allowlist.
    record = await database.getDocument(clientPath(rawDeviceId));
  }
  return mapClient(record);
}

async function upsertClient(payload) {
  const database = await getDatabase();
  const client = normalizeClientPayload(payload);
  const now = new Date().toISOString();
  const path = clientPath(client.deviceId);
  const record = await database.runTransaction(async (transaction) => {
    const previous = await transaction.getDocument(path);
    const next = {
      ...client,
      updateStatus: client.updateStatus || previous?.updateStatus || '',
      updateEvent: client.updateEvent || previous?.updateEvent || '',
      firstSeenAt: previous?.firstSeenAt || now,
      updatedAt: now
    };
    transaction.setDocument(path, next);
    return next;
  });
  return mapClient(record);
}

async function listClients(filters = {}, dependencies = {}) {
  const database = dependencies.database || await getDatabase();
  const queryFilters = filters.venueId
    ? [{ field: 'venueId', op: '==', value: normalizeVenueIdentifier(filters.venueId) }]
    : [];
  const orders = [
    { field: 'lastSeenAt', direction: 'desc' },
    { field: '__name__', direction: 'asc' }
  ];
  const startAfter = filters.beforeLastSeenAt
    ? [String(filters.beforeLastSeenAt), firestoreDocumentId(filters.beforeDeviceId || 'cursor')]
    : undefined;
  const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 251);
  const documents = await database.queryCollection(clientsCollection, {
    filters: queryFilters,
    orders,
    startAfter,
    limit
  });
  return documents.map((document) => mapClient(document.data));
}

module.exports = {
  clientsCollection,
  getClient,
  listClients,
  normalizeVenueIdentifier,
  normalizeDeviceIdentifier,
  normalizeAppVersion,
  upsertClient
};
