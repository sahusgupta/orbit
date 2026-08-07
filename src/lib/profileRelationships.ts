export type ProfileIdentity = {
  id: string;
  name: string;
};

export type ProfileReference = {
  profileId?: string;
  playerName: string;
};

export const normalizeProfileName = (name: string) => name.trim().toLowerCase();

const hasAuthoritativeProfileId = (reference: ProfileReference) => reference.profileId !== undefined;

export function resolveProfileForReference<TProfile extends ProfileIdentity>(
  reference: ProfileReference,
  profiles: TProfile[]
): TProfile | undefined {
  if (hasAuthoritativeProfileId(reference)) {
    return profiles.find((profile) => profile.id === reference.profileId);
  }
  const normalizedName = normalizeProfileName(reference.playerName);
  const matches = profiles.filter((profile) => normalizeProfileName(profile.name) === normalizedName);
  return matches.length === 1 ? matches[0] : undefined;
}

export function getProfileReferenceMatches<TReference extends ProfileReference, TProfile extends ProfileIdentity>(
  references: TReference[],
  profiles: TProfile[],
  profile: TProfile,
  isEligible: (reference: TReference) => boolean = () => true
): TReference[] {
  const eligibleReferences = references.filter(isEligible);
  const authoritativeMatches = eligibleReferences.filter((reference) => reference.profileId === profile.id);
  if (authoritativeMatches.length) return authoritativeMatches;

  const normalizedName = normalizeProfileName(profile.name);
  const matchingProfiles = profiles.filter((candidate) => normalizeProfileName(candidate.name) === normalizedName);
  if (matchingProfiles.length !== 1 || matchingProfiles[0].id !== profile.id) return [];

  const unlinkedNameMatches = eligibleReferences.filter(
    (reference) => !hasAuthoritativeProfileId(reference) && normalizeProfileName(reference.playerName) === normalizedName
  );
  return unlinkedNameMatches.length === 1 ? unlinkedNameMatches : [];
}

export function findUniqueProfileReference<TReference extends ProfileReference, TProfile extends ProfileIdentity>(
  references: TReference[],
  profiles: TProfile[],
  profile: TProfile,
  isEligible: (reference: TReference) => boolean = () => true
): TReference | undefined {
  const matches = getProfileReferenceMatches(references, profiles, profile, isEligible);
  return matches.length === 1 ? matches[0] : undefined;
}

export function hasProfileReference<TReference extends ProfileReference, TProfile extends ProfileIdentity>(
  references: TReference[],
  profiles: TProfile[],
  profile: TProfile,
  isEligible: (reference: TReference) => boolean = () => true
) {
  return getProfileReferenceMatches(references, profiles, profile, isEligible).length > 0;
}
