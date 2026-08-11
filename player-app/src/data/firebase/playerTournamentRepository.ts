import { collection, getDocs, onSnapshot, query, where, type Unsubscribe } from 'firebase/firestore';
import { isPlayerVisibleClubName } from '../../domain/clubVisibility';
import { decodeTournamentEvent, decodeTournamentRegistration } from '../../domain/decoders/playerBoundaryDecoders';
import type { PlayerAccount, PlayerTournament, PlayerTournamentRegistration } from '../../domain/playerSync';
import { auth, db } from './firebaseClient';
import { ensureSignedInIdentity } from './playerAuth';
import { submitRemoteTournamentMutation } from '../api/playerHttpApi';

export async function fetchPlayerTournaments(playerId: string) {
  const clubsSnapshot = await getDocs(collection(db, 'clubs'));
  const visibleClubDocs = clubsSnapshot.docs.filter((clubDoc) => isPlayerVisibleClubName(clubDoc.data()?.name));
  const canReadRegistrations = Boolean(auth.currentUser && auth.currentUser.uid === playerId);
  const rows = await Promise.all(visibleClubDocs.map(async (clubDoc) => {
    const events = await getDocs(collection(db, 'clubs', clubDoc.id, 'tournaments'));
    const registrations = canReadRegistrations
      ? await getDocs(query(collection(db, 'clubs', clubDoc.id, 'tournamentRegistrations'), where('playerId', '==', playerId)))
      : null;
    return {
      tournaments: events.docs.map((eventDoc) => decodeTournamentEvent(eventDoc.data(), eventDoc.id, clubDoc.id)),
      registrations: registrations?.docs.map((registrationDoc) => decodeTournamentRegistration(registrationDoc.data())) ?? []
    };
  }));
  return {
    tournaments: rows.flatMap((row) => row.tournaments),
    registrations: rows.flatMap((row) => row.registrations)
  };
}

export function subscribeToPlayerTournaments(playerId: string, callback: (result: Awaited<ReturnType<typeof fetchPlayerTournaments>>) => void) {
  let active = true;
  let childUnsubscribers: Unsubscribe[] = [];
  const canReadRegistrations = Boolean(auth.currentUser && auth.currentUser.uid === playerId);
  // Snapshot listeners continue to provide future updates if this eager aggregate refresh fails.
  const refresh = () => fetchPlayerTournaments(playerId).then((result) => active && callback(result)).catch(() => undefined);
  const rootUnsubscribe = onSnapshot(collection(db, 'clubs'), (clubsSnapshot) => {
    childUnsubscribers.forEach((unsubscribe) => unsubscribe());
    childUnsubscribers = clubsSnapshot.docs
      .filter((clubDoc) => isPlayerVisibleClubName(clubDoc.data()?.name))
      .flatMap((clubDoc) => {
        const subscriptions = [onSnapshot(collection(db, 'clubs', clubDoc.id, 'tournaments'), refresh, () => undefined)];
        if (canReadRegistrations) {
          subscriptions.push(onSnapshot(query(collection(db, 'clubs', clubDoc.id, 'tournamentRegistrations'), where('playerId', '==', playerId)), refresh, () => undefined));
        }
        return subscriptions;
      });
    refresh();
  }, () => undefined);
  return () => {
    active = false;
    rootUnsubscribe();
    childUnsubscribers.forEach((unsubscribe) => unsubscribe());
  };
}

export async function registerForTournament(tournament: PlayerTournament, player: PlayerAccount) {
  const uid = ensureSignedInIdentity();
  if (uid !== player.id) throw new Error('The signed-in Orbit Player account does not match this profile.');
  if (tournament.registrationStatus !== 'open' || Date.now() >= Date.parse(tournament.registrationClosesAt)) {
    throw new Error('Registration for this tournament is closed.');
  }
  const now = new Date().toISOString();
  const registration: PlayerTournamentRegistration = {
    id: `${tournament.id}:${uid}`,
    tournamentId: tournament.id,
    clubId: tournament.clubId,
    playerId: uid,
    playerName: player.name,
    playerEmail: player.email,
    status: 'registered',
    rebuys: 0,
    addOns: 0,
    registeredAt: now,
    updatedAt: now
  };
  const result = await submitRemoteTournamentMutation('POST', {
    clubId: tournament.clubId,
    tournamentId: tournament.id,
    mutationId: `register:${tournament.id}:${uid}:${now}`
  });
  return Reflect.get(result, 'registration') as PlayerTournamentRegistration;
}

export async function unregisterFromTournament(tournament: PlayerTournament, registration: PlayerTournamentRegistration) {
  const uid = ensureSignedInIdentity();
  if (registration.playerId !== uid) throw new Error('You can only remove your own registration.');
  if (!tournament.unregisterAllowed || Date.now() >= Date.parse(tournament.startsAt)) {
    throw new Error('Self-unregistration is no longer available. Contact tournament staff.');
  }
  await submitRemoteTournamentMutation('DELETE', {
    clubId: tournament.clubId,
    tournamentId: tournament.id,
    mutationId: `unregister:${tournament.id}:${uid}:${new Date().toISOString()}`
  });
}
