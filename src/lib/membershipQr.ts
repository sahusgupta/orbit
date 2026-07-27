export type MembershipQrCredential = {
  version: 1;
  clubId: string;
  playerId: string;
};

export type MembershipQrProfile = {
  id: string;
  name: string;
  membershipStatus?: 'Requested' | 'Approved' | 'Active' | 'Expired';
  membershipExpiresAt?: string;
  membershipExpirationDate?: string;
};

export type MembershipQrValidation =
  | { ok: true; credential: MembershipQrCredential; profile: MembershipQrProfile }
  | { ok: false; code: 'invalid' | 'wrong-club' | 'not-found' | 'approved-not-active' | 'inactive'; profile?: MembershipQrProfile };

const membershipQrPrefix = 'orbit-membership:v1:';

export function createMembershipQrValue(clubId: string, playerId: string) {
  return `${membershipQrPrefix}${encodeURIComponent(clubId.trim())}:${encodeURIComponent(playerId.trim())}`;
}

export function parseMembershipQrValue(value: string): MembershipQrCredential | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith(membershipQrPrefix)) return null;
  const encodedParts = trimmed.slice(membershipQrPrefix.length).split(':');
  if (encodedParts.length !== 2) return null;
  try {
    const clubId = decodeURIComponent(encodedParts[0]).trim();
    const playerId = decodeURIComponent(encodedParts[1]).trim();
    if (!clubId || !playerId) return null;
    return { version: 1, clubId, playerId };
  } catch {
    return null;
  }
}

export function validateMembershipQrCheckIn(
  value: string,
  currentClubId: string,
  profiles: MembershipQrProfile[],
  nowMs = Date.now()
): MembershipQrValidation {
  const credential = parseMembershipQrValue(value);
  if (!credential) return { ok: false, code: 'invalid' };
  if (credential.clubId.trim().toLowerCase() !== currentClubId.trim().toLowerCase()) {
    return { ok: false, code: 'wrong-club' };
  }
  const profile = profiles.find((candidate) => candidate.id === credential.playerId);
  if (!profile) return { ok: false, code: 'not-found' };
  if (profile.membershipStatus === 'Approved') return { ok: false, code: 'approved-not-active', profile };
  const expiration = profile.membershipExpiresAt || profile.membershipExpirationDate;
  if (profile.membershipStatus !== 'Active' || !expiration || Date.parse(expiration) <= nowMs) {
    return { ok: false, code: 'inactive', profile };
  }
  return { ok: true, credential, profile };
}
