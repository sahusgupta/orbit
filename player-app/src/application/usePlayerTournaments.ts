import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { PlayerAccount, PlayerTournament, PlayerTournamentRegistration } from '../domain/playerSync';
import type { Screen } from '../domain/playerTypes';
import { registerForTournament, unregisterFromTournament, type FirebasePlayerIdentity } from '../data/orbitSyncApi';

type UsePlayerTournamentsOptions = {
  firebaseIdentity: FirebasePlayerIdentity | null;
  getClubMinimumAge(clubId: string): 18 | 21;
  player: PlayerAccount;
  requireVerifiedAge(returnScreen: Screen, action: string, minimumAge?: 18 | 21): boolean;
  setTournamentRegistrations: Dispatch<SetStateAction<PlayerTournamentRegistration[]>>;
};

export function usePlayerTournaments({ firebaseIdentity, getClubMinimumAge, player, requireVerifiedAge, setTournamentRegistrations }: UsePlayerTournamentsOptions) {
  const [tournamentMessage, setTournamentMessage] = useState('');
  const [pendingTournamentIds, setPendingTournamentIds] = useState<string[]>([]);
  const inFlight = useRef(new Set<string>());
  const mutationIds = useRef(new Map<string, string>());

  const begin = (key: string) => {
    if (inFlight.current.has(key)) return false;
    inFlight.current.add(key);
    setPendingTournamentIds(Array.from(inFlight.current, (value) => value.split(':').slice(1).join(':')));
    return true;
  };

  const finish = (key: string) => {
    inFlight.current.delete(key);
    setPendingTournamentIds(Array.from(inFlight.current, (value) => value.split(':').slice(1).join(':')));
  };

  const registerTournament = async (tournament: PlayerTournament) => {
    const actionKey = `register:${tournament.id}`;
    if (!requireVerifiedAge('tournaments', 'registering for an event', getClubMinimumAge(tournament.clubId))) return;
    if (!firebaseIdentity || firebaseIdentity.uid !== player.id) {
      setTournamentMessage('Sign in to your Orbit Player account to register for this event.');
      return;
    }
    if (!begin(actionKey)) return;
    setTournamentMessage('Registering your free entry...');
    try {
      const mutationId = mutationIds.current.get(actionKey) ?? `register:${tournament.id}:${player.id}:${Date.now()}`;
      mutationIds.current.set(actionKey, mutationId);
      const registration = await registerForTournament(tournament, player, mutationId);
      mutationIds.current.delete(actionKey);
      setTournamentRegistrations((current) => [registration, ...current.filter((item) => item.id !== registration.id)]);
      setTournamentMessage(`You're registered for the ${tournament.name}. Your entry is free.`);
    } catch (error) {
      setTournamentMessage(error instanceof Error ? error.message : 'Unable to register right now.');
    } finally {
      finish(actionKey);
    }
  };

  const unregisterTournament = async (tournament: PlayerTournament, registration: PlayerTournamentRegistration) => {
    const actionKey = `unregister:${tournament.id}`;
    if (!begin(actionKey)) return;
    setTournamentMessage('Removing your registration...');
    try {
      const mutationId = mutationIds.current.get(actionKey) ?? `unregister:${tournament.id}:${player.id}:${Date.now()}`;
      mutationIds.current.set(actionKey, mutationId);
      await unregisterFromTournament(tournament, registration, mutationId);
      mutationIds.current.delete(actionKey);
      setTournamentRegistrations((current) => current.filter((item) => item.id !== registration.id));
      setTournamentMessage(`Your registration for ${tournament.name} was removed.`);
    } catch (error) {
      setTournamentMessage(error instanceof Error ? error.message : 'Unable to unregister right now.');
    } finally {
      finish(actionKey);
    }
  };

  return { pendingTournamentIds, registerTournament, tournamentMessage, unregisterTournament };
}
