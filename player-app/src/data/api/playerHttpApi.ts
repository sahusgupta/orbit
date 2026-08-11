import type { User } from 'firebase/auth';
import {
  decodeCheckoutResponse,
  decodeIdentityResponse,
  decodeSnapshotEnvelope,
  readBoundaryError
} from '../../domain/decoders/playerBoundaryDecoders';
import type { PlayerAccount, PlayerMembershipRequest, PlayerWaitlistRequest } from '../../domain/playerSync';
import { auth } from '../firebase/firebaseClient';
import type { SyncResult } from '../playerDataContracts';

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
  const response = await fetch(`${orbitApiBaseUrl}/player/identity/status`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const payload: unknown = await response.json().catch(() => ({}));
  const result = decodeIdentityResponse(payload);
  if (!response.ok || !result) throw new Error(readBoundaryError(payload, 'Unable to check age-verification status.'));
  if (result.identity.ageVerified) await user.getIdToken(true);
  return result.identity;
}

export async function createPlayerIdentityVerificationSession() {
  const { token, user } = await getOrbitPlayerToken();
  const response = await fetch(`${orbitApiBaseUrl}/player/identity/session`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    }
  });
  const payload: unknown = await response.json().catch(() => ({}));
  const result = decodeIdentityResponse(payload);
  if (!response.ok || !result) throw new Error(readBoundaryError(payload, 'Unable to start age verification.'));
  if (result.identity.ageVerified) await user.getIdToken(true);
  return result;
}

export async function createClubMembershipCheckout(input: { clubId: string; product: 'day' | 'monthly' | 'time-5'; playerName: string }) {
  const { token } = await getOrbitPlayerToken();
  const response = await fetch(`${orbitApiBaseUrl}/player/membership-checkout`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(input)
  });
  const payload: unknown = await response.json().catch(() => ({}));
  const result = decodeCheckoutResponse(payload);
  if (!response.ok || !result) throw new Error(readBoundaryError(payload, 'Unable to start the card house checkout.'));
  return result;
}

export async function fetchRemoteClubSnapshot(player: Pick<PlayerAccount, 'id' | 'name'>, accountKey: string): Promise<SyncResult> {
  if (!orbitApiBaseUrl || !auth.currentUser) return { ok: false, error: 'Orbit API player sync is unavailable.' };
  try {
    const { token } = await getOrbitPlayerToken();
    const params = new URLSearchParams({ accountKey, playerName: player.name || '' });
    const response = await fetch(`${orbitApiBaseUrl}/player/snapshot?${params.toString()}`, {
      headers: { authorization: `Bearer ${token}` }
    });
    const payload: unknown = await response.json().catch(() => ({}));
    const result = decodeSnapshotEnvelope(payload);
    if (!response.ok || !result) throw new Error(readBoundaryError(payload, 'Orbit API club snapshot is unavailable.'));
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Orbit API club snapshot is unavailable.' };
  }
}

export async function submitRemotePlayerRequest(path: string, request: PlayerMembershipRequest | PlayerWaitlistRequest): Promise<SyncResult> {
  if (!orbitApiBaseUrl) return { ok: false, error: 'Orbit API is not configured.' };
  try {
    const { token } = await getOrbitPlayerToken();
    const response = await fetch(`${orbitApiBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(request)
    });
    const payload: unknown = await response.json().catch(() => ({}));
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
  const response = await fetch(`${orbitApiBaseUrl}/player/tournament-registrations`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const body: unknown = await response.json().catch(() => ({}));
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
  const response = await fetch(`${orbitApiBaseUrl}/player/account`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` }
  });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(readBoundaryError(payload, 'Unable to delete the player account.'));
  const retainedCategories = payload && typeof payload === 'object' && Array.isArray(Reflect.get(payload, 'retainedCategories'))
    ? Reflect.get(payload, 'retainedCategories') as unknown[]
    : [];
  return { retainedCategories: retainedCategories.filter((value): value is string => typeof value === 'string') };
}
