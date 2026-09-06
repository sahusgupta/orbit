import { describe, expect, it, vi } from 'vitest';
import type { FirebasePlayerIdentity } from '../data/orbitSyncApi';

vi.mock('../data/storage/playerStorage', () => ({
  playerStorage: {
    clearPendingPlayerAuthCleanupUid: vi.fn(),
    loadPendingPlayerAuthCleanupUid: vi.fn(),
    savePendingPlayerAuthCleanupUid: vi.fn()
  }
}));

import {
  clearConfirmedLocalPlayerProfile,
  clearIncompletePlayerAuthSession,
  finalizeAcceptedPlayerDeletion,
  getAccountDeletionFailureMessage,
  observePlayerAuthInitialization,
  resolvePendingPlayerAuthCleanup
} from './usePlayerIdentity';

describe('Firebase Auth cold-start readiness', () => {
  it('does not mark auth loaded until the persisted-session observer emits', () => {
    let emit!: (identity: FirebasePlayerIdentity | null) => void;
    const unsubscribe = vi.fn();
    const updateIdentity = vi.fn();
    const markLoaded = vi.fn();
    const subscribe = vi.fn((callback: typeof emit) => {
      emit = callback;
      return unsubscribe;
    });

    expect(observePlayerAuthInitialization(subscribe, updateIdentity, markLoaded)).toBe(unsubscribe);
    expect(updateIdentity).not.toHaveBeenCalled();
    expect(markLoaded).not.toHaveBeenCalled();

    const restored = {
      uid: 'restored-player',
      email: 'restored@example.test',
      name: 'Restored',
      provider: 'email' as const,
      verified: true as const
    };
    emit(restored);
    expect(updateIdentity).toHaveBeenCalledWith(restored);
    expect(markLoaded).toHaveBeenCalledOnce();
  });

  it('clears a cold-start raw unverified session before exposing local state', async () => {
    let emit!: (identity: FirebasePlayerIdentity | null) => void;
    let rawUid: string | null = 'interrupted-create';
    const updateIdentity = vi.fn();
    const markLoaded = vi.fn();
    const clear = vi.fn(async () => { rawUid = null; });
    const reportFailure = vi.fn();
    observePlayerAuthInitialization(
      (callback) => { emit = callback; return vi.fn(); },
      updateIdentity,
      markLoaded,
      { clear, currentUid: () => rawUid, reportFailure, shouldClear: () => true }
    );

    emit(null);
    expect(updateIdentity).not.toHaveBeenCalled();
    expect(markLoaded).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(markLoaded).toHaveBeenCalledOnce());
    expect(clear).toHaveBeenCalledOnce();
    expect(updateIdentity).toHaveBeenCalledWith(null);
    expect(reportFailure).not.toHaveBeenCalled();
  });
});

describe('Player account deletion failure copy', () => {
  it('maps trusted API failures without implying that an unaccepted deletion cleared local data', () => {
    expect(getAccountDeletionFailureMessage(Object.assign(new Error('raw'), { code: 'RECENT_LOGIN_REQUIRED' })))
      .toBe('For security, sign out and sign back in before deleting your account.');
    expect(getAccountDeletionFailureMessage(Object.assign(new Error('raw'), { code: 'auth/requires-recent-login' })))
      .toBe('For security, sign out and sign back in before deleting your account.');
    expect(getAccountDeletionFailureMessage(Object.assign(new Error('raw'), { code: 'DELETION_FINALIZATION_PENDING' })))
      .toBe('The server did not confirm that account deletion was accepted. Your local profile was kept.');
  });
});

describe('local profile deletion auth boundary', () => {
  it('signs out an unverified persisted raw session before clearing local data', async () => {
    let rawUid: string | null = 'unverified-player';
    const events: string[] = [];

    await expect(clearConfirmedLocalPlayerProfile(
      'unverified-player',
      () => rawUid,
      async () => { events.push('sign-out'); rawUid = null; },
      async () => { events.push('clear-local'); }
    )).resolves.toBe(true);
    expect(events).toEqual(['sign-out', 'clear-local']);
  });

  it('preserves local data when a different auth session becomes current before confirmation', async () => {
    const signOutRawAuth = vi.fn();
    const clearLocalAccount = vi.fn();
    await expect(clearConfirmedLocalPlayerProfile(
      null,
      () => 'new-player',
      signOutRawAuth,
      clearLocalAccount
    )).resolves.toBe(false);
    expect(signOutRawAuth).not.toHaveBeenCalled();
    expect(clearLocalAccount).not.toHaveBeenCalled();
  });
});

describe('incomplete sign-in cleanup', () => {
  it('surfaces a failed raw-session sign-out and does not report cleanup', async () => {
    const reportFailure = vi.fn();
    await expect(clearIncompletePlayerAuthSession(
      () => 'unverified-player',
      async () => { throw new Error('persistence unavailable'); },
      reportFailure
    )).resolves.toBe(false);
    expect(reportFailure).toHaveBeenCalledOnce();
  });
});

describe('accepted account deletion cleanup', () => {
  const pendingResult = {
    initiatingUid: 'player-1',
    status: 'pending' as const,
    retainedCategories: [],
    currentAccountPreserved: false,
    signedOut: true
  };

  it('clears local data before reporting a durable pending deletion as accepted', async () => {
    const events: string[] = [];
    const cleared = await finalizeAcceptedPlayerDeletion(
      pendingResult,
      () => null,
      async () => { events.push('clear-local'); },
      () => { events.push('report-accepted'); },
      async () => { events.push('persist-cleanup'); }
    );
    expect(cleared).toBe('complete');
    expect(events).toEqual(['clear-local', 'report-accepted']);
  });

  it('does not claim local deletion when device storage cleanup fails', async () => {
    const reportResult = vi.fn();
    await expect(finalizeAcceptedPlayerDeletion(
      pendingResult,
      () => null,
      async () => { throw new Error('storage unavailable'); },
      reportResult,
      vi.fn()
    )).resolves.toBe('local-cleanup-failed');
    expect(reportResult).not.toHaveBeenCalled();
  });

  it('reports the prior account deletion without clearing the newly current account', async () => {
    const clearLocalAccount = vi.fn();
    const reportResult = vi.fn();

    await expect(finalizeAcceptedPlayerDeletion(
      pendingResult,
      () => 'player-2',
      clearLocalAccount,
      reportResult,
      vi.fn()
    )).resolves.toBe('complete');

    expect(clearLocalAccount).not.toHaveBeenCalled();
    expect(reportResult).toHaveBeenCalledWith({
      ...pendingResult,
      currentAccountPreserved: true,
      localDataCleared: false
    });
  });

  it('durably marks a failed sign-out before clearing local data and reporting acceptance', async () => {
    const events: string[] = [];
    const outcome = await finalizeAcceptedPlayerDeletion(
      { ...pendingResult, signedOut: false },
      () => 'player-1',
      async () => { events.push('clear-local'); },
      () => { events.push('report-accepted'); },
      async () => { events.push('persist-cleanup'); }
    );
    expect(outcome).toBe('auth-cleanup-required');
    expect(events).toEqual(['persist-cleanup', 'clear-local', 'report-accepted']);
  });

  it('durably marks cleanup when the initiating raw auth session reappears after a reported sign-out', async () => {
    const events: string[] = [];
    const outcome = await finalizeAcceptedPlayerDeletion(
      pendingResult,
      () => 'player-1',
      async () => { events.push('clear-local'); },
      () => { events.push('report-accepted'); },
      async () => { events.push('persist-cleanup'); }
    );

    expect(outcome).toBe('auth-cleanup-required');
    expect(events).toEqual(['persist-cleanup', 'clear-local', 'report-accepted']);
  });

  it('preserves local state when the durable cleanup marker cannot be written', async () => {
    const clearLocalAccount = vi.fn();
    const reportResult = vi.fn();
    await expect(finalizeAcceptedPlayerDeletion(
      { ...pendingResult, signedOut: false },
      () => 'player-1',
      clearLocalAccount,
      reportResult,
      async () => { throw new Error('secure storage unavailable'); }
    )).resolves.toBe('local-cleanup-failed');
    expect(clearLocalAccount).not.toHaveBeenCalled();
    expect(reportResult).not.toHaveBeenCalled();
  });
});

describe('pending accepted-deletion auth cleanup', () => {
  it('retries sign-out after restart, clears local state, and removes the durable marker last', async () => {
    let currentUid: string | null = 'player-1';
    const events: string[] = [];
    await expect(resolvePendingPlayerAuthCleanup({
      loadPendingUid: async () => 'player-1',
      currentUid: () => currentUid,
      signOutRawAuth: async () => { events.push('sign-out'); currentUid = null; },
      clearLocalAccount: async () => { events.push('clear-local'); },
      clearPendingUid: async () => { events.push('clear-marker'); }
    })).resolves.toBe('complete');
    expect(events).toEqual(['sign-out', 'clear-local', 'clear-marker']);
  });

  it('leaves the durable marker and local data intact when retry sign-out fails', async () => {
    const clearLocalAccount = vi.fn();
    const clearPendingUid = vi.fn();
    await expect(resolvePendingPlayerAuthCleanup({
      loadPendingUid: async () => 'player-1',
      currentUid: () => 'player-1',
      signOutRawAuth: async () => { throw new Error('persistence unavailable'); },
      clearLocalAccount,
      clearPendingUid
    })).rejects.toThrow('persistence unavailable');
    expect(clearLocalAccount).not.toHaveBeenCalled();
    expect(clearPendingUid).not.toHaveBeenCalled();
  });

  it('never signs out or clears local state belonging to a newer account', async () => {
    const signOutRawAuth = vi.fn();
    const clearLocalAccount = vi.fn();
    const clearPendingUid = vi.fn();
    await expect(resolvePendingPlayerAuthCleanup({
      loadPendingUid: async () => 'player-1',
      currentUid: () => 'player-2',
      signOutRawAuth,
      clearLocalAccount,
      clearPendingUid
    })).resolves.toBe('new-account-preserved');
    expect(signOutRawAuth).not.toHaveBeenCalled();
    expect(clearLocalAccount).not.toHaveBeenCalled();
    expect(clearPendingUid).toHaveBeenCalledWith('player-1');
  });
});
