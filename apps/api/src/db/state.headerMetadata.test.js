import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

// Exercise both CommonJS modules through the same loader/cache so each test
// resets the memory store actually used by saveState.
const require = createRequire(__filename);
const connection = require('./connection.js');
const stateStore = require('./state.js');

const { closeDatabase, getDatabase, resetDatabaseForTests } = connection;
const { accountPath, globalMutationPath, loadState, mutationPath, publicationPath, saveState } = stateStore;
const accountKey = 'header-synthetic';

function fixture() {
  return {
    games: [], sessions: [], playerSessions: [], profiles: [],
    settings: {
      pilotAccess: { licenseId: accountKey },
      clubAccount: { clubName: 'Synthetic Incoming Club', email: 'header@example.test' }
    }
  };
}

async function persistedDocuments() {
  const database = await getDatabase();
  return {
    header: await database.getDocument(accountPath(accountKey)),
    chunks: await database.queryCollection(`${accountPath(accountKey)}/stateChunks`),
    mutations: await database.queryCollection(`${accountPath(accountKey)}/mutations`),
    publications: await database.queryCollection('orbitPublicationOutbox'),
    globalReceipts: await database.queryCollection('orbitGlobalMutationReceipts')
  };
}

beforeEach(async () => {
  vi.stubEnv('ORBIT_FIRESTORE_MEMORY', 'true');
  vi.stubEnv('ORBIT_API_URL', 'http://127.0.0.1:9');
  vi.stubEnv('VITE_ENABLE_FIREBASE_SYNC', 'false');
  await resetDatabaseForTests();
});

afterEach(async () => {
  await resetDatabaseForTests();
  await closeDatabase();
  vi.unstubAllEnvs();
});

describe('authoritative state header metadata at the commit boundary', () => {
  it('preserves the original state/header/result shapes without a precondition', async () => {
    const requested = fixture();
    const result = await saveState(requested, { expectedRevision: 0, mutationId: 'plain' });
    const documents = await persistedDocuments();

    expect(result).toEqual({
      accountKey, savedAt: expect.any(String), revision: 1, mutationId: 'plain', duplicate: false,
      idempotencyResult: null, transactionResult: null, changedEntityCount: 0,
      publication: { status: 'pending', attempts: 0, error: '', publishedAt: null, nextAttemptAt: result.savedAt }
    });
    expect(Object.keys(documents.header).sort()).toEqual([
      'accountKey', 'minimumPublishableRevision', 'revision', 'savedAt', 'schemaVersion',
      'stateChunkCount', 'stateCompressedBytes', 'stateContentHash', 'stateEncoding',
      'stateSourceBytes', 'updatedAt', 'venueName'
    ]);
    expect(await loadState(accountKey)).toEqual({
      accountKey, venueName: requested.settings.clubAccount.clubName, schemaVersion: 2,
      savedAt: result.savedAt, revision: 1, publication: result.publication, state: requested
    });
    expect(documents.chunks).toHaveLength(1);
    expect(documents.mutations).toHaveLength(1);
    expect(documents.publications).toHaveLength(1);
    expect(documents.globalReceipts).toEqual([]);
  });

  it.each([undefined, null, { result: { boundary: 'commit' } }])(
    'keeps the incoming state when the callback returns no replacement: %j', async (evaluated) => {
      const requested = fixture();
      const transactionPrecondition = vi.fn(async (context) => {
        expect(context).toMatchObject({ accountKey, currentState: null, nextState: requested });
        expect(typeof context.transaction.getDocument).toBe('function');
        return evaluated;
      });
      const result = await saveState(requested, { expectedRevision: 0, mutationId: 'no-replacement', transactionPrecondition });

      expect(transactionPrecondition).toHaveBeenCalledOnce();
      expect(result.transactionResult).toEqual(evaluated?.result || null);
      expect(await loadState(accountKey)).toMatchObject({
        venueName: requested.settings.clubAccount.clubName, revision: 1, state: requested
      });
    }
  );

  it('commits a same-account replacement, global receipt and publication together', async () => {
    const requested = fixture();
    const replacement = { ...requested, profiles: [{ id: 'synthetic-player', name: 'Synthetic Player' }] };
    const result = await saveState(requested, {
      expectedRevision: 0, mutationId: 'replacement',
      globalMutationScope: 'synthetic-scope', globalMutationFingerprint: 'synthetic-fingerprint',
      transactionPrecondition: async () => ({
        nextState: replacement, result: { globalMutationResult: { accepted: true }, boundary: 'commit' }
      })
    });
    const database = await getDatabase();

    expect(await loadState(accountKey)).toMatchObject({
      venueName: replacement.settings.clubAccount.clubName, revision: 1, state: replacement
    });
    expect(result).toMatchObject({ changedEntityCount: 1, idempotencyResult: { accepted: true } });
    expect(await database.getDocument(globalMutationPath('synthetic-scope'))).toMatchObject({
      accountKey, revision: 1, result: { accepted: true }
    });
    expect(await database.getDocument(mutationPath(accountKey, 'replacement'))).toMatchObject({ accountKey, revision: 1 });
    expect(await database.getDocument(publicationPath(accountKey, 1))).toMatchObject({
      accountKey, revision: 1, status: 'pending', stateChunkCount: 1
    });
    expect(requested).toEqual(fixture());
  });

  it.each([
    ['cross-account', { ...fixture(), settings: { ...fixture().settings, pilotAccess: { licenseId: 'other-synthetic' } } },
      'A state transaction transform cannot change the account key.'],
    ['invalid', { ...fixture(), games: null }, 'State payload is missing games.']
  ])('rejects a %s replacement without partial state, receipt or publication', async (_label, nextState, message) => {
    await expect(saveState(fixture(), {
      expectedRevision: 0, mutationId: 'invalid-transform',
      transactionPrecondition: async () => ({ nextState })
    })).rejects.toThrow(message);

    expect(await persistedDocuments()).toEqual({ header: null, chunks: [], mutations: [], publications: [], globalReceipts: [] });
  });

  it('preserves the prior complete commit when a later callback rejects', async () => {
    await saveState(fixture(), { expectedRevision: 0, mutationId: 'prior' });
    const before = await persistedDocuments();
    await expect(saveState(fixture(), {
      expectedRevision: 1, mutationId: 'rejected',
      transactionPrecondition: async ({ currentState }) => {
        expect(currentState).toEqual(fixture());
        throw new Error('Synthetic precondition failure.');
      }
    })).rejects.toThrow('Synthetic precondition failure.');
    expect(await persistedDocuments()).toEqual(before);
  });

  it('replays a duplicate without rerunning its transform or rewriting the header', async () => {
    const requested = fixture();
    const replacement = { ...requested, profiles: [{ id: 'synthetic-player' }] };
    const transactionPrecondition = vi.fn(async () => ({ nextState: replacement }));
    await saveState(requested, { expectedRevision: 0, mutationId: 'duplicate', transactionPrecondition });
    const before = await persistedDocuments();
    const replay = await saveState(requested, { expectedRevision: 0, mutationId: 'duplicate', transactionPrecondition });

    expect(replay).toMatchObject({ accountKey, revision: 1, duplicate: true });
    expect(transactionPrecondition).toHaveBeenCalledOnce();
    expect(await persistedDocuments()).toEqual(before);
  });

  it.each(['Synthetic Committed Club', '', null, undefined])(
    'derives the header name from the final replacement name: %j', async (clubName) => {
      const requested = fixture();
      await saveState(requested, { expectedRevision: 0, mutationId: 'initial' });
      const replacement = {
        ...requested,
        settings: {
          ...requested.settings,
          clubAccount: { email: 'header@example.test', ...(clubName === undefined ? {} : { clubName }) }
        }
      };
      const result = await saveState(requested, {
        expectedRevision: 1, mutationId: 'rename',
        transactionPrecondition: async () => ({ nextState: replacement })
      });
      const stored = await loadState(accountKey);

      expect(result).toMatchObject({ revision: 2, duplicate: false });
      expect(stored.state).toEqual(replacement);
      expect(stored.venueName).toBe(clubName || '');
      expect((await persistedDocuments()).header.venueName).toBe(stored.venueName);
      expect(requested).toEqual(fixture());
    }
  );

  it('uses the actually encoded name when a callback mutates its supplied state in place', async () => {
    const requested = fixture();
    await saveState(requested, {
      expectedRevision: 0, mutationId: 'in-place',
      transactionPrecondition: async ({ nextState }) => {
        nextState.settings.clubAccount.clubName = 'Synthetic In-place Club';
      }
    });
    const stored = await loadState(accountKey);

    expect(stored.state.settings.clubAccount.clubName).toBe('Synthetic In-place Club');
    expect(stored.venueName).toBe(stored.state.settings.clubAccount.clubName);
  });
});
