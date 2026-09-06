import { describe, expect, it } from 'vitest';
import {
  decodeDiscoveryResponse,
  decodeIdentityResponse,
  decodeMembershipQrResponse,
  decodePlayerClubSnapshot,
  decodePlayerProfile,
  decodePlayerSyncGame,
  decodePlayerTournament,
  decodeSnapshotEnvelope,
  decodeTournamentInterest,
  decodeTournamentInterestMutationResponse,
  readBoundaryError,
  readFirebaseErrorCode
} from './playerBoundaryDecoders';

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

const snapshot = (club: Record<string, unknown> = {}) => ({
  club: { id: 'club-1', name: 'River Room', ...club },
  games: [],
  memberships: [],
  waitlists: [],
  notifications: [],
  social: { activePlayerCount: 0, adminCount: 0, knownPlayersInHouse: 0, waitlistCount: 0 },
  generatedAt: '2026-08-09T12:00:00.000Z'
});

const tournament = (overrides: Record<string, unknown> = {}) => ({
  id: 'event-1',
  clubId: 'club-1',
  name: 'Sunday Major',
  startsAt: '2026-08-10T18:00:00.000Z',
  interestOpensAt: '2026-08-01T00:00:00.000Z',
  interestClosesAt: '2026-08-10T17:00:00.000Z',
  interestStatus: 'open',
  buyIn: 0,
  prizePoolLabel: '$10,000',
  startingStack: 0,
  levelMinutes: 0,
  lateRegistrationThroughLevel: 0,
  rebuyPrice: 0,
  rebuyStack: 0,
  unlimitedRebuys: false,
  rebuysAllowed: false,
  addOnPrice: 0,
  addOnStack: 0,
  addOnsAllowed: false,
  rules: [],
  withdrawalAllowed: true,
  entrantCount: 0,
  totalRebuys: 0,
  totalAddOns: 0,
  ...overrides
});

const interest = (overrides: Record<string, unknown> = {}) => ({
  id: 'opaque-interest-1',
  tournamentId: 'event-1',
  clubId: 'club-1',
  playerId: 'player-1',
  status: 'interested',
  createdAt: '2026-08-09T10:00:00.000Z',
  updatedAt: '2026-08-09T10:00:00.000Z',
  ...overrides
});

describe('Player external boundary decoders', () => {
  it('decodes the identity contract and rejects malformed nested fields', () => {
    expect(decodeIdentityResponse({ ok: true, identity, verificationUrl: null })).toMatchObject({ ok: true, identity });
    expect(decodeIdentityResponse({ ok: true, identity: { ...identity, ageLevel: '21' } })).toBeNull();
    expect(decodeIdentityResponse({ ok: true, identity: { ...identity, reviewStatus: 'maybe' } })).toBeNull();
    expect(decodeIdentityResponse({ ok: true, identity: { ...identity, verifiedDetails: { fullName: 'Only one field' } } })).toBeNull();
  });

  it('deep-decodes snapshots, minimum age, coordinates, and published membership options', () => {
    const decoded = decodePlayerClubSnapshot({
      ...snapshot({
        minimumAge: 18,
        coordinate: { latitude: 30.2, longitude: -96.1 },
        membershipOptions: [
          { id: 'monthly', name: 'Venue month', priceLabel: '$40', durationDays: 30, injected: 'discard' },
          { id: '', name: 'bad', priceLabel: '$0', durationDays: -1 }
        ]
      }),
      games: [{ id: 'bad-game', name: '', openTables: [] }],
      memberships: [
        { id: 'legacy-name-only', clubId: 'club-1', playerName: 'Alex', status: 'Active' },
        {
          id: 'membership-1', clubId: 'club-1', playerId: 'player-1', playerName: 'Alex', status: 'Active',
          plan: 'monthly', planName: 'Seven-day summer access', membershipDurationDays: 7,
          preferredGameIds: [], injected: 'discard'
        }
      ]
    });
    expect(decoded?.club).toMatchObject({ minimumAge: 18, coordinate: { latitude: 30.2, longitude: -96.1 } });
    expect(decoded?.club.membershipOptions).toEqual([{ id: 'monthly', name: 'Venue month', priceLabel: '$40', durationDays: 30 }]);
    expect(decoded?.games).toEqual([]);
    expect(decoded?.memberships).toEqual([expect.objectContaining({
      id: 'membership-1', planName: 'Seven-day summer access', membershipDurationDays: 7
    })]);
    expect(decoded?.memberships[0]).not.toHaveProperty('loyalty');
    expect(decoded?.memberships[0]).not.toHaveProperty('injected');
    expect(decodePlayerClubSnapshot(snapshot({ minimumAge: 19, coordinate: { latitude: 91, longitude: 0 } }))?.club)
      .not.toHaveProperty('coordinate');
    expect(decodeSnapshotEnvelope({ snapshot: snapshot(), savedAt: '2026-08-09T12:01:00.000Z' })).toMatchObject({ ok: true, accountKey: 'club-1' });
  });

  it('accepts aggregate availability across multiple valid running tables', () => {
    const table = (id: string) => ({
      id,
      gameId: 'game-1',
      label: id,
      status: 'Running',
      seatsFilled: 2,
      maxSeats: 9,
      availableSeats: 7,
      collectionMode: 'Time',
      tags: [],
      startedAt: '2026-08-09T12:00:00.000Z',
      social: { seatedPlayerCount: 2, adminCount: 0, knownPlayersCount: 1 }
    });
    expect(decodePlayerSyncGame({
      id: 'game-1',
      name: '1/2 NLH',
      maxSeats: 9,
      openTables: [table('Table 1'), table('Table 2')],
      waitlistCount: 0,
      formingCount: 0,
      availableSeats: 14,
      knownPlayersCount: 2
    })).toMatchObject({ availableSeats: 14, openTables: [{ id: 'Table 1' }, { id: 'Table 2' }] });
  });

  it('requires the interest-only discovery envelope and drops malformed nested records', () => {
    const decoded = decodeDiscoveryResponse({
      ok: true,
      clubs: [snapshot(), null],
      tournaments: [tournament(), { id: 'malformed' }],
      interests: [interest(), interest({ status: 'registered' })],
      page: { count: 1, hasMore: false, nextCursor: null, databaseQueries: 2 }
    });
    expect(decoded).toMatchObject({ ok: true, clubs: [{ club: { id: 'club-1' } }], tournaments: [{ id: 'event-1' }], interests: [{ id: 'opaque-interest-1' }] });
    expect(decodeDiscoveryResponse({ clubs: [], tournaments: [], registrations: [], page: {} })).toBeNull();
  });

  it('preserves legitimate zeros and explicit rebuy/add-on availability while rejecting malformed events', () => {
    expect(decodePlayerTournament(tournament())).toMatchObject({ buyIn: 0, startingStack: 0, rebuysAllowed: false, addOnsAllowed: false });
    expect(decodePlayerTournament(tournament())).not.toHaveProperty('rebuyPrice');
    expect(decodePlayerTournament(tournament())).not.toHaveProperty('addOnPrice');
    const optionalFactsOmitted = decodePlayerTournament(tournament({
      buyIn: undefined,
      prizePoolLabel: undefined,
      startingStack: undefined,
      levelMinutes: undefined,
      lateRegistrationThroughLevel: undefined,
      rebuyPrice: undefined,
      rebuyStack: undefined,
      unlimitedRebuys: undefined,
      rebuysAllowed: true,
      addOnPrice: undefined,
      addOnStack: undefined,
      addOnsAllowed: true,
      entrantCount: undefined,
      totalRebuys: undefined,
      totalAddOns: undefined
    }));
    expect(optionalFactsOmitted).not.toBeNull();
    expect(optionalFactsOmitted).not.toHaveProperty('buyIn');
    expect(optionalFactsOmitted).not.toHaveProperty('prizePoolLabel');
    expect(optionalFactsOmitted).not.toHaveProperty('entrantCount');
    expect(decodePlayerTournament(tournament({ rebuysAllowed: true, addOnsAllowed: true }))).toMatchObject({
      rebuyPrice: 0,
      rebuyStack: 0,
      addOnPrice: 0,
      addOnStack: 0
    });
    expect(decodePlayerTournament(tournament({ rebuysAllowed: undefined }))).toBeNull();
    expect(decodePlayerTournament(tournament({ addOnsAllowed: undefined }))).toBeNull();
    expect(decodePlayerTournament(tournament({ levelMinutes: '20' }))).toBeNull();
    expect(decodePlayerTournament(tournament({ rebuyPrice: '0' }))).toBeNull();
    expect(decodePlayerTournament(tournament({ entrantCount: -1 }))).toBeNull();
    expect(decodePlayerTournament(tournament({ interestStatus: 'registering' }))).toBeNull();
  });

  it('bounds immutable interests and online QR responses', () => {
    expect(decodeTournamentInterest(interest())).toEqual(interest());
    expect(decodeTournamentInterest(interest({ status: 'registered' }))).toBeNull();
    expect(decodeTournamentInterestMutationResponse({ ok: true, interest: interest() })).toMatchObject({ ok: true, interest: { status: 'interested' } });
    expect(decodeMembershipQrResponse({ ok: true, token: 'opaque-token', issuedAt: '2026-08-09T12:00:00.000Z', expiresAt: '2026-08-09T12:05:00.000Z' }))
      .toMatchObject({ token: 'opaque-token' });
    expect(decodeMembershipQrResponse({ ok: true, token: '', issuedAt: 'bad', expiresAt: 'bad' })).toBeNull();
  });

  it('validates player profiles but preserves server-authored membership projections on reads', () => {
    const profile = {
      uid: 'player-1',
      name: 'Alex',
      email: 'alex@example.test',
      preferredGameIds: [],
      clubMemberships: { 'club-1': { clubId: 'club-1', status: 'Active' } }
    };
    expect(decodePlayerProfile(profile)).toMatchObject(profile);
    expect(decodePlayerProfile({ ...profile, email: '', phone: '+15551112222' })).toMatchObject({
      email: '',
      phone: '+15551112222'
    });
    expect(decodePlayerProfile({ ...profile, email: '', phone: '5551112222' })).toBeNull();
    expect(decodePlayerProfile({ ...profile, email: '', phone: undefined })).toBeNull();
    expect(decodePlayerProfile({ ...profile, searchRadiusMiles: 1 })).toMatchObject({ searchRadiusMiles: 1 });
    expect(decodePlayerProfile({ ...profile, searchRadiusMiles: 500 })).toMatchObject({ searchRadiusMiles: 500 });
    expect(decodePlayerProfile({ ...profile, searchRadiusMiles: 0 })).not.toHaveProperty('searchRadiusMiles');
    expect(decodePlayerProfile({ ...profile, searchRadiusMiles: 501 })).not.toHaveProperty('searchRadiusMiles');
    expect(decodePlayerProfile({ ...profile, uid: 42 })).toBeNull();
    expect(decodePlayerProfile({ ...profile, preferredGameIds: 'holdem' })).toBeNull();
  });

  it('reads error fields without asserting arbitrary values', () => {
    expect(readBoundaryError({ error: 'Remote failure.' }, 'Fallback.')).toBe('Remote failure.');
    expect(readBoundaryError({ error: 42 }, 'Fallback.')).toBe('Fallback.');
    expect(readFirebaseErrorCode({ code: 'auth/email-already-in-use' })).toBe('auth/email-already-in-use');
  });
});
