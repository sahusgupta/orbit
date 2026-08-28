export type PlayerIdentityStatus = {
  status: 'unverified' | 'requires_input' | 'processing' | 'provisional' | 'verified' | 'underage' | 'canceled' | 'redacted';
  ageVerified: boolean;
  ageEligible: boolean;
  ageLevel: number;
  minimumAge: number;
  verifiedAt: string | null;
  capturedAt: string | null;
  failureCode: string | null;
  reviewStatus: 'not-started' | 'pending-in-person' | 'approved';
  verifiedDetails?: {
    fullName: string;
    dateOfBirth: string;
    address: string;
  } | null;
};

export function isIdentityActionEligible(status: PlayerIdentityStatus, minimumAge: 18 | 21) {
  if (status.ageLevel < minimumAge) return false;
  return status.ageVerified || status.status === 'provisional' && status.ageEligible;
}
