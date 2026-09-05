const crypto = require('crypto');
const zlib = require('zlib');
const { getAccountKeyFromState, sanitizeAccountKey, validateStatePayload } = require('../orbitCore');
const { firestoreDocumentId, getDatabase } = require('./connection');

const entityFormat = 'entity-v1';
const stateEncoding = 'gzip-json-chunks-v1';
const stateChunkSize = 400_000;
// Firestore transactions are capped at 10 MiB including document/index overhead.
// Keep the compressed payload below 8 MiB so the header, receipt, and outbox
// documents can be committed atomically with the state chunks.
const maximumCompressedStateBytes = 8_000_000;
const maximumStateChunks = Math.ceil(maximumCompressedStateBytes / stateChunkSize);
const accountStatesCollection = 'orbitAccountStates';
const publicationCollection = 'orbitPublicationOutbox';
const globalMutationCollection = 'orbitGlobalMutationReceipts';

class StateConflictError extends Error {
  constructor(accountKey, expectedRevision, currentRevision) {
    super(`State revision conflict for ${accountKey}. Expected ${expectedRevision}; current revision is ${currentRevision}.`);
    this.name = 'StateConflictError';
    this.code = 'STATE_REVISION_CONFLICT';
    this.accountKey = accountKey;
    this.expectedRevision = expectedRevision;
    this.currentRevision = currentRevision;
  }
}

class IdempotencyConflictError extends Error {
  constructor() {
    super('The idempotency key was already used for a different operation.');
    this.name = 'IdempotencyConflictError';
    this.code = 'IDEMPOTENCY_CONFLICT';
  }
}

function hashJson(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function serializeStateEntities(state) {
  const root = {};
  const arrayKeys = [];
  const entities = [];
  for (const [collectionName, value] of Object.entries(state)) {
    if (!Array.isArray(value)) {
      root[collectionName] = value;
      continue;
    }
    root[collectionName] = [];
    arrayKeys.push(collectionName);
    const usedIds = new Set();
    value.forEach((entity, position) => {
      const contentHash = hashJson(entity);
      const candidateId = entity && typeof entity === 'object' && !Array.isArray(entity)
        ? String(entity.id || '').trim()
        : '';
      let entityId = candidateId || `_item_${contentHash.slice(0, 24)}`;
      if (usedIds.has(entityId)) entityId = `${entityId}_${position}`;
      usedIds.add(entityId);
      entities.push({ collectionName, entityId, position, contentHash, entityJson: JSON.stringify(entity) });
    });
  }
  return { metaJson: JSON.stringify({ format: entityFormat, root, arrayKeys }), entities };
}

function deserializeState(row, entityRows) {
  let meta;
  try {
    meta = JSON.parse(row.state_meta_json || '{}');
  } catch {
    meta = null;
  }
  if (meta?.format !== entityFormat || !meta.root || !Array.isArray(meta.arrayKeys)) {
    return JSON.parse(row.state_json || '{}');
  }
  const state = { ...meta.root };
  for (const arrayKey of meta.arrayKeys) state[arrayKey] = [];
  for (const entityRow of entityRows) {
    if (!Array.isArray(state[entityRow.collection_name])) state[entityRow.collection_name] = [];
    state[entityRow.collection_name].push(JSON.parse(entityRow.entity_json));
  }
  return state;
}

function accountPath(accountKey) {
  return `${accountStatesCollection}/${firestoreDocumentId(accountKey)}`;
}

function mutationReference(accountKey, mutationId) {
  return crypto.createHash('sha256')
    .update(`${sanitizeAccountKey(accountKey)}\u0000${String(mutationId || '')}`)
    .digest('hex');
}

function opaqueReference(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function globalMutationPath(scope) {
  return `${globalMutationCollection}/m_${opaqueReference(scope)}`;
}

async function loadGlobalMutationReceipt(scope) {
  const normalized = String(scope || '').trim();
  if (!normalized) return null;
  const database = await getDatabase();
  return database.getDocument(globalMutationPath(normalized));
}

async function loadStateMutationReceipt(accountKey, mutationId) {
  const normalizedAccountKey = sanitizeAccountKey(accountKey);
  const normalizedMutationId = String(mutationId || '').trim();
  if (!normalizedAccountKey || !normalizedMutationId) return null;
  const database = await getDatabase();
  const currentPath = mutationPath(normalizedAccountKey, normalizedMutationId);
  const current = await database.getDocument(currentPath);
  if (current) return { ...current, legacy: false };
  const oldPath = legacyMutationPath(normalizedAccountKey, normalizedMutationId);
  if (oldPath === currentPath) return null;
  const legacy = await database.getDocument(oldPath);
  return legacy ? { ...legacy, legacy: true } : null;
}

function mutationPath(accountKey, mutationId) {
  return `${accountPath(accountKey)}/mutations/m_${mutationReference(accountKey, mutationId)}`;
}

function legacyMutationPath(accountKey, mutationId) {
  return `${accountPath(accountKey)}/mutations/${firestoreDocumentId(mutationId)}`;
}

function stateChunkPath(accountKey, revision, index) {
  const id = `${String(revision).padStart(12, '0')}_${String(index).padStart(4, '0')}`;
  return `${accountPath(accountKey)}/stateChunks/${id}`;
}

function publicationDocumentId(accountKey, revision) {
  return `${firestoreDocumentId(accountKey)}~${String(revision).padStart(12, '0')}`;
}

function publicationPath(accountKey, revision) {
  return `${publicationCollection}/${publicationDocumentId(accountKey, revision)}`;
}

function encodeState(state) {
  const source = Buffer.from(JSON.stringify(state), 'utf8');
  const compressed = zlib.gzipSync(source, { level: 6 });
  if (compressed.length > maximumCompressedStateBytes) {
    throw new Error('The authoritative state exceeds the Firestore transaction size limit.');
  }
  const chunks = [];
  for (let offset = 0; offset < compressed.length; offset += stateChunkSize) {
    chunks.push(compressed.subarray(offset, offset + stateChunkSize));
  }
  if (!chunks.length) chunks.push(Buffer.alloc(0));
  if (chunks.length > maximumStateChunks) throw new Error('The authoritative state exceeds the Firestore transaction size limit.');
  return {
    chunks,
    compressedBytes: compressed.length,
    sourceBytes: source.length,
    contentHash: crypto.createHash('sha256').update(source).digest('hex')
  };
}

async function readStateChunks(reader, accountKey, revision, chunkCount) {
  const chunks = [];
  for (let index = 0; index < Number(chunkCount || 0); index += 1) {
    const chunk = await reader.getDocument(stateChunkPath(accountKey, revision, index));
    if (!chunk?.payload) throw new Error(`Authoritative Firestore state chunk ${index} is missing.`);
    chunks.push(Buffer.from(chunk.payload));
  }
  if (!chunks.length) return null;
  return JSON.parse(zlib.gunzipSync(Buffer.concat(chunks)).toString('utf8'));
}

function mapPublication(record) {
  if (!record) return { status: 'not-queued', attempts: 0, error: '' };
  return {
    status: record.status,
    attempts: Number(record.attempts || 0),
    error: record.error || '',
    publishedAt: record.publishedAt || null,
    nextAttemptAt: record.nextAttemptAt || null
  };
}

function countEntityChanges(previousState, nextState) {
  const previous = previousState ? serializeStateEntities(previousState).entities : [];
  const next = serializeStateEntities(nextState).entities;
  const previousByKey = new Map(previous.map((entity) => [`${entity.collectionName}\u0000${entity.entityId}`, entity]));
  const nextKeys = new Set();
  let changed = 0;
  for (const entity of next) {
    const key = `${entity.collectionName}\u0000${entity.entityId}`;
    nextKeys.add(key);
    const prior = previousByKey.get(key);
    if (!prior || prior.contentHash !== entity.contentHash || prior.position !== entity.position) changed += 1;
  }
  for (const key of previousByKey.keys()) if (!nextKeys.has(key)) changed += 1;
  return changed;
}

async function getPublicationStatus(accountKey, revision) {
  const database = await getDatabase();
  return mapPublication(await database.getDocument(publicationPath(sanitizeAccountKey(accountKey), Number(revision))));
}

async function saveState(state, options = {}) {
  validateStatePayload(state);
  const database = await getDatabase();
  const accountKey = getAccountKeyFromState(state);
  const savedAt = new Date().toISOString();
  const venueName = state.settings?.clubAccount?.clubName || '';
  const mutationId = String(options.mutationId || crypto.randomUUID()).trim().slice(0, 180);
  const mutationType = String(options.mutationType || 'state-replace').trim().slice(0, 80);
  const globalMutationScope = String(options.globalMutationScope || '').trim();
  const globalMutationFingerprint = String(options.globalMutationFingerprint || '').trim();
  if (Boolean(globalMutationScope) !== Boolean(globalMutationFingerprint)) {
    throw new Error('Global mutation scope and fingerprint must be provided together.');
  }
  const expectedRevision = Number(options.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error('A non-negative expectedRevision is required for state mutations.');
  }
  if (!mutationId) throw new Error('A stable mutationId is required for state mutations.');
  return database.runTransaction(async (transaction) => {
    const globalReceiptPath = globalMutationScope ? globalMutationPath(globalMutationScope) : '';
    const fingerprintRef = globalMutationFingerprint ? opaqueReference(globalMutationFingerprint) : '';
    const existingGlobalReceipt = globalReceiptPath
      ? await transaction.getDocument(globalReceiptPath)
      : null;
    if (existingGlobalReceipt) {
      if (existingGlobalReceipt.fingerprintRef !== fingerprintRef) throw new IdempotencyConflictError();
      const publication = await transaction.getDocument(
        publicationPath(existingGlobalReceipt.accountKey, existingGlobalReceipt.revision)
      );
      return {
        accountKey: existingGlobalReceipt.accountKey,
        savedAt: existingGlobalReceipt.createdAt,
        revision: Number(existingGlobalReceipt.revision),
        mutationId,
        duplicate: true,
        idempotencyResult: existingGlobalReceipt.result || null,
        publication: mapPublication(publication)
      };
    }
    const opaqueMutationPath = mutationPath(accountKey, mutationId);
    let existingMutation = await transaction.getDocument(opaqueMutationPath);
    const oldMutationPath = legacyMutationPath(accountKey, mutationId);
    if (!existingMutation && oldMutationPath !== opaqueMutationPath) {
      existingMutation = await transaction.getDocument(oldMutationPath);
      if (existingMutation) {
        transaction.setDocument(opaqueMutationPath, {
          accountKey,
          mutationRef: mutationReference(accountKey, mutationId),
          mutationType: existingMutation.mutationType || 'legacy',
          revision: Number(existingMutation.revision),
          createdAt: existingMutation.createdAt || savedAt
        });
        transaction.deleteDocument(oldMutationPath);
      }
    }
    if (existingMutation) {
      if (globalReceiptPath) {
        transaction.createDocument(globalReceiptPath, {
          scopeRef: opaqueReference(globalMutationScope),
          fingerprintRef,
          accountKey,
          revision: Number(existingMutation.revision),
          result: options.globalMutationResult || null,
          createdAt: existingMutation.createdAt || savedAt
        });
      }
      const publication = await transaction.getDocument(publicationPath(accountKey, existingMutation.revision));
      return {
        accountKey,
        savedAt: existingMutation.createdAt,
        revision: Number(existingMutation.revision),
        mutationId,
        duplicate: true,
        publication: mapPublication(publication)
      };
    }

    const current = await transaction.getDocument(accountPath(accountKey));
    const currentRevision = Number(current?.revision || 0);
    if (currentRevision !== expectedRevision) throw new StateConflictError(accountKey, expectedRevision, currentRevision);
    const previousState = current
      ? await readStateChunks(transaction, accountKey, currentRevision, current.stateChunkCount)
      : null;
    let stateToCommit = state;
    let transactionResult = null;
    if (typeof options.transactionPrecondition === 'function') {
      const evaluated = await options.transactionPrecondition({
        transaction,
        accountKey,
        currentState: previousState,
        nextState: state
      });
      if (evaluated?.nextState) {
        validateStatePayload(evaluated.nextState);
        if (getAccountKeyFromState(evaluated.nextState) !== accountKey) {
          throw new Error('A state transaction transform cannot change the account key.');
        }
        stateToCommit = evaluated.nextState;
      }
      transactionResult = evaluated?.result || null;
    }
    const encoded = encodeState(stateToCommit);
    const revision = currentRevision + 1;
    const changedEntityCount = countEntityChanges(previousState, stateToCommit);

    encoded.chunks.forEach((payload, index) => {
      transaction.setDocument(stateChunkPath(accountKey, revision, index), {
        accountKey,
        revision,
        index,
        encoding: stateEncoding,
        payload,
        createdAt: savedAt
      });
    });
    transaction.setDocument(accountPath(accountKey), {
      accountKey,
      venueName,
      schemaVersion: 2,
      savedAt,
      updatedAt: savedAt,
      revision,
      minimumPublishableRevision: options.invalidatePriorRevisions
        ? revision
        : Number(current?.minimumPublishableRevision || 1),
      stateEncoding,
      stateChunkCount: encoded.chunks.length,
      stateCompressedBytes: encoded.compressedBytes,
      stateSourceBytes: encoded.sourceBytes,
      stateContentHash: encoded.contentHash
    });
    transaction.createDocument(opaqueMutationPath, {
      accountKey,
      mutationRef: mutationReference(accountKey, mutationId),
      mutationType,
      revision,
      createdAt: savedAt
    });
    if (globalReceiptPath) {
      transaction.createDocument(globalReceiptPath, {
        scopeRef: opaqueReference(globalMutationScope),
        fingerprintRef,
        accountKey,
        revision,
        result: transactionResult?.globalMutationResult || options.globalMutationResult || null,
        createdAt: savedAt
      });
    }
    transaction.createDocument(publicationPath(accountKey, revision), {
      accountKey,
      revision,
      status: 'pending',
      attempts: 0,
      claimableAt: savedAt,
      nextAttemptAt: savedAt,
      error: '',
      createdAt: savedAt,
      updatedAt: savedAt,
      publishedAt: null,
      stateEncoding,
      stateChunkCount: encoded.chunks.length
    });
    return {
      accountKey,
      savedAt,
      revision,
      mutationId,
      duplicate: false,
      idempotencyResult: transactionResult?.globalMutationResult || options.globalMutationResult || null,
      transactionResult,
      changedEntityCount,
      publication: { status: 'pending', attempts: 0, error: '', publishedAt: null, nextAttemptAt: savedAt }
    };
  });
}

async function listAllDocuments(database, collectionPath) {
  const documents = [];
  let cursor;
  do {
    const page = await database.queryCollection(collectionPath, {
      orders: [{ field: '__name__', direction: 'asc' }],
      startAfter: cursor ? [cursor] : undefined,
      limit: 200
    });
    documents.push(...page);
    cursor = page.length === 200 ? page.at(-1).id : undefined;
  } while (cursor);
  return documents;
}

async function invalidateAccountStateHistory(accountKey, keepRevision) {
  const normalized = sanitizeAccountKey(accountKey);
  const revision = Number(keepRevision);
  if (!normalized || !Number.isInteger(revision) || revision < 1) {
    throw new Error('A valid account and retained revision are required for history invalidation.');
  }
  const database = await getDatabase();
  const mutationCollection = `${accountPath(normalized)}/mutations`;
  const chunkCollection = `${accountPath(normalized)}/stateChunks`;
  const [outbox, mutations, chunks] = await Promise.all([
    listAllDocuments(database, publicationCollection),
    listAllDocuments(database, mutationCollection),
    listAllDocuments(database, chunkCollection)
  ]);
  let cancelledPublications = 0;
  let migratedMutations = 0;
  let deletedChunks = 0;

  for (const document of outbox) {
    if (document.data.accountKey !== normalized || Number(document.data.revision) >= revision) continue;
    await database.runTransaction(async (transaction) => {
      const path = `${publicationCollection}/${document.id}`;
      const current = await transaction.getDocument(path);
      if (!current || Number(current.revision) >= revision) return;
      const invalidatedAt = new Date().toISOString();
      if (['publishing', 'compensating', 'compensation-pending'].includes(current.status)) {
        // A remote writer that already owns this exact claim must acknowledge its
        // postflight before the sanitized successor can publish. Clearing the
        // claim here would make a late remote write invisible to deletion.
        transaction.setDocument(path, {
          ...current,
          invalidationRequested: true,
          invalidatedAt,
          updatedAt: invalidatedAt
        });
        return;
      }
      transaction.setDocument(path, {
        ...current,
        status: 'cancelled',
        claimId: null,
        claimableAt: null,
        nextAttemptAt: null,
        error: '',
        invalidatedAt,
        updatedAt: invalidatedAt
      });
    });
    cancelledPublications += 1;
  }

  for (const document of mutations) {
    const existing = document.data || {};
    if (/^m_[a-f0-9]{64}$/.test(document.id) && !existing.mutationId) continue;
    let rawMutationId = String(existing.mutationId || '');
    if (!rawMutationId) {
      try {
        rawMutationId = decodeURIComponent(document.id);
      } catch {
        rawMutationId = document.id;
      }
    }
    const targetPath = mutationPath(normalized, rawMutationId);
    await database.setDocument(targetPath, {
      accountKey: normalized,
      mutationRef: mutationReference(normalized, rawMutationId),
      mutationType: existing.mutationType || 'legacy',
      revision: Number(existing.revision || 0),
      createdAt: existing.createdAt || new Date().toISOString()
    });
    const sourcePath = `${mutationCollection}/${document.id}`;
    if (sourcePath !== targetPath) await database.deleteDocument(sourcePath);
    migratedMutations += 1;
  }

  for (const document of chunks) {
    if (Number(document.data.revision) === revision) continue;
    await database.deleteDocument(`${chunkCollection}/${document.id}`);
    deletedChunks += 1;
  }
  return { cancelledPublications, migratedMutations, deletedChunks };
}

async function listHistoricalStates(accountKey, excludeRevision = 0) {
  const normalized = sanitizeAccountKey(accountKey);
  const database = await getDatabase();
  const chunks = await listAllDocuments(database, `${accountPath(normalized)}/stateChunks`);
  const chunkCounts = new Map();
  for (const chunk of chunks) {
    const revision = Number(chunk.data.revision);
    if (!Number.isInteger(revision) || revision < 1 || revision === Number(excludeRevision)) continue;
    chunkCounts.set(revision, Math.max(chunkCounts.get(revision) || 0, Number(chunk.data.index) + 1));
  }
  return Promise.all([...chunkCounts.entries()]
    .sort(([left], [right]) => left - right)
    .map(async ([revision, chunkCount]) => ({
      revision,
      state: await readStateChunks(database, normalized, revision, chunkCount)
    })));
}

async function mapStateHeader(database, header) {
  if (!header) return null;
  const revision = Number(header.revision || 0);
  return {
    accountKey: header.accountKey,
    venueName: header.venueName || '',
    schemaVersion: Number(header.schemaVersion || 2),
    savedAt: header.savedAt,
    revision,
    publication: revision > 0 ? await getPublicationStatus(header.accountKey, revision) : mapPublication(null),
    state: await readStateChunks(database, header.accountKey, revision, header.stateChunkCount)
  };
}

async function loadStateRevision(accountKey, revision, chunkCount) {
  const database = await getDatabase();
  return readStateChunks(database, sanitizeAccountKey(accountKey), Number(revision), Number(chunkCount));
}

async function loadState(accountKey) {
  const normalized = sanitizeAccountKey(accountKey);
  const database = await getDatabase();
  return mapStateHeader(database, await database.getDocument(accountPath(normalized)));
}

async function loadLatestState() {
  const database = await getDatabase();
  const documents = await database.queryCollection(accountStatesCollection, {
    orders: [
      { field: 'savedAt', direction: 'desc' },
      { field: '__name__', direction: 'asc' }
    ],
    limit: 1
  });
  return mapStateHeader(database, documents[0]?.data || null);
}

async function listStatePage(options = {}) {
  const database = await getDatabase();
  const limit = Math.min(Math.max(Number(options.limit || 25), 1), 50);
  const afterAccountKey = sanitizeAccountKey(options.afterAccountKey || '');
  const documents = await database.queryCollection(accountStatesCollection, {
    orders: [{ field: '__name__', direction: 'asc' }],
    startAfter: afterAccountKey ? [firestoreDocumentId(afterAccountKey)] : undefined,
    limit: limit + 1
  });
  const page = documents.slice(0, limit);
  const records = await Promise.all(page.map((document) => mapStateHeader(database, document.data)));
  return {
    records,
    hasMore: documents.length > limit,
    nextCursor: documents.length > limit ? records.at(-1)?.accountKey || null : null,
    queryCount: records.length ? 2 : 1
  };
}

async function listVenues(filters = {}) {
  const database = await getDatabase();
  const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 251);
  const documents = await database.queryCollection(accountStatesCollection, {
    orders: [
      { field: 'savedAt', direction: 'desc' },
      { field: '__name__', direction: 'asc' }
    ],
    startAfter: filters.beforeSavedAt
      ? [String(filters.beforeSavedAt), firestoreDocumentId(filters.beforeVenueId || 'cursor')]
      : undefined,
    limit
  });
  return Promise.all(documents.map(async (document) => ({
    venueId: document.data.accountKey,
    venueName: document.data.venueName || '',
    savedAt: document.data.savedAt,
    revision: Number(document.data.revision || 0),
    clientCount: await database.countCollection('orbitClients', [
      { field: 'venueId', op: '==', value: document.data.accountKey }
    ])
  })));
}

module.exports = {
  IdempotencyConflictError,
  StateConflictError,
  accountPath,
  accountStatesCollection,
  deserializeState,
  getPublicationStatus,
  globalMutationCollection,
  globalMutationPath,
  invalidateAccountStateHistory,
  listHistoricalStates,
  listStatePage,
  listVenues,
  loadLatestState,
  loadGlobalMutationReceipt,
  loadStateMutationReceipt,
  loadState,
  loadStateRevision,
  legacyMutationPath,
  mutationPath,
  mutationReference,
  opaqueReference,
  publicationCollection,
  publicationDocumentId,
  publicationPath,
  saveState,
  serializeStateEntities,
  stateEncoding
};
