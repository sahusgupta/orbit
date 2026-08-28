import { describe, expect, it } from 'vitest';
import {
  decodeCheckoutResponse,
  decodeIdentityResponse,
  decodePrivateGameRecord,
  decodeSnapshotEnvelope,
  decodeTournamentEvent,
  preserveLegacyPlayerProfile,
  readBoundaryError,
  readFirebaseErrorCode
} from './playerBoundaryDecoders';

describe('Player external boundary decoders', () => {
  it('decodes the identity contract and rejects malformed identity fields', () => {
    const identity = {
      status: 'verified',
      ageVerified: true,
      ageEligible: true,
      ageLevel: 21,
      minimumAge: 21,
      verifiedAt: '2026-08-09T11:00:00.000Z',
      capturedAt: '2026-08-09T10:00:00.000Z',
      failureCode: null,
      reviewStatus: 'approved'
    };

    expect(decodeIdentityResponse({ ok: true, identity, verificationUrl: null })).toEqual({
      ok: true,
      identity,
      verificationUrl: null
    });
    expect(decodeIdentityResponse({ ok: true, identity: { ...identity, ageLevel: '21' } })).toBeNull();
    expect(decodeIdentityResponse({ ok: true, identity: { ...identity, ageEligible: 'yes' } })).toBeNull();
    expect(decodeIdentityResponse({ ok: true, identity: { ...identity, reviewStatus: 'maybe' } })).toBeNull();
    expect(decodeIdentityResponse({ ok: true, identity: { ...identity, status: 'unknown' } })).toBeNull();
    expect(decodeIdentityResponse({ ok: true, identity: {
      ...identity,
      status: 'provisional',
      ageVerified: false,
      reviewStatus: 'pending-in-person'
    } })).toMatchObject({ identity: { status: 'provisional', ageEligible: true, ageVerified: false, reviewStatus: 'pending-in-person' } });
    expect(decodeIdentityResponse({ ok: true, identity: { ...identity, verifiedDetails: { fullName: 'Jordan Rivera', dateOfBirth: '1990-01-02', address: '100 Main St' } } }))
      .toMatchObject({ identity: { verifiedDetails: { fullName: 'Jordan Rivera', dateOfBirth: '1990-01-02', address: '100 Main St' } } });
    expect(decodeIdentityResponse({ ok: true, identity: { ...identity, verifiedDetails: { fullName: 'Jordan Rivera' } } })).toBeNull();
    expect(decodeIdentityResponse(null)).toBeNull();
  });

  it('decodes checkout and snapshot envelopes only when their required records are present', () => {
    const snapshot = {
      club: { id: 'club-1', name: 'River Room' },
      games: [],
      memberships: [],
      waitlists: [],
      notifications: [],
      generatedAt: '2026-08-09T12:00:00.000Z'
    };

    expect(decodeCheckoutResponse({ checkoutUrl: 'https://checkout.example/session', sessionId: 'session-1' })).toEqual({
      ok: true,
      checkoutUrl: 'https://checkout.example/session',
      sessionId: 'session-1'
    });
    expect(decodeCheckoutResponse({ checkoutUrl: 'https://checkout.example/session' })).toBeNull();
    expect(decodeSnapshotEnvelope({ snapshot, savedAt: '2026-08-09T12:01:00.000Z' })).toEqual({
      ok: true,
      snapshot,
      accountKey: 'club-1',
      savedAt: '2026-08-09T12:01:00.000Z'
    });
    expect(decodeSnapshotEnvelope({ snapshot: { ...snapshot, games: null } })).toBeNull();
  });

  it('keeps the characterized legacy malformed-record policies explicit', () => {
    const malformedProfile = { uid: 42, preferredGameIds: 'not-an-array' };
    const privateGame = { id: 'private-1', status: 'Open' };

    expect(preserveLegacyPlayerProfile(malformedProfile)).toBe(malformedProfile);
    expect(decodeTournamentEvent(null, 'event-1', 'club-1')).toEqual({ id: 'event-1', clubId: 'club-1' });
    expect(decodePrivateGameRecord(privateGame)).toBe(privateGame);
    expect(() => decodePrivateGameRecord(null)).toThrow('Private game records must be objects.');
  });

  it('reads error fields without asserting arbitrary thrown or response values', () => {
    expect(readBoundaryError({ error: 'Remote failure.' }, 'Fallback.')).toBe('Remote failure.');
    expect(readBoundaryError({ error: 42 }, 'Fallback.')).toBe('Fallback.');
    expect(readFirebaseErrorCode({ code: 'auth/email-already-in-use' })).toBe('auth/email-already-in-use');
    expect(readFirebaseErrorCode(new Error('failure'))).toBeUndefined();
  });
});
