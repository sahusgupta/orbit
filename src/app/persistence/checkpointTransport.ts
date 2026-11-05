import { checkpointSha256, type CheckpointCapabilities, type CheckpointRequest, type CheckpointResponse, type CheckpointSaveIdentity } from './checkpointProtocol';
export { checkpointChunkBytes, checkpointSha256, checkpointSourceLimit, parseCheckpointCapabilities } from './checkpointProtocol';
export type { CheckpointCapabilities, CheckpointRequest, CheckpointResponse, CheckpointSaveIdentity } from './checkpointProtocol';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const checkpointBase64 = (bytes: Uint8Array) => {
  // Avoid a spread over an entire chunk (which exceeds some JS call stacks).
  let value = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    value += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(value);
};

export const uploadCheckpoint = async (
  state: unknown, identity: CheckpointSaveIdentity, cap: CheckpointCapabilities, request: CheckpointRequest
): Promise<CheckpointResponse> => {
  const acknowledgementMismatch = (): CheckpointResponse => ({
    ok: false, code: 'CHECKPOINT_ACK_MISMATCH', httpStatus: 409,
    error: 'The server acknowledgement did not match this venue, operation, and revision. Pending work is retained for reconciliation.'
  });
  const committedAcknowledgement = (value: CheckpointResponse | undefined): CheckpointResponse => {
    if (!value || value.ok === false || value.accountKey !== identity.accountKey || value.mutationId !== identity.mutationId
      || !Number.isSafeInteger(value.revision) || value.revision !== identity.expectedRevision + 1) return acknowledgementMismatch();
    return { ...value, ok: true };
  };
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  const chunkCount = Math.ceil(bytes.length / cap.chunkBytes);
  if (bytes.length > cap.maximumSourceBytes || chunkCount > cap.maximumChunks) {
    return { ok: false, error: 'This recovery snapshot exceeds the negotiated checkpoint resource budget. Pending work has been preserved.' };
  }
  const boundedRequest: CheckpointRequest = async (path, body) => {
    if (body !== undefined && new TextEncoder().encode(JSON.stringify(body)).length > cap.maximumEnvelopeBytes) {
      return { ok: false, error: 'The checkpoint request envelope exceeds its negotiated byte limit.' };
    }
    return request(path, body);
  };
  const begin = await boundedRequest('/state/checkpoints', {
    ...identity, protocol: cap.protocol, sourceBytes: bytes.length, chunkCount, sha256: await checkpointSha256(bytes)
  });
  if (!begin.ok || typeof begin.id !== 'string' || !/^[a-f0-9]{64}$/.test(begin.id)) return begin;
  if (begin.completed) return committedAcknowledgement(begin.result);
  const received = new Set((begin.received ?? []).filter((index) => Number.isInteger(index) && index >= 0 && index < chunkCount));
  for (let index = 0; index < chunkCount; index += 1) {
    if (received.has(index)) continue;
    const result = await boundedRequest(`/state/checkpoints/${begin.id}/chunks/${index}`, {
      accountKey: identity.accountKey, data: checkpointBase64(bytes.subarray(index * cap.chunkBytes, (index + 1) * cap.chunkBytes))
    });
    if (!result.ok) return result;
  }
  const finalized = await boundedRequest(`/state/checkpoints/${begin.id}/finalize`, { accountKey: identity.accountKey });
  if (finalized.ok === false) return finalized;
  return finalized.ok === true ? committedAcknowledgement(finalized) : acknowledgementMismatch();
};

export const downloadCheckpoint = async (
  accountKey: string, cap: CheckpointCapabilities,
  request: (path: string) => Promise<unknown>
): Promise<{ accountKey: string; revision: number; state: unknown } | null> => {
  const path = `/state/checkpoint/${encodeURIComponent(accountKey)}`;
  const manifest = await request(path);
  if (!isRecord(manifest) || manifest.ok !== true) return null;
  const { revision, sourceBytes, chunkCount, sha256, chunkBytes } = manifest;
  if (manifest.protocol !== cap.protocol || manifest.accountKey !== accountKey
    || !Number.isSafeInteger(revision) || Number(revision) < 1
    || !Number.isSafeInteger(sourceBytes) || Number(sourceBytes) < 1 || Number(sourceBytes) > cap.maximumSourceBytes
    || chunkBytes !== cap.chunkBytes || !Number.isSafeInteger(chunkCount) || Number(chunkCount) !== Math.ceil(Number(sourceBytes) / cap.chunkBytes)
    || Number(chunkCount) > cap.maximumChunks || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error('The server returned an invalid recovery checkpoint manifest.');
  }
  const bytes = new Uint8Array(Number(sourceBytes));
  for (let index = 0; index < Number(chunkCount); index += 1) {
    const chunk = await request(`${path}/${revision}/chunks/${index}`);
    if (!isRecord(chunk) || chunk.ok !== true || chunk.accountKey !== accountKey || chunk.revision !== revision
      || chunk.index !== index || typeof chunk.data !== 'string' || chunk.data.length > Math.ceil(cap.chunkBytes / 3) * 4) {
      throw new Error('The recovery checkpoint chunk is invalid.');
    }
    const decoded = atob(chunk.data);
    const expectedBytes = Math.min(cap.chunkBytes, bytes.length - index * cap.chunkBytes);
    if (decoded.length !== expectedBytes) throw new Error('The recovery checkpoint chunk is incomplete.');
    for (let offset = 0; offset < decoded.length; offset += 1) bytes[index * cap.chunkBytes + offset] = decoded.charCodeAt(offset);
  }
  if (await checkpointSha256(bytes) !== sha256) throw new Error('The recovery checkpoint checksum did not match.');
  return { accountKey, revision: Number(revision), state: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown };
};
