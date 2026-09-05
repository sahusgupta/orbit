import type { PlayerAccount, PlayerProfileDocument } from '../domain/playerSync';
import { hasAdultDeclaration } from '../domain/playerOnboarding';
import type { FirebasePlayerIdentity } from '../data/orbitSyncApi';

export type PlayerProfileHydration = {
  uid: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
};

type ResolveAuthenticatedPlayerProfileDependencies = {
  completeAdultDeclarationIfMissing(player: PlayerAccount, expectedUid: string): Promise<PlayerProfileDocument>;
  createProfileIfMissing(player: PlayerAccount, expectedUid: string): Promise<{ created: boolean; profile: PlayerProfileDocument }>;
  readProfile(expectedUid: string): Promise<PlayerProfileDocument | null>;
};

export function playerAccountFromProfile(profile: PlayerProfileDocument): PlayerAccount {
  return {
    id: profile.uid,
    name: profile.name,
    email: profile.email,
    preferredGameIds: profile.preferredGameIds,
    favoriteClubIds: profile.favoriteClubIds ?? [],
    ...(profile.phone !== undefined ? { phone: profile.phone } : {}),
    ...(profile.homeLocation !== undefined ? { homeLocation: profile.homeLocation } : {}),
    ...(profile.searchRadiusMiles !== undefined ? { searchRadiusMiles: profile.searchRadiusMiles } : {}),
    ...(profile.preferredStakes !== undefined ? { preferredStakes: profile.preferredStakes } : {}),
    ...(profile.typicalAvailability !== undefined ? { typicalAvailability: profile.typicalAvailability } : {}),
    ...(profile.adultDeclaredAt !== undefined ? { adultDeclaredAt: profile.adultDeclaredAt } : {}),
    ...(profile.adultDeclarationVersion !== undefined ? { adultDeclarationVersion: profile.adultDeclarationVersion } : {})
  };
}

export function bindPlayerToFirebaseIdentity(player: PlayerAccount, identity: FirebasePlayerIdentity): PlayerAccount {
  return {
    ...player,
    id: identity.uid,
    name: identity.name || player.name,
    email: identity.provider === 'phone' ? '' : identity.email,
    ...(identity.phone || player.phone ? { phone: identity.phone || player.phone } : {})
  };
}

export async function resolveAuthenticatedPlayerProfile(
  identity: FirebasePlayerIdentity,
  localPlayer: PlayerAccount,
  dependencies: ResolveAuthenticatedPlayerProfileDependencies
) {
  const remoteProfile = await dependencies.readProfile(identity.uid);
  if (remoteProfile) {
    if (!hasAdultDeclaration(remoteProfile) && localPlayer.id !== identity.uid) {
      return {
        player: playerAccountFromProfile(remoteProfile),
        source: 'remote-needs-adult-declaration' as const
      };
    }
    const completedProfile = hasAdultDeclaration(remoteProfile)
      ? remoteProfile
      : await dependencies.completeAdultDeclarationIfMissing(localPlayer, identity.uid);
    return {
      player: playerAccountFromProfile(completedProfile),
      source: 'remote' as const
    };
  }

  const boundPlayer = bindPlayerToFirebaseIdentity(localPlayer, identity);
  const creation = await dependencies.createProfileIfMissing(boundPlayer, identity.uid);
  return {
    player: playerAccountFromProfile(creation.profile),
    source: creation.created ? 'created' as const : 'remote' as const
  };
}

export function canPublishHydratedPlayer({
  accountLoaded,
  hasAccount,
  hydration,
  identityUid,
  playerId,
  profileSyncPaused
}: {
  accountLoaded: boolean;
  hasAccount: boolean;
  hydration: PlayerProfileHydration;
  identityUid?: string;
  playerId: string;
  profileSyncPaused: boolean;
}) {
  return Boolean(
    accountLoaded
    && hasAccount
    && identityUid
    && playerId === identityUid
    && hydration.uid === identityUid
    && hydration.status === 'ready'
    && !profileSyncPaused
  );
}
