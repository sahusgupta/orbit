import 'server-only';
import { decodeDiscoveryResponse, readBoundaryError } from '@orbit/player-domain/decoders/playerBoundaryDecoders';
import type { DataResult, DiscoveryPayload, PlayerClubSnapshot, PlayerTournament } from '@/src/domain/types';

type PublicClubPayload = {
  club: PlayerClubSnapshot;
  tournaments: PlayerTournament[];
};

function apiBaseUrl() {
  return (process.env.ORBIT_API_URL || 'http://127.0.0.1:4629').replace(/\/$/, '');
}

async function fetchJson(path: string): Promise<{ response: Response; payload: unknown }> {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    headers: { accept: 'application/json' },
    next: { revalidate: 30 }
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { response, payload };
}

export async function getPublicDiscovery(): Promise<DataResult<DiscoveryPayload>> {
  try {
    const { response, payload } = await fetchJson('/player/public/discovery?limit=50');
    const decoded = decodeDiscoveryResponse(payload);
    if (!response.ok || !decoded) {
      return { status: 'error', message: readBoundaryError(payload, 'Live Orbit discovery is temporarily unavailable.') };
    }
    return { status: 'ready', data: decoded };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Live Orbit discovery is temporarily unavailable.'
    };
  }
}

export async function getPublicClub(clubId: string): Promise<DataResult<PublicClubPayload>> {
  try {
    const { response, payload } = await fetchJson(`/player/public/clubs/${encodeURIComponent(clubId)}`);
    if (!response.ok || !isPublicClubPayload(payload)) {
      return { status: 'error', message: readBoundaryError(payload, 'This club could not be loaded.') };
    }
    return { status: 'ready', data: payload };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'This club could not be loaded.' };
  }
}

function isPublicClubPayload(value: unknown): value is PublicClubPayload {
  if (!value || typeof value !== 'object') return false;
  const club = Reflect.get(value, 'club');
  const tournaments = Reflect.get(value, 'tournaments');
  return Boolean(
    club &&
    typeof club === 'object' &&
    typeof Reflect.get(club, 'club') === 'object' &&
    Array.isArray(tournaments)
  );
}
