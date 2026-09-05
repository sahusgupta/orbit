import { createSecureUuid } from '../security/secureIdentifier';

export type MembershipQrCredential = {
  token: string;
  issuedAt: string;
  expiresAt: string;
};

export function createMembershipQrMutationId() {
  return createSecureUuid();
}

export function isMembershipQrUsable(credential: MembershipQrCredential | null, nowMs: number) {
  if (!credential?.token) return false;
  const expiry = Date.parse(credential.expiresAt);
  return Number.isFinite(expiry) && expiry > nowMs;
}
