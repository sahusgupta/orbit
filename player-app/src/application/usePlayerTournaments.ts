import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { createSecureUuid } from '../security/secureIdentifier';
import type { PlayerAccount, PlayerTournament, PlayerTournamentInterest } from '../domain/playerSync';
import type { Screen } from '../domain/playerTypes';
import { expressTournamentInterest, getCurrentFirebasePlayer, withdrawTournamentInterest, type FirebasePlayerIdentity } from '../data/orbitSyncApi';

type UsePlayerTournamentsOptions = {
  firebaseIdentity: FirebasePlayerIdentity | null;
  getClubMinimumAge(clubId: string): 18 | 21;
  player: PlayerAccount;
  requireVerifiedAge(returnScreen: Screen, action: string, minimumAge?: 18 | 21): boolean;
  setTournamentInterests: Dispatch<SetStateAction<PlayerTournamentInterest[]>>;
};

export function createTournamentInterestMutationId() {
  return createSecureUuid();
}

export function usePlayerTournaments({ firebaseIdentity, getClubMinimumAge, player, requireVerifiedAge, setTournamentInterests }: UsePlayerTournamentsOptions) {
  const [tournamentMessage, setTournamentMessage] = useState('');
  const [pendingTournamentIds, setPendingTournamentIds] = useState<string[]>([]);
  const inFlight = useRef(new Set<string>());
  const mutationIds = useRef(new Map<string, string>());
  const actionUid = useRef(firebaseIdentity?.uid ?? '');

  useEffect(() => {
    const nextUid = firebaseIdentity?.uid ?? '';
    if (actionUid.current === nextUid) return;
    actionUid.current = nextUid;
    inFlight.current.clear();
    mutationIds.current.clear();
    setPendingTournamentIds([]);
    setTournamentMessage('');
  }, [firebaseIdentity?.uid]);

  const isCurrentTournamentAction = (expectedUid: string) => (
    actionUid.current === expectedUid && getCurrentFirebasePlayer()?.uid === expectedUid
  );

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

  const expressInterest = async (tournament: PlayerTournament) => {
    const actionKey = `express:${tournament.id}`;
    if (!firebaseIdentity || firebaseIdentity.uid !== player.id) {
      setTournamentMessage('Sign in under Profile before expressing tournament interest.');
      return;
    }
    const expectedUid = firebaseIdentity.uid;
    if (!requireVerifiedAge('tournaments', 'expressing tournament interest', getClubMinimumAge(tournament.clubId))) return;
    if (!begin(actionKey)) return;
    setTournamentMessage('Expressing your nonbinding interest to the venue...');
    try {
      const mutationId = mutationIds.current.get(actionKey) ?? createTournamentInterestMutationId();
      mutationIds.current.set(actionKey, mutationId);
      const interest = await expressTournamentInterest(tournament, player, mutationId);
      if (!isCurrentTournamentAction(expectedUid)) return;
      mutationIds.current.delete(actionKey);
      setTournamentInterests((current) => [interest, ...current.filter((item) => item.id !== interest.id && item.tournamentId !== interest.tournamentId)]);
      setTournamentMessage(`Interest expressed for ${tournament.name}. This does not reserve a seat or create any payment obligation; the venue confirms entry separately.`);
    } catch (error) {
      if (!isCurrentTournamentAction(expectedUid)) return;
      setTournamentMessage(error instanceof Error ? error.message : 'Unable to express tournament interest right now.');
    } finally {
      if (isCurrentTournamentAction(expectedUid)) finish(actionKey);
    }
  };

  const withdrawInterest = async (tournament: PlayerTournament, interest: PlayerTournamentInterest) => {
    const actionKey = `withdraw:${tournament.id}`;
    if (!firebaseIdentity || firebaseIdentity.uid !== player.id) {
      setTournamentMessage('Sign in under Profile before changing tournament interest.');
      return;
    }
    const expectedUid = firebaseIdentity.uid;
    if (!begin(actionKey)) return;
    setTournamentMessage('Withdrawing your tournament interest...');
    try {
      const mutationId = mutationIds.current.get(actionKey) ?? createTournamentInterestMutationId();
      mutationIds.current.set(actionKey, mutationId);
      const result = await withdrawTournamentInterest(tournament, interest, mutationId);
      if (!isCurrentTournamentAction(expectedUid)) return;
      mutationIds.current.delete(actionKey);
      setTournamentInterests((current) => result.interest
        ? [result.interest, ...current.filter((item) => item.id !== result.interest?.id && item.tournamentId !== result.interest?.tournamentId)]
        : current.filter((item) => item.id !== interest.id));
      setTournamentMessage(`Interest withdrawn for ${tournament.name}.`);
    } catch (error) {
      if (!isCurrentTournamentAction(expectedUid)) return;
      setTournamentMessage(error instanceof Error ? error.message : 'Unable to withdraw tournament interest right now.');
    } finally {
      if (isCurrentTournamentAction(expectedUid)) finish(actionKey);
    }
  };

  return { expressInterest, pendingTournamentIds, tournamentMessage, withdrawInterest };
}
