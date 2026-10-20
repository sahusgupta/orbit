import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(resolve(process.cwd(), 'apps/api/src/orbitMatchService.test.js'));
const { getDatabase, resetDatabaseForTests } = require('./db/connection.js');
const { createOrbitMatchHandlers, createOrbitMatchService, matchStatePath, operationReceiptPath } = require('./orbitMatchService.js');
const { createMatchState } = require('./shared/orbitMatchState.cjs');
const { playerDeletionMarkerPath } = require('./playerDeletionGuard.js');
const now = Date.parse('2026-10-12T12:00:00Z');
const ref = { clubId: 'club-one', gameId: 'game-one', kind: 'cash' };
const operation = (suffix, overrides = {}) => ({ mutationId: `match-mutation-${suffix}`, type: 'decide', ref,
  summary: { venueName: 'Published Club', gameName: '1/2 NLH' }, decision: 'saved', ...overrides });
beforeEach(async () => resetDatabaseForTests());

describe('transactional owner-scoped Match persistence', () => {
  it('seeds legacy preferences once without changing the Player account or enabling an inactive radius', async () => {
    const database = await getDatabase();
    const profile = { id: 'player-one', uid: 'player-one', favoriteClubIds: ['club-one'], preferredGameIds: ['nlh-1-2', 'random-game'], preferredStakes: '$1/$2', searchRadiusMiles: 20 };
    await database.setDocument('players/player-one', profile);
    const service = createOrbitMatchService({ database, nowMs: () => now });
    const first = await service.read('player-one');
    expect(first.preferences).toMatchObject({ favoriteClubIds: ['club-one'], variants: ['nlh'], stakes: { minBigBlind: 2, maxBigBlind: 2 }, maxDistanceMiles: null });
    await database.setDocument('players/player-one', { ...profile, favoriteClubIds: ['other-club'] });
    expect((await service.read('player-one')).preferences).toEqual(first.preferences);
    expect(await database.getDocument('players/player-one')).toEqual({ ...profile, favoriteClubIds: ['other-club'] });
  });

  it('merges two devices, restores across sessions, and never writes another owner or live availability', async () => {
    const database = await getDatabase();
    const firstDevice = createOrbitMatchService({ database, nowMs: () => now });
    const secondDevice = createOrbitMatchService({ database, nowMs: () => now + 1 });
    await Promise.all([firstDevice.operate('player-one', operation('one')),
      secondDevice.operate('player-one', operation('two', { ref: { ...ref, gameId: 'game-two' } }))]);
    const restored = await createOrbitMatchService({ database, nowMs: () => now + 2 }).read('player-one');
    expect(restored.revision).toBe(2);
    expect(restored.decisions.map((item) => item.ref.gameId).sort()).toEqual(['game-one', 'game-two']);
    expect(await database.getDocument(matchStatePath('player-two'))).toBeNull();
    expect(await database.getDocument('clubs/club-one/games/game-one')).toBeNull();
  });

  it('makes retries permanent and rejects a reused ID with a different payload without changing state', async () => {
    const database = await getDatabase();
    const service = createOrbitMatchService({ database, nowMs: () => now });
    const first = await service.operate('player-one', operation('one'));
    const later = createOrbitMatchService({ database, nowMs: () => now + 366 * 24 * 60 * 60 * 1000 });
    expect((await later.operate('player-one', operation('one'))).decisions).toEqual(first.decisions);
    expect((await later.read('player-one')).revision).toBe(2); // retention prunes the old event, never the save.
    await expect(service.operate('player-one', operation('one', { decision: 'passed' }))).rejects.toMatchObject({ code: 'MATCH_MUTATION_ID_REUSED', status: 409 });
    expect((await service.read('player-one')).decisions).toEqual(first.decisions);
    expect(await database.getDocument(operationReceiptPath('player-one', 'match-mutation-one'))).toMatchObject({ digest: expect.any(String) });
  });

  it('checks the deletion fence within the atomic operation and never recreates private children', async () => {
    const database = await getDatabase();
    await database.setDocument(playerDeletionMarkerPath('player-one'), { status: 'blocked' });
    const service = createOrbitMatchService({ database, nowMs: () => now });
    await expect(service.read('player-one')).rejects.toMatchObject({ status: 410 });
    await expect(service.operate('player-one', operation('one'))).rejects.toMatchObject({ status: 410 });
    expect(await database.getDocument(matchStatePath('player-one'))).toBeNull();
    expect(await database.getDocument(operationReceiptPath('player-one', 'match-mutation-one'))).toBeNull();
  });

  it('fails closed on malformed stored data, injected owner fields, and invalid payload bounds', async () => {
    const database = await getDatabase();
    const service = createOrbitMatchService({ database, nowMs: () => now });
    await database.setDocument(matchStatePath('player-one'), { schemaVersion: 1, revision: 'invalid' });
    await expect(service.operate('player-one', operation('one'))).rejects.toMatchObject({ status: 503 });
    expect(await database.getDocument(matchStatePath('player-one'))).toEqual({ schemaVersion: 1, revision: 'invalid' });
    await expect(service.operate('player-two', { ...operation('two'), uid: 'player-one' })).rejects.toMatchObject({ status: 400 });
    await expect(service.operate('player-two', operation('two', { summary: { venueName: 'A'.repeat(20_000), gameName: 'NLH' } }))).rejects.toMatchObject({ status: 413 });
  });

  it('returns a private public envelope and conflict codes without exposing internal receipt data', async () => {
    const database = await getDatabase();
    const handlers = createOrbitMatchHandlers({ database, nowMs: () => now });
    const response = { statusCode: 200, body: null, headers: {}, set(key, value) { this.headers[key] = value; },
      status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    await handlers.operate({ orbitPlayer: { uid: 'player-one' }, body: operation('one') }, response);
    expect(response.body).toMatchObject({ ok: true, state: { revision: 1 } });
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.body.state).not.toHaveProperty('receipts');
    await handlers.operate({ orbitPlayer: { uid: 'player-one' }, body: { mutationId: 'match-preferences-one', type: 'preferences',
      basePreferencesRevision: 5, preferences: createMatchState().preferences } }, response);
    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({ ok: false, code: 'MATCH_PREFERENCES_CONFLICT' });
  });
});
