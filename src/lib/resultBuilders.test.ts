import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  getBalancePlans,
  getTodayPlayerActivity,
  parseGroupMeMessages,
  type GroupMeCandidateResult,
  type TodayPlayerRowResult
} from './resultBuilders';

type InterestStatus =
  | 'Interested'
  | 'Confirmed Coming'
  | 'Arrived'
  | 'Seated'
  | 'Declined'
  | 'No-Show'
  | 'Left Before Seated'
  | 'Removed';

type BalanceGame = { id: string; name: string; maxSeats: number };
type BalanceInterest = { id: string; playerName: string; gameId: string; status: InterestStatus };
type BalanceProfile = {
  id: string;
  name: string;
  preferredGameIds: string[];
  preferredStakes: string;
  typicalBuyInMin: number;
  typicalBuyInMax: number;
  willingnessToMove: boolean;
  usualCompanions: string[];
};
type BalanceSession = {
  id: string;
  gameId: string;
  status: 'Running' | 'Closed';
  seatsFilled: number;
  maxSeats: number;
};
type BalanceDemand = {
  confirmed: number;
  waiting: number;
  interested: number;
  totalDemand: number;
};
type BalanceState = {
  games: BalanceGame[];
  interests: BalanceInterest[];
  profiles: BalanceProfile[];
  sessions: BalanceSession[];
  demandByGame: Record<string, BalanceDemand>;
};

const noDemand: BalanceDemand = { confirmed: 0, waiting: 0, interested: 0, totalDemand: 0 };

const balanceOperations = {
  getDemand: (game: BalanceGame, _interests: BalanceInterest[]) => noDemand,
  getRunningSessions: (state: BalanceState, gameId: string) =>
    state.sessions.filter((session) => session.gameId === gameId && session.status === 'Running'),
  getProfileForInterest: (interest: BalanceInterest, profiles: BalanceProfile[]) =>
    profiles.find((profile) => profile.id === interest.id) ??
    profiles.find((profile) => profile.name.toLowerCase() === interest.playerName.toLowerCase())
};

const getBalanceOperations = (state: BalanceState) => ({
  ...balanceOperations,
  getDemand: (game: BalanceGame, _interests: BalanceInterest[]) => state.demandByGame[game.id] ?? noDemand
});

describe('balance plan result narrowing', () => {
  it('returns an empty result for empty input', () => {
    const state: BalanceState = { games: [], interests: [], profiles: [], sessions: [], demandByGame: {} };

    expect(getBalancePlans(state, getBalanceOperations(state))).toEqual([]);
  });

  it('rejects games without a qualifying table, enough demand, or a move candidate', () => {
    const games: BalanceGame[] = [
      { id: 'no-table', name: 'No Table', maxSeats: 9 },
      { id: 'low-demand', name: 'Low Demand', maxSeats: 9 },
      { id: 'no-candidate', name: 'No Candidate', maxSeats: 9 }
    ];
    const state: BalanceState = {
      games,
      interests: [],
      profiles: [],
      sessions: [
        { id: 'low-demand-table', gameId: 'low-demand', status: 'Running', seatsFilled: 9, maxSeats: 9 },
        { id: 'no-candidate-table', gameId: 'no-candidate', status: 'Running', seatsFilled: 9, maxSeats: 9 }
      ],
      demandByGame: {
        'no-table': { confirmed: 4, waiting: 0, interested: 0, totalDemand: 14 },
        'low-demand': { confirmed: 4, waiting: 0, interested: 0, totalDemand: 12 },
        'no-candidate': { confirmed: 4, waiting: 0, interested: 0, totalDemand: 14 }
      }
    };

    expect(getBalancePlans(state, getBalanceOperations(state))).toEqual([]);
  });

  it('preserves game order, candidate ranking, projections, and an absent optional profile', () => {
    const games: BalanceGame[] = [
      { id: 'game-a', name: '1/2 NLH', maxSeats: 9 },
      { id: 'game-b', name: 'PLO', maxSeats: 9 }
    ];
    const state: BalanceState = {
      games,
      interests: [
        { id: 'profile-high', playerName: 'High', gameId: 'game-a', status: 'Arrived' },
        { id: 'missing-profile', playerName: 'Low', gameId: 'game-a', status: 'Arrived' },
        { id: 'friend', playerName: 'Friend', gameId: 'game-a', status: 'Interested' },
        { id: 'game-b-player', playerName: 'Second Game', gameId: 'game-b', status: 'Arrived' }
      ],
      profiles: [
        {
          id: 'profile-high',
          name: 'High',
          preferredGameIds: ['game-a'],
          preferredStakes: '1/2 NLH',
          typicalBuyInMin: 100,
          typicalBuyInMax: 200,
          willingnessToMove: true,
          usualCompanions: ['Friend']
        }
      ],
      sessions: [
        { id: 'table-a', gameId: 'game-a', status: 'Running', seatsFilled: 9, maxSeats: 9 },
        { id: 'table-b', gameId: 'game-b', status: 'Running', seatsFilled: 8, maxSeats: 9 }
      ],
      demandByGame: {
        'game-a': { confirmed: 3, waiting: 1, interested: 0, totalDemand: 14 },
        'game-b': { confirmed: 3, waiting: 1, interested: 0, totalDemand: 14 }
      }
    };

    const plans = getBalancePlans(state, getBalanceOperations(state));

    expect(plans.map((plan) => plan.game.id)).toEqual(['game-a', 'game-b']);
    expect(plans[0].moveCandidates.map((candidate) => candidate.playerName)).toEqual(['High', 'Low']);
    expect(plans[0].moveCandidates[1].profile).toBeUndefined();
    expect(plans[0]).toMatchObject({
      tableASeatsAfterMove: 7,
      tableBProjectedSeats: 6,
      nextStep: '1/2 NLH: move High, Low to seed Table B'
    });
    expectTypeOf(plans[0].moveCandidates[0].interest).toEqualTypeOf<BalanceInterest>();
  });
});

const groupMeGames = [
  { id: 'nlh-1-2', name: '1/2 NLH' },
  { id: 'nlh-2-5', name: '2/5 NLH' },
  { id: 'plo', name: 'PLO' }
];

const deterministicGenerators = () => {
  let nextId = 0;
  return {
    createId: () => `candidate-${++nextId}`,
    getTimestamp: () => '2026-08-06T12:00:00.000Z'
  };
};

describe('GroupMe candidate result narrowing', () => {
  it('returns an empty result for blank input', () => {
    expect(parseGroupMeMessages(' \n\r\n ', groupMeGames, deterministicGenerators())).toEqual([]);
  });

  it('rejects non-game lines without consuming output positions', () => {
    const candidates = parseGroupMeMessages(
      'ignore this chess message\nAlice: coming for 1 / 2\nalso ignore this',
      groupMeGames,
      deterministicGenerators()
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe('candidate-1');
    expect(candidates[0].playerName).toBe('Alice');
  });

  it('preserves accepted-line order, alias matching, statuses, and fallback names', () => {
    const candidates = parseGroupMeMessages(
      "Alice: coming for 1 / 2\nBob- here for PLO\nCara 2-5",
      groupMeGames,
      deterministicGenerators()
    );

    expectTypeOf(candidates).toEqualTypeOf<GroupMeCandidateResult[]>();
    expect(candidates).toEqual([
      {
        id: 'candidate-1',
        playerName: 'Alice',
        gameId: 'nlh-1-2',
        status: 'Confirmed Coming',
        timestamp: '2026-08-06T12:00:00.000Z',
        confidence: 82,
        sourceText: 'Alice: coming for 1 / 2'
      },
      {
        id: 'candidate-2',
        playerName: 'Bob',
        gameId: 'plo',
        status: 'Arrived',
        timestamp: '2026-08-06T12:00:00.000Z',
        confidence: 82,
        sourceText: 'Bob- here for PLO'
      },
      {
        id: 'candidate-3',
        playerName: 'Cara',
        gameId: 'nlh-2-5',
        status: 'Interested',
        timestamp: '2026-08-06T12:00:00.000Z',
        confidence: 62,
        sourceText: 'Cara 2-5'
      }
    ]);
  });
});

type ActivityInterest = {
  id: string;
  profileId?: string;
  playerName: string;
  gameId: string;
  status: InterestStatus;
  timestamp: string;
  interestedAt: string;
  confirmedAt?: string;
  arrivedAt?: string;
  seatedAt?: string;
  closedAt?: string;
};
type ActivityProfile = {
  id: string;
  name: string;
  membershipStatus?: string;
  membershipExpiresAt?: string;
  membershipExpirationDate: string;
};
type ActivityPlayerSession = {
  id: string;
  playerName: string;
  profileId?: string;
  gameId: string;
  tableId: string;
  seatNumber?: number;
  seatedAt: string;
  leftAt?: string;
};
type ActivityState = {
  interests: ActivityInterest[];
  profiles: ActivityProfile[];
  playerSessions: ActivityPlayerSession[];
  games: { id: string; name: string }[];
  sessions: { id: string; label: string }[];
};

const activityOptions = {
  currentDate: new Date('2026-08-06T12:00:00.000Z'),
  toLocalDateValue: (date: Date) => date.toISOString().slice(0, 10),
  isFutureDate: (value?: string) => value === 'future'
};

const emptyActivityState = (): ActivityState => ({
  interests: [],
  profiles: [],
  playerSessions: [],
  games: [{ id: 'game-1', name: '1/2 NLH' }],
  sessions: [{ id: 'table-1', label: 'Table 1' }]
});

describe('today player activity result narrowing', () => {
  it('returns an empty result for empty input', () => {
    expect(getTodayPlayerActivity(emptyActivityState(), activityOptions)).toEqual([]);
  });

  it('rejects prior-day and invalid interest timestamps plus ended sessions', () => {
    const state = emptyActivityState();
    state.interests = [
      {
        id: 'prior-day',
        playerName: 'Prior',
        gameId: 'game-1',
        status: 'Interested',
        timestamp: '2026-08-05T12:00:00.000Z',
        interestedAt: '2026-08-05T12:00:00.000Z'
      },
      {
        id: 'invalid',
        playerName: 'Invalid',
        gameId: 'game-1',
        status: 'Interested',
        timestamp: 'invalid',
        interestedAt: 'invalid'
      }
    ];
    state.playerSessions = [
      {
        id: 'ended',
        playerName: 'Ended',
        gameId: 'game-1',
        tableId: 'table-1',
        seatedAt: '2026-08-06T10:00:00.000Z',
        leftAt: '2026-08-06T11:00:00.000Z'
      }
    ];

    expect(getTodayPlayerActivity(state, activityOptions)).toEqual([]);
  });

  it('preserves timestamp fallbacks, status ordering, session deduplication, and optional fields', () => {
    const state = emptyActivityState();
    state.profiles = [
      {
        id: 'member',
        name: 'Member',
        membershipStatus: 'Active',
        membershipExpiresAt: 'future',
        membershipExpirationDate: 'past'
      }
    ];
    state.interests = [
      {
        id: 'interested',
        playerName: 'No Profile',
        gameId: 'game-1',
        status: 'Interested',
        timestamp: '2026-08-06T08:00:00.000Z',
        interestedAt: '2026-08-06T13:00:00.000Z'
      },
      {
        id: 'confirmed',
        profileId: 'member',
        playerName: 'Member',
        gameId: 'game-1',
        status: 'Confirmed Coming',
        timestamp: '2026-08-06T08:00:00.000Z',
        interestedAt: '2026-08-06T07:00:00.000Z',
        confirmedAt: '2026-08-06T11:00:00.000Z'
      },
      {
        id: 'declined',
        playerName: 'Declined',
        gameId: 'missing-game',
        status: 'Declined',
        timestamp: '2026-08-05T08:00:00.000Z',
        interestedAt: '2026-08-05T07:00:00.000Z',
        closedAt: '2026-08-06T12:00:00.000Z'
      }
    ];
    state.playerSessions = [
      {
        id: 'member-session',
        profileId: 'member',
        playerName: 'Member',
        gameId: 'game-1',
        tableId: 'table-1',
        seatNumber: 4,
        seatedAt: '2026-08-06T14:00:00.000Z'
      },
      {
        id: 'session-only',
        profileId: 'session-profile',
        playerName: 'Session Only',
        gameId: 'missing-game',
        tableId: 'missing-table',
        seatedAt: '2026-08-06T15:00:00.000Z'
      }
    ];

    const rows = getTodayPlayerActivity(state, activityOptions);

    expectTypeOf(rows).toEqualTypeOf<TodayPlayerRowResult[]>();
    expect(rows.map((row) => row.id)).toEqual([
      'session-session-only',
      'interest-confirmed',
      'interest-interested',
      'interest-declined'
    ]);
    expect(rows.find((row) => row.id === 'interest-confirmed')).toMatchObject({
      timestamp: '2026-08-06T11:00:00.000Z',
      activeMember: true
    });
    expect(rows.find((row) => row.id === 'interest-interested')).toEqual({
      id: 'interest-interested',
      playerName: 'No Profile',
      profileId: undefined,
      status: 'Interested',
      gameName: '1/2 NLH',
      tableLabel: undefined,
      seatNumber: undefined,
      timestamp: '2026-08-06T13:00:00.000Z',
      activeMember: false
    });
    expect(rows.find((row) => row.id === 'session-session-only')).toMatchObject({
      gameName: 'Unknown game',
      tableLabel: undefined,
      seatNumber: undefined
    });
  });
});
