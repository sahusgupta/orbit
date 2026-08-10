import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { preserveLegacyPlayerProfile } from '../../domain/decoders/playerBoundaryDecoders';
import type { PlayerAccount, PlayerClubMembershipRecord, PlayerProfileDocument } from '../../domain/playerSync';
import { db } from './firebaseClient';
import { ensureSignedInIdentity } from './playerAuth';

export async function savePlayerProfile(player: PlayerAccount, membershipPatch?: PlayerClubMembershipRecord) {
  const uid = ensureSignedInIdentity();
  const profileRef = doc(db, 'players', uid);
  const existing = await getDoc(profileRef);
  const existingData: Partial<PlayerProfileDocument> = existing.exists()
    ? preserveLegacyPlayerProfile(existing.data())
    : {};
  const clubMemberships = {
    ...(existingData.clubMemberships ?? {}),
    ...(membershipPatch ? { [membershipPatch.clubId]: membershipPatch } : {})
  };
  const profile: PlayerProfileDocument = {
    ...player,
    id: uid,
    uid,
    name: player.name,
    email: player.email,
    preferredGameIds: player.preferredGameIds,
    favoriteClubIds: player.favoriteClubIds ?? [],
    preferredStakes: player.preferredStakes,
    typicalAvailability: player.typicalAvailability,
    homeLocation: player.homeLocation,
    searchRadiusMiles: player.searchRadiusMiles,
    clubMemberships,
    updatedAt: new Date().toISOString()
  };

  await setDoc(
    profileRef,
    {
      ...profile,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
  return profile;
}

export async function fetchPlayerProfile() {
  const uid = ensureSignedInIdentity();
  const snapshot = await getDoc(doc(db, 'players', uid));
  return snapshot.exists() ? preserveLegacyPlayerProfile(snapshot.data()) : null;
}

export async function updatePlayerClubMembership(player: PlayerAccount, membership: PlayerClubMembershipRecord) {
  return savePlayerProfile(player, membership);
}
