import type { User } from 'firebase/auth';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fallbackPlayerProfile, fetchWebPlayerProfile, isTransientPlayerProfileReadError } from './player-profile';

const firestore = vi.hoisted(() => ({
  db: {},
  doc: vi.fn(() => ({ path: 'players/player-1' })),
  getDoc: vi.fn()
}));

vi.mock('firebase/firestore', () => ({
  doc: firestore.doc,
  getDoc: firestore.getDoc
}));

vi.mock('./firebase-client', () => ({
  getFirebaseBrowserClient: vi.fn(async () => ({ db: firestore.db }))
}));

const user = {
  uid: 'player-1',
  displayName: 'River Player',
  email: 'river@example.com',
  phoneNumber: '+15555550123'
} as User;

describe('Player Web profile bootstrap', () => {
  beforeEach(() => {
    firestore.doc.mockClear();
    firestore.getDoc.mockReset();
  });

  it('loads a saved profile when Firestore is available', async () => {
    firestore.getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        name: 'Saved Name',
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

  it('uses the verified identity as a temporary profile when Firestore is offline', async () => {
    firestore.getDoc.mockRejectedValueOnce(Object.assign(
      new Error('Failed to get document because the client is offline.'),
      { code: 'unavailable' }
    ));

    await expect(fetchWebPlayerProfile(user)).resolves.toEqual(fallbackPlayerProfile(user));
  });

  it('recognizes the exact Firebase offline failure even when an error code is absent', () => {
    expect(isTransientPlayerProfileReadError(new Error('Failed to get document because the client is offline.'))).toBe(true);
  });

  it('does not hide authorization or data-access failures', async () => {
    const denied = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
    firestore.getDoc.mockRejectedValueOnce(denied);

    await expect(fetchWebPlayerProfile(user)).rejects.toBe(denied);
  });
});
