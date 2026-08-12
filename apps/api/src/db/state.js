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

function mutationPath(accountKey, mutationId) {
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
  const expectedRevision = Number(options.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error('A non-negative expectedRevision is required for state mutations.');
  }
  if (!mutationId) throw new Error('A stable mutationId is required for state mutations.');
  const encoded = encodeState(state);

  return database.runTransaction(async (transaction) => {
    const existingMutation = await transaction.getDocument(mutationPath(accountKey, mutationId));
    if (existingMutation) {
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
    const revision = currentRevision + 1;
    const changedEntityCount = countEntityChanges(previousState, state);

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
      stateEncoding,
      stateChunkCount: encoded.chunks.length,
      stateCompressedBytes: encoded.compressedBytes,
      stateSourceBytes: encoded.sourceBytes,
      stateContentHash: encoded.contentHash
    });
    transaction.createDocument(mutationPath(accountKey, mutationId), {
      accountKey,
      mutationId,
      mutationType,
      revision,
      createdAt: savedAt
    });
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
      changedEntityCount,
      publication: { status: 'pending', attempts: 0, error: '', publishedAt: null, nextAttemptAt: savedAt }
    };
  });
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
  StateConflictError,
  accountStatesCollection,
  deserializeState,
  getPublicationStatus,
  listStatePage,
  listVenues,
  loadLatestState,
  loadState,
  loadStateRevision,
  publicationCollection,
  publicationDocumentId,
  publicationPath,
  saveState,
  serializeStateEntities,
  stateEncoding
};
