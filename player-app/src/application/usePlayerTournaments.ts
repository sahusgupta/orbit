import { useState, type Dispatch, type SetStateAction } from 'react';
import type { PlayerAccount, PlayerTournament, PlayerTournamentRegistration } from '../domain/playerSync';
import type { Screen } from '../domain/playerTypes';
import { registerForTournament, unregisterFromTournament, type FirebasePlayerIdentity } from '../data/orbitSyncApi';

type UsePlayerTournamentsOptions = {
  firebaseIdentity: FirebasePlayerIdentity | null;
  player: PlayerAccount;
  requireVerifiedAge(returnScreen: Screen, action: string): boolean;
  setTournamentRegistrations: Dispatch<SetStateAction<PlayerTournamentRegistration[]>>;
};

export function usePlayerTournaments({ firebaseIdentity, player, requireVerifiedAge, setTournamentRegistrations }: UsePlayerTournamentsOptions) {
  const [tournamentMessage, setTournamentMessage] = useState('');

  const registerTournament = async (tournament: PlayerTournament) => {
    if (!requireVerifiedAge('tournaments', 'registering for an event')) return;
    if (!firebaseIdentity || firebaseIdentity.uid !== player.id) {
      setTournamentMessage('Sign in to your Orbit Player account to register for this event.');
      return;
    }
    setTournamentMessage('Registering your free entry...');
    try {
      const registration = await registerForTournament(tournament, player);
      setTournamentRegistrations((current) => [registration, ...current.filter((item) => item.id !== registration.id)]);
      setTournamentMessage(`You're registered for the ${tournament.name}. Your entry is free.`);
    } catch (error) {
      setTournamentMessage(error instanceof Error ? error.message : 'Unable to register right now.');
    }
  };

  const unregisterTournament = async (tournament: PlayerTournament, registration: PlayerTournamentRegistration) => {
    setTournamentMessage('Removing your registration...');
    try {
      await unregisterFromTournament(tournament, registration);
      setTournamentRegistrations((current) => current.filter((item) => item.id !== registration.id));
      setTournamentMessage(`Your registration for ${tournament.name} was removed.`);
    } catch (error) {
      setTournamentMessage(error instanceof Error ? error.message : 'Unable to unregister right now.');
    }
  };

  return { registerTournament, tournamentMessage, unregisterTournament };
}
