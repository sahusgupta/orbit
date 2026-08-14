import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyMembershipRequestToClubState,
  applyWaitlistRequestToClubState,
  buildPlayerClubSnapshot as buildRendererSnapshot,
  getClubIdFromState,
  type ManagementClubState,
  type PlayerClubSnapshot,
  type PlayerMembershipRequest,
  type PlayerWaitlistRequest
} from './playerSync';

type RuntimeSyncCore = {
  applyMembershipRequestToState: (state: unknown, request: unknown) => unknown;
  applyWaitlistRequestToState: (state: unknown, request: unknown) => unknown;
  buildPlayerClubSnapshot: (state: unknown, player?: unknown) => unknown;
  getAccountKeyFromState: (state: unknown) => string;
};

const require = createRequire(import.meta.url);
const apiCore = require('../../apps/api/src/orbitCore.js') as RuntimeSyncCore;
const sharedCoreModule = require('../../apps/api/src/shared/orbitCore.cjs') as RuntimeSyncCore & {
  createOrbitCore: (options: {
    profile: 'electron';
    validateState: false;
    createId: () => string;
  }) => RuntimeSyncCore;
};
const electronRuntimeUtils = require('../../electron/runtimeUtils.cjs') as {
  getAccountKeyFromState: (state: unknown) => string;
};
const electronMainSource = readFileSync(new URL('../../electron/main.cjs', import.meta.url), 'utf8');
const rootPackage = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  build: { files: string[] };
};

function loadElectronSyncCore(randomUUID = vi.fn(() => 'electron-generated-id')): RuntimeSyncCore {
  return sharedCoreModule.createOrbitCore({
    profile: 'electron',
    validateState: false,
    createId: randomUUID
  });
}

function buildState(overrides: Partial<ManagementClubState> = {}): ManagementClubState {
  return {
    games: [{ id: 'game-holdem', name: '1/2 NLH', maxSeats: 9 }],
    sessions: [{
      id: 'table-one',
      gameId: 'game-holdem',
      label: 'Table 1',
      status: 'Running',
      seatsFilled: 2,
      maxSeats: 9,
      collectionMode: 'Time',
      tags: ['main'],
      startedAt: '2027-01-01T00:00:00.000Z'
    }],
    playerSessions: [{
      id: 'player-session-alex',
      playerName: 'Alex',
      profileId: 'player-alex',
      gameId: 'game-holdem',
      tableId: 'table-one'
    }],
    interests: [{
      id: 'interest-other',
      profileId: 'player-other',
      playerName: 'Other',
      gameId: 'game-holdem',
      status: 'Interested',
      interestedAt: '2027-01-01T00:00:00.000Z',
      notes: 'Existing interest'
    }],
    profiles: [{
      id: 'player-alex',
      name: 'Alex',
      phone: '+15550101',
      membershipStartDate: '2027-01-01',
      membershipExpirationDate: '2028-01-01',
      membershipExpiresAt: '2028-01-01T23:59:59.999Z',
      membershipPlan: 'monthly',
      membershipPaymentMethod: 'app',
      membershipStatus: 'Active',
      membershipRequestedAt: '2027-01-01T00:00:00.000Z',
      totalTimePlayedHours: 20,
      lastSessionTimePlayedHours: 4,
      commonlyPlaysWithProfileIds: ['player-other'],
      preferredGameId: 'game-holdem',
      preferredGameIds: ['game-holdem'],
      preferredStakes: '1/2',
      typicalBuyInMin: 100,
      typicalBuyInMax: 300,
      willingnessToMove: true,
      typicalAvailability: 'Evenings',
      preferredTags: ['holdem'],
      usualCompanions: ['Other'],
      notes: 'Existing note'
    }],
    inAppNotifications: [{
      id: 'notification-alex',
      clubId: 'license-one',
      gameId: 'game-holdem',
      title: 'Seat open',
      body: 'A seat is open.',
      reason: 'seat-opened',
      createdAt: '2027-01-01T00:00:00.000Z',
      targetPlayerIds: ['player-alex'],
      targetPlayerNames: ['Alex']
    }],
    settings: {
      defaultCollectionMode: 'Drop',
      collectionProfiles: [{ gameId: 'game-holdem', collectionMode: 'Time' }],
      clubAccount: {
        clubName: 'Orbit Club',
        email: 'club@example.test',
        phone: '+15550999',
        address: '100 Test Way'
      },
      pilotAccess: { licenseId: 'license-one' },
      staffAccounts: [{ id: 'staff-one', active: true }],
      membershipPlans: [{
        id: 'monthly',
        name: 'Monthly',
        priceLabel: '$35',
        durationDays: 30,
        description: 'Monthly access',
        active: true
      }]
    },
    ...overrides
  };
}

function membershipRequest(overrides: Partial<PlayerMembershipRequest> = {}): PlayerMembershipRequest {
  return {
    id: 'membership-request-one',
    type: 'membership-request',
    clubId: 'license-one',
    player: {
      id: 'player-alex',
      name: 'Alex',
      email: 'alex@example.test',
      phone: '+15550102',
      preferredGameIds: ['game-holdem'],
      preferredStakes: '2/5',
      typicalAvailability: 'Weekends'
    },
    plan: 'monthly',
    paymentMethod: 'app',
    priceLabel: '$35',
    planId: 'monthly',
    planName: 'Monthly',
    membershipDurationDays: 30,
    requestedAt: '2027-02-01T12:00:00.000Z',
    ...overrides
  };
}

function waitlistRequest(overrides: Partial<PlayerWaitlistRequest> = {}): PlayerWaitlistRequest {
  return {
    id: 'waitlist-request-one',
    type: 'waitlist-request',
    clubId: 'license-one',
    player: {
      id: 'player-new',
      name: 'New Player',
      email: 'new@example.test',
      phone: '+15550103'
    },
    gameId: 'game-holdem',
    action: 'join',
    attendance: 'confirmed',
    expectedArrivalTime: '19:30',
    availabilityStartTime: '19:00',
    availabilityEndTime: '22:00',
    tableId: 'table-one',
    note: 'Window seat if possible',
    requestedAt: '2027-02-01T12:05:00.000Z',
    ...overrides
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2027-02-01T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('API and Electron player-sync boundary', () => {
  it('wires the shared core through the exact Electron compatibility profile and package allowlist', () => {
    expect(apiCore.buildPlayerClubSnapshot).toBe(sharedCoreModule.buildPlayerClubSnapshot);
    expect(electronMainSource).toContain("require('../apps/api/src/shared/orbitCore.cjs')");
    expect(electronMainSource).toContain("profile: 'electron'");
    expect(electronMainSource).toContain('validateState: false');
    expect(electronMainSource).toContain('createId: () => crypto.randomUUID()');
    expect(electronMainSource).not.toMatch(/function (buildPlayerClubSnapshot|applyMembershipRequestToState|applyWaitlistRequestToState)\(/);
    expect(rootPackage.build.files).toEqual(expect.arrayContaining([
      'apps/api/package.json',
      'apps/api/src/http/dataProtection.js',
      'apps/api/src/operations/dataProtection.js',
      'apps/api/src/shared/orbitCore.cjs'
    ]));
  });

  it('produces identical complete snapshots for their shared canonical case', () => {
    const state = buildState();
    const before = structuredClone(state);
    const player = { id: 'player-alex', name: 'Alex', email: 'alex@example.test' };
    const electron = loadElectronSyncCore();

    const apiSnapshot = apiCore.buildPlayerClubSnapshot(state, player);
    const electronSnapshot = electron.buildPlayerClubSnapshot(state, player);

    expect(electronSnapshot).toEqual(apiSnapshot);
    expect(apiSnapshot).toMatchObject({
      club: { id: 'license-one', name: 'Orbit Club' },
      memberships: [{ playerId: 'player-alex', status: 'Active' }],
      social: { activePlayerCount: 1, adminCount: 1, knownPlayersInHouse: 0, waitlistCount: 1 },
      generatedAt: '2027-02-01T12:00:00.000Z'
    });
    expect(state).toEqual(before);
  });

  it('applies ordinary membership and waitlist requests identically with stable ordering and inputs', () => {
    const state = buildState();
    const membership = membershipRequest();
    const waitlist = waitlistRequest();
    const before = structuredClone({ state, membership, waitlist });
    const electron = loadElectronSyncCore();

    const apiMembershipState = apiCore.applyMembershipRequestToState(state, membership);
    const electronMembershipState = electron.applyMembershipRequestToState(state, membership);
    const apiWaitlistState = apiCore.applyWaitlistRequestToState(state, waitlist);
    const electronWaitlistState = electron.applyWaitlistRequestToState(state, waitlist);

    expect(electronMembershipState).toEqual(apiMembershipState);
    expect(electronWaitlistState).toEqual(apiWaitlistState);
    expect(apiMembershipState).toMatchObject({
      profiles: [{
        id: 'player-alex',
        membershipStatus: 'Active',
        membershipExpirationDate: '2027-03-03',
        membershipExpiresAt: '2027-03-03T12:00:00.000Z'
      }]
    });
    expect(apiWaitlistState).toMatchObject({
      interests: [
        { id: 'interest-other' },
        { id: 'waitlist-request-one', profileId: 'player-new', status: 'Confirmed Coming', tableId: 'table-one' }
      ]
    });
    expect({ state, membership, waitlist }).toEqual(before);
  });

  it('keeps API validation separate from the permissive Electron transform boundary', () => {
    const stateWithoutPlayerSessions = buildState();
    delete stateWithoutPlayerSessions.playerSessions;
    const electron = loadElectronSyncCore();

    expect(() => apiCore.buildPlayerClubSnapshot(stateWithoutPlayerSessions)).toThrow(
      'State payload is missing player sessions.'
    );
    expect(() => electron.buildPlayerClubSnapshot(stateWithoutPlayerSessions)).not.toThrow();
  });

  it('preserves API request-ID and Electron random-ID fallbacks outside normal validated routes', () => {
    const state = buildState({ profiles: [], interests: [] });
    const randomUUID = vi.fn()
      .mockReturnValueOnce('electron-membership-id')
      .mockReturnValueOnce('electron-waitlist-id');
    const electron = loadElectronSyncCore(randomUUID);
    const membership = membershipRequest({
      id: 'membership-fallback-id',
      player: { ...membershipRequest().player, id: '' }
    });
    const waitlist = waitlistRequest({
      id: ''
    });

    const apiMembership = apiCore.applyMembershipRequestToState(state, membership) as ManagementClubState;
    const electronMembership = electron.applyMembershipRequestToState(state, membership) as ManagementClubState;
    const apiWaitlist = apiCore.applyWaitlistRequestToState(state, waitlist) as ManagementClubState;
    const electronWaitlist = electron.applyWaitlistRequestToState(state, waitlist) as ManagementClubState;

    expect(apiMembership.profiles[0].id).toBe('membership-fallback-id');
    expect(electronMembership.profiles[0].id).toBe('electron-membership-id');
    expect(apiWaitlist.interests[0].id).toBe('');
    expect(electronWaitlist.interests[0].id).toBe('electron-waitlist-id');
    expect(randomUUID).toHaveBeenCalledTimes(2);
  });

  it('pins the Electron legacy membership projection that differs from the API', () => {
    const state = buildState({
      profiles: [{
        ...buildState().profiles[0],
        membershipStartDate: '',
        membershipExpirationDate: '',
        membershipExpiresAt: undefined,
        membershipStatus: 'Approved',
        membershipRequestedAt: '2027-01-15T10:00:00.000Z'
      }]
    });
    const electron = loadElectronSyncCore();
    const apiSnapshot = apiCore.buildPlayerClubSnapshot(state) as PlayerClubSnapshot;
    const electronSnapshot = electron.buildPlayerClubSnapshot(state) as PlayerClubSnapshot;

    expect(apiSnapshot.memberships[0]).toMatchObject({
      status: 'Approved',
      joinedAt: '2027-01-15'
    });
    expect(apiSnapshot.memberships[0]).toHaveProperty('expiresAt', undefined);
    expect(electronSnapshot.memberships[0]).toMatchObject({
      status: 'Expired',
      joinedAt: '2027-02-01'
    });
    expect(electronSnapshot.memberships[0]).toHaveProperty('expiresAt', '');
  });
});

describe('intentional renderer/server sync ownership differences', () => {
  it('preserves distinct renderer and server account-key precedence', () => {
    const state = buildState({
      settings: {
        ...buildState().settings,
        clubAccount: { clubName: 'Orbit Club', email: 'club@example.test' },
        pilotAccess: { authorizationCode: 'TT-PILOT-AUTHORITY' }
      }
    });

    expect(getClubIdFromState(state)).toBe('club-example-test');
    expect(apiCore.getAccountKeyFromState(state)).toBe('tt-pilot-authority');
    expect(electronRuntimeUtils.getAccountKeyFromState(state)).toBe('tt-pilot-authority');
  });

  it('preserves renderer full-table attendance and note behavior instead of adopting server semantics', () => {
    const fullTableState = buildState({
      sessions: [{ ...buildState().sessions[0], seatsFilled: 9, maxSeats: 9 }],
      profiles: [],
      interests: []
    });
    const rendererRequest = waitlistRequest();
    const serverRequest = waitlistRequest();
    const rendererResult = applyWaitlistRequestToClubState(fullTableState, rendererRequest);
    const serverResult = apiCore.applyWaitlistRequestToState(fullTableState, serverRequest) as ManagementClubState;

    expect(rendererResult.interests[0]).toMatchObject({
      status: 'Confirmed Coming',
      tableId: 'table-one',
      notes: 'Confirmed coming at 19:30 for Table 1 | Window seat if possible'
    });
    expect(serverResult.interests[0]).toMatchObject({
      status: 'Confirmed Coming',
      tableId: 'table-one',
      notes: 'Confirmed coming at 19:30 | Window seat if possible'
    });

    const rendererUnspecified = applyWaitlistRequestToClubState(
      fullTableState,
      waitlistRequest({ attendance: undefined })
    );
    const serverUnspecified = apiCore.applyWaitlistRequestToState(
      fullTableState,
      waitlistRequest({ attendance: undefined })
    ) as ManagementClubState;
    expect(rendererUnspecified.interests[0].status).toBe('Interested');
    expect(serverUnspecified.interests[0].status).toBe('Arrived');
  });

  it('preserves renderer membership notes rather than replacing them with server notes', () => {
    const state = buildState();
    const request = membershipRequest();
    const renderer = applyMembershipRequestToClubState(state, request);
    const server = apiCore.applyMembershipRequestToState(state, request) as ManagementClubState;

    expect(renderer.profiles[0].notes).toContain('Player app: alex@example.test');
    expect(renderer.profiles[0].notes).toContain('Monthly - paid in app ($35)');
    expect(server.profiles[0].notes).toContain('Player app: monthly pass paid in app (alex@example.test)');
    expect(server.profiles[0].notes).not.toContain('Monthly - paid in app ($35)');
  });

  it('keeps renderer snapshot behavior independently characterized', () => {
    const state = buildState();
    const snapshot = buildRendererSnapshot(state, { id: 'player-alex', name: 'Alex', email: 'alex@example.test' });
    expect(snapshot.club.id).toBe('license-one');
    expect(snapshot.memberships).toHaveLength(1);
    expect(snapshot.games[0].openTables[0].social).toEqual({
      seatedPlayerCount: 1,
      adminCount: 1,
      knownPlayersCount: 0
    });
  });
});
