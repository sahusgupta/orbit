import { createHash, createHmac, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(__filename);
const checkpoints = require('./checkpoints.js');
const stateStore = require('./state.js');
const connection = require('./connection.js');

const { beginCheckpoint, checkpointLimits, checkpointManifest, checkpointStatus, finalizeCheckpoint, getCheckpointChunk, putCheckpointChunk } = checkpoints;
const accountKey = 'checkpoint-test';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const state = (extra = {}) => ({
  games: [], sessions: [], playerSessions: [], profiles: [],
  settings: { pilotAccess: { licenseId: accountKey } }, ...extra
});
const upload = (value = state(), mutationId = 'synthetic-save', expectedRevision = 0) => {
  const source = Buffer.from(JSON.stringify(value), 'utf8');
  const manifest = {
    protocol: 'checkpoint-v1', accountKey, mutationId, expectedRevision, sourceBytes: source.length,
    chunkCount: Math.ceil(source.length / checkpointLimits.chunkBytes), sha256: hash(source)
  };
  const chunks = Array.from({ length: manifest.chunkCount }, (_, index) =>
    source.subarray(index * checkpointLimits.chunkBytes, (index + 1) * checkpointLimits.chunkBytes).toString('base64'));
  return { source, manifest, chunks };
};
async function stage(value, mutationId = 'synthetic-save', revision = 0) {
  const input = upload(value, mutationId, revision);
  const begun = await beginCheckpoint(input.manifest);
  for (let index = 0; index < input.chunks.length; index += 1) {
    await putCheckpointChunk(accountKey, begun.id, index, input.chunks[index]);
  }
  return { ...input, ...begun };
}

beforeEach(async () => connection.resetDatabaseForTests());
afterEach(() => vi.unstubAllEnvs());

describe('bounded authoritative checkpoint bridge', () => {
  it('resumes reordered/duplicate UTF-8 chunks beyond two million bytes without exposing partial state', async () => {
    const original = state({
      playerLedger: [{ id: 'retained', amount: 100, note: '♠'.repeat(710_000) }, { id: 'ordinary-accounting', amount: 15 }],
      sessions: [{ id: 'ordinary-session', status: 'Running' }],
      interests: [{ id: 'ordinary-check-in', status: 'Arrived' }]
    });
    const input = upload(original);
    expect(input.source.length).toBeGreaterThan(2_000_000);
    const begun = await beginCheckpoint(input.manifest);
    expect(begun.id).toMatch(/^[a-f0-9]{64}$/);
    for (const index of [2, 0, 2]) await putCheckpointChunk(accountKey, begun.id, index, input.chunks[index]);
    expect(await checkpointStatus(accountKey, begun.id)).toMatchObject({ received: [0, 2] });
    await expect(finalizeCheckpoint(accountKey, begun.id)).rejects.toMatchObject({ code: 'CHECKPOINT_INCOMPLETE' });
    expect(await stateStore.loadState(accountKey)).toBeNull();
    await connection.closeDatabase();
    expect(await beginCheckpoint(input.manifest)).toMatchObject({ id: begun.id, received: [0, 2] });
    for (let index = input.chunks.length - 1; index >= 0; index -= 1) {
      expect(Buffer.byteLength(JSON.stringify({ accountKey, data: input.chunks[index] }))).toBeLessThan(checkpointLimits.maximumEnvelopeBytes);
      await putCheckpointChunk(accountKey, begun.id, index, input.chunks[index]);
    }
    const result = await finalizeCheckpoint(accountKey, begun.id);
    expect(result).toMatchObject({ ok: true, revision: 1, duplicate: false, publication: { status: 'pending' } });
    expect((await stateStore.loadState(accountKey)).state).toEqual(original);
    const manifest = await checkpointManifest(accountKey);
    expect(manifest).toMatchObject({ sourceBytes: input.source.length, sha256: input.manifest.sha256, revision: 1 });
    const received = [];
    for (let index = 0; index < manifest.chunkCount; index += 1) {
      const chunk = await getCheckpointChunk(accountKey, 1, index);
      expect(Buffer.byteLength(JSON.stringify(chunk))).toBeLessThan(checkpointLimits.maximumEnvelopeBytes);
      received.push(Buffer.from(chunk.data, 'base64'));
    }
    const recovered = Buffer.concat(received);
    expect(recovered.length).toBe(input.source.length);
    expect(hash(recovered)).toBe(hash(input.source));
    expect((await connection.getDatabase()).mode).toBe('memory');
  });

  it('recovers a lost commit response through the durable receipt after staging cleanup and later writes', async () => {
    const first = await stage(state({ playerLedger: [{ id: 'one-entry', amount: 25 }] }));
    await finalizeCheckpoint(accountKey, first.id); // response is deliberately discarded
    const firstReplay = await finalizeCheckpoint(accountKey, first.id);
    expect(firstReplay).toMatchObject({ revision: 1, duplicate: true });
    const second = await stage(state({ playerLedger: [{ id: 'one-entry', amount: 25 }, { id: 'second-entry', amount: 10 }] }), 'second-operation', 1);
    await finalizeCheckpoint(accountKey, second.id);
    expect(await beginCheckpoint(first.manifest)).toMatchObject({ completed: true, result: { revision: 1, duplicate: true } });
    expect((await stateStore.loadState(accountKey)).state.playerLedger).toHaveLength(2);
    await expect(beginCheckpoint({ ...first.manifest, sha256: '0'.repeat(64) }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });
    const database = await connection.getDatabase();
    const outbox = await database.queryCollection(stateStore.publicationCollection, { limit: 10 });
    expect(outbox).toHaveLength(2);
    expect(await database.getDocument(checkpoints.chunkPath(accountKey, 0))).toBeNull();
  });

  it('does not retry a business action when publication failed after its durable commit', async () => {
    const input = await stage(state({ playerLedger: [{ id: 'receipt', amount: 50 }] }));
    await finalizeCheckpoint(accountKey, input.id);
    const database = await connection.getDatabase();
    await database.updateDocument(stateStore.publicationPath(accountKey, 1), { status: 'failed', attempts: 1, error: 'synthetic publisher failure' });
    expect(await finalizeCheckpoint(accountKey, input.id)).toMatchObject({ revision: 1, duplicate: true, publication: { status: 'failed' } });
    expect((await stateStore.loadState(accountKey)).state.playerLedger).toHaveLength(1);
  });

  it('rejects changed manifests, changed duplicate chunks, checksums and incomplete finalization', async () => {
    const input = upload();
    const begun = await beginCheckpoint(input.manifest);
    await expect(beginCheckpoint({ ...input.manifest, expectedRevision: 1 })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(beginCheckpoint({ ...input.manifest, mutationId: 'other-upload' })).rejects.toMatchObject({ code: 'CHECKPOINT_BUSY', status: 429 });
    await putCheckpointChunk(accountKey, begun.id, 0, input.chunks[0]);
    const different = Buffer.from(input.source);
    different[1] = 32;
    await expect(putCheckpointChunk(accountKey, begun.id, 0, different.toString('base64'))).rejects.toMatchObject({ code: 'CHECKPOINT_CHUNK_CONFLICT' });
    await connection.resetDatabaseForTests();
    const corrupt = await beginCheckpoint({ ...input.manifest, sha256: '0'.repeat(64) });
    await putCheckpointChunk(accountKey, corrupt.id, 0, input.chunks[0]);
    await expect(finalizeCheckpoint(accountKey, corrupt.id)).rejects.toMatchObject({ code: 'CHECKPOINT_CHECKSUM_MISMATCH' });
    expect(await stateStore.loadState(accountKey)).toBeNull();
  });

  it('bounds source/chunk counts, base64 bytes, protocol versions, UTF-8 and chunk indices', async () => {
    const input = upload();
    await expect(beginCheckpoint({ ...input.manifest, sourceBytes: checkpointLimits.maximumSourceBytes + 1 })).rejects.toMatchObject({ code: 'CHECKPOINT_SOURCE_LIMIT' });
    await expect(beginCheckpoint({ ...input.manifest, chunkCount: 129 })).rejects.toMatchObject({ code: 'CHECKPOINT_CHUNK_COUNT_INVALID' });
    await expect(beginCheckpoint({ ...input.manifest, protocol: 'future-v99' })).rejects.toMatchObject({ status: 426 });
    const begun = await beginCheckpoint(input.manifest);
    await expect(putCheckpointChunk(accountKey, begun.id, -1, input.chunks[0])).rejects.toMatchObject({ code: 'CHECKPOINT_INDEX_INVALID' });
    await expect(putCheckpointChunk(accountKey, begun.id, 128, input.chunks[0])).rejects.toMatchObject({ code: 'CHECKPOINT_INDEX_INVALID' });
    await expect(putCheckpointChunk(accountKey, begun.id, 0, 'a'.repeat(400_000))).rejects.toMatchObject({ code: 'CHECKPOINT_CHUNK_LIMIT' });
    await expect(putCheckpointChunk(accountKey, begun.id, 0, 'AA==')).rejects.toMatchObject({ code: 'CHECKPOINT_CHUNK_LENGTH' });
    await connection.resetDatabaseForTests();
    const invalidUtf8 = Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125]);
    const invalid = await beginCheckpoint({ ...input.manifest, sourceBytes: invalidUtf8.length, sha256: hash(invalidUtf8) });
    await putCheckpointChunk(accountKey, invalid.id, 0, invalidUtf8.toString('base64'));
    await expect(finalizeCheckpoint(accountKey, invalid.id)).rejects.toMatchObject({ code: 'CHECKPOINT_JSON_INVALID' });
  });

  it('expires incomplete uploads and permits bounded slot recovery without dropping committed history', async () => {
    const input = upload();
    const now = Date.now();
    const begun = await beginCheckpoint(input.manifest, now);
    await putCheckpointChunk(accountKey, begun.id, 0, input.chunks[0], now);
    const expired = now + checkpointLimits.expiresAfterMs;
    await expect(checkpointStatus(accountKey, begun.id, expired)).rejects.toMatchObject({ code: 'CHECKPOINT_EXPIRED' });
    await expect(finalizeCheckpoint(accountKey, begun.id, expired)).rejects.toMatchObject({ code: 'CHECKPOINT_EXPIRED' });
    const resumed = await beginCheckpoint(input.manifest, expired);
    expect(resumed).toMatchObject({ id: begun.id, received: [] });
    expect(await (await connection.getDatabase()).getDocument(checkpoints.chunkPath(accountKey, 0))).toBeNull();
  });

  it('allows another device to recover a disconnected upload after its idle lease without letting stale work overwrite the new commit', async () => {
    const now = Date.now();
    const deviceA = upload(state({ playerLedger: [{ id: 'device-a-pending', amount: 10 }] }), 'device-a', 0);
    const a = await beginCheckpoint(deviceA.manifest, now - checkpointLimits.takeoverAfterMs - 1);
    await putCheckpointChunk(accountKey, a.id, 0, deviceA.chunks[0], now - checkpointLimits.takeoverAfterMs - 1);
    // Reading status and retrying the same chunk do not extend an idle lease.
    await checkpointStatus(accountKey, a.id, now);
    await putCheckpointChunk(accountKey, a.id, 0, deviceA.chunks[0], now);
    const deviceB = upload(state({ playerLedger: [{ id: 'device-b-confirmed', amount: 25 }] }), 'device-b', 0);
    const b = await beginCheckpoint(deviceB.manifest, now);
    await putCheckpointChunk(accountKey, b.id, 0, deviceB.chunks[0], now);
    await expect(finalizeCheckpoint(accountKey, a.id)).rejects.toMatchObject({ code: 'CHECKPOINT_NOT_FOUND' });
    await finalizeCheckpoint(accountKey, b.id);
    expect((await stateStore.loadState(accountKey)).state.playerLedger).toEqual([{ id: 'device-b-confirmed', amount: 25 }]);
    const aResume = await beginCheckpoint(deviceA.manifest);
    expect(aResume.received).toEqual([]);
    await putCheckpointChunk(accountKey, aResume.id, 0, deviceA.chunks[0]);
    await expect(finalizeCheckpoint(accountKey, aResume.id)).rejects.toMatchObject({ code: 'STATE_REVISION_CONFLICT', currentRevision: 1 });
    expect(hash(deviceA.source)).toBe(deviceA.manifest.sha256);
    expect((await stateStore.loadState(accountKey)).state.playerLedger).toEqual([{ id: 'device-b-confirmed', amount: 25 }]);
  });

  it('binds state to its tenant, preserves server-owned fields, and rejects stale venue revisions', async () => {
    const serverFields = { selfCheckIn: { enabled: true }, membershipQrTokens: [{ id: 'server-token' }], tournamentInterests: [{ id: 'server-interest' }] };
    const original = state(serverFields);
    await stateStore.saveState(original, { expectedRevision: 0, mutationId: 'canonical' });
    const incoming = state({ selfCheckIn: { enabled: false }, membershipQrTokens: [{ id: 'forged' }], tournamentInterests: [] });
    const staged = await stage(incoming, 'server-fields', 1);
    await finalizeCheckpoint(accountKey, staged.id);
    const canonical = await stateStore.loadState(accountKey);
    expect(canonical.state).toMatchObject(serverFields);
    const stale = await stage(state(), 'stale', 1);
    await expect(finalizeCheckpoint(accountKey, stale.id)).rejects.toMatchObject({ code: 'STATE_REVISION_CONFLICT', currentRevision: 2 });
    await checkpoints.invalidateAccountCheckpoint(accountKey);
    const wrongTenant = state({ settings: { pilotAccess: { licenseId: 'other-tenant' } } });
    const other = await stage(wrongTenant, 'wrong-tenant', 2);
    await expect(finalizeCheckpoint(accountKey, other.id)).rejects.toMatchObject({ status: 403, code: 'CHECKPOINT_TENANT_MISMATCH' });
  });

  it('preserves privacy tombstones at commit and invalidates staging and old recovery revisions during deletion', async () => {
    const secret = 'synthetic-checkpoint-pseudonym-secret-32';
    vi.stubEnv('ORBIT_DELETION_PSEUDONYM_SECRET', secret);
    vi.stubEnv('ORBIT_ACCOUNT_DELETION_POLICY_JSON', JSON.stringify({ financialRecords: 'anonymize', auditRecords: 'anonymize', providerRecords: 'retain' }));
    const subject = `deleted_${createHmac('sha256', secret).update('deleted-player').digest('hex').slice(0, 24)}`;
    const original = state({ profiles: [{ id: 'deleted-player', name: 'Synthetic Name' }] });
    await stateStore.saveState(original, { expectedRevision: 0, mutationId: 'original' });
    await stateStore.saveState(state({ playerPrivacyTombstones: [subject] }), { expectedRevision: 1, mutationId: 'delete', invalidatePriorRevisions: true });
    const oldSnapshot = await stage({ ...original, playerPrivacyTombstones: [] }, 'stale-private-data', 2);
    await finalizeCheckpoint(accountKey, oldSnapshot.id);
    const canonical = await stateStore.loadState(accountKey);
    expect(canonical.state.profiles).toEqual([]);
    expect(canonical.state.playerPrivacyTombstones).toEqual([subject]);
    await expect(getCheckpointChunk(accountKey, 1, 0)).rejects.toMatchObject({ code: 'CHECKPOINT_REVISION_UNAVAILABLE' });
    const pending = await stage(state(), 'pending-during-delete', 3);
    await stateStore.invalidateAccountStateHistory(accountKey, 2);
    await expect(checkpointStatus(accountKey, pending.id)).rejects.toMatchObject({ code: 'CHECKPOINT_NOT_FOUND' });
    expect(await (await connection.getDatabase()).getDocument(checkpoints.chunkPath(accountKey, 0))).toBeNull();
  });

  it('bounds decompression of stored state and permits pinned recovery until privacy invalidation', async () => {
    await stateStore.saveState(state({ profiles: [{ id: 'before' }] }), { expectedRevision: 0, mutationId: 'one' });
    const first = await checkpointManifest(accountKey);
    await stateStore.saveState(state({ profiles: [{ id: 'after' }] }), { expectedRevision: 1, mutationId: 'two' });
    const chunk = await getCheckpointChunk(accountKey, first.revision, 0);
    expect(JSON.parse(Buffer.from(chunk.data, 'base64').toString('utf8')).profiles).toEqual([{ id: 'before' }]);
    const database = await connection.getDatabase();
    const headerPath = stateStore.accountPath(accountKey);
    const header = await database.getDocument(headerPath);
    const stateChunkPath = `${headerPath}/stateChunks/${String(2).padStart(12, '0')}_0000`;
    await database.updateDocument(stateChunkPath, { payload: gzipSync(Buffer.alloc(checkpointLimits.maximumSourceBytes + 1, 32)) });
    await database.setDocument(headerPath, { ...header, stateSourceBytes: 1 });
    // Metadata polling remains bounded even when a stored payload is corrupt;
    // materializing a requested chunk still enforces decompression limits.
    await expect(getCheckpointChunk(accountKey, 2, 0)).rejects.toMatchObject({ code: 'CHECKPOINT_DECOMPRESSED_LIMIT', status: 413 });
  });

  it('bounds concurrent large allocations and allows retry after the active checkpoint finishes', async () => {
    const input = await stage(state());
    const first = finalizeCheckpoint(accountKey, input.id);
    await expect(finalizeCheckpoint(accountKey, input.id)).rejects.toMatchObject({ code: 'CHECKPOINT_BUSY', status: 429 });
    await first;
    await expect(finalizeCheckpoint(accountKey, input.id)).resolves.toMatchObject({ ok: true, duplicate: true, revision: 1 });
  });

  it('keeps privacy-safe domain audit events for committed changes without repeating them on acknowledgement retry', async () => {
    await stateStore.saveState(state(), { expectedRevision: 0, mutationId: 'before-audit' });
    const input = await stage(state({
      profiles: [{ id: 'sensitive-profile-id', name: 'Private Synthetic Name' }],
      sessions: [{ id: 'sensitive-session-id', gameId: 'holdem', status: 'Running' }],
      interests: [{ id: 'sensitive-interest-id', profileId: 'sensitive-profile-id', gameId: 'holdem', status: 'Arrived' }]
    }), 'audit-action', 1);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { logStateChanges } = require('../http/domainEvents');
    const options = { onCommittedState: (previousState, nextState) => logStateChanges(previousState, nextState, accountKey) };
    try {
      await finalizeCheckpoint(accountKey, input.id, undefined, options);
      await finalizeCheckpoint(accountKey, input.id, undefined, options);
      const output = log.mock.calls.map((entry) => String(entry[0])).join('\n');
      expect(output.match(/"event":"player-added"/g)).toHaveLength(1);
      expect(output.match(/"event":"game-formed"/g)).toHaveLength(1);
      expect(output.match(/"event":"game-request-added"/g)).toHaveLength(1);
      expect(output).not.toMatch(/Private Synthetic Name|sensitive-profile-id|sensitive-session-id|sensitive-interest-id/);
    } finally { log.mockRestore(); }
  });

  it('rejects a source that exceeds the recovery budget only after preserving authoritative server fields', async () => {
    await stateStore.saveState(state({ selfCheckIn: { marker: 's'.repeat(4_096) } }), { expectedRevision: 0, mutationId: 'server-fields' });
    const incoming = state({ retainedHistory: 'x'.repeat(checkpointLimits.maximumSourceBytes - 2_048) });
    const input = upload(incoming, 'server-field-budget', 1);
    expect(input.source.length).toBeLessThan(checkpointLimits.maximumSourceBytes);
    const begun = await beginCheckpoint(input.manifest);
    // Seed a fully received staging fixture directly. This keeps the boundary
    // test focused on atomic finalization rather than repeatedly cloning a
    // 32 MiB in-memory Firestore fixture for every upload chunk transaction.
    const database = await connection.getDatabase();
    const headerPath = checkpoints.stagingPath(accountKey);
    const header = await database.getDocument(headerPath);
    for (let index = 0; index < input.chunks.length; index += 1) {
      const bytes = Buffer.from(input.chunks[index], 'base64');
      await database.setDocument(checkpoints.chunkPath(accountKey, index), { uploadId: begun.id, generation: header.generation, payload: bytes, sha256: hash(bytes) });
    }
    await database.setDocument(headerPath, { ...header, received: input.chunks.map((_value, index) => index) });
    await expect(finalizeCheckpoint(accountKey, begun.id)).rejects.toMatchObject({ status: 413, code: 'CHECKPOINT_SOURCE_LIMIT' });
    const canonical = await stateStore.loadState(accountKey);
    expect(canonical.revision).toBe(1);
    expect(canonical.state).not.toHaveProperty('retainedHistory');
  });

  it('reports incompressible storage overflow as a permanent budget error while retaining the pending checkpoint', async () => {
    const input = upload(state({ retainedHistory: randomBytes(8_100_000).toString('base64') }), 'compressed-budget');
    expect(input.source.length).toBeLessThan(checkpointLimits.maximumSourceBytes);
    const begun = await beginCheckpoint(input.manifest);
    const database = await connection.getDatabase();
    const headerPath = checkpoints.stagingPath(accountKey);
    const header = await database.getDocument(headerPath);
    for (let index = 0; index < input.chunks.length; index += 1) {
      const bytes = Buffer.from(input.chunks[index], 'base64');
      await database.setDocument(checkpoints.chunkPath(accountKey, index), { uploadId: begun.id, generation: header.generation, payload: bytes, sha256: hash(bytes) });
    }
    await database.setDocument(headerPath, { ...header, received: input.chunks.map((_value, index) => index) });
    await expect(finalizeCheckpoint(accountKey, begun.id)).rejects.toMatchObject({ status: 413, code: 'CHECKPOINT_COMPRESSED_LIMIT' });
    expect(await stateStore.loadState(accountKey)).toBeNull();
    expect((await checkpointStatus(accountKey, begun.id)).received).toHaveLength(input.chunks.length);
    expect(hash(input.source)).toBe(input.manifest.sha256);
  });
});
