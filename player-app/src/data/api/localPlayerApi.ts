import { decodeSnapshotEnvelope, readBoundaryError } from '../../domain/decoders/playerBoundaryDecoders';
import type { PlayerAccount, PlayerMembershipRequest, PlayerWaitlistRequest } from '../../domain/playerSync';
import type { SyncResult } from '../playerDataContracts';
import { auth } from '../firebase/firebaseClient';

const localOrbitApiBaseUrl = (
  process.env.EXPO_PUBLIC_ORBIT_LOCAL_API_URL ||
  (typeof window !== 'undefined' ? 'http://127.0.0.1:4629' : '')
).replace(/\/$/, '');

export async function fetchLocalClubSnapshot(player: Pick<PlayerAccount, 'id' | 'name'>): Promise<SyncResult> {
  if (!localOrbitApiBaseUrl) return { ok: false, error: 'Local Orbit bridge is not configured.' };
  if (!auth.currentUser) return { ok: false, error: 'Sign in to your Orbit Player account first.' };
  try {
    const token = await auth.currentUser.getIdToken();
    const params = new URLSearchParams({ playerId: player.id || '', playerName: player.name || '' });
    const response = await fetch(`${localOrbitApiBaseUrl}/player/snapshot?${params.toString()}`, {
      headers: { authorization: `Bearer ${token}` }
    });
    const payload: unknown = await response.json().catch(() => ({}));
    const result = decodeSnapshotEnvelope(payload);
    if (!response.ok || !result) throw new Error(readBoundaryError(payload, 'Local Orbit club is not available.'));
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Local Orbit bridge is unavailable.' };
  }
}

export async function submitLocalPlayerRequest(path: string, request: PlayerMembershipRequest | PlayerWaitlistRequest): Promise<SyncResult> {
  if (!localOrbitApiBaseUrl) return { ok: false, error: 'Local Orbit bridge is not configured.' };
  if (!auth.currentUser) return { ok: false, error: 'Sign in to your Orbit Player account first.' };
  try {
    const token = await auth.currentUser.getIdToken();
    const response = await fetch(`${localOrbitApiBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(request)
    });
    const payload: unknown = await response.json().catch(() => ({}));
    const result = decodeSnapshotEnvelope(payload);
    if (!response.ok || !result) throw new Error(readBoundaryError(payload, 'Local Orbit request failed.'));
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Local Orbit bridge is unavailable.' };
  }
}
