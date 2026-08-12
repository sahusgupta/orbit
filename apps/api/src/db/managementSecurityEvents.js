const crypto = require('crypto');
const { sanitizeAccountKey } = require('../orbitCore');
const { redactDetails } = require('../operations/dataProtection');
const { firestoreDocumentId, getDatabase } = require('./connection');

const securityEventsCollection = 'orbitManagementSecurityEvents';

async function recordManagementSecurityEvent(payload) {
  const accountKey = sanitizeAccountKey(payload.accountKey);
  const event = String(payload.event || '').trim().slice(0, 100);
  const actorRef = String(payload.actorRef || '').trim().slice(0, 120);
  if (!accountKey || !event || !actorRef) throw new Error('A management security event requires accountKey, event, and actorRef.');
  const id = crypto.randomUUID();
  const occurredAt = payload.occurredAt ? new Date(payload.occurredAt).toISOString() : new Date().toISOString();
  const record = {
    id,
    accountKey,
    event,
    actorRef,
    details: redactDetails(payload.details || {}),
    occurredAt,
    createdAt: occurredAt
  };
  const database = await getDatabase();
  await database.createDocument(`${securityEventsCollection}/${firestoreDocumentId(id)}`, record);
  return record;
}

async function listManagementSecurityEvents(filters = {}) {
  const database = await getDatabase();
  const queryFilters = filters.accountKey
    ? [{ field: 'accountKey', op: '==', value: sanitizeAccountKey(filters.accountKey) }]
    : [];
  const orders = [
    { field: 'occurredAt', direction: 'desc' },
    { field: '__name__', direction: 'desc' }
  ];
  const startAfter = filters.beforeOccurredAt
    ? [String(filters.beforeOccurredAt), firestoreDocumentId(filters.beforeId || 'cursor')]
    : undefined;
  const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 251);
  const documents = await database.queryCollection(securityEventsCollection, {
    filters: queryFilters,
    orders,
    startAfter,
    limit
  });
  return documents.map((document) => document.data);
}

module.exports = {
  listManagementSecurityEvents,
  recordManagementSecurityEvent,
  securityEventsCollection
};
