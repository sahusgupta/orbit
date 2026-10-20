/** @vitest-environment jsdom */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerPlatform } from '../app/playerPlatform';
import type { FirebasePlayerIdentity } from '../data/orbitSyncApi';
import type { PlayerAccount } from '../domain/playerSync';
import { usePlayerIdentity } from './usePlayerIdentity';

const auth = vi.hoisted(() => ({
  current: null as FirebasePlayerIdentity | null,
  signIn: vi.fn(), readProfile: vi.fn(), createProfile: vi.fn(), fetchStatus: vi.fn(), signOut: vi.fn()
}));

vi.mock('../data/orbitSyncApi', () => ({
  getCurrentFirebasePlayer: () => auth.current,
  getCurrentFirebaseAuthUid: () => auth.current?.uid ?? null,
  onFirebasePlayerChanged: (callback: (identity: FirebasePlayerIdentity | null) => void) => { callback(auth.current); return vi.fn(); },
  signInOrCreatePlayerWithEmail: auth.signIn,
  fetchPlayerProfile: auth.readProfile,
  createPlayerProfileIfMissing: auth.createProfile,
  completePlayerAdultDeclarationIfMissing: vi.fn(),
  fetchPlayerIdentityStatus: auth.fetchStatus,
  signOutCurrentPlayer: auth.signOut,
  isSyncConfigured: () => false
}));
vi.mock('../data/storage/playerStorage', () => ({ playerStorage: {
  loadPendingPlayerAuthCleanupUid: async () => null,
  clearPendingPlayerAuthCleanupUid: vi.fn()
} }));

const identity: FirebasePlayerIdentity = {
  uid: 'verified-player', email: 'alex@example.test', name: '', provider: 'email', verified: true
};
const draft: PlayerAccount = {
  id: 'local-draft', name: 'Alex', email: identity.email, homeLocation: 'Austin', preferredGameIds: [],
  adultDeclaredAt: '2026-10-20T12:00:00Z', adultDeclarationVersion: 'v1'
};
const emptyPlayer: PlayerAccount = { id: 'empty-local', name: '', email: '', preferredGameIds: [] };

describe('onboarding Firebase account connection', () => {
  let container: HTMLDivElement;
  let root: Root;
  let current: ReturnType<typeof usePlayerIdentity>;
  const setHasAccount = vi.fn<React.Dispatch<React.SetStateAction<boolean>>>();
  const setPlayer = vi.fn<React.Dispatch<React.SetStateAction<PlayerAccount>>>();
  const platform: PlayerPlatform = {
    os: 'ios', getCurrentAppState: () => 'active', subscribeToAppState: () => vi.fn(),
    openDirections: async () => ({ ok: true }), openAppSettings: async () => undefined,
    confirmAccountDeletion: vi.fn(), confirmLocalProfileDeletion: vi.fn(), showLocalProfileDeletionResult: vi.fn(), showAccountDeletionResult: vi.fn()
  };

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    auth.current = null;
    auth.signIn.mockImplementation(async () => { auth.current = identity; return identity; });
    auth.readProfile.mockResolvedValue(null);
    auth.createProfile.mockImplementation(async (profile: PlayerAccount) => ({
      created: true, profile: { ...profile, uid: identity.uid, updatedAt: '2026-10-20T12:00:00Z' }
    }));
    auth.fetchStatus.mockRejectedValue(new Error('Identity status unavailable in this local test.'));
    auth.signOut.mockImplementation(async () => { auth.current = null; });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    function Harness() {
      current = usePlayerIdentity({ accountLoaded: true, clearLocalPlayer: async () => undefined,
        draftPlayer: draft, player: emptyPlayer, platform,
        setDraftPlayer: vi.fn(), setHasAccount, setPlayer, setOnboardingStep: vi.fn(), setScreen: vi.fn(), setSyncStatus: vi.fn() });
      return null;
    }
    await act(async () => { root.render(<Harness />); });
    act(() => { current.setPlayerAuthEmail(identity.email); current.setPlayerAuthPassword('a-secure-passphrase'); });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('creates the verified UID profile from the completed onboarding draft, without storing its password', async () => {
    await act(async () => { await current.connectPlayerAccount(draft); });
    expect(auth.signIn).toHaveBeenCalledWith(identity.email, 'a-secure-passphrase');
    expect(auth.createProfile).toHaveBeenCalledWith({ ...draft, id: identity.uid }, identity.uid);
    expect(auth.createProfile.mock.calls[0][0]).not.toHaveProperty('password');
    expect(setHasAccount).toHaveBeenCalledWith(true);
    expect(setPlayer).toHaveBeenCalledWith(expect.objectContaining({ id: identity.uid, name: 'Alex' }));
    expect(current.playerAuthPassword).toBe('');
  });

  it('restores the remote signed-in profile even when the local onboarding draft is empty', async () => {
    const remote = { ...draft, id: identity.uid, uid: identity.uid, name: 'Remote Alex', updatedAt: '2026-10-20T12:00:00Z' };
    auth.readProfile.mockResolvedValue(remote);
    await act(async () => { await current.connectPlayerAccount(emptyPlayer); });
    expect(auth.createProfile).not.toHaveBeenCalled();
    expect(setPlayer).toHaveBeenCalledWith(expect.objectContaining({ id: identity.uid, name: 'Remote Alex' }));
    expect(setHasAccount).toHaveBeenCalledWith(true);
  });

  it('preserves explicit sign-in intent while restoring the saved remote profile', async () => {
    const remote = { ...draft, id: identity.uid, uid: identity.uid, name: 'Remote Alex', updatedAt: '2026-10-20T12:00:00Z' };
    auth.readProfile.mockResolvedValue(remote);
    await act(async () => { await current.connectPlayerAccount(emptyPlayer, true); });
    expect(auth.signIn).toHaveBeenCalledExactlyOnceWith(identity.email, 'a-secure-passphrase', { createIfMissing: false });
    expect(auth.createProfile).not.toHaveBeenCalled();
    expect(setPlayer).toHaveBeenCalledWith(expect.objectContaining({ id: identity.uid, name: 'Remote Alex' }));
    expect(setHasAccount).toHaveBeenCalledWith(true);
  });

  it('does not create a player profile or complete onboarding when explicit sign-in credentials fail', async () => {
    auth.signIn.mockRejectedValue(Object.assign(new Error('Invalid credentials.'), { code: 'auth/invalid-credential' }));
    await act(async () => { await current.connectPlayerAccount(emptyPlayer, true); });
    expect(auth.signIn).toHaveBeenCalledExactlyOnceWith(identity.email, 'a-secure-passphrase', { createIfMissing: false });
    expect(auth.createProfile).not.toHaveBeenCalled();
    expect(auth.readProfile).not.toHaveBeenCalled();
    expect(setHasAccount).not.toHaveBeenCalledWith(true);
    expect(current.authStatus).toContain('Invalid credentials.');
  });

  it('keeps verification failures visible and never completes a local account', async () => {
    auth.signIn.mockRejectedValue(new Error('Check your email to verify the account before signing in.'));
    await act(async () => { await current.connectPlayerAccount(draft); });
    expect(auth.createProfile).not.toHaveBeenCalled();
    expect(setHasAccount).not.toHaveBeenCalledWith(true);
    expect(setPlayer).not.toHaveBeenCalled();
    expect(current.firebaseIdentity).toBeNull();
    expect(current.authStatus).toContain('Check your email to verify');
    expect(current.profileSyncPaused).toBe(false);
  });
});
