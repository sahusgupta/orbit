const crypto = require('crypto');
const { TextDecoder } = require('util');
const { getDatabase } = require('./connection');
const stateStore = require('./state');
const { getAccountKeyFromState, sanitizeAccountKey, validateStatePayload } = require('../orbitCore');
const { preserveServerManagedState } = require('../stateProtection');
const { maximumStagingChunks, stagingPath, chunkPath, cleanupInactiveChunks, invalidateAccountCheckpoint } = require('./checkpointStaging');

const checkpointLimits = Object.freeze({
  protocol: 'checkpoint-v1', chunkBytes: 262_144, maximumSourceBytes: 33_554_432,
  maximumChunks: maximumStagingChunks, maximumEnvelopeBytes: 400_000, expiresAfterMs: 86_400_000,
  maximumCompressedBytes: stateStore.maximumCompressedStateBytes, takeoverAfterMs: 60_000
});
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
let activeAllocations = 0;

class CheckpointError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'CheckpointError';
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) { throw new CheckpointError(status, code, message); }
async function boundedAllocation(operation) {
  // Serverless concurrency is per runtime. Never let simultaneous checkpoint
  // finalizations/downloads multiply the bridge's maximum allocation here.
  if (activeAllocations) fail(429, 'CHECKPOINT_BUSY', 'Checkpoint recovery is busy; retry after one second.');
  activeAllocations += 1;
  try { return await operation(); }
  finally { activeAllocations -= 1; }
}
function account(value) {
  const key = sanitizeAccountKey(value);
  if (!key || key !== value) fail(400, 'CHECKPOINT_ACCOUNT_INVALID', 'A normalized accountKey is required.');
  return key;
}
const mutationKey = (mutationId) => `checkpoint:${mutationId}`;
const uploadId = (accountKey, mutationId) => sha256(`${accountKey}\u0000${mutationId}`);

function validateManifest(input) {
  const accountKey = account(input.accountKey);
  if (input.protocol !== checkpointLimits.protocol) fail(426, 'CHECKPOINT_PROTOCOL_UNSUPPORTED', 'A compatible checkpoint protocol is required.');
  if (!/^[a-zA-Z0-9._:-]{1,160}$/.test(input.mutationId || '')) fail(400, 'CHECKPOINT_MUTATION_INVALID', 'A stable mutationId is required.');
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail(400, 'CHECKPOINT_REVISION_INVALID', 'A non-negative expectedRevision is required.');
  if (!Number.isSafeInteger(input.sourceBytes) || input.sourceBytes < 2 || input.sourceBytes > checkpointLimits.maximumSourceBytes) {
    fail(413, 'CHECKPOINT_SOURCE_LIMIT', 'The checkpoint exceeds the source byte budget.');
  }
  if (input.chunkCount !== Math.ceil(input.sourceBytes / checkpointLimits.chunkBytes) || input.chunkCount > checkpointLimits.maximumChunks) {
    fail(400, 'CHECKPOINT_CHUNK_COUNT_INVALID', 'The checkpoint chunk count is invalid.');
  }
  if (!/^[a-f0-9]{64}$/.test(input.sha256 || '')) fail(400, 'CHECKPOINT_CHECKSUM_INVALID', 'A SHA-256 checksum is required.');
  return {
    protocol: checkpointLimits.protocol, accountKey, mutationId: input.mutationId, expectedRevision: input.expectedRevision,
    sourceBytes: input.sourceBytes, chunkCount: input.chunkCount, sha256: input.sha256
  };
}

function fingerprint(manifest) { return sha256(JSON.stringify(manifest)); }
function assertUpload(header, id, nowMs) {
  if (!/^[a-f0-9]{64}$/.test(id || '') || !header || header.id !== id) fail(404, 'CHECKPOINT_NOT_FOUND', 'The checkpoint was not found.');
  if (Date.parse(header.expiresAt) <= nowMs && !header.completed) fail(410, 'CHECKPOINT_EXPIRED', 'The checkpoint expired; resume from a new upload.');
}
function publicUpload(header) {
  return {
    ok: true, id: header.id, protocol: header.protocol, accountKey: header.accountKey,
    expectedRevision: header.expectedRevision, sourceBytes: header.sourceBytes, chunkCount: header.chunkCount,
    sha256: header.sha256, received: header.received || [], expiresAt: header.expiresAt,
    lastActivityAt: header.lastActivityAt || header.createdAt,
    ...(header.completed ? { completed: true, result: header.result } : {})
  };
}

async function receiptResult(accountKey, mutationId, expectedFingerprint) {
  const receipt = await stateStore.loadStateMutationReceipt(accountKey, mutationKey(mutationId));
  if (!receipt) return null;
  if (receipt.fingerprint !== expectedFingerprint) fail(409, 'IDEMPOTENCY_CONFLICT', 'The operation ID was already used for different content.');
  return {
    accountKey, savedAt: receipt.createdAt, revision: receipt.revision, mutationId,
    duplicate: true, publication: await stateStore.getPublicationStatus(accountKey, receipt.revision)
  };
}

async function beginCheckpoint(input, nowMs = Date.now(), options = {}) {
  const manifest = validateManifest(input);
  const id = uploadId(manifest.accountKey, manifest.mutationId);
  const contentFingerprint = fingerprint(manifest);
  const committed = await receiptResult(manifest.accountKey, manifest.mutationId, contentFingerprint);
  if (committed) return publicUpload({ ...manifest, id, expiresAt: new Date(nowMs + checkpointLimits.expiresAfterMs).toISOString(), completed: true, result: committed });
  const database = await getDatabase();
  const { result, cleanupSlots } = await database.runTransaction(async (transaction) => {
    const path = stagingPath(manifest.accountKey);
    const existing = await transaction.getDocument(path);
    if (existing?.id === id && existing.fingerprint !== contentFingerprint) fail(409, 'IDEMPOTENCY_CONFLICT', 'The operation ID was already used for different content.');
    if (existing && !existing.completed && Date.parse(existing.expiresAt) > nowMs) {
      if (existing.id === id) return { result: publicUpload(existing), cleanupSlots: 0 };
      if (nowMs - Date.parse(existing.lastActivityAt || existing.createdAt) < checkpointLimits.takeoverAfterMs) {
        fail(429, 'CHECKPOINT_BUSY', 'Another checkpoint is making progress; retry after one second.');
      }
    }
    const header = {
      ...manifest, id, fingerprint: contentFingerprint, received: [], completed: false,
      generation: crypto.randomUUID(),
      stagingSlots: Math.max(Number(existing?.stagingSlots ?? existing?.chunkCount ?? 0), manifest.chunkCount),
      createdAt: new Date(nowMs).toISOString(), lastActivityAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + checkpointLimits.expiresAfterMs).toISOString()
    };
    // Fixed indices cap residual staging independently of attacker-supplied
    // operation IDs. Replacing an expired/completed slot removes old bytes.
    transaction.setDocument(path, header);
    return { result: publicUpload(header), cleanupSlots: Number(existing?.stagingSlots ?? existing?.chunkCount ?? 0) };
  });
  // Cleanup cannot fit 128 deleted 256 KiB documents in Firestore's 10 MiB
  // transaction budget. Its bounded batches preserve the new active generation.
  await cleanupInactiveChunks(manifest.accountKey, cleanupSlots).catch(() => {
    options.onCleanupPending?.();
  });
  return result;
}

async function checkpointStatus(accountKey, id, nowMs = Date.now()) {
  const database = await getDatabase();
  const header = await database.getDocument(stagingPath(account(accountKey)));
  assertUpload(header, id, nowMs);
  return publicUpload(header);
}

async function putCheckpointChunk(accountKey, id, index, data, nowMs = Date.now()) {
  account(accountKey);
  if (!Number.isSafeInteger(index) || index < 0 || index >= checkpointLimits.maximumChunks) fail(400, 'CHECKPOINT_INDEX_INVALID', 'The checkpoint index is invalid.');
  if (typeof data !== 'string' || data.length > Math.ceil(checkpointLimits.chunkBytes / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
    fail(413, 'CHECKPOINT_CHUNK_LIMIT', 'The checkpoint chunk exceeds its byte budget or has invalid encoding.');
  }
  const bytes = Buffer.from(data, 'base64');
  if (bytes.toString('base64') !== data) fail(400, 'CHECKPOINT_CHUNK_INVALID', 'The checkpoint encoding is invalid.');
  const database = await getDatabase();
  return database.runTransaction(async (transaction) => {
    const header = await transaction.getDocument(stagingPath(accountKey));
    assertUpload(header, id, nowMs);
    if (header.completed) return { ok: true, id, index };
    if (index >= header.chunkCount) fail(400, 'CHECKPOINT_INDEX_INVALID', 'The checkpoint index is invalid.');
    const expectedBytes = index === header.chunkCount - 1 ? header.sourceBytes - index * checkpointLimits.chunkBytes : checkpointLimits.chunkBytes;
    if (bytes.length !== expectedBytes) fail(400, 'CHECKPOINT_CHUNK_LENGTH', 'The checkpoint chunk has an unexpected byte length.');
    const previous = await transaction.getDocument(chunkPath(accountKey, index));
    const contentHash = sha256(bytes);
    if (previous?.uploadId === id && previous.generation === header.generation && previous.sha256 !== contentHash) fail(409, 'CHECKPOINT_CHUNK_CONFLICT', 'This checkpoint chunk already contains different content.');
    const received = [...new Set([...header.received, index])].sort((left, right) => left - right);
    const madeProgress = !header.received.includes(index);
    transaction.setDocument(chunkPath(accountKey, index), { uploadId: id, generation: header.generation, payload: bytes, sha256: contentHash, expiresAt: new Date(header.expiresAt) });
    transaction.setDocument(stagingPath(accountKey), {
      ...header, received, lastActivityAt: madeProgress ? new Date(nowMs).toISOString() : header.lastActivityAt || header.createdAt
    });
    return { ok: true, id, index };
  });
}

async function finalizeCheckpointInternal(accountKey, id, nowMs, options) {
  const database = await getDatabase();
  const header = await database.getDocument(stagingPath(account(accountKey)));
  assertUpload(header, id, nowMs);
  const priorResult = await receiptResult(accountKey, header.mutationId, header.fingerprint);
  if (priorResult) return { ok: true, ...priorResult };
  if (header.received.length !== header.chunkCount) fail(409, 'CHECKPOINT_INCOMPLETE', 'The checkpoint is incomplete; upload the missing chunks before finalizing.');
  // A strict 32 MiB source limit bounds this emergency bridge's allocation. It
  // still materializes one snapshot; domain commands will remove that cost.
  const source = Buffer.alloc(header.sourceBytes);
  const hash = crypto.createHash('sha256');
  for (let index = 0; index < header.chunkCount; index += 1) {
    const chunk = await database.getDocument(chunkPath(accountKey, index));
    if (chunk?.uploadId !== id || chunk.generation !== header.generation || !chunk.payload) fail(409, 'CHECKPOINT_INCOMPLETE', 'A checkpoint chunk is missing; resume the upload.');
    const bytes = Buffer.from(chunk.payload);
    const expectedBytes = index === header.chunkCount - 1 ? header.sourceBytes - index * checkpointLimits.chunkBytes : checkpointLimits.chunkBytes;
    if (bytes.length !== expectedBytes || sha256(bytes) !== chunk.sha256) fail(409, 'CHECKPOINT_CHUNK_CORRUPT', 'A checkpoint chunk failed verification.');
    bytes.copy(source, index * checkpointLimits.chunkBytes);
    hash.update(bytes);
  }
  if (hash.digest('hex') !== header.sha256) fail(409, 'CHECKPOINT_CHECKSUM_MISMATCH', 'The checkpoint checksum does not match.');
  let state;
  try { state = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(source)); }
  catch { fail(400, 'CHECKPOINT_JSON_INVALID', 'The checkpoint must contain valid UTF-8 JSON.'); }
  validateStatePayload(state);
  if (getAccountKeyFromState(state) !== accountKey) fail(403, 'CHECKPOINT_TENANT_MISMATCH', 'The checkpoint cannot write another venue.');
  let auditPreviousState;
  let auditNextState;
  let result;
  try {
    result = await stateStore.saveState(state, {
      expectedRevision: header.expectedRevision, mutationId: mutationKey(header.mutationId),
      mutationType: 'desktop-checkpoint', mutationFingerprint: header.fingerprint,
      maximumSourceBytes: checkpointLimits.maximumSourceBytes,
      transactionPrecondition: async ({ currentState, transaction }) => {
        // Reading the staging header in this transaction also prevents another
        // upload from replacing its slot before the authoritative commit.
        const currentUpload = await transaction.getDocument(stagingPath(accountKey));
        assertUpload(currentUpload, id, Date.now());
        if (currentUpload.fingerprint !== header.fingerprint || currentUpload.generation !== header.generation) fail(409, 'CHECKPOINT_CHANGED', 'The checkpoint changed during finalization.');
        const nextState = preserveServerManagedState(state, currentState);
        if (Buffer.byteLength(JSON.stringify(nextState), 'utf8') > checkpointLimits.maximumSourceBytes) {
          fail(413, 'CHECKPOINT_SOURCE_LIMIT', 'The checkpoint with preserved server fields exceeds the source byte budget.');
        }
        // Keep these solely in this bounded invocation. Returning them in the
        // acknowledgement would expose history and defeat envelope limits.
        auditPreviousState = currentState;
        auditNextState = nextState;
        return { nextState };
      }
    });
  } catch (error) {
    if (error.code === 'STATE_COMPRESSED_LIMIT') {
      fail(413, 'CHECKPOINT_COMPRESSED_LIMIT', 'The checkpoint exceeds the compressed storage transaction budget. Preserve the pending source for recovery.');
    }
    throw error;
  }
  if (!result.duplicate && auditNextState) options.onCommittedState?.(auditPreviousState, auditNextState);
  const acknowledgement = { ...result, mutationId: header.mutationId };
  // The state receipt is authoritative if a process dies before this marker or
  // cleanup. A retry returns it without repeating the business effect.
  try {
    await database.runTransaction(async (transaction) => {
      const current = await transaction.getDocument(stagingPath(accountKey));
      if (current?.id !== id || current.generation !== header.generation) return;
      transaction.setDocument(stagingPath(accountKey), { ...current, completed: true, result: acknowledgement });
    });
    await cleanupInactiveChunks(accountKey, Number(header.stagingSlots || header.chunkCount));
  } catch {
    // Cleanup failure cannot revoke a durable business commit. The retained
    // receipt acknowledges retries, and TTL/replacement resumes byte cleanup.
    options.onCleanupPending?.();
  }
  return { ok: true, ...acknowledgement };
}

async function readCheckpointInternal(accountKey, revision) {
  account(accountKey);
  const database = await getDatabase();
  const current = await database.getDocument(stateStore.accountPath(accountKey));
  if (!current) fail(404, 'CHECKPOINT_STATE_NOT_FOUND', 'Venue state was not found.');
  const selectedRevision = revision === undefined ? Number(current.revision) : Number(revision);
  if (!Number.isSafeInteger(selectedRevision) || selectedRevision < Number(current.minimumPublishableRevision || 1) || selectedRevision > Number(current.revision)) {
    fail(409, 'CHECKPOINT_REVISION_UNAVAILABLE', 'The checkpoint revision is unavailable; restart recovery from the current manifest.');
  }
  if (selectedRevision === Number(current.revision) && Number(current.stateSourceBytes) > checkpointLimits.maximumSourceBytes) {
    fail(413, 'CHECKPOINT_SOURCE_LIMIT', 'The checkpoint exceeds the supported recovery byte budget.');
  }
  let chunkCount = Number(current.stateChunkCount);
  if (selectedRevision !== Number(current.revision)) {
    const chunks = await database.queryCollection(`${stateStore.accountPath(accountKey)}/stateChunks`, {
      filters: [{ field: 'revision', op: '==', value: selectedRevision }], limit: 21
    });
    chunkCount = chunks.length;
  }
  let state;
  try {
    state = await stateStore.loadStateRevision(accountKey, selectedRevision, chunkCount, { maximumSourceBytes: checkpointLimits.maximumSourceBytes });
  } catch (error) {
    if (error.code === 'ERR_BUFFER_TOO_LARGE') fail(413, 'CHECKPOINT_DECOMPRESSED_LIMIT', 'The checkpoint exceeds the decompressed source byte budget.');
    throw error;
  }
  // Recheck the privacy floor after loading; a deletion can invalidate the
  // pinned revision while the bounded read is in flight.
  const latest = await database.getDocument(stateStore.accountPath(accountKey));
  if (!latest || selectedRevision < Number(latest.minimumPublishableRevision || 1)) fail(409, 'CHECKPOINT_REVISION_UNAVAILABLE', 'The checkpoint revision was invalidated; restart recovery.');
  const source = Buffer.from(JSON.stringify(state), 'utf8');
  if (source.length > checkpointLimits.maximumSourceBytes) fail(413, 'CHECKPOINT_SOURCE_LIMIT', 'The checkpoint exceeds the supported recovery byte budget.');
  return { source, header: current, revision: selectedRevision };
}

const finalizeCheckpoint = (accountKey, id, nowMs = Date.now(), options = {}) =>
  boundedAllocation(() => finalizeCheckpointInternal(accountKey, id, nowMs, options));
const readCheckpoint = (accountKey, revision) =>
  boundedAllocation(() => readCheckpointInternal(accountKey, revision));

async function checkpointManifest(accountKey, knownRevision) {
  account(accountKey);
  if (knownRevision !== undefined && (!Number.isSafeInteger(knownRevision) || knownRevision < 0)) {
    fail(400, 'CHECKPOINT_REVISION_INVALID', 'A non-negative knownRevision is required.');
  }
  const database = await getDatabase();
  const header = await database.getDocument(stateStore.accountPath(accountKey));
  if (!header) fail(404, 'CHECKPOINT_STATE_NOT_FOUND', 'Venue state was not found.');
  if (Number(header.stateSourceBytes) > checkpointLimits.maximumSourceBytes) {
    fail(413, 'CHECKPOINT_SOURCE_LIMIT', 'The checkpoint exceeds the supported recovery byte budget.');
  }
  if (Number(header.stateCompressedBytes) > checkpointLimits.maximumCompressedBytes) {
    fail(413, 'CHECKPOINT_COMPRESSED_LIMIT', 'The checkpoint exceeds the compressed storage transaction budget.');
  }
  if (!Number.isSafeInteger(header.revision) || header.revision < 1
    || !Number.isSafeInteger(header.stateSourceBytes) || header.stateSourceBytes < 2
    || !Number.isSafeInteger(header.stateCompressedBytes) || header.stateCompressedBytes < 1
    || !Number.isSafeInteger(header.stateChunkCount) || header.stateChunkCount < 1 || header.stateChunkCount > 20
    || !/^[a-f0-9]{64}$/.test(header.stateContentHash || '')) {
    fail(500, 'CHECKPOINT_METADATA_INVALID', 'Authoritative checkpoint metadata is invalid; preserve pending work for recovery.');
  }
  const revision = header.revision;
  // Source bytes and checksum are written atomically with the compressed
  // chunks. Polling this header must never decode or allocate venue history.
  return {
    ok: true, protocol: checkpointLimits.protocol, accountKey, revision, sourceBytes: header.stateSourceBytes,
    chunkBytes: checkpointLimits.chunkBytes, chunkCount: Math.ceil(header.stateSourceBytes / checkpointLimits.chunkBytes),
    sha256: header.stateContentHash, savedAt: header.savedAt,
    publication: await stateStore.getPublicationStatus(accountKey, revision),
    ...(knownRevision === revision ? { notModified: true } : {})
  };
}

async function getCheckpointChunk(accountKey, revision, index) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= checkpointLimits.maximumChunks) fail(400, 'CHECKPOINT_INDEX_INVALID', 'The checkpoint index is invalid.');
  const { source } = await readCheckpoint(accountKey, revision);
  if (index * checkpointLimits.chunkBytes >= source.length) fail(404, 'CHECKPOINT_CHUNK_NOT_FOUND', 'The checkpoint chunk was not found.');
  return {
    ok: true, accountKey, revision: Number(revision), index,
    data: source.subarray(index * checkpointLimits.chunkBytes, (index + 1) * checkpointLimits.chunkBytes).toString('base64')
  };
}

module.exports = {
  CheckpointError, beginCheckpoint, checkpointLimits, checkpointManifest, checkpointStatus,
  finalizeCheckpoint, getCheckpointChunk, putCheckpointChunk, stagingPath, chunkPath, invalidateAccountCheckpoint, cleanupInactiveChunks
};
