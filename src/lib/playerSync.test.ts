import { describe, expect, it } from 'vitest';
import {
  applyMembershipRequestToClubState,
  applyPlayerProfileDocumentToClubState,
  applyWaitlistRequestToClubState,
  buildPlayerClubSnapshot,
  createMembershipRequest,
  createWaitlistRequest,
  getClubIdFromState,
  getPlayerLoyalty
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
      waitlistCount: 2,
      formingCount: 0,
      knownPlayersCount: 2
    });
    expect(snapshot.games[0].openTables).toHaveLength(1);
    expect(snapshot.games[0].openTables[0].social).toMatchObject({
      seatedPlayerCount: 2,
      adminCount: 1,
      knownPlayersCount: 2
    });
    expect(snapshot.games[1]).toMatchObject({ availableSeats: 4, formingCount: 1 });
    expect(snapshot.waitlists.map((entry) => entry.playerName)).toEqual(['Alex', 'Riley']);
    expect(snapshot.memberships[0].loyalty).toMatchObject({ tier: 'Preferred', points: 550, nextTierAtHours: 120 });
    expect(snapshot.social).toMatchObject({
      activePlayerCount: 2,
      adminCount: 1,
      knownPlayersInHouse: 2,
      waitlistCount: 2
    });
  });

  it('derives stable club ids and loyalty tiers', () => {
    expect(getClubIdFromState(state)).toBe('lucky-lodge');
    expect(getPlayerLoyalty('club-a', 0).tier).toBe('New');
    expect(getPlayerLoyalty('club-a', 12).tier).toBe('Regular');
    expect(getPlayerLoyalty('club-a', 50).tier).toBe('Preferred');
    expect(getPlayerLoyalty('club-a', 120).tier).toBe('Anchor');
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
      requestedAt: '2026-05-20T12:01:00.000Z',
      note: 'Can play short-handed'
    });

    expect(join).toMatchObject({ type: 'membership-request', clubId: 'lucky-lodge', player });
    expect(wait).toMatchObject({ type: 'waitlist-request', gameId: 'nlh-1-2', note: 'Can play short-handed' });
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
      membershipStartDate: '2026-05-20',
      membershipExpirationDate: '2027-05-20',
      preferredGameIds: ['plo-1-2'],
      notes: 'Player app: morgan@example.com, 555-0122'
    });

    const wait = createWaitlistRequest(player, 'lucky-lodge', 'plo-1-2', {
      requestedAt: '2026-05-20T12:05:00.000Z',
      note: 'Short-handed is fine'
    });
    const waiting = applyWaitlistRequestToClubState(joined, wait);

    expect(waiting.interests.at(-1)).toMatchObject({
      id: wait.id,
      profileId: 'player-2',
      playerName: 'Morgan',
      gameId: 'plo-1-2',
      status: 'Interested',
      notes: 'Waitlist requested from player app | Short-handed is fine'
    });
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
      notes: 'Player app: taylor@example.com'
    });
  });
});
