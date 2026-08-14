import { decodeDiscoveryResponse, decodeIdentityResponse, decodeSnapshotEnvelope, readBoundaryError } from '@orbit/player-domain/decoders/playerBoundaryDecoders';
import { buildJoinRequest, buildWaitRequest } from '@orbit/player-requests';
import type { User } from 'firebase/auth';
import type {
  DiscoveryPayload,
  PlayerAccount,
  PlayerClubSnapshot,
  PlayerMembershipOption,
  PlayerSyncGame,
  PlayerTournament,
  PlayerTournamentRegistration,
  SeatRequestInput
} from '@/src/domain/types';

function apiBaseUrl() {
  return (process.env.NEXT_PUBLIC_ORBIT_API_URL || 'http://127.0.0.1:4629').replace(/\/$/, '');
}

async function authorizedJson(user: User, path: string, init: RequestInit = {}) {
  const token = await user.getIdToken();
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers
    }
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { response, payload };
}

export async function fetchAuthenticatedDiscovery(user: User): Promise<DiscoveryPayload> {
  const { response, payload } = await authorizedJson(user, '/player/discovery?limit=50');
  const decoded = decodeDiscoveryResponse(payload);
  if (!response.ok || !decoded) throw new Error(readBoundaryError(payload, 'My Orbit could not load your live activity.'));
  return decoded;
}

export async function submitMembershipApplication(
  user: User,
  player: PlayerAccount,
  club: PlayerClubSnapshot,
  option?: PlayerMembershipOption
) {
  const plan = option?.durationDays === 1 ? 'day' : 'monthly';
  const request = buildJoinRequest(player, club.club.id, plan, 'in-person', option?.priceLabel, option);
  const { response, payload } = await authorizedJson(user, '/player/membership-requests', {
    method: 'POST',
    body: JSON.stringify(request)
  });
  const decoded = decodeSnapshotEnvelope(payload);
  if (!response.ok || !decoded) throw new Error(readBoundaryError(payload, 'Your membership request could not be sent.'));
  return decoded.snapshot;
}

export async function submitSeatRequest(
  user: User,
  player: PlayerAccount,
  club: PlayerClubSnapshot,
  game: PlayerSyncGame,
  input: SeatRequestInput,
  action: 'join' | 'cancel' = 'join'
) {
  const tableId = game.openTables.find((table) => table.status === 'Running')?.id;
  const request = buildWaitRequest(
    player,
    club.club.id,
    game.id,
    tableId,
    action,
    input.attendance,
    input.expectedArrivalTime,
    input.availabilityStartTime,
    input.availabilityEndTime
  );
  const { response, payload } = await authorizedJson(user, '/player/waitlist-requests', {
    method: 'POST',
    body: JSON.stringify(request)
  });
  const decoded = decodeSnapshotEnvelope(payload);
  if (!response.ok || !decoded) throw new Error(readBoundaryError(payload, 'Your game request could not be sent.'));
  return decoded.snapshot;
}

export async function registerTournament(user: User, tournament: PlayerTournament) {
  const mutationId = `register:${tournament.id}:${user.uid}:${Date.now()}`;
  const { response, payload } = await authorizedJson(user, '/player/tournament-registrations', {
    method: 'POST',
    body: JSON.stringify({ clubId: tournament.clubId, tournamentId: tournament.id, mutationId })
  });
  if (!response.ok) throw new Error(readBoundaryError(payload, 'Tournament registration could not be saved.'));
  const registration = readRegistration(payload);
  if (!registration) throw new Error('Tournament registration returned an invalid response.');
  return registration;
}

export async function unregisterTournament(user: User, tournament: PlayerTournament) {
  const mutationId = `unregister:${tournament.id}:${user.uid}:${Date.now()}`;
  const { response, payload } = await authorizedJson(user, '/player/tournament-registrations', {
    method: 'DELETE',
    body: JSON.stringify({ clubId: tournament.clubId, tournamentId: tournament.id, mutationId })
  });
  if (!response.ok || !payload || typeof payload !== 'object' || Reflect.get(payload, 'ok') !== true) {
    throw new Error(readBoundaryError(payload, 'Tournament registration could not be removed.'));
  }
}

export async function fetchIdentityStatus(user: User) {
  const { response, payload } = await authorizedJson(user, '/player/identity/status');
  const decoded = decodeIdentityResponse(payload);
  if (!response.ok || !decoded) throw new Error(readBoundaryError(payload, 'Age-verification status is unavailable.'));
  return decoded.identity;
}

export async function createIdentitySession(user: User) {
  const { response, payload } = await authorizedJson(user, '/player/identity/session', {
    method: 'POST',
    body: JSON.stringify({ returnUrl: `${window.location.origin}/me/profile` })
  });
  const decoded = decodeIdentityResponse(payload);
  if (!response.ok || !decoded) throw new Error(readBoundaryError(payload, 'Age verification could not be started.'));
  return decoded;
}

function readRegistration(value: unknown): PlayerTournamentRegistration | null {
  if (!value || typeof value !== 'object') return null;
  const registration = Reflect.get(value, 'registration');
  if (!registration || typeof registration !== 'object') return null;
  const requiredStrings = ['id', 'tournamentId', 'clubId', 'playerId', 'playerName', 'status', 'registeredAt', 'updatedAt'];
  if (requiredStrings.some((key) => typeof Reflect.get(registration, key) !== 'string')) return null;
  return registration as PlayerTournamentRegistration;
}
