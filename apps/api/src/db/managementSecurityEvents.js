const crypto = require('crypto');
const { sanitizeAccountKey } = require('../orbitCore');
const { redactDetails } = require('../operations/dataProtection');
const { getDatabase } = require('./connection');

function mapSecurityEvent(row) {
  return {
    id: row.id,
    accountKey: row.account_key,
    event: row.event,
    actorRef: row.actor_ref,
    details: row.details_json ? JSON.parse(row.details_json) : {},
    occurredAt: row.occurred_at,
    createdAt: row.created_at
  };
}

async function recordManagementSecurityEvent(payload) {
  const accountKey = sanitizeAccountKey(payload.accountKey);
  const event = String(payload.event || '').trim().slice(0, 100);
  const actorRef = String(payload.actorRef || '').trim().slice(0, 120);
  if (!accountKey || !event || !actorRef) throw new Error('A management security event requires accountKey, event, and actorRef.');
  const id = crypto.randomUUID();
  const occurredAt = payload.occurredAt ? new Date(payload.occurredAt).toISOString() : new Date().toISOString();
  const database = await getDatabase();
  await database.run(`
    INSERT INTO management_security_events (
      id, account_key, event, actor_ref, details_json, occurred_at, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $6)
  `, [id, accountKey, event, actorRef, JSON.stringify(redactDetails(payload.details || {})), occurredAt]);
  return mapSecurityEvent(await database.get('SELECT * FROM management_security_events WHERE id = $1', [id]));
}

async function listManagementSecurityEvents(filters = {}) {
  const database = await getDatabase();
  const params = [];
  const where = [];
  if (filters.accountKey) {
    params.push(sanitizeAccountKey(filters.accountKey));
    where.push(`account_key = $${params.length}`);
  }
  if (filters.beforeOccurredAt) {
    const start = params.length + 1;
    params.push(String(filters.beforeOccurredAt), String(filters.beforeOccurredAt), String(filters.beforeId || ''));
    where.push(`(occurred_at < $${start} OR (occurred_at = $${start + 1} AND id < $${start + 2}))`);
  }
  const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 251);
  const rows = await database.all(`
    SELECT * FROM management_security_events
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY occurred_at DESC, id DESC
    LIMIT ${limit}
  `, params);
  return rows.map(mapSecurityEvent);
}

module.exports = {
  listManagementSecurityEvents,
  recordManagementSecurityEvent
};
