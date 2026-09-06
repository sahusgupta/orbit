import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(__filename);

function firestoreOrderHarness() {
  const documents = new Map();
  const store = {
    async runTransaction(operation) {
      const writes = [];
      const result = await operation({
        async getDocument(path) {
          if (writes.length) throw new Error('Firestore transactions require all reads before writes.');
          return documents.get(path) || null;
        },
        setDocument(path, value) { writes.push(() => documents.set(path, value)); },
        createDocument(path, value) {
          if (documents.has(path)) throw new Error('Document already exists.');
          writes.push(() => documents.set(path, value));
        },
        deleteDocument(path) { writes.push(() => documents.delete(path)); }
      });
      writes.forEach((write) => write());
      return result;
    }
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('./state.js'), 'utf8'), {
    module, Buffer, Date,
    require(name) {
      if (name === './connection') return { firestoreDocumentId: encodeURIComponent, getDatabase: async () => store };
      return require(name);
    }
  });
  return { state: module.exports, documents };
}

describe('state-save duplicate recovery with real Firestore ordering', () => {
  it.each([
    { legacy: true, global: false },
    { legacy: true, global: true },
    { legacy: false, global: true }
  ])('preserves a duplicate while migrating receipts: %j', async ({ legacy, global }) => {
    const { state, documents } = firestoreOrderHarness();
    const accountKey = 'release-example.test';
    const mutationId = 'original-mutation';
    const original = { revision: 7, createdAt: '2026-09-01T12:00:00Z', mutationType: 'state-replace' };
    const originalPath = legacy ? state.legacyMutationPath(accountKey, mutationId) : state.mutationPath(accountKey, mutationId);
    documents.set(originalPath, original);
    documents.set(state.publicationPath(accountKey, 7), { status: 'published', attempts: 1 });
    const result = await state.saveState({
      games: [], sessions: [], playerSessions: [], profiles: [],
      settings: { clubAccount: { clubName: 'Release QA', email: 'release@example.test' } }
    }, {
      expectedRevision: 0, mutationId,
      ...(global ? { globalMutationScope: 'reviewed-scope', globalMutationFingerprint: 'reviewed-fingerprint' } : {})
    });
    expect(result).toMatchObject({ accountKey, revision: 7, duplicate: true, publication: { status: 'published' } });
    expect(documents.get(state.mutationPath(accountKey, mutationId))).toMatchObject(original);
    if (legacy) expect(documents.has(originalPath)).toBe(false);
    if (global) expect(documents.get(state.globalMutationPath('reviewed-scope'))).toMatchObject({ accountKey, revision: 7 });
    expect(documents.has(state.accountPath(accountKey))).toBe(false);
    expect(documents.size).toBe(global ? 3 : 2);
  });
});
