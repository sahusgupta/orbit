import { describe, expect, it } from 'vitest';
import { isIdentityActionEligible, type PlayerIdentityStatus } from './playerIdentity';

const status = (overrides: Partial<PlayerIdentityStatus> = {}): PlayerIdentityStatus => ({
  status: 'unverified',
  ageVerified: false,
  ageEligible: false,
  ageLevel: 0,
  minimumAge: 18,
  verifiedAt: null,
  capturedAt: null,
  failureCode: null,
  reviewStatus: 'not-started',
  verifiedDetails: null,
  ...overrides
});

describe('player identity action eligibility', () => {
  it('allows an age-eligible provisional capture without calling it verified', () => {
    const provisional = status({
      status: 'provisional',
      ageEligible: true,
      ageLevel: 21,
      reviewStatus: 'pending-in-person'
    });
    expect(isIdentityActionEligible(provisional, 21)).toBe(true);
    expect(provisional.ageVerified).toBe(false);
  });

  it('enforces each card house minimum age', () => {
    const eighteen = status({ status: 'provisional', ageEligible: true, ageLevel: 18, reviewStatus: 'pending-in-person' });
    expect(isIdentityActionEligible(eighteen, 18)).toBe(true);
    expect(isIdentityActionEligible(eighteen, 21)).toBe(false);
  });

  it('rejects an unverified or ineligible capture', () => {
    expect(isIdentityActionEligible(status({ ageLevel: 21 }), 21)).toBe(false);
    expect(isIdentityActionEligible(status({ status: 'provisional', ageLevel: 21 }), 21)).toBe(false);
  });
});
