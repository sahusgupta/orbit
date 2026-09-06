import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { PlayerPlatform } from '../app/playerPlatform';
import { isPlayerMembership, type PlayerAccount, type PlayerClubSnapshot, type PlayerTournament, type PlayerTournamentInterest } from '../domain/playerSync';
import type { Screen } from '../domain/playerTypes';
import { hasAdultDeclaration } from '../domain/playerOnboarding';
import { reconcileSelectedClubAfterRefresh } from '../domain/playerClubViewState';
import {
  completePlayerAdultDeclarationIfMissing,
  createPlayerProfileIfMissing,
  fetchPlayerProfile,
  fetchPlayerTournaments,
  getCurrentFirebasePlayer,
  isSyncConfigured,
  savePlayerProfile,
  subscribeToAllClubSnapshots,
  subscribeToPlayerTournaments
} from '../data/orbitSyncApi';
import type { FirebasePlayerIdentity } from '../data/orbitSyncApi';
import { playerStorage, type PendingPlayerProfile } from '../data/storage/playerStorage';
import { bindPlayerPollingLifecycle } from './playerSubscriptionLifecycle';
import type { ClubSnapshotSubscriptionResult } from '../data/subscriptions/clubSnapshotSubscription';
import {
  canPublishHydratedPlayer,
  playerAccountFromProfile,
  resolveAuthenticatedPlayerProfile,
  type PlayerProfileHydration
} from './playerProfileHydration';
import { createPendingProfileVersion, syncPendingPlayerProfile } from './playerProfileSync';

type UsePlayerLiveDataOptions = {
  accountLoaded: boolean;
  firebaseIdentity: FirebasePlayerIdentity | null;
  hasAccount: boolean;
  platform: PlayerPlatform;
  player: PlayerAccount;
  profileSyncPaused: boolean;
  setDraftPlayer: Dispatch<SetStateAction<PlayerAccount>>;
  setPlayer: Dispatch<SetStateAction<PlayerAccount>>;
  setScreen: Dispatch<SetStateAction<Screen>>;
  setSyncStatus: Dispatch<SetStateAction<string>>;
};

export function usePlayerLiveData({
  accountLoaded,
  firebaseIdentity,
  hasAccount,
  platform,
  player,
  profileSyncPaused,
  setDraftPlayer,
  setPlayer,
  setScreen,
  setSyncStatus
}: UsePlayerLiveDataOptions) {
  const [clubs, setClubs] = useState<PlayerClubSnapshot[]>([]);
  const [tournaments, setTournaments] = useState<PlayerTournament[]>([]);
  const [tournamentInterests, setTournamentInterests] = useState<PlayerTournamentInterest[]>([]);
  const [tournamentLoadError, setTournamentLoadError] = useState('');
  const [selectedClubId, setSelectedClubId] = useState('');
  const [clubMembershipMessage, setClubMembershipMessage] = useState('');
  const [clubSelectionNotice, setClubSelectionNotice] = useState('');
  const [clockNow, setClockNow] = useState(Date.now());
  const [liveDataStatus, setLiveDataStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [liveDataPartial, setLiveDataPartial] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [profileSyncNotice, setProfileSyncNotice] = useState('');
  const membershipStatusRef = useRef<Record<string, string>>({});
  const liveDataOwnerRef = useRef(`${firebaseIdentity?.uid ?? 'local'}:${player.id}`);
  const profileHydrationSequence = useRef(0);
  const lastHydratedPlayer = useRef<{ player: PlayerAccount; uid: string } | null>(null);
  const pendingProfileRef = useRef<PendingPlayerProfile | null>(null);
  const profileSyncTailRef = useRef<Promise<void>>(Promise.resolve());
  const lastProfileSyncAttemptRef = useRef('');
  const [profileHydration, setProfileHydration] = useState<PlayerProfileHydration>({ uid: '', status: 'idle' });

  useEffect(() => {
    const nextOwner = `${firebaseIdentity?.uid ?? 'local'}:${player.id}`;
    if (liveDataOwnerRef.current === nextOwner) return;
    liveDataOwnerRef.current = nextOwner;
    setClubs([]);
    setTournaments([]);
    setTournamentInterests([]);
    setTournamentLoadError('');
    setSelectedClubId('');
    setClubSelectionNotice('');
    setClubMembershipMessage('');
    setLiveDataPartial(false);
    setLiveDataStatus('idle');
    membershipStatusRef.current = {};
    if (pendingProfileRef.current?.uid !== firebaseIdentity?.uid) pendingProfileRef.current = null;
    lastProfileSyncAttemptRef.current = '';
    setProfileSyncNotice('');
  }, [firebaseIdentity?.uid, player.id]);

  useEffect(() => {
    if (hasAccount) return;
    setClubs([]);
    setTournaments([]);
    setTournamentInterests([]);
    setTournamentLoadError('');
    setSelectedClubId('');
    setClubSelectionNotice('');
    setClubMembershipMessage('');
    setLiveDataPartial(false);
    setLiveDataStatus('idle');
    membershipStatusRef.current = {};
  }, [hasAccount]);

  useEffect(() => {
    const updateClock = () => setClockNow(Date.now());
    const firstDelay = 60_000 - (Date.now() % 60_000);
    let interval: ReturnType<typeof setInterval> | undefined;
    const timeout = setTimeout(() => {
      updateClock();
      interval = setInterval(updateClock, 60_000);
    }, firstDelay);
    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const identityUid = firebaseIdentity?.uid ?? '';
    if (profileSyncPaused) {
      profileHydrationSequence.current += 1;
      lastHydratedPlayer.current = null;
      setProfileHydration({ uid: identityUid, status: 'idle' });
      return;
    }
    if (!accountLoaded || !hasAccount || !firebaseIdentity) return;
    const sequence = ++profileHydrationSequence.current;
    let active = true;
    const expectedUid = firebaseIdentity.uid;
    const isCurrentSession = () => getCurrentFirebasePlayer()?.uid === expectedUid;
    setProfileHydration({ uid: firebaseIdentity.uid, status: 'loading' });
    const hydrateProfile = async () => {
      // Device-journaled edits are authoritative until their exact version is
      // acknowledged remotely. Applying the server copy first would silently
      // overwrite an edit after a restart or transient network failure.
      const inMemoryPending = pendingProfileRef.current?.uid === expectedUid
        ? pendingProfileRef.current
        : null;
      const pending = inMemoryPending ?? await playerStorage.loadPendingPlayerProfile(expectedUid, player);
      if (!active || !isCurrentSession() || sequence !== profileHydrationSequence.current) return;
      if (pending) {
        pendingProfileRef.current = pending;
        lastHydratedPlayer.current = null;
        setPlayer(pending.player);
        setDraftPlayer(pending.player);
        setProfileHydration({ uid: expectedUid, status: 'ready' });
        setProfileSyncNotice('Profile changes saved on this device are waiting to sync.');
        return;
      }

      const profile = await fetchPlayerProfile(expectedUid);
      if (!active || !isCurrentSession() || sequence !== profileHydrationSequence.current) return;
      if (profile) {
        const completedProfile = hasAdultDeclaration(profile)
          ? profile
          : await completePlayerAdultDeclarationIfMissing(player, expectedUid);
        if (!active || !isCurrentSession() || sequence !== profileHydrationSequence.current) return;
        const nextPlayer = playerAccountFromProfile(completedProfile);
        pendingProfileRef.current = null;
        lastHydratedPlayer.current = { player: nextPlayer, uid: expectedUid };
        setPlayer(nextPlayer);
        setDraftPlayer(nextPlayer);
        setProfileSyncNotice('');
        const clubIds = new Set(Object.entries(completedProfile.clubMemberships ?? {}).filter(([, membership]) => membership.status === 'Active' || membership.status === 'Approved' || membership.status === 'Requested').map(([clubId]) => clubId));
        const firstClub = clubs.find((club) => clubIds.has(club.club.id));
        if (firstClub) setSelectedClubId((current) => current || firstClub.club.id);
      } else {
        if (player.id !== expectedUid) {
          lastHydratedPlayer.current = null;
          setProfileHydration({ uid: expectedUid, status: 'error' });
          setSyncStatus('The signed-in account has no saved profile and does not match this local profile. Sign out, then connect the intended account again.');
          return;
        }
        const resolved = await resolveAuthenticatedPlayerProfile(firebaseIdentity, player, {
          completeAdultDeclarationIfMissing: completePlayerAdultDeclarationIfMissing,
          createProfileIfMissing: createPlayerProfileIfMissing,
          readProfile: fetchPlayerProfile
        });
        if (!active || !isCurrentSession() || sequence !== profileHydrationSequence.current) return;
        pendingProfileRef.current = null;
        lastHydratedPlayer.current = { player: resolved.player, uid: expectedUid };
        setPlayer(resolved.player);
        setDraftPlayer(resolved.player);
        setProfileSyncNotice('');
      }
      setProfileHydration({ uid: expectedUid, status: 'ready' });
    };

    void hydrateProfile().catch(() => {
      if (active && isCurrentSession() && sequence === profileHydrationSequence.current) {
        setProfileHydration({ uid: expectedUid, status: 'error' });
        setSyncStatus('Your saved profile is available offline. Retry when your connection returns.');
        setProfileSyncNotice('Orbit could not confirm whether profile changes are waiting on this device, so the server copy was not applied.');
      }
    });
    return () => {
      active = false;
    };
  }, [accountLoaded, firebaseIdentity?.uid, hasAccount, profileSyncPaused, refreshVersion]);

  useEffect(() => {
    const expectedUid = firebaseIdentity?.uid;
    if (!expectedUid) return;
    if (!canPublishHydratedPlayer({
      accountLoaded,
      hasAccount,
      hydration: profileHydration,
      identityUid: firebaseIdentity?.uid,
      playerId: player.id,
      profileSyncPaused
    })) return;
    const hydratedPlayer = lastHydratedPlayer.current;
    if (hydratedPlayer && hydratedPlayer.uid === firebaseIdentity?.uid && hydratedPlayer.player === player) return;
    const existingPending = pendingProfileRef.current;
    const pending = existingPending?.uid === expectedUid && existingPending.player === player
      ? existingPending
      : {
          uid: expectedUid,
          version: createPendingProfileVersion(),
          player
        };
    pendingProfileRef.current = pending;
    const attemptKey = `${pending.uid}:${pending.version}:${refreshVersion}`;
    if (lastProfileSyncAttemptRef.current === attemptKey) return;
    lastProfileSyncAttemptRef.current = attemptKey;

    // Persist the newest edit immediately. Remote attempts remain serialized so
    // an older response can never acknowledge or clear a newer local version.
    const pendingPersisted = playerStorage.savePendingPlayerProfile(pending);
    void pendingPersisted.catch(() => undefined);
    profileSyncTailRef.current = profileSyncTailRef.current.then(async () => {
      const result = await syncPendingPlayerProfile(pending, {
        clearPending: playerStorage.clearPendingPlayerProfile,
        currentUid: () => getCurrentFirebasePlayer()?.uid ?? null,
        pendingPersisted,
        saveRemote: savePlayerProfile
      });
      if (getCurrentFirebasePlayer()?.uid !== expectedUid) return;
      if (pendingProfileRef.current?.version !== pending.version) return;
      if (result.kind === 'saved') {
        pendingProfileRef.current = null;
        lastHydratedPlayer.current = { player: pending.player, uid: expectedUid };
        setProfileSyncNotice('');
        return;
      }
      if (result.kind === 'failed') {
        const detail = result.error instanceof Error ? ` ${result.error.message}` : '';
        setProfileSyncNotice(result.stage === 'local-persistence'
          ? `Profile changes are still open in Orbit but could not be saved securely on this device. Retry before closing the app.${detail}`
          : result.stage === 'local-acknowledgement'
            ? `Profile changes reached the server, but Orbit could not record that completion on this device. Retry is safe.${detail}`
            : `Profile changes remain saved on this device but have not synced yet.${detail}`);
      }
    });
  }, [accountLoaded, firebaseIdentity?.uid, hasAccount, player, profileHydration, profileSyncPaused, refreshVersion]);

  useEffect(() => {
    if (!accountLoaded || !hasAccount) return;
    if (!isSyncConfigured()) {
      setLiveDataStatus('error');
      setLiveDataPartial(false);
      setSyncStatus('Published venue data is unavailable because the Orbit API is not configured.');
      return;
    }
    let active = true;
    const expectedUid = firebaseIdentity?.uid === player.id ? player.id : null;
    const isCurrentSession = () => !expectedUid || getCurrentFirebasePlayer()?.uid === expectedUid;
    setLiveDataStatus('loading');
    setLiveDataPartial(false);
    const handleClubSync = (result: ClubSnapshotSubscriptionResult) => {
      if (!active || !isCurrentSession()) return;
      if (result.ok) {
        const liveClubs = result.clubs;
        setClubs(liveClubs);
        const existingMembershipClub = result.clubs.find((club) => club.memberships.some((membership) => isPlayerMembership(membership, player)));
        const nextStatuses: Record<string, string> = {};
        for (const club of liveClubs) {
          const membership = club.memberships.find((record) => isPlayerMembership(record, player));
          if (!membership) continue;
          nextStatuses[club.club.id] = membership.status;
          const previousStatus = membershipStatusRef.current[club.club.id];
          if (previousStatus === 'Requested' && (membership.status === 'Approved' || membership.status === 'Active')) {
            setSelectedClubId(club.club.id);
            setClubMembershipMessage(
              membership.status === 'Active'
                ? `You are now a member of ${club.club.name}.`
                : `${club.club.name} approved your membership.`
            );
            setScreen('clubs');
          }
        }
        membershipStatusRef.current = nextStatuses;
        setSelectedClubId((current) => {
          const reconciliation = reconcileSelectedClubAfterRefresh(
            current,
            liveClubs,
            existingMembershipClub?.club.id
          );
          setClubSelectionNotice(reconciliation.selectionNotice);
          return reconciliation.selectedClubId;
        });
        setLiveDataPartial(result.partial === true);
        setSyncStatus(
          result.partial
            ? `Showing ${result.clubs.length} published venue${result.clubs.length === 1 ? '' : 's'} while more rooms refresh.`
            : `Showing ${result.clubs.length} published venue${result.clubs.length === 1 ? '' : 's'}.`
        );
        setLiveDataStatus('ready');
      } else {
        if (result.stale && result.clubs?.length) setClubs(result.clubs);
        setSyncStatus(result.stale
          ? `Showing previously loaded venue data read-only because refresh failed: ${result.error}`
          : `Unable to load published venue data: ${result.error}`);
        setLiveDataPartial(false);
        setLiveDataStatus('error');
      }
    };

    const liveGameSubscription = subscribeToAllClubSnapshots(player, handleClubSync);
    const unbind = bindPlayerPollingLifecycle(platform, liveGameSubscription);
    return () => {
      active = false;
      unbind();
    };
  }, [accountLoaded, firebaseIdentity?.uid, hasAccount, player.id, player.name, refreshVersion]);

  useEffect(() => {
    if (!accountLoaded || !hasAccount) return;
    let active = true;
    const expectedUid = firebaseIdentity?.uid === player.id ? player.id : null;
    const isCurrentSession = () => !expectedUid || getCurrentFirebasePlayer()?.uid === expectedUid;
    const handleTournaments = (result: Awaited<ReturnType<typeof fetchPlayerTournaments>>) => {
      if (!active || !isCurrentSession()) return;
      setTournaments(result.tournaments);
      setTournamentInterests(result.interests);
      setTournamentLoadError('');
    };
    const handleTournamentError = (error: Error) => {
      if (active && isCurrentSession()) setTournamentLoadError(error.message || 'Unable to load tournaments.');
    };
    // The live subscription remains active if its initial eager refresh fails.
    const playerId = firebaseIdentity?.uid === player.id ? player.id : undefined;
    const tournamentSubscription = subscribeToPlayerTournaments(playerId, handleTournaments, handleTournamentError);
    const unbind = bindPlayerPollingLifecycle(platform, tournamentSubscription);
    return () => {
      active = false;
      unbind();
    };
  }, [accountLoaded, firebaseIdentity?.uid, hasAccount, platform, player.id, refreshVersion]);

  return {
    clockNow,
    clubMembershipMessage,
    clubSelectionNotice,
    clubs,
    liveDataPartial,
    liveDataStatus,
    profileEditingReady: !firebaseIdentity || canPublishHydratedPlayer({
      accountLoaded,
      hasAccount,
      hydration: profileHydration,
      identityUid: firebaseIdentity.uid,
      playerId: player.id,
      profileSyncPaused
    }),
    profileSyncNotice,
    retryLiveData: () => setRefreshVersion((current) => current + 1),
    selectedClubId,
    setClubMembershipMessage,
    setClubs,
    setClubSelectionNotice,
    setSelectedClubId,
    setTournamentInterests,
    tournamentInterests,
    tournamentLoadError,
    tournaments
  };
}
