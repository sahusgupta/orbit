import { isTournamentInterestOpen, type PlayerAccount, type PlayerTournament, type PlayerTournamentInterest } from '../../domain/playerSync';
import { fetchPublicPlayerDiscovery, fetchRemotePlayerDiscovery, submitRemoteTournamentMutation } from '../api/playerHttpApi';
import { ensureSignedInIdentity, getCurrentFirebasePlayer } from './playerAuth';

export const playerTournamentRefreshIntervalMs = 60_000;

export async function fetchPlayerTournaments(playerId?: string) {
  const signedIn = getCurrentFirebasePlayer();
  if (signedIn && (!playerId || signedIn.uid !== playerId)) {
    throw new Error('The signed-in Orbit Player account does not match this profile.');
  }
  const discovery = signedIn ? await fetchRemotePlayerDiscovery('', 50, signedIn.uid) : await fetchPublicPlayerDiscovery();
  return {
    tournaments: discovery.tournaments,
    interests: signedIn
      ? discovery.interests.filter((interest) => interest.playerId === signedIn.uid && interest.status === 'interested')
      : [],
    page: discovery.page
  };
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
