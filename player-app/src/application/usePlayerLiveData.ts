import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { PlayerPlatform } from '../app/playerPlatform';
import { isPlayerMembership, type PlayerAccount, type PlayerClubSnapshot, type PlayerPrivateGameListing, type PlayerTournament, type PlayerTournamentRegistration } from '../domain/playerSync';
import type { Screen } from '../domain/playerTypes';
import {
  fetchAllClubSnapshots,
  fetchPlayerProfile,
  fetchPlayerTournaments,
  fetchPrivateGameListings,
  isSyncConfigured,
  savePlayerProfile,
  subscribeToAllClubSnapshots,
  subscribeToPlayerTournaments,
  subscribeToPrivateGameListings
} from '../data/orbitSyncApi';
import type { FirebasePlayerIdentity } from '../data/orbitSyncApi';
import { bindPlayerPollingLifecycle } from './playerSubscriptionLifecycle';

type UsePlayerLiveDataOptions = {
  accountLoaded: boolean;
  firebaseIdentity: FirebasePlayerIdentity | null;
  hasAccount: boolean;
  platform: PlayerPlatform;
  player: PlayerAccount;
  setDraftPlayer: Dispatch<SetStateAction<PlayerAccount>>;
  setPlayer: Dispatch<SetStateAction<PlayerAccount>>;
  setPremiumStatus: Dispatch<SetStateAction<'inactive' | 'pending' | 'active'>>;
  setScreen: Dispatch<SetStateAction<Screen>>;
  setSyncStatus: Dispatch<SetStateAction<string>>;
};

export function usePlayerLiveData({
  accountLoaded,
  firebaseIdentity,
  hasAccount,
  platform,
  player,
  setDraftPlayer,
  setPlayer,
  setPremiumStatus,
  setScreen,
  setSyncStatus
}: UsePlayerLiveDataOptions) {
  const [clubs, setClubs] = useState<PlayerClubSnapshot[]>([]);
  const [privateGames, setPrivateGames] = useState<PlayerPrivateGameListing[]>([]);
  const [privateGameStatus, setPrivateGameStatus] = useState('');
  const [tournaments, setTournaments] = useState<PlayerTournament[]>([]);
  const [tournamentRegistrations, setTournamentRegistrations] = useState<PlayerTournamentRegistration[]>([]);
  const [selectedClubId, setSelectedClubId] = useState('');
  const [clubMembershipMessage, setClubMembershipMessage] = useState('');
  const [clockNow, setClockNow] = useState(Date.now());
  const membershipStatusRef = useRef<Record<string, string>>({});

  useEffect(() => {
    const timer = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!accountLoaded || !hasAccount || !firebaseIdentity || player.id !== firebaseIdentity.uid) return;
    // Local profile editing stays responsive while background publication is best-effort.
    savePlayerProfile(player).catch(() => undefined);
  }, [accountLoaded, firebaseIdentity, hasAccount, player]);

  useEffect(() => {
    if (!accountLoaded || !hasAccount) return;
    // A failed remote hydrate preserves the locally restored profile.
    fetchPlayerProfile()
      .then((profile) => {
        if (!profile) return;
        const nextPlayer = {
          ...player,
          id: profile.uid,
          name: profile.name || player.name,
          email: profile.email || player.email,
          phone: profile.phone || player.phone,
          homeLocation: profile.homeLocation ?? player.homeLocation,
          searchRadiusMiles: profile.searchRadiusMiles ?? player.searchRadiusMiles,
          preferredGameIds: profile.preferredGameIds?.length ? profile.preferredGameIds : player.preferredGameIds,
          favoriteClubIds: profile.favoriteClubIds ?? player.favoriteClubIds ?? [],
          preferredStakes: profile.preferredStakes ?? player.preferredStakes,
          typicalAvailability: profile.typicalAvailability ?? player.typicalAvailability
        };
        setPlayer(nextPlayer);
        setDraftPlayer(nextPlayer);
        setPremiumStatus(profile.premium?.status === 'active' || profile.subscriptionStatus === 'active' ? 'active' : 'inactive');
        const clubIds = new Set(Object.entries(profile.clubMemberships ?? {}).filter(([, membership]) => membership.status === 'Active' || membership.status === 'Approved' || membership.status === 'Requested').map(([clubId]) => clubId));
        const firstClub = clubs.find((club) => clubIds.has(club.club.id));
        if (firstClub) {
          setSelectedClubId(firstClub.club.id);
          setScreen('findGames');
        } else {
          setScreen('findGames');
        }
      })
      .catch(() => undefined);
  }, [accountLoaded, firebaseIdentity?.uid, hasAccount]);

  useEffect(() => {
    if (!accountLoaded || !hasAccount || !isSyncConfigured()) return;
    const handleClubSync = (result: Awaited<ReturnType<typeof fetchAllClubSnapshots>>) => {
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
        setSelectedClubId((current) => existingMembershipClub?.club.id ?? liveClubs.find((club) => club.club.id === current)?.club.id ?? liveClubs[0]?.club.id ?? '');
        setSyncStatus(`Showing ${result.clubs.length} live card house${result.clubs.length === 1 ? '' : 's'}.`);
      } else {
        setSyncStatus(`Unable to load live club data: ${result.error}`);
      }
    };

    const liveGameSubscription = subscribeToAllClubSnapshots(player, handleClubSync);
    return bindPlayerPollingLifecycle(platform, liveGameSubscription);
  }, [accountLoaded, hasAccount, player.id, player.name]);

  useEffect(() => {
    if (!accountLoaded || !hasAccount) return;
    const handlePrivateGames = (result: Awaited<ReturnType<typeof fetchPrivateGameListings>>) => {
      if (result.ok) {
        setPrivateGames(result.games);
        setPrivateGameStatus('');
      } else {
        setPrivateGameStatus(result.error);
      }
    };
    fetchPrivateGameListings().then(handlePrivateGames);
    return subscribeToPrivateGameListings(handlePrivateGames);
  }, [accountLoaded, hasAccount]);

  useEffect(() => {
    if (!accountLoaded || !hasAccount || !firebaseIdentity) return;
    const handleTournaments = (result: Awaited<ReturnType<typeof fetchPlayerTournaments>>) => {
      setTournaments(result.tournaments);
      setTournamentRegistrations(result.registrations);
    };
    // The live subscription remains active if its initial eager refresh fails.
    fetchPlayerTournaments(player.id).then(handleTournaments).catch(() => undefined);
    return subscribeToPlayerTournaments(player.id, handleTournaments);
  }, [accountLoaded, firebaseIdentity?.uid, hasAccount, player.id]);

  return {
    clockNow,
    clubMembershipMessage,
    clubs,
    privateGames,
    privateGameStatus,
    selectedClubId,
    setClubMembershipMessage,
    setClubs,
    setPrivateGames,
    setPrivateGameStatus,
    setSelectedClubId,
    setTournamentRegistrations,
    tournamentRegistrations,
    tournaments
  };
}
