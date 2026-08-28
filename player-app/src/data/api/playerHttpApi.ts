import type { User } from 'firebase/auth';
import {
  decodeCheckoutResponse,
  decodeDiscoveryResponse,
  decodeIdentityResponse,
  decodeSnapshotEnvelope,
  readBoundaryError
} from '../../domain/decoders/playerBoundaryDecoders';
import type { PlayerAccount, PlayerMembershipRequest, PlayerWaitlistRequest } from '../../domain/playerSync';
import type { ConfirmedPlayerIdentityDetails } from '../../domain/playerIdentityCapture';
import type { TimeAccessProduct } from '../../domain/playerTypes';
import { auth } from '../firebase/firebaseClient';
import type { SyncResult } from '../playerDataContracts';
import { requestJson } from './boundedFetch';

export type { PlayerIdentityStatus } from '../../domain/playerIdentity';

export const orbitApiBaseUrl = (
  process.env.EXPO_PUBLIC_ORBIT_API_URL ||
  'https://orbitapp-one.vercel.app'
).replace(/\/$/, '');

async function getOrbitPlayerToken(forceRefresh = false) {
  if (!orbitApiBaseUrl) throw new Error('EXPO_PUBLIC_ORBIT_API_URL is not configured.');
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in to your Orbit Player account first.');
  return { token: await user.getIdToken(forceRefresh), user };
}

export async function fetchPlayerIdentityStatus(forceTokenRefresh = false) {
  const { token, user } = await getOrbitPlayerToken(forceTokenRefresh);
  const { response, payload } = await requestJson(`${orbitApiBaseUrl}/player/identity/status`, {
    headers: { authorization: `Bearer ${token}` }
  }, { dedupeKey: `identity:${user.uid}` });
  const result = decodeIdentityResponse(payload);
  if (!response.ok || !result) throw new Error(readBoundaryError(payload, 'Unable to check age-verification status.'));
  if (result.identity.ageVerified) await user.getIdToken(true);
  return result.identity;
}

export async function savePlayerIdentityCapture(
  input: ConfirmedPlayerIdentityDetails & { mutationId: string }
) {
  const { token } = await getOrbitPlayerToken();
  const safeBody = {
    fullName: input.fullName,
    dateOfBirth: input.dateOfBirth,
    address: input.address,
    mutationId: input.mutationId
  };
  const { response, payload } = await requestJson(`${orbitApiBaseUrl}/player/identity/capture`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(safeBody)
  });
  const result = decodeIdentityResponse(payload);
  if (!response.ok || !result) throw new Error(readBoundaryError(payload, 'Unable to save the confirmed ID details.'));
  return result.identity;
}

type ClubMembershipCheckoutInput =
  | { clubId: string; product: 'day' | 'monthly'; playerName: string; planId: string }
  | { clubId: string; product: TimeAccessProduct; playerName: string; planId?: never };

export async function createClubMembershipCheckout(input: ClubMembershipCheckoutInput) {
  const { token } = await getOrbitPlayerToken();
  const { response, payload } = await requestJson(`${orbitApiBaseUrl}/player/membership-checkout`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(input)
  });
  const result = decodeCheckoutResponse(payload);
  if (!response.ok || !result) throw new Error(readBoundaryError(payload, 'Unable to start the card house checkout.'));
  return result;
}

export async function fetchRemoteClubSnapshot(player: Pick<PlayerAccount, 'id' | 'name'>, accountKey: string): Promise<SyncResult> {
  if (!orbitApiBaseUrl || !auth.currentUser) return { ok: false, error: 'Orbit API player sync is unavailable.' };
  try {
    const { token } = await getOrbitPlayerToken();
    const params = new URLSearchParams({ accountKey, playerName: player.name || '' });
    const { response, payload } = await requestJson(`${orbitApiBaseUrl}/player/snapshot?${params.toString()}`, {
      headers: { authorization: `Bearer ${token}` }
    }, { dedupeKey: `snapshot:${accountKey}:${player.id}` });
    const result = decodeSnapshotEnvelope(payload);
    if (!response.ok || !result) throw new Error(readBoundaryError(payload, 'Orbit API club snapshot is unavailable.'));
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Orbit API club snapshot is unavailable.' };
  }
}

export async function fetchRemotePlayerDiscovery(cursor = '', limit = 50) {
  const { token, user } = await getOrbitPlayerToken();
  const params = new URLSearchParams({ limit: String(Math.min(Math.max(limit, 1), 50)) });
  if (cursor) params.set('cursor', cursor);
  const { response, payload } = await requestJson(`${orbitApiBaseUrl}/player/discovery?${params.toString()}`, {
    headers: { authorization: `Bearer ${token}` }
  }, { dedupeKey: `discovery:${user.uid}:${cursor}:${limit}` });
  const result = decodeDiscoveryResponse(payload);
  if (!response.ok || !result) throw new Error(readBoundaryError(payload, 'Orbit Player discovery is unavailable.'));
  return result;
}

export async function fetchPublicPlayerDiscovery(cursor = '', limit = 50) {
  if (!orbitApiBaseUrl) throw new Error('EXPO_PUBLIC_ORBIT_API_URL is not configured.');
  const params = new URLSearchParams({ limit: String(Math.min(Math.max(limit, 1), 50)) });
  if (cursor) params.set('cursor', cursor);
  const { response, payload } = await requestJson(`${orbitApiBaseUrl}/player/public/discovery?${params.toString()}`, {}, {
    dedupeKey: `public-discovery:${cursor}:${limit}`
  });
  const result = decodeDiscoveryResponse(payload);
  if (!response.ok || !result) throw new Error(readBoundaryError(payload, 'Orbit Player public discovery is unavailable.'));
  return result;
}

export async function submitRemotePlayerRequest(path: string, request: PlayerMembershipRequest | PlayerWaitlistRequest): Promise<SyncResult> {
  if (!orbitApiBaseUrl) return { ok: false, error: 'Orbit API is not configured.' };
  try {
    const { token } = await getOrbitPlayerToken();
    const { response, payload } = await requestJson(`${orbitApiBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(request)
    });
    const result = decodeSnapshotEnvelope(payload);
    if (!response.ok || !result) throw new Error(readBoundaryError(payload, 'Orbit API request failed.'));
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Orbit API is unavailable.' };
  }
}

export async function submitRemoteTournamentMutation(
  method: 'POST' | 'DELETE',
  payload: { clubId: string; tournamentId: string; mutationId: string }
) {
  if (!orbitApiBaseUrl) throw new Error('Orbit API is not configured.');
  const { token } = await getOrbitPlayerToken();
  const { response, payload: body } = await requestJson(`${orbitApiBaseUrl}/player/tournament-registrations`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok || !body || typeof body !== 'object') {
    throw new Error(readBoundaryError(body, 'Tournament registration could not be saved.'));
  }
  if (Reflect.get(body, 'ok') !== true) {
    throw new Error(readBoundaryError(body, 'Tournament registration could not be saved.'));
  }
  return body;
}

export async function deleteRemotePlayerAccount(user: User) {
  if (!orbitApiBaseUrl) return;
  const token = await user.getIdToken(true);
  const { response, payload } = await requestJson(`${orbitApiBaseUrl}/player/account`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error(readBoundaryError(payload, 'Unable to delete the player account.'));
  const retainedCategories = payload && typeof payload === 'object' && Array.isArray(Reflect.get(payload, 'retainedCategories'))
    ? Reflect.get(payload, 'retainedCategories') as unknown[]
    : [];
  return { retainedCategories: retainedCategories.filter((value): value is string => typeof value === 'string') };
}
