import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { PlayerPlatform } from '../app/playerPlatform';
import { hasRunningTable } from '../domain/discovery';
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
  platform: PlayerPlatform;
  player: PlayerAccount;
  requireVerifiedAge(returnScreen: Screen, action: string, minimumAge?: 18 | 21): boolean;
  setClubMembershipMessage: Dispatch<SetStateAction<string>>;
  setClubs: Dispatch<SetStateAction<PlayerClubSnapshot[]>>;
  setScreen: Dispatch<SetStateAction<Screen>>;
  setSelectedClubId: Dispatch<SetStateAction<string>>;
  setSyncStatus: Dispatch<SetStateAction<string>>;
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
  platform,
  player,
  requireVerifiedAge,
  setClubMembershipMessage,
  setClubs,
  setScreen,
  setSelectedClubId,
  setSyncStatus
}: UsePlayerClubsOptions) {
  const [pendingSeatAfterMembership, setPendingSeatAfterMembership] = useState<{ club: PlayerClubSnapshot; game: PlayerSyncGame } | null>(null);
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

  const replaceSyncedClub = (snapshot: PlayerClubSnapshot) => {
    setClubs((current) => {
      const exists = current.some((club) => club.club.id === snapshot.club.id);
      return exists ? current.map((club) => (club.club.id === snapshot.club.id ? snapshot : club)) : [snapshot, ...current];
    });
    setSelectedClubId(snapshot.club.id);
  };

  const updateClubSnapshot = (club: PlayerClubSnapshot, updater: (club: PlayerClubSnapshot) => PlayerClubSnapshot) => {
    setClubs((current) => current.map((snapshot) => (snapshot.club.id === club.club.id ? updater(snapshot) : snapshot)));
  };

  const openSeatRequestDraft = (club: PlayerClubSnapshot, game: PlayerSyncGame) => {
    if (!requireCurrentPublishedData('seat')) return;
    setSelectedClubId(club.club.id);
    setSeatRequestMessage('');
    setSeatRequestDraft({
      club,
      game,
      attendance: getInitialSeatRequestAttendance(game),
      expectedArrivalTime: '',
      availabilityStartTime: '',
      availabilityEndTime: ''
    });
  };

  const resumePendingSeatRequest = (club: PlayerClubSnapshot) => {
    if (pendingSeatAfterMembership?.club.club.id !== club.club.id) return;
    if (getPlayerSeatRequestAccess(club, player, clockNow) === 'active') {
      openSeatRequestDraft(club, pendingSeatAfterMembership.game);
    } else {
      setSelectedClubId(club.club.id);
      setScreen('clubs');
      setClubMembershipMessage(`${club.club.name} received your membership request. Wait for the venue to activate it before requesting a seat.`);
    }
    setPendingSeatAfterMembership(null);
  };

  const requestMembership = async (club: PlayerClubSnapshot, membershipOption: PlayerMembershipOption) => {
    if (!requireCurrentPublishedData('club')) return;
    if (!requireVerifiedAge('clubs', 'requesting membership', club.club.minimumAge === 18 ? 18 : 21)) return;
    if (!beginAction()) return;
    setSelectedClubId(club.club.id);
    const request = buildJoinRequest(player, club.club.id, membershipOption);
    const expectedUid = request.player.id;
    try {
      setSyncStatus('Sending membership request...');
      const result = await submitMembershipRequest(request);
      if (!isCurrentPlayerAction(expectedUid)) return;
      if (result.ok) {
        replaceSyncedClub(result.snapshot);
        setScreen('clubs');
        setClubMembershipMessage(isPublishedFreeMembership(membershipOption)
          ? `Membership request sent. ${result.snapshot.club.name} published no fee for this option and will check your physical ID in person.`
          : `Membership request sent. ${result.snapshot.club.name} will review it. Confirm any fee and physical-ID requirements with the venue; any payment happens in person.`);
        setSyncStatus(`Membership request synced with ${result.snapshot.club.name}`);
        resumePendingSeatRequest(result.snapshot);
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

  const joinWaitlist = (club: PlayerClubSnapshot, game: PlayerSyncGame) => {
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
    openSeatRequestDraft(club, game);
  };

  const submitSeatRequest = async () => {
    if (!seatRequestDraft) return;
    if (!requireCurrentPublishedData('seat')) return;
    const { club, game, attendance, expectedArrivalTime, availabilityStartTime, availabilityEndTime } = seatRequestDraft;
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
      updateClubSnapshot(club, (snapshot) => applyWaitlistRequest(snapshot, request));
      setSyncStatus('Sending seat request...');
      const result = await submitWaitlistRequest(request);
      if (!isCurrentPlayerAction(expectedUid)) return;
      if (result.ok) {
        replaceSyncedClub(result.snapshot);
        setSeatRequestDraft(null);
        setSyncStatus(`Seat request synced with ${result.snapshot.club.name}`);
        return;
      }
      replaceSyncedClub(club);
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
      updateClubSnapshot(club, (snapshot) => applyWaitlistRequest(snapshot, request));
      setSyncStatus('Cancelling seat request...');
      const result = await submitWaitlistRequest(request);
      if (!isCurrentPlayerAction(expectedUid)) return;
      if (result.ok) {
        replaceSyncedClub(result.snapshot);
        setSeatRequestDraft(null);
        setSyncStatus(`Seat request cancelled with ${result.snapshot.club.name}`);
        return;
      }
      replaceSyncedClub(club);
      const failure = `Cancellation was not sent. ${result.error}`;
      setSyncStatus(failure);
      setGameRequestMessage(failure);
      setClubMembershipMessage(`Could not cancel the seat request. ${result.error}`);
    } finally {
      if (isCurrentPlayerAction(expectedUid)) finishAction();
    }
  };

  const openDirections = (club: PlayerClubSnapshot) => {
    const address = club.club.address?.trim();
    if (!address) {
      setSyncStatus(`${club.club.name} has not published an address, so directions are unavailable.`);
      return;
    }
    platform.openDirections(address);
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
