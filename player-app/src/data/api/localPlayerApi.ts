import { decodeSnapshotEnvelope, readBoundaryError } from '../../domain/decoders/playerBoundaryDecoders';
import type { PlayerAccount } from '../../domain/playerSync';
import type { SyncResult } from '../playerDataContracts';
import { auth } from '../firebase/firebaseClient';
import { requestJson } from './boundedFetch';

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
    const { response, payload } = await requestJson(`${localOrbitApiBaseUrl}/player/snapshot?${params.toString()}`, {
      headers: { authorization: `Bearer ${token}` }
    }, { dedupeKey: `local-snapshot:${player.id}`, readRetries: 0, timeoutMs: 2_500 });
    const result = decodeSnapshotEnvelope(payload);
    if (!response.ok || !result) throw new Error(readBoundaryError(payload, 'Local Orbit club is not available.'));
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Local Orbit bridge is unavailable.' };
  }
}
