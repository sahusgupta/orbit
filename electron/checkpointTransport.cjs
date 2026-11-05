const crypto = require('crypto');
const { getAccountKeyFromState, validateStatePayload } = require('./runtimeUtils.cjs');

const maximumCheckpointBytes = 33_554_432;
const checkpointChunkBytes = 262_144;
const maximumCheckpointEnvelopeBytes = 400_000;

function supportedCheckpoint(value) {
  return value?.protocol === 'checkpoint-v1'
    && value.chunkBytes === checkpointChunkBytes
    && value.maximumSourceBytes === maximumCheckpointBytes
    && value.maximumChunks === 128
    && value.maximumEnvelopeBytes === maximumCheckpointEnvelopeBytes;
}

function sourceForState(state) {
  const source = Buffer.from(JSON.stringify(state), 'utf8');
  if (source.length > maximumCheckpointBytes) throw new Error('The checkpoint exceeds the 32 MiB recovery budget.');
  return { source, sha256: crypto.createHash('sha256').update(source).digest('hex') };
}

function boundCheckpointAcknowledgement(result, pending) {
  if (!result || result.ok !== true || result.accountKey !== pending.accountKey || result.mutationId !== pending.mutationId
    || !Number.isSafeInteger(result.revision) || result.revision !== pending.expectedRevision + 1) {
    return { ok: false, code: 'CHECKPOINT_ACK_INVALID', httpStatus: 409,
      error: 'The checkpoint acknowledgement did not match this venue, operation, and expected commit revision. The pending change is retained and replay is paused for reconciliation.' };
  }
  return result;
}

async function uploadCheckpoint(request, pending, authKey) {
  const { source, sha256 } = sourceForState(pending.state);
  if (sha256 !== pending.sha256) throw new Error('The retained pending save checksum is invalid. Preserve the local cache for recovery.');
  const chunkCount = Math.ceil(source.length / checkpointChunkBytes);
  const options = { authKey, returnFailurePayload: true, timeoutMs: 15_000 };
  const upload = await request('/state/checkpoints', { ...options, method: 'POST', body: {
    protocol: 'checkpoint-v1', accountKey: pending.accountKey,
    mutationId: pending.mutationId, expectedRevision: pending.expectedRevision,
    sourceBytes: source.length, chunkCount, sha256
  } });
  if (!upload?.ok) return upload;
  if (upload.completed) return boundCheckpointAcknowledgement({ ok: true, ...upload.result }, pending);
  if (!/^[a-f0-9]{64}$/.test(String(upload.id || '')) || !Array.isArray(upload.received)
    || upload.received.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= chunkCount)) {
    throw new Error('Orbit returned an invalid checkpoint upload acknowledgement.');
  }
  const received = new Set(upload.received);
  for (let index = 0; index < chunkCount; index += 1) {
    if (received.has(index)) continue;
    const body = { accountKey: pending.accountKey, data: source.subarray(index * checkpointChunkBytes, (index + 1) * checkpointChunkBytes).toString('base64') };
    if (Buffer.byteLength(JSON.stringify(body), 'utf8') > maximumCheckpointEnvelopeBytes) throw new Error('The checkpoint request envelope exceeds its budget.');
    const result = await request(`/state/checkpoints/${upload.id}/chunks/${index}`, { ...options, method: 'POST', body });
    if (!result?.ok) return result;
  }
  const result = await request(`/state/checkpoints/${upload.id}/finalize`, { ...options, timeoutMs: 30_000, method: 'POST', body: { accountKey: pending.accountKey } });
  return result?.ok ? boundCheckpointAcknowledgement(result, pending) : result;
}

async function downloadCheckpoint(request, accountKey, authKey, cachedRecord) {
  const options = { authKey, returnFailurePayload: true, timeoutMs: 15_000 };
  const manifest = await request(`/state/checkpoint/${encodeURIComponent(accountKey)}${cachedRecord ? `?knownRevision=${cachedRecord.revision}` : ''}`, options);
  if (!manifest?.ok) return null;
  if (manifest.protocol !== 'checkpoint-v1' || manifest.accountKey !== accountKey
    || !Number.isSafeInteger(manifest.revision) || manifest.revision < 1
    || !Number.isSafeInteger(manifest.sourceBytes) || manifest.sourceBytes < 1 || manifest.sourceBytes > maximumCheckpointBytes
    || manifest.chunkBytes !== checkpointChunkBytes || manifest.chunkCount !== Math.ceil(manifest.sourceBytes / checkpointChunkBytes)
    || !/^[a-f0-9]{64}$/.test(String(manifest.sha256 || ''))) throw new Error('Orbit returned an invalid recovery manifest.');
  if (manifest.notModified) {
    if (!cachedRecord || cachedRecord.accountKey !== accountKey || cachedRecord.revision !== manifest.revision
      || cachedRecord.sha256 !== manifest.sha256 || cachedRecord.sourceBytes !== manifest.sourceBytes
      || getAccountKeyFromState(cachedRecord.state) !== accountKey) throw new Error('The unchanged recovery acknowledgement does not match the verified local checkpoint.');
    return { ...manifest, state: structuredClone(cachedRecord.state), schemaVersion: 2 };
  }
  const chunks = [];
  for (let index = 0; index < manifest.chunkCount; index += 1) {
    const result = await request(`/state/checkpoint/${encodeURIComponent(accountKey)}/${manifest.revision}/chunks/${index}`, options);
    if (!result?.ok) return null;
    if (result.accountKey !== accountKey || result.revision !== manifest.revision || result.index !== index) {
      throw new Error('The recovery chunk acknowledgement does not match this venue, revision, and index.');
    }
    const expectedBytes = Math.min(checkpointChunkBytes, manifest.sourceBytes - index * checkpointChunkBytes);
    if (typeof result.data !== 'string' || result.data.length !== Math.ceil(expectedBytes / 3) * 4) throw new Error('The recovery chunk exceeds its budget or is incomplete.');
    const bytes = Buffer.from(result.data, 'base64');
    if (bytes.length !== expectedBytes || bytes.toString('base64') !== result.data) throw new Error('The recovery chunk encoding is invalid.');
    chunks.push(bytes);
  }
  const source = Buffer.concat(chunks, manifest.sourceBytes);
  if (crypto.createHash('sha256').update(source).digest('hex') !== manifest.sha256) throw new Error('The recovered checkpoint checksum does not match.');
  const state = JSON.parse(source.toString('utf8'));
  validateStatePayload(state);
  if (getAccountKeyFromState(state) !== accountKey) throw new Error('The recovered checkpoint belongs to another venue.');
  return { ...manifest, state, schemaVersion: 2 };
}

module.exports = { checkpointChunkBytes, downloadCheckpoint, maximumCheckpointBytes, sourceForState, supportedCheckpoint, uploadCheckpoint };
