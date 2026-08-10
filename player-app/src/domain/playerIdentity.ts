export type PlayerIdentityStatus = {
  status: 'unverified' | 'requires_input' | 'processing' | 'verified' | 'underage' | 'canceled' | 'redacted';
  ageVerified: boolean;
  ageLevel: number;
  minimumAge: number;
  verifiedAt: string | null;
  failureCode: string | null;
};
