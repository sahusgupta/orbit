import { useState, type Dispatch, type SetStateAction } from 'react';
import type { PlayerPlatform } from '../app/playerPlatform';
import { getClubMembershipPrices, getClubProductLabel } from '../domain/clubAccess';
import { isActivePlayerGame } from '../domain/discovery';
import {
  isMembershipCurrentlyActive,
  isPlayerMembership,
  type ClubMembershipPaymentMethod,
  type ClubMembershipPlan,
  type PlayerAccount,
  type PlayerClubMembershipRecord,
  type PlayerClubSnapshot,
  type PlayerMembershipOption,
  type PlayerSyncGame,
  type PlayerWaitlistEntry
} from '../domain/playerSync';
import type { ClubAccessProduct, Screen, SeatRequestDraft } from '../domain/playerTypes';
import { applyMembershipRequest, applyWaitlistRequest, buildJoinRequest, buildWaitRequest } from '../data/playerRequests';
import {
  createClubMembershipCheckout,
  isSyncConfigured,
  submitMembershipRequest,
  submitWaitlistRequest,
  updatePlayerClubMembership,
  type FirebasePlayerIdentity
} from '../data/orbitSyncApi';

type UsePlayerClubsOptions = {
  clockNow: number;
  firebaseIdentity: FirebasePlayerIdentity | null;
  platform: PlayerPlatform;
  player: PlayerAccount;
  requireVerifiedAge(returnScreen: Screen, action: string): boolean;
  setClubMembershipMessage: Dispatch<SetStateAction<string>>;
  setClubs: Dispatch<SetStateAction<PlayerClubSnapshot[]>>;
  setPlayer: Dispatch<SetStateAction<PlayerAccount>>;
  setScreen: Dispatch<SetStateAction<Screen>>;
  setSelectedClubId: Dispatch<SetStateAction<string>>;
  setSyncStatus: Dispatch<SetStateAction<string>>;
};

export function usePlayerClubs({
  clockNow,
  firebaseIdentity,
  platform,
  player,
  requireVerifiedAge,
  setClubMembershipMessage,
  setClubs,
  setPlayer,
  setScreen,
  setSelectedClubId,
  setSyncStatus
}: UsePlayerClubsOptions) {
  const [pendingClubProduct, setPendingClubProduct] = useState<ClubAccessProduct | null>(null);
  const [seatRequestDraft, setSeatRequestDraft] = useState<SeatRequestDraft | null>(null);
  const [seatRequestMessage, setSeatRequestMessage] = useState('');

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

  const requestMembership = async (
    club: PlayerClubSnapshot,
    plan: ClubMembershipPlan = 'monthly',
    paymentMethod: ClubMembershipPaymentMethod = 'app',
    membershipOption?: PlayerMembershipOption
  ) => {
    setSelectedClubId(club.club.id);
    const prices = getClubMembershipPrices(club);
    const priceLabel = membershipOption?.priceLabel ?? (plan === 'day' ? prices.day : prices.monthly);
    const request = buildJoinRequest(player, club.club.id, plan, paymentMethod, priceLabel, membershipOption);
    if (isSyncConfigured()) {
      setSyncStatus(paymentMethod === 'in-person' ? 'Sending pay-in-person membership request...' : 'Activating membership...');
      const result = await submitMembershipRequest(request);
      if (result.ok) {
        replaceSyncedClub(result.snapshot);
        setScreen('clubs');
        setClubMembershipMessage(paymentMethod === 'in-person'
          ? `Application sent. ${result.snapshot.club.name} will review it, then you can show ID and pay at the door.`
          : `${plan === 'day' ? 'Day pass' : 'Monthly membership'} activated.`);
        setSyncStatus(`Membership updated with ${result.snapshot.club.name}`);
        return;
      }
      setSyncStatus(`Membership request failed - ${result.error}`);
      setClubMembershipMessage(`Could not send your application. ${result.error}`);
      setScreen('clubs');
      return;
    }
    updateClubSnapshot(club, (snapshot) => applyMembershipRequest(snapshot, request));
    setScreen('clubs');
    setClubMembershipMessage(paymentMethod === 'in-person'
      ? `Application sent. ${club.club.name} will review it, then you can show ID and pay at the door.`
      : `${plan === 'day' ? 'Day pass' : 'Monthly membership'} activated.`);
  };

  const openClubSignup = (club: PlayerClubSnapshot) => {
    setSelectedClubId(club.club.id);
    setPendingClubProduct(null);
    setClubMembershipMessage('');
    setScreen('clubSignup');
  };

  const openClubPayment = (club: PlayerClubSnapshot, product: ClubAccessProduct) => {
    if (!player.id || !player.name.trim()) {
      setClubMembershipMessage('Finish creating your Orbit profile before continuing.');
      return;
    }
    setSelectedClubId(club.club.id);
    setPendingClubProduct(product);
    setClubMembershipMessage('');
    setScreen('clubPayment');
  };

  const completeClubPayment = async (club: PlayerClubSnapshot, product: ClubAccessProduct) => {
    if (!requireVerifiedAge('clubPayment', 'purchasing card-house access')) return;
    setSelectedClubId(club.club.id);
    setClubMembershipMessage('');
    const prices = getClubMembershipPrices(club);
    const planLabel = getClubProductLabel(product, prices);
    if (!firebaseIdentity) {
      setClubMembershipMessage('Sign in before purchasing from this card house.');
      return;
    }
    try {
      setClubMembershipMessage(`Opening ${club.club.name}'s secure checkout for ${planLabel}...`);
      const checkout = await createClubMembershipCheckout({ clubId: club.club.id, product, playerName: player.name });
      const result = await platform.openBrowser(checkout.checkoutUrl);
      setClubMembershipMessage(
        result.type === 'cancel'
          ? 'Checkout was closed. Nothing was purchased.'
          : `Checkout completed. Waiting for ${club.club.name} to confirm your purchase.`
      );
      setPendingClubProduct(null);
    } catch (error) {
      setClubMembershipMessage(error instanceof Error ? error.message : 'Unable to start the card house checkout.');
    }
  };

  const requestInPersonMembership = async (club: PlayerClubSnapshot, product: ClubAccessProduct) => {
    const prices = getClubMembershipPrices(club);
    const planLabel = getClubProductLabel(product, prices);
    setClubMembershipMessage(`Sending a ${planLabel} pay-in-person request to ${club.club.name}...`);
    await requestMembership(club, product === 'monthly' ? 'monthly' : 'day', 'in-person');
    setPendingClubProduct(null);
  };

  const joinWaitlist = (club: PlayerClubSnapshot, game: PlayerSyncGame) => {
    const membership = club.memberships.find((record) => isPlayerMembership(record, player));
    if (!membership || !isMembershipCurrentlyActive(membership, clockNow)) {
      setSelectedClubId(club.club.id);
      setScreen('clubs');
      setClubMembershipMessage(
        membership?.status === 'Approved'
          ? 'Your membership is approved. Bring your ID and pay at the front desk to activate it before requesting a seat.'
          : membership?.status === 'Requested'
            ? 'Your membership application is still waiting for card-room approval.'
            : `Join ${club.club.name} before requesting a seat.`
      );
      return;
    }
    setSelectedClubId(club.club.id);
    setSeatRequestMessage('');
    setSeatRequestDraft({
      club,
      game,
      attendance: isActivePlayerGame(game) ? 'arrived' : 'interested',
      expectedArrivalTime: '',
      availabilityStartTime: '',
      availabilityEndTime: ''
    });
  };

  const submitSeatRequest = async () => {
    if (!seatRequestDraft) return;
    const { club, game, attendance, expectedArrivalTime, availabilityStartTime, availabilityEndTime } = seatRequestDraft;
    if (attendance === 'confirmed' && !expectedArrivalTime.trim()) {
      setSeatRequestMessage('Enter what time you expect to arrive.');
      return;
    }
    if (attendance === 'interested' && !availabilityStartTime.trim()) {
      setSeatRequestMessage('Enter the time or start of the time range you would come.');
      return;
    }
    const request = buildWaitRequest(
      player,
      club.club.id,
      game.id,
      game.openTables[0]?.id,
      'join',
      attendance,
      expectedArrivalTime.trim() || undefined,
      availabilityStartTime.trim() || undefined,
      availabilityEndTime.trim() || undefined
    );
    if (isSyncConfigured()) {
      setSyncStatus('Sending seat request...');
      const result = await submitWaitlistRequest(request);
      if (result.ok) {
        replaceSyncedClub(result.snapshot);
        setSeatRequestDraft(null);
        setSyncStatus(`Seat request synced with ${result.snapshot.club.name}`);
        return;
      }
      setSyncStatus(`Saved locally - ${result.error}`);
    }
    updateClubSnapshot(club, (snapshot) => applyWaitlistRequest(snapshot, request));
  };

  const cancelWaitlist = async (club: PlayerClubSnapshot, game: PlayerSyncGame, entry: PlayerWaitlistEntry) => {
    setSelectedClubId(club.club.id);
    const request = buildWaitRequest(player, club.club.id, game.id, entry.tableId, 'cancel');
    if (isSyncConfigured()) {
      setSyncStatus('Cancelling seat request...');
      const result = await submitWaitlistRequest(request);
      if (result.ok) {
        replaceSyncedClub(result.snapshot);
        setSyncStatus(`Seat request cancelled with ${result.snapshot.club.name}`);
        return;
      }
      setSyncStatus(`Cancellation saved locally - ${result.error}`);
    }
    updateClubSnapshot(club, (snapshot) => applyWaitlistRequest(snapshot, request));
    setSeatRequestDraft(null);
  };

  const openDirections = (club: PlayerClubSnapshot) => {
    platform.openDirections(club.club.address || club.club.name);
  };

  const toggleFavoriteClub = (clubId: string) => {
    setPlayer((current) => {
      const favorites = current.favoriteClubIds ?? [];
      const favoriteClubIds = favorites.includes(clubId) ? favorites.filter((id) => id !== clubId) : [...favorites, clubId];
      return { ...current, favoriteClubIds };
    });
  };

  const submitMembershipApplication = async (club: PlayerClubSnapshot, membershipOption?: PlayerMembershipOption) => {
    if (!player.id || !player.name.trim()) {
      setClubMembershipMessage('Finish creating your Orbit profile before applying.');
      return;
    }
    const plan: ClubMembershipPlan = membershipOption?.durationDays === 1 ? 'day' : 'monthly';
    await requestMembership(club, plan, 'in-person', membershipOption);
  };

  const changeMembership = async (club: PlayerClubSnapshot, patch: Partial<PlayerClubMembershipRecord>) => {
    const current = club.memberships.find((membership) => isPlayerMembership(membership, player));
    const today = new Date().toISOString().slice(0, 10);
    const nextMembership: PlayerClubMembershipRecord = {
      clubId: club.club.id,
      status: patch.status ?? (current?.status === 'Expired' ? 'Expired' : 'Active'),
      joinedAt: patch.joinedAt ?? current?.joinedAt ?? today,
      expiresAt: patch.expiresAt ?? current?.expiresAt,
      preferredGameIds: player.preferredGameIds,
      preferredStakes: player.preferredStakes
    };
    // Preserve the current optimistic editor policy; live snapshots reconcile publication failures.
    if (isSyncConfigured()) await updatePlayerClubMembership(player, nextMembership).catch(() => undefined);
    setClubs((currentClubs) =>
      currentClubs.map((snapshot) =>
        snapshot.club.id === club.club.id
          ? {
              ...snapshot,
              memberships: snapshot.memberships.map((membership) =>
                isPlayerMembership(membership, player)
                  ? {
                      ...membership,
                      status: nextMembership.status === 'Denied' ? 'Expired' : nextMembership.status,
                      joinedAt: nextMembership.joinedAt ?? membership.joinedAt,
                      expiresAt: nextMembership.expiresAt ?? membership.expiresAt
                    }
                  : membership
              )
            }
          : snapshot
      )
    );
  };

  return {
    cancelWaitlist,
    changeMembership,
    completeClubPayment,
    joinWaitlist,
    openClubPayment,
    openClubSignup,
    openDirections,
    pendingClubProduct,
    requestInPersonMembership,
    seatRequestDraft,
    seatRequestMessage,
    setPendingClubProduct,
    setSeatRequestDraft,
    setSeatRequestMessage,
    submitMembershipApplication,
    submitSeatRequest,
    toggleFavoriteClub
  };
}
