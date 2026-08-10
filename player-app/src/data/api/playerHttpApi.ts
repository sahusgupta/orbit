import type { User } from 'firebase/auth';
import type { PlayerAccount, PlayerMembershipRequest, PlayerWaitlistRequest } from '../../domain/playerSync';
import { auth } from '../firebase/firebaseClient';
import type { SyncResult } from '../playerDataContracts';

export const orbitApiBaseUrl = (
  process.env.EXPO_PUBLIC_ORBIT_API_URL ||
  'https://orbitapp-one.vercel.app'
).replace(/\/$/, '');

export type PlayerIdentityStatus = {
  status: 'unverified' | 'requires_input' | 'processing' | 'verified' | 'underage' | 'canceled' | 'redacted';
  ageVerified: boolean;
  ageLevel: number;
  minimumAge: number;
  verifiedAt: string | null;
  failureCode: string | null;
};

type PlayerIdentityResponse = {
  ok: true;
  identity: PlayerIdentityStatus;
  alreadyVerified?: boolean;
  verificationUrl?: string | null;
  returnUrl?: string;
};

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
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.identity) throw new Error(payload.error || 'Unable to check age-verification status.');
  const result = payload as PlayerIdentityResponse;
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
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.identity) throw new Error(payload.error || 'Unable to start age verification.');
  const result = payload as PlayerIdentityResponse;
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
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.checkoutUrl) throw new Error(payload.error || 'Unable to start the card house checkout.');
  return payload as { ok: true; checkoutUrl: string; sessionId: string };
}

export async function fetchRemoteClubSnapshot(player: Pick<PlayerAccount, 'id' | 'name'>, accountKey: string): Promise<SyncResult> {
  if (!orbitApiBaseUrl || !auth.currentUser) return { ok: false, error: 'Orbit API player sync is unavailable.' };
  try {
    const { token } = await getOrbitPlayerToken();
    const params = new URLSearchParams({ accountKey, playerName: player.name || '' });
    const response = await fetch(`${orbitApiBaseUrl}/player/snapshot?${params.toString()}`, {
      headers: { authorization: `Bearer ${token}` }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.snapshot) throw new Error(payload?.error || 'Orbit API club snapshot is unavailable.');
    return payload as SyncResult;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Orbit API club snapshot is unavailable.' };
  }
}

export async function submitRemotePlayerRequest(path: string, request: PlayerMembershipRequest | PlayerWaitlistRequest): Promise<SyncResult> {
  if (!orbitApiBaseUrl) return { ok: false, error: 'Orbit API is not configured.' };
  try {
    const token = auth.currentUser ? await auth.currentUser.getIdToken() : '';
    const response = await fetch(`${orbitApiBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'content-type': 'application/json'
      },
      body: JSON.stringify(request)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.snapshot) throw new Error(payload?.error || 'Orbit API request failed.');
    return payload as SyncResult;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Orbit API is unavailable.' };
  }
}

export async function deleteRemotePlayerIdentity(user: User) {
  if (!orbitApiBaseUrl) return;
  const token = await user.getIdToken();
  const response = await fetch(`${orbitApiBaseUrl}/player/identity`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Unable to remove identity-verification data.');
}
