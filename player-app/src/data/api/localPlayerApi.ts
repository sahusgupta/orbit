import type { PlayerAccount, PlayerMembershipRequest, PlayerWaitlistRequest } from '../../domain/playerSync';
import type { SyncResult } from '../playerDataContracts';

const localOrbitApiBaseUrl = (
  process.env.EXPO_PUBLIC_ORBIT_LOCAL_API_URL ||
  (typeof window !== 'undefined' ? 'http://127.0.0.1:4629' : '')
).replace(/\/$/, '');

export async function fetchLocalClubSnapshot(player: Pick<PlayerAccount, 'id' | 'name'>): Promise<SyncResult> {
  if (!localOrbitApiBaseUrl) return { ok: false, error: 'Local Orbit bridge is not configured.' };
  try {
    const params = new URLSearchParams({ playerId: player.id || '', playerName: player.name || '' });
    const response = await fetch(`${localOrbitApiBaseUrl}/player/snapshot?${params.toString()}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.snapshot) throw new Error(payload?.error || 'Local Orbit club is not available.');
    return payload as SyncResult;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Local Orbit bridge is unavailable.' };
  }
}

export async function submitLocalPlayerRequest(path: string, request: PlayerMembershipRequest | PlayerWaitlistRequest): Promise<SyncResult> {
  if (!localOrbitApiBaseUrl) return { ok: false, error: 'Local Orbit bridge is not configured.' };
  try {
    const response = await fetch(`${localOrbitApiBaseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.snapshot) throw new Error(payload?.error || 'Local Orbit request failed.');
    return payload as SyncResult;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Local Orbit bridge is unavailable.' };
  }
}
