import type { PlayerAccount, PlayerClubSnapshot, PlayerMembershipRequest, PlayerWaitlistRequest } from '../domain/playerSync';
import { createMembershipRequest, createWaitlistRequest, getPlayerLoyalty } from '../domain/playerSync';

export const demoPlayer: PlayerAccount = {
  id: 'player_alex',
  name: 'Alex Rivera',
  email: 'alex@example.com',
  phone: '555-0119',
  homeLocation: 'College Station, TX',
  searchRadiusMiles: 25,
  preferredGameIds: ['nlh-1-2', 'plo-1-2'],
  preferredStakes: '1/2 and 1/3',
  typicalAvailability: 'Weeknights after 7'
};

export const initialClubSnapshots: PlayerClubSnapshot[] = [
  {
    club: {
      id: 'lucky-lodge',
      name: 'The Lucky Lodge',
      address: '100 Main Street',
      phone: '555-0100'
    },
    games: [
      {
        id: 'nlh-1-2',
        name: '1/2 NLH',
        maxSeats: 10,
        availableSeats: 2,
        waitlistCount: 4,
        formingCount: 0,
        knownPlayersCount: 2,
        openTables: [
          {
            id: 'lodge-main',
            gameId: 'nlh-1-2',
            label: 'Main Table',
            status: 'Running',
            seatsFilled: 8,
            maxSeats: 10,
            availableSeats: 2,
            collectionMode: 'Drop',
            tags: ['Social', 'Beginner-Friendly'],
            startedAt: new Date(Date.now() - 1000 * 60 * 72).toISOString(),
            social: {
              seatedPlayerCount: 8,
              adminCount: 1,
              knownPlayersCount: 2
            }
          }
        ]
      },
      {
        id: 'plo-1-2',
        name: '1/2 PLO',
        maxSeats: 9,
        availableSeats: 4,
        waitlistCount: 2,
        formingCount: 1,
        knownPlayersCount: 1,
        openTables: [
          {
            id: 'lodge-plo-forming',
            gameId: 'plo-1-2',
            label: 'Interest Table',
            status: 'Forming',
            seatsFilled: 5,
            maxSeats: 9,
            availableSeats: 4,
            collectionMode: 'Time',
            tags: ['Action', 'Deep-Stacked'],
            startedAt: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
            social: {
              seatedPlayerCount: 5,
              adminCount: 1,
              knownPlayersCount: 1
            }
          }
        ]
      }
    ],
    memberships: [
      {
        id: 'lucky-lodge:player_alex',
        clubId: 'lucky-lodge',
        playerId: 'player_alex',
        playerName: 'Alex Rivera',
        status: 'Active',
        joinedAt: '2026-01-03',
        expiresAt: '2027-01-03',
        loyalty: getPlayerLoyalty('lucky-lodge', 56),
        preferredGameIds: ['nlh-1-2', 'plo-1-2'],
        preferredStakes: '1/2 and 1/3',
        clubNote: 'Weeknights after 7'
      }
    ],
    social: {
      activePlayerCount: 13,
      adminCount: 1,
      knownPlayersInHouse: 3,
      waitlistCount: 6
    },
    waitlists: [
      {
        id: 'wait-alex-plo',
        clubId: 'lucky-lodge',
        gameId: 'plo-1-2',
        playerId: 'player_alex',
        playerName: 'Alex Rivera',
        status: 'Interested',
        position: 2,
        requestedAt: new Date(Date.now() - 1000 * 60 * 14).toISOString()
      }
    ],
    notifications: [],
    generatedAt: new Date().toISOString()
  },
  {
    club: {
      id: 'river-room',
      name: 'River Room Social Club',
      address: '41 West Avenue',
      phone: '555-0198'
    },
    games: [
      {
        id: 'nlh-1-3',
        name: '1/3 NLH',
        maxSeats: 10,
        availableSeats: 0,
        waitlistCount: 6,
        formingCount: 0,
        knownPlayersCount: 0,
        openTables: [
          {
            id: 'river-main',
            gameId: 'nlh-1-3',
            label: 'Main Table',
            status: 'Running',
            seatsFilled: 10,
            maxSeats: 10,
            availableSeats: 0,
            collectionMode: 'Drop',
            tags: ['Competitive', 'Fast-moving'],
            startedAt: new Date(Date.now() - 1000 * 60 * 141).toISOString(),
            social: {
              seatedPlayerCount: 10,
              adminCount: 2,
              knownPlayersCount: 0
            }
          }
        ]
      }
    ],
    memberships: [],
    waitlists: [],
    notifications: [],
    social: {
      activePlayerCount: 10,
      adminCount: 2,
      knownPlayersInHouse: 0,
      waitlistCount: 6
    },
    generatedAt: new Date().toISOString()
  }
];

export function applyMembershipRequest(snapshot: PlayerClubSnapshot, request: PlayerMembershipRequest): PlayerClubSnapshot {
  if (snapshot.club.id !== request.clubId) return snapshot;
  const alreadyMember = snapshot.memberships.some((membership) => membership.playerId === request.player.id);
  if (alreadyMember) return snapshot;
  return {
    ...snapshot,
    memberships: [
      ...snapshot.memberships,
      {
        id: `${request.clubId}:${request.player.id}`,
        clubId: request.clubId,
        playerId: request.player.id,
        playerName: request.player.name,
        status: 'Requested',
        joinedAt: request.requestedAt.slice(0, 10),
        loyalty: getPlayerLoyalty(request.clubId, 0),
        preferredGameIds: request.player.preferredGameIds,
        preferredStakes: request.player.preferredStakes,
        clubNote: request.player.typicalAvailability
      }
    ],
    notifications: snapshot.notifications ?? [],
    generatedAt: request.requestedAt
  };
}

export function applyWaitlistRequest(snapshot: PlayerClubSnapshot, request: PlayerWaitlistRequest): PlayerClubSnapshot {
  if (snapshot.club.id !== request.clubId) return snapshot;
  const existing = snapshot.waitlists.find((entry) => entry.playerId === request.player.id && entry.gameId === request.gameId);
  if (existing) return snapshot;
  const position = snapshot.waitlists.filter((entry) => entry.gameId === request.gameId).length + 1;
  return {
    ...snapshot,
    games: snapshot.games.map((game) =>
      game.id === request.gameId ? { ...game, waitlistCount: game.waitlistCount + 1 } : game
    ),
    social: {
      ...(snapshot.social ?? { activePlayerCount: 0, adminCount: 0, knownPlayersInHouse: 0, waitlistCount: snapshot.waitlists.length }),
      waitlistCount: (snapshot.social?.waitlistCount ?? snapshot.waitlists.length) + 1
    },
    waitlists: [
      ...snapshot.waitlists,
      {
        id: request.id,
        clubId: request.clubId,
        gameId: request.gameId,
        tableId: request.tableId,
        playerId: request.player.id,
        playerName: request.player.name,
        status: 'Interested',
        position,
        requestedAt: request.requestedAt
      }
    ],
    notifications: snapshot.notifications ?? [],
    generatedAt: request.requestedAt
  };
}

export function buildJoinRequest(player: PlayerAccount, clubId: string) {
  return createMembershipRequest(player, clubId);
}

export function buildWaitRequest(player: PlayerAccount, clubId: string, gameId: string, tableId?: string) {
  return createWaitlistRequest(player, clubId, gameId, { tableId, note: player.typicalAvailability });
}
