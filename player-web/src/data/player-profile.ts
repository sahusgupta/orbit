import { decodePlayerProfile, readFirebaseErrorCode } from '@orbit/player-domain/decoders/playerBoundaryDecoders';
import type { PlayerAccount } from '@/src/domain/types';
import type { User } from 'firebase/auth';
import { isOperationTimeoutError, withDeadline } from '@/src/auth/deadline';
import { assertExpectedFirebaseUser } from '@/src/auth/session-identity';
import { getFirebaseBrowserClient } from './firebase-client';

export type WebPlayerProfileWrite = PlayerAccount & { uid: string };

export function fallbackPlayerProfile(user: User): PlayerAccount {
  const phone = user.phoneNumber?.trim();
  return {
    id: user.uid,
    name: user.displayName?.trim() || '',
    email: user.email?.trim() || '',
    preferredGameIds: [],
    favoriteClubIds: [],
    ...(phone ? { phone } : {})
  };
}

function optionalText(value: string | undefined, maximumLength: number, label: string) {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.length > maximumLength) throw new Error(`${label} is too long.`);
  return normalized;
}

function exactIds(value: string[] | undefined, maximumCount: number, label: string) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) throw new Error(`${label} must contain only identifiers.`);
  if (value.length > maximumCount) throw new Error(`${label} contains too many selections.`);
  return [...value];
}

export function buildWebPlayerProfileWrite(user: User, player: PlayerAccount): WebPlayerProfileWrite {
  if (user.uid !== player.id) throw new Error('The signed-in Orbit account does not match this profile.');
  const name = player.name.trim();
  if (!name) throw new Error('Enter a display name before saving your Orbit profile.');
  if (name.length > 120) throw new Error('Display name is too long.');
  if (
    player.adultDeclarationVersion !== 'v1' ||
    !player.adultDeclaredAt ||
    player.adultDeclaredAt.length < 20 ||
    player.adultDeclaredAt.length > 40 ||
    !Number.isFinite(Date.parse(player.adultDeclaredAt))
  ) {
    throw new Error('Confirm that you are 18 or older before saving your Orbit profile.');
  }

  const verifiedEmail = user.email?.trim() || '';
  const verifiedPhone = user.phoneNumber?.trim();
  if (!verifiedEmail && !verifiedPhone) throw new Error('A verified email or phone number is required to save your Orbit profile.');
  const optionalPhone = verifiedEmail
    ? optionalText(player.phone, 40, 'Phone number')
    : verifiedPhone;
  const homeLocation = optionalText(player.homeLocation, 240, 'Home area');
  const preferredStakes = optionalText(player.preferredStakes, 80, 'Preferred stakes');
  const typicalAvailability = optionalText(player.typicalAvailability, 240, 'Typical availability');
  if (player.searchRadiusMiles != null && (!Number.isFinite(player.searchRadiusMiles) || player.searchRadiusMiles < 1 || player.searchRadiusMiles > 500)) {
    throw new Error('Search radius must be between 1 and 500 miles.');
  }

  return {
    id: user.uid,
    uid: user.uid,
    name,
    email: verifiedEmail,
    preferredGameIds: exactIds(player.preferredGameIds, 50, 'Preferred games'),
    favoriteClubIds: exactIds(player.favoriteClubIds, 100, 'Favorite clubs'),
    adultDeclaredAt: player.adultDeclaredAt,
    adultDeclarationVersion: 'v1',
    ...(optionalPhone ? { phone: optionalPhone } : {}),
    ...(homeLocation ? { homeLocation } : {}),
    ...(preferredStakes ? { preferredStakes } : {}),
    ...(typicalAvailability ? { typicalAvailability } : {}),
    ...(player.searchRadiusMiles != null ? { searchRadiusMiles: player.searchRadiusMiles } : {})
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
    const [{ doc, getDoc }, { auth, db }] = await withDeadline(
      Promise.all([import('firebase/firestore'), getFirebaseBrowserClient()]),
      'Your Orbit profile took too long to connect.'
    );
    assertExpectedFirebaseUser(auth, user.uid);
    snapshot = await withDeadline(getDoc(doc(db, 'players', user.uid)), 'Your Orbit profile took too long to load.');
    assertExpectedFirebaseUser(auth, user.uid);
  } catch (error) {
    if (isTransientPlayerProfileReadError(error)) {
      throw new Error('Your Orbit profile could not be loaded. Check your connection and retry before editing or saving.');
    }
    throw error;
  }
  if (!snapshot.exists()) return fallbackPlayerProfile(user);
  const profile = decodePlayerProfile(snapshot.data());
  if (!profile) throw new Error('Your stored Orbit profile could not be read safely. Contact support before making changes.');
  return {
    ...fallbackPlayerProfile(user),
    ...profile,
    id: user.uid,
    email: user.email?.trim() || profile.email || '',
    preferredGameIds: Array.isArray(profile.preferredGameIds) ? profile.preferredGameIds : [],
    favoriteClubIds: Array.isArray(profile.favoriteClubIds) ? profile.favoriteClubIds : []
  };
}

export async function saveWebPlayerProfile(user: User, player: PlayerAccount) {
  const [{ deleteField, doc, serverTimestamp, setDoc }, { auth, db }] = await Promise.all([import('firebase/firestore'), getFirebaseBrowserClient()]);
  assertExpectedFirebaseUser(auth, user.uid);
  const write = buildWebPlayerProfileWrite(user, player);
  await setDoc(doc(db, 'players', user.uid), {
    ...write,
    ...(!write.phone ? { phone: deleteField() } : {}),
    ...(!write.homeLocation ? { homeLocation: deleteField() } : {}),
    ...(write.searchRadiusMiles === undefined ? { searchRadiusMiles: deleteField() } : {}),
    ...(!write.preferredStakes ? { preferredStakes: deleteField() } : {}),
    ...(!write.typicalAvailability ? { typicalAvailability: deleteField() } : {}),
    updatedAt: serverTimestamp()
  }, { merge: true });
  assertExpectedFirebaseUser(auth, user.uid);
  const profile = { ...write };
  Reflect.deleteProperty(profile, 'uid');
  return profile;
}
