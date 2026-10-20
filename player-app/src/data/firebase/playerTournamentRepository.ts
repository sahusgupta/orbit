import { isTournamentInterestOpen, tournamentScopeKey, type PlayerAccount, type PlayerTournament, type PlayerTournamentInterest } from '../../domain/playerSync';
import { fetchPublicPlayerDiscovery, fetchRemotePlayerDiscovery, submitRemoteTournamentMutation, submitRemoteTournamentRegistration } from '../api/playerHttpApi';
import { ensureSignedInIdentity, getCurrentFirebasePlayer } from './playerAuth';

export const playerTournamentRefreshIntervalMs = 60_000;
const tournamentDiscoveryPageSize = 50;
const maximumTournamentDiscoveryPages = 20;

export async function fetchPlayerTournaments(playerId?: string) {
  const signedIn = getCurrentFirebasePlayer();
  if (signedIn && (!playerId || signedIn.uid !== playerId)) {
    throw new Error('The signed-in Orbit Player account does not match this profile.');
  }
  const expectedUid = signedIn?.uid;
  const assertCurrentSession = () => {
    if (expectedUid && getCurrentFirebasePlayer()?.uid !== expectedUid) {
      throw new Error('The signed-in Orbit Player account changed while tournaments were loading.');
    }
  };
  const tournaments = new Map<string, PlayerTournament>();
  const interests = new Map<string, PlayerTournamentInterest>();
  const clubIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor = '';
  let completedPages = 0;
  let databaseQueries = 0;
  let hasDatabaseQueries = false;
  const catalog = (hasMore: boolean, nextCursor: string | null) => {
    assertCurrentSession();
    return {
      tournaments: [...tournaments.values()],
      interests: [...interests.values()].filter((interest) => interest.status === 'interested'),
      page: { count: clubIds.size, hasMore, nextCursor, databaseQueries: hasDatabaseQueries ? databaseQueries : undefined }
    };
  };
  for (let pageIndex = 0; pageIndex < maximumTournamentDiscoveryPages; pageIndex += 1) {
    assertCurrentSession();
    let discovery: Awaited<ReturnType<typeof fetchRemotePlayerDiscovery>>;
    try {
      discovery = expectedUid
        ? await fetchRemotePlayerDiscovery(cursor, tournamentDiscoveryPageSize, expectedUid)
        : await fetchPublicPlayerDiscovery(cursor, tournamentDiscoveryPageSize);
    } catch (error) {
      assertCurrentSession();
      if (!completedPages) throw error;
      return catalog(true, cursor || null);
    }
    assertCurrentSession();
    completedPages += 1;
    for (const club of discovery.clubs) clubIds.add(club.club.id);
    // Map replacement retains first insertion order; encounter order is not a timestamp claim.
    for (const tournament of discovery.tournaments) {
      const { registration, ...listing } = tournament;
      tournaments.set(tournamentScopeKey(tournament), {
        ...listing, ...(expectedUid && registration?.playerId === expectedUid ? { registration } : {})
      });
    }
    if (expectedUid) {
      for (const interest of discovery.interests) {
        if (interest.playerId === expectedUid) {
          interests.set(JSON.stringify([interest.clubId, interest.tournamentId, interest.playerId]), interest);
        }
      }
    }
    if (typeof discovery.page.databaseQueries === 'number') {
      databaseQueries += discovery.page.databaseQueries;
      hasDatabaseQueries = true;
    }
    if (!discovery.page.hasMore) return catalog(false, null);
    const nextCursor = discovery.page.nextCursor?.trim() ?? '';
    if (!nextCursor || nextCursor === cursor || seenCursors.has(nextCursor)) {
      if (!clubIds.size && !tournaments.size && !interests.size) throw new Error('Orbit Player tournament discovery returned an invalid cursor.');
      return catalog(true, null);
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  return catalog(true, cursor || null);
}

export function subscribeToPlayerTournaments(
  playerId: string | undefined,
  callback: (result: Awaited<ReturnType<typeof fetchPlayerTournaments>>) => void,
  onError: (error: Error) => void = () => undefined
) {
  let active = true;
  let refreshInFlight: Promise<void> | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  const refresh = () => {
    if (!active) return Promise.resolve();
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = fetchPlayerTournaments(playerId)
      .then((result) => {
        if (active) callback(result);
      })
      .catch((error) => {
        if (active) onError(error instanceof Error ? error : new Error('Unable to refresh tournaments.'));
      })
      .finally(() => {
        refreshInFlight = null;
      });
    return refreshInFlight;
  };
  const stopPolling = () => {
    if (!refreshTimer) return;
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  };
  const startPolling = () => {
    stopPolling();
    refreshTimer = setInterval(() => void refresh(), playerTournamentRefreshIntervalMs);
  };
  return {
    refresh,
    startPolling,
    stopPolling,
    unsubscribe() {
      active = false;
      stopPolling();
    }
  };
}

export async function expressTournamentInterest(tournament: PlayerTournament, player: PlayerAccount, mutationId: string) {
  const uid = ensureSignedInIdentity();
  if (uid !== player.id) throw new Error('The signed-in Orbit Player account does not match this profile.');
  if (!isTournamentInterestOpen(tournament)) throw new Error('The interest window for this tournament is closed.');
  const result = await submitRemoteTournamentMutation('POST', {
    clubId: tournament.clubId,
    tournamentId: tournament.id,
    mutationId
  }, uid);
  if (!result.interest) throw new Error('The tournament interest response was incomplete.');
  return result.interest;
}

export async function registerForTournament(tournament: PlayerTournament, player: PlayerAccount, mutationId: string) {
  const uid = ensureSignedInIdentity();
  if (uid !== player.id) throw new Error('The signed-in Orbit Player account does not match this profile.');
  if (tournament.registrationAvailable !== true || tournament.buyIn !== 0 ||
    tournament.rebuysAllowed && tournament.rebuyPrice !== 0 || tournament.addOnsAllowed && tournament.addOnPrice !== 0) {
    throw new Error('Only events without an entry, rebuy, or add-on payment can be registered in Orbit.');
  }
  if (!isTournamentInterestOpen(tournament)) throw new Error('The registration window for this event is closed.');
  return submitRemoteTournamentRegistration({ clubId: tournament.clubId, tournamentId: tournament.id, mutationId }, uid);
}

export async function withdrawTournamentInterest(
  tournament: PlayerTournament,
  interest: PlayerTournamentInterest,
  mutationId: string
) {
  const uid = ensureSignedInIdentity();
  if (interest.playerId !== uid || interest.clubId !== tournament.clubId || interest.tournamentId !== tournament.id) {
    throw new Error('You can only withdraw your own tournament interest.');
  }
  if (!tournament.withdrawalAllowed || Date.now() >= Date.parse(tournament.startsAt)) {
    throw new Error('Interest can no longer be withdrawn in Orbit. Contact the venue.');
  }
  return submitRemoteTournamentMutation('DELETE', {
    clubId: tournament.clubId,
    tournamentId: tournament.id,
    mutationId
  }, uid);
}
