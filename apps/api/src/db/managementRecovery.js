const crypto = require('crypto');
const { sanitizeAccountKey } = require('../orbitCore');
const { firestoreDocumentId, getDatabase } = require('./connection');

const recoveryCollection = 'orbitManagementRecovery';
const recoveryHistoryCollection = 'orbitManagementRecoveryHistory';

function normalizeAccountKey(accountKey) {
  const normalized = sanitizeAccountKey(accountKey);
  if (!normalized) throw new Error('A valid management account key is required.');
  return normalized;
}

function recoveryPath(accountKey) {
  return `${recoveryCollection}/${firestoreDocumentId(accountKey)}`;
}

function accountKeyFromRecoveryId(id) {
  const separator = String(id || '').indexOf('~');
  return separator > 0 ? String(id).slice(0, separator) : '';
}

function mapRecoveryOverride(record, now = new Date()) {
  if (!record) return null;
  const storedStatus = String(record.status || '');
  const expired = Date.parse(record.expiresAt) <= now.getTime();
  return {
    id: record.id,
    accountKey: record.accountKey,
    status: expired && ['active', 'processing'].includes(storedStatus) ? 'expired' : storedStatus,
    expiresAt: record.expiresAt,
    reason: record.reason || '',
    createdByRef: record.createdByRef,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    processingAt: record.processingAt || null,
    consumedAt: record.consumedAt || null,
    revokedAt: record.revokedAt || null
  };
}

async function createManagementRecoveryOverride({ accountKey, durationMinutes, reason = '', createdByRef, now = new Date() }) {
  const normalized = normalizeAccountKey(accountKey);
  const duration = Math.min(Math.max(Number(durationMinutes || 30), 5), 60);
  if (!Number.isFinite(duration)) throw new Error('Recovery duration must be between 5 and 60 minutes.');
  const actorRef = String(createdByRef || '').trim().slice(0, 120);
  if (!actorRef) throw new Error('A recovery actor reference is required.');
  const id = `${normalized}~${crypto.randomUUID()}`;
  const createdAt = now.toISOString();
  const record = {
    id,
    accountKey: normalized,
    status: 'active',
    expiresAt: new Date(now.getTime() + duration * 60_000).toISOString(),
    reason: String(reason || '').trim().replace(/\s+/g, ' ').slice(0, 200),
    createdByRef: actorRef,
    createdAt,
    updatedAt: createdAt,
    processingAt: null,
    consumedAt: null,
    revokedAt: null
  };
  const database = await getDatabase();
  await database.runTransaction(async (transaction) => {
    const current = await transaction.getDocument(recoveryPath(normalized));
    if (current) {
      const archived = ['active', 'processing'].includes(current.status)
        ? { ...current, status: 'revoked', revokedAt: createdAt, updatedAt: createdAt }
        : current;
      transaction.setDocument(`${recoveryHistoryCollection}/${firestoreDocumentId(current.id)}`, archived);
    }
    transaction.setDocument(recoveryPath(normalized), record);
  });
  return mapRecoveryOverride(record, now);
}

async function getManagementRecoveryOverride(accountKey, { activeOnly = false, now = new Date() } = {}) {
  const normalized = normalizeAccountKey(accountKey);
  const database = await getDatabase();
  const mapped = mapRecoveryOverride(await database.getDocument(recoveryPath(normalized)), now);
  return activeOnly && mapped?.status !== 'active' ? null : mapped;
}

async function listManagementRecoveryOverrides({ limit = 500, now = new Date() } = {}) {
  const database = await getDatabase();
  const boundedLimit = Math.min(Math.max(Number(limit || 500), 1), 1000);
  const documents = await database.queryCollection(recoveryCollection, {
    orders: [{ field: '__name__', direction: 'asc' }],
    limit: boundedLimit
  });
  return documents.map((document) => mapRecoveryOverride(document.data, now));
}

async function claimManagementRecoveryOverride(accountKey, { now = new Date() } = {}) {
  const normalized = normalizeAccountKey(accountKey);
  const database = await getDatabase();
  const processingAt = now.toISOString();
  return database.runTransaction(async (transaction) => {
    const path = recoveryPath(normalized);
    const current = await transaction.getDocument(path);
    if (!current || current.status !== 'active' || Date.parse(current.expiresAt) <= now.getTime()) return null;
    const claimed = { ...current, status: 'processing', processingAt, updatedAt: processingAt };
    transaction.setDocument(path, claimed);
    return mapRecoveryOverride(claimed, now);
  });
}

async function releaseManagementRecoveryClaim(id, { now = new Date() } = {}) {
  const accountKey = accountKeyFromRecoveryId(id);
  if (!accountKey) return;
  const database = await getDatabase();
  const updatedAt = now.toISOString();
  await database.runTransaction(async (transaction) => {
    const path = recoveryPath(accountKey);
    const current = await transaction.getDocument(path);
    if (!current || current.id !== id || current.status !== 'processing') return;
    transaction.setDocument(path, {
      ...current,
      status: Date.parse(current.expiresAt) > now.getTime() ? 'active' : 'expired',
      processingAt: null,
      updatedAt
    });
  });
}

async function consumeManagementRecoveryOverride(id, { now = new Date() } = {}) {
  const accountKey = accountKeyFromRecoveryId(id);
  if (!accountKey) return false;
  const database = await getDatabase();
  const consumedAt = now.toISOString();
  return database.runTransaction(async (transaction) => {
    const path = recoveryPath(accountKey);
    const current = await transaction.getDocument(path);
    if (!current || current.id !== id || current.status !== 'processing') return false;
    transaction.setDocument(path, { ...current, status: 'consumed', consumedAt, updatedAt: consumedAt });
    return true;
  });
}

async function revokeManagementRecoveryOverride(accountKey, { now = new Date() } = {}) {
  const normalized = normalizeAccountKey(accountKey);
  const database = await getDatabase();
  const revokedAt = now.toISOString();
  return database.runTransaction(async (transaction) => {
    const path = recoveryPath(normalized);
    const current = await transaction.getDocument(path);
    if (!current || !['active', 'processing'].includes(current.status)) return false;
    transaction.setDocument(path, { ...current, status: 'revoked', revokedAt, updatedAt: revokedAt });
    return true;
  });
}

module.exports = {
  claimManagementRecoveryOverride,
  consumeManagementRecoveryOverride,
  createManagementRecoveryOverride,
  getManagementRecoveryOverride,
  listManagementRecoveryOverrides,
  mapRecoveryOverride,
  releaseManagementRecoveryClaim,
  revokeManagementRecoveryOverride
};
