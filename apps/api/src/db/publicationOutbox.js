const { getFirebasePublisherStatus, publishStateToFirebase } = require('../firebasePublisher');
const { sanitizeAccountKey } = require('../orbitCore');
const { protectedIdentifier } = require('../operations/dataProtection');
const { sendOperationalAlert } = require('../operations/operationalAlerts');
const { getDatabase } = require('./connection');

let scheduledDrain;

function retryDelayMs(attempts) {
  return Math.min(15 * 60 * 1000, 1000 * (2 ** Math.min(Math.max(attempts, 0), 9)));
}

async function claimNextPublication(now = new Date().toISOString()) {
  const db = await getDatabase();
  return db.transaction(async (transaction) => {
    const row = await transaction.get(`
      SELECT candidate.account_key, candidate.revision, candidate.payload_json, candidate.attempts, candidate.created_at
      FROM publication_outbox candidate
      WHERE candidate.status IN ('pending', 'failed')
        AND candidate.next_attempt_at <= $1
        AND NOT EXISTS (
          SELECT 1 FROM publication_outbox earlier
          WHERE earlier.account_key = candidate.account_key
            AND earlier.revision < candidate.revision
            AND earlier.status != 'published'
        )
      ORDER BY candidate.created_at ASC
      LIMIT 1${transaction.engine === 'postgresql' ? ' FOR UPDATE SKIP LOCKED' : ''}
    `, [now]);
    if (!row) return null;
    const claimed = await transaction.run(`
      UPDATE publication_outbox
      SET status = 'publishing', attempts = attempts + 1, updated_at = $3
      WHERE account_key = $1 AND revision = $2 AND status IN ('pending', 'failed')
    `, [row.account_key, Number(row.revision), now]);
    if (!claimed.changes) return null;
    return {
      accountKey: row.account_key,
      revision: Number(row.revision),
      state: JSON.parse(row.payload_json),
      attempts: Number(row.attempts || 0) + 1,
      createdAt: row.created_at
    };
  });
}

async function markPublished(publication, result, now = new Date().toISOString()) {
  const db = await getDatabase();
  await db.run(`
    UPDATE publication_outbox
    SET status = 'published', payload_json = '{}', last_error = '', published_at = $3, updated_at = $3
    WHERE account_key = $1 AND revision = $2
  `, [publication.accountKey, publication.revision, now]);
  return result;
}

async function markFailed(publication, error, nowMs = Date.now()) {
  const db = await getDatabase();
  const message = error instanceof Error ? error.message : 'Firebase publication failed.';
  const now = new Date(nowMs).toISOString();
  const nextAttemptAt = new Date(nowMs + retryDelayMs(publication.attempts)).toISOString();
  await db.run(`
    UPDATE publication_outbox
    SET status = 'failed', last_error = $3, next_attempt_at = $4, updated_at = $5
    WHERE account_key = $1 AND revision = $2
  `, [publication.accountKey, publication.revision, message.slice(0, 1000), nextAttemptAt, now]);
  void sendOperationalAlert('publication-retry', publication.attempts >= 3 ? 'critical' : 'warning', {
    tenantRef: protectedIdentifier(publication.accountKey),
    revision: publication.revision,
    attempts: publication.attempts,
    errorRef: protectedIdentifier(message),
    nextAttemptAt
  });
  return { ok: false, error: message, nextAttemptAt };
}

async function publishClaimed(publication, dependencies = {}) {
  const publish = dependencies.publishStateToFirebase || publishStateToFirebase;
  try {
    const result = await publish(publication.state, {
      savedAt: publication.createdAt,
      syncRevision: `${publication.accountKey}:${publication.revision}`
    });
    if (!result.ok && !result.skipped) throw new Error(result.error || 'Firebase publication failed.');
    if (result.skipped) throw new Error(`Firebase publication skipped: ${result.reason || 'not configured'}.`);
    await markPublished(publication, result);
    return { ok: true, result };
  } catch (error) {
    return markFailed(publication, error);
  }
}

async function drainPublicationOutbox(options = {}) {
  const maximum = Math.min(Math.max(Number(options.limit || 10), 1), 100);
  const results = [];
  for (let index = 0; index < maximum; index += 1) {
    const publication = await claimNextPublication();
    if (!publication) break;
    results.push({
      accountKey: publication.accountKey,
      revision: publication.revision,
      ...(await publishClaimed(publication, options.dependencies))
    });
  }
  return results;
}

function schedulePublicationDrain() {
  if (!getFirebasePublisherStatus().configured) return Promise.resolve([]);
  if (scheduledDrain) return scheduledDrain;
  scheduledDrain = drainPublicationOutbox({ limit: 10 })
    .catch((error) => {
      console.warn('[publication-outbox] drain failed:', error instanceof Error ? error.message : 'Unknown error');
      return [];
    })
    .finally(() => {
      scheduledDrain = undefined;
    });

  if (process.env.VERCEL) {
    try {
      const { waitUntil } = require('@vercel/functions');
      waitUntil(scheduledDrain);
    } catch (error) {
      console.warn('[publication-outbox] Vercel background continuation unavailable:', error instanceof Error ? error.message : 'Unknown error');
    }
  }
  return scheduledDrain;
}

async function listPublicationOutbox(filters = {}) {
  const db = await getDatabase();
  const accountKey = filters.accountKey ? sanitizeAccountKey(filters.accountKey) : '';
  const params = [];
  const conditions = [];
  if (accountKey) {
    conditions.push(`account_key = $${params.length + 1}`);
    params.push(accountKey);
  }
  if (filters.beforeCreatedAt) {
    const start = params.length + 1;
    conditions.push(`(
      created_at < $${start}
      OR (created_at = $${start + 1} AND account_key > $${start + 2})
      OR (created_at = $${start + 3} AND account_key = $${start + 4} AND revision < $${start + 5})
    )`);
    params.push(
      String(filters.beforeCreatedAt),
      String(filters.beforeCreatedAt),
      String(filters.beforeAccountKey || ''),
      String(filters.beforeCreatedAt),
      String(filters.beforeAccountKey || ''),
      Number(filters.beforeRevision || Number.MAX_SAFE_INTEGER)
    );
  }
  const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 500);
  const rows = await db.all(`
    SELECT account_key, revision, status, attempts, next_attempt_at, last_error, created_at, updated_at, published_at
    FROM publication_outbox
    ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
    ORDER BY created_at DESC, account_key ASC, revision DESC
    LIMIT ${limit}
  `, params);
  return rows.map((row) => ({
    accountKey: row.account_key,
    revision: Number(row.revision),
    status: row.status,
    attempts: Number(row.attempts || 0),
    nextAttemptAt: row.next_attempt_at,
    error: row.last_error || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at || null
  }));
}

module.exports = {
  claimNextPublication,
  drainPublicationOutbox,
  listPublicationOutbox,
  publishClaimed,
  retryDelayMs,
  schedulePublicationDrain
};
