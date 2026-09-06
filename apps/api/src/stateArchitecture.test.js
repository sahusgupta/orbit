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
    const sensitiveFailure = [
      'private.player@example.test',
      '+15551234567',
      'legacy-private-player-slug',
      `omq1_${'A'.repeat(43)}`
    ].join(' ');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const publish = vi.fn().mockRejectedValue(new Error(sensitiveFailure));
    const failed = await publishClaimed(first, { publishStateToFirebase: publish });
    expect(failed).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^Firebase publication failed \(category=publisher-error /),
      errorRef: expect.stringMatching(/^[a-f0-9]{16}$/)
    });
    expect(publish).toHaveBeenCalledWith(first.state, {
      savedAt: first.createdAt,
      syncRevision: 'revision-example.com:1'
    });
    const failedOutbox = await listPublicationOutbox({ accountKey: 'revision-example.com' });
    expect(failedOutbox).toEqual(expect.arrayContaining([
      expect.objectContaining({
        revision: 1,
        status: 'failed',
        attempts: 1,
        error: expect.stringMatching(/^Firebase publication failed \(category=publisher-error /)
      }),
      expect.objectContaining({ revision: 2, status: 'pending', attempts: 0 })
    ]));
    const exposed = JSON.stringify({ failed, failedOutbox, warnings: warning.mock.calls });
    for (const forbidden of [
      'private.player@example.test',
      '+15551234567',
      'legacy-private-player-slug',
      'omq1_'
    ]) expect(exposed).not.toContain(forbidden);
    warning.mockRestore();
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

  it('uses one opaque global receipt to replay identical semantics and reject cross-account conflicts', async () => {
    const firstState = {
      ...state(),
      settings: { clubAccount: { clubName: 'First Receipt Club', email: 'receipt-one@example.test' } }
    };
    const secondState = {
      ...state(),
      settings: { clubAccount: { clubName: 'Second Receipt Club', email: 'receipt-two@example.test' } }
    };
    const first = await saveState(firstState, {
      expectedRevision: 0,
      mutationId: 'tournament-interest:opaque-one',
      globalMutationScope: 'player-mutation:opaque-one',
      globalMutationFingerprint: 'express\u0000receipt-one-example.test\u0000event-one',
      globalMutationResult: { interestId: 'ti_one', status: 'interested' }
    });
    expect(first).toMatchObject({ duplicate: false, idempotencyResult: { interestId: 'ti_one' } });
    const replay = await saveState({ ...firstState, profiles: [] }, {
      expectedRevision: 0,
      mutationId: 'tournament-interest:opaque-one',
      globalMutationScope: 'player-mutation:opaque-one',
      globalMutationFingerprint: 'express\u0000receipt-one-example.test\u0000event-one',
      globalMutationResult: { interestId: 'forged' }
    });
    expect(replay).toMatchObject({
      duplicate: true,
      accountKey: 'receipt-one-example.test',
      idempotencyResult: { interestId: 'ti_one', status: 'interested' }
    });
    await expect(saveState(secondState, {
      expectedRevision: 0,
      mutationId: 'tournament-interest:opaque-one',
      globalMutationScope: 'player-mutation:opaque-one',
      globalMutationFingerprint: 'withdraw\u0000receipt-two-example.test\u0000event-two',
      globalMutationResult: { interestId: 'ti_two', status: 'withdrawn' }
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(await loadState('receipt-two-example.test')).toBeNull();
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

  it('evaluates a state transaction precondition before writing a new revision', async () => {
    const guarded = {
      ...state(),
      settings: { clubAccount: { clubName: 'Guarded Club', email: 'guarded@example.test' } }
    };
    const transactionPrecondition = vi.fn(async ({ accountKey, currentState, nextState, transaction }) => {
      expect(accountKey).toBe('guarded-example.test');
      expect(currentState).toBeNull();
      expect(nextState).toEqual(guarded);
      expect(typeof transaction.getDocument).toBe('function');
      throw Object.assign(new Error('precondition failed'), { code: 'TEST_PRECONDITION_FAILED' });
    });

    await expect(saveState(guarded, {
      expectedRevision: 0,
      mutationId: 'guarded-mutation',
      transactionPrecondition
    })).rejects.toMatchObject({ code: 'TEST_PRECONDITION_FAILED' });
    expect(transactionPrecondition).toHaveBeenCalledOnce();
    expect(await loadState('guarded-example.test')).toBeNull();
  });

  it('commits a transaction-time state transform and its matching global receipt result atomically', async () => {
    const requested = {
      ...state(),
      settings: { clubAccount: { clubName: 'Commit Clock Club', email: 'commit-clock@example.test' } }
    };
    const committed = {
      ...requested,
      profiles: [{ id: 'player-one', membershipRequestedAt: '2026-09-05T18:00:02.000Z' }]
    };
    const result = await saveState(requested, {
      expectedRevision: 0,
      mutationId: 'commit-clock-mutation',
      globalMutationScope: 'commit-clock-scope',
      globalMutationFingerprint: 'commit-clock-fingerprint',
      globalMutationResult: { acceptedAt: 'request-start' },
      transactionPrecondition: async () => ({
        nextState: committed,
        result: {
          globalMutationResult: { acceptedAt: '2026-09-05T18:00:02.000Z' },
          boundary: 'commit'
        }
      })
    });

    expect(result).toMatchObject({
      duplicate: false,
      idempotencyResult: { acceptedAt: '2026-09-05T18:00:02.000Z' },
      transactionResult: {
        globalMutationResult: { acceptedAt: '2026-09-05T18:00:02.000Z' },
        boundary: 'commit'
      }
    });
    expect((await loadState('commit-clock-example.test')).state).toEqual(committed);
  });
});
