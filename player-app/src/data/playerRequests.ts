import type {
  PlayerAccount,
  PlayerClubSnapshot,
  PlayerMembershipRequest,
  PlayerMembershipOption,
  PlayerWaitlistRequest
} from '../domain/playerSync';
import {
  createMembershipRequest,
  createWaitlistRequest,
  getPlayerLoyalty
} from '../domain/playerSync';

export function applyMembershipRequest(snapshot: PlayerClubSnapshot, request: PlayerMembershipRequest): PlayerClubSnapshot {
  if (snapshot.club.id !== request.clubId) return snapshot;
  const requestedAt = new Date(request.requestedAt);
  const expiresAt = new Date(requestedAt);
  expiresAt.setDate(expiresAt.getDate() + (request.plan === 'day' ? 1 : 30));
  const pending = request.paymentMethod === 'in-person';
  return {
    ...snapshot,
    memberships: [
      ...snapshot.memberships.filter((membership) => membership.playerId !== request.player.id),
      {
        id: `${request.clubId}:${request.player.id}`,
        clubId: request.clubId,
        playerId: request.player.id,
        playerName: request.player.name,
        status: pending ? 'Requested' : 'Active',
        joinedAt: request.requestedAt.slice(0, 10),
        expiresAt: pending ? undefined : expiresAt.toISOString(),
        plan: request.plan,
        paymentMethod: request.paymentMethod,
        requestedAt: request.requestedAt,
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
  if (request.action === 'cancel') {
    const cancelled = snapshot.waitlists.filter(
      (entry) =>
        entry.gameId === request.gameId &&
        ['Interested', 'Confirmed Coming', 'Arrived'].includes(entry.status) &&
        (entry.playerId === request.player.id || entry.playerName.toLowerCase() === request.player.name.toLowerCase())
    );
    if (!cancelled.length) return snapshot;
    const cancelledIds = new Set(cancelled.map((entry) => entry.id));
    const positions = new Map<string, number>();
    const waitlists = snapshot.waitlists
      .filter((entry) => !cancelledIds.has(entry.id))
      .map((entry) => {
        const position = (positions.get(entry.gameId) ?? 0) + 1;
        positions.set(entry.gameId, position);
        return { ...entry, position };
      });
    return {
      ...snapshot,
      games: snapshot.games.map((game) =>
        game.id === request.gameId ? { ...game, waitlistCount: Math.max(0, game.waitlistCount - cancelled.length) } : game
      ),
      social: {
        ...(snapshot.social ?? { activePlayerCount: 0, adminCount: 0, knownPlayersInHouse: 0, waitlistCount: snapshot.waitlists.length }),
        waitlistCount: Math.max(0, (snapshot.social?.waitlistCount ?? snapshot.waitlists.length) - cancelled.length)
      },
      waitlists,
      generatedAt: request.requestedAt
    };
  }

  if (snapshot.waitlists.some((entry) => entry.playerId === request.player.id && entry.gameId === request.gameId)) return snapshot;
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
        status: request.attendance === 'arrived' ? 'Arrived' : request.attendance === 'confirmed' ? 'Confirmed Coming' : 'Interested',
        position,
        requestedAt: request.requestedAt
      }
    ],
    notifications: snapshot.notifications ?? [],
    generatedAt: request.requestedAt
  };
}

export function buildJoinRequest(
  player: PlayerAccount,
  clubId: string,
  plan: 'day' | 'monthly' = 'monthly',
  paymentMethod: 'app' | 'in-person' = 'app',
  priceLabel?: string,
  membershipOption?: PlayerMembershipOption
) {
  return createMembershipRequest(player, clubId, undefined, {
    plan,
    paymentMethod,
    priceLabel: membershipOption?.priceLabel ?? priceLabel,
    planId: membershipOption?.id,
    planName: membershipOption?.name,
    membershipDurationDays: membershipOption?.durationDays
  });
}

export function buildWaitRequest(
  player: PlayerAccount,
  clubId: string,
  gameId: string,
  tableId?: string,
  action: 'join' | 'cancel' = 'join',
  attendance?: 'arrived' | 'confirmed' | 'interested',
  expectedArrivalTime?: string,
  availabilityStartTime?: string,
  availabilityEndTime?: string
) {
  return createWaitlistRequest(player, clubId, gameId, {
    action,
    tableId,
    attendance,
    expectedArrivalTime,
    availabilityStartTime,
    availabilityEndTime,
    note: player.typicalAvailability
  });
}
