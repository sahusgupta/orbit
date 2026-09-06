import type {
  PlayerAccount,
  PlayerClubSnapshot,
  PlayerMembershipOption,
  PlayerWaitlistRequest
} from '../domain/playerSync';
import {
  createMembershipRequest,
  createWaitlistRequest
} from '../domain/playerSync';

export function applyWaitlistRequest(snapshot: PlayerClubSnapshot, request: PlayerWaitlistRequest): PlayerClubSnapshot {
  if (snapshot.club.id !== request.clubId) return snapshot;
  if (request.action === 'cancel') {
    const cancelled = snapshot.waitlists.filter(
      (entry) =>
        entry.gameId === request.gameId &&
        ['Interested', 'Confirmed Coming', 'Arrived'].includes(entry.status) &&
        entry.playerId === request.player.id
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
      ...(snapshot.social ? { social: { ...snapshot.social, waitlistCount: Math.max(0, snapshot.social.waitlistCount - cancelled.length) } } : {}),
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
    ...(snapshot.social ? { social: { ...snapshot.social, waitlistCount: snapshot.social.waitlistCount + 1 } } : {}),
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
  membershipOption: PlayerMembershipOption
) {
  return createMembershipRequest(player, clubId, undefined, {
    paymentMethod: 'in-person',
    priceLabel: membershipOption.priceLabel,
    planId: membershipOption.id,
    planName: membershipOption.name,
    membershipDurationDays: membershipOption.durationDays
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
    availabilityEndTime
  });
}
