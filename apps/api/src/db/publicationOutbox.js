const { getFirebasePublisherStatus, publishStateToFirebase } = require('../firebasePublisher');
const { sanitizeAccountKey } = require('../orbitCore');
const { protectedIdentifier } = require('../operations/dataProtection');
const { sendOperationalAlert } = require('../operations/operationalAlerts');
const { getDatabase } = require('./connection');
const {
  loadStateRevision,
  publicationCollection,
  publicationPath
} = require('./state');

let scheduledDrain;

function retryDelayMs(attempts) {
  return Math.min(15 * 60 * 1000, 1000 * (2 ** Math.min(Math.max(attempts, 0), 9)));
}

async function tryClaimCandidate(database, candidate, now) {
  const claimed = await database.runTransaction(async (transaction) => {
    const path = publicationPath(candidate.accountKey, candidate.revision);
    const current = await transaction.getDocument(path);
    if (!current || !['pending', 'failed', 'publishing'].includes(current.status) || current.claimableAt > now) return null;
    if (Number(current.revision) > 1) {
      const previous = await transaction.getDocument(publicationPath(current.accountKey, Number(current.revision) - 1));
      if (!previous || previous.status !== 'published') return null;
    }
    const record = {
      ...current,
      status: 'publishing',
      attempts: Number(current.attempts || 0) + 1,
      claimableAt: new Date(Date.parse(now) + 60_000).toISOString(),
      updatedAt: now
    };
    transaction.setDocument(path, record);
    return record;
  });
  if (!claimed) return null;
  return {
    accountKey: claimed.accountKey,
    revision: Number(claimed.revision),
    state: await loadStateRevision(claimed.accountKey, claimed.revision, claimed.stateChunkCount),
    attempts: Number(claimed.attempts),
    createdAt: claimed.createdAt
  };
}

async function claimNextPublication(now = new Date().toISOString()) {
  const database = await getDatabase();
  const candidates = await database.queryCollection(publicationCollection, {
    filters: [{ field: 'claimableAt', op: '<=', value: now }],
    orders: [
      { field: 'claimableAt', direction: 'asc' },
      { field: '__name__', direction: 'asc' }
    ],
    limit: 25
  });
  for (const candidate of candidates) {
    const claimed = await tryClaimCandidate(database, candidate.data, now);
    if (claimed) return claimed;
  }
  return null;
}

async function markPublished(publication, result, now = new Date().toISOString()) {
  const database = await getDatabase();
  const path = publicationPath(publication.accountKey, publication.revision);
  await database.runTransaction(async (transaction) => {
    const current = await transaction.getDocument(path);
    if (current?.status !== 'publishing' || Number(current.attempts) !== Number(publication.attempts)) return;
    transaction.setDocument(path, {
      ...current,
      status: 'published',
      claimableAt: null,
      nextAttemptAt: null,
      error: '',
      publishedAt: now,
      updatedAt: now
    });
  });
  return result;
}

async function markFailed(publication, error, nowMs = Date.now()) {
  const database = await getDatabase();
  const message = error instanceof Error ? error.message : 'Firebase publication failed.';
  const now = new Date(nowMs).toISOString();
  const nextAttemptAt = new Date(nowMs + retryDelayMs(publication.attempts)).toISOString();
  const path = publicationPath(publication.accountKey, publication.revision);
  let applied = false;
  await database.runTransaction(async (transaction) => {
    const current = await transaction.getDocument(path);
    if (current?.status !== 'publishing' || Number(current.attempts) !== Number(publication.attempts)) return;
    transaction.setDocument(path, {
      ...current,
      status: 'failed',
      claimableAt: nextAttemptAt,
      nextAttemptAt,
      error: message.slice(0, 1000),
      updatedAt: now
    });
    applied = true;
  });
  if (applied) {
    void sendOperationalAlert('publication-retry', publication.attempts >= 3 ? 'critical' : 'warning', {
      tenantRef: protectedIdentifier(publication.accountKey),
      revision: publication.revision,
      attempts: publication.attempts,
      errorRef: protectedIdentifier(message),
      nextAttemptAt
    });
  }
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
  const database = await getDatabase();
  const queryFilters = filters.accountKey
    ? [{ field: 'accountKey', op: '==', value: sanitizeAccountKey(filters.accountKey) }]
    : [];
  const orders = filters.accountKey
    ? [
      { field: 'createdAt', direction: 'desc' },
      { field: 'revision', direction: 'desc' }
    ]
    : [
      { field: 'createdAt', direction: 'desc' },
      { field: 'accountKey', direction: 'asc' },
      { field: 'revision', direction: 'desc' }
    ];
  const startAfter = filters.beforeCreatedAt
    ? filters.accountKey
      ? [String(filters.beforeCreatedAt), Number(filters.beforeRevision || Number.MAX_SAFE_INTEGER)]
      : [
        String(filters.beforeCreatedAt),
        sanitizeAccountKey(filters.beforeAccountKey || 'cursor'),
        Number(filters.beforeRevision || Number.MAX_SAFE_INTEGER)
      ]
    : undefined;
  const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 500);
  const documents = await database.queryCollection(publicationCollection, {
    filters: queryFilters,
    orders,
    startAfter,
    limit
  });
  return documents.map(({ data }) => ({
    accountKey: data.accountKey,
    revision: Number(data.revision),
    status: data.status,
    attempts: Number(data.attempts || 0),
    nextAttemptAt: data.nextAttemptAt,
    error: data.error || '',
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    publishedAt: data.publishedAt || null
  }));
}

module.exports = {
  claimNextPublication,
  drainPublicationOutbox,
  listPublicationOutbox,
  markFailed,
  publishClaimed,
  retryDelayMs,
  schedulePublicationDrain
};
