import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import database from './database.js';
import publicationOutbox from './db/publicationOutbox.js';

const { closeDatabase, listPublicationOutbox, loadState, saveState } = database;
const { claimNextPublication, markFailed, publishClaimed } = publicationOutbox;

function state(profileName = 'Ada') {
  return {
    games: [{ id: 'holdem', name: 'Holdem', maxSeats: 9 }],
    sessions: [],
    playerSessions: [],
    profiles: [{ id: 'player-1', name: profileName }],
    settings: { clubAccount: { clubName: 'Revision Club', email: 'revision@example.com' } }
  };
}

afterAll(async () => {
  await closeDatabase();
});

describe('authoritative state architecture', () => {
  it('uses Firestore compare-and-swap revisions, idempotent mutations, chunked state, and one outbox record per commit', async () => {
    const first = await saveState(state(), { expectedRevision: 0, mutationId: 'mutation-1' });
    expect(first).toMatchObject({ revision: 1, duplicate: false, publication: { status: 'pending' } });

    const duplicate = await saveState(state('Forged retry body'), { expectedRevision: 0, mutationId: 'mutation-1' });
    expect(duplicate).toMatchObject({ revision: 1, duplicate: true });
    expect((await loadState('revision-example.com')).state.profiles[0].name).toBe('Ada');

    await expect(saveState(state('Stale'), { expectedRevision: 0, mutationId: 'mutation-stale' }))
      .rejects.toEqual(expect.objectContaining({
        name: 'StateConflictError',
        code: 'STATE_REVISION_CONFLICT',
        currentRevision: 1
      }));

    const second = await saveState(state('Grace'), { expectedRevision: 1, mutationId: 'mutation-2' });
    expect(second).toMatchObject({ revision: 2, duplicate: false, changedEntityCount: 1 });
    expect((await loadState('revision-example.com'))).toMatchObject({
      schemaVersion: 2,
      revision: 2,
      state: state('Grace')
    });

    const queued = await listPublicationOutbox({ accountKey: 'revision-example.com' });
    expect(queued).toHaveLength(2);
    expect(queued.map((item) => item.revision).sort()).toEqual([1, 2]);

    await closeDatabase();
    expect(await loadState('revision-example.com')).toMatchObject({ revision: 2, state: state('Grace') });
  });

  it('publishes claimed revisions with stable commit identities and records retryable failure', async () => {
    const first = await claimNextPublication();
    expect(first).toMatchObject({ accountKey: 'revision-example.com', revision: 1, attempts: 1 });
    const publish = vi.fn().mockRejectedValue(new Error('isolated Firebase outage'));
    await expect(publishClaimed(first, { publishStateToFirebase: publish })).resolves.toMatchObject({
      ok: false,
      error: 'isolated Firebase outage'
    });
    expect(publish).toHaveBeenCalledWith(first.state, {
      savedAt: first.createdAt,
      syncRevision: 'revision-example.com:1'
    });
    expect(await listPublicationOutbox({ accountKey: 'revision-example.com' })).toEqual(expect.arrayContaining([
      expect.objectContaining({ revision: 1, status: 'failed', attempts: 1, error: 'isolated Firebase outage' }),
      expect.objectContaining({ revision: 2, status: 'pending', attempts: 0 })
    ]));
    expect(await claimNextPublication()).toBeNull();

    const retry = await claimNextPublication(new Date(Date.now() + 20 * 60 * 1000).toISOString());
    expect(retry).toMatchObject({ accountKey: 'revision-example.com', revision: 1, attempts: 2 });
    await expect(publishClaimed(retry, {
      publishStateToFirebase: vi.fn().mockResolvedValue({ ok: true })
    })).resolves.toMatchObject({ ok: true });
    await markFailed(first, new Error('late stale worker failure'));
    expect(await listPublicationOutbox({ accountKey: 'revision-example.com' })).toEqual(expect.arrayContaining([
      expect.objectContaining({ revision: 1, status: 'published', attempts: 2, error: '' })
    ]));
  });

  it('rejects a state that cannot fit in one bounded Firestore transaction', async () => {
    const oversized = {
      ...state(),
      settings: {
        ...state().settings,
        clubAccount: { clubName: 'Oversized Club', email: 'oversized@example.com' },
        incompressiblePadding: randomBytes(8_100_000).toString('base64')
      }
    };
    await expect(saveState(oversized, { expectedRevision: 0, mutationId: 'oversized-state' }))
      .rejects.toThrow('The authoritative state exceeds the Firestore transaction size limit.');
  }, 15_000);
});
