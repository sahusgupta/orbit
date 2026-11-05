import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(__filename);

describe('header-only checkpoint polling', () => {
  it('returns exact manifest metadata and publication without reading, decoding, or allocating historical state', async () => {
    let header = {
      revision: 7, stateSourceBytes: 2_500_000, stateCompressedBytes: 25_000,
      stateChunkCount: 1, stateContentHash: 'a'.repeat(64), savedAt: '2026-11-04T02:00:00.000Z'
    };
    const getDocument = vi.fn(async (path) => {
      if (path !== 'orbitAccountStates/manifest-test') throw new Error('Manifest polling must not read state chunks.');
      return header;
    });
    const getPublicationStatus = vi.fn(async () => ({ status: 'published' }));
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('./checkpoints.js'), 'utf8'), {
      module, Buffer, Date,
      require(name) {
        if (name === './connection') return { getDatabase: async () => ({ getDocument }) };
        if (name === './state') return { maximumCompressedStateBytes: 8_000_000, accountPath: (accountKey) => `orbitAccountStates/${accountKey}`, getPublicationStatus };
        return require(name);
      }
    });
    const service = module.exports;
    const matching = await service.checkpointManifest('manifest-test', 7);
    expect(matching).toMatchObject({
      ok: true, revision: 7, sourceBytes: 2_500_000, chunkBytes: 262_144, chunkCount: 10,
      sha256: 'a'.repeat(64), notModified: true, publication: { status: 'published' }
    });
    expect(getDocument).toHaveBeenCalledExactlyOnceWith('orbitAccountStates/manifest-test');
    expect(getPublicationStatus).toHaveBeenCalledExactlyOnceWith('manifest-test', 7);
    const stale = await service.checkpointManifest('manifest-test', 6);
    expect(stale).not.toHaveProperty('notModified');
    expect(getDocument).toHaveBeenCalledTimes(2);
    await expect(service.checkpointManifest('manifest-test', -1)).rejects.toMatchObject({ status: 400 });
    header = { ...header, stateSourceBytes: 33_554_433 };
    await expect(service.checkpointManifest('manifest-test', 7)).rejects.toMatchObject({ status: 413, code: 'CHECKPOINT_SOURCE_LIMIT' });
    header = { ...header, stateSourceBytes: 2_500_000, stateCompressedBytes: 8_000_001 };
    await expect(service.checkpointManifest('manifest-test', 7)).rejects.toMatchObject({ status: 413, code: 'CHECKPOINT_COMPRESSED_LIMIT' });
    header = { ...header, stateCompressedBytes: 25_000, stateContentHash: 'invalid' };
    await expect(service.checkpointManifest('manifest-test', 7)).rejects.toMatchObject({ status: 500, code: 'CHECKPOINT_METADATA_INVALID' });
  });
});
