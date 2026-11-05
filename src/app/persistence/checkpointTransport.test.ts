import { describe, expect, it } from 'vitest';
import { checkpointSha256, downloadCheckpoint, parseCheckpointCapabilities, uploadCheckpoint, type CheckpointResponse } from './checkpointTransport';

const cap = { protocol: 'checkpoint-v1' as const, chunkBytes: 262144, maximumSourceBytes: 33554432, maximumChunks: 128, maximumEnvelopeBytes: 400000 };
const id = 'a'.repeat(64);
const identity = { accountKey: 'synthetic-venue', mutationId: 'synthetic-operation', expectedRevision: 8 };

describe('bounded emergency checkpoint transport', () => {
  it('negotiates only supported, bounded capabilities', () => {
    expect(parseCheckpointCapabilities({ ok: true, checkpoint: cap })).toEqual(cap);
    for (const override of [{ protocol: 'future' }, { chunkBytes: 4_000_000 }, { maximumChunks: 129 }, { maximumSourceBytes: Infinity }, { maximumEnvelopeBytes: 2_000_000 }]) {
      expect(parseCheckpointCapabilities({ ok: true, checkpoint: { ...cap, ...override } })).toBeNull();
    }
    expect(parseCheckpointCapabilities({ checkpoint: cap })).toBeNull();
  });

  it('preserves multibyte retained operational history above 2MB while bounding complete request envelopes', async () => {
    const state = { profiles: [{ notes: '♠🃏'.repeat(310000) }], playerLedger: [{ id: 'history', amount: 42 }], playerSessions: [{ id: 'checked-in' }] };
    const calls: Array<{ path: string; body: unknown }> = [];
    const chunks: Uint8Array[] = [];
    const result = await uploadCheckpoint(state, identity, cap, async (path, body) => {
      calls.push({ path, body });
      expect(new TextEncoder().encode(JSON.stringify(body)).length).toBeLessThanOrEqual(cap.maximumEnvelopeBytes);
      if (path.endsWith('/checkpoints')) return { ok: true, id, received: [] };
      if (path.endsWith('/finalize')) return { ok: true, accountKey: identity.accountKey, mutationId: identity.mutationId, revision: 9, publication: { status: 'failed' } };
      const data = (body as { data: string }).data;
      chunks.push(Uint8Array.from(atob(data), (char) => char.charCodeAt(0)));
      return { ok: true };
    });
    const source = new TextEncoder().encode(JSON.stringify(state));
    expect(source.length).toBeGreaterThan(2_000_000);
    const received = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) { received.set(chunk, offset); offset += chunk.length; }
    expect(JSON.parse(new TextDecoder().decode(received))).toEqual(state);
    expect(calls[0].body).toMatchObject({ ...identity, sourceBytes: source.length, sha256: await checkpointSha256(source) });
    expect(result).toMatchObject({ ok: true, revision: 9, publication: { status: 'failed' } });
  });

  it('resumes acknowledged chunks and stops on authentication failure without finalizing', async () => {
    const paths: string[] = [];
    const result = await uploadCheckpoint({ history: 'x'.repeat(700000) }, identity, cap, async (path) => {
      paths.push(path);
      return path.endsWith('/checkpoints') ? { ok: true, id, received: [1, 1, -1, 999] } : { ok: false, httpStatus: 401 };
    });
    expect(paths).toEqual(['/state/checkpoints', `/state/checkpoints/${id}/chunks/0`]);
    expect(result.httpStatus).toBe(401);
  });

  it('reuses the server receipt after a lost finalize response', async () => {
    const paths: string[] = [];
    const result = await uploadCheckpoint({ history: [] }, identity, cap, async (path) => {
      paths.push(path);
      return { ok: true, id, completed: true, result: { accountKey: identity.accountKey, mutationId: identity.mutationId, revision: 9, duplicate: true } };
    });
    expect(paths).toEqual(['/state/checkpoints']);
    expect(result).toMatchObject({ ok: true, revision: 9, duplicate: true });
  });

  it.each(['receipt', 'finalize'] as const)('retains work when a %s acknowledgement has a wrong or missing tenant, operation, or committed revision', async (stage) => {
    const valid = { ok: true, accountKey: identity.accountKey, mutationId: identity.mutationId, revision: 9 };
    const invalidAcknowledgements: CheckpointResponse[] = [
      { ...valid, accountKey: 'another-venue' }, { ...valid, accountKey: undefined },
      { ...valid, mutationId: 'another-operation' }, { ...valid, mutationId: undefined },
      { ...valid, revision: 8 }, { ...valid, revision: 10 }, { ...valid, revision: undefined }, { ...valid, revision: 9.5 }
    ];
    for (const acknowledgement of invalidAcknowledgements) {
      const result = await uploadCheckpoint({ history: [] }, identity, cap, async (path) => {
        if (path.endsWith('/checkpoints')) return stage === 'receipt'
          ? { ok: true, id, completed: true, result: acknowledgement } : { ok: true, id, received: [] };
        if (path.endsWith('/finalize')) return acknowledgement;
        return { ok: true };
      });
      expect(result).toMatchObject({ ok: false, code: 'CHECKPOINT_ACK_MISMATCH', httpStatus: 409 });
      expect(result.error).toContain('retained');
    }
  });

  it('refuses source/envelope budget violations before sending an unsafe request', async () => {
    const paths: string[] = [];
    const request = async (path: string): Promise<CheckpointResponse> => { paths.push(path); return { ok: true, id }; };
    expect((await uploadCheckpoint({ history: 'x'.repeat(3000) }, identity, { ...cap, maximumSourceBytes: 1000 }, request)).ok).toBe(false);
    expect(paths).toEqual([]);
    expect((await uploadCheckpoint({ history: 'x'.repeat(3000) }, identity, { ...cap, maximumEnvelopeBytes: 1000 }, request)).ok).toBe(false);
    expect(paths).toEqual(['/state/checkpoints']);
  });

  it('recovers a pinned snapshot only after validating chunk size, tenant, revision, and checksum', async () => {
    const state = { history: '♠'.repeat(100000) };
    const bytes = new TextEncoder().encode(JSON.stringify(state));
    const manifest = { ...cap, ok: true, ...identity, revision: 9, sourceBytes: bytes.length, chunkCount: Math.ceil(bytes.length / cap.chunkBytes), sha256: await checkpointSha256(bytes) };
    const request = async (path: string): Promise<unknown> => {
      if (!path.includes('/chunks/')) return manifest;
      const index = Number(path.split('/').at(-1));
      const chunk = bytes.subarray(index * cap.chunkBytes, (index + 1) * cap.chunkBytes);
      return { ok: true, accountKey: identity.accountKey, revision: 9, index, data: Buffer.from(chunk).toString('base64') };
    };
    await expect(downloadCheckpoint(identity.accountKey, cap, request)).resolves.toEqual({ accountKey: identity.accountKey, revision: 9, state });
    manifest.sha256 = '0'.repeat(64);
    await expect(downloadCheckpoint(identity.accountKey, cap, request)).rejects.toThrow('checksum');
    manifest.accountKey = 'other-tenant';
    await expect(downloadCheckpoint(identity.accountKey, cap, request)).rejects.toThrow('manifest');
  });
});
