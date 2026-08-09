import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, BackHandler, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type AppStateStatus } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Chip, Field } from './components/PlayerFields';
import {
  FiltersBottomSheet,
  SimpleMenuRow
} from './components/PlayerPresentation';
import { LinearGradient } from 'expo-linear-gradient';
import * as WebBrowser from 'expo-web-browser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { privacyPolicyUrl, termsOfServiceUrl } from './config/playerLinks';
import {
  getClubMembershipPrices,
  getClubProductLabel
} from './domain/clubAccess';
import {
  isActivePlayerGameRequest,
  isMembershipCurrentlyActive,
  isPlayerMembership,
  isPlayerWaitlistEntry,
  type PlayerAccount,
  type PlayerClubMembershipRecord,
  type PlayerClubSnapshot,
  type PlayerInAppNotification,
  type PlayerMembershipOption,
  type PlayerPrivateGameListing,
  type PlayerSyncGame,
  type PlayerTournament,
  type PlayerTournamentRegistration,
  type PlayerWaitlistEntry,
  type ClubMembershipPaymentMethod,
  type ClubMembershipPlan
} from './domain/playerSync';
import {
  buildFindGameClubs,
  buildGameOpportunities,
  filterMapClubs,
  filterPrivateGames,
  filterTournaments,
  getActiveDiscoveryOpportunity,
  getDiscoveryDeck,
  getOpportunityKey,
  getSavedOpportunities,
  isActivePlayerGame,
  isValidEmail,
  isValidPhoneNumber,
  resolveAddressCoordinate,
  togglePreferredGame
} from './domain/discovery';
import { gamePreferenceOptions } from './domain/playerPreferences';
import type {
  CasinoFilter,
  ClubAccessProduct,
  DiscoveryDecision,
  DistanceFilter,
  GameOpportunity,
  GameTypeFilter,
  MapVenueFilter,
  OnboardingStep,
  PrivateGameDraft,
  Screen,
  SeatRequestDraft,
  TournamentFilter
} from './domain/playerTypes';
import {
  applyMembershipRequest,
  applyWaitlistRequest,
  buildJoinRequest,
  buildWaitRequest
} from './data/playerRequests';
import {
  configureApplePurchases,
  getPlayerPremiumOffering,
  purchasePlayerPremium,
  restorePlayerPremium,
  subscribeToPremiumChanges,
  type PlayerPremiumOffering
} from './data/applePurchases';
import {
  fetchAllClubSnapshots,
  fetchPrivateGameListings,
  fetchPlayerIdentityStatus,
  fetchPlayerProfile,
  fetchPlayerTournaments,
  createClubMembershipCheckout,
  createPlayerIdentityVerificationSession,
  deleteCurrentPlayerAccount,
  getCurrentFirebasePlayer,
  onFirebasePlayerChanged,
  type FirebasePlayerIdentity,
  type PlayerIdentityStatus,
  isSyncConfigured,
  savePlayerProfile,
  signOutCurrentPlayer,
  signInOrCreatePlayerWithEmail,
  signInOrCreatePlayerWithPhone,
  registerForTournament,
  subscribeToAllClubSnapshots,
  subscribeToPrivateGameListings,
  subscribeToPlayerTournaments,
  submitMembershipRequest,
  submitPrivateGameListing,
  submitWaitlistRequest,
  unregisterFromTournament,
  updatePlayerClubMembership
} from './data/orbitSyncApi';
import { OnboardingScreen } from './features/onboarding/OnboardingScreen';
import { DiscoveryDeck, SavedGamesStrip } from './features/discovery/DiscoveryDeck';
import { DiscoverySearchModal, GameFilterPanel, MapFilterControls } from './features/discovery/DiscoveryFilters';
import { GameDetailsScreen } from './features/discovery/DiscoveryGameDetails';
import { HostControlPanel, PremiumPaywall, PrivateGameCard, PrivateGameComposer } from './features/discovery/DiscoveryHosting';
import { MyGamesSection } from './features/discovery/DiscoveryLists';
import { MapExploreScreen } from './features/discovery/MapExploreScreen';
import { discoveryStyles } from './features/discovery/discoveryStyles';
import { TournamentFilterControls, TournamentScreen } from './features/tournaments/TournamentScreen';
import { tournamentStyles } from './features/tournaments/tournamentStyles';
import { ClubAccessCheckoutScreen, ClubMembershipPlanScreen, ClubsScreen, SeatRequestModal } from './features/clubs/ClubRoutes';
import { clubStyles } from './features/clubs/clubStyles';
import { sharedStyles } from './styles/sharedStyles';
import { applyDarkComponentTheme, colors } from './styles/playerTheme';

WebBrowser.maybeCompleteAuthSession();

const tabs: Array<{ id: Screen; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { id: 'findGames', label: 'Games', icon: 'flame-outline' },
  { id: 'tournaments', label: 'Events', icon: 'trophy-outline' },
  { id: 'map', label: 'Map', icon: 'map-outline' },
  { id: 'clubs', label: 'Clubs', icon: 'business-outline' },
  { id: 'settings', label: 'Profile', icon: 'person-outline' }
];

const emptyPlayer: PlayerAccount = {
  id: '',
  name: '',
  email: '',
  phone: '',
  homeLocation: '',
  searchRadiusMiles: 20,
  preferredGameIds: [],
  favoriteClubIds: [],
  preferredStakes: '',
  typicalAvailability: ''
};
const emptyPrivateGameDraft: PrivateGameDraft = {
  name: '',
  location: '',
  startsAt: '',
  seats: '6',
  note: ''
};
const emptyIdentityStatus: PlayerIdentityStatus = {
  status: 'unverified',
  ageVerified: false,
  ageLevel: 0,
  minimumAge: 21,
  verifiedAt: null,
  failureCode: null
};
const legacyPlayerStorageKeys = ['tabletalk-player-account-v1', 'tabletalk-player-account-v2'];
const playerStorageKey = 'orbit-player-account-v1';
const dismissedAlertsStorageKey = 'orbit-player-dismissed-alerts-v1';
const accountSignInReadyStatus = 'Use your email address or phone number to sync this player profile.';
const defaultPremiumMonthlyPriceLabel = '$12.99/month';
const supportPhone = '346-434-1402';
const supportPhoneUrl = 'tel:+13464341402';
const playerPremiumEnabled = process.env.EXPO_PUBLIC_ENABLE_PLAYER_PREMIUM === 'true';
const cardHouseCheckoutEnabled = process.env.EXPO_PUBLIC_ENABLE_CARD_HOUSE_CHECKOUT === 'true';

export default function PlayerApp() {
  const [hasAccount, setHasAccount] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>(0);
  const [screen, setScreen] = useState<Screen>('findGames');
  const [showHostScreen, setShowHostScreen] = useState(false);
  const [gameQuery, setGameQuery] = useState('');
  const [tournamentQuery, setTournamentQuery] = useState('');
  const [tournamentFilter, setTournamentFilter] = useState<TournamentFilter>('all');
  const [tournamentClubFilter, setTournamentClubFilter] = useState('all');
  const [tournamentDistanceFilter, setTournamentDistanceFilter] = useState<DistanceFilter>('none');
  const [selectedCasinoFilter, setSelectedCasinoFilter] = useState<CasinoFilter>('none');
  const [mapQuery, setMapQuery] = useState('');
  const [mapDistanceFilter, setMapDistanceFilter] = useState<DistanceFilter>('none');
  const [mapVenueFilter, setMapVenueFilter] = useState<MapVenueFilter>('all');
  const [gameTypeFilter, setGameTypeFilter] = useState<GameTypeFilter>('all');
  const [selectedFilterClubId, setSelectedFilterClubId] = useState('all');
  const [stakesFilter, setStakesFilter] = useState('');
  const [distanceFilter, setDistanceFilter] = useState<DistanceFilter>('none');
  const [fitScoreFilterEnabled, setFitScoreFilterEnabled] = useState(false);
  const [showDiscoveryFilters, setShowDiscoveryFilters] = useState(false);
  const [showDiscoverySearch, setShowDiscoverySearch] = useState(false);
  const [showTournamentFilters, setShowTournamentFilters] = useState(false);
  const [showMapFilters, setShowMapFilters] = useState(false);
  const [discoveryDecisions, setDiscoveryDecisions] = useState<Record<string, DiscoveryDecision>>({});
  const [selectedDiscoveryOpportunity, setSelectedDiscoveryOpportunity] = useState<GameOpportunity | null>(null);
  const [discoveryNotice, setDiscoveryNotice] = useState('');
  const [privateGameDraft, setPrivateGameDraft] = useState<PrivateGameDraft>(emptyPrivateGameDraft);
  const [privateGames, setPrivateGames] = useState<PlayerPrivateGameListing[]>([]);
  const [privateGameStatus, setPrivateGameStatus] = useState('');
  const [avatarHovered, setAvatarHovered] = useState(false);
  const [premiumStatus, setPremiumStatus] = useState<'inactive' | 'pending' | 'active'>('inactive');
  const [premiumMessage, setPremiumMessage] = useState('');
  const [premiumOffering, setPremiumOffering] = useState<PlayerPremiumOffering | null>(null);
  const [premiumMonthlyPriceLabel, setPremiumMonthlyPriceLabel] = useState(defaultPremiumMonthlyPriceLabel);
  const [clubMembershipMessage, setClubMembershipMessage] = useState('');
  const [pendingClubProduct, setPendingClubProduct] = useState<ClubAccessProduct | null>(null);
  const [seatRequestDraft, setSeatRequestDraft] = useState<SeatRequestDraft | null>(null);
  const [seatRequestMessage, setSeatRequestMessage] = useState('');
  const [clockNow, setClockNow] = useState(Date.now());
  const [player, setPlayer] = useState<PlayerAccount>(emptyPlayer);
  const [draftPlayer, setDraftPlayer] = useState<PlayerAccount>(emptyPlayer);
  const [accountLoaded, setAccountLoaded] = useState(false);
  const [clubs, setClubs] = useState<PlayerClubSnapshot[]>([]);
  const [tournaments, setTournaments] = useState<PlayerTournament[]>([]);
  const [tournamentRegistrations, setTournamentRegistrations] = useState<PlayerTournamentRegistration[]>([]);
  const [tournamentMessage, setTournamentMessage] = useState('');
  const [selectedClubId, setSelectedClubId] = useState('');
  const [dismissedNotificationIds, setDismissedNotificationIds] = useState<string[]>([]);
  const [dismissedAlertsLoaded, setDismissedAlertsLoaded] = useState(false);
  const [firebaseIdentity, setFirebaseIdentity] = useState<FirebasePlayerIdentity | null>(() => getCurrentFirebasePlayer());
  const [identityStatus, setIdentityStatus] = useState<PlayerIdentityStatus>(emptyIdentityStatus);
  const [identityBusy, setIdentityBusy] = useState(false);
  const [identityMessage, setIdentityMessage] = useState('');
  const [identityReturnScreen, setIdentityReturnScreen] = useState<Screen>('findGames');
  const [authStatus, setAuthStatus] = useState(accountSignInReadyStatus);
  const [playerAuthMethod, setPlayerAuthMethod] = useState<'email' | 'phone'>('email');
  const [playerAuthEmail, setPlayerAuthEmail] = useState('');
  const [playerAuthPhone, setPlayerAuthPhone] = useState('');
  const [playerAuthPassword, setPlayerAuthPassword] = useState('');
  const mainScrollRef = useRef<ScrollView>(null);
  const membershipStatusRef = useRef<Record<string, string>>({});
  const [, setSyncStatus] = useState(
    isSyncConfigured() ? 'Connecting to Firebase club sync...' : 'Live club sync is not configured.'
  );

  const selectedClub = clubs.find((club) => club.club.id === selectedClubId) ?? clubs[0];
  const activeInAppNotification = useMemo(
    () => dismissedAlertsLoaded ? getLatestInAppNotification(clubs, dismissedNotificationIds) : null,
    [clubs, dismissedAlertsLoaded, dismissedNotificationIds]
  );
  const memberships = clubs.flatMap((club) => club.memberships.filter((membership) => isPlayerMembership(membership, player)));
  const selectedMembership = selectedClub?.memberships.find((membership) => isPlayerMembership(membership, player));
  const playerWaitlists = selectedClub?.waitlists.filter((entry) => isPlayerWaitlistEntry(entry, player)) ?? [];
  const activePlayerGames = useMemo(
    () => clubs.flatMap((club) =>
      club.waitlists
        .filter((entry) => isPlayerWaitlistEntry(entry, player) && isActivePlayerGameRequest(entry))
        .flatMap((entry) => {
          const game = club.games.find((item) => item.id === entry.gameId);
          return game ? [{ club, game, entry }] : [];
        })
    ),
    [clubs, player]
  );
  const activePlayerGameKeys = useMemo(
    () => new Set(activePlayerGames.map(({ club, game }) => `${club.club.id}:${game.id}`)),
    [activePlayerGames]
  );
  const joinedClubIds = new Set(memberships.filter((membership) => isMembershipCurrentlyActive(membership, clockNow)).map((membership) => membership.clubId));
  const membershipClubIds = new Set(memberships.map((membership) => membership.clubId));
  const favoriteClubIds = player.favoriteClubIds ?? [];
  const memberClubs = clubs.filter((club) => membershipClubIds.has(club.club.id));
  const selectedClubTournaments = selectedClub ? tournaments.filter((tournament) => tournament.clubId === selectedClub.club.id) : [];
  const findGameClubs = useMemo(() => buildFindGameClubs(clubs), [clubs]);
  const playerHomeCoordinate = useMemo(() => resolveAddressCoordinate(player.homeLocation), [player.homeLocation]);
  const searchRadius = distanceFilter;
  const hasPlayerPremium = premiumStatus === 'active';
  const visiblePrivateGames = useMemo(
    () => filterPrivateGames(privateGames, gameQuery, stakesFilter, gameTypeFilter),
    [gameQuery, gameTypeFilter, privateGames, stakesFilter]
  );
  const hostedPrivateGames = useMemo(() => privateGames.filter((game) => game.hostPlayerId === player.id), [privateGames, player.id]);
  const mappedClubs = useMemo(
    () => filterMapClubs(findGameClubs, mapQuery, mapDistanceFilter, mapVenueFilter, playerHomeCoordinate),
    [findGameClubs, mapDistanceFilter, mapQuery, mapVenueFilter, playerHomeCoordinate]
  );
  const visibleTournaments = useMemo(
    () => filterTournaments({
      clubs,
      originCoordinate: playerHomeCoordinate,
      playerId: player.id,
      query: tournamentQuery,
      registrations: tournamentRegistrations,
      tournamentClubFilter,
      tournamentDistanceFilter,
      tournamentFilter,
      tournaments
    }),
    [clubs, player.id, playerHomeCoordinate, tournamentClubFilter, tournamentDistanceFilter, tournamentFilter, tournamentQuery, tournamentRegistrations, tournaments]
  );

  useEffect(() => onFirebasePlayerChanged(setFirebaseIdentity), []);

  useEffect(() => {
    mainScrollRef.current?.scrollTo({ y: 0, animated: false });
    setShowDiscoverySearch(false);
    setShowDiscoveryFilters(false);
    setShowTournamentFilters(false);
    setShowMapFilters(false);
    setSeatRequestDraft(null);
    setSeatRequestMessage('');
    if (screen !== 'gameDetails') setSelectedDiscoveryOpportunity(null);
    if (screen !== 'findGames') setShowHostScreen(false);
    if (screen !== 'clubPayment') setPendingClubProduct(null);
  }, [screen]);

  useEffect(() => {
    if (!firebaseIdentity) {
      setIdentityStatus(emptyIdentityStatus);
      return undefined;
    }
    let active = true;
    const refresh = (forceTokenRefresh = false) => {
      fetchPlayerIdentityStatus(forceTokenRefresh)
        .then((status) => {
          if (!active) return;
          setIdentityStatus(status);
          setIdentityMessage(status.ageVerified ? 'Your age is verified.' : '');
        })
        .catch((error) => {
          if (active) setIdentityMessage(error instanceof Error ? error.message : 'Unable to check age-verification status.');
        });
    };
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') refresh(true);
    });
    refresh();
    return () => {
      active = false;
      appStateSubscription.remove();
    };
  }, [firebaseIdentity?.uid]);

  useEffect(() => {
    let active = true;
    AsyncStorage.multiGet([playerStorageKey, ...legacyPlayerStorageKeys])
      .then((entries) => {
        if (!active) return;
        const stored = entries.find(([, value]) => Boolean(value))?.[1];
        if (!stored) return;
        const parsed = JSON.parse(stored) as Partial<PlayerAccount>;
        if (!parsed.name?.trim() || !parsed.email?.trim()) return;
        const restored: PlayerAccount = {
          ...emptyPlayer,
          ...parsed,
          preferredGameIds: Array.isArray(parsed.preferredGameIds) ? parsed.preferredGameIds : [],
          favoriteClubIds: Array.isArray(parsed.favoriteClubIds) ? parsed.favoriteClubIds : []
        };
        setPlayer(restored);
        setDraftPlayer(restored);
        setHasAccount(true);
        setOnboardingStep(3);
      })
      .catch(() => undefined)
      .finally(() => active && setAccountLoaded(true));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!accountLoaded || !hasAccount || !player.name.trim() || !player.email.trim()) return;
    AsyncStorage.setItem(playerStorageKey, JSON.stringify(player)).catch(() => undefined);
  }, [accountLoaded, hasAccount, player]);

  useEffect(() => {
    if (!accountLoaded || !hasAccount) return;
    AsyncStorage.getItem(dismissedAlertsStorageKey)
      .then((stored) => setDismissedNotificationIds(stored ? JSON.parse(stored) : []))
      .catch(() => setDismissedNotificationIds([]))
      .finally(() => setDismissedAlertsLoaded(true));
  }, [accountLoaded, hasAccount]);

  useEffect(() => {
    if (!playerPremiumEnabled) return undefined;
    if (!accountLoaded || !hasAccount || !player.id) return;
    let active = true;
    let unsubscribe: () => void = () => undefined;

    configureApplePurchases(player.id)
      .then(async (status) => {
        if (!active) return;
        if (!status.configured) {
          setPremiumStatus('inactive');
          setPremiumMessage(Platform.OS === 'ios' ? 'Apple purchases are not configured for this build.' : '');
          return;
        }
        setPremiumStatus(status.active ? 'active' : 'inactive');
        const offering = await getPlayerPremiumOffering();
        if (!active) return;
        setPremiumOffering(offering);
        if (offering) setPremiumMonthlyPriceLabel(offering.priceLabel);
        unsubscribe = subscribeToPremiumChanges((isActive) => {
          setPremiumStatus(isActive ? 'active' : 'inactive');
        });
      })
      .catch((error) => {
        if (active) setPremiumMessage(error instanceof Error ? error.message : 'Unable to connect to Apple purchases.');
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [accountLoaded, hasAccount, player.id]);

  useEffect(() => {
    const timer = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!accountLoaded || !hasAccount || !firebaseIdentity || player.id !== firebaseIdentity.uid) return;
    savePlayerProfile(player).catch(() => undefined);
  }, [accountLoaded, firebaseIdentity, hasAccount, player]);

  useEffect(() => {
    if (!accountLoaded || !hasAccount) return;
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
    let currentAppState = AppState.currentState;

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

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      const returnedToForeground = nextAppState === 'active' && currentAppState !== 'active';
      currentAppState = nextAppState;
      if (nextAppState === 'active') {
        if (returnedToForeground) void liveGameSubscription.refresh();
        liveGameSubscription.startPolling();
      } else {
        liveGameSubscription.stopPolling();
      }
    };

    const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);

    void liveGameSubscription.refresh();
    if (currentAppState === 'active' || currentAppState == null) liveGameSubscription.startPolling();

    return () => {
      appStateSubscription.remove();
      liveGameSubscription.unsubscribe();
    };
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
    fetchPlayerTournaments(player.id).then(handleTournaments).catch(() => undefined);
    return subscribeToPlayerTournaments(player.id, handleTournaments);
  }, [accountLoaded, firebaseIdentity?.uid, hasAccount, player.id]);

  const opportunities = useMemo(
    () => buildGameOpportunities({
      activePlayerGameKeys,
      distanceFilter,
      favoriteClubIds,
      findGameClubs,
      fitScoreFilterEnabled,
      gameQuery,
      gameTypeFilter,
      joinedClubIds,
      player,
      playerHomeCoordinate,
      selectedCasinoFilter,
      selectedFilterClubId,
      stakesFilter
    }),
    [activePlayerGameKeys, distanceFilter, favoriteClubIds, findGameClubs, fitScoreFilterEnabled, gameQuery, gameTypeFilter, joinedClubIds, player.homeLocation, player.preferredGameIds, playerHomeCoordinate, selectedCasinoFilter, selectedFilterClubId, stakesFilter]
  );

  const displayedOpportunities = opportunities;
  const discoveryDeck = useMemo(
    () => getDiscoveryDeck(displayedOpportunities, discoveryDecisions),
    [discoveryDecisions, displayedOpportunities]
  );
  const savedOpportunities = useMemo(
    () => getSavedOpportunities(displayedOpportunities, discoveryDecisions),
    [discoveryDecisions, displayedOpportunities]
  );
  const activeDiscoveryOpportunity = useMemo(
    () => getActiveDiscoveryOpportunity(displayedOpportunities, selectedDiscoveryOpportunity),
    [displayedOpportunities, selectedDiscoveryOpportunity]
  );

  const finishAccount = (identity?: FirebasePlayerIdentity | null) => {
    const normalizedName = draftPlayer.name.trim() || identity?.name.trim() || '';
    const normalizedEmail = draftPlayer.email.trim() || identity?.email.trim() || '';
    if (!normalizedName || !isValidEmail(normalizedEmail) || !isValidPhoneNumber(draftPlayer.phone ?? '', true)) return;
    const id = identity?.uid || draftPlayer.id || `player_${normalizedEmail.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || Date.now()}`;
    const nextPlayer = {
      ...draftPlayer,
      id,
      name: normalizedName,
      email: normalizedEmail,
      searchRadiusMiles: draftPlayer.searchRadiusMiles ?? 20,
      preferredGameIds: draftPlayer.preferredGameIds.length ? draftPlayer.preferredGameIds : ['nlh-1-2']
    };
    setPlayer(nextPlayer);
    setDraftPlayer(nextPlayer);
    setHasAccount(true);
    setScreen('findGames');
    setSyncStatus(isSyncConfigured() ? 'Account ready - syncing from Firebase...' : 'Account ready, but live club sync is unavailable.');
    if (identity) savePlayerProfile(nextPlayer).catch(() => undefined);
  };

  const completeAccount = async () => {
    const normalizedName = draftPlayer.name.trim();
    const normalizedEmail = draftPlayer.email.trim();
    if (!normalizedName || !isValidEmail(normalizedEmail) || !isValidPhoneNumber(draftPlayer.phone ?? '', true)) return;
    finishAccount(firebaseIdentity);
  };

  const openPremiumCheckout = async () => {
    if (Platform.OS !== 'ios') {
      setPremiumMessage('Player Premium purchases are currently available in the iOS app.');
      return;
    }
    if (!premiumOffering) {
      setPremiumMessage('Player Premium is not available from the App Store right now. Please try again later.');
      return;
    }
    setPremiumMessage('Opening Apple purchase sheet...');
    setPremiumStatus('pending');
    try {
      const active = await purchasePlayerPremium(premiumOffering);
      setPremiumStatus(active ? 'active' : 'inactive');
      setPremiumMessage(active ? 'Player Premium is active.' : 'Apple did not confirm an active subscription.');
    } catch (error) {
      setPremiumStatus('inactive');
      const cancelled = (error as { userCancelled?: boolean }).userCancelled;
      setPremiumMessage(cancelled ? 'Purchase cancelled.' : error instanceof Error ? error.message : 'Unable to complete the purchase.');
    }
  };

  const restorePremiumPurchases = async () => {
    setPremiumMessage('Restoring Apple purchases...');
    try {
      const active = await restorePlayerPremium();
      setPremiumStatus(active ? 'active' : 'inactive');
      setPremiumMessage(active ? 'Player Premium restored.' : 'No active Player Premium subscription was found.');
    } catch (error) {
      setPremiumMessage(error instanceof Error ? error.message : 'Unable to restore purchases.');
    }
  };

  const showIdentityVerification = (returnScreen: Screen, message = '') => {
    setIdentityReturnScreen(returnScreen);
    setIdentityMessage(message);
    setScreen('identityVerification');
  };

  const requireVerifiedAge = (returnScreen: Screen, action: string) => {
    if (firebaseIdentity && identityStatus.ageVerified) return true;
    if (!firebaseIdentity) {
      showIdentityVerification(returnScreen, `Sign in, then verify your age before ${action}.`);
    } else if (identityStatus.status === 'underage') {
      showIdentityVerification(returnScreen, `You must be ${identityStatus.minimumAge}+ to ${action}.`);
    } else if (identityStatus.status === 'processing') {
      showIdentityVerification(returnScreen, 'Stripe is still reviewing your verification.');
    } else {
      showIdentityVerification(returnScreen, `Verify that you are ${identityStatus.minimumAge}+ before ${action}.`);
    }
    return false;
  };

  const refreshIdentityVerification = async () => {
    if (!firebaseIdentity) {
      setIdentityMessage('Sign in to your Orbit Player account before verifying your age.');
      return null;
    }
    setIdentityBusy(true);
    try {
      const status = await fetchPlayerIdentityStatus(true);
      setIdentityStatus(status);
      setIdentityMessage(
        status.ageVerified
          ? 'Your age is verified.'
          : status.status === 'processing'
            ? 'Stripe is still reviewing your verification.'
            : status.status === 'underage'
              ? `You must be ${status.minimumAge}+ to use player access features.`
              : 'Verification is not complete yet.'
      );
      return status;
    } catch (error) {
      setIdentityMessage(error instanceof Error ? error.message : 'Unable to refresh age-verification status.');
      return null;
    } finally {
      setIdentityBusy(false);
    }
  };

  const startIdentityVerification = async () => {
    if (!firebaseIdentity) {
      setIdentityMessage('Sign in to your Orbit Player account before verifying your age.');
      return;
    }
    setIdentityBusy(true);
    setIdentityMessage('Opening Stripe Identity...');
    try {
      const session = await createPlayerIdentityVerificationSession();
      setIdentityStatus(session.identity);
      if (session.alreadyVerified || session.identity.ageVerified) {
        setIdentityMessage('Your age is verified.');
        return;
      }
      if (!session.verificationUrl) {
        setIdentityMessage('Stripe is still reviewing your verification. Check again shortly.');
        return;
      }
      const browserResult = await WebBrowser.openAuthSessionAsync(session.verificationUrl, session.returnUrl);
      const status = await fetchPlayerIdentityStatus(true);
      setIdentityStatus(status);
      setIdentityMessage(
        status.ageVerified
          ? 'Your age is verified.'
          : status.status === 'processing'
            ? 'Stripe received your information and is reviewing it.'
            : status.status === 'underage'
              ? `You must be ${status.minimumAge}+ to use player access features.`
              : browserResult.type === 'cancel' || browserResult.type === 'dismiss'
                ? 'Verification was not completed. You can continue when ready.'
                : 'Stripe needs more information to finish verification.'
      );
    } catch (error) {
      setIdentityMessage(error instanceof Error ? error.message : 'Unable to start age verification.');
    } finally {
      setIdentityBusy(false);
    }
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
      const result = await WebBrowser.openBrowserAsync(checkout.checkoutUrl);
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

  const finishFirebaseAccountConnection = async (identity: FirebasePlayerIdentity) => {
    const usesPhoneAlias = identity.email.endsWith('@players.orbit.local');
    const nextPlayer: PlayerAccount = {
      ...player,
      id: identity.uid,
      name: identity.name || player.name,
      email: usesPhoneAlias ? player.email : identity.email || player.email,
      phone: playerAuthMethod === 'phone' ? playerAuthPhone.trim() || player.phone : player.phone
    };
    setFirebaseIdentity(identity);
    setDraftPlayer(nextPlayer);
    setPlayer(nextPlayer);
    setHasAccount(true);
    await savePlayerProfile(nextPlayer);
    setAuthStatus(`Connected as ${playerAuthMethod === 'phone' ? nextPlayer.phone : nextPlayer.email}.`);
  };

  const connectPlayerAccount = async () => {
    setAuthStatus('Signing in to your Orbit Player account...');
    try {
      const identity = playerAuthMethod === 'email'
        ? await signInOrCreatePlayerWithEmail(playerAuthEmail, playerAuthPassword)
        : await signInOrCreatePlayerWithPhone(playerAuthPhone || player.phone || '', playerAuthPassword);
      await finishFirebaseAccountConnection(identity);
      setPlayerAuthPassword('');
    } catch (error) {
      setAuthStatus(error instanceof Error ? error.message : 'Sign-in could not be completed.');
    }
  };

  const publishPrivateGame = async () => {
    if (!requireVerifiedAge('findGames', 'hosting a game')) return;
    if (!hasPlayerPremium) {
      setPrivateGameStatus('Player hosting requires Player Premium.');
      setPremiumMessage('Upgrade to Player Premium to host private games.');
      return;
    }
    const name = privateGameDraft.name.trim();
    const location = privateGameDraft.location.trim();
    if (!name || !location) return;
    const createdAt = new Date().toISOString();
    const listing: PlayerPrivateGameListing = {
      id: `private_${player.id || 'player'}_${Date.now()}`,
      name,
      location,
      startsAt: privateGameDraft.startsAt.trim() || 'Tonight',
      seats: privateGameDraft.seats.trim() || '6',
      note: privateGameDraft.note.trim(),
      hostPlayerId: player.id,
      hostPlayerPath: `players/${player.id}`,
      hostPlayerName: player.name,
      createdAt,
      status: 'Open'
    };
    setPrivateGameStatus('Listing private game...');
    const result = await submitPrivateGameListing(listing);
    if (!result.ok) {
      setPrivateGameStatus(result.error);
      return;
    }
    setPrivateGames((current) => [result.game, ...current.filter((game) => game.id !== result.game.id)]);
    setPrivateGameStatus('Private game listed.');
    setPrivateGameDraft(emptyPrivateGameDraft);
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

  const openDirections = (club: PlayerClubSnapshot) => {
    const destination = encodeURIComponent(club.club.address || club.club.name);
    const url = Platform.select({
      ios: `http://maps.apple.com/?daddr=${destination}`,
      android: `google.navigation:q=${destination}`,
      default: `https://www.google.com/maps/dir/?api=1&destination=${destination}`
    });
    if (url) Linking.openURL(url).catch(() => undefined);
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

  const dismissInAppAlert = (notificationId: string) => {
    setDismissedNotificationIds((current) => {
      const next = Array.from(new Set([...current, notificationId]));
      AsyncStorage.setItem(dismissedAlertsStorageKey, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  };

  const resetLocalAccount = async () => {
    await AsyncStorage.multiRemove([playerStorageKey, ...legacyPlayerStorageKeys]);
    setFirebaseIdentity(null);
    setPlayer(emptyPlayer);
    setDraftPlayer(emptyPlayer);
    setHasAccount(false);
    setOnboardingStep(0);
    setScreen('findGames');
  };

  const deletePlayerAccount = () => {
    Alert.alert(
      'Delete Orbit Player account?',
      'This permanently deletes your Orbit Player profile and sign-in. Club transaction records may be retained where legally required.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: () => {
            setAuthStatus('Deleting your account...');
            deleteCurrentPlayerAccount()
              .then(resetLocalAccount)
              .catch((error) => {
                const requiresLogin = (error as { code?: string }).code === 'auth/requires-recent-login';
                setAuthStatus(requiresLogin
                  ? 'For security, sign out and sign back in before deleting your account.'
                  : error instanceof Error ? error.message : 'Unable to delete the account.');
              });
          }
        }
      ]
    );
  };

  const signOutPlayer = async () => {
    await signOutCurrentPlayer();
    await resetLocalAccount();
  };

  const decideDiscoveryOpportunity = (item: GameOpportunity, decision: DiscoveryDecision) => {
    const key = getOpportunityKey(item);
    setDiscoveryDecisions((current) => ({ ...current, [key]: decision }));
    if (decision === 'saved') {
      setDiscoveryNotice(`${item.game.name} saved. Review the join options and game alerts.`);
      setSelectedDiscoveryOpportunity(item);
      setScreen('gameDetails');
    } else {
      setSelectedDiscoveryOpportunity(null);
      setDiscoveryNotice(`Passed on ${item.game.name}.`);
    }
  };

  const openDiscoveryGame = (item: GameOpportunity) => {
    setSelectedDiscoveryOpportunity(item);
    setScreen('gameDetails');
  };

  const closeDiscoveryGame = () => {
    setSelectedDiscoveryOpportunity(null);
    setScreen('findGames');
  };

  useEffect(() => {
    if (screen !== 'gameDetails') return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setSelectedDiscoveryOpportunity(null);
      setScreen('findGames');
      return true;
    });
    return () => subscription.remove();
  }, [screen]);

  const resetDiscoveryDeck = () => {
    setDiscoveryDecisions({});
    setDiscoveryNotice('Discovery deck refreshed.');
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

  if (!hasAccount) {
    return (
      <OnboardingScreen
        draftPlayer={draftPlayer}
        onboardingStep={onboardingStep}
        setDraftPlayer={setDraftPlayer}
        setOnboardingStep={setOnboardingStep}
        onComplete={completeAccount}
      />
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <LinearGradient colors={['#060c1a', '#0b1020', '#10182b']} style={styles.appBackdrop} />
        <View style={styles.shell}>
          {screen !== 'gameDetails' ? (
            <View style={styles.header}>
              <View>
                <Text style={[styles.eyebrow, styles.darkShellEyebrow]}>{screen === 'findGames' ? 'Poker near you' : screen === 'clubs' ? 'Your memberships' : screen === 'tournaments' ? 'Upcoming games' : screen === 'map' ? 'Browse nearby' : 'Orbit Player'}</Text>
                <Text style={[styles.title, styles.darkShellTitle]}>{screen === 'clubSignup' || screen === 'clubPayment' ? 'Card House Store' : screen === 'findGames' ? 'Discover' : getScreenTitle(screen)}</Text>
              </View>
              <Pressable
                accessibilityLabel="Open settings"
                onHoverIn={() => setAvatarHovered(true)}
                onHoverOut={() => setAvatarHovered(false)}
                style={styles.avatar}
                onPress={() => setScreen('settings')}
              >
                <Text style={styles.avatarText}>{player.name.slice(0, 1)}</Text>
                {avatarHovered ? (
                  <View pointerEvents="none" style={styles.iconTooltip}>
                    <Text style={styles.iconTooltipText}>Settings</Text>
                  </View>
                ) : null}
              </Pressable>
            </View>
          ) : null}

          <ScrollView ref={mainScrollRef} showsVerticalScrollIndicator={screen === 'tournaments' || screen === 'gameDetails'} contentContainerStyle={styles.content}>
            {screen === 'gameDetails' && activeDiscoveryOpportunity ? (
              <GameDetailsScreen
                key={getOpportunityKey(activeDiscoveryOpportunity)}
                item={activeDiscoveryOpportunity}
                player={player}
                onBack={closeDiscoveryGame}
                onDirections={() => openDirections(activeDiscoveryOpportunity.club)}
                onJoin={() => {
                  const item = activeDiscoveryOpportunity;
                  item.isJoined ? joinWaitlist(item.club, item.game) : openClubSignup(item.club);
                }}
                onViewStore={() => openClubSignup(activeDiscoveryOpportunity.club)}
              />
            ) : null}
            {screen === 'identityVerification' ? (
              <IdentityVerificationScreen
                status={identityStatus}
                signedIn={Boolean(firebaseIdentity)}
                busy={identityBusy}
                message={identityMessage}
                onBack={() => setScreen(identityReturnScreen)}
                onSignIn={() => setScreen('settings')}
                onStart={startIdentityVerification}
                onRefresh={refreshIdentityVerification}
              />
            ) : null}
            {screen === 'findGames' && !showHostScreen ? (
              <>
                <MyGamesSection
                  games={activePlayerGames}
                  onBuyTime={(club) => openClubPayment(club, 'time-5')}
                  onCancel={(club, game, entry) => cancelWaitlist(club, game, entry)}
                />
                <View style={styles.sectionHeader}>
                  <View>
                    <Text style={styles.sectionTitle}>Discover games</Text>
                    <Text style={styles.muted}>Games you have already requested are kept in My Games.</Text>
                  </View>
                </View>
                <View style={styles.discoveryToolbar}>
                  <Pressable
                    accessibilityLabel="Search games"
                    onPress={() => setShowDiscoverySearch(true)}
                    style={[styles.discoveryToolbarButton, gameQuery ? styles.discoveryToolbarButtonActive : null]}
                  >
                    <Ionicons name="search-outline" size={18} color={gameQuery ? '#ffffff' : '#9aabd0'} />
                    <Text numberOfLines={1} style={[styles.discoveryToolbarText, gameQuery ? styles.discoveryToolbarTextActive : null]}>
                      {gameQuery || 'Search'}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel="Show game filters"
                    onPress={() => setShowDiscoveryFilters(true)}
                    style={styles.discoveryToolbarButton}
                  >
                    <Ionicons name="options-outline" size={18} color="#9aabd0" />
                    <Text style={styles.discoveryToolbarText}>Filters</Text>
                  </Pressable>
                </View>
                <DiscoverySearchModal
                  visible={showDiscoverySearch}
                  value={gameQuery}
                  onChangeText={setGameQuery}
                  onClose={() => setShowDiscoverySearch(false)}
                />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.discoveryQuickFilters}>
                  {[
                    { label: 'All', value: '' },
                    { label: '$1/$2', value: '1/2' },
                    { label: '$1/$3', value: '1/3' },
                    { label: '$2/$5', value: '2/5' },
                    { label: 'PLO', value: 'PLO' },
                    { label: 'DC', value: 'DC' },
                    { label: 'ROE', value: 'ROE' }
                  ].map((filter) => {
                    const active = stakesFilter === filter.value;
                    return (
                      <Pressable
                        key={filter.label}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        onPress={() => setStakesFilter(filter.value)}
                        style={[styles.discoveryQuickFilter, active && styles.discoveryQuickFilterActive]}
                      >
                        <Text style={[styles.discoveryQuickFilterText, active && styles.discoveryQuickFilterTextActive]}>{filter.label}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>

                <DiscoveryDeck
                  opportunities={discoveryDeck}
                  totalCount={displayedOpportunities.length}
                  savedCount={savedOpportunities.length}
                  onPass={(item) => decideDiscoveryOpportunity(item, 'pass')}
                  onPick={(item) => decideDiscoveryOpportunity(item, 'saved')}
                  onDetails={openDiscoveryGame}
                  onReset={resetDiscoveryDeck}
                />
                {discoveryNotice ? (
                  <View style={styles.discoveryNotice}>
                    <Ionicons name="sparkles-outline" size={16} color={colors.primary} />
                    <Text style={styles.discoveryNoticeText}>{discoveryNotice}</Text>
                  </View>
                ) : null}

                {savedOpportunities.length ? (
                  <SavedGamesStrip opportunities={savedOpportunities} onOpen={openDiscoveryGame} />
                ) : null}

                {playerPremiumEnabled ? (
                  <Pressable style={styles.hostPromptCard} onPress={() => setShowHostScreen(true)}>
                    <View style={styles.hostPromptIcon}>
                      <Ionicons name="home-outline" size={18} color={colors.primary} />
                    </View>
                    <View style={styles.hostPromptCopy}>
                      <Text style={styles.cardTitle}>Hosting a group?</Text>
                      <Text style={styles.muted}>Publish a private game for nearby players.</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                  </Pressable>
                ) : null}

                {visiblePrivateGames.length ? (
                  <>
                    <View style={styles.sectionHeader}>
                      <Text style={styles.sectionTitle}>Groups playing nearby</Text>
                      <Text style={styles.muted}>{visiblePrivateGames.length} open</Text>
                    </View>
                    {visiblePrivateGames.map((game) => (
                      <PrivateGameCard key={game.id} game={game} />
                    ))}
                  </>
                ) : null}
              </>
            ) : null}

            {screen === 'tournaments' ? (
              <TournamentScreen
                query={tournamentQuery}
                onQueryChange={setTournamentQuery}
                onOpenFilters={() => setShowTournamentFilters(true)}
                opportunities={visibleTournaments}
                hasOrbitAccount={Boolean(firebaseIdentity && firebaseIdentity.uid === player.id)}
                message={tournamentMessage}
                onSelectClub={(club) => {
                  setSelectedClubId(club.club.id);
                  setScreen('clubs');
                }}
                onRegister={registerTournament}
                onUnregister={unregisterTournament}
              />
            ) : null}



            {screen === 'map' ? (
              <MapExploreScreen
                clubs={mappedClubs}
                originCoordinate={playerHomeCoordinate}
                query={mapQuery}
                setQuery={setMapQuery}
                onOpenFilters={() => setShowMapFilters(true)}
                onDirections={openDirections}
                onShowGames={(club) => {
                  setSelectedFilterClubId(club.club.id);
                  setScreen('findGames');
                }}
              />
            ) : null}

            {playerPremiumEnabled && screen === 'findGames' && showHostScreen ? (
              <>
                <Pressable style={styles.inlineBackAction} onPress={() => setShowHostScreen(false)}>
                  <Ionicons name="chevron-back" size={17} color={colors.primary} />
                  <Text style={styles.inlineBackText}>Find Games</Text>
                </Pressable>
                {hasPlayerPremium ? (
                  <>
                    <HostControlPanel playerName={player.name} hostedCount={hostedPrivateGames.length} />
                    <PrivateGameComposer
                      draft={privateGameDraft}
                      setDraft={setPrivateGameDraft}
                      onPublish={publishPrivateGame}
                    />
                  </>
                ) : (
                  <PremiumPaywall
                    title="Host Games with Premium"
                    body="Player-hosted game posting is included with Player Premium, so your private table appears for nearby players."
                    priceLabel={premiumMonthlyPriceLabel}
                    message={premiumMessage || privateGameStatus}
                    onUpgrade={openPremiumCheckout}
                  />
                )}
                {privateGameStatus ? <Text style={styles.privateGameStatus}>{privateGameStatus}</Text> : null}
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Your posted games</Text>
                  <Text style={styles.muted}>{hostedPrivateGames.length} open</Text>
                </View>
                {hostedPrivateGames.length ? hostedPrivateGames.map((game) => (
                  <PrivateGameCard key={game.id} game={game} />
                )) : (
                  <View style={styles.emptyState}>
                    <Text style={styles.cardTitle}>No hosted games yet</Text>
                    <Text style={styles.muted}>Post a game above and it will appear for nearby players in Find Games.</Text>
                  </View>
                )}
              </>
            ) : null}

            {screen === 'clubs' ? (
              <ClubsScreen
                memberClubs={memberClubs}
                selectedClub={selectedClub}
                selectedMembership={selectedMembership}
                player={player}
                originCoordinate={playerHomeCoordinate}
                nowMs={clockNow}
                message={clubMembershipMessage}
                waitlists={playerWaitlists}
                tournaments={selectedClubTournaments}
                onSelectClub={(club) => setSelectedClubId(club.club.id)}
                onGame={(game) => joinWaitlist(selectedClub, game)}
                onManageAccess={() => openClubSignup(selectedClub)}
                onViewEvents={() => {
                  setTournamentClubFilter(selectedClub.club.id);
                  setScreen('tournaments');
                }}
              />
            ) : null}

            {screen === 'clubSignup' && selectedClub ? (
              <ClubMembershipPlanScreen
                club={selectedClub}
                prices={getClubMembershipPrices(selectedClub)}
                message={clubMembershipMessage}
                player={player}
                onBack={() => setScreen('clubs')}
                onSubmit={(membershipOption) => submitMembershipApplication(selectedClub, membershipOption)}
              />
            ) : null}

            {screen === 'clubPayment' && selectedClub && pendingClubProduct ? (
              <ClubAccessCheckoutScreen
                club={selectedClub}
                product={pendingClubProduct}
                price={getClubProductLabel(pendingClubProduct, getClubMembershipPrices(selectedClub))}
                message={clubMembershipMessage}
                connectedCheckoutEnabled={cardHouseCheckoutEnabled}
                onBack={() => setScreen('clubSignup')}
                onPayInApp={() => completeClubPayment(selectedClub, pendingClubProduct)}
                onPayInPerson={() => requestInPersonMembership(selectedClub, pendingClubProduct)}
              />
            ) : null}

            {screen === 'settings' ? (
              <View style={styles.accountCard}>
                <View style={styles.sectionHeader}>
                  <View>
                    <Text style={styles.sectionTitle}>Profile & settings</Text>
                    <Text style={styles.muted}>Keep your account and poker preferences current.</Text>
                  </View>
                </View>
                {!firebaseIdentity ? (
                  <View style={styles.emailAuthPanel}>
                    <Text style={styles.cardTitle}>Account access</Text>
                    <Text style={styles.muted}>{authStatus}</Text>
                    <View style={styles.chipRow}>
                      <Chip label="Email address" active={playerAuthMethod === 'email'} onPress={() => setPlayerAuthMethod('email')} />
                      <Chip label="Phone number" active={playerAuthMethod === 'phone'} onPress={() => setPlayerAuthMethod('phone')} />
                    </View>
                    {playerAuthMethod === 'email' ? (
                      <View style={styles.searchInputRow}>
                        <Ionicons name="mail-outline" size={18} color={colors.muted} />
                        <TextInput
                          value={playerAuthEmail}
                          onChangeText={setPlayerAuthEmail}
                          autoCapitalize="none"
                          keyboardType="email-address"
                          placeholder="Email address"
                          placeholderTextColor={colors.muted}
                          style={styles.searchInput}
                        />
                      </View>
                    ) : (
                      <View style={styles.searchInputRow}>
                        <Ionicons name="call-outline" size={18} color={colors.muted} />
                        <TextInput
                          value={playerAuthPhone}
                          onChangeText={setPlayerAuthPhone}
                          keyboardType="phone-pad"
                          placeholder="Phone number"
                          placeholderTextColor={colors.muted}
                          style={styles.searchInput}
                        />
                      </View>
                    )}
                    <View style={styles.searchInputRow}>
                      <Ionicons name="lock-closed-outline" size={18} color={colors.muted} />
                      <TextInput
                        value={playerAuthPassword}
                        onChangeText={setPlayerAuthPassword}
                        autoCapitalize="none"
                        secureTextEntry
                        placeholder="Password (6+ characters)"
                        placeholderTextColor={colors.muted}
                        style={styles.searchInput}
                      />
                    </View>
                    <Pressable style={styles.compactButton} onPress={connectPlayerAccount}>
                      <Text style={styles.compactButtonText}>Sign in or create account</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={styles.googleAuthPanel}>
                    <View style={styles.googleAuthIcon}>
                      <Ionicons name="checkmark-circle-outline" size={20} color={colors.teal} />
                    </View>
                    <View style={styles.googleAuthBody}>
                      <Text style={styles.cardTitle}>Account connected</Text>
                      <Text style={styles.muted}>{player.phone || player.email}</Text>
                    </View>
                  </View>
                )}
                <SimpleMenuRow
                  icon="shield-checkmark-outline"
                  title="Identity & age"
                  subtitle={getIdentityStatusLabel(identityStatus, Boolean(firebaseIdentity))}
                  onPress={() => showIdentityVerification('settings')}
                />
                {playerPremiumEnabled ? (
                  <>
                    <View style={styles.googleAuthPanel}>
                      <View style={styles.googleAuthIcon}>
                        <Ionicons name={hasPlayerPremium ? 'diamond' : 'diamond-outline'} size={20} color={hasPlayerPremium ? colors.teal : colors.primaryDark} />
                      </View>
                      <View style={styles.googleAuthBody}>
                        <Text style={styles.cardTitle}>{hasPlayerPremium ? 'Player Premium Active' : `Player Premium ${premiumMonthlyPriceLabel}`}</Text>
                      </View>
                      {!hasPlayerPremium ? (
                        <Pressable style={styles.compactButton} onPress={openPremiumCheckout}>
                          <Text style={styles.compactButtonText}>Upgrade</Text>
                        </Pressable>
                      ) : null}
                    </View>
                    {premiumMessage ? <Text style={styles.privateGameStatus}>{premiumMessage}</Text> : null}
                    <Pressable style={styles.secondaryActionButton} onPress={restorePremiumPurchases}>
                      <Text style={styles.secondaryActionText}>Restore Apple purchases</Text>
                    </Pressable>
                  </>
                ) : null}
                <Field label="Name" value={player.name} onChangeText={(name) => setPlayer((current) => ({ ...current, name }))} />
                <Field label="Email address" keyboardType="email-address" value={player.email} onChangeText={(email) => setPlayer((current) => ({ ...current, email }))} />
                <Field label="Phone number" keyboardType="phone-pad" value={player.phone ?? ''} onChangeText={(phone) => setPlayer((current) => ({ ...current, phone }))} />
                <Field
                  label="Home area"
                  value={player.homeLocation ?? ''}
                  onChangeText={(homeLocation) => setPlayer((current) => ({ ...current, homeLocation }))}
                />
                <Text style={styles.fieldLabel}>Preferred games</Text>
                <View style={styles.chipRow}>
                  {gamePreferenceOptions.map((game) => (
                    <Chip
                      key={game.id}
                      label={game.label}
                      active={player.preferredGameIds.includes(game.id)}
                      onPress={() => setPlayer((current) => togglePreferredGame(current, game.id))}
                    />
                  ))}
                </View>
                <Field
                  label="Preferred stakes"
                  value={player.preferredStakes ?? ''}
                  onChangeText={(preferredStakes) => setPlayer((current) => ({ ...current, preferredStakes }))}
                />
                <Field
                  label="Typical availability"
                  value={player.typicalAvailability ?? ''}
                  placeholder="Evenings, weekends, after 6 PM..."
                  onChangeText={(typicalAvailability) => setPlayer((current) => ({ ...current, typicalAvailability }))}
                />
                <View style={styles.simpleMenu}>
                  <SimpleMenuRow icon="call-outline" title="Support" subtitle={supportPhone} onPress={() => Linking.openURL(supportPhoneUrl)} />
                  <SimpleMenuRow icon="shield-checkmark-outline" title="Privacy Policy" subtitle="Legal" onPress={() => Linking.openURL(privacyPolicyUrl)} />
                  <SimpleMenuRow icon="document-text-outline" title="Terms of Service" subtitle="Legal" onPress={() => Linking.openURL(termsOfServiceUrl)} />
                </View>
                {firebaseIdentity ? (
                  <>
                    <Pressable style={styles.secondaryActionButton} onPress={signOutPlayer}>
                      <Text style={styles.secondaryActionText}>Sign out</Text>
                    </Pressable>
                    <Pressable style={styles.secondaryActionButton} onPress={deletePlayerAccount}>
                      <Text style={[styles.secondaryActionText, { color: '#b42318' }]}>Delete account</Text>
                    </Pressable>
                  </>
                ) : null}
              </View>
            ) : null}
          </ScrollView>

          {screen !== 'gameDetails' && screen !== 'identityVerification' ? (
            <View style={styles.tabBar}>
              {tabs.map((tab) => (
                <Pressable
                  key={tab.id}
                  onPress={() => {
                    setScreen(tab.id);
                    setSelectedDiscoveryOpportunity(null);
                    if (tab.id !== 'findGames') setShowHostScreen(false);
                  }}
                  style={[styles.tab, screen === tab.id && styles.activeTab]}
                >
                  <Ionicons name={tab.icon} size={19} color={screen === tab.id ? '#6f91ff' : '#566680'} />
                  <Text style={[styles.tabText, screen === tab.id && styles.activeTabText]}>{tab.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
        <FiltersBottomSheet
          visible={showDiscoveryFilters}
          title="Game filters"
          onClose={() => setShowDiscoveryFilters(false)}
          onReset={() => {
            setGameTypeFilter('all');
            setSelectedFilterClubId('all');
            setSelectedCasinoFilter('none');
            setStakesFilter('');
            setDistanceFilter('none');
            setFitScoreFilterEnabled(false);
          }}
        >
          <View style={styles.sheetField}>
            <Text style={styles.fieldLabel}>Location</Text>
            <TextInput
              value={player.homeLocation ?? ''}
              onChangeText={(homeLocation) => setPlayer((current) => ({ ...current, homeLocation }))}
              placeholder="Your address or city"
              placeholderTextColor={colors.muted}
              style={styles.sheetTextInput}
            />
          </View>
          <GameFilterPanel
            clubs={findGameClubs}
            gameType={gameTypeFilter}
            setGameType={setGameTypeFilter}
            selectedClubId={selectedFilterClubId}
            setSelectedClubId={setSelectedFilterClubId}
            selectedCasinoId={selectedCasinoFilter}
            setSelectedCasinoId={setSelectedCasinoFilter}
            stakes={stakesFilter}
            setStakes={setStakesFilter}
            distance={distanceFilter}
            setDistance={setDistanceFilter}
            fitScoreEnabled={fitScoreFilterEnabled}
            setFitScoreEnabled={setFitScoreFilterEnabled}
          />
        </FiltersBottomSheet>
        <FiltersBottomSheet
          visible={showTournamentFilters}
          title="Tournament filters"
          onClose={() => setShowTournamentFilters(false)}
          onReset={() => {
            setTournamentFilter('all');
            setTournamentClubFilter('all');
            setTournamentDistanceFilter('none');
          }}
        >
          <View style={styles.sheetField}>
            <Text style={styles.fieldLabel}>Location</Text>
            <TextInput
              value={player.homeLocation ?? ''}
              onChangeText={(homeLocation) => setPlayer((current) => ({ ...current, homeLocation }))}
              placeholder="Your address or city"
              placeholderTextColor={colors.muted}
              style={styles.sheetTextInput}
            />
          </View>
          <TournamentFilterControls
            clubs={clubs}
            eventFilter={tournamentFilter}
            setEventFilter={setTournamentFilter}
            clubFilter={tournamentClubFilter}
            setClubFilter={setTournamentClubFilter}
            distance={tournamentDistanceFilter}
            setDistance={setTournamentDistanceFilter}
          />
        </FiltersBottomSheet>
        <FiltersBottomSheet
          visible={showMapFilters}
          title="Map filters"
          onClose={() => setShowMapFilters(false)}
          onReset={() => {
            setMapVenueFilter('all');
            setMapDistanceFilter('none');
          }}
        >
          <View style={styles.sheetField}>
            <Text style={styles.fieldLabel}>Location</Text>
            <TextInput
              value={player.homeLocation ?? ''}
              onChangeText={(homeLocation) => setPlayer((current) => ({ ...current, homeLocation }))}
              placeholder="Your address or city"
              placeholderTextColor={colors.muted}
              style={styles.sheetTextInput}
            />
          </View>
          <MapFilterControls
            venue={mapVenueFilter}
            setVenue={setMapVenueFilter}
            distance={mapDistanceFilter}
            setDistance={setMapDistanceFilter}
          />
        </FiltersBottomSheet>
        <SeatRequestModal
          draft={seatRequestDraft}
          message={seatRequestMessage}
          onChange={setSeatRequestDraft}
          onClose={() => setSeatRequestDraft(null)}
          onSubmit={submitSeatRequest}
        />
        {activeInAppNotification ? (
          <InAppNotificationPopup
            notification={activeInAppNotification}
            onDismiss={() => dismissInAppAlert(activeInAppNotification.id)}
          />
        ) : null}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function IdentityVerificationScreen({
  status,
  signedIn,
  busy,
  message,
  onBack,
  onSignIn,
  onStart,
  onRefresh
}: {
  status: PlayerIdentityStatus;
  signedIn: boolean;
  busy: boolean;
  message: string;
  onBack: () => void;
  onSignIn: () => void;
  onStart: () => void | Promise<void>;
  onRefresh: () => void | Promise<unknown>;
}) {
  const verified = status.ageVerified;
  const processing = status.status === 'processing';
  const underage = status.status === 'underage';
  const primaryLabel = !signedIn
    ? 'Sign in to continue'
    : verified
      ? 'Continue'
      : processing
        ? 'Check status'
        : busy
          ? 'Opening Stripe...'
          : 'Verify with Stripe';
  const primaryAction = !signedIn
    ? onSignIn
    : verified
      ? onBack
      : processing
        ? () => void onRefresh()
        : () => void onStart();

  return (
    <View style={[styles.accountCard, styles.identityCard]}>
      <View style={styles.identityIcon}>
        <Ionicons
          name={verified ? 'checkmark-circle' : underage ? 'alert-circle-outline' : 'shield-checkmark-outline'}
          size={34}
          color={verified ? colors.teal : underage ? '#b42318' : colors.primary}
        />
      </View>
      <View style={styles.identityCopy}>
        <Text style={styles.sectionTitle}>
          {verified ? 'Age verified' : underage ? 'Age requirement not met' : `Verify that you are ${status.minimumAge}+`}
        </Text>
        <Text style={styles.muted}>
          {verified
            ? 'Your age is verified for hosted games, tournament registration, and eligible connected purchases.'
            : underage
              ? `Orbit player access features are limited to verified players age ${status.minimumAge} or older.`
              : 'Card-house membership ID is checked by staff at the door. Stripe verification is only used for hosted games, tournament registration, and eligible connected purchases.'}
        </Text>
      </View>
      {message ? <Text style={styles.privateGameStatus}>{message}</Text> : null}
      {!underage ? (
        <Pressable
          disabled={busy}
          onPress={primaryAction}
          style={[styles.primaryButton, styles.fullWidthButton, busy && styles.disabledAction]}
        >
          <Text style={styles.primaryButtonText}>{primaryLabel}</Text>
        </Pressable>
      ) : null}
      {signedIn && !verified && !underage && !processing ? (
        <Pressable disabled={busy} onPress={() => void onRefresh()} style={styles.secondaryActionButton}>
          <Text style={styles.secondaryActionText}>I already completed verification</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={onBack} style={styles.secondaryActionButton}>
        <Text style={styles.secondaryActionText}>{verified ? 'Back' : 'Not now'}</Text>
      </Pressable>
      <Text style={styles.identityPrivacy}>
        Your ID images and document details are handled by Stripe Identity and are not stored in Orbit.
      </Text>
    </View>
  );
}



function InAppNotificationPopup({
  notification,
  onDismiss
}: {
  notification: PlayerInAppNotification;
  onDismiss: () => void;
}) {
  return (
    <View pointerEvents="box-none" style={styles.alertToastHost}>
      <View style={styles.alertPopup}>
        <View style={styles.alertPopupIcon}>
          <Ionicons name="notifications-outline" size={20} color={colors.primary} />
        </View>
        <View style={styles.alertPopupCopy}>
          <Text style={styles.alertPopupTitle}>{notification.title}</Text>
          <Text style={styles.alertPopupBody}>{notification.body}</Text>
        </View>
        <Pressable accessibilityLabel="Dismiss notification" style={styles.alertPopupClose} onPress={onDismiss}>
          <Ionicons name="close" size={18} color={colors.muted} />
        </Pressable>
      </View>
    </View>
  );
}

function getScreenTitle(screen: Screen) {
  if (screen === 'settings') return 'Profile';
  if (screen === 'identityVerification') return 'Age Verification';
  return tabs.find((tab) => tab.id === screen)?.label ?? 'Orbit';
}

function getIdentityStatusLabel(status: PlayerIdentityStatus, signedIn: boolean) {
  if (!signedIn) return 'Not signed in';
  if (status.ageVerified) return `Verified ${status.minimumAge}+`;
  if (status.status === 'processing') return 'Verification pending';
  if (status.status === 'underage') return `Minimum age ${status.minimumAge}`;
  return 'Not verified';
}


function getLatestInAppNotification(clubs: PlayerClubSnapshot[], dismissedIds: string[]) {
  const dismissed = new Set(dismissedIds);
  const now = Date.now();
  return clubs
    .flatMap((club) => club.notifications ?? [])
    .filter((notification) => !dismissed.has(notification.id))
    .filter((notification) => !notification.expiresAt || Date.parse(notification.expiresAt) > now)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
}


function formatCurrency(value: number) {
  const prefix = value < 0 ? '-' : '';
  return `${prefix}$${Math.abs(Math.round(value)).toLocaleString()}`;
}



const playerAppStyles = StyleSheet.create(applyDarkComponentTheme({
  appBackdrop: {
    ...StyleSheet.absoluteFillObject
  },
  shell: {
    alignSelf: 'center',
    flex: 1,
    maxWidth: 640,
    paddingHorizontal: 16,
    paddingTop: 6,
    width: '100%'
  },
  onboardingHero: {
    backgroundColor: colors.primaryDark,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 12,
    borderWidth: 1,
    gap: 14,
    minHeight: 190,
    overflow: 'hidden',
    padding: 20,
    paddingTop: 20,
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.08,
    shadowRadius: 24
  },
  onboardingHeroTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  onboardingHeroMarker: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 10,
    height: 40,
    justifyContent: 'center',
    width: 40
  },
  onboardingHeroMeta: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    fontWeight: '700'
  },
  heroIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderColor: colors.line,
    borderRadius: 18,
    borderWidth: 1,
    height: 54,
    justifyContent: 'center',
    width: 54
  },
  onboardingCopy: {
    color: 'rgba(255,255,255,0.74)',
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 22
  },
  demoLink: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 14,
    fontWeight: '700'
  },
  onboardingSecondaryAction: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: 14
  },
  onboardingPrimaryAction: {
    flex: 1.4,
    minHeight: 50
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingTop: 4
  },
  eyebrow: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0,
    textTransform: 'uppercase'
  },
  title: {
    color: colors.ink,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 32,
    maxWidth: 285,
    textShadowRadius: 0
  },
  darkShellEyebrow: { color: '#7082a5' },
  darkShellTitle: { color: '#f4f7ff' },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.primaryDark,
    borderColor: 'rgba(255,255,255,0.9)',
    borderRadius: 999,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    position: 'relative',
    width: 44
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800'
  },
  content: {
    gap: 10,
    paddingBottom: 104
  },
  inAppBanner: {
    alignItems: 'flex-start',
    backgroundColor: '#fff7ed',
    borderColor: '#fed7aa',
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 14
  },
  inAppBannerIcon: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 999,
    height: 34,
    justifyContent: 'center',
    width: 34
  },
  inAppBannerCopy: {
    flex: 1,
    gap: 3
  },
  inAppBannerTitle: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '900'
  },
  inAppBannerBody: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18
  },
  inAppBannerDismiss: {
    alignItems: 'center',
    height: 30,
    justifyContent: 'center',
    width: 30
  },
  alertToastHost: { left: 14, position: 'absolute', right: 14, top: 58, zIndex: 200 },
  alertPopup: { alignItems: 'flex-start', backgroundColor: colors.panel, borderColor: colors.line, borderRadius: 16, borderWidth: 1, elevation: 12, flexDirection: 'row', gap: 11, padding: 14, shadowColor: '#000000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.28, shadowRadius: 24 },
  alertPopupIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 11, height: 40, justifyContent: 'center', width: 40 },
  alertPopupCopy: { flex: 1, gap: 3, paddingTop: 1 },
  alertPopupTitle: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  alertPopupBody: { color: colors.muted, fontSize: 12, fontWeight: '600', lineHeight: 17 },
  alertPopupClose: { alignItems: 'center', height: 32, justifyContent: 'center', marginRight: -5, marginTop: -5, width: 32 },
  heroPanel: {
    borderRadius: 28,
    overflow: 'hidden',
    padding: 1,
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.1,
    shadowRadius: 30
  },
  heroGlass: {
    backgroundColor: 'rgba(16,32,51,0.18)',
    borderRadius: 27,
    gap: 14,
    padding: 18
  },
  heroTopRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between'
  },
  heroBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderRadius: 999,
    height: 42,
    justifyContent: 'center',
    width: 42
  },
  heroKicker: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase'
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 25,
    fontWeight: '900',
    lineHeight: 30
  },
  heroCopy: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  metric: {
    backgroundColor: 'rgba(255,255,255,0.84)',
    borderColor: 'rgba(255,255,255,0.9)',
    borderRadius: 20,
    borderWidth: 1,
    flexBasis: '48%',
    flexGrow: 1,
    padding: 14,
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 20
  },
  metricLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800'
  },
  metricValue: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: '900',
    marginTop: 4
  },
  searchPanel: {
    backgroundColor: 'rgba(255,254,250,0.92)',
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    gap: 9,
    padding: 10
  },
  searchInputRow: {
    alignItems: 'center',
    backgroundColor: '#f4f4f1',
    borderColor: 'rgba(24,23,22,0.06)',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 12
  },
  hostPrompt: {
    alignItems: 'center',
    borderTopColor: colors.line,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingTop: 10
  },
  clubGamesHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    marginTop: 4
  },
  clubSwitcher: {
    gap: 8,
    paddingRight: 16
  },
  clubSwitchChip: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 12
  },
  clubSwitchChipActive: {
    backgroundColor: colors.tealSoft,
    borderColor: 'rgba(21,127,109,0.28)'
  },
  clubSwitchText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '800'
  },
  clubSwitchTextActive: {
    color: colors.primary
  },
  googleAuthPanel: {
    alignItems: 'center',
    backgroundColor: '#f6f6f3',
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 12
  },
  emailAuthPanel: {
    backgroundColor: '#f6f6f3',
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    padding: 12
  },
  googleAuthIcon: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderRadius: 999,
    height: 40,
    justifyContent: 'center',
    width: 40
  },
  googleAuthBody: {
    flex: 1,
    gap: 3
  },
  socialPulse: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderColor: 'rgba(255,255,255,0.82)',
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 11,
    padding: 13,
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 18
  },
  socialPulseIcon: {
    alignItems: 'center',
    backgroundColor: colors.tealSoft,
    borderRadius: 16,
    height: 44,
    justifyContent: 'center',
    width: 44
  },
  socialPulseBody: {
    flex: 1,
    gap: 3
  },
  syncBand: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderColor: colors.line,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    padding: 12
  },
  syncText: {
    color: colors.primaryDark,
    flex: 1,
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 17
  },
  signupCard: {
    backgroundColor: '#fbfffc',
    borderColor: 'rgba(21,127,109,0.18)',
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.03,
    shadowRadius: 12
  },
  signupHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 11
  },
  signupIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 12,
    height: 42,
    justifyContent: 'center',
    width: 42
  },
  signupCopy: {
    flex: 1,
    gap: 4
  },
  planCardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  planIconFeatured: {
    backgroundColor: colors.primary
  },
  planCardTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  planInlineBadge: { color: colors.teal, fontSize: 9, fontWeight: '900', textTransform: 'uppercase' },
  planBadge: {
    backgroundColor: colors.tealSoft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  planBadgeText: {
    color: colors.teal,
    fontSize: 12,
    fontWeight: '900'
  },
  planPrice: {
    color: colors.ink,
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 0
  },
  planButton: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 12
  },
  planButtonFeatured: {
    backgroundColor: colors.primary
  },
  planButtonText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '900'
  },
  planButtonTextFeatured: {
    color: '#ffffff'
  },
  membershipNote: {
    alignItems: 'center',
    backgroundColor: '#f6f6f3',
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    padding: 11
  },
  preferredPill: {
    backgroundColor: '#f2fbf8',
    borderColor: 'rgba(15,118,110,0.16)'
  },
  preferredPillText: {
    color: colors.teal
  },
  heroAction: {
    alignSelf: 'flex-start',
    paddingHorizontal: 18
  },
  secondaryAction: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 10,
    flex: 1,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: 14
  },
  progressTrack: {
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    height: 10,
    overflow: 'hidden'
  },
  progressFill: {
    backgroundColor: colors.teal,
    borderRadius: 999,
    height: 10
  },
  identityCard: {
    alignSelf: 'center',
    marginTop: 18,
    maxWidth: 520,
    padding: 22,
    width: '100%'
  },
  identityIcon: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    height: 68,
    justifyContent: 'center',
    width: 68
  },
  identityCopy: {
    alignItems: 'center',
    gap: 7
  },
  identityPrivacy: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center'
  },
  mapHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  radiusRing: {
    borderColor: 'rgba(56,80,109,0.18)',
    borderRadius: 999,
    borderWidth: 2,
    height: '34%',
    left: '33%',
    position: 'absolute',
    top: '34%',
    width: '34%'
  },
  radiusRingMedium: {
    height: '56%',
    left: '22%',
    top: '22%',
    width: '56%'
  },
  radiusRingLarge: {
    height: '82%',
    left: '9%',
    top: '9%',
    width: '82%'
  },
  routeLine: {
    backgroundColor: 'rgba(56,80,109,0.16)',
    height: 4,
    left: '28%',
    position: 'absolute',
    top: '54%',
    transform: [{ rotate: '-22deg' }],
    width: '48%'
  },
  homePin: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderColor: '#ffffff',
    borderRadius: 999,
    borderWidth: 2,
    height: 34,
    justifyContent: 'center',
    marginLeft: -17,
    marginTop: -17,
    position: 'absolute',
    width: 34
  },
  mapChoicePin: {
    alignItems: 'center',
    backgroundColor: colors.amber,
    borderColor: '#ffffff',
    borderRadius: 999,
    borderWidth: 2,
    height: 30,
    justifyContent: 'center',
    marginLeft: -15,
    marginTop: -15,
    position: 'absolute',
    width: 30
  },
  clubMapPin: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderColor: '#ffffff',
    borderRadius: 999,
    borderWidth: 2,
    height: 34,
    justifyContent: 'center',
    marginLeft: -17,
    marginTop: -17,
    position: 'absolute',
    width: 34
  },
  clubMapPinSelected: {
    backgroundColor: colors.amber,
    transform: [{ scale: 1.12 }]
  },
  clubMapPinJoined: {
    backgroundColor: colors.teal
  },
  mapPinText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900'
  },
  tabBar: {
    alignItems: 'center',
    backgroundColor: 'rgba(13,21,37,0.96)',
    borderColor: 'rgba(77,124,254,0.16)',
    borderRadius: 14,
    borderWidth: 1,
    bottom: 18,
    flexDirection: 'row',
    gap: 2,
    left: 8,
    padding: 5,
    position: 'absolute',
    right: 8
  },
  tab: {
    alignItems: 'center',
    borderRadius: 10,
    flex: 1,
    gap: 2,
    minHeight: 50,
    justifyContent: 'center'
  },
  activeTab: {
    backgroundColor: '#1a294b'
  },
  tabText: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: '900'
  },
  activeTabText: {
    color: '#6f91ff'
  },
  discoveryIntro: {
    alignItems: 'flex-start',
    backgroundColor: '#111a2d',
    borderColor: 'rgba(77,124,254,0.18)',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 15
  },
  discoveryIntroCopy: { flex: 1, gap: 4 },
  discoveryKicker: { color: colors.primary, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  discoveryIntroTitle: { color: '#f4f7ff', fontSize: 20, fontWeight: '900', lineHeight: 25 },
  discoveryIntroBody: { color: '#8899bb', fontSize: 12, fontWeight: '600', lineHeight: 17 },
  discoveryFilterButton: {
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42
  },
  discoveryFilterButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  simpleFactsRow: { flexDirection: 'row', gap: 8 },
  simpleFact: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 11, flex: 1, flexDirection: 'row', gap: 6, minHeight: 38, paddingHorizontal: 9 },
  simpleFactText: { color: '#e8eeff', fontSize: 11, fontWeight: '800' },
  discoveryDivider: { backgroundColor: colors.line, height: 1 },
  discoveryAccessRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  discoveryAccessIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 11, height: 36, justifyContent: 'center', width: 36 },
  discoveryAccessCopy: { flex: 1, gap: 1 },
  discoveryAccessTitle: { color: colors.ink, fontSize: 13, fontWeight: '900' },
  discoveryTagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  discoveryTag: { backgroundColor: '#f3f4f6', borderRadius: 99, paddingHorizontal: 9, paddingVertical: 5 },
  discoveryTagText: { color: colors.ink, fontSize: 10, fontWeight: '800' },
  matchReasonBand: { alignItems: 'center', backgroundColor: 'rgba(15,118,110,0.12)', borderColor: 'rgba(15,118,110,0.20)', borderRadius: 10, borderWidth: 1, flexDirection: 'row', gap: 7, padding: 9 },
  matchReasonText: { color: '#99f6e4', flex: 1, fontSize: 10, fontWeight: '700', lineHeight: 14 },
  cardDetailsLink: { alignItems: 'center', backgroundColor: 'rgba(77,124,254,0.14)', borderColor: 'rgba(77,124,254,0.25)', borderRadius: 999, borderWidth: 1, flexDirection: 'row', gap: 4, minHeight: 38, paddingHorizontal: 14 },
  cardDetailsLinkText: { color: '#8da8ff', fontSize: 12, fontWeight: '900' },
  swipeActionRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 13 },
  swipeAction: { alignItems: 'center', borderRadius: 18, flexDirection: 'row', gap: 6, justifyContent: 'center', minHeight: 50, paddingHorizontal: 17 },
  swipePassAction: { backgroundColor: '#ffffff', borderColor: '#fecaca', borderWidth: 1 },
  swipePassText: { color: '#dc2626', fontSize: 13, fontWeight: '900' },
  swipePickAction: { backgroundColor: colors.primary, shadowColor: colors.primary, shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.22, shadowRadius: 14 },
  swipePickText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  swipeDetailsAction: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 99, height: 48, justifyContent: 'center', width: 48 },
  swipeDetailsText: { color: colors.primary, fontSize: 8, fontWeight: '900' },
  swipeHint: { color: colors.muted, fontSize: 10, fontWeight: '700', textAlign: 'center' },
  membershipWalletHeader: { alignItems: 'center', backgroundColor: '#ffffff', borderColor: colors.line, borderRadius: 16, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', padding: 15 },
  membershipWalletHeaderCopy: { flex: 1, gap: 2, paddingRight: 8 },
  walletCountBadge: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 13, minWidth: 56, padding: 9 },
  walletCountValue: { color: colors.primary, fontSize: 20, fontWeight: '900' },
  walletCountLabel: { color: colors.primary, fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  gameAlertCard: { alignItems: 'center', backgroundColor: '#edf7f5', borderColor: '#b9d9d3', borderRadius: 15, borderWidth: 1, flexDirection: 'row', gap: 10, padding: 13 },
  gameAlertIcon: { alignItems: 'center', backgroundColor: '#ffffff', borderRadius: 11, height: 40, justifyContent: 'center', width: 40 },
  gameAlertCopy: { flex: 1, gap: 2 },
  alertOnPill: { alignItems: 'center', backgroundColor: '#ffffff', borderRadius: 99, flexDirection: 'row', gap: 4, paddingHorizontal: 8, paddingVertical: 5 },
  alertOnDot: { backgroundColor: '#22c55e', borderRadius: 99, height: 6, width: 6 },
  alertOnText: { color: colors.ink, fontSize: 9, fontWeight: '900' },
  simpleMenu: { backgroundColor: '#ffffff', borderColor: colors.line, borderRadius: 16, borderWidth: 1, overflow: 'hidden' }
}));

const styles = { ...sharedStyles, ...discoveryStyles, ...tournamentStyles, ...clubStyles, ...playerAppStyles };

