import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(__filename);

describe('checkpoint cleanup Firestore transaction budgets', () => {
  it('deletes 32 MiB staging in bounded batches and preserves a racing active generation at the same fixed paths', async () => {
    const documents = new Map();
    const deletions = [];
    const store = {
      async runTransaction(operation) {
        const writes = [];
        const deletedPaths = [];
        const result = await operation({
          async getDocument(path) {
            if (writes.length) throw new Error('Firestore requires all reads before writes.');
            return documents.get(path) || null;
          },
          setDocument(path, value) { writes.push(() => documents.set(path, value)); },
          deleteDocument(path) { deletedPaths.push(path); writes.push(() => documents.delete(path)); }
        });
        const deletedBytes = deletedPaths.reduce((sum, path) => sum + (documents.get(path)?.payload?.length || 0), 0);
        if (deletedBytes > 4_000_000) throw new Error('Deleted document bytes exceed the test transaction budget.');
        if (deletedPaths.length) deletions.push({ count: deletedPaths.length, bytes: deletedBytes });
        writes.forEach((write) => write());
        // The new upload can reuse the exact same indices after the old header
        // is invalidated. Later cleanup transactions must retain its chunks.
        if (deletions.length === 1) {
          documents.set(service.stagingPath('budget-test'), { generation: 'new-generation', completed: false, chunkCount: 128, stagingSlots: 128 });
          documents.set(service.chunkPath('budget-test', 50), { generation: 'new-generation', payload });
        }
        return result;
      }
    };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('./checkpointStaging.js'), 'utf8'), {
      module, Buffer, Date,
      require(name) {
        if (name === './connection') return { getDatabase: async () => store };
        return require(name);
      }
    });
    const service = module.exports;
    const payload = Buffer.alloc(262_144);
    for (let index = 0; index < 128; index += 1) documents.set(service.chunkPath('budget-test', index), { generation: 'old-generation', payload });
    await service.cleanupInactiveChunks('budget-test', 128);
    expect(deletions.length).toBe(16);
    expect(deletions.every((batch) => batch.count <= 8 && batch.bytes <= 2_097_152)).toBe(true);
    expect(documents.get(service.chunkPath('budget-test', 50))).toMatchObject({ generation: 'new-generation' });
    const remainingChunks = [...documents.keys()].filter((key) => key.includes('/checkpointChunks/'));
    expect(remainingChunks).toEqual([service.chunkPath('budget-test', 50)]);
  });
});
