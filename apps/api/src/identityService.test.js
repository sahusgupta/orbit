import { describe, expect, it } from 'vitest';
import identityService from './identityService.js';

const {
  buildEligibilityUpdate,
  buildCameraIdentityRecord,
  calculateAgeFromDate,
  getAgeLevel,
  getPublicIdentityStatus,
  handleStripeIdentityEvent,
  normalizeCameraCapture,
  normalizeRequiredMinimumAge
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
    expect(normalizeRequiredMinimumAge(18)).toBe(18);
    expect(normalizeRequiredMinimumAge(21)).toBe(21);
    expect(normalizeRequiredMinimumAge(undefined)).toBe(21);
  });

  it('allows an 18-year-old identity while leaving 21+ enforcement to the selected club', () => {
    const update = buildEligibilityUpdate({
      id: 'vs_eighteen',
      status: 'verified',
      verified_outputs: { dob: { year: 2008, month: 7, day: 27 } }
    }, { id: 'evt_eighteen', created: 1785172800 }, 18, today);

    expect(update).toMatchObject({ status: 'verified', ageVerified: true, ageLevel: 18 });
  });

  it('retains only the requested verified ID details for an eligible player', () => {
    const update = buildEligibilityUpdate({
      id: 'vs_adult',
      status: 'verified',
      livemode: true,
      verified_outputs: {
        first_name: 'Jordan',
        last_name: 'Rivera',
        dob: { year: 1990, month: 1, day: 2 },
        address: { line1: '100 Main St', city: 'Austin', state: 'TX', postal_code: '78701', country: 'US' },
        id_number: 'never-store-this'
      }
    }, { id: 'evt_adult', created: 1785172800 }, 21, today);

    expect(update).toMatchObject({
      status: 'verified',
      ageVerified: true,
      ageLevel: 21,
      providerSessionId: 'vs_adult',
      verifiedDetails: {
        fullName: 'Jordan Rivera',
        dateOfBirth: '1990-01-02',
        address: '100 Main St, Austin, TX 78701, US'
      }
    });
    expect(update).not.toHaveProperty('dob');
    expect(update).not.toHaveProperty('age');
    expect(JSON.stringify(update)).not.toContain('never-store-this');
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
      ageEligible: true,
      ageLevel: 21,
      minimumAge: 18,
      verifiedAt: today.toISOString(),
      reviewStatus: 'approved',
      capturedAt: null,
      failureCode: null,
      verifiedDetails: null
    });
  });

  it('accepts only sanitized camera extraction fields and calculates age on the server', () => {
    expect(normalizeCameraCapture({
      fullName: '  Jordan   Rivera ',
      dateOfBirth: '2008-07-27',
      address: ' 100 Main St ',
      mutationId: 'capture:one'
    }, today)).toEqual({
      ok: true,
      value: {
        fullName: 'Jordan Rivera',
        dateOfBirth: '2008-07-27',
        address: '100 Main St',
        mutationId: 'capture:one',
        age: 18
      }
    });
    expect(normalizeCameraCapture({
      fullName: 'Jordan Rivera',
      dateOfBirth: '2005-02-29',
      address: '100 Main St',
      mutationId: 'capture:bad-date'
    }, today)).toMatchObject({ ok: false });
  });

  it('rejects raw identity media, barcode data, document numbers, and unknown fields', () => {
    const base = {
      fullName: 'Jordan Rivera',
      dateOfBirth: '1990-01-02',
      address: '100 Main St',
      mutationId: 'capture:two'
    };
    expect(normalizeCameraCapture({ ...base, image: 'data:image/jpeg;base64,abc' }, today)).toMatchObject({ ok: false });
    expect(normalizeCameraCapture({ ...base, barcode: 'raw-pdf417' }, today)).toMatchObject({ ok: false });
    expect(normalizeCameraCapture({ ...base, idNumber: '1234' }, today)).toMatchObject({ ok: false });
    expect(normalizeCameraCapture({ ...base, age: 40 }, today)).toMatchObject({ ok: false });
  });

  it('exposes provisional eligibility without treating camera extraction as verified identity', () => {
    expect(getPublicIdentityStatus({
      status: 'provisional',
      ageVerified: false,
      ageEligible: true,
      ageLevel: 21,
      reviewStatus: 'pending-in-person',
      capturedAt: today.toISOString(),
      verifiedDetails: {
        fullName: 'Jordan Rivera',
        dateOfBirth: '1990-01-02',
        address: '100 Main St'
      }
    })).toMatchObject({
      status: 'provisional',
      ageVerified: false,
      ageEligible: true,
      ageLevel: 21,
      reviewStatus: 'pending-in-person',
      capturedAt: today.toISOString()
    });
  });

  it('preserves provider session references needed for deletion redaction after camera recapture', () => {
    const record = buildCameraIdentityRecord({
      provider: 'stripe_identity',
      providerSessionId: 'vs_latest',
      providerSessionIds: ['vs_older']
    }, {
      fullName: 'Jordan Rivera',
      dateOfBirth: '1990-01-02',
      address: '100 Main St',
      mutationId: 'capture:redaction',
      age: 36
    }, today);
    expect(record).toMatchObject({
      provider: 'stripe_identity',
      providerSessionId: 'vs_latest',
      providerSessionIds: ['vs_older', 'vs_latest'],
      status: 'provisional'
    });
  });

  it('returns a decoder-safe status before a player has scanned an ID', () => {
    expect(getPublicIdentityStatus({})).toMatchObject({
      status: 'unverified',
      ageVerified: false,
      ageEligible: false,
      reviewStatus: 'not-started',
      capturedAt: null,
      verifiedDetails: null
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
