import { describe, expect, it, vi } from 'vitest';
import type { PlayerAccount, PlayerProfileDocument } from '../domain/playerSync';
import type { FirebasePlayerIdentity } from '../data/orbitSyncApi';
import {
  canPublishHydratedPlayer,
  resolveAuthenticatedPlayerProfile,
  type PlayerProfileHydration
} from './playerProfileHydration';

const identity: FirebasePlayerIdentity = {
  uid: 'firebase-player',
  email: 'verified@example.test',
  name: 'Verified Name',
  provider: 'email',
  verified: true
};

const localPlayer: PlayerAccount = {
  id: 'local-player',
  name: 'Local Name',
  email: 'local@example.test',
  preferredGameIds: ['holdem'],
  adultDeclaredAt: '2026-01-01T00:00:00.000Z',
  adultDeclarationVersion: 'v1'
};

const remoteProfile: PlayerProfileDocument = {
  ...localPlayer,
  id: identity.uid,
  uid: identity.uid,
  name: 'Remote Name',
  email: identity.email,
  preferredGameIds: ['omaha']
};

describe('authenticated player profile hydration', () => {
  it('returns an existing remote profile without writing the local profile', async () => {
    const events: string[] = [];
    const readProfile = vi.fn(async () => {
      events.push('read');
      return remoteProfile;
    });
    const createProfileIfMissing = vi.fn();
    const completeAdultDeclarationIfMissing = vi.fn();

    const result = await resolveAuthenticatedPlayerProfile(identity, localPlayer, {
      completeAdultDeclarationIfMissing,
      createProfileIfMissing,
      readProfile
    });

    expect(result).toEqual({
      player: expect.objectContaining({ id: identity.uid, name: 'Remote Name', preferredGameIds: ['omaha'] }),
      source: 'remote'
    });
    expect(events).toEqual(['read']);
    expect(createProfileIfMissing).not.toHaveBeenCalled();
    expect(completeAdultDeclarationIfMissing).not.toHaveBeenCalled();
  });

  it('creates a provider-bound profile only after the server confirms it is missing', async () => {
    const events: string[] = [];
    const readProfile = vi.fn(async () => {
      events.push('read');
      return null;
    });
    const createProfileIfMissing = vi.fn(async (player: PlayerAccount) => {
      events.push('create-if-missing');
      return { created: true, profile: { ...player, uid: player.id } };
    });

    const result = await resolveAuthenticatedPlayerProfile(identity, localPlayer, {
      completeAdultDeclarationIfMissing: vi.fn(),
      createProfileIfMissing,
      readProfile
    });

    expect(events).toEqual(['read', 'create-if-missing']);
    expect(createProfileIfMissing).toHaveBeenCalledWith(
      expect.objectContaining({
        id: identity.uid,
        name: identity.name,
        email: identity.email
      }),
      identity.uid
    );
    expect(result.source).toBe('created');
  });

  it('does not write when the remote profile read fails', async () => {
    const createProfileIfMissing = vi.fn();
    await expect(resolveAuthenticatedPlayerProfile(identity, localPlayer, {
      completeAdultDeclarationIfMissing: vi.fn(),
      createProfileIfMissing,
      readProfile: async () => {
        throw new Error('offline');
      }
    })).rejects.toThrow('offline');
    expect(createProfileIfMissing).not.toHaveBeenCalled();
  });

  it('uses the concurrently created remote profile instead of overwriting it', async () => {
    const events: string[] = [];
    const result = await resolveAuthenticatedPlayerProfile(identity, localPlayer, {
      readProfile: async () => {
        events.push('read-missing');
        return null;
      },
      completeAdultDeclarationIfMissing: vi.fn(),
      createProfileIfMissing: async () => {
        events.push('atomic-create-check');
        return { created: false, profile: remoteProfile };
      }
    });

    expect(events).toEqual(['read-missing', 'atomic-create-check']);
    expect(result).toEqual({
      player: expect.objectContaining({ id: identity.uid, name: 'Remote Name', preferredGameIds: ['omaha'] }),
      source: 'remote'
    });
  });

  it('requires a fresh declaration when a different local profile connects to a legacy remote profile', async () => {
    const { adultDeclaredAt: _timestamp, adultDeclarationVersion: _version, ...legacyProfile } = remoteProfile;
    const completeAdultDeclarationIfMissing = vi.fn();
    const result = await resolveAuthenticatedPlayerProfile(identity, localPlayer, {
      readProfile: async () => legacyProfile,
      completeAdultDeclarationIfMissing,
      createProfileIfMissing: vi.fn()
    });

    expect(result).toEqual({
      player: expect.objectContaining({ id: identity.uid, name: 'Remote Name' }),
      source: 'remote-needs-adult-declaration'
    });
    expect(result.player).not.toHaveProperty('adultDeclaredAt');
    expect(completeAdultDeclarationIfMissing).not.toHaveBeenCalled();
  });

  it('atomically adds only the same-account adult declaration to a legacy remote profile', async () => {
    const { adultDeclaredAt: _timestamp, adultDeclarationVersion: _version, ...legacyProfile } = remoteProfile;
    const sameAccountPlayer = { ...localPlayer, id: identity.uid };
    const completeAdultDeclarationIfMissing = vi.fn(async (declaration: PlayerAccount) => ({
      ...legacyProfile,
      adultDeclaredAt: declaration.adultDeclaredAt,
      adultDeclarationVersion: declaration.adultDeclarationVersion
    }));
    const result = await resolveAuthenticatedPlayerProfile(identity, sameAccountPlayer, {
      readProfile: async () => legacyProfile,
      completeAdultDeclarationIfMissing,
      createProfileIfMissing: vi.fn()
    });

    expect(completeAdultDeclarationIfMissing).toHaveBeenCalledWith(sameAccountPlayer, identity.uid);
    expect(result).toEqual({
      player: expect.objectContaining({
        id: identity.uid,
        adultDeclaredAt: sameAccountPlayer.adultDeclaredAt,
        adultDeclarationVersion: 'v1'
      }),
      source: 'remote'
    });
  });
});

describe('profile publication gate', () => {
  const ready: PlayerProfileHydration = { uid: identity.uid, status: 'ready' };
  const base = {
    accountLoaded: true,
    hasAccount: true,
    hydration: ready,
    identityUid: identity.uid,
    playerId: identity.uid,
    profileSyncPaused: false
  };

  it('allows publication only after hydration succeeds for the same authenticated player', () => {
    expect(canPublishHydratedPlayer(base)).toBe(true);
    expect(canPublishHydratedPlayer({ ...base, hydration: { ...ready, status: 'loading' } })).toBe(false);
    expect(canPublishHydratedPlayer({ ...base, hydration: { ...ready, status: 'error' } })).toBe(false);
    expect(canPublishHydratedPlayer({ ...base, hydration: { uid: 'someone-else', status: 'ready' } })).toBe(false);
    expect(canPublishHydratedPlayer({ ...base, playerId: 'local-player' })).toBe(false);
    expect(canPublishHydratedPlayer({ ...base, profileSyncPaused: true })).toBe(false);
  });
});
