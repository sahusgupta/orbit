import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { PlayerPlatform } from '../app/playerPlatform';
import { getClubMembershipPrices, getClubProductLabel, isTimeAccessProduct } from '../domain/clubAccess';
import { isActivePlayerGame } from '../domain/discovery';
import { getUnconfirmedCheckoutReturnMessage } from '../domain/playerPayments';
import {
  isMembershipCurrentlyActive,
  isPlayerMembership,
  type ClubMembershipPaymentMethod,
  type ClubMembershipPlan,
  type PlayerAccount,
  type PlayerClubSnapshot,
  type PlayerMembershipOption,
  type PlayerSyncGame,
  type PlayerWaitlistEntry
} from '../domain/playerSync';
import type { ClubAccessProduct, Screen, SeatRequestDraft, TimeAccessProduct } from '../domain/playerTypes';
import { applyMembershipRequest, applyWaitlistRequest, buildJoinRequest, buildWaitRequest } from '../data/playerRequests';
import {
  createClubMembershipCheckout,
  isSyncConfigured,
  submitMembershipRequest,
  submitWaitlistRequest,
  type FirebasePlayerIdentity
} from '../data/orbitSyncApi';

type UsePlayerClubsOptions = {
  clockNow: number;
  firebaseIdentity: FirebasePlayerIdentity | null;
  platform: PlayerPlatform;
  player: PlayerAccount;
  requireVerifiedAge(returnScreen: Screen, action: string, minimumAge?: 18 | 21): boolean;
  setClubMembershipMessage: Dispatch<SetStateAction<string>>;
  setClubs: Dispatch<SetStateAction<PlayerClubSnapshot[]>>;
  setScreen: Dispatch<SetStateAction<Screen>>;
  setSelectedClubId: Dispatch<SetStateAction<string>>;
  setSyncStatus: Dispatch<SetStateAction<string>>;
};

export async function submitPaidMembershipBeforeCheckout(
  player: PlayerAccount,
  club: PlayerClubSnapshot,
  product: ClubAccessProduct,
  membershipOption: PlayerMembershipOption | null,
  submitRequest: typeof submitMembershipRequest = submitMembershipRequest
): Promise<
  | { ok: true; skipped: true }
  | { ok: true; skipped: false; snapshot: PlayerClubSnapshot }
  | { ok: false; error: string }
> {
  if (isTimeAccessProduct(product)) return { ok: true, skipped: true };
  if (!membershipOption?.id) return { ok: false, error: 'Choose a membership option before opening checkout.' };
  const plan: ClubMembershipPlan = product === 'day' ? 'day' : 'monthly';
  const request = buildJoinRequest(
    player,
    club.club.id,
    plan,
    'app',
    membershipOption.priceLabel,
    membershipOption
  );
  const result = await submitRequest(request);
  return result.ok
    ? { ok: true, skipped: false, snapshot: result.snapshot }
    : { ok: false, error: result.error };
}

export function usePlayerClubs({
  clockNow,
  firebaseIdentity,
  platform,
  player,
  requireVerifiedAge,
  setClubMembershipMessage,
  setClubs,
  setScreen,
  setSelectedClubId,
  setSyncStatus
}: UsePlayerClubsOptions) {
  const [pendingClubProduct, setPendingClubProduct] = useState<ClubAccessProduct | null>(null);
  const [pendingMembershipOption, setPendingMembershipOption] = useState<PlayerMembershipOption | null>(null);
  const [pendingSeatAfterMembership, setPendingSeatAfterMembership] = useState<{ club: PlayerClubSnapshot; game: PlayerSyncGame } | null>(null);
  const [seatRequestDraft, setSeatRequestDraft] = useState<SeatRequestDraft | null>(null);
  const [seatRequestMessage, setSeatRequestMessage] = useState('');
  const [clubActionPending, setClubActionPending] = useState(false);
  const actionInFlight = useRef(false);

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

  const resumePendingSeatRequest = (club: PlayerClubSnapshot) => {
    if (pendingSeatAfterMembership?.club.club.id !== club.club.id) return;
    openSeatRequestDraft(club, pendingSeatAfterMembership.game);
    setPendingSeatAfterMembership(null);
  };

  const requestMembership = async (
    club: PlayerClubSnapshot,
    plan: ClubMembershipPlan = 'monthly',
    paymentMethod: ClubMembershipPaymentMethod = 'app',
    membershipOption?: PlayerMembershipOption
  ) => {
    if (!requireVerifiedAge('clubs', 'registering with this card house', club.club.minimumAge === 18 ? 18 : 21)) return;
    if (!beginAction()) return;
    setSelectedClubId(club.club.id);
    const prices = getClubMembershipPrices(club);
    const priceLabel = membershipOption?.priceLabel ?? (plan === 'day' ? prices.day : prices.monthly);
    const request = buildJoinRequest(player, club.club.id, plan, paymentMethod, priceLabel, membershipOption);
    try {
      if (isSyncConfigured()) {
        setSyncStatus(paymentMethod === 'in-person' ? 'Sending pay-in-person membership request...' : 'Sending membership signup...');
        const result = await submitMembershipRequest(request);
        if (result.ok) {
          replaceSyncedClub(result.snapshot);
          setScreen('clubs');
          setClubMembershipMessage(paymentMethod === 'in-person'
            ? `Signup sent. Show your physical ID and pay at ${result.snapshot.club.name}.`
            : priceLabel === '$0' || /^free$/i.test(priceLabel.trim())
              ? `Signup sent. No payment is due; ${result.snapshot.club.name} will check your physical ID on your first visit.`
              : `Signup sent. Payment confirmation and physical-ID review are pending.`);
          setSyncStatus(`Membership updated with ${result.snapshot.club.name}`);
          resumePendingSeatRequest(result.snapshot);
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
        ? `Application saved on this device. Connect to ${club.club.name} to send it.`
        : `${plan === 'day' ? 'Day pass' : 'Monthly membership'} saved on this device.`);
      resumePendingSeatRequest(club);
    } finally {
      finishAction();
    }
  };

  const openClubSignup = (club: PlayerClubSnapshot) => {
    setSelectedClubId(club.club.id);
    if (!requireVerifiedAge('clubSignup', 'registering with this card house', club.club.minimumAge === 18 ? 18 : 21)) return;
    setPendingClubProduct(null);
    setPendingMembershipOption(null);
    setClubMembershipMessage('');
    setScreen('clubSignup');
  };

  const openClubPayment = (club: PlayerClubSnapshot, product: ClubAccessProduct, membershipOption?: PlayerMembershipOption) => {
    if (!player.id || !player.name.trim()) {
      setClubMembershipMessage('Finish creating your Orbit profile before continuing.');
      return;
    }
    setSelectedClubId(club.club.id);
    if (!requireVerifiedAge('clubs', 'purchasing card-house access', club.club.minimumAge === 18 ? 18 : 21)) return;
    setPendingClubProduct(product);
    setPendingMembershipOption(membershipOption ?? null);
    setClubMembershipMessage('');
    setScreen('clubPayment');
  };

  const openPlayerTimePurchase = (club: PlayerClubSnapshot, product?: TimeAccessProduct) => {
    if (!club.timeAccess?.enabled || !club.timeAccess.linked || !club.timeAccess.activeSession) {
      setClubMembershipMessage('Core must link your verified Orbit email or phone and seat you at a time-fee table first.');
      return;
    }
    if (product) {
      openClubPayment(club, product);
      return;
    }
    setSelectedClubId(club.club.id);
    setClubMembershipMessage('Choose how much time to add.');
    setScreen('clubs');
  };

  const completeClubPayment = async (club: PlayerClubSnapshot, product: ClubAccessProduct) => {
    if (!requireVerifiedAge('clubPayment', 'purchasing card-house access', club.club.minimumAge === 18 ? 18 : 21)) return;
    setSelectedClubId(club.club.id);
    setClubMembershipMessage('');
    const prices = getClubMembershipPrices(club);
    const planLabel = getClubProductLabel(product, prices);
    const timeProduct = isTimeAccessProduct(product);
    const membershipPlanId = timeProduct ? null : pendingMembershipOption?.id;
    if (!firebaseIdentity) {
      setClubMembershipMessage('Sign in before purchasing from this card house.');
      return;
    }
    if (!timeProduct && !membershipPlanId) {
      setClubMembershipMessage('Choose a membership option before opening checkout.');
      return;
    }
    if (!beginAction()) return;
    try {
      let membershipSnapshot: PlayerClubSnapshot | null = null;
      if (!timeProduct) {
        if (!isSyncConfigured()) {
          setClubMembershipMessage(`Connect to Orbit before sending your ${planLabel} signup.`);
          return;
        }
        setSyncStatus('Sending membership signup before checkout...');
        const membershipResult = await submitPaidMembershipBeforeCheckout(
          player,
          club,
          product,
          pendingMembershipOption
        );
        if (!membershipResult.ok) {
          setSyncStatus(`Membership request failed - ${membershipResult.error}`);
          setClubMembershipMessage(`Could not send your membership signup. ${membershipResult.error}`);
          return;
        }
        if (!membershipResult.skipped) {
          membershipSnapshot = membershipResult.snapshot;
          replaceSyncedClub(membershipResult.snapshot);
          setSyncStatus(`Membership signup sent to ${membershipResult.snapshot.club.name}`);
        }
      }
      setClubMembershipMessage(`Opening ${club.club.name}'s secure checkout for ${planLabel}...`);
      let checkout;
      if (timeProduct) {
        checkout = await createClubMembershipCheckout({ clubId: club.club.id, product, playerName: player.name });
      } else {
        if (!membershipPlanId) throw new Error('Choose a membership option before opening checkout.');
        checkout = await createClubMembershipCheckout({ clubId: club.club.id, product, playerName: player.name, planId: membershipPlanId });
      }
      await platform.openBrowser(checkout.checkoutUrl);
      setClubMembershipMessage(getUnconfirmedCheckoutReturnMessage(club.club.name));
      if (membershipSnapshot) resumePendingSeatRequest(membershipSnapshot);
      setPendingClubProduct(null);
      setPendingMembershipOption(null);
    } catch (error) {
      setClubMembershipMessage(error instanceof Error ? error.message : 'Unable to start the card house checkout.');
    } finally {
      finishAction();
    }
  };

  const requestInPersonMembership = async (club: PlayerClubSnapshot, product: ClubAccessProduct) => {
    const prices = getClubMembershipPrices(club);
    const planLabel = getClubProductLabel(product, prices);
    setClubMembershipMessage(`Sending a ${planLabel} pay-in-person request to ${club.club.name}...`);
    await requestMembership(club, product === 'monthly' ? 'monthly' : 'day', 'in-person', pendingMembershipOption ?? undefined);
    setPendingClubProduct(null);
    setPendingMembershipOption(null);
  };

  const joinWaitlist = (club: PlayerClubSnapshot, game: PlayerSyncGame) => {
    if (!requireVerifiedAge('clubs', 'requesting a seat', club.club.minimumAge === 18 ? 18 : 21)) return;
    const membership = club.memberships.find((record) => isPlayerMembership(record, player));
    if (!membership) {
      setPendingSeatAfterMembership({ club, game });
      setSelectedClubId(club.club.id);
      openClubSignup(club);
      setClubMembershipMessage(`Choose a membership option for ${club.club.name}. Your ${game.name} seat request will continue afterward.`);
      return;
    }
    if (!['Requested', 'Approved'].includes(membership.status) && !isMembershipCurrentlyActive(membership, clockNow)) {
      setSelectedClubId(club.club.id);
      setScreen('clubs');
      setClubMembershipMessage(`Renew your ${club.club.name} membership before requesting a seat.`);
      return;
    }
    openSeatRequestDraft(club, game);
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
    if (!beginAction()) return;
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
    try {
      if (isSyncConfigured()) {
        updateClubSnapshot(club, (snapshot) => applyWaitlistRequest(snapshot, request));
        setSyncStatus('Sending seat request...');
        const result = await submitWaitlistRequest(request);
        if (result.ok) {
          replaceSyncedClub(result.snapshot);
          setSeatRequestDraft(null);
          setSyncStatus(`Seat request synced with ${result.snapshot.club.name}`);
          return;
        }
        replaceSyncedClub(club);
        setSyncStatus(`Seat request was not saved - ${result.error}`);
        return;
      }
      updateClubSnapshot(club, (snapshot) => applyWaitlistRequest(snapshot, request));
      setSeatRequestDraft(null);
      setSyncStatus('Seat request saved on this device. Connect to the club to send it.');
    } finally {
      finishAction();
    }
  };

  const cancelWaitlist = async (club: PlayerClubSnapshot, game: PlayerSyncGame, entry: PlayerWaitlistEntry) => {
    if (!beginAction()) return;
    setSelectedClubId(club.club.id);
    const request = buildWaitRequest(player, club.club.id, game.id, entry.tableId, 'cancel');
    try {
      if (isSyncConfigured()) {
        updateClubSnapshot(club, (snapshot) => applyWaitlistRequest(snapshot, request));
        setSyncStatus('Cancelling seat request...');
        const result = await submitWaitlistRequest(request);
        if (result.ok) {
          replaceSyncedClub(result.snapshot);
          setSeatRequestDraft(null);
          setSyncStatus(`Seat request cancelled with ${result.snapshot.club.name}`);
          return;
        }
        replaceSyncedClub(club);
        setSyncStatus(`Cancellation was not saved - ${result.error}`);
        return;
      }
      updateClubSnapshot(club, (snapshot) => applyWaitlistRequest(snapshot, request));
      setSeatRequestDraft(null);
      setSyncStatus('Cancellation saved on this device. Connect to the club to send it.');
    } finally {
      finishAction();
    }
  };

  const openDirections = (club: PlayerClubSnapshot) => {
    platform.openDirections(club.club.address || club.club.name);
  };

  const submitMembershipApplication = async (club: PlayerClubSnapshot, membershipOption?: PlayerMembershipOption) => {
    if (!player.id || !player.name.trim()) {
      setClubMembershipMessage('Finish creating your Orbit profile before applying.');
      return;
    }
    if (!requireVerifiedAge('clubSignup', 'registering with this card house', club.club.minimumAge === 18 ? 18 : 21)) return;
    const product: ClubAccessProduct = membershipOption?.durationDays === 1 ? 'day' : 'monthly';
    const plan: ClubMembershipPlan = product === 'day' ? 'day' : 'monthly';
    const priceLabel = membershipOption?.priceLabel || '';
    const numericPrice = priceLabel.match(/\d+(?:\.\d+)?/);
    const free = Boolean(membershipOption) && (/\bfree\b/i.test(priceLabel) || numericPrice != null && Number(numericPrice[0]) === 0);
    if (free) {
      await requestMembership(club, plan, 'app', membershipOption);
      return;
    }
    openClubPayment(club, product, membershipOption);
  };

  return {
    cancelWaitlist,
    clubActionPending,
    completeClubPayment,
    joinWaitlist,
    openClubPayment,
    openPlayerTimePurchase,
    openClubSignup,
    openDirections,
    pendingMembershipOption,
    pendingClubProduct,
    requestInPersonMembership,
    seatRequestDraft,
    seatRequestMessage,
    setPendingClubProduct,
    setSeatRequestDraft,
    setSeatRequestMessage,
    submitMembershipApplication,
    submitSeatRequest
  };
}
