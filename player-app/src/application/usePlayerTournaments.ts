import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { createSecureUuid } from '../security/secureIdentifier';
import {
  isSameTournamentInterest,
  tournamentScopeKey,
  type PlayerAccount,
  type PlayerTournament,
  type PlayerTournamentInterest,
  type PlayerTournamentRegistration
} from '../domain/playerSync';
import type { Screen } from '../domain/playerTypes';
import { expressTournamentInterest, getCurrentFirebasePlayer, registerForTournament, withdrawTournamentInterest, type FirebasePlayerIdentity } from '../data/orbitSyncApi';

type UsePlayerTournamentsOptions = {
  firebaseIdentity: FirebasePlayerIdentity | null;
  getClubMinimumAge(clubId: string): 18 | 21;
  player: PlayerAccount;
  requireVerifiedAge(returnScreen: Screen, action: string, minimumAge?: 18 | 21): boolean;
  setTournamentInterests: Dispatch<SetStateAction<PlayerTournamentInterest[]>>;
  tournaments?: PlayerTournament[];
};

export function createTournamentInterestMutationId() {
  return createSecureUuid();
}

export function usePlayerTournaments({ firebaseIdentity, getClubMinimumAge, player, requireVerifiedAge, setTournamentInterests, tournaments }: UsePlayerTournamentsOptions) {
  const [tournamentMessage, setTournamentMessage] = useState('');
  const [pendingTournamentKeys, setPendingTournamentKeys] = useState<string[]>([]);
  const [tournamentRegistrations, setTournamentRegistrations] = useState<Record<string, PlayerTournamentRegistration>>({});
  const inFlight = useRef(new Set<string>());
  const mutationIds = useRef(new Map<string, string>());
  const actionUid = useRef(firebaseIdentity?.uid ?? '');
  const actionGeneration = useRef(0);

  useEffect(() => {
    const nextUid = firebaseIdentity?.uid ?? '';
    if (actionUid.current === nextUid) return;
    actionUid.current = nextUid;
    actionGeneration.current += 1;
    inFlight.current.clear();
    mutationIds.current.clear();
    setPendingTournamentKeys([]);
    setTournamentMessage('');
    setTournamentRegistrations({});
  }, [firebaseIdentity?.uid]);

  useEffect(() => {
    // A newly accepted catalog is authoritative, including venue removals.
    // Successful local acknowledgements cover only the gap before that refresh.
    setTournamentRegistrations({});
  }, [tournaments]);

  const isCurrentTournamentAction = (expectedUid: string) => (
    actionUid.current === expectedUid && getCurrentFirebasePlayer()?.uid === expectedUid
  );

  const begin = (key: string) => {
    if (inFlight.current.has(key)) return false;
    inFlight.current.add(key);
    setPendingTournamentKeys(Array.from(inFlight.current));
    return true;
  };

  const finish = (key: string) => {
    inFlight.current.delete(key);
    setPendingTournamentKeys(Array.from(inFlight.current));
  };

  const expressInterest = async (tournament: PlayerTournament) => {
    const scopeKey = tournamentScopeKey(tournament);
    const actionKey = `express:${scopeKey}`;
    if (!firebaseIdentity || firebaseIdentity.uid !== player.id) {
      setTournamentMessage('Sign in under Profile before expressing tournament interest.');
      return;
    }
    const expectedUid = firebaseIdentity.uid;
    if (!requireVerifiedAge('tournaments', 'expressing tournament interest', getClubMinimumAge(tournament.clubId))) return;
    if (!begin(scopeKey)) return;
    setTournamentMessage('Expressing your nonbinding interest to the venue...');
    try {
      const mutationId = mutationIds.current.get(actionKey) ?? createTournamentInterestMutationId();
      mutationIds.current.set(actionKey, mutationId);
      const interest = await expressTournamentInterest(tournament, player, mutationId);
      if (!isCurrentTournamentAction(expectedUid)) return;
      mutationIds.current.delete(actionKey);
      setTournamentInterests((current) => [interest, ...current.filter((item) => !isSameTournamentInterest(item, interest))]);
      setTournamentMessage(`Interest expressed for ${tournament.name}. This does not reserve a seat or create any payment obligation; the venue confirms entry separately.`);
    } catch (error) {
      if (!isCurrentTournamentAction(expectedUid)) return;
      setTournamentMessage(error instanceof Error ? error.message : 'Unable to express tournament interest right now.');
    } finally {
      if (isCurrentTournamentAction(expectedUid)) finish(scopeKey);
    }
  };

  const withdrawInterest = async (tournament: PlayerTournament, interest: PlayerTournamentInterest) => {
    const scopeKey = tournamentScopeKey(tournament);
    const actionKey = `withdraw:${scopeKey}`;
    if (!firebaseIdentity || firebaseIdentity.uid !== player.id) {
      setTournamentMessage('Sign in under Profile before changing tournament interest.');
      return;
    }
    const expectedUid = firebaseIdentity.uid;
    if (!begin(scopeKey)) return;
    setTournamentMessage('Withdrawing your tournament interest...');
    try {
      const mutationId = mutationIds.current.get(actionKey) ?? createTournamentInterestMutationId();
      mutationIds.current.set(actionKey, mutationId);
      const result = await withdrawTournamentInterest(tournament, interest, mutationId);
      if (!isCurrentTournamentAction(expectedUid)) return;
      mutationIds.current.delete(actionKey);
      const updatedInterest = result.interest;
      setTournamentInterests((current) => updatedInterest
        ? [updatedInterest, ...current.filter((item) => !isSameTournamentInterest(item, updatedInterest))]
        : current.filter((item) => !isSameTournamentInterest(item, interest)));
      setTournamentMessage(`Interest withdrawn for ${tournament.name}.`);
    } catch (error) {
      if (!isCurrentTournamentAction(expectedUid)) return;
      setTournamentMessage(error instanceof Error ? error.message : 'Unable to withdraw tournament interest right now.');
    } finally {
      if (isCurrentTournamentAction(expectedUid)) finish(scopeKey);
    }
  };

  const registerTournament = async (tournament: PlayerTournament) => {
    const scopeKey = tournamentScopeKey(tournament);
    const actionKey = `register:${scopeKey}`;
    if (!firebaseIdentity || firebaseIdentity.uid !== player.id) {
      setTournamentMessage('Sign in under Profile before registering for an event.');
      return;
    }
    const expectedUid = firebaseIdentity.uid;
    const expectedGeneration = actionGeneration.current;
    const isCurrentRegistration = () => actionGeneration.current === expectedGeneration && isCurrentTournamentAction(expectedUid);
    if (!requireVerifiedAge('tournaments', 'registering for an event', getClubMinimumAge(tournament.clubId))) return;
    if (!begin(scopeKey)) return;
    setTournamentMessage('Registering for the event...');
    try {
      const mutationId = mutationIds.current.get(actionKey) ?? createTournamentInterestMutationId();
      mutationIds.current.set(actionKey, mutationId);
      const registration = await registerForTournament(tournament, player, mutationId);
      if (!isCurrentRegistration()) return;
      mutationIds.current.delete(actionKey);
      setTournamentRegistrations((current) => ({ ...current, [scopeKey]: registration }));
      setTournamentMessage(`Registered for ${tournament.name}. No payment was collected. Check in with the venue before play.`);
    } catch (error) {
      if (isCurrentRegistration()) setTournamentMessage(error instanceof Error ? error.message : 'Unable to register for this event.');
    } finally {
      if (isCurrentRegistration()) finish(scopeKey);
    }
  };

  return { expressInterest, pendingTournamentKeys, tournamentMessage, withdrawInterest, registerTournament, tournamentRegistrations };
}
