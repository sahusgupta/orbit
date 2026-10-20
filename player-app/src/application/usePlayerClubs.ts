import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { PlayerPlatform } from '../app/playerPlatform';
import { getClubCoordinate, hasRunningTable } from '../domain/discovery';
import {
  getPlayerSeatRequestAccess,
  type PlayerAccount,
  type PlayerClubSnapshot,
  type PlayerMembershipOption,
  type PlayerSyncGame,
  type PlayerWaitlistEntry
} from '../domain/playerSync';
import type { Screen, SeatRequestDraft } from '../domain/playerTypes';
import { applyWaitlistRequest, buildJoinRequest, buildWaitRequest } from '../data/playerRequests';
import { getCurrentFirebasePlayer, submitMembershipRequest, submitWaitlistRequest } from '../data/orbitSyncApi';

type UsePlayerClubsOptions = {
  actionsReady: boolean;
  clockNow: number;
  clubs: PlayerClubSnapshot[];
  platform: PlayerPlatform;
  player: PlayerAccount;
  requireVerifiedAge(returnScreen: Screen, action: string, minimumAge?: 18 | 21): boolean;
  setClubMembershipMessage: Dispatch<SetStateAction<string>>;
  setClubs: Dispatch<SetStateAction<PlayerClubSnapshot[]>>;
  setScreen: Dispatch<SetStateAction<Screen>>;
  setSelectedClubId: Dispatch<SetStateAction<string>>;
  setSyncStatus: Dispatch<SetStateAction<string>>;
  onSeatRequestSuccess?: (result: { clubId: string; gameId: string; requestId: string; matchAttribution?: SeatRequestDraft['matchAttribution'] }) => void;
};

export function isPublishedFreeMembership(option: PlayerMembershipOption) {
  const label = option.priceLabel.trim();
  return /^free$/i.test(label) || /^\$?0(?:\.0{1,2})?$/.test(label);
}

export function getInitialSeatRequestAttendance(game: PlayerSyncGame): SeatRequestDraft['attendance'] {
  return hasRunningTable(game) ? 'arrived' : 'interested';
}

export function getSeatRequestTableId(game: PlayerSyncGame, attendance: SeatRequestDraft['attendance']) {
  if (attendance === 'interested') return undefined;
  return game.openTables.find((table) => table.status === 'Running')?.id;
}

export function usePlayerClubs({
  actionsReady,
  clockNow,
  clubs,
  platform,
  player,
  requireVerifiedAge,
  setClubMembershipMessage,
  setClubs,
  setScreen,
  setSelectedClubId,
  setSyncStatus,
  onSeatRequestSuccess
}: UsePlayerClubsOptions) {
  const [pendingSeatAfterMembership, setPendingSeatAfterMembership] = useState<{ club: PlayerClubSnapshot; game: PlayerSyncGame } | null>(null);
  const [membershipResume, setMembershipResume] = useState<{ clubId: string; playerId: string } | null>(null);
  const handledMembershipResume = useRef<typeof membershipResume>(null);
  const [seatRequestDraft, setSeatRequestDraft] = useState<SeatRequestDraft | null>(null);
  const [seatRequestMessage, setSeatRequestMessage] = useState('');
  const [gameRequestMessage, setGameRequestMessage] = useState('');
  const [clubActionPending, setClubActionPending] = useState(false);
  const actionInFlight = useRef(false);
  const actionPlayerUid = useRef(player.id);
  const actionsReadyRef = useRef(actionsReady);
  actionsReadyRef.current = actionsReady;

  useEffect(() => {
    if (actionPlayerUid.current === player.id) return;
    actionPlayerUid.current = player.id;
    actionInFlight.current = false;
    setClubActionPending(false);
    setPendingSeatAfterMembership(null);
    setMembershipResume(null);
    handledMembershipResume.current = null;
    setSeatRequestDraft(null);
    setSeatRequestMessage('');
    setGameRequestMessage('');
  }, [player.id]);

  const isCurrentPlayerAction = (expectedUid: string) => (
    actionPlayerUid.current === expectedUid && getCurrentFirebasePlayer()?.uid === expectedUid
  );

  const requireCurrentPublishedData = (messageTarget: 'club' | 'seat' | 'sync') => {
    if (actionsReadyRef.current) return true;
    const message = 'Refresh published venue data before changing a membership or seat request.';
    if (messageTarget === 'club') setClubMembershipMessage(message);
    if (messageTarget === 'seat') setSeatRequestMessage(message);
    setSyncStatus(message);
    return false;
  };

  const beginAction = () => {
    if (actionInFlight.current) return false;
    actionInFlight.current = true;
    setClubActionPending(true);
    return true;
  };

  const finishAction = () => {
    actionInFlight.current = false;
    setClubActionPending(false);
  };

  const updateClubSnapshot = (club: PlayerClubSnapshot, updater: (club: PlayerClubSnapshot) => PlayerClubSnapshot) => {
    const before = clubs.find((snapshot) => snapshot.club.id === club.club.id);
    if (!before) return { accept: (_snapshot: PlayerClubSnapshot) => undefined, rollback: () => undefined };
    const optimistic = updater(before);
    const replaceExpected = (expected: PlayerClubSnapshot, replacement: PlayerClubSnapshot) => {
      setClubs((current) => {
        const index = current.indexOf(expected);
        if (index < 0 || replacement.club.id !== expected.club.id) return current;
        const updated = [...current];
        updated[index] = replacement;
        return updated;
      });
    };
    if (optimistic !== before) replaceExpected(before, optimistic);
    // A publication replaces snapshot objects. Neither a response nor rollback
    // may overwrite that intervening state or restore a removed venue.
    return {
      accept: (snapshot: PlayerClubSnapshot) => replaceExpected(optimistic, snapshot),
      rollback: () => replaceExpected(optimistic, before)
    };
  };

  const openSeatRequestDraft = (club: PlayerClubSnapshot, game: PlayerSyncGame, matchAttribution?: SeatRequestDraft['matchAttribution']) => {
    if (!requireCurrentPublishedData('seat')) return;
    setSelectedClubId(club.club.id);
    setSeatRequestMessage('');
    setSeatRequestDraft({
      club,
      game,
      attendance: getInitialSeatRequestAttendance(game),
      expectedArrivalTime: '',
      availabilityStartTime: '',
      availabilityEndTime: '',
      ...(matchAttribution ? { matchAttribution } : {})
    });
  };

  useEffect(() => {
    if (!membershipResume || handledMembershipResume.current === membershipResume) return;
    handledMembershipResume.current = membershipResume;
    setMembershipResume(null);
    if (!isCurrentPlayerAction(membershipResume.playerId)
      || pendingSeatAfterMembership?.club.club.id !== membershipResume.clubId) return;
    setPendingSeatAfterMembership(null);
    // Read the committed publication after the conditional response update.
    const club = clubs.find((snapshot) => snapshot.club.id === membershipResume.clubId);
    const game = club?.games.find((candidate) => candidate.id === pendingSeatAfterMembership.game.id);
    if (!club || !game) return;
    const access = getPlayerSeatRequestAccess(club, player, clockNow);
    if (access === 'active') {
      openSeatRequestDraft(club, game);
    } else if (access === 'pending') {
      setSelectedClubId(club.club.id);
      setScreen('clubs');
      setClubMembershipMessage(`${club.club.name} received your membership request. Wait for the venue to activate it before requesting a seat.`);
    }
  }, [membershipResume, pendingSeatAfterMembership, clubs, player.id, clockNow]);

  const requestMembership = async (club: PlayerClubSnapshot, membershipOption: PlayerMembershipOption) => {
    if (!requireCurrentPublishedData('club')) return;
    if (!requireVerifiedAge('clubs', 'requesting membership', club.club.minimumAge === 18 ? 18 : 21)) return;
    if (!beginAction()) return;
    setSelectedClubId(club.club.id);
    const request = buildJoinRequest(player, club.club.id, membershipOption);
    const expectedUid = request.player.id;
    try {
      const update = updateClubSnapshot(club, (snapshot) => snapshot);
      setSyncStatus('Sending membership request...');
      const result = await submitMembershipRequest(request);
      if (!isCurrentPlayerAction(expectedUid)) return;
      if (result.ok) {
        update.accept(result.snapshot);
        setScreen('clubs');
        setClubMembershipMessage(isPublishedFreeMembership(membershipOption)
          ? `Membership request sent. ${result.snapshot.club.name} published no fee for this option and will check your physical ID in person.`
          : `Membership request sent. ${result.snapshot.club.name} will review it. Confirm any fee and physical-ID requirements with the venue; any payment happens in person.`);
        setSyncStatus(`Membership request synced with ${result.snapshot.club.name}`);
        setMembershipResume({ clubId: club.club.id, playerId: expectedUid });
        return;
      }
      setSyncStatus(`Membership request failed - ${result.error}`);
      setClubMembershipMessage(`Could not send your membership request. ${result.error}`);
      setScreen('clubs');
    } finally {
      if (isCurrentPlayerAction(expectedUid)) finishAction();
    }
  };

  const openClubSignup = (club: PlayerClubSnapshot) => {
    if (!requireCurrentPublishedData('club')) return;
    setSelectedClubId(club.club.id);
    if (!requireVerifiedAge('clubSignup', 'requesting membership', club.club.minimumAge === 18 ? 18 : 21)) return;
    setClubMembershipMessage('');
    setScreen('clubSignup');
  };

  const joinWaitlist = (club: PlayerClubSnapshot, game: PlayerSyncGame, matchAttribution?: SeatRequestDraft['matchAttribution']) => {
    if (!requireCurrentPublishedData('seat')) return;
    const access = getPlayerSeatRequestAccess(club, player, clockNow);
    if (access === 'pending') {
      setSelectedClubId(club.club.id);
      setScreen('clubs');
      setClubMembershipMessage(`Wait for ${club.club.name} to activate your membership before requesting a seat.`);
      return;
    }
    if (access === 'renewal') {
      setSelectedClubId(club.club.id);
      setScreen('clubs');
      setClubMembershipMessage(`Renew your ${club.club.name} membership before requesting a seat.`);
      return;
    }
    if (!requireVerifiedAge('clubs', 'requesting a seat', club.club.minimumAge === 18 ? 18 : 21)) return;
    if (access === 'missing') {
      setPendingSeatAfterMembership({ club, game });
      setSelectedClubId(club.club.id);
      openClubSignup(club);
      setClubMembershipMessage(`Choose a published membership option for ${club.club.name}. Your ${game.name} seat request can continue after the venue activates your membership.`);
      return;
    }
    openSeatRequestDraft(club, game, matchAttribution);
  };

  const submitSeatRequest = async () => {
    if (!seatRequestDraft) return;
    if (!requireCurrentPublishedData('seat')) return;
    const { club, game, attendance, expectedArrivalTime, availabilityStartTime, availabilityEndTime, matchAttribution } = seatRequestDraft;
    if (attendance === 'confirmed' && !expectedArrivalTime.trim()) {
      setSeatRequestMessage('Enter what time you expect to arrive.');
      return;
    }
    if (attendance === 'interested' && !availabilityStartTime.trim()) {
      setSeatRequestMessage('Enter the time or start of the time range you would come.');
      return;
    }
    if (!beginAction()) return;
    const request = buildWaitRequest(
      player,
      club.club.id,
      game.id,
      getSeatRequestTableId(game, attendance),
      'join',
      attendance,
      expectedArrivalTime.trim() || undefined,
      availabilityStartTime.trim() || undefined,
      availabilityEndTime.trim() || undefined
    );
    const expectedUid = request.player.id;
    try {
      setSeatRequestMessage('');
      setGameRequestMessage('');
      const update = updateClubSnapshot(club, (snapshot) => applyWaitlistRequest(snapshot, request));
      setSyncStatus('Sending seat request...');
      const result = await submitWaitlistRequest(request);
      if (!isCurrentPlayerAction(expectedUid)) return;
      if (result.ok) {
        update.accept(result.snapshot);
        setSeatRequestDraft(null);
        setSyncStatus(`Seat request synced with ${result.snapshot.club.name}`);
        try { onSeatRequestSuccess?.({ clubId: club.club.id, gameId: game.id, requestId: request.id,
          ...(matchAttribution ? { matchAttribution } : {}) }); }
        catch { /* Telemetry cannot change a successful venue request. */ }
        return;
      }
      update.rollback();
      const failure = `Seat request was not sent. ${result.error}`;
      setSeatRequestMessage(failure);
      setSyncStatus(failure);
    } finally {
      if (isCurrentPlayerAction(expectedUid)) finishAction();
    }
  };

  const cancelWaitlist = async (club: PlayerClubSnapshot, game: PlayerSyncGame, entry: PlayerWaitlistEntry) => {
    if (!requireCurrentPublishedData('sync')) return;
    if (!beginAction()) return;
    setSelectedClubId(club.club.id);
    const request = buildWaitRequest(player, club.club.id, game.id, entry.tableId, 'cancel');
    const expectedUid = request.player.id;
    try {
      setGameRequestMessage('');
      const update = updateClubSnapshot(club, (snapshot) => applyWaitlistRequest(snapshot, request));
      setSyncStatus('Cancelling seat request...');
      const result = await submitWaitlistRequest(request);
      if (!isCurrentPlayerAction(expectedUid)) return;
      if (result.ok) {
        update.accept(result.snapshot);
        setSeatRequestDraft(null);
        setSyncStatus(`Seat request cancelled with ${result.snapshot.club.name}`);
        return;
      }
      update.rollback();
      const failure = `Cancellation was not sent. ${result.error}`;
      setSyncStatus(failure);
      setGameRequestMessage(failure);
      setClubMembershipMessage(`Could not cancel the seat request. ${result.error}`);
    } finally {
      if (isCurrentPlayerAction(expectedUid)) finishAction();
    }
  };

  const openDirections = (club: PlayerClubSnapshot) => {
    const address = club.club.address?.trim() ?? '';
    const coordinate = getClubCoordinate(club);
    if (!address && !coordinate) {
      setSyncStatus(`${club.club.name} has not published an address, so directions are unavailable.`);
    }
    void Promise.resolve(coordinate ? platform.openDirections(address, coordinate) : platform.openDirections(address)).then((result) => {
      if (result && !result.ok) setSyncStatus(result.error);
    });
  };

  const submitMembershipApplication = async (club: PlayerClubSnapshot, membershipOption?: PlayerMembershipOption) => {
    if (!player.id || !player.name.trim()) {
      setClubMembershipMessage('Finish creating your Orbit profile before applying.');
      return;
    }
    if (!membershipOption) {
      setClubMembershipMessage(`${club.club.name} has not published a membership option to request in Orbit.`);
      return;
    }
    await requestMembership(club, membershipOption);
  };

  return {
    cancelWaitlist,
    clubActionPending,
    gameRequestMessage,
    joinWaitlist,
    openClubSignup,
    openDirections,
    seatRequestDraft,
    seatRequestMessage,
    setSeatRequestDraft,
    setSeatRequestMessage,
    submitMembershipApplication,
    submitSeatRequest
  };
}
