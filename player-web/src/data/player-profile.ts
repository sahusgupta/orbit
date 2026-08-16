import { preserveLegacyPlayerProfile, readFirebaseErrorCode } from '@orbit/player-domain/decoders/playerBoundaryDecoders';
import type { PlayerAccount } from '@/src/domain/types';
import type { User } from 'firebase/auth';
import { isOperationTimeoutError, withDeadline } from '@/src/auth/deadline';
import { getFirebaseBrowserClient } from './firebase-client';

export function fallbackPlayerProfile(user: User): PlayerAccount {
  return {
    id: user.uid,
    name: user.displayName?.trim() || user.email?.split('@')[0] || 'Orbit Player',
    email: user.email || '',
    phone: user.phoneNumber || undefined,
    preferredGameIds: [],
    favoriteClubIds: [],
    searchRadiusMiles: 20
  };
}

export function isTransientPlayerProfileReadError(error: unknown) {
  if (isOperationTimeoutError(error)) return true;
  const code = readFirebaseErrorCode(error);
  if (code === 'unavailable' || code === 'firestore/unavailable') return true;
  return error instanceof Error && /failed to get document because the client is offline/i.test(error.message);
}

export async function fetchWebPlayerProfile(user: User): Promise<PlayerAccount> {
  let snapshot;
  try {
    const [{ doc, getDoc }, { db }] = await withDeadline(
      Promise.all([import('firebase/firestore'), getFirebaseBrowserClient()]),
      'Your Orbit profile took too long to connect.'
    );
    snapshot = await withDeadline(getDoc(doc(db, 'players', user.uid)), 'Your Orbit profile took too long to load.');
  } catch (error) {
    if (isTransientPlayerProfileReadError(error)) return fallbackPlayerProfile(user);
    throw error;
  }
  if (!snapshot.exists()) return fallbackPlayerProfile(user);
  const profile = preserveLegacyPlayerProfile(snapshot.data());
  return {
    ...fallbackPlayerProfile(user),
    ...profile,
    id: user.uid,
    email: user.email || profile.email || '',
    preferredGameIds: Array.isArray(profile.preferredGameIds) ? profile.preferredGameIds : [],
    favoriteClubIds: Array.isArray(profile.favoriteClubIds) ? profile.favoriteClubIds : []
  };
}

export async function saveWebPlayerProfile(user: User, player: PlayerAccount) {
  if (user.uid !== player.id) throw new Error('The signed-in Orbit account does not match this profile.');
  const [{ doc, serverTimestamp, setDoc }, { db }] = await Promise.all([import('firebase/firestore'), getFirebaseBrowserClient()]);
  const profile: PlayerAccount = {
    ...player,
    id: user.uid,
    email: user.email || player.email,
    preferredGameIds: player.preferredGameIds ?? [],
    favoriteClubIds: player.favoriteClubIds ?? []
  };
  await setDoc(doc(db, 'players', user.uid), {
    ...profile,
    uid: user.uid,
    updatedAt: serverTimestamp()
  }, { merge: true });
  return profile;
}
