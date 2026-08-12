const crypto = require('crypto');
const { sanitizeAccountKey } = require('../orbitCore');
const { getDatabase } = require('./connection');

function normalizeAccountKey(accountKey) {
  const normalized = sanitizeAccountKey(accountKey);
  if (!normalized) throw new Error('A valid management account key is required.');
  return normalized;
}

function mapRecoveryOverride(row, now = new Date()) {
  if (!row) return null;
  const storedStatus = String(row.status || '');
  const expired = Date.parse(row.expires_at) <= now.getTime();
  return {
    id: row.id,
    accountKey: row.account_key,
    status: expired && ['active', 'processing'].includes(storedStatus) ? 'expired' : storedStatus,
    expiresAt: row.expires_at,
    reason: row.reason || '',
    createdByRef: row.created_by_ref,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    processingAt: row.processing_at || null,
    consumedAt: row.consumed_at || null,
    revokedAt: row.revoked_at || null
  };
}

async function createManagementRecoveryOverride({ accountKey, durationMinutes, reason = '', createdByRef, now = new Date() }) {
  const normalized = normalizeAccountKey(accountKey);
  const duration = Math.min(Math.max(Number(durationMinutes || 30), 5), 60);
  if (!Number.isFinite(duration)) throw new Error('Recovery duration must be between 5 and 60 minutes.');
  const actorRef = String(createdByRef || '').trim().slice(0, 120);
  if (!actorRef) throw new Error('A recovery actor reference is required.');
  const id = crypto.randomUUID();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + duration * 60_000).toISOString();
  const boundedReason = String(reason || '').trim().replace(/\s+/g, ' ').slice(0, 200);
  const database = await getDatabase();

  return database.transaction(async (transaction) => {
    await transaction.run(`
      UPDATE management_recovery_overrides
      SET status = 'revoked', revoked_at = $1, updated_at = $1
      WHERE account_key = $2 AND status IN ('active', 'processing')
    `, [createdAt, normalized]);
    await transaction.run(`
      INSERT INTO management_recovery_overrides (
        id, account_key, status, expires_at, reason, created_by_ref,
        created_at, updated_at, processing_at, consumed_at, revoked_at
      ) VALUES ($1, $2, 'active', $3, $4, $5, $6, $6, NULL, NULL, NULL)
    `, [id, normalized, expiresAt, boundedReason, actorRef, createdAt]);
    return mapRecoveryOverride(await transaction.get(
      'SELECT * FROM management_recovery_overrides WHERE id = $1',
      [id]
    ), now);
  });
}

async function getManagementRecoveryOverride(accountKey, { activeOnly = false, now = new Date() } = {}) {
  const normalized = normalizeAccountKey(accountKey);
  const database = await getDatabase();
  const row = await database.get(`
    SELECT * FROM management_recovery_overrides
    WHERE account_key = $1
      ${activeOnly ? "AND status = 'active' AND expires_at > $2" : ''}
    ORDER BY created_at DESC
    LIMIT 1
  `, activeOnly ? [normalized, now.toISOString()] : [normalized]);
  return mapRecoveryOverride(row, now);
}

async function listManagementRecoveryOverrides({ limit = 500, now = new Date() } = {}) {
  const database = await getDatabase();
  const boundedLimit = Math.min(Math.max(Number(limit || 500), 1), 1000);
  const rows = await database.all(`
    SELECT * FROM management_recovery_overrides
    ORDER BY account_key ASC, created_at DESC
    LIMIT ${boundedLimit}
  `);
  const latestByAccount = new Map();
  for (const row of rows) {
    if (!latestByAccount.has(row.account_key)) latestByAccount.set(row.account_key, mapRecoveryOverride(row, now));
  }
  return [...latestByAccount.values()];
}

async function claimManagementRecoveryOverride(accountKey, { now = new Date() } = {}) {
  const normalized = normalizeAccountKey(accountKey);
  const database = await getDatabase();
  const processingAt = now.toISOString();
  return database.transaction(async (transaction) => {
    const row = await transaction.get(`
      SELECT * FROM management_recovery_overrides
      WHERE account_key = $1 AND status = 'active' AND expires_at > $2
      ORDER BY created_at DESC
      LIMIT 1
    `, [normalized, processingAt]);
    if (!row) return null;
    const result = await transaction.run(`
      UPDATE management_recovery_overrides
      SET status = 'processing', processing_at = $1, updated_at = $1
      WHERE id = $2 AND status = 'active' AND expires_at > $1
    `, [processingAt, row.id]);
    if (result.changes !== 1) return null;
    return mapRecoveryOverride({ ...row, status: 'processing', processing_at: processingAt, updated_at: processingAt }, now);
  });
}

async function releaseManagementRecoveryClaim(id, { now = new Date() } = {}) {
  const database = await getDatabase();
  const updatedAt = now.toISOString();
  await database.run(`
    UPDATE management_recovery_overrides
    SET status = CASE WHEN expires_at > $1 THEN 'active' ELSE 'expired' END,
        processing_at = NULL,
        updated_at = $1
    WHERE id = $2 AND status = 'processing'
  `, [updatedAt, String(id || '')]);
}

async function consumeManagementRecoveryOverride(id, { now = new Date() } = {}) {
  const database = await getDatabase();
  const consumedAt = now.toISOString();
  const result = await database.run(`
    UPDATE management_recovery_overrides
    SET status = 'consumed', consumed_at = $1, updated_at = $1
    WHERE id = $2 AND status = 'processing'
  `, [consumedAt, String(id || '')]);
  return result.changes === 1;
}

async function revokeManagementRecoveryOverride(accountKey, { now = new Date() } = {}) {
  const normalized = normalizeAccountKey(accountKey);
  const database = await getDatabase();
  const revokedAt = now.toISOString();
  const result = await database.run(`
    UPDATE management_recovery_overrides
    SET status = 'revoked', revoked_at = $1, updated_at = $1
    WHERE account_key = $2 AND status IN ('active', 'processing')
  `, [revokedAt, normalized]);
  return result.changes > 0;
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
