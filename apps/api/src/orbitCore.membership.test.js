import { describe, expect, it } from 'vitest';
import orbitCore from './orbitCore.js';

const { applyMembershipPaymentToState, applyMembershipRequestToState, applyWaitlistRequestToState, buildPlayerClubSnapshot } = orbitCore;

function state() {
  return {
    games: [{ id: 'holdem', name: 'Holdem', maxSeats: 9 }],
    sessions: [],
    playerSessions: [],
    profiles: [],
    interests: [],
    revenueTransactions: [],
    inAppNotifications: [],
    settings: {
      pilotAccess: { licenseId: 'club-1' },
      clubAccount: { clubName: 'Club One', minimumPlayerAge: 21 },
      staffAccounts: [],
      membershipPlans: []
    }
  };
}

function request(overrides = {}) {
  return {
    id: 'request-1',
    clubId: 'club-1',
    paymentMethod: 'in-person',
    priceLabel: '$35',
    membershipPaymentRequired: true,
    requestedAt: '2026-08-27T12:00:00.000Z',
    player: {
      id: 'player-1',
      name: 'Untrusted Name',
      email: 'alex@example.test',
      preferredGameIds: ['holdem']
    },
    identitySummary: {
      fullName: 'Alex Rivera',
      dateOfBirth: '1990-01-02',
      address: '100 Main St',
      captureMethod: 'player-camera-pdf417',
      capturedAt: '2026-08-27T11:59:00.000Z',
      ageLevel: 21
    },
    ...overrides
  };
}

describe('authoritative player membership application', () => {
  it('links a staff-created profile only by immutable orbitPlayerId and exposes its active Core time session', () => {
    const current = state();
    current.settings.defaultCollectionMode = 'Time';
    current.settings.defaultHourlyFee = 10;
    current.profiles = [{
      id: 'core-player', orbitPlayerId: 'firebase-player', name: 'Alex', email: 'alex@example.test', savedTimeCreditMinutes: 30
    }];
    current.sessions = [{
      id: 'table-1', gameId: 'holdem', label: 'Main Table', status: 'Running', seatsFilled: 1, maxSeats: 9,
      collectionMode: 'Time', startedAt: '2026-08-27T12:00:00.000Z'
    }];
    current.playerSessions = [{
      id: 'session-1', profileId: 'core-player', playerName: 'Alex', gameId: 'holdem', tableId: 'table-1',
      timePurchasedMinutes: 60, timeRemainingMinutes: 45, timeFeeEnabled: false
    }];

    const snapshot = buildPlayerClubSnapshot(current, {
      id: 'firebase-player', name: 'Alex', email: 'alex@example.test'
    });

    expect(snapshot.timeAccess).toMatchObject({
      enabled: true,
      linked: true,
      profileId: 'core-player',
      hourlyFeeCents: 1000,
      savedMinutes: 30,
      activeSession: { id: 'session-1', tableLabel: 'Main Table', remainingMinutes: 45 }
    });
  });

  it('adds paid time to the linked active Core session and records revenue once', () => {
    const current = state();
    current.profiles = [{ id: 'core-player', name: 'Alex', savedTimeCreditMinutes: 0 }];
    current.sessions = [{ id: 'table-1', gameId: 'holdem', collectionMode: 'Time', status: 'Running' }];
    current.playerSessions = [{
      id: 'session-1', profileId: 'core-player', playerName: 'Alex', gameId: 'holdem', tableId: 'table-1',
      timePurchasedMinutes: 60, timeRemainingMinutes: 15, timeFeeEnabled: false
    }];
    const payment = {
      clubId: 'club-1', transactionId: 'cs-time', playerId: 'core-player', playerName: 'Alex',
      product: 'time-5', timeMinutes: 300, amountCents: 5000, occurredAt: '2026-08-27T13:00:00.000Z'
    };

    const paid = applyMembershipPaymentToState(current, payment);
    const duplicate = applyMembershipPaymentToState(paid, payment);

    expect(paid.playerSessions[0]).toMatchObject({
      timePurchasedMinutes: 360,
      timeRemainingMinutes: 315,
      timeFeeEnabled: true,
      lastTimeTickAt: '2026-08-27T13:00:00.000Z'
    });
    expect(paid.revenueTransactions).toEqual([expect.objectContaining({ id: 'cs-time', type: 'time-package' })]);
    expect(duplicate).toBe(paid);
  });

  it('saves paid time on the linked profile if the player leaves before checkout completes', () => {
    const current = state();
    current.profiles = [{ id: 'core-player', name: 'Alex', savedTimeCreditMinutes: 20 }];
    const paid = applyMembershipPaymentToState(current, {
      clubId: 'club-1', transactionId: 'cs-time-saved', playerId: 'core-player', playerName: 'Alex',
      product: 'time-5', timeMinutes: 300, amountCents: 5000, occurredAt: '2026-08-27T13:00:00.000Z'
    });
    expect(paid.profiles[0].savedTimeCreditMinutes).toBe(320);
  });

  it('creates a request-only profile with independent pending ID and payment review', () => {
    const next = applyMembershipRequestToState(state(), request({
      planId: 'weekly-access', planName: 'Weekly Access', membershipDurationDays: 7
    }));
    expect(next.profiles[0]).toMatchObject({
      id: 'player-1',
      name: 'Alex Rivera',
      birthday: '1990-01-02',
      address: '100 Main St',
      identityCaptureMethod: 'player-camera-pdf417',
      identityReviewStatus: 'Pending',
      membershipStatus: 'Requested',
      membershipPaymentStatus: 'Pending',
      membershipPlanId: 'weekly-access',
      membershipPlanName: 'Weekly Access',
      membershipDurationDays: 7,
      preferredGameId: '',
      notes: 'Player app membership request received',
      orbitPlayerId: 'player-1'
    });
    const membership = buildPlayerClubSnapshot(next, { id: 'player-1', name: 'Alex Rivera' }).memberships[0];
    expect(membership).toMatchObject({
      status: 'Requested',
      paymentStatus: 'Pending',
      identityReviewStatus: 'Pending',
      planName: 'Weekly Access',
      membershipDurationDays: 7,
      playerId: 'player-1'
    });
    expect(membership).not.toHaveProperty('joinedAt');
    expect(next.profiles[0]).not.toHaveProperty('membershipPlan');
    expect(JSON.stringify(next.profiles[0].notes)).not.toMatch(/alex@example|payment pending/i);
    expect(membership).not.toHaveProperty('birthday');
    expect(membership).not.toHaveProperty('address');
  });

  it('publishes linked legacy private records under the Firebase UID only', () => {
    const current = state();
    current.profiles = [{
      id: 'legacy-profile', orbitPlayerId: 'firebase-uid', name: 'Member', membershipStatus: 'Active',
      membershipStartDate: '2026-01-01', membershipExpiresAt: '2099-01-01T00:00:00.000Z'
    }];
    current.interests = [{
      id: 'wait-one', profileId: 'legacy-profile', playerName: 'Member', gameId: 'holdem',
      status: 'Interested', timestamp: '2026-09-04T00:00:00.000Z', interestedAt: '2026-09-04T00:00:00.000Z'
    }];
    current.inAppNotifications = [{
      id: 'notice-one', targetPlayerIds: ['legacy-profile'], targetPlayerNames: ['Member'],
      title: 'Seat ready', body: 'Your seat is ready', createdAt: '2026-09-04T00:00:00.000Z'
    }];
    const snapshot = buildPlayerClubSnapshot(current, { id: 'firebase-uid', name: 'Member' });
    expect(snapshot.memberships.map((membership) => membership.playerId)).toEqual(['firebase-uid']);
    expect(snapshot.waitlists.map((waitlist) => waitlist.playerId)).toEqual(['firebase-uid']);
    expect(snapshot.notifications[0].targetPlayerIds).toEqual(['firebase-uid']);
    expect(JSON.stringify(snapshot)).not.toContain('"playerId":"legacy-profile"');
  });

  it('marks a zero-price membership as not requiring payment', () => {
    const next = applyMembershipRequestToState(state(), request({ priceLabel: '$99', membershipPaymentRequired: false }));
    expect(next.profiles[0].membershipPaymentStatus).toBe('Not required');
  });

  it('does not merge a different authenticated UID that has the same legal name', () => {
    const initial = applyMembershipRequestToState(state(), request());
    const next = applyMembershipRequestToState(initial, request({
      id: 'request-2',
      player: { ...request().player, id: 'player-2' }
    }));
    expect(next.profiles.map((profile) => profile.id)).toEqual(['player-1', 'player-2']);
    expect(buildPlayerClubSnapshot(next, { id: 'player-2', name: 'Alex Rivera' }).memberships).toHaveLength(1);
  });

  it('matches linked waitlist requests by immutable UID without duplicating profiles or storing contact data in notes', () => {
    const current = state();
    current.profiles = [{
      id: 'legacy-profile', orbitPlayerId: 'firebase-uid', name: 'Authoritative Name',
      email: 'existing@example.test', phone: '+15550000000', notes: 'Staff note', identityReviewStatus: 'Approved'
    }];
    current.interests = [
      { id: 'owned', profileId: 'legacy-profile', playerName: 'Authoritative Name', gameId: 'holdem', status: 'Interested' },
      { id: 'same-name', profileId: 'other-profile', playerName: 'Authoritative Name', gameId: 'holdem', status: 'Interested' }
    ];
    const playerRequest = {
      id: 'opaque-request-id', type: 'waitlist-request', clubId: 'club-1', gameId: 'holdem',
      action: 'cancel', requestedAt: '2026-09-04T12:00:00.000Z',
      player: { id: 'firebase-uid', name: 'Client Supplied Name', email: 'new@example.test', phone: '+15551112222' }
    };
    const cancelled = applyWaitlistRequestToState(current, playerRequest);
    expect(cancelled.interests.find((interest) => interest.id === 'owned').status).toBe('Removed');
    expect(cancelled.interests.find((interest) => interest.id === 'same-name').status).toBe('Interested');

    const joined = applyWaitlistRequestToState({ ...current, interests: [] }, { ...playerRequest, action: 'join', attendance: 'interested' });
    expect(joined.profiles).toHaveLength(1);
    expect(joined.interests[0]).toMatchObject({ profileId: 'legacy-profile', playerName: 'Authoritative Name' });
    expect(joined.profiles[0].notes).toBe('Staff note | Player app game request received');
    expect(joined.profiles[0].notes).not.toMatch(/example\.test|15551112222/);
  });

  it('does not persist operational waitlist status without a matching Running table', () => {
    const current = state();
    current.sessions = [
      { id: 'running', gameId: 'holdem', status: 'Running', label: 'Running table' },
      { id: 'paused', gameId: 'holdem', status: 'Paused', label: 'Paused table' }
    ];
    const base = {
      id: 'opaque-request-id', type: 'waitlist-request', clubId: 'club-1', gameId: 'holdem', action: 'join',
      requestedAt: '2026-09-04T12:00:00.000Z', player: { id: 'player-1', name: 'Player' }
    };
    expect(applyWaitlistRequestToState(current, { ...base, attendance: 'arrived' })).toBe(current);
    expect(applyWaitlistRequestToState(current, { ...base, attendance: 'confirmed', tableId: 'paused' })).toBe(current);
    expect(applyWaitlistRequestToState(current, { ...base, attendance: 'interested', tableId: 'running' })).toBe(current);
    expect(applyWaitlistRequestToState(current, { ...base, attendance: 'arrived', tableId: 'running' }).interests.at(-1)).toMatchObject({
      status: 'Arrived', tableId: 'running'
    });
    const interested = applyWaitlistRequestToState(current, { ...base, attendance: 'interested' }).interests.at(-1);
    expect(interested).toMatchObject({ status: 'Interested' });
    expect(interested).not.toHaveProperty('tableId');
  });

  it('uses a stable UID exclusively for memberships, social context, and notifications', () => {
    const initial = applyMembershipRequestToState(state(), request());
    const next = applyMembershipRequestToState(initial, request({
      id: 'request-2',
      player: { ...request().player, id: 'player-2' }
    }));
    next.profiles[0] = {
      ...next.profiles[0],
      commonlyPlaysWithProfileIds: ['friend-1']
    };
    next.sessions = [{
      id: 'table-1', gameId: 'holdem', label: 'Table 1', status: 'Running', seatsFilled: 1, maxSeats: 9, startedAt: '2026-08-27T12:00:00.000Z'
    }];
    next.playerSessions = [{
      id: 'session-1', playerName: 'Friend', profileId: 'friend-1', gameId: 'holdem', tableId: 'table-1'
    }];
    next.inAppNotifications = [
      {
        id: 'wrong-player', clubId: 'club-1', gameId: '', title: 'Private', body: 'For player one',
        reason: 'membership-approved', createdAt: '2026-08-27T12:00:00.000Z',
        targetPlayerIds: ['player-1'], targetPlayerNames: ['Alex Rivera']
      },
      {
        id: 'right-player', clubId: 'club-1', gameId: '', title: 'Private', body: 'For player two',
        reason: 'membership-approved', createdAt: '2026-08-27T12:00:00.000Z',
        targetPlayerIds: ['player-2']
      },
      {
        id: 'shared-private', clubId: 'club-1', gameId: '', title: 'Shared', body: 'Leaks recipients',
        reason: 'legacy-shared', createdAt: '2026-08-27T12:00:00.000Z',
        targetPlayerIds: ['player-1', 'player-2'], targetPlayerNames: ['First Player', 'Second Player']
      }
    ];

    const snapshot = buildPlayerClubSnapshot(next, { id: 'player-2', name: 'Alex Rivera' });

    expect(snapshot.memberships.map((membership) => membership.playerId)).toEqual(['player-2']);
    expect(snapshot.games[0].openTables[0].social.knownPlayersCount).toBe(0);
    expect(snapshot.notifications.map((notification) => notification.id)).toEqual(['right-player']);
    expect(snapshot.notifications[0]).not.toHaveProperty('targetPlayerNames');
  });

  it('preserves an already approved physical identity on later player requests', () => {
    const initial = applyMembershipRequestToState(state(), request());
    initial.profiles[0] = {
      ...initial.profiles[0],
      name: 'Approved Name',
      birthday: '1989-02-03',
      address: 'Approved Address',
      identityReviewStatus: 'Approved'
    };
    const next = applyMembershipRequestToState(initial, request({
      id: 'request-2',
      identitySummary: {
        ...request().identitySummary,
        fullName: 'Replacement Name',
        dateOfBirth: '1999-09-09',
        address: 'Replacement Address'
      }
    }));
    expect(next.profiles[0]).toMatchObject({
      name: 'Approved Name',
      birthday: '1989-02-03',
      address: 'Approved Address',
      identityReviewStatus: 'Approved'
    });
  });

  it('records a Stripe payment once and waits for identity approval before activation', () => {
    const pending = applyMembershipRequestToState(state(), request({ paymentMethod: 'app' }));
    const payment = {
      clubId: 'club-1',
      transactionId: 'cs-1',
      playerId: 'player-1',
      playerName: 'Alex Rivera',
      playerEmail: 'alex@example.test',
      product: 'monthly',
      amountCents: 3500,
      occurredAt: '2026-08-27T12:00:00.000Z',
      stripeEventId: 'evt-1'
    };
    const paid = applyMembershipPaymentToState(pending, payment);
    const duplicate = applyMembershipPaymentToState(paid, payment);
    expect(paid.profiles[0]).toMatchObject({ membershipPaymentStatus: 'Paid', membershipStatus: 'Approved' });
    expect(paid.revenueTransactions).toHaveLength(1);
    expect(duplicate).toBe(paid);
  });

  it('preserves authoritative payment and a current active window against a later request', () => {
    const pending = applyMembershipRequestToState(state(), request({ paymentMethod: 'app' }));
    pending.profiles[0] = { ...pending.profiles[0], identityReviewStatus: 'Approved' };
    const paid = applyMembershipPaymentToState(pending, {
      clubId: 'club-1',
      transactionId: 'cs-active',
      playerId: 'player-1',
      playerName: 'Alex Rivera',
      playerEmail: 'alex@example.test',
      product: 'monthly',
      amountCents: 3500,
      occurredAt: '2026-08-27T12:00:00.000Z',
      stripeEventId: 'evt-active'
    });
    const activeProfile = paid.profiles[0];

    const next = applyMembershipRequestToState(paid, request({
      id: 'request-late',
      paymentMethod: 'in-person',
      requestedAt: '2026-08-28T12:00:00.000Z'
    }));

    expect(next.profiles[0]).toMatchObject({
      membershipStatus: 'Active',
      membershipStartDate: activeProfile.membershipStartDate,
      membershipExpirationDate: activeProfile.membershipExpirationDate,
      membershipExpiresAt: activeProfile.membershipExpiresAt,
      membershipPaymentStatus: 'Paid',
      membershipPaymentTransactionId: 'cs-active',
      membershipPaymentAmountCents: 3500
    });
    expect(next.revenueTransactions).toEqual(paid.revenueTransactions);
  });
});
