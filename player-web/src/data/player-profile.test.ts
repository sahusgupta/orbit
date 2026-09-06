import type { User } from 'firebase/auth';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerAccount } from '@/src/domain/types';
import { buildWebPlayerProfileWrite, fallbackPlayerProfile, fetchWebPlayerProfile, isTransientPlayerProfileReadError, saveWebPlayerProfile } from './player-profile';

const firestore = vi.hoisted(() => ({
  auth: { currentUser: null as User | null },
  db: {},
  doc: vi.fn(() => ({ path: 'players/player-1' })),
  getDoc: vi.fn(),
  deleteField: vi.fn(() => 'delete-field'),
  serverTimestamp: vi.fn(() => 'server-timestamp'),
  setDoc: vi.fn()
}));

vi.mock('firebase/firestore', () => ({
  deleteField: firestore.deleteField,
  doc: firestore.doc,
  getDoc: firestore.getDoc,
  serverTimestamp: firestore.serverTimestamp,
  setDoc: firestore.setDoc
}));

vi.mock('./firebase-client', () => ({
  getFirebaseBrowserClient: vi.fn(async () => ({ auth: firestore.auth, db: firestore.db }))
}));

const user = {
  uid: 'player-1',
  displayName: 'River Player',
  email: 'river@example.com',
  phoneNumber: '+15555550123'
} as User;

describe('Player Web profile bootstrap', () => {
  beforeEach(() => {
    firestore.auth.currentUser = user;
    firestore.doc.mockClear();
    firestore.getDoc.mockReset();
    firestore.deleteField.mockClear();
    firestore.serverTimestamp.mockClear();
    firestore.setDoc.mockReset().mockResolvedValue(undefined);
  });

  it('does not derive a display name or search radius from the authentication identity', () => {
    const withoutDisplayName = { ...user, displayName: null } as User;
    expect(fallbackPlayerProfile(withoutDisplayName)).toEqual({
      id: 'player-1',
      name: '',
      email: 'river@example.com',
      phone: '+15555550123',
      preferredGameIds: [],
      favoriteClubIds: []
    });
  });

  it('requires an explicit adult declaration before producing a profile write', () => {
    expect(() => buildWebPlayerProfileWrite(user, fallbackPlayerProfile(user))).toThrow(/18 or older/i);
  });

  it('produces only the reviewed Firestore fields and never emits undefined', () => {
    const unsafeProfile: PlayerAccount & { premium: { status: string } } = {
      ...fallbackPlayerProfile(user),
      name: '  River Player  ',
      phone: '',
      homeLocation: '',
      searchRadiusMiles: undefined,
      adultDeclaredAt: '2026-09-04T12:00:00.000Z',
      adultDeclarationVersion: 'v1',
      premium: { status: 'active' }
    };
    const write = buildWebPlayerProfileWrite(user, unsafeProfile);

    expect(write).toEqual({
      id: 'player-1',
      uid: 'player-1',
      name: 'River Player',
      email: 'river@example.com',
      preferredGameIds: [],
      favoriteClubIds: [],
      adultDeclaredAt: '2026-09-04T12:00:00.000Z',
      adultDeclarationVersion: 'v1'
    });
    expect(Object.values(write)).not.toContain(undefined);
  });

  it('binds a phone-only profile to the verified phone and discards an unverified email', () => {
    const phoneUser = { ...user, email: null, displayName: null, phoneNumber: '+15555550999' } as User;
    expect(buildWebPlayerProfileWrite(phoneUser, {
      ...fallbackPlayerProfile(phoneUser),
      name: 'Phone Player',
      email: 'unverified@example.com',
      phone: '+15555550000',
      adultDeclaredAt: '2026-09-04T12:00:00.000Z',
      adultDeclarationVersion: 'v1'
    })).toEqual(expect.objectContaining({ email: '', phone: '+15555550999' }));
  });

  it('writes the exact profile payload and explicitly clears omitted optional fields', async () => {
    const saved = await saveWebPlayerProfile(user, {
      ...fallbackPlayerProfile(user),
      phone: '',
      adultDeclaredAt: '2026-09-04T12:00:00.000Z',
      adultDeclarationVersion: 'v1'
    });

    expect(firestore.setDoc).toHaveBeenCalledWith(
      { path: 'players/player-1' },
      {
        ...saved,
        uid: 'player-1',
        phone: 'delete-field',
        homeLocation: 'delete-field',
        searchRadiusMiles: 'delete-field',
        preferredStakes: 'delete-field',
        typicalAvailability: 'delete-field',
        updatedAt: 'server-timestamp'
      },
      { merge: true }
    );
    expect(firestore.deleteField).toHaveBeenCalledTimes(5);
    expect(Object.values(firestore.setDoc.mock.calls[0][1])).not.toContain(undefined);
  });

  it('loads a saved profile when Firestore is available', async () => {
    firestore.getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        id: 'player-1',
        uid: 'player-1',
        name: 'Saved Name',
        email: 'river@example.com',
        preferredGameIds: ['game-1'],
        favoriteClubIds: ['club-1'],
        searchRadiusMiles: 50
      })
    });

    await expect(fetchWebPlayerProfile(user)).resolves.toEqual(expect.objectContaining({
      id: 'player-1',
      name: 'Saved Name',
      email: 'river@example.com',
      preferredGameIds: ['game-1'],
      favoriteClubIds: ['club-1'],
      searchRadiusMiles: 50
    }));
  });

  it('surfaces an offline read instead of treating it as a new profile', async () => {
    const offline = Object.assign(
      new Error('Failed to get document because the client is offline.'),
      { code: 'unavailable' }
    );
    firestore.getDoc.mockRejectedValueOnce(offline);

    await expect(fetchWebPlayerProfile(user)).rejects.toThrow(/retry before editing or saving/i);
  });

  it('recognizes the exact Firebase offline failure even when an error code is absent', () => {
    expect(isTransientPlayerProfileReadError(new Error('Failed to get document because the client is offline.'))).toBe(true);
  });

  it('does not hide authorization or data-access failures', async () => {
    const denied = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
    firestore.getDoc.mockRejectedValueOnce(denied);

    await expect(fetchWebPlayerProfile(user)).rejects.toBe(denied);
  });

  it('rejects a profile read that finishes after another account becomes current', async () => {
    let resolveSnapshot!: (snapshot: { exists(): boolean; data(): Record<string, unknown> }) => void;
    const snapshot = new Promise<{ exists(): boolean; data(): Record<string, unknown> }>((resolve) => {
      resolveSnapshot = resolve;
    });
    firestore.getDoc.mockReturnValueOnce(snapshot);
    const read = fetchWebPlayerProfile(user);
    await vi.waitFor(() => expect(firestore.getDoc).toHaveBeenCalled());

    firestore.auth.currentUser = { uid: 'player-2' } as User;
    resolveSnapshot({
      exists: () => true,
      data: () => ({
        id: 'player-1',
        uid: 'player-1',
        name: 'Stale Player',
        email: 'river@example.com',
        preferredGameIds: [],
        favoriteClubIds: []
      })
    });

    await expect(read).rejects.toThrow(/account changed/i);
  });

  it('rejects a stale profile save before writing to Firestore', async () => {
    firestore.auth.currentUser = { uid: 'player-2' } as User;

    await expect(saveWebPlayerProfile(user, {
      ...fallbackPlayerProfile(user),
      name: 'River Player',
      adultDeclaredAt: '2026-09-04T12:00:00.000Z',
      adultDeclarationVersion: 'v1'
    })).rejects.toThrow(/account changed/i);
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });

  it('does not replace an unreadable stored profile with an auth-derived fallback', async () => {
    firestore.getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ uid: 'player-1', name: 'Incomplete profile' })
    });

    await expect(fetchWebPlayerProfile(user)).rejects.toThrow(/could not be read safely/i);
  });
});
