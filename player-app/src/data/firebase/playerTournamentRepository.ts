import type { PlayerAccount, PlayerTournament, PlayerTournamentRegistration } from '../../domain/playerSync';
import { fetchRemotePlayerDiscovery, submitRemoteTournamentMutation } from '../api/playerHttpApi';
import { subscribeToClubCommitMarker } from '../subscriptions/clubCommitMarker';
import { ensureSignedInIdentity } from './playerAuth';

export async function fetchPlayerTournaments(playerId: string) {
  const uid = ensureSignedInIdentity();
  if (uid !== playerId) throw new Error('The signed-in Orbit Player account does not match this profile.');
  const discovery = await fetchRemotePlayerDiscovery();
  return {
    tournaments: discovery.tournaments,
    registrations: discovery.registrations.filter((registration) => registration.playerId === uid),
    page: discovery.page
  };
}

export function subscribeToPlayerTournaments(
  playerId: string,
  callback: (result: Awaited<ReturnType<typeof fetchPlayerTournaments>>) => void,
  onError: (error: Error) => void = () => undefined
) {
  let active = true;
  let refreshInFlight: Promise<void> | null = null;
  const refresh = () => {
    if (!active || refreshInFlight) return;
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
  };
  const commitMarkerUnsubscribe = subscribeToClubCommitMarker(refresh, onError);
  return () => {
    active = false;
    commitMarkerUnsubscribe();
  };
}

export async function registerForTournament(tournament: PlayerTournament, player: PlayerAccount, mutationId?: string) {
  const uid = ensureSignedInIdentity();
  if (uid !== player.id) throw new Error('The signed-in Orbit Player account does not match this profile.');
  if (tournament.registrationStatus !== 'open' || Date.now() >= Date.parse(tournament.registrationClosesAt)) {
    throw new Error('Registration for this tournament is closed.');
  }
  const now = new Date().toISOString();
  const result = await submitRemoteTournamentMutation('POST', {
    clubId: tournament.clubId,
    tournamentId: tournament.id,
    mutationId: mutationId || `register:${tournament.id}:${uid}:${now}`
  });
  return Reflect.get(result, 'registration') as PlayerTournamentRegistration;
}

export async function unregisterFromTournament(tournament: PlayerTournament, registration: PlayerTournamentRegistration, mutationId?: string) {
  const uid = ensureSignedInIdentity();
  if (registration.playerId !== uid) throw new Error('You can only remove your own registration.');
  if (!tournament.unregisterAllowed || Date.now() >= Date.parse(tournament.startsAt)) {
    throw new Error('Self-unregistration is no longer available. Contact tournament staff.');
  }
  await submitRemoteTournamentMutation('DELETE', {
    clubId: tournament.clubId,
    tournamentId: tournament.id,
    mutationId: mutationId || `unregister:${tournament.id}:${uid}:${new Date().toISOString()}`
  });
}
