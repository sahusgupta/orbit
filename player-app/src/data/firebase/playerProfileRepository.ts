import { deleteField, doc, getDoc, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore';
import { decodePlayerProfile } from '../../domain/decoders/playerBoundaryDecoders';
import { hasAdultDeclaration } from '../../domain/playerOnboarding';
import type { PlayerAccount, PlayerProfileDocument } from '../../domain/playerSync';
import { db } from './firebaseClient';
import { ensureSignedInIdentity, getCurrentFirebasePlayer } from './playerAuth';

function requireExpectedSignedInIdentity(expectedUid: string) {
  const uid = expectedUid.trim();
  if (!uid) throw new Error('A verified Orbit Player account is required before syncing.');
  const identity = getCurrentFirebasePlayer();
  if (!identity) throw new Error('Sign in with your email address or phone number before syncing.');
  if (identity.uid !== uid) throw new Error('The signed-in Orbit Player account changed before syncing. No profile changes were saved.');
  return identity;
}

function buildAuthenticatedPlayerProfile(player: PlayerAccount, expectedUid: string) {
  const identity = requireExpectedSignedInIdentity(expectedUid);
  const uid = expectedUid.trim();
  if (player.id !== uid) throw new Error('The local player profile does not match the signed-in Orbit Player account. No profile changes were saved.');
  if (player.adultDeclarationVersion !== 'v1' || !player.adultDeclaredAt || !Number.isFinite(Date.parse(player.adultDeclaredAt))) {
    throw new Error('Confirm that you are 18 or older before saving your Orbit profile.');
  }
  const profile: PlayerProfileDocument = {
    id: uid,
    uid,
    name: player.name,
    // Firestore authorizes contact identity against verified auth claims. Never
    // publish an unverified local email for a phone-authenticated account.
    email: identity.provider === 'email' ? identity.email : '',
    preferredGameIds: player.preferredGameIds,
    favoriteClubIds: player.favoriteClubIds ?? [],
    adultDeclaredAt: player.adultDeclaredAt,
    adultDeclarationVersion: player.adultDeclarationVersion,
    ...(identity.phone
      ? { phone: identity.phone }
      : player.phone?.trim() ? { phone: player.phone.trim() } : {}),
    ...(player.preferredStakes?.trim() ? { preferredStakes: player.preferredStakes.trim() } : {}),
    ...(player.typicalAvailability?.trim() ? { typicalAvailability: player.typicalAvailability.trim() } : {}),
    ...(player.homeLocation?.trim() ? { homeLocation: player.homeLocation.trim() } : {}),
    ...(typeof player.searchRadiusMiles === 'number' && Number.isFinite(player.searchRadiusMiles) && player.searchRadiusMiles >= 1 && player.searchRadiusMiles <= 500
      ? { searchRadiusMiles: player.searchRadiusMiles }
      : {}),
    updatedAt: new Date().toISOString()
  };
  return { profile, profileRef: doc(db, 'players', uid) };
}

export async function savePlayerProfile(player: PlayerAccount, expectedUid: string) {
  const { profile, profileRef } = buildAuthenticatedPlayerProfile(player, expectedUid);
  requireExpectedSignedInIdentity(expectedUid);

  await setDoc(
    profileRef,
    {
      ...profile,
      ...(!profile.phone ? { phone: deleteField() } : {}),
      ...(!profile.homeLocation ? { homeLocation: deleteField() } : {}),
      ...(profile.searchRadiusMiles === undefined ? { searchRadiusMiles: deleteField() } : {}),
      ...(!profile.preferredStakes ? { preferredStakes: deleteField() } : {}),
      ...(!profile.typicalAvailability ? { typicalAvailability: deleteField() } : {}),
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
  requireExpectedSignedInIdentity(expectedUid);
  return profile;
}

export async function createPlayerProfileIfMissing(player: PlayerAccount, expectedUid: string) {
  const { profile, profileRef } = buildAuthenticatedPlayerProfile(player, expectedUid);
  const result = await runTransaction(db, async (transaction) => {
    requireExpectedSignedInIdentity(expectedUid);
    const existingSnapshot = await transaction.get(profileRef);
    if (existingSnapshot.exists()) {
      const existingProfile = decodePlayerProfile(existingSnapshot.data());
      if (!existingProfile || existingProfile.uid !== profile.uid) throw new Error('The saved player profile is invalid and was not changed.');
      return { created: false as const, profile: existingProfile };
    }
    requireExpectedSignedInIdentity(expectedUid);
    transaction.set(profileRef, { ...profile, updatedAt: serverTimestamp() });
    return { created: true as const, profile };
  });
  requireExpectedSignedInIdentity(expectedUid);
  return result;
}

export async function completePlayerAdultDeclarationIfMissing(player: PlayerAccount, expectedUid: string) {
  if (!hasAdultDeclaration(player)) throw new Error('Confirm that you are 18 or older before completing your Orbit profile.');
  if (player.id !== expectedUid) {
    throw new Error('Confirm adult eligibility while connected to the same Orbit Player account. No profile changes were saved.');
  }
  requireExpectedSignedInIdentity(expectedUid);
  const profileRef = doc(db, 'players', expectedUid);
  const result = await runTransaction(db, async (transaction) => {
    requireExpectedSignedInIdentity(expectedUid);
    const snapshot = await transaction.get(profileRef);
    if (!snapshot.exists()) throw new Error('The saved player profile is missing. Retry account setup.');
    const rawProfile = snapshot.data() as Record<string, unknown>;
    const existingProfile = decodePlayerProfile(rawProfile);
    if (!existingProfile || existingProfile.uid !== expectedUid) {
      throw new Error('The saved player profile is invalid and was not changed.');
    }
    if (hasAdultDeclaration(existingProfile)) return existingProfile;
    if (rawProfile.adultDeclaredAt !== undefined || rawProfile.adultDeclarationVersion !== undefined) {
      throw new Error('The saved adult declaration is invalid and was not changed.');
    }
    requireExpectedSignedInIdentity(expectedUid);
    transaction.update(profileRef, {
      adultDeclaredAt: player.adultDeclaredAt,
      adultDeclarationVersion: player.adultDeclarationVersion,
      updatedAt: serverTimestamp()
    });
    return {
      ...existingProfile,
      adultDeclaredAt: player.adultDeclaredAt,
      adultDeclarationVersion: player.adultDeclarationVersion,
      updatedAt: new Date().toISOString()
    };
  });
  requireExpectedSignedInIdentity(expectedUid);
  return result;
}

export async function fetchPlayerProfile(expectedUid: string) {
  const uid = ensureSignedInIdentity();
  if (uid !== expectedUid) throw new Error('The signed-in Orbit Player account changed before loading the saved profile.');
  const snapshot = await getDoc(doc(db, 'players', expectedUid));
  requireExpectedSignedInIdentity(expectedUid);
  if (!snapshot.exists()) return null;
  const profile = decodePlayerProfile(snapshot.data());
  if (!profile || profile.uid !== expectedUid) throw new Error('The saved player profile is invalid and was not changed.');
  return profile;
}
