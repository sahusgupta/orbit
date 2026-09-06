import { describe, expect, it } from 'vitest';
import {
  applyMembershipRequestToClubState,
  applyPlayerProfileDocumentToClubState,
  applyWaitlistRequestToClubState,
  buildPlayerClubSnapshot,
  createMembershipRequest,
  createWaitlistRequest,
  getClubIdFromState
} from './playerSync';

const state = {
  games: [
    { id: 'nlh-1-2', name: '1/2 NLH', maxSeats: 10 },
    { id: 'plo-1-2', name: '1/2 PLO', maxSeats: 9 }
  ],
  sessions: [
    {
      id: 'table-1',
      gameId: 'nlh-1-2',
      label: 'Main Table',
      status: 'Running' as const,
      seatsFilled: 8,
      maxSeats: 10,
      collectionMode: 'Drop' as const,
      tags: ['Social'],
      startedAt: '2026-05-20T01:00:00.000Z'
    },
    {
      id: 'table-2',
      gameId: 'plo-1-2',
      label: 'Must Move',
      status: 'Forming' as const,
      seatsFilled: 5,
      maxSeats: 9,
      collectionMode: 'Time' as const,
      tags: ['Action'],
      startedAt: '2026-05-20T02:00:00.000Z'
    },
    {
      id: 'table-3',
      gameId: 'nlh-1-2',
      label: 'Closed Table',
      status: 'Closed' as const,
      seatsFilled: 0,
      maxSeats: 10,
      collectionMode: 'Drop' as const,
      tags: [],
      startedAt: '2026-05-20T00:00:00.000Z'
    }
  ],
  playerSessions: [
    {
      id: 'seat-1',
      playerName: 'Riley',
      profileId: 'player-2',
      gameId: 'nlh-1-2',
      tableId: 'table-1'
    },
    {
      id: 'seat-2',
      playerName: 'Casey',
      profileId: 'player-3',
      gameId: 'nlh-1-2',
      tableId: 'table-1'
    },
    {
      id: 'seat-3',
      playerName: 'Former Player',
      profileId: 'player-4',
      gameId: 'plo-1-2',
      tableId: 'table-2',
      leftAt: '2026-05-20T03:00:00.000Z'
    }
  ],
  interests: [
    {
      id: 'interest-2',
      playerName: 'Riley',
      gameId: 'nlh-1-2',
      status: 'Confirmed Coming' as const,
      interestedAt: '2026-05-20T01:10:00.000Z'
    },
    {
      id: 'interest-1',
      playerName: 'Alex',
      gameId: 'nlh-1-2',
      status: 'Interested' as const,
      interestedAt: '2026-05-20T01:00:00.000Z'
    },
    {
      id: 'interest-3',
      playerName: 'Jordan',
      gameId: 'nlh-1-2',
      status: 'Removed' as const,
      interestedAt: '2026-05-20T00:30:00.000Z'
    }
  ],
  profiles: [
    {
      id: 'player-1',
      name: 'Alex',
      membershipStartDate: '2026-01-01',
      membershipExpirationDate: '2099-01-01',
      totalTimePlayedHours: 55,
      commonlyPlaysWithProfileIds: ['player-2'],
      usualCompanions: ['Casey'],
      preferredGameIds: ['nlh-1-2'],
      preferredStakes: '1/2'
    }
  ],
  settings: {
    clubAccount: {
      clubName: 'The Lucky Lodge',
      email: 'floor@luckylodge.test',
      phone: '555-0100',
      address: '100 Main'
    },
    pilotAccess: {
      licenseId: 'lucky-lodge'
    },
    staffAccounts: [
      { id: 'admin-1', active: true },
      { id: 'admin-2', active: false }
    ]
  }
};

describe('player sync snapshots', () => {
  it('builds a player-facing club snapshot from management state', () => {
    const snapshot = buildPlayerClubSnapshot(state, { id: 'player-1', name: 'Alex', email: 'alex@example.com' });

    expect(snapshot.club).toMatchObject({ id: 'lucky-lodge', name: 'The Lucky Lodge' });
    expect(snapshot.games[0]).toMatchObject({
      id: 'nlh-1-2',
      availableSeats: 2,
      waitlistCount: 0,
      formingCount: 0,
      knownPlayersCount: 1
    });
    expect(snapshot.games[0].openTables).toHaveLength(1);
    expect(snapshot.games[0].openTables[0].social).toMatchObject({
      seatedPlayerCount: 2,
      adminCount: 1,
      knownPlayersCount: 1
    });
    expect(snapshot.games[1]).toMatchObject({ availableSeats: 0, formingCount: 1 });
    expect(snapshot.games[1].openTables[0]).toMatchObject({ status: 'Forming', availableSeats: 4 });
    expect(snapshot.waitlists).toEqual([]);
    expect(snapshot.memberships[0]).not.toHaveProperty('loyalty');
    expect(snapshot.social).toMatchObject({
      activePlayerCount: 2,
      adminCount: 1,
      knownPlayersInHouse: 1,
      waitlistCount: 0
    });
    expect(snapshot.timeAccess).toEqual({
      enabled: true,
      linked: true,
      profileId: 'player-1',
      savedMinutes: 0
    });
    expect(Object.keys(snapshot).sort()).toEqual([
      'club',
      'games',
      'generatedAt',
      'memberships',
      'notifications',
      'social',
      'timeAccess',
      'waitlists'
    ]);
    expect(snapshot).not.toHaveProperty('syncProtocolVersion');
    expect(snapshot).not.toHaveProperty('syncRevision');
  });

  it('derives a stable club id without publishing a synthetic loyalty product', () => {
    expect(getClubIdFromState(state)).toBe('lucky-lodge');
    expect(buildPlayerClubSnapshot(state).memberships.every((membership) => !('loyalty' in membership))).toBe(true);
  });

  it('does not treat an unrelated same-name session as a familiar player', () => {
    const snapshot = buildPlayerClubSnapshot({
      ...state,
      profiles: [{
        ...state.profiles[0], commonlyPlaysWithProfileIds: [], usualCompanions: ['Same Name']
      }],
      playerSessions: [{
        id: 'same-name-seat', playerName: 'Same Name', profileId: 'unrelated-profile',
        gameId: 'nlh-1-2', tableId: 'table-1'
      }]
    }, { id: 'player-1', name: 'Alex', email: 'alex@example.com' });
    expect(snapshot.games[0].openTables[0].social.knownPlayersCount).toBe(0);
    expect(snapshot.social.knownPlayersInHouse).toBe(0);
  });

  it('creates portable player action requests for club ingestion', () => {
    const player = {
      id: 'player-1',
      name: 'Alex',
      email: 'alex@example.com',
      preferredGameIds: ['nlh-1-2']
    };
    const join = createMembershipRequest(player, 'lucky-lodge', '2026-05-20T12:00:00.000Z');
    const wait = createWaitlistRequest(player, 'lucky-lodge', 'nlh-1-2', {
      requestedAt: '2026-05-20T12:01:00.000Z'
    });

    expect(join).toMatchObject({ type: 'membership-request', clubId: 'lucky-lodge', player });
    expect(wait).toMatchObject({ type: 'waitlist-request', gameId: 'nlh-1-2' });
    expect(wait).not.toHaveProperty('note');
    expect(join.id).toMatch(/^join_[0-9a-f-]{36}$/i);
    expect(wait.id).toMatch(/^wait_[0-9a-f-]{36}$/i);
    expect(`${join.id}:${wait.id}`).not.toContain('alex');
    expect(`${join.id}:${wait.id}`).not.toContain('lucky-lodge');
  });

  it('carries a Core-defined membership plan while deferring its duration until activation', () => {
    const player = { id: 'player-plan', name: 'Sam', email: 'sam@example.com', preferredGameIds: ['nlh-1-2'] };
    const plan = { id: 'weekend', name: 'Weekend Pass', priceLabel: '$25', durationDays: 3, active: true };
    const request = createMembershipRequest(player, 'lucky-lodge', '2026-05-20T12:00:00.000Z', plan);
    const joined = applyMembershipRequestToClubState(state, request);

    expect(request).toMatchObject({ planId: 'weekend', planName: 'Weekend Pass', planPriceLabel: '$25', membershipDurationDays: 3 });
    expect(joined.profiles.find((profile) => profile.id === player.id)).toMatchObject({
      membershipDurationDays: 3,
      membershipPlanName: 'Weekend Pass',
      membershipExpirationDate: '',
      membershipPaymentStatus: 'Pending',
      membershipStatus: 'Requested',
      preferredGameId: '',
      notes: 'Player app membership request received'
    });
    const published = buildPlayerClubSnapshot(joined, player).memberships[0];
    expect(published).toMatchObject({ planName: 'Weekend Pass', membershipDurationDays: 3 });
    expect(published).not.toHaveProperty('joinedAt');
  });

  it('applies player membership and waitlist requests to club-side state', () => {
    const player = {
      id: 'player-2',
      name: 'Morgan',
      email: 'morgan@example.com',
      phone: '555-0122',
      preferredGameIds: ['plo-1-2'],
      preferredStakes: '1/2',
      typicalAvailability: 'Fridays'
    };
    const join = createMembershipRequest(player, 'lucky-lodge', '2026-05-20T12:00:00.000Z');
    const joined = applyMembershipRequestToClubState(state, join);

    expect(joined.profiles.find((profile) => profile.id === 'player-2')).toMatchObject({
      name: 'Morgan',
      membershipStartDate: '',
      membershipExpirationDate: '',
      membershipPaymentStatus: 'Pending',
      membershipStatus: 'Requested',
      preferredGameIds: ['plo-1-2'],
      notes: 'Player app membership request received'
    });

    const wait = createWaitlistRequest(player, 'lucky-lodge', 'plo-1-2', {
      requestedAt: '2026-05-20T12:05:00.000Z'
    });
    const waiting = applyWaitlistRequestToClubState(joined, wait);

    expect(waiting.interests.at(-1)).toMatchObject({
      id: wait.id,
      profileId: 'player-2',
      playerName: 'Morgan',
      gameId: 'plo-1-2',
      status: 'Interested',
      notes: 'Interested'
    });
  });

  it('creates a non-member Core profile when a new Player app user requests a game', () => {
    const request = createWaitlistRequest(
      { id: 'player-new', name: 'Jamie', email: 'jamie@example.com', phone: '555-0199' },
      'lucky-lodge',
      'nlh-1-2',
      { requestedAt: '2026-05-20T12:10:00.000Z' }
    );
    const next = applyWaitlistRequestToClubState(state, request);

    expect(next.profiles.find((profile) => profile.id === 'player-new')).toMatchObject({
      name: 'Jamie',
      phone: '555-0199',
      membershipStartDate: '',
      membershipExpirationDate: '',
      preferredGameIds: ['nlh-1-2'],
      notes: 'Player app game request received'
    });
    expect(next.interests.at(-1)).toMatchObject({
      profileId: 'player-new',
      playerName: 'Jamie',
      gameId: 'nlh-1-2',
      status: 'Interested'
    });
  });

  it('publishes seated status without counting the player as still waiting', () => {
    const snapshot = buildPlayerClubSnapshot({
      ...state,
      interests: [
        ...state.interests,
        {
          id: 'interest-seated',
          profileId: 'player-seated',
          playerName: 'Casey',
          gameId: 'nlh-1-2',
          status: 'Seated' as const,
          interestedAt: '2026-05-20T12:20:00.000Z'
        }
      ]
    });

    expect(snapshot.waitlists.find((entry) => entry.id === 'interest-seated')).toMatchObject({ status: 'Seated', position: 0 });
    expect(snapshot.games.find((game) => game.id === 'nlh-1-2')?.waitlistCount).toBe(2);
    expect(snapshot.social.waitlistCount).toBe(2);
  });

  it('publishes configured collection mode even when no table is open', () => {
    const snapshot = buildPlayerClubSnapshot({
      ...state,
      sessions: state.sessions.filter((session) => session.gameId !== 'plo-1-2'),
      settings: {
        ...state.settings,
        collectionProfiles: [{ gameId: 'plo-1-2', collectionMode: 'Time' as const }]
      }
    });

    expect(snapshot.games.find((game) => game.id === 'plo-1-2')).toMatchObject({
      collectionMode: 'Time',
      openTables: []
    });
  });

  it('cancels an active Player app request and removes it from the published waitlist', () => {
    const player = { id: 'player-cancel', name: 'Avery', email: 'avery@example.com' };
    const joined = applyWaitlistRequestToClubState(
      state,
      createWaitlistRequest(player, 'lucky-lodge', 'plo-1-2', { requestedAt: '2026-05-20T13:00:00.000Z' })
    );
    const cancelled = applyWaitlistRequestToClubState(
      joined,
      createWaitlistRequest(player, 'lucky-lodge', 'plo-1-2', {
        action: 'cancel',
        requestedAt: '2026-05-20T13:05:00.000Z'
      })
    );

    expect(cancelled.interests.find((interest) => interest.playerName === 'Avery')).toMatchObject({
      status: 'Removed'
    });
    expect(buildPlayerClubSnapshot(cancelled).waitlists.some((entry) => entry.playerName === 'Avery')).toBe(false);
  });

  it('merges Firebase player profile membership records into club profiles', () => {
    const next = applyPlayerProfileDocumentToClubState(state, {
      id: 'player-5',
      uid: 'player-5',
      name: 'Taylor',
      email: 'taylor@example.com',
      preferredGameIds: ['plo-1-2'],
      preferredStakes: '1/2 PLO',
      clubMemberships: {
        'lucky-lodge': {
          clubId: 'lucky-lodge',
          status: 'Active',
          requestedAt: '2026-05-21T12:00:00.000Z',
          joinedAt: '2026-05-21',
          expiresAt: '2027-05-21',
          preferredGameIds: ['plo-1-2'],
          preferredStakes: '1/2 PLO'
        }
      }
    });

    expect(next.profiles.find((profile) => profile.id === 'player-5')).toMatchObject({
      name: 'Taylor',
      membershipStartDate: '2026-05-21',
      membershipExpirationDate: '2027-05-21',
      preferredGameIds: ['plo-1-2'],
      preferredStakes: '1/2 PLO',
      notes: 'Player profile synchronized'
    });
  });

  it.each(['Requested', 'Approved', 'Active', 'Expired'] as const)(
    'preserves a narrowed %s membership when updating an existing profile',
    (status) => {
      const next = applyPlayerProfileDocumentToClubState(state, {
        id: 'player-1',
        uid: 'player-1',
        name: 'Alex',
        email: 'alex@example.com',
        preferredGameIds: ['plo-1-2'],
        clubMemberships: {
          'lucky-lodge': {
            clubId: 'lucky-lodge',
            status,
            requestedAt: '2026-05-21T12:00:00.000Z',
            joinedAt: '2026-05-21',
            expiresAt: '2027-05-21',
            plan: 'monthly',
            paymentMethod: 'in-person'
          }
        }
      });

      expect(next.profiles[0]).toMatchObject({
        id: 'player-1',
        membershipStatus: status,
        membershipStartDate: '2026-01-01',
        membershipExpirationDate: status === 'Active' ? '2027-05-21' : '2099-01-01',
        membershipExpiresAt: status === 'Active' ? '2027-05-21' : undefined,
        membershipPlan: 'monthly',
        membershipPaymentMethod: 'in-person'
      });
      expect(state.profiles[0]).not.toHaveProperty('membershipStatus');
    }
  );

  it.each(['Requested', 'Approved', 'Active', 'Expired'] as const)(
    'creates a new profile for a narrowed %s membership',
    (status) => {
      const next = applyPlayerProfileDocumentToClubState(
        { ...state, profiles: [] },
        {
          id: `player-${status.toLowerCase()}`,
          uid: `player-${status.toLowerCase()}`,
          name: `${status} Player`,
          email: `${status.toLowerCase()}@example.com`,
          preferredGameIds: ['plo-1-2'],
          clubMemberships: {
            'lucky-lodge': {
              clubId: 'lucky-lodge',
              status,
              requestedAt: '2026-05-21T12:00:00.000Z',
              joinedAt: '2026-05-21',
              expiresAt: '2027-05-21',
              plan: 'monthly',
              paymentMethod: 'app'
            }
          }
        }
      );

      expect(next.profiles).toHaveLength(1);
      expect(next.profiles[0]).toMatchObject({
        membershipStatus: status,
        membershipStartDate: '2026-05-21',
        membershipExpirationDate: '2027-05-21',
        membershipExpiresAt: status === 'Active' ? '2027-05-21' : undefined,
        membershipPlan: 'monthly',
        membershipPaymentMethod: 'app'
      });
    }
  );

  it('ignores a denied membership without mutating or cloning management state', () => {
    const next = applyPlayerProfileDocumentToClubState(state, {
      id: 'player-denied',
      uid: 'player-denied',
      name: 'Denied Player',
      email: 'denied@example.com',
      preferredGameIds: ['nlh-1-2'],
      clubMemberships: {
        'lucky-lodge': {
          clubId: 'lucky-lodge',
          status: 'Denied',
          requestedAt: '2026-05-21T12:00:00.000Z'
        }
      }
    });

    expect(next).toBe(state);
    expect(next.profiles.some((profile) => profile.id === 'player-denied')).toBe(false);
  });

  it('syncs arrived, confirmed arrival time, and offered-game availability into Core interests', () => {
    const confirmedPlayer = { id: 'player-confirmed', name: 'Chris', email: 'chris@example.com' };
    const confirmed = applyWaitlistRequestToClubState(
      state,
      createWaitlistRequest(confirmedPlayer, 'lucky-lodge', 'nlh-1-2', {
        tableId: 'table-1',
        attendance: 'confirmed',
        expectedArrivalTime: '7:30 PM',
        requestedAt: '2026-05-20T18:00:00.000Z'
      })
    );
    expect(confirmed.interests.at(-1)).toMatchObject({
      status: 'Confirmed Coming',
      expectedArrivalTime: '7:30 PM',
      tableId: 'table-1'
    });

    const interestedPlayer = { id: 'player-range', name: 'Sky', email: 'sky@example.com' };
    const interested = applyWaitlistRequestToClubState(
      confirmed,
      createWaitlistRequest(interestedPlayer, 'lucky-lodge', 'plo-1-2', {
        attendance: 'interested',
        availabilityStartTime: '6 PM',
        availabilityEndTime: '10 PM',
        requestedAt: '2026-05-20T18:05:00.000Z'
      })
    );
    expect(interested.interests.at(-1)).toMatchObject({
      status: 'Interested',
      availabilityStartTime: '6 PM',
      availabilityEndTime: '10 PM'
    });
  });

  it('keeps app checkout and in-person passes pending until authoritative payment', () => {
    const dayPlayer = { id: 'player-day', name: 'Day Player', email: 'day@example.com', preferredGameIds: [] };
    const paid = applyMembershipRequestToClubState(
      state,
      createMembershipRequest(dayPlayer, 'lucky-lodge', '2026-05-20T12:00:00.000Z', {
        plan: 'day',
        paymentMethod: 'app',
        priceLabel: '$20'
      })
    );
    expect(paid.profiles.find((profile) => profile.id === 'player-day')).toMatchObject({
      membershipPlan: 'day',
      membershipStatus: 'Requested',
      membershipPaymentStatus: 'Pending'
    });
    expect(paid.profiles.find((profile) => profile.id === 'player-day')?.membershipExpiresAt).toBeUndefined();

    const walkInPlayer = { id: 'player-walkin', name: 'Walk In', email: 'walkin@example.com', preferredGameIds: [] };
    const pending = applyMembershipRequestToClubState(
      state,
      createMembershipRequest(walkInPlayer, 'lucky-lodge', '2026-05-20T12:00:00.000Z', {
        plan: 'monthly',
        paymentMethod: 'in-person',
        priceLabel: '$80'
      })
    );
    expect(pending.profiles.find((profile) => profile.id === 'player-walkin')).toMatchObject({
      membershipPlan: 'monthly',
      membershipStatus: 'Requested',
      membershipPaymentStatus: 'Pending',
      membershipExpirationDate: ''
    });
    expect(buildPlayerClubSnapshot(pending).memberships.find((membership) => membership.playerId === 'player-walkin')).toMatchObject({
      status: 'Requested',
      paymentMethod: 'in-person',
      paymentStatus: 'Pending'
    });
  });

  it('uses stable player IDs instead of same-name fallback for membership and waitlist ownership', () => {
    const sameNamePlayer = { id: 'player-same-name', name: 'Alex', email: 'other-alex@example.com', preferredGameIds: [] };
    const joined = applyMembershipRequestToClubState(
      state,
      createMembershipRequest(sameNamePlayer, 'lucky-lodge', '2026-05-20T12:00:00.000Z', {
        paymentMethod: 'in-person',
        priceLabel: '$40'
      })
    );

    expect(joined.profiles.find((profile) => profile.id === 'player-1')?.membershipExpirationDate).toBe('2099-01-01');
    expect(joined.profiles.find((profile) => profile.id === sameNamePlayer.id)).toMatchObject({
      name: 'Alex',
      membershipStatus: 'Requested'
    });
    expect(buildPlayerClubSnapshot(joined, sameNamePlayer).memberships.map((membership) => membership.playerId)).toEqual([
      sameNamePlayer.id
    ]);

    const withOwnedInterest = {
      ...joined,
      interests: [
        ...joined.interests,
        {
          id: 'owned-interest',
          profileId: sameNamePlayer.id,
          playerName: 'Alex',
          gameId: 'nlh-1-2',
          status: 'Interested' as const,
          interestedAt: '2026-05-20T12:05:00.000Z'
        }
      ]
    };
    const cancelled = applyWaitlistRequestToClubState(
      withOwnedInterest,
      createWaitlistRequest(sameNamePlayer, 'lucky-lodge', 'nlh-1-2', {
        action: 'cancel',
        requestedAt: '2026-05-20T12:10:00.000Z'
      })
    );
    expect(cancelled.interests.find((interest) => interest.id === 'interest-1')?.status).toBe('Interested');
    expect(cancelled.interests.find((interest) => interest.id === 'owned-interest')?.status).toBe('Removed');
  });

  it('preserves authoritative payment and an active window when a membership request arrives later', () => {
    const paidProfile = {
      ...state.profiles[0],
      id: 'player-paid-first',
      name: 'Paid First',
      membershipStatus: 'Approved' as const,
      membershipPaymentStatus: 'Paid' as const,
      membershipPaymentTransactionId: 'checkout-paid-first',
      membershipPaymentAmountCents: 4000,
      identityReviewStatus: 'Pending' as const,
      membershipStartDate: '',
      membershipExpirationDate: ''
    };
    const activeProfile = {
      ...paidProfile,
      id: 'player-active-renewal',
      name: 'Active Renewal',
      membershipStatus: 'Active' as const,
      identityReviewStatus: 'Approved' as const,
      membershipPaymentTransactionId: 'checkout-active',
      membershipStartDate: '2026-01-01',
      membershipExpirationDate: '2099-01-01',
      membershipExpiresAt: '2099-01-01T23:59:59.999Z'
    };
    const source = { ...state, profiles: [...state.profiles, paidProfile, activeProfile] };

    const paidFirst = applyMembershipRequestToClubState(
      source,
      createMembershipRequest(
        { id: paidProfile.id, name: paidProfile.name, email: 'paid@example.com', preferredGameIds: [] },
        'lucky-lodge',
        '2026-05-20T12:00:00.000Z',
        { paymentMethod: 'app', priceLabel: '$40' }
      )
    );
    expect(paidFirst.profiles.find((profile) => profile.id === paidProfile.id)).toMatchObject({
      membershipStatus: 'Requested',
      membershipPaymentStatus: 'Paid',
      membershipPaymentTransactionId: 'checkout-paid-first',
      membershipPaymentAmountCents: 4000
    });

    const activeRenewal = applyMembershipRequestToClubState(
      source,
      createMembershipRequest(
        { id: activeProfile.id, name: activeProfile.name, email: 'active@example.com', preferredGameIds: [] },
        'lucky-lodge',
        '2026-05-20T12:00:00.000Z',
        { paymentMethod: 'in-person', priceLabel: '$40' }
      )
    );
    expect(activeRenewal.profiles.find((profile) => profile.id === activeProfile.id)).toMatchObject({
      membershipStatus: 'Active',
      membershipStartDate: '2026-01-01',
      membershipExpirationDate: '2099-01-01',
      membershipExpiresAt: '2099-01-01T23:59:59.999Z',
      membershipPaymentStatus: 'Paid',
      membershipPaymentTransactionId: 'checkout-active'
    });
  });

  it('publishes approval separately from activation for front-desk handoff', () => {
    const approvedState = {
      ...state,
      profiles: [
        ...state.profiles,
        {
          id: 'player-approved',
          name: 'Approved Player',
          membershipStartDate: '',
          membershipExpirationDate: '',
          membershipPlan: 'monthly' as const,
          membershipPaymentMethod: 'in-person' as const,
          membershipStatus: 'Approved' as const,
          membershipRequestedAt: '2026-05-20T12:00:00.000Z',
          totalTimePlayedHours: 0,
          commonlyPlaysWithProfileIds: [],
          usualCompanions: [],
          preferredGameIds: ['nlh-1-2'],
          preferredStakes: '1/2'
        }
      ]
    };

    expect(buildPlayerClubSnapshot(approvedState).memberships.find((membership) => membership.playerId === 'player-approved')).toMatchObject({
      status: 'Approved',
      paymentMethod: 'in-person',
      expiresAt: undefined
    });
  });

  it('publishes active membership options and preserves an optional player selection', () => {
    const stateWithPlans = {
      ...state,
      settings: {
        ...state.settings,
        membershipPlans: [
          { id: 'weekday', name: 'Weekday Access', priceLabel: '$35/mo', durationDays: 30, description: 'Monday through Thursday', active: true },
          { id: 'hidden', name: 'Legacy Plan', priceLabel: '$10', durationDays: 1, active: false }
        ]
      }
    };
    expect(buildPlayerClubSnapshot(stateWithPlans).club.membershipOptions).toEqual([
      { id: 'weekday', name: 'Weekday Access', priceLabel: '$35/mo', durationDays: 30, description: 'Monday through Thursday' }
    ]);

    const request = createMembershipRequest(
      { id: 'player-plan', name: 'Plan Player', email: 'plan@example.com', preferredGameIds: [] },
      'lucky-lodge',
      '2026-05-20T12:00:00.000Z',
      {
        id: 'weekday',
        name: 'Weekday Access',
        priceLabel: '$35/mo',
        durationDays: 30,
        paymentMethod: 'in-person'
      }
    );
    expect(request).toMatchObject({
      planId: 'weekday',
      planName: 'Weekday Access',
      planPriceLabel: '$35/mo',
      membershipDurationDays: 30
    });
  });

  it('refuses incoherent attendance/table combinations at the shared state boundary', () => {
    const player = { id: 'player-intent', name: 'Intent Player', email: 'intent@example.com' };
    const base = createWaitlistRequest(player, 'lucky-lodge', 'nlh-1-2', {
      requestedAt: '2026-05-20T18:00:00.000Z'
    });
    expect(applyWaitlistRequestToClubState(state, { ...base, attendance: 'arrived', tableId: undefined })).toBe(state);
    expect(applyWaitlistRequestToClubState(state, { ...base, attendance: 'interested', tableId: 'table-1' })).toBe(state);
    expect(applyWaitlistRequestToClubState(state, { ...base, attendance: 'confirmed', tableId: 'table-1' }).interests.at(-1)).toMatchObject({
      status: 'Confirmed Coming', tableId: 'table-1'
    });
  });

  it('publishes no membership option from an unactivated legacy plan', () => {
    const legacyState = {
      ...state,
      settings: {
        ...state.settings,
        membershipPlans: [{
          id: 'legacy-plan',
          name: 'Legacy inferred plan',
          priceLabel: '$40',
          durationDays: 30
        }]
      }
    };

    expect(buildPlayerClubSnapshot(legacyState).club.membershipOptions).toEqual([]);
  });
});
