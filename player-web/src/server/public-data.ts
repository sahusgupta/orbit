import 'server-only';
import { decodeDiscoveryResponse, readBoundaryError } from '@orbit/player-domain/decoders/playerBoundaryDecoders';
import type { DataResult, DiscoveryPayload, PlayerClubSnapshot, PlayerTournament } from '@/src/domain/types';

type PublicClubPayload = {
  club: PlayerClubSnapshot;
  tournaments: PlayerTournament[];
};

const PUBLIC_DATA_TIMEOUT_MS = 8_000;

function apiBaseUrl() {
  return (process.env.ORBIT_API_URL || 'http://127.0.0.1:4629').replace(/\/$/, '');
}

async function fetchJson(path: string, timeoutMs = PUBLIC_DATA_TIMEOUT_MS): Promise<{ response: Response; payload: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      headers: { accept: 'application/json' },
      next: { revalidate: 30 },
      signal: controller.signal
    });
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Orbit live data took too long to respond. Try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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
    const clubs = new Map<string, PlayerClubSnapshot>();
    const tournaments = new Map<string, PlayerTournament>();
    const seenCursors = new Set<string>();
    const discoveryDeadline = Date.now() + PUBLIC_DATA_TIMEOUT_MS;
    let cursor: string | null = null;
    let hasMore = true;

    while (hasMore) {
      const query = new URLSearchParams({ limit: '50' });
      if (cursor) query.set('cursor', cursor);
      const remainingMs = discoveryDeadline - Date.now();
      if (remainingMs <= 0) throw new Error('Orbit live data took too long to respond. Try again.');
      const { response, payload } = await fetchJson(`/player/public/discovery?${query.toString()}`, remainingMs);
      const decoded = decodeDiscoveryResponse(payload);
      if (!response.ok || !decoded) {
        return { status: 'error', message: readBoundaryError(payload, 'Live Orbit discovery is temporarily unavailable.') };
      }
      decoded.clubs.forEach((club) => clubs.set(club.club.id, club));
      decoded.tournaments.forEach((tournament) => tournaments.set(`${tournament.clubId}:${tournament.id}`, tournament));
      hasMore = decoded.page.hasMore;
      if (!hasMore) break;
      const nextCursor = decoded.page.nextCursor;
      if (!nextCursor || seenCursors.has(nextCursor)) {
        throw new Error('Live Orbit discovery returned an invalid page cursor.');
      }
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }

    return {
      status: 'ready',
      data: {
        clubs: Array.from(clubs.values()),
        tournaments: Array.from(tournaments.values()),
        registrations: [],
        page: { count: clubs.size, hasMore: false, nextCursor: null }
      }
    };
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
