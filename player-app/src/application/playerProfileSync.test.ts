import { describe, expect, it, vi } from 'vitest';
import type { PlayerAccount } from '../domain/playerSync';
import { syncPendingPlayerProfile } from './playerProfileSync';

const player: PlayerAccount = {
  id: 'player-1',
  name: 'Latest edit',
  email: 'player@example.test',
  preferredGameIds: [],
  adultDeclaredAt: '2026-09-01T00:00:00.000Z',
  adultDeclarationVersion: 'v1'
};

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((next, fail) => { resolve = next; reject = fail; });
  return { promise, reject, resolve };
}

describe('pending player profile synchronization', () => {
  it('retains a rejected edit and clears the exact journal version only after a successful retry', async () => {
    let uid: string | null = 'player-1';
    const firstSave = deferred<void>();
    const clearPending = vi.fn(async () => undefined);
    const pending = { uid: 'player-1', version: 'edit-1', player };
    const firstAttempt = syncPendingPlayerProfile(pending, {
      clearPending,
      currentUid: () => uid,
      pendingPersisted: Promise.resolve(),
      saveRemote: () => firstSave.promise
    });
    firstSave.reject(new Error('offline'));

    await expect(firstAttempt).resolves.toMatchObject({ kind: 'failed', error: expect.any(Error), stage: 'remote' });
    expect(clearPending).not.toHaveBeenCalled();

    await expect(syncPendingPlayerProfile(pending, {
      clearPending,
      currentUid: () => uid,
      pendingPersisted: Promise.resolve(),
      saveRemote: async () => undefined
    })).resolves.toEqual({ kind: 'saved' });
    expect(clearPending).toHaveBeenCalledWith('player-1', 'edit-1');
  });

  it('retires a delayed old-account response without clearing its journal or applying success', async () => {
    let uid: string | null = 'player-1';
    const remote = deferred<void>();
    const clearPending = vi.fn(async () => undefined);
    const attempt = syncPendingPlayerProfile({ uid: 'player-1', version: 'edit-a', player }, {
      clearPending,
      currentUid: () => uid,
      pendingPersisted: Promise.resolve(),
      saveRemote: () => remote.promise
    });

    uid = 'player-2';
    remote.resolve();
    await expect(attempt).resolves.toEqual({ kind: 'retired' });
    expect(clearPending).not.toHaveBeenCalled();
  });

  it('distinguishes a local journal failure and never sends an unprotected remote edit', async () => {
    const saveRemote = vi.fn(async () => undefined);
    const clearPending = vi.fn(async () => undefined);

    await expect(syncPendingPlayerProfile({ uid: 'player-1', version: 'edit-local', player }, {
      clearPending,
      currentUid: () => 'player-1',
      pendingPersisted: Promise.reject(new Error('secure storage unavailable')),
      saveRemote
    })).resolves.toMatchObject({
      kind: 'failed',
      stage: 'local-persistence',
      error: expect.any(Error)
    });
    expect(saveRemote).not.toHaveBeenCalled();
    expect(clearPending).not.toHaveBeenCalled();
  });
});
