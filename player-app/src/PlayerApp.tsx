import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, AppState, BackHandler, Easing, Linking, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type AppStateStatus, type DimensionValue } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, PROVIDER_GOOGLE, Circle } from './components/MapView';
import { LinearGradient } from 'expo-linear-gradient';
import * as WebBrowser from 'expo-web-browser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  formatPassCountdown,
  getPlayerGameStatusLabel,
  getWaitlistAheadText,
  isMembershipCurrentlyActive,
  isPlayerMembership,
  isPlayerWaitlistEntry,
  normalizedIdentity,
  type PlayerAccount,
  type PlayerClubMembershipRecord,
  type PlayerClubSnapshot,
  type PlayerInAppNotification,
  type PlayerPrivateGameListing,
  type PlayerSyncGame,
  type PlayerTournament,
  type PlayerTournamentRegistration,
  type PlayerWaitlistEntry,
  type ClubMembershipPaymentMethod,
  type ClubMembershipPlan
} from './domain/playerSync';
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
  signInWithGooglePopup,
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

WebBrowser.maybeCompleteAuthSession();

type Screen = 'findGames' | 'gameDetails' | 'tournaments' | 'map' | 'clubs' | 'clubSignup' | 'clubPayment' | 'identityVerification' | 'settings';
type OnboardingStep = 0 | 1 | 2 | 3;
type GameTypeFilter = 'none' | 'all' | 'public' | 'private' | 'card-house' | 'home-game' | 'favorites';
type DistanceFilter = 'none' | 5 | 10 | 20 | 50;
type CasinoFilter = 'none' | 'all' | string;
type TournamentFilter = 'all' | 'open' | 'free' | 'registered';
type MapVenueFilter = 'all' | 'card-house' | 'casino' | 'club';
type ClubAccessProduct = 'day' | 'monthly' | 'time-5';
type DiscoveryDecision = 'pass' | 'saved';

type SeatRequestDraft = {
  club: PlayerClubSnapshot;
  game: PlayerSyncGame;
  attendance: 'arrived' | 'confirmed' | 'interested';
  expectedArrivalTime: string;
  availabilityStartTime: string;
  availabilityEndTime: string;
};

type GameOpportunity = {
  club: PlayerClubSnapshot;
  game: PlayerSyncGame;
  distanceMiles: number;
  isJoined: boolean;
  isPreferred: boolean;
  score: number;
  seatScore: number;
  socialScore: number;
  profileScore: number;
  waitScore: number;
};

type PrivateGameDraft = {
  name: string;
  location: string;
  startsAt: string;
  seats: string;
  note: string;
};

const tabs: Array<{ id: Screen; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { id: 'findGames', label: 'Discover', icon: 'flame-outline' },
  { id: 'tournaments', label: 'Events', icon: 'trophy-outline' },
  { id: 'map', label: 'Map', icon: 'map-outline' },
  { id: 'clubs', label: 'Clubs', icon: 'business-outline' },
  { id: 'settings', label: 'Profile', icon: 'person-outline' }
];

const gamePreferenceOptions = [
  { id: 'nlh-1-2', label: '1/2 NLH' },
  { id: 'nlh-1-3', label: '1/3 NLH' },
  { id: 'plo-1-2', label: '1/2 PLO' }
];

const clubDistanceMiles: Record<string, number> = {};
const clubCoordinates: Record<string, { latitude: number; longitude: number }> = {};

const texasMapRegion = {
  latitude: 31.75,
  longitude: -96.75,
  latitudeDelta: 5,
  longitudeDelta: 5.4
};

const findGamesClubOrder: string[] = [];
const findGamesClubNames: string[] = [];
const clubFeeProfiles: Record<string, { type: 'time'; hourly: string } | { type: 'rake'; percent: string }> = {};

const homeCoordinate = { latitude: 30.613, longitude: -96.342 };

const texasAddressCoordinates: Array<{ keywords: string[]; coordinate: { latitude: number; longitude: number } }> = [
  { keywords: ['dallas', '75226', '2711 main'], coordinate: { latitude: 32.7867, longitude: -96.7997 } },
  { keywords: ['austin', '78701', '78705', 'congress', '26th street'], coordinate: { latitude: 30.2679, longitude: -97.743 } },
  { keywords: ['college station', 'bryan', '77803', '77840', 'main street bryan'], coordinate: { latitude: 30.6205, longitude: -96.3269 } },
  { keywords: ['houston', '77002', 'prairie', 'san jacinto'], coordinate: { latitude: 29.7608, longitude: -95.3608 } },
  { keywords: ['durant', 'choctaw', '74701'], coordinate: { latitude: 33.952, longitude: -96.4122 } },
  { keywords: ['thackerville', 'winstar', '73459'], coordinate: { latitude: 33.7913, longitude: -97.1456 } },
  { keywords: ['el paso', 'elpaso', '79901', '79902'], coordinate: { latitude: 31.7619, longitude: -106.485 } }
];

const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;

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
const googleSignInReadyStatus = 'Connect Google or use email/password to register and sync your player profile.';
const defaultPremiumMonthlyPriceLabel = '$12.99/month';
const supportPhone = '346-434-1402';
const supportPhoneUrl = 'tel:+13464341402';
const privacyPolicyUrl = process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL || '';
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
  const [firebaseIdentity, setFirebaseIdentity] = useState<FirebasePlayerIdentity | null>(() => getCurrentFirebasePlayer());
  const [identityStatus, setIdentityStatus] = useState<PlayerIdentityStatus>(emptyIdentityStatus);
  const [identityBusy, setIdentityBusy] = useState(false);
  const [identityMessage, setIdentityMessage] = useState('');
  const [identityReturnScreen, setIdentityReturnScreen] = useState<Screen>('findGames');
  const [authStatus, setAuthStatus] = useState(googleSignInReadyStatus);
  const [playerAuthEmail, setPlayerAuthEmail] = useState('');
  const [playerAuthPassword, setPlayerAuthPassword] = useState('');
  const [, setSyncStatus] = useState(
    isSyncConfigured() ? 'Connecting to Firebase club sync...' : 'Live club sync is not configured.'
  );

  const selectedClub = clubs.find((club) => club.club.id === selectedClubId) ?? clubs[0];
  const activeInAppNotification = useMemo(
    () => getLatestInAppNotification(clubs, dismissedNotificationIds),
    [clubs, dismissedNotificationIds]
  );
  const memberships = clubs.flatMap((club) => club.memberships.filter((membership) => isPlayerMembership(membership, player)));
  const selectedMembership = selectedClub?.memberships.find((membership) => isPlayerMembership(membership, player));
  const playerWaitlists = selectedClub?.waitlists.filter((entry) => isPlayerWaitlistEntry(entry, player)) ?? [];
  const joinedClubIds = new Set(memberships.filter((membership) => isMembershipCurrentlyActive(membership, clockNow)).map((membership) => membership.clubId));
  const membershipClubIds = new Set(memberships.map((membership) => membership.clubId));
  const favoriteClubIds = player.favoriteClubIds ?? [];
  const memberClubs = clubs.filter((club) => membershipClubIds.has(club.club.id));
  const selectedClubTournaments = selectedClub ? tournaments.filter((tournament) => tournament.clubId === selectedClub.club.id) : [];
  const findGameClubs = useMemo(() => buildFindGameClubs(clubs), [clubs]);
  const playerHomeCoordinate = useMemo(() => resolveAddressCoordinate(player.homeLocation), [player.homeLocation]);
  const searchRadius = distanceFilter;
  const hasPlayerPremium = premiumStatus === 'active';
  const visiblePrivateGames = useMemo(() => {
    const query = gameQuery.trim().toLowerCase();
    const stakesQuery = stakesFilter.trim().toLowerCase();
    const typeAllowsPrivate = gameTypeFilter === 'none' || gameTypeFilter === 'all' || gameTypeFilter === 'private' || gameTypeFilter === 'home-game';
    if (!typeAllowsPrivate) return [];
    return privateGames.filter((game) => {
      const haystack = `${game.name} ${game.location} ${game.note}`.toLowerCase();
      return (!query || haystack.includes(query)) && (!stakesQuery || game.name.toLowerCase().includes(stakesQuery));
    });
  }, [gameQuery, gameTypeFilter, privateGames, stakesFilter]);
  const hostedPrivateGames = useMemo(() => privateGames.filter((game) => game.hostPlayerId === player.id), [privateGames, player.id]);
  const mappedClubs = useMemo(() => {
    const query = mapQuery.trim().toLowerCase();
    return findGameClubs
      .filter((club) => {
        const haystack = `${club.club.name} ${club.club.address ?? ''} ${club.games.map((game) => game.name).join(' ')}`.toLowerCase();
        if (query && !haystack.includes(query)) return false;
        if (mapDistanceFilter !== 'none' && getClubDistance(club, playerHomeCoordinate) > mapDistanceFilter) return false;
        if (mapVenueFilter === 'casino' && !isCasinoClub(club)) return false;
        if (mapVenueFilter === 'card-house' && getVenueKind(club) !== 'Card house') return false;
        if (mapVenueFilter === 'club' && getVenueKind(club) !== 'Poker club') return false;
        return true;
      })
      .sort((left, right) => getClubDistance(left, playerHomeCoordinate) - getClubDistance(right, playerHomeCoordinate));
  }, [findGameClubs, mapDistanceFilter, mapQuery, mapVenueFilter, playerHomeCoordinate]);
  const visibleTournaments = useMemo(() => {
    const query = tournamentQuery.trim().toLowerCase();
    return tournaments
      .map((tournament) => {
        const club = clubs.find((item) => item.club.id === tournament.clubId);
        const registration = tournamentRegistrations.find((item) => item.tournamentId === tournament.id && item.playerId === player.id);
        const distanceMiles = club ? getClubDistance(club, playerHomeCoordinate) : Number.POSITIVE_INFINITY;
        return { tournament, club, registration, distanceMiles };
      })
      .filter(({ tournament, club, registration, distanceMiles }) => {
        const haystack = `${tournament.name} ${club?.club.name ?? ''} ${club?.club.address ?? ''} ${tournament.prizePoolLabel} ${tournament.rules.join(' ')}`.toLowerCase();
        if (query && !haystack.includes(query)) return false;
        if (tournamentClubFilter !== 'all' && tournament.clubId !== tournamentClubFilter) return false;
        if (tournamentDistanceFilter !== 'none' && club && distanceMiles > tournamentDistanceFilter) return false;
        if (tournamentFilter === 'open' && tournament.registrationStatus !== 'open') return false;
        if (tournamentFilter === 'free' && tournament.buyIn !== 0) return false;
        if (tournamentFilter === 'registered' && !registration) return false;
        return true;
      })
      .sort((left, right) => Date.parse(left.tournament.startsAt) - Date.parse(right.tournament.startsAt));
  }, [clubs, player.id, playerHomeCoordinate, tournamentClubFilter, tournamentDistanceFilter, tournamentFilter, tournamentQuery, tournamentRegistrations, tournaments]);

  useEffect(() => onFirebasePlayerChanged(setFirebaseIdentity), []);

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

  const opportunities = useMemo(() => {
    const query = gameQuery.trim().toLowerCase();
    const stakesQuery = stakesFilter.trim().toLowerCase();
    const hasLocationFilter = Boolean(player.homeLocation?.trim());
    return findGameClubs
      .flatMap<GameOpportunity>((club) => {
        const distanceMiles = getClubDistance(club, playerHomeCoordinate);
        const isJoined = joinedClubIds.has(club.club.id);
        const clubSearchText = getClubSearchText(club);
        const casinoClub = isCasinoClub(club);
        if (gameTypeFilter === 'favorites' && !favoriteClubIds.includes(club.club.id)) return [];
        if (casinoClub) {
          if (selectedCasinoFilter === 'none') return [];
          if (selectedCasinoFilter !== 'all' && club.club.id !== selectedCasinoFilter) return [];
        } else {
          if (selectedFilterClubId === 'none') return [];
          if (selectedFilterClubId !== 'all' && club.club.id !== selectedFilterClubId) return [];
        }
        return club.games
          .filter((game) => !query || `${game.name} ${clubSearchText}`.toLowerCase().includes(query))
          .filter((game) => !stakesQuery || game.name.toLowerCase().includes(stakesQuery))
          .filter((game) => matchesGameTypeFilter(club, game, gameTypeFilter))
          .map((game) => {
            const isPreferred = player.preferredGameIds.includes(game.id);
            const seatScore = game.availableSeats * 16 + game.formingCount * 7;
            const socialScore = game.knownPlayersCount * 9 + (club.social?.knownPlayersInHouse ?? 0) * 3;
            const profileScore = (isJoined ? 42 : 0) + (isPreferred ? 28 : 0);
            const favoriteScore = favoriteClubIds.includes(club.club.id) ? 18 : 0;
            const waitScore = Math.max(0, 18 - game.waitlistCount * 3);
            return {
              club,
              game,
              distanceMiles,
              isJoined,
              isPreferred,
              seatScore,
              socialScore,
              profileScore,
              waitScore,
              score: seatScore + socialScore + profileScore + favoriteScore + waitScore - distanceMiles * 2
            };
          });
      })
      .filter((item) => !hasLocationFilter || distanceFilter === 'none' || isCasinoClub(item.club) || item.distanceMiles <= distanceFilter || Boolean(query && getClubSearchText(item.club).includes(query)))
      .sort((left, right) => {
        const leftFavorite = favoriteClubIds.includes(left.club.club.id);
        const rightFavorite = favoriteClubIds.includes(right.club.club.id);
        if (leftFavorite !== rightFavorite) return leftFavorite ? -1 : 1;
        if (fitScoreFilterEnabled) return right.score - left.score || left.distanceMiles - right.distanceMiles;
        return right.score - left.score || left.distanceMiles - right.distanceMiles;
      });
  }, [distanceFilter, favoriteClubIds, findGameClubs, fitScoreFilterEnabled, gameQuery, gameTypeFilter, joinedClubIds, player.homeLocation, player.preferredGameIds, playerHomeCoordinate, selectedCasinoFilter, selectedFilterClubId, stakesFilter]);

  const displayedOpportunities = opportunities;
  const discoveryDeck = useMemo(
    () => displayedOpportunities.filter((item) => !discoveryDecisions[getOpportunityKey(item)]),
    [discoveryDecisions, displayedOpportunities]
  );
  const savedOpportunities = useMemo(
    () => displayedOpportunities.filter((item) => discoveryDecisions[getOpportunityKey(item)] === 'saved'),
    [discoveryDecisions, displayedOpportunities]
  );
  const activeDiscoveryOpportunity = useMemo(() => {
    if (!selectedDiscoveryOpportunity) return null;
    return displayedOpportunities.find(
      (item) => getOpportunityKey(item) === getOpportunityKey(selectedDiscoveryOpportunity)
    ) ?? selectedDiscoveryOpportunity;
  }, [displayedOpportunities, selectedDiscoveryOpportunity]);

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
    if (!player.name.trim() || !isValidEmail(player.email) || !isValidPhoneNumber(player.phone ?? '')) {
      setClubMembershipMessage('Enter your name, a valid email, and a 10-digit phone number before applying.');
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
    const nextPlayer: PlayerAccount = {
      ...player,
      id: identity.uid,
      name: identity.name || player.name,
      email: identity.email || player.email
    };
    setFirebaseIdentity(identity);
    setDraftPlayer(nextPlayer);
    setPlayer(nextPlayer);
    setHasAccount(true);
    await savePlayerProfile(nextPlayer);
    setAuthStatus(`Connected as ${identity.email || identity.name}.`);
  };

  const connectGoogleAccount = async () => {
    setAuthStatus('Opening Google sign-in...');
    try {
      await finishFirebaseAccountConnection(await signInWithGooglePopup());
    } catch (error) {
      const code = (error as { code?: string }).code;
      setAuthStatus(code === 'auth/operation-not-allowed'
        ? 'Google is disabled in Firebase. Use email/password below or enable Google in Firebase Authentication.'
        : error instanceof Error ? error.message : 'Google sign-in could not be completed.');
    }
  };

  const connectEmailAccount = async () => {
    setAuthStatus('Signing in to your Orbit Player account...');
    try {
      await finishFirebaseAccountConnection(await signInOrCreatePlayerWithEmail(playerAuthEmail, playerAuthPassword));
      setPlayerAuthPassword('');
    } catch (error) {
      setAuthStatus(error instanceof Error ? error.message : 'Email sign-in could not be completed.');
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
    paymentMethod: ClubMembershipPaymentMethod = 'app'
  ) => {
    setSelectedClubId(club.club.id);
    const prices = getClubMembershipPrices(club);
    const priceLabel = plan === 'day' ? prices.day : prices.monthly;
    const request = buildJoinRequest(player, club.club.id, plan, paymentMethod, priceLabel);
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
      setSyncStatus(`Saved locally - ${result.error}`);
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
      attendance: game.openTables.length ? 'arrived' : 'interested',
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
      <SafeAreaProvider>
        <SafeAreaView style={[styles.safeArea, styles.onboardingSafeArea]}>
          <StatusBar style="dark" />
          <AnimatedGradientBackground />
          <ScrollView style={styles.onboardingShell} contentContainerStyle={styles.onboardingContent} showsVerticalScrollIndicator={false}>
            <OnboardingFlow
              draftPlayer={draftPlayer}
              onboardingStep={onboardingStep}
              setDraftPlayer={setDraftPlayer}
              setOnboardingStep={setOnboardingStep}
              onComplete={completeAccount}
            />
          </ScrollView>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <LinearGradient colors={['#fcfcfb', '#f8f8f6', '#f4f5f2']} style={styles.appBackdrop} />
        <View style={styles.shell}>
          {screen !== 'gameDetails' ? (
            <View style={styles.header}>
              <View>
                <Text style={styles.eyebrow}>{screen === 'findGames' ? 'Poker near you' : screen === 'clubs' ? 'Your memberships' : screen === 'tournaments' ? 'Upcoming games' : screen === 'map' ? 'Browse nearby' : 'Orbit Player'}</Text>
                <Text style={styles.title}>{screen === 'clubSignup' || screen === 'clubPayment' ? 'Card House Store' : screen === 'findGames' ? 'Discover' : getScreenTitle(screen)}</Text>
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

          <ScrollView showsVerticalScrollIndicator={screen === 'tournaments' || screen === 'gameDetails'} contentContainerStyle={styles.content}>
            {activeInAppNotification && screen !== 'gameDetails' && screen !== 'identityVerification' ? (
              <InAppNotificationBanner
                notification={activeInAppNotification}
                onDismiss={() => setDismissedNotificationIds((ids) => [...ids, activeInAppNotification.id])}
              />
            ) : null}
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
                <View style={styles.discoveryIntro}>
                  <View style={styles.discoveryIntroCopy}>
                    <Text style={styles.discoveryIntroTitle}>Find a game</Text>
                    <Text style={styles.discoveryIntroBody}>Swipe left to skip or right to save.</Text>
                  </View>
                </View>

                <SearchToolbar
                  value={gameQuery}
                  onChangeText={setGameQuery}
                  placeholder="Search games, clubs, or stakes"
                  filterLabel="game"
                  onOpenFilters={() => setShowDiscoveryFilters(true)}
                />

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
              <>
                <SearchToolbar
                  value={tournamentQuery}
                  onChangeText={setTournamentQuery}
                  placeholder="Search tournaments, clubs, or prizes"
                  filterLabel="tournament"
                  onOpenFilters={() => setShowTournamentFilters(true)}
                />

                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Upcoming tournaments</Text>
                  <Text style={styles.muted}>{visibleTournaments.length} found</Text>
                </View>
                {visibleTournaments.length ? Array.from(new Set(visibleTournaments.map((item) => item.tournament.clubId))).map((clubId) => {
                  const listings = visibleTournaments.filter((item) => item.tournament.clubId === clubId);
                  const club = listings[0]?.club;
                  return (
                    <View style={styles.tournamentClubSection} key={clubId}>
                      <Pressable
                        disabled={!club}
                        style={styles.tournamentClubHeader}
                        onPress={() => {
                          if (!club) return;
                          setSelectedClubId(club.club.id);
                          setScreen('clubs');
                        }}
                      >
                        <View>
                          <Text style={styles.cardTitle}>{club?.club.name ?? 'Tournament host'}</Text>
                          <Text style={styles.muted}>{club ? `${listings[0].distanceMiles.toFixed(1)} mi · ${club.club.address ?? 'Address unavailable'}` : 'Club details unavailable'}</Text>
                        </View>
                        {club ? <Ionicons name="chevron-forward" size={19} color={colors.muted} /> : null}
                      </Pressable>
                      {listings.map(({ tournament, registration }) => (
                        <TournamentCard
                          key={tournament.id}
                          tournament={tournament}
                          registration={registration}
                          hasOrbitAccount={Boolean(firebaseIdentity && firebaseIdentity.uid === player.id)}
                          message={tournamentMessage}
                          onRegister={() => registerTournament(tournament)}
                          onUnregister={() => registration && unregisterTournament(tournament, registration)}
                        />
                      ))}
                    </View>
                  );
                }) : (
                  <View style={styles.emptyState}>
                    <Text style={styles.cardTitle}>No tournaments found</Text>
                    <Text style={styles.muted}>Try a different club, distance, or registration filter.</Text>
                  </View>
                )}
              </>
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
              <>
                {memberClubs.length ? memberClubs
                  .slice()
                  .sort((left, right) => getClubDistance(left, playerHomeCoordinate) - getClubDistance(right, playerHomeCoordinate))
                  .map((club) => {
                    const isSelected = club.club.id === selectedClub.club.id;
                    const membership = club.memberships.find((item) => isPlayerMembership(item, player));
                    const openSeats = club.games.reduce((sum, game) => sum + game.availableSeats, 0);
                    const familiarText = club.social?.knownPlayersInHouse ? ` - ${club.social.knownPlayersInHouse} familiar players` : '';
                    return (
                      <Pressable
                        key={club.club.id}
                        onPress={() => {
                          setSelectedClubId(club.club.id);
                        }}
                        style={[styles.clubCard, isSelected && styles.selectedCard]}
                      >
                        <View style={[styles.clubAvatar, isSelected && styles.clubAvatarActive]}>
                          <Text style={[styles.clubAvatarText, isSelected && styles.clubAvatarTextActive]}>{club.club.name.slice(0, 1)}</Text>
                        </View>
                        <View style={styles.clubMain}>
                          <Text style={styles.cardTitle}>{club.club.name}</Text>
                          <Text style={styles.muted}>
                            {getClubDistance(club, playerHomeCoordinate).toFixed(1)} mi - {openSeats} seats{familiarText}
                          </Text>
                        </View>
                        <View style={styles.statusPill}>
                          <Text style={styles.statusText}>{membership?.status ?? 'Join'}</Text>
                        </View>
                      </Pressable>
                    );
                  }) : (
                    <View style={styles.emptyState}>
                      <Text style={styles.cardTitle}>No club memberships yet</Text>
                      <Text style={styles.muted}>Join a card house from Find Games and your memberships will show here.</Text>
                    </View>
                  )}

                {selectedMembership ? (
                  <>
                    {selectedMembership.status === 'Requested' ? (
                      <MembershipApplicationStatusCard club={selectedClub} membership={selectedMembership} />
                    ) : (
                      <MembershipWalletCard
                        club={selectedClub}
                        membership={selectedMembership}
                        nowMs={clockNow}
                        player={player}
                      />
                    )}
                    {isMembershipCurrentlyActive(selectedMembership, clockNow) ? <View style={styles.gameAlertCard}>
                      <View style={styles.gameAlertIcon}>
                        <Ionicons name="notifications" size={19} color={colors.primary} />
                      </View>
                      <View style={styles.gameAlertCopy}>
                        <Text style={styles.cardTitle}>Game updates</Text>
                        <Text style={styles.muted}>Watching {player.preferredStakes || 'your usual stakes'} at {selectedClub.club.name}</Text>
                      </View>
                      <View style={styles.alertOnPill}>
                        <View style={styles.alertOnDot} />
                        <Text style={styles.alertOnText}>LIVE</Text>
                      </View>
                    </View> : null}
                    {clubMembershipMessage ? <Text style={styles.privateGameStatus}>{clubMembershipMessage}</Text> : null}
                    <ClubHubSections
                      club={selectedClub}
                      membership={selectedMembership}
                      games={selectedClub.games}
                      waitlists={playerWaitlists}
                      tournaments={selectedClubTournaments}
                      nowMs={clockNow}
                      onGame={(game) => joinWaitlist(selectedClub, game)}
                      onManageAccess={() => openClubSignup(selectedClub)}
                      onViewEvents={() => {
                        setTournamentClubFilter(selectedClub.club.id);
                        setScreen('tournaments');
                      }}
                    />
                  </>
                ) : null}
              </>
            ) : null}

            {screen === 'clubSignup' && selectedClub ? (
              <ClubMembershipPlanScreen
                club={selectedClub}
                prices={getClubMembershipPrices(selectedClub)}
                message={clubMembershipMessage}
                player={player}
                onBack={() => setScreen('clubs')}
                onPlayerChange={(patch) => setPlayer((current) => ({ ...current, ...patch }))}
                onSelectProduct={(product) => openClubPayment(selectedClub, product)}
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
                  <Text style={styles.sectionTitle}>Profile</Text>
                  <Text style={styles.muted}>{player.email}</Text>
                </View>
                {Platform.OS === 'web' ? <View style={styles.googleAuthPanel}>
                  <View style={styles.googleAuthIcon}>
                    <Ionicons name={firebaseIdentity ? 'checkmark-circle-outline' : 'logo-google'} size={20} color={firebaseIdentity ? colors.teal : colors.primaryDark} />
                  </View>
                  <View style={styles.googleAuthBody}>
                    <Text style={styles.cardTitle}>{firebaseIdentity ? 'Google Connected' : 'Connect Google'}</Text>
                    <Text style={styles.muted}>{firebaseIdentity ? firebaseIdentity.email || firebaseIdentity.name : authStatus}</Text>
                  </View>
                  {!firebaseIdentity ? (
                    <Pressable style={styles.compactButton} onPress={connectGoogleAccount}>
                      <Text style={styles.compactButtonText}>Sign in</Text>
                    </Pressable>
                  ) : null}
                </View> : null}
                {!firebaseIdentity ? (
                  <View style={styles.emailAuthPanel}>
                    <View>
                      <Text style={styles.cardTitle}>Orbit email sign-in</Text>
                      <Text style={styles.muted}>Sign in to an existing player account, or create one with a new email.</Text>
                    </View>
                    <View style={styles.searchInputRow}>
                      <Ionicons name="mail-outline" size={18} color={colors.muted} />
                      <TextInput
                        value={playerAuthEmail}
                        onChangeText={setPlayerAuthEmail}
                        autoCapitalize="none"
                        keyboardType="email-address"
                        placeholder="Player email"
                        placeholderTextColor={colors.muted}
                        style={styles.searchInput}
                      />
                    </View>
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
                    <Pressable style={styles.compactButton} onPress={connectEmailAccount}>
                      <Text style={styles.compactButtonText}>Sign in or create account</Text>
                    </Pressable>
                  </View>
                ) : null}
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
                        <Text style={styles.muted}>{hasPlayerPremium ? 'Grinder recommendations and hosting are unlocked.' : 'Unlock grinder/table recommendations and player-hosted games.'}</Text>
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
                <Field label="Email" value={player.email} onChangeText={(email) => setPlayer((current) => ({ ...current, email }))} />
                <Field
                  label="Home Area"
                  value={player.homeLocation ?? ''}
                  onChangeText={(homeLocation) => setPlayer((current) => ({ ...current, homeLocation }))}
                />
                <Text style={styles.fieldLabel}>Preferred Games</Text>
                <View style={styles.chipRow}>
                  {gamePreferenceOptions.map((game) => (
                    <Chip
                      key={game.id}
                      label={game.label}
                      active={player.preferredGameIds.includes(game.id)}
                      onPress={() => togglePlayerGame(game.id, setPlayer)}
                    />
                  ))}
                </View>
                <Field
                  label="Preferred Stakes"
                  value={player.preferredStakes ?? ''}
                  onChangeText={(preferredStakes) => setPlayer((current) => ({ ...current, preferredStakes }))}
                />
                <View style={styles.simpleMenu}>
                  <SimpleMenuRow icon="call-outline" title="Contact support" subtitle={supportPhone} onPress={() => Linking.openURL(supportPhoneUrl)} />
                  {privacyPolicyUrl ? (
                    <SimpleMenuRow icon="shield-checkmark-outline" title="Privacy policy" subtitle="How Orbit handles your data" onPress={() => Linking.openURL(privacyPolicyUrl)} />
                  ) : null}
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
                  <Ionicons name={tab.icon} size={19} color={screen === tab.id ? colors.ink : '#6b7280'} />
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
            ? 'You can request seats, join card houses, check in, and purchase card-house access.'
            : underage
              ? `Orbit player access features are limited to verified players age ${status.minimumAge} or older.`
              : 'Stripe securely checks a government-issued ID. Orbit receives only the verification result and age eligibility.'}
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

function TournamentCard({
  tournament,
  registration,
  hasOrbitAccount,
  message,
  onRegister,
  onUnregister
}: {
  tournament: PlayerTournament;
  registration?: PlayerTournamentRegistration;
  hasOrbitAccount: boolean;
  message: string;
  onRegister: () => void;
  onUnregister: () => void;
}) {
  const registrationOpen = tournament.registrationStatus === 'open' && Date.now() < Date.parse(tournament.registrationClosesAt);
  const canUnregister = Boolean(registration && tournament.unregisterAllowed && Date.now() < Date.parse(tournament.startsAt));
  const liveEntrants = Math.max(tournament.entrantCount, registration ? 1 : 0);
  return (
    <View style={[styles.tournamentCard, tournament.featured && styles.tournamentCardFeatured]}>
      <View style={styles.tournamentTitleRow}>
        <View style={styles.tournamentIcon}><Ionicons name="trophy-outline" size={22} color={colors.primary} /></View>
        <View style={styles.clubMain}>
          <Text style={styles.cardTitle}>{tournament.name}</Text>
          <Text style={styles.muted}>{formatEventDate(tournament.startsAt)}</Text>
        </View>
        <View style={[styles.statusPill, registrationOpen ? styles.tournamentOpenPill : styles.tournamentClosedPill]}>
          <Text style={styles.statusText}>{registrationOpen ? 'Open' : 'Closed'}</Text>
        </View>
      </View>
      <Text style={styles.tournamentPrize}>{tournament.buyIn === 0 ? 'FREE ENTRY · FREEROLL' : `$${tournament.buyIn} ENTRY`}</Text>
      <View style={styles.tournamentMoneyGrid}>
        <View style={styles.tournamentMoneyItem}>
          <Text style={styles.tournamentStatLabel}>Buy-in</Text>
          <Text style={styles.tournamentMoneyValue}>{tournament.buyIn === 0 ? 'Free' : `$${tournament.buyIn.toLocaleString()}`}</Text>
        </View>
        <View style={styles.tournamentMoneyItem}>
          <Text style={styles.tournamentStatLabel}>Rebuys</Text>
          <Text style={styles.tournamentMoneyValue}>{tournament.unlimitedRebuys ? `Unlimited · $${tournament.rebuyPrice}` : 'Not allowed'}</Text>
        </View>
        <View style={[styles.tournamentMoneyItem, styles.tournamentMoneyItemWide]}>
          <Text style={styles.tournamentStatLabel}>Prize pool</Text>
          <Text style={styles.tournamentMoneyValue}>{tournament.prizePoolLabel}</Text>
        </View>
      </View>
      <View style={styles.tournamentStats}>
        <View><Text style={styles.tournamentStatValue}>{tournament.startingStack.toLocaleString()}</Text><Text style={styles.tournamentStatLabel}>Starting chips</Text></View>
        <View><Text style={styles.tournamentStatValue}>{tournament.levelMinutes} min</Text><Text style={styles.tournamentStatLabel}>Blind levels</Text></View>
        <View><Text style={styles.tournamentStatValue}>{liveEntrants}</Text><Text style={styles.tournamentStatLabel}>Entrants</Text></View>
      </View>
      <View style={styles.tournamentStructure}>
        <Text style={styles.cardTitle}>Structure</Text>
        <Text style={styles.muted}>Unlimited ${tournament.rebuyPrice} rebuys through Level {tournament.lateRegistrationThroughLevel} · {tournament.rebuyStack.toLocaleString()} chips each</Text>
        <Text style={styles.muted}>${tournament.addOnPrice} add-on after late registration · {tournament.addOnStack.toLocaleString()} chips</Text>
        <Text style={styles.muted}>Live: {tournament.totalRebuys} rebuys · {tournament.totalAddOns} add-ons</Text>
      </View>
      <View style={styles.tournamentRules}>
        <Text style={styles.cardTitle}>Rules</Text>
        {tournament.rules.map((rule) => <Text key={rule} style={styles.tournamentRule}>• {rule}</Text>)}
      </View>
      {registration ? (
        <View style={styles.tournamentConfirmation}>
          <Ionicons name="checkmark-circle" size={20} color={colors.teal} />
          <View style={styles.clubMain}><Text style={styles.cardTitle}>Registration confirmed</Text><Text style={styles.muted}>Status: {registration.status.replace(/-/g, ' ')}</Text></View>
        </View>
      ) : null}
      {!hasOrbitAccount ? <Text style={styles.tournamentMessage}>Sign in with Google under Settings to register with your Orbit Player account.</Text> : null}
      {message ? <Text style={styles.tournamentMessage}>{message}</Text> : null}
      {registration ? (
        canUnregister ? <Pressable style={styles.secondaryActionButton} onPress={onUnregister}><Text style={styles.secondaryActionText}>Unregister</Text></Pressable> : null
      ) : (
        <Pressable disabled={!registrationOpen || !hasOrbitAccount} style={[styles.compactButton, (!registrationOpen || !hasOrbitAccount) && styles.disabledAction]} onPress={onRegister}>
          <Text style={styles.compactButtonText}>{registrationOpen ? 'Register free' : 'Registration closed'}</Text>
        </Pressable>
      )}
    </View>
  );
}

function formatEventDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function InAppNotificationBanner({
  notification,
  onDismiss
}: {
  notification: PlayerInAppNotification;
  onDismiss: () => void;
}) {
  return (
    <View style={styles.inAppBanner}>
      <View style={styles.inAppBannerIcon}>
        <Ionicons name="notifications-outline" size={18} color={colors.primary} />
      </View>
      <View style={styles.inAppBannerCopy}>
        <Text style={styles.inAppBannerTitle}>{notification.title}</Text>
        <Text style={styles.inAppBannerBody}>{notification.body}</Text>
      </View>
      <Pressable style={styles.inAppBannerDismiss} onPress={onDismiss}>
        <Ionicons name="close-outline" size={18} color={colors.muted} />
      </Pressable>
    </View>
  );
}

function OnboardingFlow({
  draftPlayer,
  onboardingStep,
  setDraftPlayer,
  setOnboardingStep,
  onComplete
}: {
  draftPlayer: PlayerAccount;
  onboardingStep: OnboardingStep;
  setDraftPlayer: React.Dispatch<React.SetStateAction<PlayerAccount>>;
  setOnboardingStep: React.Dispatch<React.SetStateAction<OnboardingStep>>;
  onComplete: () => void;
}) {
  const stepOpacity = useRef(new Animated.Value(1)).current;
  const [hoveredAction, setHoveredAction] = useState<'previous' | null>(null);
  const finalStep = 3;
  const totalSteps = finalStep + 1;
  const phoneTrimmed = (draftPlayer.phone ?? '').trim();
  const emailIsValid = isValidEmail(draftPlayer.email);
  const phoneIsValid = !phoneTrimmed || isValidPhoneNumber(phoneTrimmed);
  const canComplete = Boolean(draftPlayer.name.trim() && emailIsValid && phoneIsValid);
  const canContinue =
    onboardingStep === 0 ? Boolean(draftPlayer.name.trim()) :
    onboardingStep === 1 ? emailIsValid :
    onboardingStep === 2 ? phoneIsValid :
    true;
  const moveToStep = (step: OnboardingStep) => {
    Animated.timing(stepOpacity, {
      toValue: 0,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false
    }).start(() => {
      setOnboardingStep(step);
      stepOpacity.setValue(0);
      Animated.timing(stepOpacity, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false
      }).start();
    });
  };
  const nextStep = () => moveToStep(Math.min(finalStep, onboardingStep + 1) as OnboardingStep);
  const previousStep = () => moveToStep(Math.max(0, onboardingStep - 1) as OnboardingStep);
  const finishOnboarding = () => {
    Animated.timing(stepOpacity, {
      toValue: 0,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false
    }).start(onComplete);
  };
  const submitStep = onboardingStep < finalStep ? nextStep : finishOnboarding;
  const canSubmit = onboardingStep < finalStep ? canContinue : canComplete;

  useEffect(() => {
    if (
      Platform.OS !== 'web' ||
      typeof window === 'undefined' ||
      typeof window.addEventListener !== 'function' ||
      typeof window.removeEventListener !== 'function'
    ) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isTypingTarget = tagName === 'input' || tagName === 'textarea' || target?.isContentEditable;
      if (event.key !== 'Enter' || isTypingTarget || !canSubmit) return;
      event.preventDefault();
      submitStep();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canSubmit, submitStep]);

  return (
    <View style={styles.onboardingFlow}>
      <View style={styles.onboardingTopBar}>
        <View>
          <Text style={styles.onboardingBrand}>ORBIT</Text>
          <Text style={styles.onboardingBrandSubtle}>PLAYER</Text>
        </View>
        <OnboardingProgress activeStep={onboardingStep} totalSteps={totalSteps} />
      </View>

      <Text style={styles.onboardingTitle}>Find Your Game</Text>

      <AnimatedStepCard stepKey={onboardingStep} opacity={stepOpacity}>
        {onboardingStep === 0 ? <NameStep draftPlayer={draftPlayer} setDraftPlayer={setDraftPlayer} onSubmit={canSubmit ? submitStep : undefined} /> : null}
        {onboardingStep === 1 ? <EmailStep draftPlayer={draftPlayer} setDraftPlayer={setDraftPlayer} onSubmit={canSubmit ? submitStep : undefined} /> : null}
        {onboardingStep === 2 ? <PhoneStep draftPlayer={draftPlayer} setDraftPlayer={setDraftPlayer} onSubmit={submitStep} /> : null}
        {onboardingStep === 3 ? <HomeAreaStep draftPlayer={draftPlayer} setDraftPlayer={setDraftPlayer} onSubmit={canSubmit ? submitStep : undefined} /> : null}
      </AnimatedStepCard>

      <View style={styles.onboardingActions}>
        <Pressable
          onHoverIn={() => setHoveredAction('previous')}
          onHoverOut={() => setHoveredAction(null)}
          onPress={onboardingStep > 0 ? previousStep : undefined}
          disabled={onboardingStep === 0}
          style={styles.arrowAction}
        >
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
          {hoveredAction === 'previous' && onboardingStep > 0 ? (
            <View pointerEvents="none" style={styles.iconTooltip}>
              <Text style={styles.iconTooltipText}>Previous step</Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable
          disabled={!canSubmit}
          onPress={submitStep}
          style={[styles.onboardingNextAction, !canSubmit && styles.arrowActionDisabled]}
        >
          <Text style={styles.onboardingNextActionText}>{onboardingStep < finalStep ? 'Continue' : 'Start exploring'}</Text>
          <Ionicons name="arrow-forward" size={18} color="#ffffff" />
        </Pressable>
      </View>
    </View>
  );
}

function AnimatedGradientBackground() {
  const drift = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(drift, {
        toValue: 1,
        duration: 9000,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: false
      })
    ).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: 4200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: 4200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false
        })
      ])
    ).start();
  }, [breathe, drift]);

  return (
    <View style={styles.animatedGradientRoot}>
      <LinearGradient colors={['#0B1020', '#1E3A8A', '#4D7CFE', '#F9FAFB']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.appBackdrop} />
      <View style={styles.orbitPattern} pointerEvents="none">
        <View style={styles.orbitHalo}>
          <View style={styles.orbitRing} />
          <View style={[styles.orbitNode, styles.orbitNodeOne]} />
          <View style={[styles.orbitNode, styles.orbitNodeTwo]} />
          <View style={[styles.orbitNode, styles.orbitNodeThree]} />
          <View style={[styles.orbitNode, styles.orbitNodeFour]} />
        </View>
      </View>
      <Animated.View
        style={[
          styles.gradientDriftLayer,
          {
            opacity: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.82] }),
            transform: [
              {
                translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [-130, 130] })
              },
              {
                translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [90, -90] })
              },
              {
                scale: breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] })
              }
            ]
          }
        ]}
      >
        <LinearGradient colors={['rgba(249,250,251,0)', 'rgba(249,250,251,0.46)', 'rgba(139,92,246,0.34)']} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={styles.appBackdrop} />
      </Animated.View>
      <View style={styles.gradientShade} />
    </View>
  );
}

function OnboardingProgress({ activeStep, totalSteps }: { activeStep: number; totalSteps: number }) {
  const progress = `${Math.round(((activeStep + 1) / totalSteps) * 100)}%` as DimensionValue;
  return (
    <View style={styles.onboardingProgressShell}>
      <View style={styles.onboardingProgressTrack}>
        <View style={[styles.onboardingProgressFill, { width: progress }]} />
      </View>
    </View>
  );
}

function AnimatedStepCard({ stepKey, children, opacity }: { stepKey: number; children: React.ReactNode; opacity?: Animated.Value }) {
  const fade = useRef(new Animated.Value(1)).current;
  const visibleOpacity = opacity ?? fade;

  useEffect(() => {
    if (opacity) return;
    fade.setValue(0);
    Animated.spring(fade, {
      toValue: 1,
      friction: 8,
      tension: 80,
      useNativeDriver: false
    }).start();
  }, [fade, opacity, stepKey]);

  return (
    <Animated.View
      style={[
        styles.onboardingStepSurface,
        {
          opacity: visibleOpacity,
          transform: [
            {
              translateY: visibleOpacity.interpolate({
                inputRange: [0, 1],
                outputRange: [14, 0]
              })
            }
          ]
        }
      ]}
    >
      {children}
    </Animated.View>
  );
}

function NameStep({
  draftPlayer,
  setDraftPlayer,
  onSubmit
}: {
  draftPlayer: PlayerAccount;
  setDraftPlayer: React.Dispatch<React.SetStateAction<PlayerAccount>>;
  onSubmit?: () => void;
}) {
  return (
    <Field label="Name" placeholder="Your name" tone="light" value={draftPlayer.name} onChangeText={(name) => setDraftPlayer((current) => ({ ...current, name }))} onSubmit={onSubmit} />
  );
}

function EmailStep({
  draftPlayer,
  setDraftPlayer,
  onSubmit
}: {
  draftPlayer: PlayerAccount;
  setDraftPlayer: React.Dispatch<React.SetStateAction<PlayerAccount>>;
  onSubmit?: () => void;
}) {
  return (
    <Field
      label="Email"
      placeholder="you@example.com"
      tone="light"
      value={draftPlayer.email}
      keyboardType="email-address"
      onChangeText={(email) => setDraftPlayer((current) => ({ ...current, email }))}
      onSubmit={onSubmit}
      error={draftPlayer.email.trim() && !isValidEmail(draftPlayer.email) ? 'Enter a valid email like name@example.com.' : ''}
    />
  );
}

function PhoneStep({
  draftPlayer,
  setDraftPlayer,
  onSubmit
}: {
  draftPlayer: PlayerAccount;
  setDraftPlayer: React.Dispatch<React.SetStateAction<PlayerAccount>>;
  onSubmit?: () => void;
}) {
  return (
    <View style={styles.optionalStep}>
      <Field
        label="Phone Number"
        placeholder="(555) 555-0123"
        tone="light"
        value={draftPlayer.phone ?? ''}
        keyboardType="phone-pad"
        onChangeText={(phone) => setDraftPlayer((current) => ({ ...current, phone }))}
        onSubmit={onSubmit}
        error={(draftPlayer.phone ?? '').trim() && !isValidPhoneNumber(draftPlayer.phone ?? '') ? 'Enter a valid 10-digit phone number, or leave it blank.' : ''}
      />
      <Text style={styles.optionalStepText}>Optional. Used for text updates about games and waitlists you sign up for.</Text>
    </View>
  );
}

function HomeAreaStep({
  draftPlayer,
  setDraftPlayer,
  onSubmit
}: {
  draftPlayer: PlayerAccount;
  setDraftPlayer: React.Dispatch<React.SetStateAction<PlayerAccount>>;
  onSubmit?: () => void;
}) {
  return (
    <Field
      label="Home Area"
      placeholder="City or neighborhood"
      tone="light"
      value={draftPlayer.homeLocation ?? ''}
      onChangeText={(homeLocation) => setDraftPlayer((current) => ({ ...current, homeLocation }))}
      onSubmit={onSubmit}
    />
  );
}

function LocationStep({
  draftPlayer,
  setDraftPlayer
}: {
  draftPlayer: PlayerAccount;
  setDraftPlayer: React.Dispatch<React.SetStateAction<PlayerAccount>>;
}) {
  return (
    <>
      <StepHeader icon="map-outline" title="Home Area" />
      <MapPicker
        locationLabel={draftPlayer.homeLocation || 'Choose a home area'}
        radiusMiles={draftPlayer.searchRadiusMiles ?? 25}
        onSelectLocation={(homeLocation) => setDraftPlayer((current) => ({ ...current, homeLocation }))}
      />
    </>
  );
}

function RadiusStep({
  draftPlayer,
  setDraftPlayer
}: {
  draftPlayer: PlayerAccount;
  setDraftPlayer: React.Dispatch<React.SetStateAction<PlayerAccount>>;
}) {
  return (
    <>
      <StepHeader icon="navigate-outline" title="Search Radius" />
      <View style={styles.chipRow}>
        {[10, 25, 50].map((radius) => (
          <Chip
            key={radius}
            label={`${radius} mi`}
            active={(draftPlayer.searchRadiusMiles ?? 25) === radius}
            onPress={() => setDraftPlayer((current) => ({ ...current, searchRadiusMiles: radius }))}
          />
        ))}
      </View>
    </>
  );
}

function GameStep({
  draftPlayer,
  setDraftPlayer
}: {
  draftPlayer: PlayerAccount;
  setDraftPlayer: React.Dispatch<React.SetStateAction<PlayerAccount>>;
}) {
  return (
    <>
      <StepHeader icon="heart-outline" title="Preferred Game" />
      <View style={styles.chipRow}>
        {gamePreferenceOptions.map((game) => (
          <Chip
            key={game.id}
            label={game.label}
            active={draftPlayer.preferredGameIds.includes(game.id)}
            onPress={() => toggleDraftGame(game.id, setDraftPlayer)}
          />
        ))}
      </View>
    </>
  );
}

function StakesStep({
  draftPlayer,
  setDraftPlayer
}: {
  draftPlayer: PlayerAccount;
  setDraftPlayer: React.Dispatch<React.SetStateAction<PlayerAccount>>;
}) {
  return (
    <>
      <StepHeader icon="cash-outline" title="Preferred Stakes" />
      <Field
        label="Preferred Stakes"
        value={draftPlayer.preferredStakes ?? ''}
        onChangeText={(preferredStakes) => setDraftPlayer((current) => ({ ...current, preferredStakes }))}
      />
    </>
  );
}

function StepHeader({ icon, title }: { icon: keyof typeof Ionicons.glyphMap; title: string }) {
  return (
    <View style={styles.stepHeader}>
      <View style={styles.stepHeaderIcon}>
        <Ionicons name={icon} size={20} color={colors.primaryDark} />
      </View>
      <View style={styles.stepHeaderText}>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
    </View>
  );
}

function MapPicker({
  locationLabel,
  radiusMiles,
  onSelectLocation
}: {
  locationLabel: string;
  radiusMiles: number;
  onSelectLocation: (location: string) => void;
}) {
  const region = {
    latitude: homeCoordinate.latitude,
    longitude: homeCoordinate.longitude,
    latitudeDelta: radiusMiles >= 50 ? 0.55 : radiusMiles >= 25 ? 0.28 : 0.14,
    longitudeDelta: radiusMiles >= 50 ? 0.55 : radiusMiles >= 25 ? 0.28 : 0.14
  };

  return (
    <View style={styles.mapCard}>
      <View style={styles.mapCanvas}>
        <MapView
          provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
          style={styles.liveMap}
          initialRegion={region}
          onPress={(event) => {
            const { latitude, longitude } = event.nativeEvent.coordinate;
            onSelectLocation(`${latitude.toFixed(3)}, ${longitude.toFixed(3)}`);
          }}
        >
          <Circle
            center={homeCoordinate}
            radius={radiusMiles * 1609.34}
            strokeColor="rgba(56,80,109,0.35)"
            fillColor="rgba(56,80,109,0.08)"
          />
          <Marker coordinate={homeCoordinate} title="Home area" description={locationLabel} pinColor={colors.primary} />
          <Marker coordinate={{ latitude: 30.674, longitude: -96.37 }} title="Bryan, TX" onPress={() => onSelectLocation('Bryan, TX')} pinColor={colors.amber} />
          <Marker coordinate={{ latitude: 30.58, longitude: -96.29 }} title="South College Station" onPress={() => onSelectLocation('South College Station, TX')} pinColor={colors.teal} />
        </MapView>
      </View>
      <View style={styles.mapFooter}>
        <Text style={styles.cardTitle}>{locationLabel}</Text>
        <Text style={styles.muted}>Tap the map, choose a pin, or type your area below.</Text>
      </View>
    </View>
  );
}

function SearchToolbar({
  value,
  onChangeText,
  placeholder,
  filterLabel,
  onOpenFilters
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  filterLabel: string;
  onOpenFilters: () => void;
}) {
  return (
    <View style={styles.searchToolbar}>
      <View style={styles.plainSearchBar}>
        <Ionicons name="search-outline" size={18} color={colors.muted} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          style={styles.searchInput}
        />
      </View>
      <Pressable accessibilityLabel={`Show ${filterLabel} filters`} onPress={onOpenFilters} style={styles.plainFiltersButton}>
        <Ionicons name="options-outline" size={18} color={colors.ink} />
        <Text style={styles.plainFiltersText}>Filters</Text>
      </Pressable>
    </View>
  );
}

function FiltersBottomSheet({
  visible,
  title,
  onClose,
  onReset,
  children
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  onReset: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.filterSheetBackdrop}>
        <Pressable accessibilityLabel={`Dismiss ${title.toLowerCase()}`} onPress={onClose} style={styles.filterSheetDismiss} />
        <View style={styles.filterSheetCard}>
          <View style={styles.filterSheetHandle} />
          <View style={styles.filterSheetHeader}>
            <Pressable accessibilityLabel={`Reset ${title.toLowerCase()}`} onPress={onReset} style={styles.filterSheetHeaderAction}>
              <Text style={styles.filterSheetResetText}>Reset</Text>
            </Pressable>
            <Text style={styles.filterSheetTitle}>{title}</Text>
            <Pressable accessibilityLabel={`Apply ${title.toLowerCase()}`} onPress={onClose} style={[styles.filterSheetHeaderAction, styles.filterSheetDoneAction]}>
              <Text style={styles.filterSheetDoneText}>Done</Text>
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.filterSheetContent}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function MapExploreScreen({
  clubs,
  originCoordinate,
  query,
  setQuery,
  onOpenFilters,
  onDirections,
  onShowGames
}: {
  clubs: PlayerClubSnapshot[];
  originCoordinate: { latitude: number; longitude: number };
  query: string;
  setQuery: (value: string) => void;
  onOpenFilters: () => void;
  onDirections: (club: PlayerClubSnapshot) => void;
  onShowGames: (club: PlayerClubSnapshot) => void;
}) {
  return (
    <>
      <SearchToolbar
        value={query}
        onChangeText={setQuery}
        placeholder="Search card houses, areas, or games"
        filterLabel="map"
        onOpenFilters={onOpenFilters}
      />
      <View style={styles.mapCard}>
        <View style={styles.mapCanvasLarge}>
          <MapView
            provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
            style={styles.liveMap}
            initialRegion={texasMapRegion}
          >
            <Circle
              center={originCoordinate}
              radius={20 * 1609.34}
              strokeColor="rgba(56,80,109,0.26)"
              fillColor="rgba(56,80,109,0.06)"
            />
            {clubs.map((club) => (
              <Marker
                key={club.club.id}
                coordinate={getClubCoordinate(club)}
                title={club.club.name}
                description={club.club.address}
                onPress={() => onShowGames(club)}
                pinColor={club.memberships.length ? colors.teal : colors.primary}
              />
            ))}
          </MapView>
        </View>
        <View style={styles.mapFooter}>
          <Text style={styles.cardTitle}>Explore card houses</Text>
          <Text style={styles.muted}>Drag the map, tap a pin, or search by location and game.</Text>
        </View>
      </View>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Map Results</Text>
        <Text style={styles.muted}>{clubs.length} places</Text>
      </View>
      {clubs.length ? clubs.map((club) => {
        const openSeats = club.games.reduce((sum, game) => sum + game.availableSeats, 0);
        return (
          <View key={club.club.id} style={styles.clubCard}>
            <View style={styles.clubAvatar}>
              <Text style={styles.clubAvatarText}>{club.club.name.slice(0, 1)}</Text>
            </View>
            <View style={styles.clubMain}>
              <Text style={styles.cardTitle}>{club.club.name}</Text>
              <Text style={styles.muted}>{club.club.address ?? 'Address not published'} - {openSeats} open seats</Text>
            </View>
            <View style={styles.iconActionRow}>
              <IconActionButton icon="navigate-outline" label={`Directions to ${club.club.name}`} onPress={() => onDirections(club)} />
              <IconActionButton icon="list-outline" label={`View games at ${club.club.name}`} onPress={() => onShowGames(club)} />
            </View>
          </View>
        );
      }) : (
        <View style={styles.emptyState}>
          <Text style={styles.cardTitle}>No map results</Text>
          <Text style={styles.muted}>Try searching by card house, area, address, or game name.</Text>
        </View>
      )}
    </>
  );
}

function NearbyCheckInPanel({
  clubs,
  checkedInClubIds,
  onCheckIn,
  onDirections
}: {
  clubs: PlayerClubSnapshot[];
  checkedInClubIds: Set<string>;
  onCheckIn: (club: PlayerClubSnapshot) => void;
  onDirections: (club: PlayerClubSnapshot) => void;
}) {
  const nearbyClubs = clubs.slice().sort((left, right) => getClubDistance(left) - getClubDistance(right));
  return (
    <>
      <MapPicker
        locationLabel="Clubs near you"
        radiusMiles={20}
        onSelectLocation={() => undefined}
      />
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Nearest clubs</Text>
        <Text style={styles.muted}>Within 20 mi</Text>
      </View>
      {nearbyClubs.length ? nearbyClubs.map((club) => {
        const checkedIn = checkedInClubIds.has(club.club.id);
        const openSeats = club.games.reduce((sum, game) => sum + game.availableSeats, 0);
        return (
          <AnimatedSurface key={club.club.id} style={[styles.clubCard, checkedIn && styles.selectedCard]}>
            <View style={[styles.clubAvatar, checkedIn && styles.clubAvatarActive]}>
              <Text style={[styles.clubAvatarText, checkedIn && styles.clubAvatarTextActive]}>{club.club.name.slice(0, 1)}</Text>
            </View>
            <View style={styles.clubMain}>
              <Text style={styles.cardTitle}>{club.club.name}</Text>
              <Text style={styles.muted}>{getClubDistance(club).toFixed(1)} mi / {openSeats} seats / {club.social?.activePlayerCount ?? 0} players</Text>
            </View>
            <View style={styles.iconActionRow}>
              <IconActionButton icon="navigate-outline" label={`Directions to ${club.club.name}`} onPress={() => onDirections(club)} />
              <IconActionButton icon={checkedIn ? 'checkmark-circle' : 'enter-outline'} label={`Check in to ${club.club.name}`} onPress={() => onCheckIn(club)} active={checkedIn} />
            </View>
          </AnimatedSurface>
        );
      }) : (
        <View style={styles.emptyState}>
          <Text style={styles.cardTitle}>No clubs nearby</Text>
          <Text style={styles.muted}>Published clubs will appear here when they are within your check-in area.</Text>
        </View>
      )}
    </>
  );
}

function GameFilterPanel({
  clubs,
  gameType,
  setGameType,
  selectedClubId,
  setSelectedClubId,
  selectedCasinoId,
  setSelectedCasinoId,
  stakes,
  setStakes,
  distance,
  setDistance,
  fitScoreEnabled,
  setFitScoreEnabled,
}: {
  clubs: PlayerClubSnapshot[];
  gameType: GameTypeFilter;
  setGameType: (value: GameTypeFilter) => void;
  selectedClubId: string;
  setSelectedClubId: (value: string) => void;
  selectedCasinoId: CasinoFilter;
  setSelectedCasinoId: (value: CasinoFilter) => void;
  stakes: string;
  setStakes: (value: string) => void;
  distance: DistanceFilter;
  setDistance: (value: DistanceFilter) => void;
  fitScoreEnabled: boolean;
  setFitScoreEnabled: (value: boolean) => void;
}) {
  const typeOptions: Array<{ id: GameTypeFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'public', label: 'Public' },
    { id: 'private', label: 'Private' },
    { id: 'card-house', label: 'Card house' },
    { id: 'home-game', label: 'Home game' },
    { id: 'favorites', label: 'Favorites' }
  ];
  const cardHouseClubs = clubs.filter((club) => !isCasinoClub(club));
  const casinoClubs = clubs.filter(isCasinoClub);
  return (
    <View style={styles.filterPanel}>
      <View style={styles.sheetField}>
        <Text style={styles.fieldLabel}>Game type</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipRow}>
          {typeOptions.map((option) => (
            <Chip key={option.id} label={option.label} active={gameType === option.id} onPress={() => setGameType(gameType === option.id ? 'none' : option.id)} />
          ))}
        </ScrollView>
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Card House</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          style={styles.cardHouseScroller}
          contentContainerStyle={styles.filterChipRow}
        >
          <Chip
            label="All houses"
            active={selectedClubId === 'all'}
            onPress={() => setSelectedClubId(selectedClubId === 'all' ? 'none' : 'all')}
          />
          {cardHouseClubs.map((club) => (
            <Chip
              key={club.club.id}
              label={club.club.name}
              active={selectedClubId === club.club.id}
              onPress={() => setSelectedClubId(selectedClubId === club.club.id ? 'none' : club.club.id)}
            />
          ))}
        </ScrollView>
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Casino</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          style={styles.cardHouseScroller}
          contentContainerStyle={styles.filterChipRow}
        >
          <Chip
            label="All casinos"
            active={selectedCasinoId === 'all'}
            onPress={() => setSelectedCasinoId(selectedCasinoId === 'all' ? 'none' : 'all')}
          />
          {casinoClubs.map((club) => (
            <Chip
              key={club.club.id}
              label={club.club.name}
              active={selectedCasinoId === club.club.id}
              onPress={() => setSelectedCasinoId(selectedCasinoId === club.club.id ? 'none' : club.club.id)}
            />
          ))}
        </ScrollView>
      </View>
      <View style={styles.filterGrid}>
        <Field label="Stakes" value={stakes} onChangeText={setStakes} />
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Distance</Text>
          <View style={styles.distanceRow}>
            {([
              { value: 'none' as const, label: 'All' },
              { value: 5 as const, label: '5' },
              { value: 10 as const, label: '10' },
              { value: 20 as const, label: '20' },
              { value: 50 as const, label: '50' }
            ]).map((option) => (
              <Pressable key={option.value} onPress={() => setDistance(option.value)} style={[styles.distanceChip, distance === option.value && styles.distanceChipActive]}>
                <Text style={[styles.distanceChipText, distance === option.value && styles.distanceChipTextActive]}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
      <Pressable
        style={[styles.lockedFilterRow, fitScoreEnabled && styles.lockedFilterRowActive]}
        onPress={() => setFitScoreEnabled(!fitScoreEnabled)}
      >
        <Ionicons name="analytics-outline" size={16} color={fitScoreEnabled ? colors.teal : colors.muted} />
        <Text style={styles.lockedFilterText}>Sort by compatibility</Text>
      </Pressable>
    </View>
  );
}

function TournamentFilterControls({
  clubs,
  eventFilter,
  setEventFilter,
  clubFilter,
  setClubFilter,
  distance,
  setDistance
}: {
  clubs: PlayerClubSnapshot[];
  eventFilter: TournamentFilter;
  setEventFilter: (value: TournamentFilter) => void;
  clubFilter: string;
  setClubFilter: (value: string) => void;
  distance: DistanceFilter;
  setDistance: (value: DistanceFilter) => void;
}) {
  return (
    <View style={styles.filterPanel}>
      <View style={styles.sheetField}>
        <Text style={styles.fieldLabel}>Event type</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipRow}>
          {([
            ['all', 'All events'],
            ['open', 'Registration open'],
            ['free', 'Freerolls'],
            ['registered', 'My entries']
          ] as Array<[TournamentFilter, string]>).map(([id, label]) => (
            <Chip key={id} label={label} active={eventFilter === id} onPress={() => setEventFilter(id)} />
          ))}
        </ScrollView>
      </View>
      <View style={styles.sheetField}>
        <Text style={styles.fieldLabel}>Club</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipRow}>
          <Chip label="All clubs" active={clubFilter === 'all'} onPress={() => setClubFilter('all')} />
          {clubs.map((club) => (
            <Chip
              key={club.club.id}
              label={club.club.name}
              active={clubFilter === club.club.id}
              onPress={() => setClubFilter(club.club.id)}
            />
          ))}
        </ScrollView>
      </View>
      <DistanceFilterControl value={distance} onChange={setDistance} />
    </View>
  );
}

function MapFilterControls({
  venue,
  setVenue,
  distance,
  setDistance
}: {
  venue: MapVenueFilter;
  setVenue: (value: MapVenueFilter) => void;
  distance: DistanceFilter;
  setDistance: (value: DistanceFilter) => void;
}) {
  const options: Array<{ id: MapVenueFilter; label: string }> = [
    { id: 'all', label: 'All places' },
    { id: 'card-house', label: 'Card houses' },
    { id: 'casino', label: 'Casinos' },
    { id: 'club', label: 'Poker clubs' }
  ];
  return (
    <View style={styles.filterPanel}>
      <View style={styles.sheetField}>
        <Text style={styles.fieldLabel}>Venue type</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipRow}>
          {options.map((option) => (
            <Chip key={option.id} label={option.label} active={venue === option.id} onPress={() => setVenue(option.id)} />
          ))}
        </ScrollView>
      </View>
      <DistanceFilterControl value={distance} onChange={setDistance} />
    </View>
  );
}

function DistanceFilterControl({ value, onChange }: { value: DistanceFilter; onChange: (value: DistanceFilter) => void }) {
  return (
    <View style={styles.sheetField}>
      <Text style={styles.fieldLabel}>Distance</Text>
      <View style={styles.distanceRow}>
        {([
          { value: 'none' as const, label: 'All' },
          { value: 5 as const, label: '5 mi' },
          { value: 10 as const, label: '10 mi' },
          { value: 20 as const, label: '20 mi' },
          { value: 50 as const, label: '50 mi' }
        ]).map((option) => (
          <Pressable key={option.value} onPress={() => onChange(option.value)} style={[styles.distanceChip, value === option.value && styles.distanceChipActive]}>
            <Text style={[styles.distanceChipText, value === option.value && styles.distanceChipTextActive]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function IconActionButton({
  icon,
  label,
  onPress,
  active,
  disabled
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress?: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[styles.iconActionButton, active && styles.iconActionButtonActive, disabled && styles.iconActionButtonDisabled]}
    >
      <Ionicons name={icon} size={19} color={active ? '#ffffff' : disabled ? colors.muted : colors.primary} />
      {hovered && !disabled ? (
        <View pointerEvents="none" style={styles.iconTooltip}>
          <Text style={styles.iconTooltipText}>{label}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function PremiumPaywall({
  title,
  body,
  priceLabel,
  message,
  onUpgrade
}: {
  title: string;
  body: string;
  priceLabel: string;
  message?: string;
  onUpgrade: () => void;
}) {
  return (
    <AnimatedSurface style={styles.paywallPanel}>
      <View style={styles.paywallHeader}>
        <View style={styles.paywallIcon}>
          <Ionicons name="diamond-outline" size={21} color={colors.teal} />
        </View>
        <View style={styles.agentCopy}>
          <Text style={styles.agentKicker}>Player Premium</Text>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.muted}>{body}</Text>
        </View>
      </View>
      <View style={styles.priceRow}>
        <Text style={styles.priceText}>{priceLabel}</Text>
        <Text style={styles.muted}>monthly membership</Text>
      </View>
      <AnimatedButton variant="primary" onPress={onUpgrade} style={[styles.primaryButton, styles.fullWidthButton]}>
        <Ionicons name="card-outline" size={18} color="#fff" />
        <Text style={styles.primaryButtonText}>Subscribe with Apple</Text>
      </AnimatedButton>
      <Text style={styles.muted}>
        Payment is charged to your Apple Account. The subscription renews monthly unless canceled at least 24 hours before the current period ends. Manage or cancel it in your Apple subscription settings.
      </Text>
      <View style={styles.contextRow}>
        <Pressable onPress={() => Linking.openURL('https://www.apple.com/legal/internet-services/itunes/dev/stdeula/')}>
          <Text style={styles.inlineBackText}>Terms of Use</Text>
        </Pressable>
        {privacyPolicyUrl ? (
          <Pressable onPress={() => Linking.openURL(privacyPolicyUrl)}>
            <Text style={styles.inlineBackText}>Privacy Policy</Text>
          </Pressable>
        ) : null}
      </View>
      {message ? <Text style={styles.privateGameStatus}>{message}</Text> : null}
    </AnimatedSurface>
  );
}

function HostControlPanel({ playerName, hostedCount }: { playerName: string; hostedCount: number }) {
  return (
    <AnimatedSurface style={styles.agentPanel}>
      <View style={styles.agentHeader}>
        <View style={styles.agentIcon}>
          <Ionicons name="home-outline" size={20} color={colors.teal} />
        </View>
        <View style={styles.agentCopy}>
          <Text style={styles.agentKicker}>Player-hosted games</Text>
          <Text style={styles.cardTitle}>{playerName ? `${playerName}'s host board` : 'Host board'}</Text>
          <Text style={styles.muted}>Create a table, set the seat count, and publish it into the grinder feed.</Text>
        </View>
      </View>
      <View style={styles.contextRow}>
        <View style={styles.contextChip}>
          <Ionicons name="radio-outline" size={13} color={colors.primary} />
          <Text style={styles.contextText}>{hostedCount} live posts</Text>
        </View>
        <View style={styles.contextChip}>
          <Ionicons name="people-outline" size={13} color={colors.primary} />
          <Text style={styles.contextText}>Seats shown to players</Text>
        </View>
      </View>
    </AnimatedSurface>
  );
}

function PrivateGameComposer({
  draft,
  setDraft,
  onPublish
}: {
  draft: PrivateGameDraft;
  setDraft: React.Dispatch<React.SetStateAction<PrivateGameDraft>>;
  onPublish: () => void;
}) {
  const canPublish = Boolean(draft.name.trim() && draft.location.trim());
  return (
    <AnimatedSurface style={styles.privateGameComposer}>
      <Field label="Game" value={draft.name} onChangeText={(name) => setDraft((current) => ({ ...current, name }))} />
      <Field label="Location" value={draft.location} onChangeText={(location) => setDraft((current) => ({ ...current, location }))} />
      <View style={styles.composerGrid}>
        <Field label="When" value={draft.startsAt} onChangeText={(startsAt) => setDraft((current) => ({ ...current, startsAt }))} />
        <Field label="Seats" value={draft.seats} onChangeText={(seats) => setDraft((current) => ({ ...current, seats }))} />
      </View>
      <Field label="Note" value={draft.note} onChangeText={(note) => setDraft((current) => ({ ...current, note }))} />
      <Pressable disabled={!canPublish} onPress={onPublish} style={[styles.publishPrivateGame, !canPublish && styles.publishPrivateGameDisabled]}>
        <Text style={styles.publishPrivateGameText}>List private game</Text>
        <Ionicons name="arrow-forward" size={17} color={canPublish ? '#ffffff' : 'rgba(255,255,255,0.65)'} />
      </Pressable>
    </AnimatedSurface>
  );
}

function PrivateGameCard({ game }: { game: PlayerPrivateGameListing }) {
  return (
    <AnimatedSurface style={[styles.gameCard, styles.privateGameCard]}>
      <View style={styles.gameHeader}>
        <View style={styles.privateGameMarker}>
          <View style={styles.privateGameMarkerInner} />
        </View>
        <View style={styles.gameTitleBlock}>
          <Text style={styles.cardTitle}>{game.name}</Text>
          <Text style={styles.muted}>{game.location} / {game.startsAt || 'Tonight'} / {game.seats || '6'} seats</Text>
        </View>
        <View style={styles.privateBadge}>
          <Text style={styles.privateBadgeText}>Private</Text>
        </View>
      </View>
      <Text style={styles.muted}>{game.note || `Hosted by ${game.hostPlayerName}`}</Text>
    </AnimatedSurface>
  );
}

function DiscoveryDeck({
  opportunities,
  totalCount,
  savedCount,
  onPass,
  onPick,
  onDetails,
  onReset
}: {
  opportunities: GameOpportunity[];
  totalCount: number;
  savedCount: number;
  onPass: (item: GameOpportunity) => void;
  onPick: (item: GameOpportunity) => void;
  onDetails: (item: GameOpportunity) => void;
  onReset: () => void;
}) {
  const swipeX = useRef(new Animated.Value(0)).current;
  const swipeY = useRef(new Animated.Value(0)).current;
  const animating = useRef(false);
  const item = opportunities[0];
  const nextItem = opportunities[1];
  const swipe = (decision: DiscoveryDecision) => {
    if (!item || animating.current) return;
    animating.current = true;
    Animated.parallel([
      Animated.timing(swipeX, {
        toValue: decision === 'saved' ? 560 : -560,
        duration: 210,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false
      }),
      Animated.timing(swipeY, {
        toValue: -18,
        duration: 210,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false
      })
    ]).start(() => {
      swipeX.setValue(0);
      swipeY.setValue(0);
      animating.current = false;
      decision === 'saved' ? onPick(item) : onPass(item);
    });
  };
  const panResponder = useMemo(
    () => PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => Boolean(item && Math.abs(gesture.dx) > 5 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.05),
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, gesture) => {
        swipeX.setValue(gesture.dx);
        swipeY.setValue(gesture.dy * 0.12);
      },
      onPanResponderRelease: (_, gesture) => {
        const projectedX = gesture.dx + gesture.vx * 90;
        if (projectedX > 68) swipe('saved');
        else if (projectedX < -68) swipe('pass');
        else Animated.parallel([
          Animated.spring(swipeX, { toValue: 0, friction: 7, tension: 115, useNativeDriver: false }),
          Animated.spring(swipeY, { toValue: 0, friction: 7, tension: 115, useNativeDriver: false })
        ]).start();
      },
      onPanResponderTerminate: () => Animated.parallel([
        Animated.spring(swipeX, { toValue: 0, useNativeDriver: false }),
        Animated.spring(swipeY, { toValue: 0, useNativeDriver: false })
      ]).start()
    }),
    [item, onPass, onPick]
  );
  const rotation = swipeX.interpolate({ inputRange: [-320, 0, 320], outputRange: ['-7deg', '0deg', '7deg'] });
  const likeOpacity = swipeX.interpolate({ inputRange: [0, 48, 135], outputRange: [0, 0.4, 0.9], extrapolate: 'clamp' });
  const passOpacity = swipeX.interpolate({ inputRange: [-135, -48, 0], outputRange: [0.9, 0.4, 0], extrapolate: 'clamp' });
  const seenCount = Math.max(0, totalCount - opportunities.length);

  if (!item) {
    return (
      <View style={styles.discoveryEmpty}>
        <View style={styles.discoveryEmptyIcon}>
          <Ionicons name="checkmark-done-outline" size={30} color={colors.teal} />
        </View>
        <Text style={styles.discoveryEmptyTitle}>You’ve seen every match</Text>
        <Text style={styles.muted}>{savedCount ? `${savedCount} saved game${savedCount === 1 ? '' : 's'} are waiting below.` : 'Refresh the deck or loosen your filters to see more games.'}</Text>
        <Pressable accessibilityLabel="Refresh discovery deck" onPress={onReset} style={styles.discoveryResetButton}>
          <Ionicons name="refresh-outline" size={17} color="#ffffff" />
          <Text style={styles.discoveryResetText}>Start over</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.discoveryDeckSection}>
      <View style={styles.discoveryProgressRow}>
        <Text style={styles.discoveryProgressText}>{seenCount + 1} of {totalCount}</Text>
        <View style={styles.discoveryProgressTrack}>
          <View style={[styles.discoveryProgressFill, { width: `${Math.max(6, ((seenCount + 1) / Math.max(1, totalCount)) * 100)}%` as DimensionValue }]} />
        </View>
        <Text style={styles.discoverySavedCount}>{savedCount} saved</Text>
      </View>
      <View style={styles.discoveryDeck}>
        {nextItem ? (
          <View pointerEvents="none" style={[styles.discoveryCard, styles.discoveryCardBehind]}>
            <DiscoveryCardContent item={nextItem} compact />
          </View>
        ) : null}
        <Animated.View
          {...panResponder.panHandlers}
          style={[styles.discoveryCard, styles.discoveryCardTop, { transform: [{ translateX: swipeX }, { translateY: swipeY }, { rotate: rotation }] }]}
        >
          <Animated.View pointerEvents="none" style={[styles.swipeFeedback, styles.swipeFeedbackPass, { opacity: passOpacity }]}>
            <Ionicons name="close" size={62} color="#ffffff" />
          </Animated.View>
          <Animated.View pointerEvents="none" style={[styles.swipeFeedback, styles.swipeFeedbackPick, { opacity: likeOpacity }]}>
            <Ionicons name="heart" size={52} color="#ffffff" />
          </Animated.View>
          <DiscoveryCardContent item={item} onDetails={() => onDetails(item)} onPass={() => swipe('pass')} onPick={() => swipe('saved')} />
        </Animated.View>
      </View>
    </View>
  );
}

function DiscoveryCardContent({
  item,
  compact = false,
  onDetails,
  onPass,
  onPick
}: {
  item: GameOpportunity;
  compact?: boolean;
  onDetails?: () => void;
  onPass?: () => void;
  onPick?: () => void;
}) {
  const compatibility = getCompatibilityPercent(item);
  const status = getGameStatusLabel(item.game);
  const venueKind = getVenueKind(item.club);
  const fee = getClubFeeProfile(item.club, item.game);
  return (
    <>
      <LinearGradient colors={['#101827', '#172554', '#4D7CFE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.discoveryCardHero, compact && styles.discoveryCardHeroCompact]}>
        <View style={styles.discoveryCardHeroTop}>
          <View style={styles.venueTypeBadge}>
            <Ionicons name={venueKind === 'Card house' ? 'business-outline' : venueKind === 'Casino' ? 'diamond-outline' : 'people-outline'} size={13} color="#ffffff" />
            <Text style={styles.venueTypeText}>{venueKind}</Text>
          </View>
          <View style={styles.compatibilityBadge}>
            <Text style={styles.compatibilityValue}>{compatibility}%</Text>
            <Text style={styles.compatibilityLabel}>MATCH</Text>
          </View>
        </View>
        <View style={styles.discoveryHeroBottom}>
          <View style={styles.liveStatusRow}>
            <View style={[styles.liveDot, !item.game.availableSeats && styles.liveDotWarm]} />
            <Text style={styles.liveStatusText}>{status}</Text>
          </View>
          <Text style={styles.discoveryGameTitle}>{item.game.name}</Text>
          <Text style={styles.discoveryClubName}>{item.club.club.name}</Text>
          <Text style={styles.discoveryLocation}>{getClubCity(item.club)} · {item.distanceMiles.toFixed(1)} mi away</Text>
        </View>
      </LinearGradient>
      {!compact ? (
        <View style={styles.discoveryCardBody}>
          <View style={styles.simpleFactsRow}>
            <View style={styles.simpleFact}>
              <Ionicons name="people-outline" size={16} color={colors.primary} />
              <Text style={styles.simpleFactText}>{item.game.availableSeats ? `${item.game.availableSeats} seats open` : `${item.game.waitlistCount} waiting`}</Text>
            </View>
            <View style={styles.simpleFact}>
              <Ionicons name={fee.type === 'time' ? 'timer-outline' : 'receipt-outline'} size={16} color={colors.primary} />
              <Text style={styles.simpleFactText}>{fee.type === 'time' ? fee.hourly : formatDropFee(fee.percent)}</Text>
            </View>
          </View>
          <View style={styles.matchReasonBand}>
            <Ionicons name="sparkles" size={16} color={colors.amber} />
            <Text style={styles.matchReasonText}>{getCompatibilitySummary(item)}</Text>
          </View>
          {onDetails ? (
            <View style={styles.cardSelectionRow}>
              <Pressable accessibilityLabel={`Pass on ${item.game.name}`} onPress={onPass} style={[styles.cardCornerAction, styles.cardRejectAction]}>
                <Ionicons name="close" size={29} color="#dc2626" />
              </Pressable>
              <Pressable accessibilityLabel={`See full details for ${item.game.name}`} onPress={onDetails} style={styles.cardDetailsLink}>
                <Text style={styles.cardDetailsLinkText}>Details</Text>
                <Ionicons name="chevron-forward" size={15} color={colors.primary} />
              </Pressable>
              <Pressable accessibilityLabel={`Save ${item.game.name}`} onPress={onPick} style={[styles.cardCornerAction, styles.cardPickAction]}>
                <Ionicons name="heart" size={25} color="#ffffff" />
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}
    </>
  );
}

function SavedGamesStrip({ opportunities, onOpen }: { opportunities: GameOpportunity[]; onOpen: (item: GameOpportunity) => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.savedGamesSection}>
      <Pressable onPress={() => setExpanded((current) => !current)} style={styles.savedGamesHeader}>
        <View>
          <Text style={styles.sectionTitle}>Saved games</Text>
          <Text style={styles.muted}>{opportunities.length} match{opportunities.length === 1 ? '' : 'es'}</Text>
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={19} color={colors.muted} />
      </Pressable>
      {expanded ? opportunities.map((item) => (
        <Pressable key={getOpportunityKey(item)} onPress={() => onOpen(item)} style={styles.savedGameRow}>
          <View style={styles.savedGameScore}>
            <Text style={styles.savedGameScoreValue}>{getCompatibilityPercent(item)}%</Text>
          </View>
          <View style={styles.savedGameCopy}>
            <Text style={styles.cardTitle}>{item.game.name} · {item.club.club.name}</Text>
            <Text style={styles.muted}>{getGameStatusLabel(item.game)} · {item.distanceMiles.toFixed(1)} mi · Alerts after joining</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>
      )) : null}
    </View>
  );
}

function GameDetailsScreen({
  item,
  player,
  onBack,
  onDirections,
  onJoin,
  onViewStore
}: {
  item: GameOpportunity;
  player: PlayerAccount;
  onBack: () => void;
  onDirections: () => void;
  onJoin: () => void;
  onViewStore: () => void;
}) {
  const fee = getClubFeeProfile(item.club, item.game);
  const hasOpenTable = item.game.openTables.length > 0;
  const venueKind = getVenueKind(item.club);
  return (
    <View style={styles.gameDetailsPage}>
      <View style={styles.gameDetailsNav}>
        <Pressable accessibilityLabel="Back to discovery" onPress={onBack} style={styles.gameDetailsBack}>
          <Ionicons name="arrow-back" size={19} color={colors.ink} />
          <Text style={styles.gameDetailsBackText}>Discover</Text>
        </Pressable>
        <View style={styles.gameDetailsLivePill}>
          <View style={[styles.liveDot, !item.game.availableSeats && styles.liveDotWarm]} />
          <Text style={styles.gameDetailsLiveText}>Live</Text>
        </View>
      </View>

      <LinearGradient
        colors={['#101827', '#172554', '#4D7CFE']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gameDetailsHero}
      >
        <View style={styles.gameDetailsHeroTop}>
          <View style={styles.venueTypeBadge}>
            <Ionicons name={venueKind === 'Card house' ? 'business-outline' : venueKind === 'Casino' ? 'diamond-outline' : 'people-outline'} size={13} color="#ffffff" />
            <Text style={styles.venueTypeText}>{venueKind}</Text>
          </View>
          <View style={styles.gameDetailsScore}>
            <Text style={styles.gameDetailsScoreValue}>{getCompatibilityPercent(item)}%</Text>
            <Text style={styles.compatibilityLabel}>MATCH</Text>
          </View>
        </View>
        <View style={styles.gameDetailsHeroCopy}>
          <Text style={styles.gameDetailsStatus}>{getGameStatusLabel(item.game)}</Text>
          <Text style={styles.gameDetailsTitle}>{item.game.name}</Text>
          <Text style={styles.gameDetailsClub}>{item.club.club.name}</Text>
          <Text style={styles.gameDetailsLocation}>{getClubCity(item.club)} · {item.distanceMiles.toFixed(1)} mi away</Text>
        </View>
      </LinearGradient>

      <View style={styles.detailsQuickSummary}>
        <Text style={styles.detailsQuickValue}>{item.game.availableSeats ? `${item.game.availableSeats} seats open` : `${item.game.waitlistCount} waiting`}</Text>
        <Text style={styles.detailsQuickDivider}>|</Text>
        <Text style={styles.detailsQuickValue}>{fee.type === 'time' ? fee.hourly : formatDropFee(fee.percent)}</Text>
        <Text style={styles.detailsQuickDivider}>|</Text>
        <Text style={styles.detailsQuickValue}>{item.game.openTables.length || 0} {hasOpenTable ? 'active tables' : 'planned tables'}</Text>
      </View>

      <View style={styles.gameDetailsSection}>
        <View style={styles.gameDetailsSectionHeading}>
          <View style={styles.gameDetailsSectionIcon}>
            <Ionicons name="sparkles-outline" size={18} color={colors.primary} />
          </View>
          <Text style={styles.gameDetailsSectionTitle}>Why this game</Text>
        </View>
        <Text style={styles.gameDetailsReason}>{getCompatibilitySummary(item)}</Text>
      </View>

      <View style={styles.gameDetailsSection}>
        <View style={styles.gameDetailsSectionHeading}>
          <View style={styles.gameDetailsSectionIcon}>
            <Ionicons name="information-circle-outline" size={19} color={colors.primary} />
          </View>
          <Text style={styles.gameDetailsSectionTitle}>At a glance</Text>
        </View>
        <View style={styles.gameDetailsFacts}>
          <DetailRow icon="people-outline" label="Seats" value={item.game.availableSeats ? `${item.game.availableSeats} open now` : `${item.game.waitlistCount} waiting`} />
          <DetailRow icon="layers-outline" label="Tables" value={`${item.game.openTables.length || 0} ${hasOpenTable ? 'open or forming' : 'planned'}`} />
          <DetailRow icon="receipt-outline" label="Collection" value={fee.type === 'time' ? `${fee.hourly} to card house` : formatDropFee(fee.percent)} />
          <DetailRow icon="location-outline" label="Location" value={item.club.club.address ?? 'Shared after approval'} />
        </View>
      </View>

      <View style={styles.notificationPromise}>
        <View style={styles.notificationPromiseIcon}>
          <Ionicons name="notifications-outline" size={19} color={colors.primary} />
        </View>
        <View style={styles.notificationPromiseCopy}>
          <Text style={styles.cardTitle}>Alerts after you join</Text>
          <Text style={styles.muted}>We’ll notify you when this host posts {player.preferredStakes || 'your usual stakes'}.</Text>
        </View>
      </View>

      {!item.isJoined ? (
        <Pressable onPress={onViewStore} style={styles.storeButton}>
          <Ionicons name="storefront-outline" size={18} color={colors.primary} />
          <View style={styles.storeButtonCopy}>
            <Text style={styles.storeButtonText}>Access options</Text>
            <Text style={styles.muted}>Passes and time sold by {item.club.club.name}</Text>
          </View>
          <Ionicons name="chevron-forward" size={17} color={colors.primary} />
        </Pressable>
      ) : null}

      <View style={styles.detailsActionRow}>
        <Pressable accessibilityLabel={`Directions to ${item.club.club.name}`} onPress={onDirections} style={styles.detailsSecondaryButton}>
          <Ionicons name="navigate-outline" size={18} color={colors.ink} />
          <Text style={styles.detailsSecondaryText}>Directions</Text>
        </Pressable>
        <AnimatedButton variant="primary" onPress={onJoin} style={[styles.primaryButton, styles.detailsPrimaryButton]}>
          <Ionicons name={item.isJoined ? 'person-add-outline' : 'card-outline'} size={18} color="#ffffff" />
          <Text style={styles.primaryButtonText}>{item.isJoined ? (hasOpenTable ? 'Request a seat' : 'Follow this game') : 'See how to join'}</Text>
        </AnimatedButton>
      </View>
    </View>
  );
}

function DiscoveryDetailsModal({
  item,
  player,
  onClose,
  onDirections,
  onJoin,
  onViewStore
}: {
  item: GameOpportunity | null;
  player: PlayerAccount;
  onClose: () => void;
  onDirections: () => void;
  onJoin: () => void;
  onViewStore: () => void;
}) {
  const [expandedSection, setExpandedSection] = useState<'fit' | 'details' | null>(null);
  useEffect(() => setExpandedSection(null), [item ? getOpportunityKey(item) : '']);
  if (!item) return null;
  const fee = getClubFeeProfile(item.club, item.game);
  const hasOpenTable = item.game.openTables.length > 0;
  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.discoveryDetailsSheet}>
          <View style={styles.sheetHandle} />
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.discoveryDetailsContent}>
            <View style={styles.discoveryDetailsHeader}>
              <View style={styles.discoveryDetailsScore}>
                <Text style={styles.discoveryDetailsScoreValue}>{getCompatibilityPercent(item)}%</Text>
                <Text style={styles.compatibilityLabel}>MATCH</Text>
              </View>
              <View style={styles.discoveryDetailsTitleBlock}>
                <Text style={styles.agentKicker}>{getVenueKind(item.club)} · {getGameStatusLabel(item.game)}</Text>
                <Text style={styles.membershipTitle}>{item.game.name}</Text>
                <Text style={styles.muted}>{item.club.club.name} · {getClubCity(item.club)} · {item.distanceMiles.toFixed(1)} mi</Text>
              </View>
              <Pressable accessibilityLabel="Close game details" onPress={onClose} style={styles.modalCloseButton}>
                <Ionicons name="close" size={20} color={colors.ink} />
              </Pressable>
            </View>

            <View style={styles.detailsQuickSummary}>
              <Text style={styles.detailsQuickValue}>{item.game.availableSeats ? `${item.game.availableSeats} seats open` : `${item.game.waitlistCount} waiting`}</Text>
              <Text style={styles.detailsQuickDivider}>|</Text>
              <Text style={styles.detailsQuickValue}>{fee.type === 'time' ? fee.hourly : formatDropFee(fee.percent)}</Text>
              <Text style={styles.detailsQuickDivider}>|</Text>
              <Text style={styles.detailsQuickValue}>{item.distanceMiles.toFixed(1)} mi</Text>
            </View>

            <View style={styles.detailsDisclosureGroup}>
              <Pressable onPress={() => setExpandedSection((current) => current === 'fit' ? null : 'fit')} style={styles.detailsDisclosureRow}>
                <View style={styles.detailsDisclosureLabel}>
                  <Ionicons name="sparkles-outline" size={18} color={colors.primary} />
                  <Text style={styles.cardTitle}>Why it fits</Text>
                </View>
                <Ionicons name={expandedSection === 'fit' ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
              </Pressable>
              {expandedSection === 'fit' ? (
                <View style={styles.fitBreakdown}>
                  <FitBreakdownRow label="Preferences" value={item.isPreferred ? 96 : 78} />
                  <FitBreakdownRow label="Availability" value={Math.min(98, 62 + item.game.availableSeats * 6)} />
                  <FitBreakdownRow label="Social" value={Math.min(96, 64 + item.game.knownPlayersCount * 8)} />
                  <FitBreakdownRow label="Distance" value={Math.max(28, Math.round(98 - item.distanceMiles * 1.4))} />
                </View>
              ) : null}
              <Pressable onPress={() => setExpandedSection((current) => current === 'details' ? null : 'details')} style={styles.detailsDisclosureRow}>
                <View style={styles.detailsDisclosureLabel}>
                  <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
                  <Text style={styles.cardTitle}>Game details</Text>
                </View>
                <Ionicons name={expandedSection === 'details' ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
              </Pressable>
              {expandedSection === 'details' ? (
                <View style={styles.detailsInfoCard}>
                  <DetailRow icon="people-outline" label="Seats" value={item.game.availableSeats ? `${item.game.availableSeats} open now` : `${item.game.waitlistCount} waiting`} />
                  <DetailRow icon="layers-outline" label="Tables" value={`${item.game.openTables.length || 0} ${hasOpenTable ? 'open or forming' : 'planned'}`} />
                  <DetailRow icon="receipt-outline" label="Collection" value={fee.type === 'time' ? `${fee.hourly} to card house` : formatDropFee(fee.percent)} />
                  <DetailRow icon="location-outline" label="Location" value={item.club.club.address ?? 'Shared after approval'} />
                </View>
              ) : null}
            </View>

            <View style={styles.notificationPromise}>
              <View style={styles.notificationPromiseIcon}>
                <Ionicons name="notifications-outline" size={19} color={colors.primary} />
              </View>
              <View style={styles.notificationPromiseCopy}>
                <Text style={styles.cardTitle}>Alerts after you join</Text>
                <Text style={styles.muted}>We’ll notify you when this host posts {player.preferredStakes || 'your usual stakes'}.</Text>
              </View>
            </View>

            {!item.isJoined ? (
              <Pressable onPress={onViewStore} style={styles.storeButton}>
                <Ionicons name="storefront-outline" size={18} color={colors.primary} />
                <View style={styles.storeButtonCopy}>
                  <Text style={styles.storeButtonText}>Access options</Text>
                  <Text style={styles.muted}>Passes and time sold by {item.club.club.name}</Text>
                </View>
                <Ionicons name="chevron-forward" size={17} color={colors.primary} />
              </Pressable>
            ) : null}

            <View style={styles.detailsActionRow}>
              <Pressable accessibilityLabel={`Directions to ${item.club.club.name}`} onPress={onDirections} style={styles.detailsSecondaryButton}>
                <Ionicons name="navigate-outline" size={18} color={colors.ink} />
                <Text style={styles.detailsSecondaryText}>Directions</Text>
              </Pressable>
              <AnimatedButton variant="primary" onPress={onJoin} style={[styles.primaryButton, styles.detailsPrimaryButton]}>
                <Ionicons name={item.isJoined ? 'person-add-outline' : 'card-outline'} size={18} color="#ffffff" />
                <Text style={styles.primaryButtonText}>{item.isJoined ? (hasOpenTable ? 'Request a seat' : 'Follow this game') : 'See how to join'}</Text>
              </AnimatedButton>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function FitBreakdownRow({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.fitBreakdownRow}>
      <View style={styles.fitBreakdownLabelRow}>
        <Text style={styles.fitBreakdownLabel}>{label}</Text>
        <Text style={styles.fitBreakdownValue}>{value}%</Text>
      </View>
      <View style={styles.fitBreakdownTrack}>
        <View style={[styles.fitBreakdownFill, { width: `${value}%` as DimensionValue }]} />
      </View>
    </View>
  );
}

function DetailRow({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <View style={styles.detailRowLabel}>
        <Ionicons name={icon} size={16} color={colors.primary} />
        <Text style={styles.muted}>{label}</Text>
      </View>
      <Text style={styles.detailRowValue}>{value}</Text>
    </View>
  );
}

function OpportunitySectionList({
  opportunities,
  premium,
  player,
  favoriteClubIds,
  onSelectClub,
  onDirections,
  onWaitlist,
  onCancelWaitlist,
  onJoinClub,
  onToggleFavorite
}: {
  opportunities: GameOpportunity[];
  premium: boolean;
  player: PlayerAccount;
  favoriteClubIds: string[];
  onSelectClub: (item: GameOpportunity) => void;
  onDirections: (club: PlayerClubSnapshot) => void;
  onWaitlist: (club: PlayerClubSnapshot, game: PlayerSyncGame) => void;
  onCancelWaitlist: (club: PlayerClubSnapshot, game: PlayerSyncGame, entry: PlayerWaitlistEntry) => void;
  onJoinClub: (club: PlayerClubSnapshot) => void;
  onToggleFavorite: (club: PlayerClubSnapshot) => void;
}) {
  const sections = groupOpportunitiesByClub(opportunities);
  return (
    <>
      {sections.map((section) => {
        const totalOpenSeats = section.items.reduce((sum, item) => sum + item.game.availableSeats, 0);
        const totalWaiting = section.items.reduce((sum, item) => sum + item.game.waitlistCount, 0);
        const isFavorite = favoriteClubIds.includes(section.club.club.id);
        return (
          <View key={section.club.club.id} style={styles.clubFolder}>
            <View style={styles.clubFolderHeader}>
              <View style={styles.clubFolderAvatar}>
                <Text style={styles.clubFolderAvatarText}>{section.club.club.name.slice(0, 1)}</Text>
              </View>
              <View style={styles.clubFolderCopy}>
                <View style={styles.clubFolderTitleRow}>
                  <Text style={styles.cardTitle}>{section.club.club.name}</Text>
                  {isFavorite ? (
                    <View style={styles.favoriteBadge}>
                      <Ionicons name="star" size={12} color={colors.amber} />
                      <Text style={styles.favoriteBadgeText}>Favorite</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.muted}>
                  {getClubCity(section.club)} / {section.items.length} games / {totalOpenSeats} open seats / {totalWaiting} waiting / {section.distanceMiles.toFixed(1)} mi
                </Text>
              </View>
              <IconActionButton
                icon={isFavorite ? 'star' : 'star-outline'}
                label={isFavorite ? `Unfavorite ${section.club.club.name}` : `Favorite ${section.club.club.name}`}
                onPress={() => onToggleFavorite(section.club)}
                active={isFavorite}
              />
            </View>
            <View style={styles.clubFolderGames}>
              {section.items.map((item, index) => (
                <OpportunityCard
                  key={`${item.club.club.id}:${item.game.id}:${index}`}
                  item={item}
                  tableLabel={getOpportunityTableLabel(item, index)}
                  premium={premium}
                  waitlistEntry={item.club.waitlists.find((entry) => isPlayerWaitlistEntry(entry, player) && entry.gameId === item.game.id)}
                  onSelectClub={() => onSelectClub(item)}
                  onDirections={() => onDirections(item.club)}
                  onWaitlist={() => onWaitlist(item.club, item.game)}
                  onCancelWaitlist={() => {
                    const entry = item.club.waitlists.find((candidate) => isPlayerWaitlistEntry(candidate, player) && candidate.gameId === item.game.id);
                    if (entry) onCancelWaitlist(item.club, item.game, entry);
                  }}
                  onJoinClub={() => onJoinClub(item.club)}
                />
              ))}
            </View>
          </View>
        );
      })}
    </>
  );
}

function OpportunityCard({
  item,
  tableLabel,
  premium,
  waitlistEntry,
  onSelectClub,
  onDirections,
  onWaitlist,
  onCancelWaitlist,
  onJoinClub
}: {
  item: GameOpportunity;
  tableLabel?: string;
  premium: boolean;
  waitlistEntry?: PlayerWaitlistEntry;
  onSelectClub: () => void;
  onDirections: () => void;
  onWaitlist: () => void;
  onCancelWaitlist: () => void;
  onJoinClub: () => void;
}) {
  const hasOpenTable = (item.game.openTables ?? []).length > 0;
  const canCancelRequest = Boolean(waitlistEntry && ['Interested', 'Confirmed Coming', 'Arrived'].includes(waitlistEntry.status));
  const alreadyWaiting = canCancelRequest || waitlistEntry?.status === 'Seated';
  const needsMembership = hasOpenTable && !item.isJoined;
  const statusLabel = !hasOpenTable
    ? 'Offered'
    : item.game.availableSeats
      ? `${item.game.availableSeats} open`
      : item.game.formingCount
        ? 'Forming'
        : 'Waitlist';
  const recommendationLabel = item.score >= 80 ? 'Best play' : item.score >= 55 ? 'Strong option' : item.score >= 30 ? 'Watchlist' : 'Low edge';
  const feeProfile = getClubFeeProfile(item.club, item.game);
  const accessProfileText = getAccessProfileText(item.club, item.game);
  const waitlistAheadText = waitlistEntry ? getWaitlistAheadText(waitlistEntry) : '';
  const feedMeta = [
    `${item.club.club.name}`,
    getClubCity(item.club),
    tableLabel ?? '',
    `${item.distanceMiles.toFixed(1)} mi`,
    `${item.game.waitlistCount} waiting`,
    item.game.knownPlayersCount ? `${item.game.knownPlayersCount} familiar` : '',
    item.isPreferred ? 'preferred' : '',
    waitlistEntry ? getPlayerGameStatusLabel(waitlistEntry) : ''
  ].filter(Boolean).join(' / ');
  return (
    <AnimatedSurface style={styles.gameCard}>
      <View style={styles.gameHeader}>
        <View style={styles.feedAvatar}>
          <Text style={styles.feedAvatarText}>{item.club.club.name.slice(0, 1)}</Text>
        </View>
        <Pressable onPress={onSelectClub} style={styles.gameTitleBlock}>
          <Text style={styles.cardTitle}>{tableLabel ? `${item.game.name} - ${tableLabel}` : item.game.name}</Text>
          <Text style={styles.muted}>{feedMeta}</Text>
        </Pressable>
        <View style={[styles.statusPill, item.game.availableSeats > 0 && styles.openPill]}>
          <Text style={styles.statusText}>{statusLabel}</Text>
        </View>
      </View>
      <View style={styles.feeInfoBand}>
        <Ionicons name="receipt-outline" size={15} color={colors.primaryDark} />
        <View style={[styles.feeTypePill, feeProfile.type === 'rake' && styles.rakeTypePill]}>
          <Text style={[styles.feeTypePillText, feeProfile.type === 'rake' && styles.rakeTypePillText]}>
            {feeProfile.type === 'rake' ? 'DROP' : 'TIME'}
          </Text>
        </View>
        <Text style={styles.feeInfoText}>{accessProfileText}</Text>
      </View>
      {!hasOpenTable ? (
        <View style={styles.offeredGameBand}>
          <Ionicons name="information-circle-outline" size={16} color={colors.primaryDark} />
          <Text style={styles.offeredGameText}>This game is offered by the club, but no table is currently open. Say you're interested and Core will add you to tonight's demand.</Text>
        </View>
      ) : null}
      {waitlistEntry ? (
        <View style={styles.waitlistAheadBand}>
          <Ionicons name="people-outline" size={15} color={colors.amber} />
          <Text style={styles.waitlistAheadText}>{waitlistAheadText}</Text>
        </View>
      ) : null}
      {premium ? (
        <>
          <View style={styles.recommendationBand}>
            <View style={styles.recommendationBadge}>
              <Ionicons name="analytics-outline" size={14} color={colors.teal} />
              <Text style={styles.recommendationBadgeText}>Grinder ranking: {recommendationLabel}</Text>
            </View>
            <Text style={styles.recommendationText}>{getRecommendationReason(item)}</Text>
          </View>
          <View style={styles.valueRow}>
            <View style={styles.valuePill}>
              <Ionicons name="speedometer-outline" size={13} color={colors.primaryDark} />
              <Text style={styles.valuePillText}>{Math.round(item.score)} score</Text>
            </View>
            <View style={styles.valuePill}>
              <Ionicons name="person-add-outline" size={13} color={colors.primaryDark} />
              <Text style={styles.valuePillText}>{item.seatScore} table fit</Text>
            </View>
            <View style={styles.valuePill}>
              <Ionicons name="heart-outline" size={13} color={colors.primaryDark} />
              <Text style={styles.valuePillText}>{item.profileScore} profile</Text>
            </View>
          </View>
        </>
      ) : (
        <View style={styles.lockedRecommendationBand}>
          <Ionicons name="lock-closed-outline" size={15} color={colors.muted} />
          <Text style={styles.lockedRecommendationText}>Premium unlocks grinder ranking and table fit analysis.</Text>
        </View>
      )}
      <View style={styles.gameActionRow}>
        <IconActionButton icon="navigate-outline" label={`Directions to ${item.club.club.name}`} onPress={onDirections} />
        <IconActionButton
          icon={canCancelRequest ? 'close-circle-outline' : alreadyWaiting ? 'checkmark-circle' : needsMembership ? 'card-outline' : 'person-add-outline'}
          label={canCancelRequest ? `Cancel request for ${item.game.name}` : alreadyWaiting && waitlistEntry ? getPlayerGameStatusLabel(waitlistEntry) : needsMembership ? `Join ${item.club.club.name}` : hasOpenTable ? `Request a seat for ${item.game.name}` : `I'm interested in ${item.game.name}`}
          onPress={canCancelRequest ? onCancelWaitlist : alreadyWaiting ? undefined : needsMembership ? onJoinClub : onWaitlist}
          active={canCancelRequest || !alreadyWaiting}
          disabled={alreadyWaiting && !canCancelRequest}
        />
      </View>
    </AnimatedSurface>
  );
}

function GameCard({
  game,
  waitlistEntry,
  joined,
  preferred,
  onWaitlist,
  onCancelWaitlist,
  onJoinClub
}: {
  game: PlayerSyncGame;
  waitlistEntry?: PlayerWaitlistEntry;
  joined: boolean;
  preferred: boolean;
  onWaitlist: () => void;
  onCancelWaitlist: (entry: PlayerWaitlistEntry) => void;
  onJoinClub: () => void;
}) {
  const hasOpenTable = (game.openTables ?? []).length > 0;
  const canCancelRequest = Boolean(waitlistEntry && ['Interested', 'Confirmed Coming', 'Arrived'].includes(waitlistEntry.status));
  const alreadyWaiting = canCancelRequest || waitlistEntry?.status === 'Seated';
  const buttonAction = canCancelRequest && waitlistEntry
    ? () => onCancelWaitlist(waitlistEntry)
    : alreadyWaiting
      ? undefined
      : !hasOpenTable || joined
        ? onWaitlist
        : onJoinClub;
  const waitlistAheadText = waitlistEntry ? getWaitlistAheadText(waitlistEntry) : '';
  return (
    <AnimatedSurface style={styles.gameCard}>
      <View style={styles.gameHeader}>
        <View style={styles.feedAvatar}>
          <Text style={styles.feedAvatarText}>{game.name.slice(0, 1)}</Text>
        </View>
        <View style={styles.gameTitleBlock}>
          <Text style={styles.cardTitle}>{game.name}</Text>
          <Text style={styles.muted}>{hasOpenTable ? (game.availableSeats ? `${game.availableSeats} seats available` : `${game.waitlistCount} on waitlist`) : 'Offered by club - no table currently open'}</Text>
        </View>
        <View style={[styles.statusPill, game.availableSeats > 0 && styles.openPill]}>
          <Text style={styles.statusText}>{!hasOpenTable ? 'Offered' : game.formingCount ? 'Forming' : game.availableSeats ? 'Open' : 'Full'}</Text>
        </View>
      </View>
      {preferred ? (
        <View style={styles.preferenceBand}>
          <Ionicons name="heart-outline" size={15} color={colors.teal} />
          <Text style={styles.preferenceText}>Preferred game</Text>
        </View>
      ) : null}
      {!hasOpenTable ? (
        <View style={styles.offeredGameBand}>
          <Ionicons name="information-circle-outline" size={16} color={colors.primaryDark} />
          <Text style={styles.offeredGameText}>No table is open right now. Mark yourself interested and the club will see the added demand in Core.</Text>
        </View>
      ) : null}
      <View style={styles.valueRow}>
        <View style={styles.valuePill}>
          <Ionicons name="receipt-outline" size={13} color={colors.primaryDark} />
          <Text style={styles.valuePillText}>{game.collectionMode ?? game.openTables[0]?.collectionMode ?? 'Drop'} collection</Text>
        </View>
        <View style={styles.valuePill}>
          <Ionicons name="time-outline" size={13} color={colors.primaryDark} />
          <Text style={styles.valuePillText}>{game.waitlistCount} waiting</Text>
        </View>
        {game.knownPlayersCount ? (
          <View style={styles.valuePill}>
            <Ionicons name="people-outline" size={13} color={colors.primaryDark} />
            <Text style={styles.valuePillText}>{game.knownPlayersCount} familiar</Text>
          </View>
        ) : null}
        {waitlistEntry ? (
          <View style={[styles.valuePill, styles.waitlistPill]}>
            <Ionicons name="bookmark-outline" size={13} color={colors.amber} />
            <Text style={[styles.valuePillText, styles.waitlistPillText]}>{getPlayerGameStatusLabel(waitlistEntry)}</Text>
          </View>
        ) : null}
      </View>
      {waitlistEntry ? (
        <View style={styles.waitlistAheadBand}>
          <Ionicons name="people-outline" size={15} color={colors.amber} />
          <Text style={styles.waitlistAheadText}>{waitlistAheadText}</Text>
        </View>
      ) : null}
      {game.openTables.map((table) => (
        <View key={table.id} style={styles.tableRow}>
          <View>
            <Text style={styles.tableName}>{table.label}</Text>
            <Text style={styles.muted}>
              {table.social?.seatedPlayerCount ?? table.seatsFilled} players / {table.social?.adminCount ?? 0} admins - {table.collectionMode}
            </Text>
            {table.social?.knownPlayersCount ? <Text style={styles.muted}>{table.social.knownPlayersCount} familiar players at this table</Text> : null}
          </View>
          <Text style={styles.tableSeats}>{table.availableSeats}</Text>
        </View>
      ))}
      <AnimatedButton variant="primary" onPress={buttonAction} disabled={alreadyWaiting && !canCancelRequest} style={[styles.primaryButton, styles.fullWidthButton, alreadyWaiting && !canCancelRequest && styles.disabledButton]}>
        <Ionicons name={canCancelRequest ? 'close-circle-outline' : alreadyWaiting ? 'checkmark-circle' : !hasOpenTable || joined ? 'time-outline' : 'card-outline'} size={18} color="#fff" />
        <Text style={styles.primaryButtonText}>{canCancelRequest ? 'Cancel Request' : alreadyWaiting && waitlistEntry ? getPlayerGameStatusLabel(waitlistEntry) : !hasOpenTable ? "I'm Interested" : joined ? 'Request Seat' : 'Join Club'}</Text>
      </AnimatedButton>
    </AnimatedSurface>
  );
}

function ClubMembershipPlanScreen({
  club,
  prices,
  message,
  player,
  onBack,
  onPlayerChange,
  onSelectProduct
}: {
  club: PlayerClubSnapshot;
  prices: { day: string; monthly: string; timePack: string };
  message: string;
  player: PlayerAccount;
  onBack: () => void;
  onPlayerChange: (patch: Partial<PlayerAccount>) => void;
  onSelectProduct: (product: ClubAccessProduct) => void;
}) {
  return (
    <View style={styles.membershipScreen}>
      <Pressable style={styles.inlineBackAction} onPress={onBack}>
        <Ionicons name="chevron-back" size={17} color={colors.primary} />
        <Text style={styles.inlineBackText}>Clubs</Text>
      </Pressable>
      <View style={styles.membershipHero}>
        <View style={styles.membershipHeroIcon}>
          <Text style={styles.membershipHeroText}>{club.club.name.slice(0, 1)}</Text>
        </View>
        <View style={styles.membershipHeroCopy}>
          <Text style={styles.agentKicker}>Sold by {club.club.name}</Text>
          <Text style={styles.membershipTitle}>{club.club.name}</Text>
          <Text style={styles.muted}>{club.club.address || 'Location details available from the card house'}</Text>
        </View>
      </View>

      <View style={styles.membershipApplicationCard}>
        <View>
          <Text style={styles.cardTitle}>Apply to join</Text>
          <Text style={styles.muted}>The card room reviews your information first. After approval, bring your ID and pay the membership fee at the door.</Text>
        </View>
        <Field label="Name" placeholder="Full name" value={player.name} onChangeText={(name) => onPlayerChange({ name })} />
        <Field label="Email" placeholder="Email address" value={player.email} keyboardType="email-address" onChangeText={(email) => onPlayerChange({ email })} />
        <Field label="Phone" placeholder="10-digit phone number" value={player.phone ?? ''} keyboardType="phone-pad" onChangeText={(phone) => onPlayerChange({ phone })} />
      </View>

      <View>
        <Text style={styles.cardTitle}>Choose a membership</Text>
        <Text style={styles.muted}>No payment is collected in Orbit for this demo.</Text>
      </View>
      <View style={styles.planGrid}>
        {getClubFeeProfile(club).type === 'time' ? (
          <MembershipPlanCard
            icon="time-outline"
            title="5-Hour Time Pack"
            price={prices.timePack}
            body="Prepay table time with this card house and use it across eligible cash games."
            onPress={() => onSelectProduct('time-5')}
            featured
          />
        ) : null}
        <MembershipPlanCard
          icon="today-outline"
          title="Day Pass"
          price={prices.day}
          body="Good for a quick visit, checking in, and requesting a seat today."
          onPress={() => onSelectProduct('day')}
        />
        <MembershipPlanCard
          icon="calendar-outline"
          title="Monthly Membership"
          price={prices.monthly}
          body="Best for regular players who want ongoing access to this club."
          onPress={() => onSelectProduct('monthly')}
          featured={getClubFeeProfile(club).type !== 'time'}
        />
      </View>

      <View style={styles.membershipNote}>
        <Ionicons name="storefront-outline" size={17} color={colors.primary} />
        <Text style={styles.lockedRecommendationText}>{club.club.name} sets the price and is the seller. Orbit never sells table time or club access itself.</Text>
      </View>
      {message ? <Text style={styles.privateGameStatus}>{message}</Text> : null}
    </View>
  );
}

function SeatRequestModal({
  draft,
  message,
  onChange,
  onClose,
  onSubmit
}: {
  draft: SeatRequestDraft | null;
  message: string;
  onChange: React.Dispatch<React.SetStateAction<SeatRequestDraft | null>>;
  onClose: () => void;
  onSubmit: () => void;
}) {
  if (!draft) return null;
  const hasOpenTable = draft.game.openTables.length > 0;
  const update = (patch: Partial<SeatRequestDraft>) => onChange((current) => current ? { ...current, ...patch } : current);
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.seatRequestModal}>
          <View style={styles.seatRequestHeader}>
            <View style={styles.seatRequestHeaderCopy}>
              <Text style={styles.agentKicker}>{draft.club.club.name}</Text>
              <Text style={styles.membershipTitle}>{hasOpenTable ? `Join ${draft.game.name}` : `When would you play ${draft.game.name}?`}</Text>
              <Text style={styles.muted}>{hasOpenTable
                ? 'Tell the club whether you are already there or when you are coming.'
                : 'This game is offered, but no table is open. Share when you would come so the club can form one.'}</Text>
            </View>
            <Pressable style={styles.modalCloseButton} onPress={onClose}>
              <Ionicons name="close" size={20} color={colors.ink} />
            </Pressable>
          </View>

          {hasOpenTable ? (
            <View style={styles.attendanceChoiceRow}>
              <Pressable
                style={[styles.attendanceChoice, draft.attendance === 'arrived' && styles.attendanceChoiceActive]}
                onPress={() => update({ attendance: 'arrived', expectedArrivalTime: '' })}
              >
                <Ionicons name="location-outline" size={20} color={draft.attendance === 'arrived' ? '#fff' : colors.primary} />
                <Text style={[styles.attendanceChoiceTitle, draft.attendance === 'arrived' && styles.attendanceChoiceTextActive]}>At club now</Text>
                <Text style={[styles.attendanceChoiceBody, draft.attendance === 'arrived' && styles.attendanceChoiceTextActive]}>Mark me arrived</Text>
              </Pressable>
              <Pressable
                style={[styles.attendanceChoice, draft.attendance === 'confirmed' && styles.attendanceChoiceActive]}
                onPress={() => update({ attendance: 'confirmed' })}
              >
                <Ionicons name="time-outline" size={20} color={draft.attendance === 'confirmed' ? '#fff' : colors.primary} />
                <Text style={[styles.attendanceChoiceTitle, draft.attendance === 'confirmed' && styles.attendanceChoiceTextActive]}>Coming later</Text>
                <Text style={[styles.attendanceChoiceBody, draft.attendance === 'confirmed' && styles.attendanceChoiceTextActive]}>Confirm a time</Text>
              </Pressable>
            </View>
          ) : null}

          {hasOpenTable && draft.attendance === 'confirmed' ? (
            <View style={styles.seatTimeField}>
              <Text style={styles.inputLabel}>Expected arrival time</Text>
              <TextInput
                value={draft.expectedArrivalTime}
                onChangeText={(expectedArrivalTime) => update({ expectedArrivalTime })}
                placeholder="Example: 7:30 PM"
                placeholderTextColor={colors.muted}
                style={styles.seatTimeInput}
              />
            </View>
          ) : null}

          {!hasOpenTable ? (
            <View style={styles.seatTimeField}>
              <Text style={styles.inputLabel}>Time or range you would come</Text>
              <View style={styles.timeRangeRow}>
                <TextInput
                  value={draft.availabilityStartTime}
                  onChangeText={(availabilityStartTime) => update({ attendance: 'interested', availabilityStartTime })}
                  placeholder="From, e.g. 6 PM"
                  placeholderTextColor={colors.muted}
                  style={[styles.seatTimeInput, styles.timeRangeInput]}
                />
                <TextInput
                  value={draft.availabilityEndTime}
                  onChangeText={(availabilityEndTime) => update({ attendance: 'interested', availabilityEndTime })}
                  placeholder="To, e.g. 10 PM"
                  placeholderTextColor={colors.muted}
                  style={[styles.seatTimeInput, styles.timeRangeInput]}
                />
              </View>
            </View>
          ) : null}

          {message ? <Text style={styles.formError}>{message}</Text> : null}
          <AnimatedButton variant="primary" onPress={onSubmit} style={[styles.primaryButton, styles.fullWidthButton]}>
            <Ionicons name={draft.attendance === 'arrived' ? 'location-outline' : 'checkmark-circle-outline'} size={18} color="#fff" />
            <Text style={styles.primaryButtonText}>{draft.attendance === 'arrived' ? 'Tell club I am here' : 'Send request'}</Text>
          </AnimatedButton>
        </View>
      </View>
    </Modal>
  );
}

function ClubAccessCheckoutScreen({
  club,
  product,
  price,
  message,
  connectedCheckoutEnabled,
  onBack,
  onPayInApp,
  onPayInPerson
}: {
  club: PlayerClubSnapshot;
  product: ClubAccessProduct;
  price: string;
  message: string;
  connectedCheckoutEnabled: boolean;
  onBack: () => void;
  onPayInApp: () => void;
  onPayInPerson: () => void;
}) {
  return (
    <View style={styles.membershipScreen}>
      <Pressable style={styles.inlineBackAction} onPress={onBack}>
        <Ionicons name="chevron-back" size={17} color={colors.primary} />
        <Text style={styles.inlineBackText}>Membership</Text>
      </Pressable>
      <View style={styles.paymentPlaceholder}>
        <View style={styles.paymentPlaceholderIcon}>
          <Ionicons name={connectedCheckoutEnabled ? 'card-outline' : 'person-add-outline'} size={28} color={colors.primary} />
        </View>
        <Text style={styles.membershipTitle}>{connectedCheckoutEnabled ? 'Payment' : 'Review application'}</Text>
        <Text style={styles.muted}>
          {club.club.name} / {getClubProductName(product)} / {price}
        </Text>
      </View>
      {connectedCheckoutEnabled ? (
        <>
          <View style={styles.merchantBand}>
            <Ionicons name="shield-checkmark-outline" size={18} color={colors.teal} />
            <Text style={styles.merchantBandText}>Sold and fulfilled by {club.club.name}. Orbit securely passes you to the card house’s connected checkout.</Text>
          </View>
          <AnimatedButton variant="primary" onPress={onPayInApp} style={[styles.primaryButton, styles.fullWidthButton]}>
            <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
            <Text style={styles.primaryButtonText}>Continue to card house checkout</Text>
          </AnimatedButton>
        </>
      ) : null}
      <Pressable style={styles.payInPersonButton} onPress={onPayInPerson}>
        <Ionicons name="storefront-outline" size={18} color={colors.ink} />
        <View style={styles.payInPersonCopy}>
          <Text style={styles.cardTitle}>{connectedCheckoutEnabled ? 'Pay in person' : 'Send membership application'}</Text>
          <Text style={styles.muted}>{connectedCheckoutEnabled ? 'Staff will confirm payment and activate your access.' : 'The card room will review it. After approval, bring your ID and pay at the door.'}</Text>
        </View>
      </Pressable>
      {message ? <Text style={styles.privateGameStatus}>{message}</Text> : null}
    </View>
  );
}

function MembershipPlanCard({
  icon,
  title,
  price,
  body,
  featured,
  onPress
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  price: string;
  body: string;
  featured?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.planCard, featured && styles.planCardFeatured]} onPress={onPress}>
      <View style={[styles.planIcon, featured && styles.planIconFeatured]}>
        <Ionicons name={icon} size={19} color={featured ? '#ffffff' : colors.primary} />
      </View>
      <View style={styles.planCardCopy}>
        <View style={styles.planCardTitleRow}>
          <Text style={styles.cardTitle}>{title}</Text>
          {featured ? <Text style={styles.planInlineBadge}>Popular</Text> : null}
        </View>
        <Text style={styles.muted} numberOfLines={1}>{body}</Text>
      </View>
      <View style={styles.planCardPriceBlock}>
        <Text style={styles.planCompactPrice}>{price}</Text>
        <Ionicons name="chevron-forward" size={17} color={colors.muted} />
      </View>
    </Pressable>
  );
}

function formatFamiliar(value?: number) {
  const count = Number(value ?? 0);
  return count > 0 ? ` - ${count} familiar player${count === 1 ? '' : 's'}` : '';
}

function MembershipApplicationStatusCard({
  club,
  membership
}: {
  club: PlayerClubSnapshot;
  membership: PlayerClubSnapshot['memberships'][number];
}) {
  return (
    <View style={styles.membershipApplicationStatus}>
      <View style={styles.membershipApplicationStatusIcon}>
        <Ionicons name="time-outline" size={21} color={colors.primary} />
      </View>
      <View style={styles.membershipApplicationStatusCopy}>
        <Text style={styles.cardTitle}>Application received</Text>
        <Text style={styles.muted}>{club.club.name} is reviewing your {membership.plan === 'day' ? 'day pass' : 'membership'} request. This screen updates as soon as staff approves it.</Text>
      </View>
      <View style={styles.statusPill}><Text style={styles.statusText}>Requested</Text></View>
    </View>
  );
}

function MembershipWalletCard({
  club,
  membership,
  nowMs,
  player
}: {
  club: PlayerClubSnapshot;
  membership: PlayerClubSnapshot['memberships'][number];
  nowMs: number;
  player: PlayerAccount;
}) {
  const active = isMembershipCurrentlyActive(membership, nowMs);
  const approved = membership.status === 'Approved';
  const credential = `${club.club.id}-${membership.playerId || player.id}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 18);
  return (
    <LinearGradient colors={['#111827', '#172554', '#4338ca']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.membershipWalletCard}>
      <View style={styles.membershipWalletTop}>
        <View style={styles.membershipWalletBrand}>
          <View style={styles.membershipWalletMonogram}>
            <Text style={styles.membershipWalletMonogramText}>{club.club.name.slice(0, 1)}</Text>
          </View>
          <View>
            <Text style={styles.membershipWalletClub}>{club.club.name}</Text>
            <Text style={styles.membershipWalletPlan}>{membership.plan === 'day' ? 'DAY PASS' : 'MEMBER'} · {membership.loyalty.tier.toUpperCase()}</Text>
          </View>
        </View>
        <View style={[styles.membershipStatusBadge, !active && styles.membershipStatusBadgeInactive]}>
          <View style={[styles.membershipStatusDot, !active && styles.membershipStatusDotInactive]} />
          <Text style={styles.membershipStatusText}>{active ? 'ACTIVE' : membership.status.toUpperCase()}</Text>
        </View>
      </View>

      <View style={styles.membershipIdentityRow}>
        <View>
          <Text style={styles.membershipIdentityLabel}>MEMBER</Text>
          <Text style={styles.membershipIdentityValue}>{player.name}</Text>
        </View>
        <View style={styles.membershipNumberBlock}>
          <Text style={styles.membershipIdentityLabel}>MEMBER ID</Text>
          <Text style={styles.membershipIdentityValue}>{credential.slice(-8)}</Text>
        </View>
      </View>

      <MembershipBarcode value={credential} />

      <View style={styles.checkedInBand}>
        <Ionicons name={approved ? 'id-card-outline' : 'scan-outline'} size={17} color="#bfdbfe" />
        <Text style={styles.checkedInText}>{approved
          ? 'Approved. Bring your ID and pay the card-room fee at the front desk to activate.'
          : 'Present this membership barcode at the front desk.'}</Text>
      </View>
    </LinearGradient>
  );
}

function MembershipBarcode({ value }: { value: string }) {
  const bars = Array.from(value).flatMap((character, index) => {
    const code = character.charCodeAt(0) + index;
    return [1 + (code % 3), 1, 1 + ((code >> 2) % 2)];
  });
  return (
    <View style={styles.barcodeShell}>
      <View accessibilityLabel={`Membership barcode ${value}`} style={styles.barcodeBars}>
        {bars.map((width, index) => (
          <View key={`${index}-${width}`} style={[styles.barcodeBar, { width, height: index % 5 === 0 ? 44 : 38 }]} />
        ))}
      </View>
      <Text style={styles.barcodeValue}>{value}</Text>
    </View>
  );
}

function ClubHubSections({
  club,
  membership,
  games,
  waitlists,
  tournaments,
  nowMs,
  onGame,
  onManageAccess,
  onViewEvents
}: {
  club: PlayerClubSnapshot;
  membership: PlayerClubSnapshot['memberships'][number];
  games: PlayerSyncGame[];
  waitlists: PlayerWaitlistEntry[];
  tournaments: PlayerTournament[];
  nowMs: number;
  onGame: (game: PlayerSyncGame) => void;
  onManageAccess: () => void;
  onViewEvents: () => void;
}) {
  const [openSection, setOpenSection] = useState<'games' | 'membership' | 'events' | null>(null);
  const toggle = (section: 'games' | 'membership' | 'events') => setOpenSection((current) => current === section ? null : section);
  return (
    <View style={styles.clubHub}>
      <Pressable onPress={() => toggle('games')} style={styles.clubHubRow}>
        <View style={styles.clubHubIcon}><Ionicons name="layers-outline" size={19} color={colors.primary} /></View>
        <View style={styles.clubHubCopy}>
          <Text style={styles.cardTitle}>Games</Text>
          <Text style={styles.muted}>{games.length} available now</Text>
        </View>
        <Ionicons name={openSection === 'games' ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
      </Pressable>
      {openSection === 'games' ? (
        <View style={styles.clubHubPanel}>
          {games.map((game) => {
            const waitlist = waitlists.find((entry) => entry.gameId === game.id);
            return (
              <Pressable key={game.id} disabled={Boolean(waitlist)} onPress={() => onGame(game)} style={styles.compactGameRow}>
                <View style={styles.compactGameCopy}>
                  <Text style={styles.cardTitle}>{game.name}</Text>
                  <Text style={styles.muted}>{getGameStatusLabel(game)}</Text>
                </View>
                <Text style={[styles.compactGameAction, waitlist && styles.compactGameActionMuted]}>
                  {waitlist ? getPlayerGameStatusLabel(waitlist) : 'Join'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <Pressable onPress={() => toggle('membership')} style={styles.clubHubRow}>
        <View style={styles.clubHubIcon}><Ionicons name="card-outline" size={19} color={colors.primary} /></View>
        <View style={styles.clubHubCopy}>
          <Text style={styles.cardTitle}>Membership</Text>
          <Text style={styles.muted}>{isMembershipCurrentlyActive(membership, nowMs) ? formatPassCountdown(membership.expiresAt, nowMs) : membership.status}</Text>
        </View>
        <Ionicons name={openSection === 'membership' ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
      </Pressable>
      {openSection === 'membership' ? (
        <View style={styles.clubHubPanel}>
          <View style={styles.membershipCompactStats}>
            <View><Text style={styles.compactStatValue}>{membership.loyalty.points.toLocaleString()}</Text><Text style={styles.compactStatLabel}>Points</Text></View>
            <View><Text style={styles.compactStatValue}>{membership.loyalty.tier}</Text><Text style={styles.compactStatLabel}>Tier</Text></View>
            <View><Text style={styles.compactStatValue}>{membership.plan === 'day' ? 'Day' : 'Monthly'}</Text><Text style={styles.compactStatLabel}>Plan</Text></View>
          </View>
          <Pressable onPress={onManageAccess} style={styles.compactManageButton}>
            <Text style={styles.compactManageText}>Manage access</Text>
          </Pressable>
        </View>
      ) : null}

      <Pressable onPress={() => toggle('events')} style={styles.clubHubRow}>
        <View style={styles.clubHubIcon}><Ionicons name="trophy-outline" size={19} color={colors.primary} /></View>
        <View style={styles.clubHubCopy}>
          <Text style={styles.cardTitle}>Events</Text>
          <Text style={styles.muted}>{tournaments.length ? `${tournaments.length} upcoming` : 'None scheduled'}</Text>
        </View>
        <Ionicons name={openSection === 'events' ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
      </Pressable>
      {openSection === 'events' ? (
        <View style={styles.clubHubPanel}>
          {tournaments.slice(0, 2).map((tournament) => (
            <View key={tournament.id} style={styles.compactEventRow}>
              <View style={styles.compactGameCopy}>
                <Text style={styles.cardTitle}>{tournament.name}</Text>
                <Text style={styles.muted}>{formatEventDate(tournament.startsAt)}</Text>
              </View>
            </View>
          ))}
          <Pressable onPress={onViewEvents} style={styles.compactManageButton}>
            <Text style={styles.compactManageText}>View events</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function SimpleMenuRow({
  icon,
  title,
  subtitle,
  onPress
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.simpleMenuRow}>
      <View style={styles.simpleMenuIcon}><Ionicons name={icon} size={20} color={colors.primary} /></View>
      <View style={styles.simpleMenuCopy}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.muted}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}

function ClubMembershipPanel({
  club,
  membership,
  nowMs,
  onBuyPass
}: {
  club: PlayerClubSnapshot;
  membership: PlayerClubSnapshot['memberships'][number];
  nowMs: number;
  onBuyPass: () => void;
}) {
  const active = isMembershipCurrentlyActive(membership, nowMs);
  const requested = membership.status === 'Requested';
  const approved = membership.status === 'Approved';
  return (
    <View style={styles.loyaltyCard}>
      <View style={styles.loyaltyHeader}>
        <View>
          <Text style={styles.cardTitle}>Membership</Text>
          <Text style={styles.muted}>{membership.plan === 'day' ? 'Day pass' : 'Monthly membership'} · {requested ? 'Under review' : approved ? 'Approved' : active ? 'Active' : 'Expired'}</Text>
        </View>
        <View style={styles.loyaltyBadge}>
          <Text style={styles.loyaltyBadgeText}>{membership.loyalty.tier}</Text>
        </View>
      </View>
      <Text style={styles.points}>{membership.loyalty.points.toLocaleString()} pts</Text>
      <View style={[styles.passTimer, active ? styles.passTimerActive : styles.passTimerInactive]}>
        <Ionicons name={requested ? 'time-outline' : approved ? 'id-card-outline' : 'timer-outline'} size={18} color={active ? colors.teal : colors.ink} />
        <View style={styles.passTimerCopy}>
          <Text style={styles.passTimerTitle}>{requested
            ? 'Application under review'
            : approved
              ? 'Visit the front desk to activate'
            : active
              ? formatPassCountdown(membership.expiresAt, nowMs)
              : 'Pass expired — buy a new pass'}</Text>
          <Text style={styles.muted}>{requested
            ? 'The card room will approve or follow up on your application.'
            : approved
              ? 'Bring your ID and pay the membership fee. Staff will activate you at the door.'
            : membership.expiresAt
              ? `Ends ${new Date(membership.expiresAt).toLocaleString()}`
              : 'No active expiration time is set.'}</Text>
        </View>
      </View>
      <Text style={styles.muted}>{club.games.length} games available</Text>
      <Pressable style={styles.buyAnotherPassButton} onPress={onBuyPass}>
        <Text style={styles.buyAnotherPassText}>{active ? 'Buy another pass' : 'Choose a pass'}</Text>
      </Pressable>
    </View>
  );
}

function ClubHistoryPanel() {
  return (
    <View style={styles.accountCard}>
      <Text style={styles.sectionTitle}>Prior Sessions</Text>
      <Text style={styles.muted}>Check-in and cash-out history will appear here.</Text>
      <Text style={styles.sectionTitle}>Scheduled Games</Text>
      <Text style={styles.muted}>No scheduled games posted yet.</Text>
    </View>
  );
}

function AnimatedSurface({ children, style }: { children: React.ReactNode; style?: object | object[] }) {
  const scale = useRef(new Animated.Value(1)).current;
  const lift = useRef(new Animated.Value(0)).current;

  const animate = (toScale: number, toLift: number) => {
    Animated.parallel([
      Animated.spring(scale, { toValue: toScale, friction: 7, tension: 120, useNativeDriver: false }),
      Animated.spring(lift, { toValue: toLift, friction: 8, tension: 90, useNativeDriver: false })
    ]).start();
  };

  return (
    <Animated.View
      onTouchStart={() => animate(0.992, 1)}
      onTouchEnd={() => animate(1, 0)}
      style={[
        style,
        {
          transform: [
            { scale },
            {
              translateY: lift.interpolate({ inputRange: [0, 1], outputRange: [0, -2] })
            }
          ],
          shadowOpacity: lift.interpolate({ inputRange: [0, 1], outputRange: [0.08, 0.16] })
        }
      ]}
    >
      {children}
    </Animated.View>
  );
}

function AnimatedButton({
  children,
  onPress,
  style,
  disabled,
  variant
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: object | object[];
  disabled?: boolean;
  variant: 'primary' | 'soft';
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const glow = useRef(new Animated.Value(0)).current;

  const animate = (toScale: number, toGlow: number) => {
    Animated.parallel([
      Animated.spring(scale, { toValue: toScale, friction: 5, tension: 160, useNativeDriver: false }),
      Animated.spring(glow, { toValue: toGlow, friction: 7, tension: 90, useNativeDriver: false })
    ]).start();
  };

  return (
    <Animated.View
      style={[
        {
          transform: [{ scale }],
          shadowOpacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.08, variant === 'primary' ? 0.22 : 0.14] })
        },
        styles.animatedButtonShadow
      ]}
    >
      <Pressable
        disabled={disabled}
        onHoverIn={() => animate(1.025, 1)}
        onHoverOut={() => animate(1, 0)}
        onPress={onPress}
        onPressIn={() => animate(0.97, 1)}
        onPressOut={() => animate(1, 0)}
        style={style}
      >
        {variant === 'primary' ? (
          <LinearGradient colors={disabled ? ['#94a3b8', '#7f8ea3'] : ['#0B1020', '#4D7CFE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.buttonGradient}>
            {children}
          </LinearGradient>
        ) : (
          children
        )}
      </Pressable>
    </Animated.View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  tone,
  keyboardType,
  onSubmit,
  error,
  placeholder
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  tone?: 'light';
  keyboardType?: React.ComponentProps<typeof TextInput>['keyboardType'];
  onSubmit?: () => void;
  error?: string;
  placeholder?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, tone === 'light' && styles.fieldLabelLight]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onKeyPress={(event) => {
          if (event.nativeEvent.key === 'Enter') onSubmit?.();
        }}
        onSubmitEditing={onSubmit}
        placeholder={placeholder ?? label}
        placeholderTextColor={tone === 'light' ? 'rgba(255,255,255,0.56)' : colors.muted}
        returnKeyType={onSubmit ? 'next' : 'done'}
        keyboardType={keyboardType}
        style={[styles.input, tone === 'light' && styles.inputLight, Boolean(error) && styles.inputError]}
      />
      {error ? <Text style={[styles.fieldError, tone === 'light' && styles.fieldErrorLight]}>{error}</Text> : null}
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function resolveAddressCoordinate(address?: string) {
  const normalized = (address ?? '').trim().toLowerCase();
  if (!normalized) return homeCoordinate;
  const match = texasAddressCoordinates.find((entry) => entry.keywords.some((keyword) => normalized.includes(keyword)));
  return match?.coordinate ?? homeCoordinate;
}

function getDistanceMiles(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number }
) {
  const earthRadiusMiles = 3958.8;
  const latitudeDelta = degreesToRadians(to.latitude - from.latitude);
  const longitudeDelta = degreesToRadians(to.longitude - from.longitude);
  const fromLat = degreesToRadians(from.latitude);
  const toLat = degreesToRadians(to.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function getClubDistance(club: PlayerClubSnapshot, originCoordinate = homeCoordinate) {
  return getDistanceMiles(originCoordinate, getClubCoordinate(club));
}

function getOpportunityKey(item: GameOpportunity) {
  return `${item.club.club.id}:${item.game.id}`;
}

function getScreenTitle(screen: Screen) {
  if (screen === 'settings') return 'Profile';
  if (screen === 'identityVerification') return 'Age Verification';
  return tabs.find((tab) => tab.id === screen)?.label ?? 'Orbit';
}

function getIdentityStatusLabel(status: PlayerIdentityStatus, signedIn: boolean) {
  if (!signedIn) return 'Sign in to verify before joining or purchasing access';
  if (status.ageVerified) return `Verified ${status.minimumAge}+`;
  if (status.status === 'processing') return 'Stripe is reviewing your verification';
  if (status.status === 'underage') return `Minimum age ${status.minimumAge} not met`;
  return `Required before joining, checking in, or purchasing access`;
}

function getCompatibilityPercent(item: GameOpportunity) {
  const preference = item.isPreferred ? 22 : 10;
  const access = item.isJoined ? 8 : 3;
  const seats = Math.min(18, item.game.availableSeats * 4 + item.game.formingCount * 2);
  const social = Math.min(14, item.game.knownPlayersCount * 5 + (item.club.social?.knownPlayersInHouse ?? 0) * 2);
  const distance = Math.max(0, 18 - Math.round(item.distanceMiles / 3));
  const wait = Math.max(2, 12 - item.game.waitlistCount);
  return Math.max(54, Math.min(98, 30 + preference + access + seats + social + distance + wait));
}

function getCompatibilitySummary(item: GameOpportunity) {
  if (item.isPreferred && item.game.knownPlayersCount) return `Your stakes, ${item.game.knownPlayersCount} familiar player${item.game.knownPlayersCount === 1 ? '' : 's'}, and live seats make this a strong fit.`;
  if (item.isPreferred) return 'This matches your preferred game and has a seat profile that fits how you play.';
  if (item.game.knownPlayersCount) return `${item.game.knownPlayersCount} player${item.game.knownPlayersCount === 1 ? '' : 's'} you know ${item.game.knownPlayersCount === 1 ? 'is' : 'are'} already connected to this game.`;
  if (item.game.availableSeats) return `${item.game.availableSeats} live seat${item.game.availableSeats === 1 ? '' : 's'} and a manageable wait make this worth a look.`;
  return 'This host regularly spreads games close to your preferred stakes and location.';
}

function getGameStatusLabel(game: PlayerSyncGame) {
  if (!game.openTables.length) return 'Planning next game';
  if (game.availableSeats) return `${game.availableSeats} seats open`;
  if (game.formingCount) return 'Table forming';
  return `${game.waitlistCount} on waitlist`;
}

function getVenueKind(club: PlayerClubSnapshot) {
  if (isCasinoClub(club)) return 'Casino';
  const identity = `${club.club.id} ${club.club.name}`.toLowerCase();
  if (identity.includes('card') || identity.includes('poker hall') || identity.includes('room')) return 'Card house';
  return 'Poker club';
}

function getClubProductName(product: ClubAccessProduct) {
  if (product === 'day') return 'Day Pass';
  if (product === 'monthly') return 'Monthly Membership';
  return '5-Hour Time Pack';
}

function formatDropFee(value: string) {
  return value.toLowerCase().includes('drop') ? value : `${value} drop`;
}

function getClubProductLabel(product: ClubAccessProduct, prices: { day: string; monthly: string; timePack: string }) {
  if (product === 'day') return prices.day;
  if (product === 'monthly') return prices.monthly;
  return prices.timePack;
}

function getClubCity(club: PlayerClubSnapshot) {
  const address = club.club.address ?? '';
  const parts = address.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2];
  if (address.toLowerCase().includes('dallas')) return 'Dallas';
  if (address.toLowerCase().includes('austin')) return 'Austin';
  if (address.toLowerCase().includes('houston')) return 'Houston';
  if (address.toLowerCase().includes('bryan')) return 'Bryan';
  if (address.toLowerCase().includes('college station')) return 'College Station';
  return 'Texas';
}

function getClubSearchText(club: PlayerClubSnapshot) {
  return `${club.club.name} ${club.club.address ?? ''} ${getClubCity(club)}`.toLowerCase();
}

function isCasinoClub(club: PlayerClubSnapshot) {
  const text = getClubSearchText(club);
  return club.club.id.includes('casino') || text.includes('casino') || text.includes('choctaw') || text.includes('winstar');
}

function getClubCoordinate(club: PlayerClubSnapshot) {
  const known = clubCoordinates[club.club.id];
  if (known) return known;
  const seed = Array.from(club.club.id).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return {
    latitude: homeCoordinate.latitude + ((seed % 17) - 8) * 0.006,
    longitude: homeCoordinate.longitude + (((seed * 3) % 17) - 8) * 0.006
  };
}

function findGamesClubKey(club: PlayerClubSnapshot) {
  const normalizedId = normalizedIdentity(club.club.id).replace(/\s+/g, '-');
  const normalizedName = normalizedIdentity(club.club.name);
  const idIndex = findGamesClubOrder.indexOf(normalizedId);
  if (idIndex >= 0) return findGamesClubOrder[idIndex];
  const nameIndex = findGamesClubNames.indexOf(normalizedName);
  return nameIndex >= 0 ? findGamesClubOrder[nameIndex] : '';
}

function isFindGamesClub(club: PlayerClubSnapshot) {
  return Boolean(findGamesClubKey(club));
}

function compareFindGamesClubOrder(left: PlayerClubSnapshot, right: PlayerClubSnapshot) {
  const leftIndex = findGamesClubOrder.indexOf(findGamesClubKey(left));
  const rightIndex = findGamesClubOrder.indexOf(findGamesClubKey(right));
  return leftIndex - rightIndex || left.club.name.localeCompare(right.club.name);
}

function buildFindGameClubs(clubs: PlayerClubSnapshot[]) {
  return clubs.slice().sort((left, right) => left.club.name.localeCompare(right.club.name));
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

function getClubMembershipPrices(club: PlayerClubSnapshot) {
  void club;
  return { day: 'Club-priced day pass', monthly: 'Club-priced membership', timePack: 'Club-priced time package' };
}

function getClubFeeProfile(club: PlayerClubSnapshot, game?: PlayerSyncGame) {
  const configured = clubFeeProfiles[club.club.id] ?? { type: 'time' as const, hourly: '$10/hr' };
  const liveMode = game?.collectionMode ?? game?.openTables[0]?.collectionMode;
  if (liveMode === 'Time') {
    return configured.type === 'time' ? configured : { type: 'time' as const, hourly: '$10/hr' };
  }
  if (liveMode === 'Drop') {
    return { type: 'rake' as const, percent: 'House drop' };
  }
  return configured;
}

function getAccessProfileText(club: PlayerClubSnapshot, game?: PlayerSyncGame) {
  const membership = getClubMembershipPrices(club);
  const fees = getClubFeeProfile(club, game);
  if (fees.type === 'time') return `Paid time: ${fees.hourly} / Membership fee: ${membership.day} or ${membership.monthly}`;
  if (game?.collectionMode === 'Drop' || game?.openTables[0]?.collectionMode === 'Drop') {
    return `Drop collection: configured by club / Membership fee: ${membership.day} or ${membership.monthly}`;
  }
  return `Rake taken: ${fees.percent} of pot / Membership fee: ${membership.day} or ${membership.monthly}`;
}

function groupOpportunitiesByClub(opportunities: GameOpportunity[]) {
  const folders = new Map<string, { club: PlayerClubSnapshot; distanceMiles: number; items: GameOpportunity[] }>();
  opportunities.forEach((item) => {
    const current = folders.get(item.club.club.id);
    if (current) {
      current.items.push(item);
      current.distanceMiles = Math.min(current.distanceMiles, item.distanceMiles);
      return;
    }
    folders.set(item.club.club.id, { club: item.club, distanceMiles: item.distanceMiles, items: [item] });
  });
  return Array.from(folders.values()).sort((left, right) => compareFindGamesClubOrder(left.club, right.club));
}

function getOpportunityTableLabel(item: GameOpportunity, index: number) {
  if (!(item.game.openTables ?? []).length) return undefined;
  const tableLabel = item.game.openTables[0]?.label?.trim();
  if (!tableLabel) return `Table ${index + 1}`;
  if (/^table\s+\d+/i.test(tableLabel)) return tableLabel;
  return `Table ${index + 1}: ${tableLabel}`;
}

function matchesGameTypeFilter(club: PlayerClubSnapshot, game: PlayerSyncGame, filter: GameTypeFilter) {
  if (filter === 'none') return true;
  if (filter === 'all') return true;
  if (filter === 'favorites') return true;
  const text = `${club.club.name} ${game.name}`.toLowerCase();
  if (filter === 'home-game') return text.includes('home');
  if (filter === 'private') return text.includes('private');
  if (filter === 'public') return !text.includes('private') && !text.includes('home');
  return !text.includes('private') && !text.includes('home');
}

function getRecommendationReason(item: GameOpportunity) {
  const reasons = [
    item.game.availableSeats
      ? `${item.game.availableSeats} open seats`
      : item.game.formingCount
        ? 'forming table'
        : (item.game.openTables ?? []).length || item.game.waitlistCount
          ? 'waitlist only'
          : 'configured - no open table yet',
    item.isPreferred ? 'matches your profile' : '',
    item.isJoined ? 'club access ready' : 'membership needed',
    item.game.knownPlayersCount ? `${item.game.knownPlayersCount} familiar players` : '',
    `${item.distanceMiles.toFixed(1)} mi away`
  ].filter(Boolean);
  return reasons.join(' / ');
}

function formatCurrency(value: number) {
  const prefix = value < 0 ? '-' : '';
  return `${prefix}$${Math.abs(Math.round(value)).toLocaleString()}`;
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(value.trim());
}

function isValidPhoneNumber(value: string, optional = false) {
  const trimmed = value.trim();
  if (!trimmed) return optional;
  const digits = trimmed.replace(/\D/g, '');
  return digits.length === 10 || (digits.length === 11 && digits.startsWith('1'));
}

function toggleDraftGame(gameId: string, setDraftPlayer: React.Dispatch<React.SetStateAction<PlayerAccount>>) {
  setDraftPlayer((current) => ({
    ...current,
    preferredGameIds: current.preferredGameIds.includes(gameId)
      ? current.preferredGameIds.filter((id) => id !== gameId)
      : [...current.preferredGameIds, gameId]
  }));
}

function togglePlayerGame(gameId: string, setPlayer: React.Dispatch<React.SetStateAction<PlayerAccount>>) {
  setPlayer((current) => ({
    ...current,
    preferredGameIds: current.preferredGameIds.includes(gameId)
      ? current.preferredGameIds.filter((id) => id !== gameId)
      : [...current.preferredGameIds, gameId]
  }));
}

const colors = {
  ink: '#0b1020',
  muted: '#64748b',
  canvas: '#f9fafb',
  panel: '#ffffff',
  line: 'rgba(100,116,139,0.16)',
  primary: '#4d7cfe',
  primaryDark: '#0b1020',
  primarySoft: '#eef3ff',
  teal: '#2563eb',
  tealSoft: '#dbeafe',
  amber: '#8b5cf6',
  amberSoft: '#f3e8ff',
  coral: '#dc2626'
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f9fafb'
  },
  appBackdrop: {
    ...StyleSheet.absoluteFillObject
  },
  animatedGradientRoot: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0b1020',
    overflow: 'hidden'
  },
  gradientDriftLayer: {
    height: '128%',
    left: '-18%',
    position: 'absolute',
    top: '-14%',
    width: '136%'
  },
  orbitPattern: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.28
  },
  orbitHalo: {
    borderColor: 'rgba(255,255,255,0.32)',
    borderRadius: 999,
    borderWidth: 2,
    height: 260,
    left: -48,
    position: 'absolute',
    top: 92,
    transform: [{ rotate: '-18deg' }],
    width: 420
  },
  orbitRing: {
    borderColor: 'rgba(139,92,246,0.34)',
    borderRadius: 999,
    borderWidth: 14,
    bottom: 28,
    left: 34,
    position: 'absolute',
    right: 34,
    top: 28
  },
  orbitNode: {
    backgroundColor: 'rgba(255,255,255,0.76)',
    borderColor: 'rgba(77,124,254,0.32)',
    borderRadius: 999,
    borderWidth: 3,
    height: 28,
    position: 'absolute',
    width: 28
  },
  orbitNodeOne: {
    left: 86,
    top: 18
  },
  orbitNodeTwo: {
    right: 88,
    top: 34
  },
  orbitNodeThree: {
    bottom: 22,
    left: 132
  },
  orbitNodeFour: {
    bottom: 34,
    right: 118
  },
  gradientShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(16,23,39,0.24)'
  },
  shell: {
    alignSelf: 'center',
    flex: 1,
    maxWidth: 640,
    paddingHorizontal: 16,
    paddingTop: 6,
    width: '100%'
  },
  onboardingSafeArea: {
    backgroundColor: '#0b1020'
  },
  onboardingShell: {
    flex: 1,
    paddingHorizontal: 24
  },
  onboardingContent: {
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: '100%',
    paddingBottom: 34,
    paddingTop: 22
  },
  onboardingFlow: {
    flex: 1,
    gap: 26,
    justifyContent: 'center',
    minHeight: '100%'
  },
  onboardingTopBar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 20,
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    position: 'absolute',
    top: 0,
    width: '100%'
  },
  onboardingBrand: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1.2
  },
  onboardingBrandSubtle: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.6,
    textTransform: 'uppercase'
  },
  onboardingProgressShell: {
    flex: 1,
    maxWidth: 168
  },
  onboardingProgressTrack: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 6,
    height: 3,
    overflow: 'hidden'
  },
  onboardingProgressFill: {
    backgroundColor: '#ffffff',
    borderRadius: 6,
    height: 3
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
  onboardingTitle: {
    color: '#ffffff',
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: 0,
    lineHeight: 38,
    textAlign: 'center'
  },
  onboardingCopy: {
    color: 'rgba(255,255,255,0.74)',
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 22
  },
  onboardingStepSurface: {
    alignSelf: 'stretch',
    backgroundColor: 'transparent',
    borderRadius: 0,
    gap: 12,
    minHeight: 86,
    paddingHorizontal: 0,
    paddingVertical: 0
  },
  optionalStep: {
    gap: 10
  },
  optionalStepText: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
    textAlign: 'center'
  },
  onboardingActions: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2
  },
  arrowAction: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    minWidth: 44,
    position: 'relative'
  },
  arrowActionDisabled: {
    opacity: 0.35
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
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.ink,
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
  sectionTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    paddingTop: 2
  },
  searchPanel: {
    backgroundColor: 'rgba(255,254,250,0.92)',
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    gap: 9,
    padding: 10
  },
  onboardingNextAction: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderColor: 'rgba(255,255,255,0.36)',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    justifyContent: 'center',
    minHeight: 48,
    minWidth: 142,
    paddingHorizontal: 18
  },
  onboardingNextActionText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800'
  },
  searchToolbar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8
  },
  plainSearchBar: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: colors.line,
    borderRadius: 13,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 13
  },
  plainFiltersButton: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: colors.line,
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 13
  },
  plainFiltersText: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: '900'
  },
  filterSheetBackdrop: {
    backgroundColor: 'rgba(15,23,42,0.38)',
    flex: 1,
    justifyContent: 'flex-end'
  },
  filterSheetDismiss: {
    ...StyleSheet.absoluteFillObject
  },
  filterSheetCard: {
    alignSelf: 'center',
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
    maxWidth: 640,
    overflow: 'hidden',
    paddingBottom: Platform.OS === 'ios' ? 20 : 12,
    width: '100%'
  },
  filterSheetHandle: {
    alignSelf: 'center',
    backgroundColor: '#d1d5db',
    borderRadius: 99,
    height: 4,
    marginTop: 9,
    width: 42
  },
  filterSheetHeader: {
    alignItems: 'center',
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 58,
    paddingHorizontal: 16
  },
  filterSheetTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '900'
  },
  filterSheetHeaderAction: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    minWidth: 58,
    paddingHorizontal: 9
  },
  filterSheetDoneAction: {
    backgroundColor: colors.primary,
    borderRadius: 10
  },
  filterSheetResetText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800'
  },
  filterSheetDoneText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900'
  },
  filterSheetContent: {
    gap: 16,
    padding: 16,
    paddingBottom: 22
  },
  sheetField: {
    gap: 8
  },
  sheetTextInput: {
    backgroundColor: '#f8fafc',
    borderColor: colors.line,
    borderRadius: 11,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 14,
    fontWeight: '600',
    minHeight: 46,
    paddingHorizontal: 12
  },
  filterPanel: {
    gap: 10
  },
  filterChipRow: {
    gap: 8,
    paddingRight: 8
  },
  cardHouseScroller: {
    paddingBottom: Platform.OS === 'web' ? 8 : 0
  },
  filterGrid: {
    gap: 10
  },
  distanceRow: {
    flexDirection: 'row',
    gap: 7
  },
  distanceChip: {
    alignItems: 'center',
    backgroundColor: '#f4f4f1',
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    minHeight: 38,
    justifyContent: 'center'
  },
  distanceChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary
  },
  distanceChipText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '800'
  },
  distanceChipTextActive: {
    color: '#ffffff'
  },
  lockedFilterRow: {
    alignItems: 'center',
    backgroundColor: '#f4f4f1',
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 11
  },
  lockedFilterRowActive: {
    backgroundColor: colors.tealSoft,
    borderColor: 'rgba(21,127,109,0.24)'
  },
  lockedFilterText: {
    color: colors.ink,
    flex: 1,
    fontSize: 13,
    fontWeight: '800'
  },
  agentPanel: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.03,
    shadowRadius: 12
  },
  agentHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 11
  },
  agentIcon: {
    alignItems: 'center',
    backgroundColor: colors.tealSoft,
    borderColor: 'rgba(21,127,109,0.12)',
    borderRadius: 10,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    position: 'relative',
    width: 42
  },
  agentCopy: {
    flex: 1,
    gap: 3
  },
  agentKicker: {
    color: colors.teal,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase'
  },
  paywallPanel: {
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
  paywallHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 11
  },
  paywallIcon: {
    alignItems: 'center',
    backgroundColor: colors.tealSoft,
    borderColor: 'rgba(21,127,109,0.15)',
    borderRadius: 999,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44
  },
  priceRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 8
  },
  priceText: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: '900'
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
  searchInput: {
    color: colors.ink,
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    minHeight: 42,
    paddingVertical: 0
  },
  hostPrompt: {
    alignItems: 'center',
    borderTopColor: colors.line,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingTop: 10
  },
  hostPromptIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 10,
    height: 34,
    justifyContent: 'center',
    width: 34
  },
  hostPromptCopy: {
    flex: 1,
    gap: 1
  },
  inlineBackAction: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: 5,
    minHeight: 36,
    paddingHorizontal: 2
  },
  inlineBackText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '800'
  },
  contextRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  contextChip: {
    alignItems: 'center',
    backgroundColor: colors.tealSoft,
    borderColor: 'rgba(21,127,109,0.12)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 6
  },
  contextText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700'
  },
  clubCard: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    padding: 13,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.025,
    shadowRadius: 10
  },
  selectedCard: {
    backgroundColor: '#fbfffc',
    borderColor: 'rgba(21,127,109,0.26)'
  },
  clubAvatar: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    height: 38,
    justifyContent: 'center',
    width: 38
  },
  clubAvatarActive: {
    backgroundColor: colors.primary
  },
  clubAvatarText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '800'
  },
  clubAvatarTextActive: {
    color: '#ffffff'
  },
  clubMain: {
    flex: 1,
    gap: 4
  },
  iconActionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8
  },
  iconActionButton: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderColor: 'rgba(56,80,109,0.14)',
    borderRadius: 12,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42
  },
  iconActionButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary
  },
  iconActionButtonDisabled: {
    backgroundColor: '#eeeeea',
    borderColor: colors.line
  },
  iconTooltip: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: 8,
    bottom: 48,
    maxWidth: 190,
    minWidth: 84,
    paddingHorizontal: 9,
    paddingVertical: 6,
    position: 'absolute',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    zIndex: 30
  },
  iconTooltipText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center'
  },
  emptyState: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
    padding: 16
  },
  cardTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0
  },
  muted: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18
  },
  statusPill: {
    backgroundColor: colors.amberSoft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  openPill: {
    backgroundColor: colors.tealSoft
  },
  statusText: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: '800'
  },
  compactButton: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9
  },
  compactButtonText: {
    color: colors.ink,
    fontWeight: '800'
  },
  preferenceBand: {
    alignItems: 'center',
    backgroundColor: colors.tealSoft,
    borderColor: 'rgba(21,127,109,0.12)',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    padding: 12
  },
  preferenceText: {
    color: colors.teal,
    flex: 1,
    fontSize: 13,
    fontWeight: '700'
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
  gameCard: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    gap: 11,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.03,
    shadowRadius: 12
  },
  clubFolder: {
    gap: 9
  },
  clubFolderHeader: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 70,
    padding: 13,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.025,
    shadowRadius: 12
  },
  clubFolderAvatar: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    height: 42,
    justifyContent: 'center',
    width: 42
  },
  clubFolderAvatarText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '900'
  },
  clubFolderCopy: {
    flex: 1,
    gap: 4
  },
  clubFolderTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7
  },
  favoriteBadge: {
    alignItems: 'center',
    backgroundColor: '#fff8ed',
    borderColor: 'rgba(181,106,24,0.18)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3
  },
  favoriteBadgeText: {
    color: colors.amber,
    fontSize: 11,
    fontWeight: '900'
  },
  clubFolderGames: {
    gap: 9,
    paddingLeft: 10
  },
  gameActionRow: {
    flexDirection: 'row',
    gap: 9,
    justifyContent: 'flex-end'
  },
  privateGameComposer: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    gap: 11,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.03,
    shadowRadius: 12
  },
  composerGrid: {
    flexDirection: 'row',
    gap: 10
  },
  publishPrivateGame: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    borderRadius: 10,
    flexDirection: 'row',
    gap: 7,
    minHeight: 40,
    paddingHorizontal: 13
  },
  publishPrivateGameDisabled: {
    backgroundColor: '#9aa3a0'
  },
  publishPrivateGameText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800'
  },
  privateGameCard: {
    backgroundColor: '#fbfffc',
    borderColor: 'rgba(15,118,110,0.18)'
  },
  privateGameMarker: {
    alignItems: 'center',
    borderColor: colors.teal,
    borderRadius: 999,
    borderWidth: 2,
    height: 40,
    justifyContent: 'center',
    width: 40
  },
  privateGameMarkerInner: {
    backgroundColor: colors.teal,
    borderRadius: 999,
    height: 16,
    width: 16
  },
  privateBadge: {
    backgroundColor: colors.tealSoft,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5
  },
  privateBadgeText: {
    color: colors.teal,
    fontSize: 12,
    fontWeight: '800'
  },
  privateGameStatus: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 2
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
  membershipScreen: {
    gap: 12
  },
  membershipHero: {
    backgroundColor: '#fbfffc',
    borderColor: 'rgba(21,127,109,0.18)',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 13,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.03,
    shadowRadius: 12
  },
  membershipHeroIcon: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 14,
    height: 52,
    justifyContent: 'center',
    width: 52
  },
  membershipHeroText: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '900'
  },
  membershipHeroCopy: {
    flex: 1,
    gap: 5
  },
  membershipApplicationCard: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    gap: 11,
    padding: 14
  },
  membershipTitle: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 0
  },
  paymentPlaceholder: {
    alignItems: 'center',
    backgroundColor: '#fbfffc',
    borderColor: colors.line,
    borderRadius: 12,
    borderStyle: 'dashed',
    borderWidth: 1,
    gap: 10,
    minHeight: 220,
    justifyContent: 'center',
    padding: 20
  },
  paymentPlaceholderIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 16,
    height: 56,
    justifyContent: 'center',
    width: 56
  },
  planGrid: {
    gap: 10
  },
  planCard: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 11,
    minHeight: 72,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.025,
    shadowRadius: 12
  },
  planCardFeatured: {
    backgroundColor: '#f4fbf8',
    borderColor: 'rgba(21,127,109,0.24)'
  },
  planCardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  planIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 12,
    height: 40,
    justifyContent: 'center',
    width: 40
  },
  planIconFeatured: {
    backgroundColor: colors.primary
  },
  planCardCopy: { flex: 1, gap: 3 },
  planCardTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  planInlineBadge: { color: colors.teal, fontSize: 9, fontWeight: '900', textTransform: 'uppercase' },
  planCardPriceBlock: { alignItems: 'flex-end', flexDirection: 'row', gap: 4 },
  planCompactPrice: { color: colors.ink, fontSize: 13, fontWeight: '900' },
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
  recommendationBand: {
    backgroundColor: '#f4fbf8',
    borderColor: 'rgba(21,127,109,0.12)',
    borderRadius: 10,
    borderWidth: 1,
    gap: 7,
    padding: 11
  },
  recommendationBadge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: 5
  },
  recommendationBadgeText: {
    color: colors.teal,
    fontSize: 12,
    fontWeight: '900'
  },
  recommendationText: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18
  },
  lockedRecommendationBand: {
    alignItems: 'center',
    backgroundColor: '#f6f6f3',
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    padding: 11
  },
  lockedRecommendationText: {
    color: colors.muted,
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18
  },
  feeInfoBand: {
    alignItems: 'center',
    backgroundColor: '#fff8e8',
    borderColor: '#f0ddad',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 9
  },
  feeTypePill: {
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  feeTypePillText: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: '900'
  },
  rakeTypePill: {
    backgroundColor: '#fff0dc'
  },
  rakeTypePillText: {
    color: colors.amber
  },
  feeInfoText: {
    color: colors.primaryDark,
    flex: 1,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 16
  },
  offeredGameBand: {
    alignItems: 'flex-start',
    backgroundColor: '#eef4ff',
    borderColor: '#cbdafc',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 10
  },
  offeredGameText: {
    color: colors.primaryDark,
    flex: 1,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17
  },
  waitlistAheadBand: {
    alignItems: 'center',
    backgroundColor: '#fff8ed',
    borderColor: 'rgba(181,106,24,0.18)',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 9
  },
  waitlistAheadText: {
    color: colors.amber,
    flex: 1,
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 16
  },
  gameHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between'
  },
  gameTitleBlock: {
    flex: 1,
    gap: 4
  },
  feedAvatar: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    height: 40,
    justifyContent: 'center',
    width: 40
  },
  feedAvatarText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '800'
  },
  valueRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7
  },
  valuePill: {
    alignItems: 'center',
    backgroundColor: '#f6f6f3',
    borderColor: 'rgba(24,23,22,0.06)',
    borderWidth: 1,
    borderRadius: 999,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 6
  },
  valuePillText: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: '700'
  },
  preferredPill: {
    backgroundColor: '#f2fbf8',
    borderColor: 'rgba(15,118,110,0.16)'
  },
  preferredPillText: {
    color: colors.teal
  },
  waitlistPill: {
    backgroundColor: '#fff8ed',
    borderColor: 'rgba(181,106,24,0.18)'
  },
  waitlistPillText: {
    color: colors.amber
  },
  tableRow: {
    alignItems: 'center',
    backgroundColor: '#f7f7f4',
    borderColor: 'rgba(24,23,22,0.07)',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 11
  },
  tableName: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '800'
  },
  tableSeats: {
    color: colors.teal,
    fontSize: 22,
    fontWeight: '900'
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 10,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 46,
    overflow: 'hidden',
    paddingHorizontal: 0
  },
  buttonGradient: {
    alignItems: 'center',
    alignSelf: 'stretch',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: 16
  },
  fullWidthButton: {
    alignSelf: 'stretch'
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
  secondaryActionText: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: '800'
  },
  disabledButton: {
    backgroundColor: '#a7aaa4'
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800'
  },
  loyaltyCard: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
    padding: 16
  },
  loyaltyHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  loyaltyBadge: {
    backgroundColor: colors.tealSoft,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7
  },
  loyaltyBadgeText: {
    color: colors.teal,
    fontWeight: '800'
  },
  points: {
    color: colors.ink,
    fontSize: 34,
    fontWeight: '800'
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
  accountCard: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.025,
    shadowRadius: 12
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
  stepHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12
  },
  stepHeaderIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderColor: 'rgba(21,127,109,0.11)',
    borderRadius: 10,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44
  },
  stepHeaderText: {
    flex: 1,
    gap: 4
  },
  mapCard: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
    overflow: 'hidden',
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.025,
    shadowRadius: 12
  },
  mapHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  mapCanvas: {
    aspectRatio: 1.55,
    backgroundColor: colors.tealSoft,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative'
  },
  mapCanvasLarge: {
    aspectRatio: 1.15,
    backgroundColor: colors.tealSoft,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative'
  },
  liveMap: {
    ...StyleSheet.absoluteFillObject
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
  mapFooter: {
    gap: 3
  },
  field: {
    gap: 6
  },
  fieldLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700'
  },
  fieldLabelLight: {
    color: 'rgba(255,255,255,0.76)',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center'
  },
  input: {
    backgroundColor: '#f7f7f4',
    borderColor: 'rgba(24,23,22,0.08)',
    borderRadius: 10,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 15,
    fontWeight: '600',
    minHeight: 44,
    paddingHorizontal: 12,
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0,
    shadowRadius: 0
  },
  inputLight: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: 10,
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '600',
    minHeight: 58,
    paddingHorizontal: 16,
    textAlign: 'center'
  },
  inputError: {
    borderColor: '#f59e0b'
  },
  fieldError: {
    color: '#b45309',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17
  },
  fieldErrorLight: {
    color: '#fde68a',
    textAlign: 'center'
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  chip: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: 12
  },
  chipActive: {
    backgroundColor: colors.tealSoft,
    borderColor: 'rgba(21,127,109,0.28)'
  },
  chipText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700'
  },
  chipTextActive: {
    color: colors.primary
  },
  animatedButtonShadow: {
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 14
  },
  tabBar: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,254,250,0.96)',
    borderColor: colors.line,
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
    backgroundColor: colors.tealSoft
  },
  tabText: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: '900'
  },
  activeTabText: {
    color: colors.ink
  },
  tournamentCard: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 18,
    borderWidth: 1,
    gap: 14,
    marginBottom: 14,
    padding: 18
  },
  tournamentCardFeatured: {
    borderColor: 'rgba(77,124,254,0.48)',
    borderWidth: 2
  },
  tournamentClubSection: {
    gap: 10
  },
  tournamentClubHeader: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,254,250,0.92)',
    borderColor: colors.line,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 15,
    paddingVertical: 12
  },
  tournamentTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  tournamentIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 12, height: 44, justifyContent: 'center', width: 44 },
  tournamentOpenPill: { backgroundColor: colors.tealSoft },
  tournamentClosedPill: { backgroundColor: '#f1f2f4' },
  tournamentPrize: { color: colors.primary, fontSize: 12, fontWeight: '900', letterSpacing: 0.8 },
  tournamentMoneyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  tournamentMoneyItem: {
    backgroundColor: colors.primarySoft,
    borderColor: 'rgba(77,124,254,0.18)',
    borderRadius: 12,
    borderWidth: 1,
    flexGrow: 1,
    gap: 4,
    minWidth: 130,
    padding: 11
  },
  tournamentMoneyItemWide: {
    flexBasis: '100%'
  },
  tournamentMoneyValue: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 18
  },
  tournamentStats: { backgroundColor: '#f6f7fb', borderRadius: 14, flexDirection: 'row', justifyContent: 'space-between', padding: 14 },
  tournamentStatValue: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  tournamentStatLabel: { color: colors.muted, fontSize: 10, fontWeight: '700', marginTop: 2 },
  tournamentStructure: { gap: 5 },
  tournamentRules: { gap: 6 },
  tournamentRule: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  tournamentConfirmation: { alignItems: 'center', backgroundColor: colors.tealSoft, borderRadius: 12, flexDirection: 'row', gap: 10, padding: 12 },
  tournamentMessage: { color: colors.primaryDark, fontSize: 12, fontWeight: '700' },
  secondaryActionButton: { alignItems: 'center', borderColor: colors.line, borderRadius: 10, borderWidth: 1, minHeight: 42, justifyContent: 'center' },
  disabledAction: { opacity: 0.45 },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(17,24,39,0.48)',
    flex: 1,
    justifyContent: 'center',
    padding: 18
  },
  seatRequestModal: {
    backgroundColor: '#ffffff',
    borderColor: colors.line,
    borderRadius: 20,
    borderWidth: 1,
    gap: 16,
    maxWidth: 540,
    padding: 20,
    width: '100%'
  },
  seatRequestHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
  seatRequestHeaderCopy: { flex: 1, gap: 5 },
  modalCloseButton: { alignItems: 'center', backgroundColor: '#f3f4f6', borderRadius: 999, height: 36, justifyContent: 'center', width: 36 },
  attendanceChoiceRow: { flexDirection: 'row', gap: 10 },
  attendanceChoice: { backgroundColor: '#f8fafc', borderColor: colors.line, borderRadius: 14, borderWidth: 1, flex: 1, gap: 5, minHeight: 108, padding: 14 },
  attendanceChoiceActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  attendanceChoiceTitle: { color: colors.ink, fontSize: 14, fontWeight: '900' },
  attendanceChoiceBody: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  attendanceChoiceTextActive: { color: '#ffffff' },
  seatTimeField: { gap: 7 },
  inputLabel: { color: colors.ink, fontSize: 12, fontWeight: '800' },
  seatTimeInput: { backgroundColor: '#ffffff', borderColor: colors.line, borderRadius: 11, borderWidth: 1, color: colors.ink, fontSize: 15, minHeight: 46, paddingHorizontal: 12 },
  timeRangeRow: { flexDirection: 'row', gap: 8 },
  timeRangeInput: { flex: 1 },
  formError: { color: '#b42318', fontSize: 12, fontWeight: '700' },
  payInPersonButton: { alignItems: 'center', backgroundColor: '#ffffff', borderColor: colors.line, borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 12, padding: 15 },
  payInPersonCopy: { flex: 1, gap: 2 },
  passTimer: { alignItems: 'center', borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 12, padding: 13 },
  passTimerActive: { backgroundColor: colors.tealSoft, borderColor: 'rgba(21,127,109,0.20)' },
  passTimerInactive: { backgroundColor: '#f4f4f1', borderColor: colors.line },
  passTimerCopy: { flex: 1, gap: 2 },
  passTimerTitle: { color: colors.ink, fontSize: 14, fontWeight: '900' },
  buyAnotherPassButton: { alignItems: 'center', backgroundColor: colors.ink, borderRadius: 11, minHeight: 42, justifyContent: 'center', paddingHorizontal: 14 },
  buyAnotherPassText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  discoveryIntro: {
    alignItems: 'flex-start',
    backgroundColor: '#ffffff',
    borderColor: colors.line,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 15
  },
  discoveryIntroCopy: { flex: 1, gap: 4 },
  discoveryKicker: { color: colors.primary, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  discoveryIntroTitle: { color: colors.ink, fontSize: 20, fontWeight: '900', lineHeight: 25 },
  discoveryIntroBody: { color: colors.muted, fontSize: 12, fontWeight: '600', lineHeight: 17 },
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
  discoveryDeckSection: { gap: 10 },
  discoveryProgressRow: { alignItems: 'center', flexDirection: 'row', gap: 9, paddingHorizontal: 4 },
  discoveryProgressText: { color: colors.ink, fontSize: 11, fontWeight: '900' },
  discoveryProgressTrack: { backgroundColor: '#e5e7eb', borderRadius: 99, flex: 1, height: 4, overflow: 'hidden' },
  discoveryProgressFill: { backgroundColor: colors.primary, borderRadius: 99, height: 4 },
  discoverySavedCount: { color: colors.primary, fontSize: 11, fontWeight: '900' },
  discoveryDeck: { height: 520, position: 'relative' },
  discoveryCard: {
    backgroundColor: '#ffffff',
    borderColor: 'rgba(15,23,42,0.10)',
    borderRadius: 26,
    borderWidth: 1,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
    position: 'absolute',
    right: 0,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.14,
    shadowRadius: 28,
    top: 0
  },
  discoveryCardTop: { zIndex: 2 },
  discoveryCardBehind: { bottom: -6, opacity: 0.42, top: 14, transform: [{ scale: 0.955 }], zIndex: 1 },
  discoveryCardHero: { height: 292, justifyContent: 'space-between', padding: 19 },
  discoveryCardHeroCompact: { height: 292 },
  discoveryCardHeroTop: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
  venueTypeBadge: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.16)', borderColor: 'rgba(255,255,255,0.20)', borderRadius: 999, borderWidth: 1, flexDirection: 'row', gap: 6, paddingHorizontal: 10, paddingVertical: 7 },
  venueTypeText: { color: '#ffffff', fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  compatibilityBadge: { alignItems: 'center', backgroundColor: '#ffffff', borderRadius: 18, minWidth: 66, paddingHorizontal: 10, paddingVertical: 8 },
  compatibilityValue: { color: colors.primaryDark, fontSize: 20, fontWeight: '900', lineHeight: 22 },
  compatibilityLabel: { color: colors.primary, fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  discoveryHeroBottom: { gap: 3 },
  liveStatusRow: { alignItems: 'center', flexDirection: 'row', gap: 6, marginBottom: 2 },
  liveDot: { backgroundColor: '#4ade80', borderRadius: 99, height: 7, width: 7 },
  liveDotWarm: { backgroundColor: '#fbbf24' },
  liveStatusText: { color: 'rgba(255,255,255,0.86)', fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  discoveryGameTitle: { color: '#ffffff', fontSize: 35, fontWeight: '900', letterSpacing: -0.9, lineHeight: 39 },
  discoveryClubName: { color: '#ffffff', fontSize: 18, fontWeight: '800' },
  discoveryLocation: { color: 'rgba(255,255,255,0.72)', fontSize: 12, fontWeight: '600' },
  discoveryCardBody: { flex: 1, gap: 11, justifyContent: 'space-between', padding: 16 },
  simpleFactsRow: { flexDirection: 'row', gap: 8 },
  simpleFact: { alignItems: 'center', backgroundColor: '#f3f4f6', borderRadius: 10, flex: 1, flexDirection: 'row', gap: 6, minHeight: 36, paddingHorizontal: 9 },
  simpleFactText: { color: colors.ink, fontSize: 11, fontWeight: '800' },
  discoveryMetrics: { flexDirection: 'row', justifyContent: 'space-between' },
  discoveryMetric: { alignItems: 'center', flex: 1, gap: 1 },
  discoveryMetricValue: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  discoveryMetricLabel: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  discoveryDivider: { backgroundColor: colors.line, height: 1 },
  discoveryAccessRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  discoveryAccessIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 11, height: 36, justifyContent: 'center', width: 36 },
  discoveryAccessCopy: { flex: 1, gap: 1 },
  discoveryAccessTitle: { color: colors.ink, fontSize: 13, fontWeight: '900' },
  discoveryTagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  discoveryTag: { backgroundColor: '#f3f4f6', borderRadius: 99, paddingHorizontal: 9, paddingVertical: 5 },
  discoveryTagText: { color: colors.ink, fontSize: 10, fontWeight: '800' },
  matchReasonBand: { alignItems: 'center', backgroundColor: '#faf5ff', borderRadius: 10, flexDirection: 'row', gap: 7, padding: 9 },
  matchReasonText: { color: '#5b21b6', flex: 1, fontSize: 10, fontWeight: '700', lineHeight: 14 },
  cardSelectionRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 'auto' },
  cardCornerAction: { alignItems: 'center', borderRadius: 999, height: 54, justifyContent: 'center', width: 54 },
  cardRejectAction: { backgroundColor: '#ffffff', borderColor: '#fecaca', borderWidth: 1.5 },
  cardPickAction: { backgroundColor: colors.primary, shadowColor: colors.primary, shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.22, shadowRadius: 12 },
  cardDetailsLink: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 999, flexDirection: 'row', gap: 4, minHeight: 38, paddingHorizontal: 14 },
  cardDetailsLinkText: { color: colors.primary, fontSize: 12, fontWeight: '900' },
  swipeFeedback: { alignItems: 'center', bottom: 0, justifyContent: 'center', left: 0, position: 'absolute', right: 0, top: 0, zIndex: 10 },
  swipeFeedbackPass: { backgroundColor: 'rgba(220,38,38,0.72)' },
  swipeFeedbackPick: { backgroundColor: 'rgba(21,127,109,0.72)' },
  swipeStamp: { borderRadius: 8, borderWidth: 3, paddingHorizontal: 11, paddingVertical: 7, position: 'absolute', top: 94, zIndex: 9 },
  swipeStampPass: { borderColor: '#ef4444', left: 24, transform: [{ rotate: '-10deg' }] },
  swipeStampPick: { borderColor: '#22c55e', right: 24, transform: [{ rotate: '10deg' }] },
  swipeStampText: { fontSize: 22, fontWeight: '900', letterSpacing: 1.4 },
  swipeStampTextPass: { color: '#ef4444' },
  swipeStampTextPick: { color: '#22c55e' },
  swipeActionRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 13 },
  swipeAction: { alignItems: 'center', borderRadius: 18, flexDirection: 'row', gap: 6, justifyContent: 'center', minHeight: 50, paddingHorizontal: 17 },
  swipePassAction: { backgroundColor: '#ffffff', borderColor: '#fecaca', borderWidth: 1 },
  swipePassText: { color: '#dc2626', fontSize: 13, fontWeight: '900' },
  swipePickAction: { backgroundColor: colors.primary, shadowColor: colors.primary, shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.22, shadowRadius: 14 },
  swipePickText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  swipeDetailsAction: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 99, height: 48, justifyContent: 'center', width: 48 },
  swipeDetailsText: { color: colors.primary, fontSize: 8, fontWeight: '900' },
  swipeHint: { color: colors.muted, fontSize: 10, fontWeight: '700', textAlign: 'center' },
  discoveryNotice: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 12, flexDirection: 'row', gap: 8, padding: 10 },
  discoveryNoticeText: { color: colors.primaryDark, flex: 1, fontSize: 11, fontWeight: '800' },
  discoveryEmpty: { alignItems: 'center', backgroundColor: '#ffffff', borderColor: colors.line, borderRadius: 22, borderWidth: 1, gap: 9, padding: 28 },
  discoveryEmptyIcon: { alignItems: 'center', backgroundColor: colors.tealSoft, borderRadius: 99, height: 58, justifyContent: 'center', width: 58 },
  discoveryEmptyTitle: { color: colors.ink, fontSize: 20, fontWeight: '900' },
  discoveryResetButton: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 11, flexDirection: 'row', gap: 7, marginTop: 5, minHeight: 42, paddingHorizontal: 15 },
  discoveryResetText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  hostPromptCard: { alignItems: 'center', backgroundColor: '#ffffff', borderColor: colors.line, borderRadius: 15, borderWidth: 1, flexDirection: 'row', gap: 10, padding: 13 },
  savedGamesSection: { gap: 8 },
  savedGamesHeader: { alignItems: 'center', backgroundColor: '#ffffff', borderColor: colors.line, borderRadius: 14, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', padding: 12 },
  savedGameRow: { alignItems: 'center', backgroundColor: '#ffffff', borderColor: colors.line, borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 10, padding: 11 },
  savedGameScore: { alignItems: 'center', backgroundColor: colors.tealSoft, borderRadius: 11, height: 44, justifyContent: 'center', width: 50 },
  savedGameScoreValue: { color: colors.teal, fontSize: 14, fontWeight: '900' },
  savedGameCopy: { flex: 1, gap: 2 },
  gameDetailsPage: { gap: 13, paddingBottom: 18 },
  gameDetailsNav: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 48 },
  gameDetailsBack: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 44, paddingRight: 12 },
  gameDetailsBackText: { color: colors.ink, fontSize: 14, fontWeight: '900' },
  gameDetailsLivePill: { alignItems: 'center', backgroundColor: '#ffffff', borderColor: colors.line, borderRadius: 999, borderWidth: 1, flexDirection: 'row', gap: 6, paddingHorizontal: 11, paddingVertical: 7 },
  gameDetailsLiveText: { color: colors.ink, fontSize: 10, fontWeight: '900', letterSpacing: 0.8, textTransform: 'uppercase' },
  gameDetailsHero: { borderRadius: 25, height: 330, justifyContent: 'space-between', overflow: 'hidden', padding: 20 },
  gameDetailsHeroTop: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
  gameDetailsScore: { alignItems: 'center', backgroundColor: '#ffffff', borderRadius: 18, minWidth: 68, paddingHorizontal: 10, paddingVertical: 8 },
  gameDetailsScoreValue: { color: colors.primaryDark, fontSize: 21, fontWeight: '900', lineHeight: 23 },
  gameDetailsHeroCopy: { gap: 4 },
  gameDetailsStatus: { color: '#bfdbfe', fontSize: 11, fontWeight: '900', letterSpacing: 0.9, textTransform: 'uppercase' },
  gameDetailsTitle: { color: '#ffffff', fontSize: 38, fontWeight: '900', letterSpacing: -1, lineHeight: 42 },
  gameDetailsClub: { color: '#ffffff', fontSize: 18, fontWeight: '800' },
  gameDetailsLocation: { color: 'rgba(255,255,255,0.72)', fontSize: 12, fontWeight: '700' },
  gameDetailsSection: { backgroundColor: '#ffffff', borderColor: colors.line, borderRadius: 17, borderWidth: 1, gap: 12, padding: 15 },
  gameDetailsSectionHeading: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  gameDetailsSectionIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 10, height: 34, justifyContent: 'center', width: 34 },
  gameDetailsSectionTitle: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  gameDetailsReason: { color: colors.muted, fontSize: 13, fontWeight: '600', lineHeight: 19 },
  gameDetailsFacts: { gap: 12 },
  discoveryDetailsSheet: { backgroundColor: '#ffffff', borderRadius: 24, maxHeight: '92%', maxWidth: 600, overflow: 'hidden', width: '100%' },
  sheetHandle: { alignSelf: 'center', backgroundColor: '#d1d5db', borderRadius: 99, height: 4, marginTop: 9, width: 44 },
  discoveryDetailsContent: { gap: 13, padding: 18, paddingTop: 12 },
  discoveryDetailsHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 11 },
  discoveryDetailsScore: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 15, minWidth: 62, padding: 9 },
  discoveryDetailsScoreValue: { color: colors.primary, fontSize: 20, fontWeight: '900' },
  discoveryDetailsTitleBlock: { flex: 1, gap: 3 },
  detailsQuickSummary: { alignItems: 'center', backgroundColor: '#f8fafc', borderRadius: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 11 },
  detailsQuickValue: { color: colors.ink, fontSize: 11, fontWeight: '800' },
  detailsQuickDivider: { color: colors.muted, fontSize: 12, fontWeight: '900' },
  detailsDisclosureGroup: { borderColor: colors.line, borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  detailsDisclosureRow: { alignItems: 'center', backgroundColor: '#ffffff', borderBottomColor: colors.line, borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 50, paddingHorizontal: 13 },
  detailsDisclosureLabel: { alignItems: 'center', flexDirection: 'row', gap: 9 },
  fitBreakdown: { backgroundColor: '#f8fafc', borderColor: colors.line, borderRadius: 14, borderWidth: 1, gap: 10, padding: 13 },
  fitBreakdownRow: { gap: 5 },
  fitBreakdownLabelRow: { flexDirection: 'row', justifyContent: 'space-between' },
  fitBreakdownLabel: { color: colors.ink, fontSize: 11, fontWeight: '800' },
  fitBreakdownValue: { color: colors.primary, fontSize: 11, fontWeight: '900' },
  fitBreakdownTrack: { backgroundColor: '#e5e7eb', borderRadius: 99, height: 5, overflow: 'hidden' },
  fitBreakdownFill: { backgroundColor: colors.primary, borderRadius: 99, height: 5 },
  detailsInfoCard: { backgroundColor: '#ffffff', borderColor: colors.line, borderRadius: 14, borderWidth: 1, gap: 10, padding: 13 },
  detailRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
  detailRowLabel: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  detailRowValue: { color: colors.ink, flex: 1, fontSize: 12, fontWeight: '800', textAlign: 'right' },
  notificationPromise: { alignItems: 'flex-start', backgroundColor: '#f5f3ff', borderColor: '#ddd6fe', borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 10, padding: 13 },
  notificationPromiseIcon: { alignItems: 'center', backgroundColor: '#ffffff', borderRadius: 10, height: 36, justifyContent: 'center', width: 36 },
  notificationPromiseCopy: { flex: 1, gap: 3 },
  storeButton: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 12, flexDirection: 'row', gap: 9, minHeight: 52, paddingHorizontal: 12 },
  storeButtonCopy: { flex: 1, gap: 1 },
  storeButtonText: { color: colors.primary, fontSize: 13, fontWeight: '900' },
  detailsActionRow: { flexDirection: 'row', gap: 9 },
  detailsSecondaryButton: { alignItems: 'center', borderColor: colors.line, borderRadius: 11, borderWidth: 1, flexDirection: 'row', gap: 6, justifyContent: 'center', minHeight: 46, paddingHorizontal: 13 },
  detailsSecondaryText: { color: colors.ink, fontSize: 12, fontWeight: '900' },
  detailsPrimaryButton: { minWidth: 184 },
  membershipWalletHeader: { alignItems: 'center', backgroundColor: '#ffffff', borderColor: colors.line, borderRadius: 16, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', padding: 15 },
  membershipWalletHeaderCopy: { flex: 1, gap: 2, paddingRight: 8 },
  walletCountBadge: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 13, minWidth: 56, padding: 9 },
  walletCountValue: { color: colors.primary, fontSize: 20, fontWeight: '900' },
  walletCountLabel: { color: colors.primary, fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  membershipApplicationStatus: { alignItems: 'center', backgroundColor: '#ffffff', borderColor: colors.line, borderRadius: 15, borderWidth: 1, flexDirection: 'row', gap: 11, padding: 14 },
  membershipApplicationStatusIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 11, height: 42, justifyContent: 'center', width: 42 },
  membershipApplicationStatusCopy: { flex: 1, gap: 3 },
  membershipWalletCard: { borderRadius: 22, gap: 15, overflow: 'hidden', padding: 17, shadowColor: '#0f172a', shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.18, shadowRadius: 28 },
  membershipWalletTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  membershipWalletBrand: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  membershipWalletMonogram: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.16)', borderColor: 'rgba(255,255,255,0.22)', borderRadius: 12, borderWidth: 1, height: 42, justifyContent: 'center', width: 42 },
  membershipWalletMonogramText: { color: '#ffffff', fontSize: 18, fontWeight: '900' },
  membershipWalletClub: { color: '#ffffff', fontSize: 15, fontWeight: '900' },
  membershipWalletPlan: { color: 'rgba(255,255,255,0.65)', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  membershipStatusBadge: { alignItems: 'center', backgroundColor: 'rgba(74,222,128,0.16)', borderRadius: 99, flexDirection: 'row', gap: 5, paddingHorizontal: 9, paddingVertical: 6 },
  membershipStatusBadgeInactive: { backgroundColor: 'rgba(251,191,36,0.16)' },
  membershipStatusDot: { backgroundColor: '#4ade80', borderRadius: 99, height: 6, width: 6 },
  membershipStatusDotInactive: { backgroundColor: '#fbbf24' },
  membershipStatusText: { color: '#ffffff', fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
  membershipIdentityRow: { flexDirection: 'row', justifyContent: 'space-between' },
  membershipIdentityLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  membershipIdentityValue: { color: '#ffffff', fontSize: 13, fontWeight: '800', marginTop: 3 },
  membershipNumberBlock: { alignItems: 'flex-end' },
  barcodeShell: { alignItems: 'center', backgroundColor: '#ffffff', borderRadius: 13, gap: 3, paddingHorizontal: 13, paddingVertical: 9 },
  barcodeBars: { alignItems: 'center', flexDirection: 'row', gap: 1, height: 46, justifyContent: 'center', overflow: 'hidden', width: '100%' },
  barcodeBar: { backgroundColor: '#0f172a' },
  barcodeValue: { color: '#334155', fontSize: 8, fontWeight: '800', letterSpacing: 2 },
  checkedInBand: { alignItems: 'center', backgroundColor: 'rgba(74,222,128,0.12)', borderRadius: 10, flexDirection: 'row', gap: 7, padding: 9 },
  checkedInText: { color: '#dcfce7', flex: 1, fontSize: 10, fontWeight: '800' },
  gameAlertCard: { alignItems: 'center', backgroundColor: '#f5f3ff', borderColor: '#ddd6fe', borderRadius: 15, borderWidth: 1, flexDirection: 'row', gap: 10, padding: 13 },
  gameAlertIcon: { alignItems: 'center', backgroundColor: '#ffffff', borderRadius: 11, height: 40, justifyContent: 'center', width: 40 },
  gameAlertCopy: { flex: 1, gap: 2 },
  alertOnPill: { alignItems: 'center', backgroundColor: '#ffffff', borderRadius: 99, flexDirection: 'row', gap: 4, paddingHorizontal: 8, paddingVertical: 5 },
  alertOnDot: { backgroundColor: '#22c55e', borderRadius: 99, height: 6, width: 6 },
  alertOnText: { color: colors.ink, fontSize: 9, fontWeight: '900' },
  clubHub: { backgroundColor: '#ffffff', borderColor: colors.line, borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  clubHubRow: { alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: 1, flexDirection: 'row', gap: 11, minHeight: 66, paddingHorizontal: 13 },
  clubHubIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 10, height: 38, justifyContent: 'center', width: 38 },
  clubHubCopy: { flex: 1, gap: 2 },
  clubHubPanel: { backgroundColor: '#f8fafc', borderBottomColor: colors.line, borderBottomWidth: 1, gap: 8, padding: 11 },
  compactGameRow: { alignItems: 'center', backgroundColor: '#ffffff', borderRadius: 11, flexDirection: 'row', minHeight: 52, paddingHorizontal: 11 },
  compactGameCopy: { flex: 1, gap: 2 },
  compactGameAction: { color: colors.primary, fontSize: 12, fontWeight: '900' },
  compactGameActionMuted: { color: colors.muted },
  membershipCompactStats: { backgroundColor: '#ffffff', borderRadius: 11, flexDirection: 'row', justifyContent: 'space-around', padding: 11 },
  compactStatValue: { color: colors.ink, fontSize: 14, fontWeight: '900', textAlign: 'center' },
  compactStatLabel: { color: colors.muted, fontSize: 9, fontWeight: '700', marginTop: 2, textAlign: 'center' },
  compactManageButton: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 10, justifyContent: 'center', minHeight: 40 },
  compactManageText: { color: colors.primary, fontSize: 12, fontWeight: '900' },
  compactEventRow: { backgroundColor: '#ffffff', borderRadius: 11, minHeight: 52, padding: 11 },
  simpleMenu: { backgroundColor: '#ffffff', borderColor: colors.line, borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  simpleMenuRow: { alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: 1, flexDirection: 'row', gap: 12, minHeight: 74, paddingHorizontal: 14 },
  simpleMenuIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 11, height: 42, justifyContent: 'center', width: 42 },
  simpleMenuCopy: { flex: 1, gap: 2 },
  merchantBand: { alignItems: 'flex-start', backgroundColor: colors.tealSoft, borderColor: 'rgba(21,127,109,0.20)', borderRadius: 13, borderWidth: 1, flexDirection: 'row', gap: 9, padding: 12 },
  merchantBandText: { color: colors.teal, flex: 1, fontSize: 12, fontWeight: '800', lineHeight: 17 }
});

