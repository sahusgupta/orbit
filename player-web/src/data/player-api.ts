import { decodeDiscoveryResponse, decodeIdentityResponse, decodeSnapshotEnvelope, decodeTournamentInterestMutationResponse, readBoundaryError } from '@orbit/player-domain/decoders/playerBoundaryDecoders';
import { buildJoinRequest, buildWaitRequest } from '@orbit/player-requests';
import type { User } from 'firebase/auth';
import { assertExpectedFirebaseUser } from '@/src/auth/session-identity';
import type {
  DiscoveryPayload,
  PlayerAccount,
  PlayerClubSnapshot,
  PlayerMembershipOption,
  PlayerSyncGame,
  PlayerTournament,
  SeatRequestInput
} from '@/src/domain/types';
import { getFirstRunningTable } from '@/src/domain/selectors';
import { getFirebaseBrowserClient } from './firebase-client';

export type WebPlayerAccountDeletionResult = {
  initiatingUid: string;
  status: 'complete' | 'pending';
  retainedCategories: string[];
};

function apiBaseUrl() {
  return (process.env.NEXT_PUBLIC_ORBIT_API_URL || 'http://127.0.0.1:4629').replace(/\/$/, '');
}

async function authorizedJson(user: User, path: string, init: RequestInit = {}) {
  const { auth } = await getFirebaseBrowserClient();
  assertExpectedFirebaseUser(auth, user.uid);
  const token = await user.getIdToken();
  assertExpectedFirebaseUser(auth, user.uid);
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers
    }
  });
  assertExpectedFirebaseUser(auth, user.uid);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  assertExpectedFirebaseUser(auth, user.uid);
  return { response, payload };
}

export async function fetchAuthenticatedDiscovery(user: User, signal?: AbortSignal): Promise<DiscoveryPayload> {
  const { response, payload } = await authorizedJson(user, '/player/discovery?limit=50', { signal });
  const decoded = decodeDiscoveryResponse(payload);
  if (!response.ok || !decoded) throw new Error(readBoundaryError(payload, 'My Orbit could not load your live activity.'));
  return decoded;
}

export async function submitMembershipApplication(
  user: User,
  player: PlayerAccount,
  club: PlayerClubSnapshot,
  option: PlayerMembershipOption,
  signal?: AbortSignal
) {
  if (!option) throw new Error('Select a venue-published membership option before sending a request.');
  const request = buildJoinRequest(player, club.club.id, option);
  const { response, payload } = await authorizedJson(user, '/player/membership-requests', {
    method: 'POST',
    signal,
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
  action: 'join' | 'cancel' = 'join',
  signal?: AbortSignal
) {
  const runningTable = getFirstRunningTable(game);
  const attendance = action === 'cancel'
    ? undefined
    : runningTable
      ? input.attendance === 'confirmed' ? 'confirmed' : 'arrived'
      : 'interested';
  const tableId = attendance === 'arrived' || attendance === 'confirmed' ? runningTable?.id : undefined;
  const request = buildWaitRequest(
    player,
    club.club.id,
    game.id,
    tableId,
    action,
    attendance,
    attendance === 'confirmed' ? input.expectedArrivalTime : undefined,
    attendance === 'interested' ? input.availabilityStartTime : undefined,
    attendance === 'interested' ? input.availabilityEndTime : undefined
  );
  const { response, payload } = await authorizedJson(user, '/player/waitlist-requests', {
    method: 'POST',
    signal,
    body: JSON.stringify(request)
  });
  const decoded = decodeSnapshotEnvelope(payload);
  if (!response.ok || !decoded) throw new Error(readBoundaryError(payload, 'Your game request could not be sent.'));
  return decoded.snapshot;
}

export async function expressTournamentInterest(user: User, tournament: PlayerTournament, signal?: AbortSignal) {
  const mutationId = opaqueMutationId();
  const { response, payload } = await authorizedJson(user, '/player/tournament-interests', {
    method: 'POST',
    signal,
    body: JSON.stringify({ clubId: tournament.clubId, tournamentId: tournament.id, mutationId })
  });
  const decoded = decodeTournamentInterestMutationResponse(payload);
  if (!response.ok || !decoded?.interest) throw new Error(readBoundaryError(payload, 'Tournament interest could not be saved.'));
  return decoded.interest;
}

export async function withdrawTournamentInterest(user: User, tournament: PlayerTournament, signal?: AbortSignal) {
  const mutationId = opaqueMutationId();
  const { response, payload } = await authorizedJson(user, '/player/tournament-interests', {
    method: 'DELETE',
    signal,
    body: JSON.stringify({ clubId: tournament.clubId, tournamentId: tournament.id, mutationId })
  });
  const decoded = decodeTournamentInterestMutationResponse(payload);
  if (!response.ok || !decoded) {
    throw new Error(readBoundaryError(payload, 'Tournament interest could not be withdrawn.'));
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

export async function deleteWebPlayerAccount(user: User): Promise<WebPlayerAccountDeletionResult> {
  const { auth } = await getFirebaseBrowserClient();
  assertExpectedFirebaseUser(auth, user.uid);
  const token = await user.getIdToken(true);
  assertExpectedFirebaseUser(auth, user.uid);
  const response = await fetch(`${apiBaseUrl()}/player/account`, {
    method: 'DELETE',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`
    }
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null;
  if (!response.ok || record?.ok !== true || (record.status !== 'complete' && record.status !== 'pending')) {
    const error = new Error(readBoundaryError(payload, 'Unable to delete the player account.')) as Error & { code?: string };
    error.code = typeof record?.code === 'string' ? record.code : undefined;
    throw error;
  }
  const finalization = record.jobFinalization;
  return {
    initiatingUid: user.uid,
    status: record.status === 'complete' && finalization !== 'pending' && finalization !== 'scheduled'
      ? 'complete'
      : 'pending',
    retainedCategories: Array.isArray(record.retainedCategories)
      ? record.retainedCategories.filter((value): value is string => typeof value === 'string')
      : []
  };
}

function opaqueMutationId() {
  if (!globalThis.crypto?.randomUUID) throw new Error('Secure request identifiers are unavailable in this browser.');
  return globalThis.crypto.randomUUID();
}
