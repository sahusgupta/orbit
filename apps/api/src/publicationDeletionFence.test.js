import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve(process.cwd(), 'apps/api/src/publicationDeletionFence.test.js'));
const connection = require('./db/connection.js');
const publicationOutbox = require('./db/publicationOutbox.js');
const stateStore = require('./db/state.js');

const { getDatabase, resetDatabaseForTests } = connection;
const {
  blockAccountPublications,
  claimNextPublication,
  publicationFencePath,
  publishClaimed,
  recoverAbandonedPublicationClaim,
  releaseAccountPublications,
  schedulePublicationDrain
} = publicationOutbox;
const { invalidateAccountStateHistory, publicationPath, saveState } = stateStore;

function deferred() {
  /** @type {(value?: any) => void} */
  let resolve = () => {};
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}

function state(name) {
  return {
    games: [],
    sessions: [],
    playerSessions: [],
    profiles: name ? [{ id: 'linked-profile', orbitPlayerId: 'fenced-uid', name }] : [],
    settings: { clubAccount: { clubName: 'Fence Club', email: 'fence@example.test' } },
    ...(name ? {} : { playerPrivacyTombstones: ['deleted_subject'] })
  };
}

beforeEach(async () => resetDatabaseForTests());

describe('account-deletion publication fence', () => {
  it('serializes an in-flight stale writer before the exact sanitized revision can publish', async () => {
    const database = await getDatabase();
    await saveState(state('Private Name'), { expectedRevision: 0, mutationId: 'raw-revision' });
    const staleClaim = await claimNextPublication('2099-09-05T01:00:00.000Z', { database });
    expect(staleClaim).toMatchObject({ revision: 1, claimId: expect.any(String) });

    const remoteStarted = deferred();
    const finishRemote = deferred();
    const projected = { profileName: '' };
    const stalePublish = publishClaimed(staleClaim, {
      database,
      scheduleDeletionFinalizationDrain: vi.fn(),
      publishStateToFirebase: async (publishedState) => {
        remoteStarted.resolve();
        await finishRemote.promise;
        projected.profileName = publishedState.profiles[0].name;
        return { ok: true };
      }
    });
    await remoteStarted.promise;

    await blockAccountPublications(database, ['fence-example.test'], 'deleted_subject');
    expect(await database.getDocument(publicationFencePath('fence-example.test')))
      .toMatchObject({ blocked: true, blockerRefs: ['deleted_subject'] });
    expect(await claimNextPublication('2099-09-05T03:00:00.000Z', { database })).toBeNull();

    const sanitized = await saveState(state(''), {
      expectedRevision: 1,
      mutationId: 'sanitized-revision',
      invalidatePriorRevisions: true
    });
    await invalidateAccountStateHistory('fence-example.test', sanitized.revision);
    expect(await database.getDocument(publicationPath('fence-example.test', 1))).toMatchObject({
      status: 'publishing',
      invalidationRequested: true,
      claimId: staleClaim.claimId
    });
    await releaseAccountPublications(
      database,
      ['fence-example.test'],
      'deleted_subject',
      [{ accountKey: 'fence-example.test', revision: sanitized.revision }]
    );
    expect(await database.getDocument(publicationFencePath('fence-example.test')))
      .toMatchObject({ blocked: false, blockerRefs: [], minimumRevision: 2 });

    // Even far beyond the old lease, the exact remote attempt remains the
    // serialized predecessor until it acknowledges postflight.
    expect(await claimNextPublication('2099-09-06T03:00:00.000Z', { database })).toBeNull();
    finishRemote.resolve();
    await expect(stalePublish).resolves.toMatchObject({ ok: false, cancelled: true });
    expect(projected.profileName).toBe('Private Name');

    const sanitizedClaim = await claimNextPublication('2099-09-06T03:00:01.000Z', { database });
    expect(sanitizedClaim).toMatchObject({ revision: 2 });
    const wakeFinalizer = vi.fn();
    await expect(publishClaimed(sanitizedClaim, {
      database,
      scheduleDeletionFinalizationDrain: wakeFinalizer,
      publishStateToFirebase: async (publishedState) => {
        projected.profileName = publishedState.profiles[0]?.name || '';
        return { ok: true };
      }
    })).resolves.toMatchObject({ ok: true });
    expect(projected.profileName).toBe('');
    expect(wakeFinalizer).toHaveBeenCalledWith({ force: true });
    expect(await database.getDocument(publicationPath('fence-example.test', 2)))
      .toMatchObject({ status: 'published' });
  });

  it('runs a requested-again drain and registers both serverless continuations', async () => {
    const firstDrain = deferred();
    const drainPublicationOutbox = vi.fn()
      .mockImplementationOnce(async () => {
        await firstDrain.promise;
        return [];
      })
      .mockResolvedValueOnce([]);
    const waitUntil = vi.fn();
    const dependencies = {
      drainPublicationOutbox,
      getFirebasePublisherStatus: () => ({ configured: true })
    };

    const initial = schedulePublicationDrain({ force: true, dependencies, waitUntil });
    schedulePublicationDrain({ force: true, dependencies, waitUntil });
    firstDrain.resolve();
    await initial;
    await vi.waitFor(() => expect(drainPublicationOutbox).toHaveBeenCalledTimes(2));
    expect(waitUntil).toHaveBeenCalledTimes(2);
  });

  it('requires terminated-runtime evidence and compensates even if a recovered writer unexpectedly returns late', async () => {
    const database = await getDatabase();
    await saveState(state('Private Name'), { expectedRevision: 0, mutationId: 'recover-raw' });
    const abandoned = await claimNextPublication('2099-09-05T01:00:00.000Z', { database });
    await blockAccountPublications(database, ['fence-example.test'], 'deleted_subject');
    const sanitized = await saveState(state(''), {
      expectedRevision: 1,
      mutationId: 'recover-safe',
      invalidatePriorRevisions: true
    });
    await invalidateAccountStateHistory('fence-example.test', sanitized.revision);
    await releaseAccountPublications(
      database,
      ['fence-example.test'],
      'deleted_subject',
      [{ accountKey: 'fence-example.test', revision: sanitized.revision }]
    );

    await expect(recoverAbandonedPublicationClaim(database, {
      accountKey: 'fence-example.test',
      revision: 1,
      claimId: abandoned.claimId
    }, { nowMs: () => Date.parse('2099-09-05T01:10:00.000Z') })).rejects.toThrow('terminated-runtime evidence');
    await expect(recoverAbandonedPublicationClaim(database, {
      accountKey: 'fence-example.test',
      revision: 1,
      claimId: abandoned.claimId,
      runtimeTerminated: true,
      evidenceRef: '0123456789abcdef'
    }, { nowMs: () => Date.parse('2099-09-05T01:10:00.000Z') })).resolves.toEqual({ recovered: true });

    const crashedCompensation = await claimNextPublication('2099-09-05T01:10:01.000Z', { database });
    expect(crashedCompensation).toMatchObject({ revision: 1, stateRevision: 2, compensation: true });
    await expect(recoverAbandonedPublicationClaim(database, {
      accountKey: 'fence-example.test',
      revision: 1,
      claimId: crashedCompensation.claimId,
      runtimeTerminated: true,
      evidenceRef: 'fedcba9876543210'
    }, { nowMs: () => Date.parse('2099-09-05T01:20:01.000Z') })).resolves.toEqual({ recovered: true });
    const compensation = await claimNextPublication('2099-09-05T01:20:02.000Z', { database });
    expect(compensation).toMatchObject({ revision: 1, stateRevision: 2, compensation: true });
    const projected = { name: 'Private Name' };
    const publish = vi.fn(async (publishedState) => {
      projected.name = publishedState.profiles[0]?.name || '';
      return { ok: true };
    });
    await expect(publishClaimed(compensation, {
      database,
      publishStateToFirebase: publish,
      scheduleDeletionFinalizationDrain: vi.fn()
    })).resolves.toMatchObject({ ok: true, compensated: true });

    const safeClaim = await claimNextPublication('2099-09-05T01:20:03.000Z', { database });
    await publishClaimed(safeClaim, {
      database,
      publishStateToFirebase: publish,
      scheduleDeletionFinalizationDrain: vi.fn()
    });
    expect(projected.name).toBe('');

    // Defense in depth: if the supposedly terminated worker does return, its
    // raw write is immediately followed by the latest authoritative safe state.
    await expect(publishClaimed(abandoned, {
      database,
      publishStateToFirebase: publish,
      scheduleDeletionFinalizationDrain: vi.fn(),
      schedulePublicationDrain: vi.fn()
    })).resolves.toMatchObject({ ok: false, compensated: true });
    expect(projected.name).toBe('');
    expect(publish).toHaveBeenCalledTimes(4);
  });
});
