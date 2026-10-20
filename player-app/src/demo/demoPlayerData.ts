import type {
  PlayerAccount,
  PlayerClubSnapshot,
  PlayerSyncGame,
  PlayerSyncTable,
  PlayerTournament,
  PlayerTournamentInterest
} from '../domain/playerSync';

export type DemoPlayerData = {
  player: PlayerAccount;
  clubs: PlayerClubSnapshot[];
  tournaments: PlayerTournament[];
  tournamentInterests: PlayerTournamentInterest[];
};

const hourMs = 60 * 60 * 1000;
const dayMs = 24 * hourMs;

/** Local, fictional examples. Regenerate on entry so demo dates never go stale. */
export function createDemoPlayerData(nowMs = Date.now()): DemoPlayerData {
  const at = (offsetMs: number) => new Date(nowMs + offsetMs).toISOString();
  const player: PlayerAccount = {
    id: 'demo-player',
    name: 'Demo Player',
    email: 'demo@example.test',
    homeLocation: 'Austin, TX',
    searchRadiusMiles: 50,
    preferredGameIds: ['demo-austin-nlh-1-2', 'demo-chicago-plo-1-2'],
    favoriteClubIds: ['demo-austin', 'demo-chicago'],
    preferredStakes: '1/2',
    typicalAvailability: 'Demo evenings and weekends',
    adultDeclaredAt: at(0),
    adultDeclarationVersion: 'v1'
  };

  const makeGame = (
    id: string,
    name: string,
    status: PlayerSyncTable['status'],
    seatsFilled: number,
    waiting: number,
    collectionMode: 'Time' | 'Drop' = 'Time'
  ): PlayerSyncGame => ({
    id,
    name,
    maxSeats: 9,
    collectionMode,
    openTables: [{
      id: `${id}-table`,
      gameId: id,
      label: 'Demo Table 1',
      status,
      seatsFilled,
      maxSeats: 9,
      availableSeats: 9 - seatsFilled,
      collectionMode,
      tags: ['Fictional demo game'],
      startedAt: at(-2 * hourMs),
      social: { seatedPlayerCount: seatsFilled, adminCount: 1, knownPlayersCount: Math.min(2, seatsFilled) }
    }],
    waitlistCount: waiting,
    formingCount: status === 'Forming' ? 1 : 0,
    availableSeats: status === 'Running' ? 9 - seatsFilled : 0,
    knownPlayersCount: Math.min(2, seatsFilled),
    updatedAt: at(0)
  });

  const clubs: PlayerClubSnapshot[] = [
    {
      club: {
        id: 'demo-austin',
        name: 'Demo River Card House',
        address: 'Fictional demo location, Austin, TX',
        coordinate: { latitude: 30.2672, longitude: -97.7431 },
        venueKind: 'Card house',
        minimumAge: 21
      },
      games: [
        makeGame('demo-austin-nlh-1-2', '1/2 No Limit Holdem', 'Running', 6, 2),
        makeGame('demo-austin-plo-2-5', '2/5 Pot Limit Omaha', 'Forming', 3, 1)
      ],
      memberships: [],
      waitlists: [],
      notifications: [],
      generatedAt: at(0)
    },
    {
      club: {
        id: 'demo-chicago',
        name: 'Demo Lakeside Poker Club',
        address: 'Fictional demo location, Chicago, IL',
        coordinate: { latitude: 41.8781, longitude: -87.6298 },
        venueKind: 'Poker club',
        minimumAge: 21
      },
      games: [
        makeGame('demo-chicago-nlh-2-5', '2/5 No Limit Holdem', 'Running', 8, 4),
        makeGame('demo-chicago-plo-1-2', '1/2 Pot Limit Omaha', 'Forming', 4, 1)
      ],
      memberships: [],
      waitlists: [],
      notifications: [],
      generatedAt: at(0)
    },
    {
      club: {
        id: 'demo-denver',
        name: 'Demo Summit Card House',
        address: 'Fictional demo location, Denver, CO',
        coordinate: { latitude: 39.7392, longitude: -104.9903 },
        venueKind: 'Card house',
        minimumAge: 21
      },
      games: [
        makeGame('demo-denver-nlh-1-3', '1/3 No Limit Holdem', 'Running', 5, 0),
        makeGame('demo-denver-mixed-4-8', '4/8 Mixed Games', 'Paused', 4, 1)
      ],
      memberships: [],
      waitlists: [],
      notifications: [],
      generatedAt: at(0)
    },
    {
      club: {
        id: 'demo-las-vegas',
        name: 'Demo Desert Casino',
        address: 'Fictional demo location, Las Vegas, NV',
        coordinate: { latitude: 36.1699, longitude: -115.1398 },
        venueKind: 'Casino',
        minimumAge: 21
      },
      games: [
        makeGame('demo-las-vegas-nlh-5-10', '5/10 No Limit Holdem', 'Running', 7, 3, 'Drop'),
        makeGame('demo-las-vegas-limit-4-8', '4/8 Limit Holdem', 'Forming', 2, 0, 'Drop')
      ],
      memberships: [],
      waitlists: [],
      notifications: [],
      generatedAt: at(0)
    }
  ];

  clubs.forEach((club, index) => {
    club.club.membershipOptions = [{
      id: `${club.club.id}-monthly`,
      name: 'Demo monthly access',
      priceLabel: '$0 demo only',
      durationDays: 30,
      description: 'Fictional membership for exploring the demo.'
    }];
    club.social = {
      activePlayerCount: club.games.reduce((total, game) => total + game.openTables[0].seatsFilled, 0),
      adminCount: 2,
      knownPlayersInHouse: index < 2 ? 3 : 1,
      waitlistCount: club.games.reduce((total, game) => total + game.waitlistCount, 0)
    };
    if (index < 2) {
      club.memberships = [{
        id: `${club.club.id}-membership`,
        clubId: club.club.id,
        playerId: player.id,
        playerName: player.name,
        status: 'Active',
        joinedAt: at(-7 * dayMs),
        expiresAt: at(23 * dayMs),
        plan: 'monthly',
        planName: 'Demo monthly access',
        membershipDurationDays: 30,
        paymentStatus: 'Not required',
        identityReviewStatus: 'Not required',
        preferredGameIds: club.games.map((game) => game.id),
        preferredStakes: player.preferredStakes,
        clubNote: 'Fictional demo membership.',
        loyalty: {
          clubId: club.club.id,
          points: index === 0 ? 120 : 45,
          lifetimeHours: index === 0 ? 48 : 18,
          tier: index === 0 ? 'Preferred' : 'Regular',
          nextTierAtHours: index === 0 ? 100 : 40
        }
      }];
    }
  });

  clubs[0].waitlists = [{
    id: 'demo-austin-confirmed-request',
    clubId: clubs[0].club.id,
    gameId: clubs[0].games[0].id,
    playerId: player.id,
    playerName: player.name,
    status: 'Confirmed Coming',
    position: 2,
    requestedAt: at(-hourMs)
  }];

  const tournaments: PlayerTournament[] = clubs.map((club, index) => ({
    id: `${club.club.id}-event`,
    clubId: club.club.id,
    name: ['Demo Holdem Freeroll', 'Demo Omaha Evening', 'Demo Mixed Game Meetup', 'Demo Holdem Deep Stack'][index],
    startsAt: at((index + 2) * dayMs),
    interestOpensAt: at(-dayMs),
    interestClosesAt: at((index + 2) * dayMs - hourMs),
    interestStatus: 'open',
    buyIn: index === 0 ? 0 : 50 + index * 25,
    prizePoolLabel: 'Fictional demo prize pool',
    startingStack: 20_000 + index * 5_000,
    levelMinutes: 20,
    lateRegistrationThroughLevel: 4,
    rebuysAllowed: false,
    addOnsAllowed: false,
    rules: ['Fictional demo event; no real entry, payment, or prize.'],
    withdrawalAllowed: true,
    entrantCount: 12 + index * 4,
    totalRebuys: 0,
    totalAddOns: 0,
    featured: index === 0
  }));

  return {
    player,
    clubs,
    tournaments,
    tournamentInterests: [{
      id: 'demo-austin-event-interest',
      tournamentId: tournaments[0].id,
      clubId: tournaments[0].clubId,
      playerId: player.id,
      status: 'interested',
      createdAt: at(-hourMs),
      updatedAt: at(-hourMs)
    }]
  };
}
