import { describe, expect, it } from 'vitest';
import identityService from './identityService.js';

const {
  buildEligibilityUpdate,
  calculateAgeFromDate,
  getAgeLevel,
  getPublicIdentityStatus,
  handleStripeIdentityEvent
} = identityService;

describe('Stripe Identity age eligibility', () => {
  const today = new Date('2026-07-27T12:00:00.000Z');

  it('calculates age using the birthday instead of elapsed milliseconds', () => {
    expect(calculateAgeFromDate({ year: 2005, month: 7, day: 27 }, today)).toBe(21);
    expect(calculateAgeFromDate({ year: 2005, month: 7, day: 28 }, today)).toBe(20);
  });

  it('maps ages into the only eligibility bands Orbit exposes', () => {
    expect(getAgeLevel(17)).toBe(0);
    expect(getAgeLevel(18)).toBe(18);
    expect(getAgeLevel(21)).toBe(21);
  });

  it('marks a verified Stripe document as eligible without retaining the birthdate', () => {
    const update = buildEligibilityUpdate({
      id: 'vs_adult',
      status: 'verified',
      livemode: true,
      verified_outputs: { dob: { year: 1990, month: 1, day: 2 } }
    }, { id: 'evt_adult', created: 1785172800 }, 21, today);

    expect(update).toMatchObject({
      status: 'verified',
      ageVerified: true,
      ageLevel: 21,
      providerSessionId: 'vs_adult'
    });
    expect(update).not.toHaveProperty('dob');
    expect(update).not.toHaveProperty('age');
  });

  it('blocks a successfully identified player who is below the launch age', () => {
    const update = buildEligibilityUpdate({
      id: 'vs_minor',
      status: 'verified',
      verified_outputs: { dob: { year: 2010, month: 1, day: 1 } }
    }, { id: 'evt_minor', created: 1785172800 }, 21, today);

    expect(getPublicIdentityStatus(update)).toMatchObject({
      status: 'underage',
      ageVerified: false,
      ageLevel: 0,
      failureCode: 'minimum_age_not_met'
    });
  });

  it('does not approve a verified session when Stripe supplies no birthdate', () => {
    const update = buildEligibilityUpdate({
      id: 'vs_missing_dob',
      status: 'verified',
      verified_outputs: {}
    }, { id: 'evt_missing_dob', created: 1785172800 }, 21, today);

    expect(update).toMatchObject({
      status: 'requires_input',
      ageVerified: false,
      failureCode: 'date_of_birth_unavailable'
    });
  });

  it('never exposes Stripe session details through the public status response', () => {
    const status = getPublicIdentityStatus({
      status: 'verified',
      ageVerified: true,
      ageLevel: 21,
      providerSessionId: 'vs_private',
      verified_outputs: { dob: { year: 1990, month: 1, day: 2 } },
      verifiedAt: { toDate: () => today }
    });

    expect(status).toEqual({
      status: 'verified',
      ageVerified: true,
      ageLevel: 21,
      minimumAge: 21,
      verifiedAt: today.toISOString(),
      failureCode: null
    });
  });

  it('ignores Identity events that were not created for Orbit player verification', async () => {
    await expect(handleStripeIdentityEvent({
      type: 'identity.verification_session.verified',
      data: { object: { id: 'vs_unrelated', metadata: { purpose: 'another_product' } } }
    })).resolves.toBe(false);
    await expect(handleStripeIdentityEvent({
      type: 'identity.verification_session.verified',
      data: { object: { id: 'vs_missing_metadata', metadata: {} } }
    })).resolves.toBe(false);
  });
});
