import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it, vi } from 'vitest';
import database from './database.js';
import publicationOutbox from './db/publicationOutbox.js';

const databasePath = path.join(os.tmpdir(), `orbit-state-architecture-${process.pid}-${Date.now()}.sqlite3`);
process.env.DATABASE_URL = `file:${databasePath}`;

const { closeDatabase, listPublicationOutbox, loadState, saveState } = database;
const { claimNextPublication, publishClaimed } = publicationOutbox;

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
  for (const suffix of ['', '-shm', '-wal']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
});

describe('authoritative state architecture', () => {
  it('uses compare-and-swap revisions, idempotent mutations, normalized entities, and one outbox row per commit', async () => {
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
    const raw = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const account = raw.prepare('SELECT state_json, state_meta_json, revision FROM account_state WHERE account_key = ?').get('revision-example.com');
      expect(account).toMatchObject({ state_json: '{}', revision: 2 });
      expect(JSON.parse(String(account.state_meta_json))).toMatchObject({ format: 'entity-v1', arrayKeys: expect.arrayContaining(['profiles', 'games']) });
      expect(raw.prepare('SELECT COUNT(*) AS count FROM account_profiles').get().count).toBe(0);
      expect(raw.prepare('SELECT COUNT(*) AS count FROM account_state_entities').get().count).toBe(2);
    } finally {
      raw.close();
    }
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
  });
});
