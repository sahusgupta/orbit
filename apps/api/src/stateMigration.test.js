import { afterAll, describe, expect, it } from 'vitest';
import database from './database.js';

const initialState = {
  games: [{ id: 'holdem', name: 'Holdem', maxSeats: 9 }],
  sessions: [],
  playerSessions: [],
  profiles: [{ id: 'initial-player', name: 'Initial Player' }],
  settings: { clubAccount: { clubName: 'Initial Club', email: 'initial@example.com' } }
};

afterAll(async () => {
  await database.closeDatabase();
});

describe('revision-zero Firestore initialization', () => {
  it('creates the first authoritative checkpoint from an approved offline cache migration', async () => {
    await expect(database.loadState('initial-example.com')).resolves.toBeNull();

    await expect(database.saveState(initialState, {
      expectedRevision: 0,
      mutationId: 'initial-cache-import',
      mutationType: 'cache-migration'
    })).resolves.toMatchObject({ revision: 1, changedEntityCount: 2 });

    await expect(database.loadState('initial-example.com')).resolves.toMatchObject({
      schemaVersion: 2,
      revision: 1,
      state: initialState
    });
  });
});
