import { beforeEach, describe, expect, it, vi } from 'vitest';
import connection from './db/connection.js';
import deletionGuard from './playerDeletionGuard.js';

const { getDatabase, resetDatabaseForTests } = connection;
const {
  createRequireActivePlayerAccount,
  isPlayerDeletionMarked,
  markPlayerDeletion,
  playerDeletionBlockPath,
  playerDeletionMarkerPath
} = deletionGuard;

beforeEach(async () => resetDatabaseForTests());

function responseHarness() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

describe('durable Player deletion barriers', () => {
  it('persists an opaque server marker and a rules-visible self-write block', async () => {
    const database = await getDatabase();
    const playerId = 'firebase-player-one';
    await markPlayerDeletion(database, playerId, {
      nowMs: () => Date.parse('2026-09-04T18:00:00.000Z')
    });

    const markerPath = playerDeletionMarkerPath(playerId);
    const marker = await database.getDocument(markerPath);
    expect(markerPath).toMatch(/^orbitPlayerDeletionMarkers\/deleted_[a-f0-9]{64}$/);
    expect(markerPath).not.toContain(playerId);
    expect(JSON.stringify(marker)).not.toContain(playerId);
    expect(marker).toEqual({
      status: 'blocked',
      createdAt: '2026-09-04T18:00:00.000Z',
      updatedAt: '2026-09-04T18:00:00.000Z'
    });
    expect(await database.getDocument(playerDeletionBlockPath(playerId)))
      .toMatchObject({ status: 'blocked' });
    await expect(isPlayerDeletionMarked(playerId, { database })).resolves.toBe(true);
  });

  it('fails a marked authenticated player closed while leaving account deletion retryable', async () => {
    const database = await getDatabase();
    await markPlayerDeletion(database, 'deleting-player');
    const middleware = createRequireActivePlayerAccount({ database });
    const next = vi.fn();
    const response = responseHarness();

    await middleware({ orbitPlayer: { uid: 'deleting-player' } }, response, next);

    expect(response).toMatchObject({
      statusCode: 410,
      body: { ok: false, code: 'PLAYER_ACCOUNT_DELETION_IN_PROGRESS' }
    });
    expect(next).not.toHaveBeenCalled();

    const activeResponse = responseHarness();
    await middleware({ orbitPlayer: { uid: 'active-player' } }, activeResponse, next);
    expect(next).toHaveBeenCalledOnce();
    expect(activeResponse.body).toBeUndefined();
  });
});
