const crypto = require('crypto');
const { getFirebasePublisherStatus, publishStateToFirebase } = require('../firebasePublisher');
const { sanitizeAccountKey } = require('../orbitCore');
const { protectedIdentifier } = require('../operations/dataProtection');
const { sendOperationalAlert } = require('../operations/operationalAlerts');
const { getAccountDeletionFinalizationScheduler } = require('../operations/accountDeletionFinalization');
const { firestoreDocumentId, getDatabase } = require('./connection');
const {
  accountPath,
  loadStateRevision,
  publicationCollection,
  publicationPath
} = require('./state');

const publicationFenceCollection = 'orbitPublicationFences';

let scheduledDrain;
let publicationDrainRequestedAgain = false;

function publicationFencePath(accountKey) {
  return `${publicationFenceCollection}/${firestoreDocumentId(sanitizeAccountKey(accountKey))}`;
}

function normalizePublicationRequirements(requirements = []) {
  return [...new Map((Array.isArray(requirements) ? requirements : [])
    .map((requirement) => ({
      accountKey: sanitizeAccountKey(requirement?.accountKey),
      revision: Number(requirement?.revision)
    }))
    .filter((requirement) => requirement.accountKey && Number.isInteger(requirement.revision) && requirement.revision > 0)
    .map((requirement) => [`${requirement.accountKey}:${requirement.revision}`, requirement])).values()];
}

async function blockAccountPublications(database, accountKeys, blockerRef, now = new Date().toISOString()) {
  const normalizedBlocker = String(blockerRef || '').trim();
  if (!normalizedBlocker) throw new Error('A pseudonymous publication-fence blocker is required.');
  const normalizedAccounts = [...new Set((accountKeys || []).map(sanitizeAccountKey).filter(Boolean))];
  for (const accountKey of normalizedAccounts) {
    await database.runTransaction(async (transaction) => {
      const path = publicationFencePath(accountKey);
      const current = await transaction.getDocument(path);
      const blockers = [...new Set([...(current?.blockerRefs || []), normalizedBlocker])];
      transaction.setDocument(path, {
        accountKey,
        blocked: true,
        blockerRefs: blockers,
        minimumRevision: Math.max(Number(current?.minimumRevision || 1), 1),
        createdAt: current?.createdAt || now,
        updatedAt: now
      });
    });
  }
  return normalizedAccounts;
}

async function releaseAccountPublications(
  database,
  accountKeys,
  blockerRef,
  requirements = [],
  now = new Date().toISOString()
) {
  const normalizedBlocker = String(blockerRef || '').trim();
  if (!normalizedBlocker) throw new Error('A pseudonymous publication-fence blocker is required.');
  const requiredByAccount = new Map(normalizePublicationRequirements(requirements)
    .map((requirement) => [requirement.accountKey, requirement.revision]));
  const normalizedAccounts = [...new Set((accountKeys || []).map(sanitizeAccountKey).filter(Boolean))];
  for (const accountKey of normalizedAccounts) {
    await database.runTransaction(async (transaction) => {
      const path = publicationFencePath(accountKey);
      const current = await transaction.getDocument(path);
      const header = await transaction.getDocument(accountPath(accountKey));
      const blockers = (current?.blockerRefs || []).filter((value) => value !== normalizedBlocker);
      transaction.setDocument(path, {
        accountKey,
        blocked: blockers.length > 0,
        blockerRefs: blockers,
        minimumRevision: Math.max(
          Number(current?.minimumRevision || 1),
          Number(header?.minimumPublishableRevision || 1),
          Number(requiredByAccount.get(accountKey) || 1)
        ),
        createdAt: current?.createdAt || now,
        updatedAt: now
      });
    });
  }
  return normalizedAccounts;
}

async function areRequiredPublicationsPublished(database, requirements = []) {
  const normalized = normalizePublicationRequirements(requirements);
  for (const requirement of normalized) {
    const publication = await database.getDocument(publicationPath(requirement.accountKey, requirement.revision));
    if (publication?.status !== 'published') return false;
    let cursor = '';
    do {
      const active = await database.queryCollection(publicationCollection, {
        filters: [{ field: 'accountKey', op: '==', value: requirement.accountKey }],
        orders: [{ field: '__name__', direction: 'asc' }],
        startAfter: cursor ? [cursor] : undefined,
        limit: 200
      });
      if (active.some((document) => (
        Number(document.data.revision) < requirement.revision
        && ['publishing', 'compensating', 'compensation-pending'].includes(document.data.status)
      ))) return false;
      cursor = active.length === 200 ? active.at(-1).id : '';
    } while (cursor);
  }
  return true;
}

function normalizeFailureField(value) {
  const text = String(value || '');
  return /^[a-f0-9]{16}$/.test(text) ? text : '';
}

function describePublicationFailure(error, categoryOverride = '') {
  const suppliedCategory = String(categoryOverride || error?.category || 'publisher-error');
  const category = /^[a-z0-9-]{1,64}$/.test(suppliedCategory) ? suppliedCategory : 'publisher-error';
  const status = Number(error?.status);
  const safeStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0;
  const source = error instanceof Error ? (error.stack || error.message) : String(error || 'publication-failed');
  const errorRef = protectedIdentifier(source);
  const pathRef = normalizeFailureField(error?.pathRef);
  const responseRef = normalizeFailureField(error?.responseRef);
  const details = [
    `category=${category}`,
    safeStatus ? `status=${safeStatus}` : '',
    pathRef ? `pathRef=${pathRef}` : '',
    responseRef ? `responseRef=${responseRef}` : '',
    `errorRef=${errorRef}`
  ].filter(Boolean).join(' ');
  return {
    category,
    status: safeStatus,
    pathRef,
    responseRef,
    errorRef,
    message: `Firebase publication failed (${details}).`
  };
}

function logPublicationBackgroundFailure(event, error) {
  const failure = describePublicationFailure(error, event);
  console.warn(`[publication-outbox] ${event} errorRef=${failure.errorRef}`);
}

function retryDelayMs(attempts) {
  return Math.min(15 * 60 * 1000, 1000 * (2 ** Math.min(Math.max(attempts, 0), 9)));
}

async function tryClaimCandidate(database, candidate, now) {
  const claimed = await database.runTransaction(async (transaction) => {
    const path = publicationPath(candidate.accountKey, candidate.revision);
    const current = await transaction.getDocument(path);
    if (!current || current.claimableAt > now) return null;
    const fence = await transaction.getDocument(publicationFencePath(current.accountKey));
    if (fence?.blocked || (fence?.blockerRefs || []).length > 0) return null;
    const header = await transaction.getDocument(accountPath(current.accountKey));
    const minimumRevision = Math.max(
      Number(header?.minimumPublishableRevision || 1),
      Number(fence?.minimumRevision || 1)
    );
    if (current.status === 'compensation-pending') {
      const compensationRevision = Number(header?.revision || 0);
      if (compensationRevision < minimumRevision) return null;
      const record = {
        ...current,
        status: 'compensating',
        attempts: Number(current.attempts || 0) + 1,
        claimId: crypto.randomUUID(),
        claimStartedAt: now,
        claimableAt: new Date(Date.parse(now) + 60_000).toISOString(),
        compensationRevision,
        compensationStateChunkCount: Number(header?.stateChunkCount || 0),
        compensationSavedAt: header?.savedAt,
        updatedAt: now
      };
      transaction.setDocument(path, record);
      return record;
    }
    if (!['pending', 'failed'].includes(current.status)) return null;
    if (Number(current.revision) < minimumRevision) {
      transaction.setDocument(path, {
        ...current,
        status: 'cancelled',
        claimableAt: null,
        nextAttemptAt: null,
        error: '',
        invalidatedAt: now,
        updatedAt: now
      });
      return null;
    }
    if (Number(current.revision) > 1) {
      const previous = await transaction.getDocument(publicationPath(current.accountKey, Number(current.revision) - 1));
      if (!previous || !['published', 'cancelled'].includes(previous.status)) return null;
    }
    const record = {
      ...current,
      status: 'publishing',
      attempts: Number(current.attempts || 0) + 1,
      claimId: crypto.randomUUID(),
      claimStartedAt: now,
      claimableAt: new Date(Date.parse(now) + 60_000).toISOString(),
      updatedAt: now
    };
    transaction.setDocument(path, record);
    return record;
  });
  if (!claimed) return null;
  const publication = {
    accountKey: claimed.accountKey,
    revision: Number(claimed.revision),
    attempts: Number(claimed.attempts),
    claimId: claimed.claimId,
    createdAt: claimed.compensationSavedAt || claimed.createdAt,
    compensation: claimed.status === 'compensating',
    stateRevision: Number(claimed.compensationRevision || claimed.revision),
    lateWriterObservedAt: claimed.lateWriterObservedAt || ''
  };
  try {
    publication.state = await loadStateRevision(
      claimed.accountKey,
      publication.stateRevision,
      claimed.compensationStateChunkCount || claimed.stateChunkCount
    );
    return publication;
  } catch (error) {
    await markFailed(publication, error, Date.now(), { database });
    return null;
  }
}

async function recoverAbandonedPublicationClaim(databaseOrRequest, suppliedRequest = {}, internalOptions = {}) {
  const database = typeof databaseOrRequest?.runTransaction === 'function'
    ? databaseOrRequest
    : await getDatabase();
  const request = typeof databaseOrRequest?.runTransaction === 'function'
    ? suppliedRequest
    : databaseOrRequest || {};
  const accountKey = sanitizeAccountKey(request.accountKey);
  const revision = Number(request.revision);
  const claimId = String(request.claimId || '').trim();
  const evidenceRef = String(request.evidenceRef || '').trim();
  const recoveredAtMs = Number((internalOptions.nowMs || Date.now)());
  const now = new Date(recoveredAtMs).toISOString();
  if (
    !accountKey
    || !Number.isInteger(revision)
    || revision < 1
    || !claimId
    || request.runtimeTerminated !== true
    || !/^[a-f0-9]{16}$/.test(evidenceRef)
  ) {
    throw new Error('Explicit terminated-runtime evidence is required to recover a publication claim.');
  }
  const recovered = await database.runTransaction(async (transaction) => {
    const path = publicationPath(accountKey, revision);
    const current = await transaction.getDocument(path);
    if (
      !['publishing', 'compensating'].includes(current?.status)
      || String(current.claimId || '') !== claimId
    ) return false;
    const startedAt = Date.parse(current.claimStartedAt || current.updatedAt || '');
    if (!Number.isFinite(startedAt) || Date.parse(now) - startedAt < 5 * 60 * 1000) {
      throw new Error('Publication recovery evidence cannot be applied to a current runtime attempt.');
    }
    const [header, fence] = await Promise.all([
      transaction.getDocument(accountPath(accountKey)),
      transaction.getDocument(publicationFencePath(accountKey))
    ]);
    const minimumRevision = Math.max(
      Number(header?.minimumPublishableRevision || 1),
      Number(fence?.minimumRevision || 1)
    );
    const invalidated = Boolean(
      current.status === 'compensating'
      || current.compensationRevision
      || current.invalidationRequested
      || revision < minimumRevision
    );
    if (fence?.blocked || (fence?.blockerRefs || []).length > 0 || !invalidated || Number(header?.revision || 0) < minimumRevision) {
      throw new Error('A sanitized unfenced revision is required before recovering a publication claim.');
    }
    transaction.setDocument(path, {
      ...current,
      status: 'compensation-pending',
      claimId: null,
      claimableAt: now,
      nextAttemptAt: now,
      error: '',
      compensationRevision: Number(header.revision),
      recoveredAt: now,
      recoveryEvidenceRef: evidenceRef,
      invalidatedAt: current.invalidatedAt || now,
      updatedAt: now
    });
    return true;
  });
  return { recovered };
}

async function claimNextPublication(now = new Date().toISOString(), dependencies = {}) {
  const database = dependencies.database || await getDatabase();
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

async function settlePublication(publication, outcome, dependencies = {}) {
  const database = dependencies.database || await getDatabase();
  const nowMs = Number(dependencies.nowMs || Date.now());
  const now = new Date(nowMs).toISOString();
  const path = publicationPath(publication.accountKey, publication.revision);
  let settlement = 'stale';
  await database.runTransaction(async (transaction) => {
    const current = await transaction.getDocument(path);
    if (publication.compensation) {
      if (
        current?.status !== 'compensating'
        || Number(current.attempts) !== Number(publication.attempts)
        || String(current.claimId || '') !== String(publication.claimId || '')
      ) return;
      if (String(current.lateWriterObservedAt || '') !== String(publication.lateWriterObservedAt || '')) {
        transaction.setDocument(path, {
          ...current,
          status: 'compensation-pending',
          claimId: null,
          claimableAt: now,
          nextAttemptAt: now,
          updatedAt: now
        });
        settlement = 'compensation-pending';
        return;
      }
      if (outcome.ok) {
        transaction.setDocument(path, {
          ...current,
          status: 'cancelled',
          claimId: null,
          claimableAt: null,
          nextAttemptAt: null,
          error: '',
          compensatedAt: now,
          compensatedToRevision: Number(publication.stateRevision),
          remoteAttemptCompletedAt: now,
          updatedAt: now
        });
        settlement = 'compensated';
        return;
      }
      const failure = outcome.failure;
      const nextAttemptAt = new Date(nowMs + retryDelayMs(publication.attempts)).toISOString();
      transaction.setDocument(path, {
        ...current,
        status: 'compensation-pending',
        claimId: null,
        claimableAt: nextAttemptAt,
        nextAttemptAt,
        error: failure.message.slice(0, 1000),
        remoteAttemptCompletedAt: now,
        updatedAt: now
      });
      settlement = 'compensation-pending';
      return;
    }
    if (
      current?.status !== 'publishing'
      || Number(current.attempts) !== Number(publication.attempts)
      || String(current.claimId || '') !== String(publication.claimId || '')
    ) return;
    const [header, fence] = await Promise.all([
      transaction.getDocument(accountPath(publication.accountKey)),
      transaction.getDocument(publicationFencePath(publication.accountKey))
    ]);
    const minimumRevision = Math.max(
      Number(header?.minimumPublishableRevision || 1),
      Number(fence?.minimumRevision || 1)
    );
    const invalidated = Boolean(
      current.invalidationRequested
      || fence?.blocked
      || (fence?.blockerRefs || []).length > 0
      || Number(publication.revision) < minimumRevision
    );
    if (invalidated) {
      transaction.setDocument(path, {
        ...current,
        status: 'cancelled',
        claimId: null,
        claimableAt: null,
        nextAttemptAt: null,
        error: '',
        invalidatedAt: current.invalidatedAt || now,
        remoteAttemptCompletedAt: now,
        updatedAt: now
      });
      settlement = 'cancelled';
      return;
    }
    if (outcome.ok) {
      transaction.setDocument(path, {
        ...current,
        status: 'published',
        claimId: null,
        claimableAt: null,
        nextAttemptAt: null,
        error: '',
        publishedAt: now,
        remoteAttemptCompletedAt: now,
        updatedAt: now
      });
      settlement = 'published';
      return;
    }
    const failure = outcome.failure;
    const nextAttemptAt = new Date(nowMs + retryDelayMs(publication.attempts)).toISOString();
    transaction.setDocument(path, {
      ...current,
      status: 'failed',
      claimId: null,
      claimableAt: nextAttemptAt,
      nextAttemptAt,
      error: failure.message.slice(0, 1000),
      remoteAttemptCompletedAt: now,
      updatedAt: now
    });
    settlement = 'failed';
  });
  return { settlement, now };
}

async function wakeDeletionFinalizer(dependencies = {}) {
  try {
    const schedule = dependencies.scheduleDeletionFinalizationDrain
      || getAccountDeletionFinalizationScheduler();
    if (typeof schedule !== 'function') return;
    await Promise.resolve(schedule({ force: true }));
  } catch {
    // A durable finalizing job remains available to the next request if the
    // runtime cannot immediately schedule the account-deletion continuation.
  }
}

async function markPublished(publication, result, now = new Date().toISOString(), dependencies = {}) {
  const settlement = await settlePublication(publication, { ok: true }, {
    ...dependencies,
    nowMs: Date.parse(now)
  });
  if (settlement.settlement === 'published') void wakeDeletionFinalizer(dependencies);
  return result;
}

async function markFailed(publication, error, nowMs = Date.now(), dependencies = {}) {
  const failure = describePublicationFailure(error);
  const message = failure.message;
  const nextAttemptAt = new Date(nowMs + retryDelayMs(publication.attempts)).toISOString();
  const { settlement } = await settlePublication(publication, { ok: false, failure }, {
    ...dependencies,
    nowMs
  });
  if (['failed', 'compensation-pending'].includes(settlement)) {
    void sendOperationalAlert('publication-retry', publication.attempts >= 3 ? 'critical' : 'warning', {
      tenantRef: protectedIdentifier(publication.accountKey),
      revision: publication.revision,
      attempts: publication.attempts,
      errorRef: failure.errorRef,
      category: failure.category,
      nextAttemptAt
    });
  }
  if (settlement === 'cancelled') return { ok: false, cancelled: true, error: 'Publication revision was invalidated.' };
  if (settlement === 'compensation-pending') {
    return { ok: false, compensationPending: true, error: message, errorRef: failure.errorRef, nextAttemptAt };
  }
  if (settlement === 'stale') return { ok: false, stale: true, error: message, errorRef: failure.errorRef };
  return { ok: false, error: message, errorRef: failure.errorRef, nextAttemptAt };
}

async function queueLatePublicationCompensation(publication, dependencies = {}) {
  const database = dependencies.database || await getDatabase();
  const now = new Date().toISOString();
  const path = publicationPath(publication.accountKey, publication.revision);
  await database.runTransaction(async (transaction) => {
    const current = await transaction.getDocument(path);
    if (!current) return;
    const header = await transaction.getDocument(accountPath(publication.accountKey));
    if (current.status === 'compensating') {
      transaction.setDocument(path, {
        ...current,
        lateWriterObservedAt: now,
        compensationRevision: Number(header?.revision || publication.stateRevision || publication.revision),
        updatedAt: now
      });
      return;
    }
    transaction.setDocument(path, {
      ...current,
      status: 'compensation-pending',
      claimId: null,
      claimableAt: now,
      nextAttemptAt: now,
      compensationRevision: Number(header?.revision || publication.stateRevision || publication.revision),
      lateWriterObservedAt: now,
      updatedAt: now
    });
  });
  schedulePublicationWorkAfterLateWriter(dependencies);
}

function schedulePublicationWorkAfterLateWriter(dependencies = {}) {
  try {
    const schedule = dependencies.schedulePublicationDrain || schedulePublicationDrain;
    void Promise.resolve(schedule({ force: true, dependencies })).catch(() => undefined);
  } catch {
    // The compensation-pending record is durable for the next request.
  }
}

async function compensateSupersededPublication(publication, publish, dependencies = {}) {
  const database = dependencies.database || await getDatabase();
  const [header, fence] = await Promise.all([
    database.getDocument(accountPath(publication.accountKey)),
    database.getDocument(publicationFencePath(publication.accountKey))
  ]);
  const safeRevision = Number(header?.revision || 0);
  const minimumRevision = Math.max(
    Number(header?.minimumPublishableRevision || 1),
    Number(fence?.minimumRevision || 1)
  );
  if (
    fence?.blocked
    || (fence?.blockerRefs || []).length > 0
    || safeRevision < minimumRevision
    || safeRevision <= Number(publication.revision)
  ) {
    await queueLatePublicationCompensation(publication, { ...dependencies, database });
    return { ok: false, compensationPending: true };
  }
  try {
    const safeState = await loadStateRevision(
      publication.accountKey,
      safeRevision,
      Number(header.stateChunkCount || 0)
    );
    const result = await publish(safeState, {
      savedAt: header.savedAt,
      syncRevision: `${publication.accountKey}:${safeRevision}:compensation`
    });
    if (!result?.ok || result.skipped) throw new Error('Safe publication compensation failed.');
    const now = new Date().toISOString();
    await database.setDocument(publicationPath(publication.accountKey, publication.revision), {
      ...(await database.getDocument(publicationPath(publication.accountKey, publication.revision))),
      status: 'cancelled',
      claimId: null,
      claimableAt: null,
      nextAttemptAt: null,
      error: '',
      compensatedAt: now,
      compensatedToRevision: safeRevision,
      lateWriterObservedAt: now,
      updatedAt: now
    });
    return { ok: false, cancelled: true, compensated: true };
  } catch (error) {
    await queueLatePublicationCompensation(publication, { ...dependencies, database });
    return { ok: false, compensationPending: true, errorRef: protectedIdentifier(error?.message || 'compensation-failed') };
  }
}

async function publishClaimed(publication, dependencies = {}) {
  const publish = dependencies.publishStateToFirebase || publishStateToFirebase;
  try {
    const result = await publish(publication.state, {
      savedAt: publication.createdAt,
      syncRevision: `${publication.accountKey}:${publication.revision}`
    });
    if (!result.ok && !result.skipped) {
      throw Object.assign(new Error('Firebase publisher returned a failure result.'), {
        category: 'publisher-result',
        responseRef: protectedIdentifier(result.error || 'publisher-result-failed')
      });
    }
    if (result.skipped) {
      throw Object.assign(new Error('Firebase publisher is not configured for this publication.'), {
        category: 'publisher-skipped',
        responseRef: protectedIdentifier(result.reason || 'not-configured')
      });
    }
    const database = dependencies.database || await getDatabase();
    const { settlement } = await settlePublication(publication, { ok: true }, { ...dependencies, database });
    if (settlement === 'published' || settlement === 'compensated') void wakeDeletionFinalizer(dependencies);
    if (settlement === 'compensated') return { ok: true, compensated: true, result };
    if (settlement === 'cancelled') {
      return { ok: false, cancelled: true, error: 'Publication revision was invalidated.' };
    }
    if (settlement !== 'published') {
      return compensateSupersededPublication(publication, publish, { ...dependencies, database });
    }
    return { ok: true, result };
  } catch (error) {
    const failure = await markFailed(publication, error, Date.now(), dependencies);
    if (failure.stale) return compensateSupersededPublication(publication, publish, dependencies);
    return failure;
  }
}

async function drainPublicationOutbox(options = {}) {
  const maximum = Math.min(Math.max(Number(options.limit || 10), 1), 100);
  const results = [];
  for (let index = 0; index < maximum; index += 1) {
    const publication = await claimNextPublication(new Date().toISOString(), options.dependencies || {});
    if (!publication) break;
    results.push({
      accountKey: publication.accountKey,
      revision: publication.revision,
      ...(await publishClaimed(publication, options.dependencies))
    });
  }
  return results;
}

function registerPublicationContinuation(promise, options = {}) {
  if (typeof options.waitUntil !== 'function' && !process.env.VERCEL) return;
  try {
    const waitUntil = options.waitUntil || require('@vercel/functions').waitUntil;
    waitUntil(promise);
  } catch (error) {
    logPublicationBackgroundFailure('background-continuation-failed', error);
  }
}

function schedulePublicationDrain(options = {}) {
  const force = options.force === true;
  const dependencies = options.dependencies || {};
  const status = dependencies.getFirebasePublisherStatus
    ? dependencies.getFirebasePublisherStatus()
    : getFirebasePublisherStatus();
  if (!status.configured) return Promise.resolve([]);
  if (scheduledDrain) {
    if (force) publicationDrainRequestedAgain = true;
    return scheduledDrain;
  }
  const drain = dependencies.drainPublicationOutbox || drainPublicationOutbox;
  scheduledDrain = Promise.resolve(drain({ limit: 10, dependencies }))
    .catch((error) => {
      logPublicationBackgroundFailure('drain-failed', error);
      return [];
    })
    .finally(() => {
      scheduledDrain = undefined;
      if (publicationDrainRequestedAgain) {
        publicationDrainRequestedAgain = false;
        void schedulePublicationDrain({
          force: true,
          dependencies,
          waitUntil: options.waitUntil
        }).catch(() => undefined);
      }
    });
  registerPublicationContinuation(scheduledDrain, options);
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
  areRequiredPublicationsPublished,
  blockAccountPublications,
  claimNextPublication,
  drainPublicationOutbox,
  describePublicationFailure,
  listPublicationOutbox,
  markFailed,
  publishClaimed,
  publicationFenceCollection,
  publicationFencePath,
  recoverAbandonedPublicationClaim,
  releaseAccountPublications,
  retryDelayMs,
  schedulePublicationDrain
};
