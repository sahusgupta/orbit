import type { User } from 'firebase/auth';
import {
  decodeDiscoveryResponse,
  decodeIdentityResponse,
  decodeMembershipQrResponse,
  decodeSnapshotEnvelope,
  decodeTournamentInterestMutationResponse,
  readBoundaryError,
  readFirebaseErrorCode
} from '../../domain/decoders/playerBoundaryDecoders';
import type { PlayerAccount, PlayerMembershipRequest, PlayerWaitlistRequest } from '../../domain/playerSync';
import type { ConfirmedPlayerIdentityDetails } from '../../domain/playerIdentityCapture';
import { auth } from '../firebase/firebaseClient';
import type { SyncResult } from '../playerDataContracts';
import { requestJson } from './boundedFetch';

export type { PlayerIdentityStatus } from '../../domain/playerIdentity';

export const orbitApiBaseUrl = (
  process.env.EXPO_PUBLIC_ORBIT_API_URL || ''
).replace(/\/$/, '');

async function getOrbitPlayerToken(forceRefresh = false, expectedUid?: string) {
  if (!orbitApiBaseUrl) throw new Error('EXPO_PUBLIC_ORBIT_API_URL is not configured.');
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in to your Orbit Player account first.');
  if (expectedUid && user.uid !== expectedUid) {
    throw new Error('The signed-in Orbit Player account does not match this request.');
  }
  const token = await user.getIdToken(forceRefresh);
  if (auth.currentUser?.uid !== user.uid) {
    throw new Error('The signed-in Orbit Player account changed before the request was sent.');
  }
  return { token, user };
}

function assertCurrentPlayerSession(expectedUid: string) {
  if (auth.currentUser?.uid !== expectedUid) {
    throw new Error('The signed-in Orbit Player account changed before the response was applied.');
  }
}

export async function fetchPlayerIdentityStatus(forceTokenRefresh = false, expectedUid?: string) {
  const { token, user } = await getOrbitPlayerToken(forceTokenRefresh, expectedUid);
  const { response, payload } = await requestJson(`${orbitApiBaseUrl}/player/identity/status`, {
    headers: { authorization: `Bearer ${token}` }
  }, { dedupeKey: `identity:${user.uid}` });
  assertCurrentPlayerSession(user.uid);
  const result = decodeIdentityResponse(payload);
  if (!response.ok || !result) throw new Error(readBoundaryError(payload, 'Unable to check age-verification status.'));
  if (result.identity.ageVerified) {
    await user.getIdToken(true);
    assertCurrentPlayerSession(user.uid);
  }
  return result.identity;
}

export async function savePlayerIdentityCapture(
  input: ConfirmedPlayerIdentityDetails & { mutationId: string },
  expectedUid: string
) {
  const { token } = await getOrbitPlayerToken(false, expectedUid);
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
  assertCurrentPlayerSession(expectedUid);
  const result = decodeIdentityResponse(payload);
  if (!response.ok || !result) throw new Error(readBoundaryError(payload, 'Unable to save the confirmed ID details.'));
  return result.identity;
}

export async function fetchRemoteClubSnapshot(player: Pick<PlayerAccount, 'id' | 'name'>, accountKey: string): Promise<SyncResult> {
  if (!orbitApiBaseUrl || !auth.currentUser) return { ok: false, error: 'Orbit API player sync is unavailable.' };
  try {
    const { token } = await getOrbitPlayerToken(false, player.id);
    const params = new URLSearchParams({ accountKey });
    const { response, payload } = await requestJson(`${orbitApiBaseUrl}/player/snapshot?${params.toString()}`, {
      headers: { authorization: `Bearer ${token}` }
    }, { dedupeKey: `snapshot:${accountKey}:${player.id}` });
    assertCurrentPlayerSession(player.id);
    const result = decodeSnapshotEnvelope(payload);
    if (!response.ok || !result) throw new Error(readBoundaryError(payload, 'Orbit API club snapshot is unavailable.'));
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Orbit API club snapshot is unavailable.' };
  }
}

export async function fetchRemotePlayerDiscovery(cursor = '', limit = 50, expectedUid?: string) {
  const { token, user } = await getOrbitPlayerToken(false, expectedUid);
  const params = new URLSearchParams({ limit: String(Math.min(Math.max(limit, 1), 50)) });
  if (cursor) params.set('cursor', cursor);
  const { response, payload } = await requestJson(`${orbitApiBaseUrl}/player/discovery?${params.toString()}`, {
    headers: { authorization: `Bearer ${token}` }
  }, { dedupeKey: `discovery:${user.uid}:${cursor}:${limit}` });
  assertCurrentPlayerSession(user.uid);
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

export async function submitRemotePlayerRequest(
  path: string,
  request: PlayerMembershipRequest | PlayerWaitlistRequest,
  expectedUid: string
): Promise<SyncResult> {
  if (!orbitApiBaseUrl) return { ok: false, error: 'Orbit API is not configured.' };
  try {
    const { token } = await getOrbitPlayerToken(false, expectedUid);
    const { response, payload } = await requestJson(`${orbitApiBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(request)
    });
    assertCurrentPlayerSession(expectedUid);
    const result = decodeSnapshotEnvelope(payload);
    if (!response.ok || !result) throw new Error(readBoundaryError(payload, 'Orbit API request failed.'));
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Orbit API is unavailable.' };
  }
}

export async function submitRemoteTournamentMutation(
  method: 'POST' | 'DELETE',
  payload: { clubId: string; tournamentId: string; mutationId: string },
  expectedUid: string
) {
  if (!orbitApiBaseUrl) throw new Error('Orbit API is not configured.');
  const { token } = await getOrbitPlayerToken(false, expectedUid);
  const { response, payload: body } = await requestJson(`${orbitApiBaseUrl}/player/tournament-interests`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  assertCurrentPlayerSession(expectedUid);
  const result = decodeTournamentInterestMutationResponse(body);
  if (!response.ok || !result) throw new Error(readBoundaryError(body, 'Tournament interest could not be saved.'));
  return result;
}

export async function issueRemoteMembershipQr(clubId: string, mutationId: string, expectedUid: string) {
  const { token } = await getOrbitPlayerToken(false, expectedUid);
  const { response, payload } = await requestJson(`${orbitApiBaseUrl}/player/membership-qr`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ clubId, mutationId })
  });
  assertCurrentPlayerSession(expectedUid);
  const result = decodeMembershipQrResponse(payload);
  if (!response.ok || !result) throw new Error(readBoundaryError(payload, 'Unable to issue a membership check-in code.'));
  return result;
}

export async function deleteRemotePlayerAccount(user: User) {
  if (!orbitApiBaseUrl) throw new Error('EXPO_PUBLIC_ORBIT_API_URL is not configured.');
  if (auth.currentUser?.uid !== user.uid) throw new Error('The signed-in Orbit Player account changed before deletion.');
  const token = await user.getIdToken(true);
  if (auth.currentUser?.uid !== user.uid) throw new Error('The signed-in Orbit Player account changed before deletion.');
  const { response, payload } = await requestJson(`${orbitApiBaseUrl}/player/account`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` }
  });
  const responseRecord = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null;
  const deletionStatus = responseRecord?.status;
  if (!response.ok || responseRecord?.ok !== true || (deletionStatus !== 'complete' && deletionStatus !== 'pending')) {
    const error = new Error(readBoundaryError(payload, 'Unable to delete the player account.')) as Error & { code?: string };
    error.code = readFirebaseErrorCode(payload);
    throw error;
  }
  const retainedCategories = payload && typeof payload === 'object' && Array.isArray(Reflect.get(payload, 'retainedCategories'))
    ? Reflect.get(payload, 'retainedCategories') as unknown[]
    : [];
  const jobFinalization = responseRecord?.jobFinalization;
  const status: 'complete' | 'pending' = deletionStatus === 'complete' &&
    jobFinalization !== 'pending' && jobFinalization !== 'scheduled'
    ? 'complete'
    : 'pending';
  return {
    initiatingUid: user.uid,
    status,
    retainedCategories: retainedCategories.filter((value): value is string => typeof value === 'string')
  };
}
