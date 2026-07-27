const membershipQrPrefix = 'orbit-membership:v1:';

export function createMembershipQrValue(clubId: string, playerId: string) {
  return `${membershipQrPrefix}${encodeURIComponent(clubId.trim())}:${encodeURIComponent(playerId.trim())}`;
}
