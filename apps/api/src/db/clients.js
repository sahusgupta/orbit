const { sanitizeAccountKey } = require('../orbitCore');
const { firestoreDocumentId, getDatabase } = require('./connection');
const { redactText } = require('../operations/dataProtection');

const clientsCollection = 'orbitClients';
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

function clientPath(deviceId) {
  return `${clientsCollection}/${firestoreDocumentId(deviceId)}`;
}

function mapClient(record) {
  if (!record) return null;
  return {
    deviceId: record.deviceId,
    venueId: record.venueId,
    venueName: record.venueName || '',
    deviceName: record.deviceName || '',
    appVersion: record.appVersion,
    platform: record.platform,
    environment: record.environment,
    updateStatus: record.updateStatus || '',
    updateEvent: record.updateEvent || '',
    lastSeenAt: record.lastSeenAt,
    lastError: record.lastError || '',
    currentUser: record.currentUser || null,
    firstSeenAt: record.firstSeenAt,
    updatedAt: record.updatedAt
  };
}

async function getClient(deviceId) {
  const database = await getDatabase();
  return mapClient(await database.getDocument(clientPath(String(deviceId || '').trim())));
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

async function listClients(filters = {}) {
  const database = await getDatabase();
  const queryFilters = filters.venueId
    ? [{ field: 'venueId', op: '==', value: sanitizeAccountKey(filters.venueId) }]
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
  upsertClient
};
