import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type DimensionValue } from 'react-native';
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
  buildWaitRequest,
  demoPlayer,
  initialClubSnapshots
} from './data/mockClubData';
import {
  fetchAllClubSnapshots,
  fetchPrivateGameListings,
  fetchPlayerProfile,
  fetchPlayerTournaments,
  createClubMembershipCheckout,
  getCurrentFirebasePlayer,
  onFirebasePlayerChanged,
  type FirebasePlayerIdentity,
  isSyncConfigured,
  savePlayerProfile,
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

type Screen = 'findGames' | 'tournaments' | 'map' | 'clubs' | 'clubSignup' | 'clubPayment' | 'history' | 'friends' | 'settings';
type OnboardingStep = 0 | 1 | 2 | 3 | 4;
type GameTypeFilter = 'none' | 'all' | 'public' | 'private' | 'card-house' | 'home-game' | 'favorites';
type DistanceFilter = 'none' | 5 | 10 | 20 | 50;
type CasinoFilter = 'none' | 'all' | string;
type TournamentFilter = 'all' | 'open' | 'free' | 'registered';

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
  { id: 'findGames', label: 'Find Games', icon: 'search-outline' },
  { id: 'tournaments', label: 'Tournaments', icon: 'trophy-outline' },
  { id: 'map', label: 'Map', icon: 'map-outline' },
  { id: 'clubs', label: 'Clubs', icon: 'business-outline' },
  { id: 'history', label: 'History', icon: 'receipt-outline' },
  { id: 'friends', label: 'Friends', icon: 'people-outline' },
  { id: 'settings', label: 'Settings', icon: 'options-outline' }
];

const demoFriends = [
  { id: 'friend-1', name: 'Sam Patel', lastSession: 'Last Friday', preferred: '1/2 NLH' },
  { id: 'friend-2', name: 'Mia Chen', lastSession: 'May 27', preferred: '1/2 PLO' },
  { id: 'friend-3', name: 'Drew King', lastSession: 'No recent session', preferred: '1/3 NLH' }
];

const orbitLaunchChampionship: PlayerTournament = {
  id: 'orbit-launch-championship-2026',
  clubId: 'lucky-lodge',
  name: 'Orbit Launch Championship',
  startsAt: '2026-08-01T18:00:00-05:00',
  registrationOpensAt: '2026-07-19T08:00:00-05:00',
  registrationClosesAt: '2026-08-01T20:00:00-05:00',
  registrationStatus: 'open',
  buyIn: 0,
  prizePoolLabel: 'Sponsor-funded launch prizes · final pool posted by staff',
  startingStack: 25000,
  levelMinutes: 15,
  lateRegistrationThroughLevel: 8,
  rebuyPrice: 20,
  rebuyStack: 25000,
  unlimitedRebuys: true,
  addOnPrice: 10,
  addOnStack: 25000,
  rules: [
    'One free initial entry per verified Orbit Player account; app registration is required.',
    'Unlimited $20 rebuys award 25,000 chips through the end of Level 8.',
    'One $10 add-on for 25,000 chips is available at the end of late registration.',
    'Staff decisions, house rules, and posted event procedures are final.'
  ],
  unregisterAllowed: true,
  entrantCount: 0,
  totalRebuys: 0,
  totalAddOns: 0,
  featured: true
};

const demoSessionHistory = [
  { id: 'session-1', date: 'Jul 12', venue: 'Club B', game: '1/2 NLH', buyIn: 300, hours: 4.5, profitLoss: 185 },
  { id: 'session-2', date: 'Jul 9', venue: 'Cedar Rail Card House', game: '2/5 NLH', buyIn: 800, hours: 3.2, profitLoss: -240 },
  { id: 'session-3', date: 'Jul 5', venue: 'Live Oak Social Club', game: '1/2 NLH', buyIn: 400, hours: 5.1, profitLoss: 96 },
  { id: 'session-4', date: 'Jun 28', venue: 'Winstar Demo Casino', game: '5/5 PLO', buyIn: 1000, hours: 2.8, profitLoss: -125 },
  { id: 'session-5', date: 'Jun 21', venue: 'Bayou Stack Room', game: '5/10 NLH', buyIn: 1500, hours: 6.4, profitLoss: 720 }
];

const gamePreferenceOptions = [
  { id: 'nlh-1-2', label: '1/2 NLH' },
  { id: 'nlh-1-3', label: '1/3 NLH' },
  { id: 'plo-1-2', label: '1/2 PLO' }
];

const clubDistanceMiles: Record<string, number> = {
  'lucky-lodge': 102,
  'river-room': 95,
  'test-club': 171,
  'club-a': 87,
  'club-b': 3.4,
  'stress-room': 98,
  'cedar-rail-dallas': 172,
  'deep-ellum-poker': 171,
  'live-oak-social': 87,
  'capital-card-room': 87,
  'bayou-stack-room': 96,
  'choctaw-demo-casino': 223,
  'winstar-demo-casino': 196
};

const clubCoordinates: Record<string, { latitude: number; longitude: number }> = {
  'lucky-lodge': { latitude: 30.2906, longitude: -97.7424 },
  'river-room': { latitude: 29.7608, longitude: -95.3608 },
  'test-club': { latitude: 32.7867, longitude: -96.7997 },
  'club-a': { latitude: 30.2679, longitude: -97.743 },
  'club-b': { latitude: 30.6205, longitude: -96.3269 },
  'stress-room': { latitude: 29.752, longitude: -95.3698 },
  'cedar-rail-dallas': { latitude: 32.7993, longitude: -96.8047 },
  'deep-ellum-poker': { latitude: 32.7841, longitude: -96.7837 },
  'live-oak-social': { latitude: 30.2649, longitude: -97.7271 },
  'capital-card-room': { latitude: 30.2711, longitude: -97.7417 },
  'bayou-stack-room': { latitude: 29.7469, longitude: -95.3674 },
  'choctaw-demo-casino': { latitude: 33.952, longitude: -96.4122 },
  'winstar-demo-casino': { latitude: 33.7913, longitude: -97.1456 }
};

const demoClubAddresses: Record<string, string> = {
  'test-club': '2711 Main Street, Dallas, TX 75226',
  'club-a': '515 Congress Avenue, Austin, TX 78701',
  'club-b': '110 N Main Street, Bryan, TX 77803',
  'stress-room': '1201 San Jacinto Street, Houston, TX 77002',
  'cedar-rail-dallas': '2828 N Harwood Street, Dallas, TX 75201',
  'deep-ellum-poker': '2600 Main Street, Dallas, TX 75226',
  'live-oak-social': '1209 E 6th Street, Austin, TX 78702',
  'capital-card-room': '907 Congress Avenue, Austin, TX 78701',
  'bayou-stack-room': '1801 Main Street, Houston, TX 77002',
  'choctaw-demo-casino': '4216 S Highway 69, Durant, OK 74701',
  'winstar-demo-casino': '777 Casino Avenue, Thackerville, OK 73459'
};

const texasMapRegion = {
  latitude: 31.75,
  longitude: -96.75,
  latitudeDelta: 5,
  longitudeDelta: 5.4
};

const findGamesClubOrder = [
  'test-club',
  'club-a',
  'club-b',
  'stress-room',
  'cedar-rail-dallas',
  'deep-ellum-poker',
  'live-oak-social',
  'capital-card-room',
  'bayou-stack-room',
  'choctaw-demo-casino',
  'winstar-demo-casino'
];
const findGamesClubNames = [
  'test club',
  'club a',
  'club b',
  'stress room',
  'cedar rail card house',
  'deep ellum poker hall',
  'live oak social club',
  'capital card room',
  'bayou stack room',
  'choctaw demo casino',
  'winstar demo casino'
];

const demoClubMembershipPrices: Record<string, { day: string; monthly: string }> = {
  'lucky-lodge': { day: '$12 day pass', monthly: '$39/mo' },
  'river-room': { day: '$15 day pass', monthly: '$49/mo' },
  'cedar-rail-dallas': { day: '$15 day pass', monthly: '$45/mo' },
  'deep-ellum-poker': { day: '$20 day pass', monthly: '$60/mo' },
  'live-oak-social': { day: '$12 day pass', monthly: '$40/mo' },
  'capital-card-room': { day: '$15 day pass', monthly: '$50/mo' },
  'bayou-stack-room': { day: '$18 day pass', monthly: '$55/mo' },
  'choctaw-demo-casino': { day: '$20 day pass', monthly: '$65/mo' },
  'winstar-demo-casino': { day: '$20 day pass', monthly: '$70/mo' },
  default: { day: '$10 day pass', monthly: '$35/mo' }
};

const clubFeeProfiles: Record<string, { type: 'time'; hourly: string } | { type: 'rake'; percent: string }> = {
  'test-club': { type: 'time', hourly: '$12/hr' },
  'club-a': { type: 'rake', percent: '5%' },
  'club-b': { type: 'time', hourly: '$10/hr' },
  'stress-room': { type: 'rake', percent: '6%' },
  'cedar-rail-dallas': { type: 'time', hourly: '$13/hr' },
  'deep-ellum-poker': { type: 'rake', percent: '5%' },
  'live-oak-social': { type: 'time', hourly: '$11/hr' },
  'capital-card-room': { type: 'rake', percent: '4%' },
  'bayou-stack-room': { type: 'time', hourly: '$14/hr' },
  'choctaw-demo-casino': { type: 'rake', percent: '5%' },
  'winstar-demo-casino': { type: 'rake', percent: '6%' }
};

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
const legacyPlayerStorageKeys = ['tabletalk-player-account-v1', 'tabletalk-player-account-v2'];
const playerStorageKey = 'orbit-player-account-v1';
const googleSignInReadyStatus = 'Connect Google or use email/password to register and sync your player profile.';
// Stripe is reserved for the social/player app's future premium tier only.
// Management-app billing must stay separate from this mobile premium surface.
const playerPremiumCheckoutUrl = process.env.EXPO_PUBLIC_PLAYER_PREMIUM_CHECKOUT_URL || '';
const premiumMonthlyPriceLabel = '$12.99/mo';
const demoPremiumEnabled = __DEV__ || process.env.EXPO_PUBLIC_DEMO_PREMIUM === 'true';

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
  const [gameTypeFilter, setGameTypeFilter] = useState<GameTypeFilter>('all');
  const [selectedFilterClubId, setSelectedFilterClubId] = useState('all');
  const [stakesFilter, setStakesFilter] = useState('');
  const [distanceFilter, setDistanceFilter] = useState<DistanceFilter>('none');
  const [fitScoreFilterEnabled, setFitScoreFilterEnabled] = useState(false);
  const [privateGameDraft, setPrivateGameDraft] = useState<PrivateGameDraft>(emptyPrivateGameDraft);
  const [privateGames, setPrivateGames] = useState<PlayerPrivateGameListing[]>([]);
  const [privateGameStatus, setPrivateGameStatus] = useState('');
  const [avatarHovered, setAvatarHovered] = useState(false);
  const [premiumStatus, setPremiumStatus] = useState<'inactive' | 'pending' | 'active'>('inactive');
  const [premiumMessage, setPremiumMessage] = useState('');
  const [clubMembershipMessage, setClubMembershipMessage] = useState('');
  const [pendingClubPlan, setPendingClubPlan] = useState<ClubMembershipPlan | null>(null);
  const [seatRequestDraft, setSeatRequestDraft] = useState<SeatRequestDraft | null>(null);
  const [seatRequestMessage, setSeatRequestMessage] = useState('');
  const [clockNow, setClockNow] = useState(Date.now());
  const [player, setPlayer] = useState<PlayerAccount>(emptyPlayer);
  const [draftPlayer, setDraftPlayer] = useState<PlayerAccount>(emptyPlayer);
  const [accountLoaded, setAccountLoaded] = useState(false);
  const [clubs, setClubs] = useState<PlayerClubSnapshot[]>(initialClubSnapshots);
  const [tournaments, setTournaments] = useState<PlayerTournament[]>([orbitLaunchChampionship]);
  const [tournamentRegistrations, setTournamentRegistrations] = useState<PlayerTournamentRegistration[]>([]);
  const [tournamentMessage, setTournamentMessage] = useState('');
  const [selectedClubId, setSelectedClubId] = useState(initialClubSnapshots[0].club.id);
  const [dismissedNotificationIds, setDismissedNotificationIds] = useState<string[]>([]);
  const [firebaseIdentity, setFirebaseIdentity] = useState<FirebasePlayerIdentity | null>(() => getCurrentFirebasePlayer());
  const [authStatus, setAuthStatus] = useState(googleSignInReadyStatus);
  const [playerAuthEmail, setPlayerAuthEmail] = useState('');
  const [playerAuthPassword, setPlayerAuthPassword] = useState('');
  const [, setSyncStatus] = useState(
    isSyncConfigured() ? 'Connecting to Firebase club sync...' : 'Demo mode - configure sync to use the live club database.'
  );

  const selectedClub = clubs.find((club) => club.club.id === selectedClubId) ?? clubs[0];
  const activeInAppNotification = useMemo(
    () => getLatestInAppNotification(clubs, dismissedNotificationIds),
    [clubs, dismissedNotificationIds]
  );
  const memberships = clubs.flatMap((club) => club.memberships.filter((membership) => isPlayerMembership(membership, player)));
  const selectedMembership = selectedClub.memberships.find((membership) => isPlayerMembership(membership, player));
  const playerWaitlists = selectedClub.waitlists.filter((entry) => isPlayerWaitlistEntry(entry, player));
  const joinedClubIds = new Set(memberships.filter((membership) => isMembershipCurrentlyActive(membership, clockNow)).map((membership) => membership.clubId));
  const membershipClubIds = new Set(memberships.map((membership) => membership.clubId));
  const favoriteClubIds = player.favoriteClubIds ?? [];
  const memberClubs = clubs.filter((club) => membershipClubIds.has(club.club.id));
  const selectedClubTournaments = tournaments.filter((tournament) => tournament.clubId === selectedClub.club.id);
  const findGameClubs = useMemo(() => buildFindGameClubs(clubs), [clubs]);
  const playerHomeCoordinate = useMemo(() => resolveAddressCoordinate(player.homeLocation), [player.homeLocation]);
  const searchRadius = distanceFilter;
  const hasPaidPlayerPremium = premiumStatus === 'active';
  const hasPlayerPremium = premiumStatus === 'active' || demoPremiumEnabled;
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
        return !query || haystack.includes(query);
      })
      .sort((left, right) => getClubDistance(left, playerHomeCoordinate) - getClubDistance(right, playerHomeCoordinate));
  }, [findGameClubs, mapQuery, playerHomeCoordinate]);
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
        setOnboardingStep(4);
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
        const clubIds = new Set(Object.entries(profile.clubMemberships ?? {}).filter(([, membership]) => membership.status === 'Active' || membership.status === 'Requested').map(([clubId]) => clubId));
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
        const mergedClubs = mergeDemoAndSyncedClubs(result.clubs);
        setClubs(mergedClubs);
        const existingMembershipClub = result.clubs.find((club) => club.memberships.some((membership) => isPlayerMembership(membership, player)));
        setSelectedClubId((current) => existingMembershipClub?.club.id ?? mergedClubs.find((club) => club.club.id === current)?.club.id ?? mergedClubs[0]?.club.id ?? initialClubSnapshots[0].club.id);
        setSyncStatus(`Showing demo data plus ${result.clubs.length} synced card house${result.clubs.length === 1 ? '' : 's'}`);
      } else {
        setSyncStatus(`Offline demo data - ${result.error}`);
      }
    };

    fetchAllClubSnapshots(player).then(handleClubSync);
    return subscribeToAllClubSnapshots(player, handleClubSync);
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
      setTournaments(mergeOrbitLaunchTournament(result.tournaments));
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
        if (fitScoreFilterEnabled && hasPaidPlayerPremium) return right.score - left.score || left.distanceMiles - right.distanceMiles;
        return right.score - left.score || left.distanceMiles - right.distanceMiles;
      });
  }, [distanceFilter, favoriteClubIds, findGameClubs, fitScoreFilterEnabled, gameQuery, gameTypeFilter, hasPaidPlayerPremium, joinedClubIds, player.homeLocation, player.preferredGameIds, playerHomeCoordinate, selectedCasinoFilter, selectedFilterClubId, stakesFilter]);

  const displayedOpportunities = useMemo(() => {
    if (hasPlayerPremium) return opportunities;
    return opportunities.slice().sort((left, right) => left.distanceMiles - right.distanceMiles || right.game.availableSeats - left.game.availableSeats);
  }, [hasPlayerPremium, opportunities]);

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
    setSyncStatus(isSyncConfigured() ? 'Account ready - syncing from Firebase...' : 'Account ready - browsing demo club data.');
    if (identity) savePlayerProfile(nextPlayer).catch(() => undefined);
  };

  const completeAccount = async () => {
    const normalizedName = draftPlayer.name.trim();
    const normalizedEmail = draftPlayer.email.trim();
    if (!normalizedName || !isValidEmail(normalizedEmail) || !isValidPhoneNumber(draftPlayer.phone ?? '', true)) return;
    finishAccount(firebaseIdentity);
  };

  const useDemoAccount = () => {
    setDraftPlayer(demoPlayer);
    setPlayer(demoPlayer);
    setHasAccount(true);
    setScreen('findGames');
  };

  const openPremiumCheckout = async () => {
    if (!playerPremiumCheckoutUrl) {
      setPremiumMessage('Stripe checkout is not configured yet. Add EXPO_PUBLIC_PLAYER_PREMIUM_CHECKOUT_URL for the player premium plan.');
      return;
    }
    setPremiumMessage('Opening Stripe checkout...');
    setPremiumStatus('pending');
    const result = await WebBrowser.openBrowserAsync(playerPremiumCheckoutUrl);
    setPremiumMessage(
      result.type === 'cancel'
        ? 'Checkout was closed before premium was confirmed.'
        : 'Checkout opened. Premium unlocks after Stripe confirms the subscription.'
    );
  };

  const openClubSignup = (club: PlayerClubSnapshot) => {
    setSelectedClubId(club.club.id);
    setPendingClubPlan(null);
    setClubMembershipMessage('');
    setScreen('clubSignup');
  };

  const openClubPayment = (club: PlayerClubSnapshot, plan: ClubMembershipPlan) => {
    setSelectedClubId(club.club.id);
    setPendingClubPlan(plan);
    setClubMembershipMessage('');
    setScreen('clubPayment');
  };

  const completeClubPayment = async (club: PlayerClubSnapshot, plan: ClubMembershipPlan) => {
    setSelectedClubId(club.club.id);
    setClubMembershipMessage('');
    const prices = getClubMembershipPrices(club);
    const planLabel = plan === 'day' ? prices.day : prices.monthly;
    if (!firebaseIdentity) {
      if (__DEV__) {
        setClubMembershipMessage(`Demo mode: activating the ${planLabel} pass now.`);
        await requestMembership(club, plan, 'app');
        setPendingClubPlan(null);
        return;
      }
      setClubMembershipMessage('Sign in before purchasing a club membership.');
      return;
    }
    try {
      setClubMembershipMessage(`Creating secure ${planLabel} checkout for ${club.club.name}...`);
      const checkout = await createClubMembershipCheckout({ clubId: club.club.id, plan, playerName: player.name });
      const result = await WebBrowser.openBrowserAsync(checkout.checkoutUrl);
      setClubMembershipMessage(
        result.type === 'cancel'
          ? 'Checkout was closed. No membership or revenue was recorded.'
          : 'Checkout completed. Waiting for Stripe to verify the payment and activate your membership.'
      );
      setPendingClubPlan(null);
    } catch (error) {
      setClubMembershipMessage(error instanceof Error ? error.message : 'Unable to start secure membership checkout.');
    }
  };

  const requestInPersonMembership = async (club: PlayerClubSnapshot, plan: ClubMembershipPlan) => {
    const prices = getClubMembershipPrices(club);
    const planLabel = plan === 'day' ? prices.day : prices.monthly;
    setClubMembershipMessage(`Sending a ${planLabel} pay-in-person request to ${club.club.name}...`);
    await requestMembership(club, plan, 'in-person');
    setPendingClubPlan(null);
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
          ? `Request sent. Pay at ${result.snapshot.club.name} to start the pass timer.`
          : `${plan === 'day' ? 'Day pass' : 'Monthly membership'} activated.`);
        setSyncStatus(`Membership updated with ${result.snapshot.club.name}`);
        return;
      }
      setSyncStatus(`Saved locally - ${result.error}`);
    }
    updateClubSnapshot(club, (snapshot) => applyMembershipRequest(snapshot, request));
    setScreen('clubs');
    setClubMembershipMessage(paymentMethod === 'in-person'
      ? `Request sent. Pay at ${club.club.name} to start the pass timer.`
      : `${plan === 'day' ? 'Day pass' : 'Monthly membership'} activated.`);
  };

  const joinWaitlist = (club: PlayerClubSnapshot, game: PlayerSyncGame) => {
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
      <StripeGate>
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
              onUseDemo={useDemoAccount}
            />
          </ScrollView>
        </SafeAreaView>
        </SafeAreaProvider>
      </StripeGate>
    );
  }

  return (
    <StripeGate>
      <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <LinearGradient colors={['#fcfcfb', '#f8f8f6', '#f4f5f2']} style={styles.appBackdrop} />
        <View style={styles.shell}>
          <View style={styles.header}>
            <View>
              <Text style={styles.eyebrow}>{screen === 'tournaments' ? `${visibleTournaments.length} upcoming events` : `${opportunities.length} games available`}</Text>
              <Text style={styles.title}>{screen === 'clubSignup' || screen === 'clubPayment' ? 'Membership' : screen === 'findGames' ? (showHostScreen ? 'Host a Game' : 'Find Games') : tabs.find((tab) => tab.id === screen)?.label}</Text>
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

          <ScrollView showsVerticalScrollIndicator={screen === 'tournaments'} contentContainerStyle={styles.content}>
            {activeInAppNotification ? (
              <InAppNotificationBanner
                notification={activeInAppNotification}
                onDismiss={() => setDismissedNotificationIds((ids) => [...ids, activeInAppNotification.id])}
              />
            ) : null}
            {screen === 'findGames' && !showHostScreen ? (
              <>
                <View style={styles.searchPanel}>
                  <View style={styles.searchInputRow}>
                    <Ionicons name="location-outline" size={18} color={colors.muted} />
                    <TextInput
                      value={player.homeLocation ?? ''}
                      onChangeText={(homeLocation) => setPlayer((current) => ({ ...current, homeLocation }))}
                      placeholder="Your address or city"
                      placeholderTextColor={colors.muted}
                      style={styles.searchInput}
                    />
                  </View>
                  <View style={styles.searchInputRow}>
                    <Ionicons name="search-outline" size={18} color={colors.muted} />
                    <TextInput
                      value={gameQuery}
                      onChangeText={setGameQuery}
                      placeholder="Filter games or stakes"
                      placeholderTextColor={colors.muted}
                      style={styles.searchInput}
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
                    premium={hasPaidPlayerPremium}
                    onLockedFitScore={openPremiumCheckout}
                  />
                  <Pressable style={styles.hostPrompt} onPress={() => setShowHostScreen(true)}>
                    <View style={styles.hostPromptIcon}>
                      <Ionicons name="home-outline" size={18} color={colors.primary} />
                    </View>
                    <View style={styles.hostPromptCopy}>
                      <Text style={styles.cardTitle}>Host your own table</Text>
                      <Text style={styles.muted}>Publish a private game for nearby players.</Text>
                    </View>
                  </Pressable>
                </View>

                {displayedOpportunities.length ? (
                  <OpportunitySectionList
                    opportunities={displayedOpportunities}
                    premium={hasPlayerPremium}
                    player={player}
                    favoriteClubIds={favoriteClubIds}
                    onSelectClub={(item) => {
                      setSelectedClubId(item.club.club.id);
                      item.isJoined ? setScreen('clubs') : openClubSignup(item.club);
                    }}
                    onDirections={(club) => openDirections(club)}
                    onWaitlist={(club, game) => joinWaitlist(club, game)}
                    onCancelWaitlist={(club, game, entry) => cancelWaitlist(club, game, entry)}
                    onJoinClub={(club) => openClubSignup(club)}
                    onToggleFavorite={(club) => toggleFavoriteClub(club.club.id)}
                  />
                ) : visiblePrivateGames.length ? null : (
                  <View style={styles.emptyState}>
                    <Text style={styles.cardTitle}>{distanceFilter === 'none' ? 'No games found' : 'No games in range'}</Text>
                    <Text style={styles.muted}>
                      {distanceFilter === 'none' ? 'No published game matches your current filters.' : `No published game matches your current filters within ${searchRadius} miles.`}
                    </Text>
                  </View>
                )}

                {visiblePrivateGames.length ? (
                  <>
                    <View style={styles.sectionHeader}>
                      <Text style={styles.sectionTitle}>Private games nearby</Text>
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
                <View style={styles.searchPanel}>
                  <View style={styles.searchInputRow}>
                    <Ionicons name="location-outline" size={18} color={colors.muted} />
                    <TextInput
                      value={player.homeLocation ?? ''}
                      onChangeText={(homeLocation) => setPlayer((current) => ({ ...current, homeLocation }))}
                      placeholder="Your address or city"
                      placeholderTextColor={colors.muted}
                      style={styles.searchInput}
                    />
                  </View>
                  <View style={styles.searchInputRow}>
                    <Ionicons name="search-outline" size={18} color={colors.muted} />
                    <TextInput
                      value={tournamentQuery}
                      onChangeText={setTournamentQuery}
                      placeholder="Search tournaments, clubs, or prizes"
                      placeholderTextColor={colors.muted}
                      style={styles.searchInput}
                    />
                  </View>
                  <View style={styles.filterPanel}>
                    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.filterChipRow}>
                      {([
                        ['all', 'All events'],
                        ['open', 'Registration open'],
                        ['free', 'Freerolls'],
                        ['registered', 'My entries']
                      ] as Array<[TournamentFilter, string]>).map(([id, label]) => (
                        <Chip key={id} label={label} active={tournamentFilter === id} onPress={() => setTournamentFilter(id)} />
                      ))}
                    </ScrollView>
                    <View style={styles.field}>
                      <Text style={styles.fieldLabel}>Club</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.filterChipRow}>
                        <Chip label="All clubs" active={tournamentClubFilter === 'all'} onPress={() => setTournamentClubFilter('all')} />
                        {clubs.map((club) => (
                          <Chip
                            key={club.club.id}
                            label={club.club.name}
                            active={tournamentClubFilter === club.club.id}
                            onPress={() => setTournamentClubFilter(club.club.id)}
                          />
                        ))}
                      </ScrollView>
                    </View>
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
                          <Pressable
                            key={option.value}
                            onPress={() => setTournamentDistanceFilter(option.value)}
                            style={[styles.distanceChip, tournamentDistanceFilter === option.value && styles.distanceChipActive]}
                          >
                            <Text style={[styles.distanceChipText, tournamentDistanceFilter === option.value && styles.distanceChipTextActive]}>{option.label}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  </View>
                </View>

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
                onDirections={openDirections}
                onShowGames={(club) => {
                  setSelectedFilterClubId(club.club.id);
                  setScreen('findGames');
                }}
              />
            ) : null}

            {screen === 'findGames' && showHostScreen ? (
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
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Your clubs</Text>
                </View>
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
                    <ClubMembershipPanel
                      club={selectedClub}
                      membership={selectedMembership}
                      nowMs={clockNow}
                      onBuyPass={() => openClubSignup(selectedClub)}
                    />
                    {selectedClub.games.map((game) => (
                      <GameCard
                        key={game.id}
                        game={game}
                        waitlistEntry={playerWaitlists.find((entry) => entry.gameId === game.id)}
                        joined={joinedClubIds.has(selectedClub.club.id)}
                        preferred={player.preferredGameIds.includes(game.id)}
                        onWaitlist={() => joinWaitlist(selectedClub, game)}
                        onCancelWaitlist={(entry) => cancelWaitlist(selectedClub, game, entry)}
                        onJoinClub={() => openClubSignup(selectedClub)}
                      />
                    ))}
                    <View style={styles.clubGamesHeader}>
                      <Text style={styles.sectionTitle}>Upcoming tournaments</Text>
                      <Text style={styles.muted}>{selectedClubTournaments.length} scheduled</Text>
                    </View>
                    {selectedClubTournaments.length ? selectedClubTournaments.map((tournament) => {
                      const registration = tournamentRegistrations.find((item) => item.tournamentId === tournament.id && item.playerId === player.id);
                      return (
                        <TournamentCard
                          key={tournament.id}
                          tournament={tournament}
                          registration={registration}
                          hasOrbitAccount={Boolean(firebaseIdentity && firebaseIdentity.uid === player.id)}
                          message={tournamentMessage}
                          onRegister={() => registerTournament(tournament)}
                          onUnregister={() => registration && unregisterTournament(tournament, registration)}
                        />
                      );
                    }) : (
                      <View style={styles.emptyState}>
                        <Text style={styles.cardTitle}>No tournaments announced</Text>
                        <Text style={styles.muted}>Upcoming events from this club will appear here.</Text>
                      </View>
                    )}
                    <ClubHistoryPanel />
                  </>
                ) : null}
              </>
            ) : null}

            {screen === 'clubSignup' && selectedClub ? (
              <ClubMembershipPlanScreen
                club={selectedClub}
                prices={getClubMembershipPrices(selectedClub)}
                message={clubMembershipMessage}
                onBack={() => setScreen('clubs')}
                onSelectPlan={(plan) => openClubPayment(selectedClub, plan)}
              />
            ) : null}

            {screen === 'clubPayment' && selectedClub && pendingClubPlan ? (
              <ClubPaymentPlaceholderScreen
                club={selectedClub}
                plan={pendingClubPlan}
                price={pendingClubPlan === 'day' ? getClubMembershipPrices(selectedClub).day : getClubMembershipPrices(selectedClub).monthly}
                message={clubMembershipMessage}
                onBack={() => setScreen('clubSignup')}
                onPayInApp={() => completeClubPayment(selectedClub, pendingClubPlan)}
                onPayInPerson={() => requestInPersonMembership(selectedClub, pendingClubPlan)}
              />
            ) : null}

            {screen === 'history' ? (
              <PlayerHistoryScreen sessions={demoSessionHistory} />
            ) : null}

            {screen === 'friends' ? (
              <View style={styles.accountCard}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Friends</Text>
                  <Ionicons name="people-outline" size={18} color={colors.muted} />
                </View>
                {demoFriends.map((friend) => (
                  <View key={friend.id} style={styles.friendRow}>
                    <View style={styles.friendAvatar}>
                      <Text style={styles.friendAvatarText}>{friend.name.slice(0, 1)}</Text>
                    </View>
                    <View style={styles.friendBody}>
                      <Text style={styles.cardTitle}>{friend.name}</Text>
                      <Text style={styles.muted}>{friend.lastSession} - {friend.preferred}</Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {screen === 'settings' ? (
              <View style={styles.accountCard}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Profile</Text>
                  <Text style={styles.muted}>{player.email}</Text>
                </View>
                <View style={styles.googleAuthPanel}>
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
                </View>
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
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.tabBar}>
            {tabs.map((tab) => (
              <Pressable
                key={tab.id}
                onPress={() => {
                  setScreen(tab.id);
                  if (tab.id !== 'findGames') setShowHostScreen(false);
                }}
                style={[styles.tab, screen === tab.id && styles.activeTab]}
              >
                <Ionicons name={tab.icon} size={19} color={screen === tab.id ? colors.ink : '#6b7280'} />
                <Text style={[styles.tabText, screen === tab.id && styles.activeTabText]}>{tab.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <SeatRequestModal
          draft={seatRequestDraft}
          message={seatRequestMessage}
          onChange={setSeatRequestDraft}
          onClose={() => setSeatRequestDraft(null)}
          onSubmit={submitSeatRequest}
        />
      </SafeAreaView>
      </SafeAreaProvider>
    </StripeGate>
  );
}

function StripeGate({ children }: { children: React.ReactElement }) {
  return <>{children}</>;
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

function mergeOrbitLaunchTournament(liveTournaments: PlayerTournament[]) {
  const liveOrbit = liveTournaments.find((tournament) => tournament.id === orbitLaunchChampionship.id);
  return liveOrbit ? liveTournaments : [orbitLaunchChampionship, ...liveTournaments];
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
  onComplete,
  onUseDemo
}: {
  draftPlayer: PlayerAccount;
  onboardingStep: OnboardingStep;
  setDraftPlayer: React.Dispatch<React.SetStateAction<PlayerAccount>>;
  setOnboardingStep: React.Dispatch<React.SetStateAction<OnboardingStep>>;
  onComplete: () => void;
  onUseDemo: () => void;
}) {
  const stepOpacity = useRef(new Animated.Value(1)).current;
  const [hoveredAction, setHoveredAction] = useState<'previous' | 'next' | null>(null);
  const finalStep = 4;
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
    if (typeof window === 'undefined') return undefined;
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
        <OnboardingProgress activeStep={onboardingStep} totalSteps={totalSteps} />
      </View>

      <Text style={styles.onboardingTitle}>Find Your Game</Text>

      <AnimatedStepCard stepKey={onboardingStep} opacity={stepOpacity}>
        {onboardingStep === 0 ? <NameStep draftPlayer={draftPlayer} setDraftPlayer={setDraftPlayer} onSubmit={canSubmit ? submitStep : undefined} /> : null}
        {onboardingStep === 1 ? <EmailStep draftPlayer={draftPlayer} setDraftPlayer={setDraftPlayer} onSubmit={canSubmit ? submitStep : undefined} /> : null}
        {onboardingStep === 2 ? <PhoneStep draftPlayer={draftPlayer} setDraftPlayer={setDraftPlayer} onSubmit={submitStep} /> : null}
        {onboardingStep === 3 ? <HomeAreaStep draftPlayer={draftPlayer} setDraftPlayer={setDraftPlayer} onSubmit={canSubmit ? submitStep : undefined} /> : null}
        {onboardingStep === 4 ? <AgeVerificationStep /> : null}
      </AnimatedStepCard>

      <View style={styles.onboardingActions}>
        <Pressable
          onHoverIn={() => setHoveredAction('previous')}
          onHoverOut={() => setHoveredAction(null)}
          onPress={onboardingStep > 0 ? previousStep : onUseDemo}
          style={styles.arrowAction}
        >
          {onboardingStep > 0 ? <Ionicons name="arrow-back" size={24} color="#ffffff" /> : <Text style={styles.demoLink}>Demo</Text>}
          {hoveredAction === 'previous' && onboardingStep > 0 ? (
            <View pointerEvents="none" style={styles.iconTooltip}>
              <Text style={styles.iconTooltipText}>Previous step</Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable
          disabled={!canSubmit}
          onHoverIn={() => setHoveredAction('next')}
          onHoverOut={() => setHoveredAction(null)}
          onPress={submitStep}
          style={[styles.arrowAction, !canSubmit && styles.arrowActionDisabled]}
        >
          <Ionicons name="arrow-forward" size={24} color="#ffffff" />
          {hoveredAction === 'next' && canSubmit ? (
            <View pointerEvents="none" style={styles.iconTooltip}>
              <Text style={styles.iconTooltipText}>{onboardingStep < finalStep ? 'Next step' : 'Finish setup'}</Text>
            </View>
          ) : null}
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
    <Field label="Name" tone="light" value={draftPlayer.name} onChangeText={(name) => setDraftPlayer((current) => ({ ...current, name }))} onSubmit={onSubmit} />
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
      tone="light"
      value={draftPlayer.homeLocation ?? ''}
      onChangeText={(homeLocation) => setDraftPlayer((current) => ({ ...current, homeLocation }))}
      onSubmit={onSubmit}
    />
  );
}

function AgeVerificationStep() {
  return (
    <View style={styles.optionalStep}>
      <StepHeader icon="id-card-outline" title="ID & Age Check" />
      <View style={styles.idCheckPlaceholder}>
        <Ionicons name="scan-outline" size={28} color="#ffffff" />
      </View>
      <Text style={styles.optionalStepText}>ID and age verification will go here.</Text>
    </View>
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

function MapExploreScreen({
  clubs,
  originCoordinate,
  query,
  setQuery,
  onDirections,
  onShowGames
}: {
  clubs: PlayerClubSnapshot[];
  originCoordinate: { latitude: number; longitude: number };
  query: string;
  setQuery: (value: string) => void;
  onDirections: (club: PlayerClubSnapshot) => void;
  onShowGames: (club: PlayerClubSnapshot) => void;
}) {
  return (
    <>
      <View style={styles.searchPanel}>
        <View style={styles.searchInputRow}>
          <Ionicons name="search-outline" size={18} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search card houses, areas, or games"
            placeholderTextColor={colors.muted}
            style={styles.searchInput}
          />
        </View>
      </View>
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
  premium,
  onLockedFitScore
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
  premium: boolean;
  onLockedFitScore: () => void;
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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipRow}>
        {typeOptions.map((option) => (
          <Chip key={option.id} label={option.label} active={gameType === option.id} onPress={() => setGameType(gameType === option.id ? 'none' : option.id)} />
        ))}
      </ScrollView>
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
        style={[styles.lockedFilterRow, fitScoreEnabled && premium && styles.lockedFilterRowActive]}
        onPress={() => {
          if (!premium) {
            onLockedFitScore();
            return;
          }
          setFitScoreEnabled(!fitScoreEnabled);
        }}
      >
        <Ionicons name={premium ? 'analytics-outline' : 'lock-closed-outline'} size={16} color={premium ? colors.teal : colors.muted} />
        <Text style={styles.lockedFilterText}>{premium ? 'Sort by fit score' : 'Fit score filter locked with Premium'}</Text>
      </Pressable>
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
        <Text style={styles.primaryButtonText}>Continue with Stripe</Text>
      </AnimatedButton>
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
  onBack,
  onSelectPlan
}: {
  club: PlayerClubSnapshot;
  prices: { day: string; monthly: string };
  message: string;
  onBack: () => void;
  onSelectPlan: (plan: ClubMembershipPlan) => void;
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
          <Text style={styles.agentKicker}>Card house access</Text>
          <Text style={styles.membershipTitle}>{club.club.name}</Text>
          <Text style={styles.muted}>Choose a demo access option. This sends your player profile to the card house and unlocks pending membership status for testing.</Text>
        </View>
      </View>

      <View style={styles.planGrid}>
        <MembershipPlanCard
          icon="today-outline"
          title="Day Pass"
          price={prices.day}
          body="Good for a quick visit, checking in, and requesting a seat today."
          onPress={() => onSelectPlan('day')}
        />
        <MembershipPlanCard
          icon="calendar-outline"
          title="Monthly Membership"
          price={prices.monthly}
          body="Best for regular players who want ongoing access to this club."
          onPress={() => onSelectPlan('monthly')}
          featured
        />
      </View>

      <View style={styles.membershipNote}>
        <Ionicons name="information-circle-outline" size={17} color={colors.primary} />
        <Text style={styles.lockedRecommendationText}>Demo prices are placeholders until each real card house connects its membership checkout.</Text>
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

function ClubPaymentPlaceholderScreen({
  club,
  plan,
  price,
  message,
  onBack,
  onPayInApp,
  onPayInPerson
}: {
  club: PlayerClubSnapshot;
  plan: ClubMembershipPlan;
  price: string;
  message: string;
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
          <Ionicons name="card-outline" size={28} color={colors.primary} />
        </View>
        <Text style={styles.membershipTitle}>Payment</Text>
        <Text style={styles.muted}>
          {club.club.name} / {plan === 'day' ? 'Day Pass' : 'Monthly Membership'} / {price}
        </Text>
      </View>
      <AnimatedButton variant="primary" onPress={onPayInApp} style={[styles.primaryButton, styles.fullWidthButton]}>
        <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
        <Text style={styles.primaryButtonText}>Pay in app</Text>
      </AnimatedButton>
      <Pressable style={styles.payInPersonButton} onPress={onPayInPerson}>
        <Ionicons name="storefront-outline" size={18} color={colors.ink} />
        <View style={styles.payInPersonCopy}>
          <Text style={styles.cardTitle}>Pay in person</Text>
          <Text style={styles.muted}>Send the request now. Your timer starts after staff marks it paid.</Text>
        </View>
      </Pressable>
      {message ? <Text style={styles.privateGameStatus}>{message}</Text> : null}
    </View>
  );
}

function PlayerHistoryScreen({ sessions }: { sessions: typeof demoSessionHistory }) {
  const totalProfitLoss = sessions.reduce((sum, session) => sum + session.profitLoss, 0);
  const totalHours = sessions.reduce((sum, session) => sum + session.hours, 0);
  const hourly = totalHours ? totalProfitLoss / totalHours : 0;
  return (
    <View style={styles.accountCard}>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>Player History</Text>
          <Text style={styles.muted}>{sessions.length} logged sessions</Text>
        </View>
        <View style={[styles.historySummaryPill, totalProfitLoss >= 0 ? styles.profitPill : styles.lossPill]}>
          <Text style={[styles.historySummaryText, totalProfitLoss >= 0 ? styles.profitText : styles.lossText]}>
            {formatCurrency(totalProfitLoss)}
          </Text>
        </View>
      </View>
      <View style={styles.historyTotals}>
        <HistoryMetric label="Hourly" value={formatHourly(hourly)} positive={hourly >= 0} />
        <HistoryMetric label="Hours" value={totalHours.toFixed(1)} />
        <HistoryMetric label="Buy-ins" value={formatCurrency(sessions.reduce((sum, session) => sum + session.buyIn, 0))} />
      </View>
      {sessions.map((session) => {
        const sessionHourly = session.hours ? session.profitLoss / session.hours : 0;
        return (
          <View key={session.id} style={styles.historyRow}>
            <View style={styles.historyDateBadge}>
              <Text style={styles.historyDateText}>{session.date}</Text>
            </View>
            <View style={styles.historyMain}>
              <Text style={styles.cardTitle}>{session.venue}</Text>
              <Text style={styles.muted}>{session.game} / Buy-in {formatCurrency(session.buyIn)} / {session.hours.toFixed(1)} hrs</Text>
              <Text style={styles.muted}>Hourly {formatHourly(sessionHourly)}</Text>
            </View>
            <Text style={[styles.historyProfitText, session.profitLoss >= 0 ? styles.profitText : styles.lossText]}>
              {formatCurrency(session.profitLoss)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function HistoryMetric({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <View style={styles.historyMetric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, positive === undefined ? null : positive ? styles.profitText : styles.lossText]}>{value}</Text>
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
      <View style={styles.planCardHeader}>
        <View style={[styles.planIcon, featured && styles.planIconFeatured]}>
          <Ionicons name={icon} size={19} color={featured ? '#ffffff' : colors.primary} />
        </View>
        {featured ? (
          <View style={styles.planBadge}>
            <Text style={styles.planBadgeText}>Popular</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.planPrice}>{price}</Text>
      <Text style={styles.muted}>{body}</Text>
      <View style={[styles.planButton, featured && styles.planButtonFeatured]}>
        <Text style={[styles.planButtonText, featured && styles.planButtonTextFeatured]}>Choose {title}</Text>
      </View>
    </Pressable>
  );
}

function formatFamiliar(value?: number) {
  const count = Number(value ?? 0);
  return count > 0 ? ` - ${count} familiar player${count === 1 ? '' : 's'}` : '';
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
  const awaitingPayment = membership.status === 'Requested' && membership.paymentMethod === 'in-person';
  return (
    <View style={styles.loyaltyCard}>
      <View style={styles.loyaltyHeader}>
        <View>
          <Text style={styles.cardTitle}>Membership</Text>
          <Text style={styles.muted}>{membership.plan === 'day' ? 'Day pass' : 'Monthly membership'} · {awaitingPayment ? 'Payment pending' : active ? 'Active' : 'Expired'}</Text>
        </View>
        <View style={styles.loyaltyBadge}>
          <Text style={styles.loyaltyBadgeText}>{membership.loyalty.tier}</Text>
        </View>
      </View>
      <Text style={styles.points}>{membership.loyalty.points.toLocaleString()} pts</Text>
      <View style={[styles.passTimer, active ? styles.passTimerActive : styles.passTimerInactive]}>
        <Ionicons name={awaitingPayment ? 'storefront-outline' : 'timer-outline'} size={18} color={active ? colors.teal : colors.ink} />
        <View style={styles.passTimerCopy}>
          <Text style={styles.passTimerTitle}>{awaitingPayment
            ? 'Pay at the club to activate'
            : active
              ? formatPassCountdown(membership.expiresAt, nowMs)
              : 'Pass expired — buy a new pass'}</Text>
          <Text style={styles.muted}>{awaitingPayment
            ? 'The pass clock starts only after club staff confirms payment.'
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
  error
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  tone?: 'light';
  keyboardType?: React.ComponentProps<typeof TextInput>['keyboardType'];
  onSubmit?: () => void;
  error?: string;
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
        placeholder={label}
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
    <AnimatedButton variant="soft" onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </AnimatedButton>
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
  const existing = new Map<string, PlayerClubSnapshot>();
  clubs.filter(isFindGamesClub).forEach((club) => {
    existing.set(findGamesClubKey(club), club);
  });
  const syncedCoreClubs = clubs
    .filter((club) => !isFindGamesClub(club))
    .sort((left, right) => left.club.name.localeCompare(right.club.name));
  return [
    ...syncedCoreClubs,
    ...findGamesClubOrder.map((clubId) => existing.get(clubId) ?? createFindGameClubFixture(clubId))
  ];
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

function createFindGameClubFixture(clubId: string): PlayerClubSnapshot {
  const names: Record<string, string> = {
    'test-club': 'Test Club',
    'club-a': 'Club A',
    'club-b': 'Club B',
    'stress-room': 'Stress Room',
    'cedar-rail-dallas': 'Cedar Rail Card House',
    'deep-ellum-poker': 'Deep Ellum Poker Hall',
    'live-oak-social': 'Live Oak Social Club',
    'capital-card-room': 'Capital Card Room',
    'bayou-stack-room': 'Bayou Stack Room',
    'choctaw-demo-casino': 'Choctaw Demo Casino',
    'winstar-demo-casino': 'Winstar Demo Casino'
  };
  const gameNames: Record<string, string[]> = {
    'test-club': ['1/2 NLH', '1/3 NLH'],
    'club-a': ['1/2 NLH', 'PLO'],
    'club-b': ['1/3 NLH', 'Tournament'],
    'stress-room': ['1/2 NLH', '2/5 NLH'],
    'cedar-rail-dallas': ['1/2 NLH', '2/5 NLH'],
    'deep-ellum-poker': ['1/3 NLH', '5/5 PLO'],
    'live-oak-social': ['1/2 NLH', '2/5 NLH'],
    'capital-card-room': ['1/3 NLH', '1/2 PLO'],
    'bayou-stack-room': ['1/2 NLH', '5/10 NLH'],
    'choctaw-demo-casino': ['1/3 NLH', '2/5 NLH'],
    'winstar-demo-casino': ['1/2 NLH', '5/5 PLO']
  };
  const games = (gameNames[clubId] ?? ['1/2 NLH']).map((name, index) => {
    const availableSeats = clubId === 'stress-room' ? 10 : Math.max(1, 6 - index * 2);
    const waitlistCount = clubId === 'stress-room' ? index : index + 1;
    return {
      id: `${clubId}-game-${index + 1}`,
      name,
      maxSeats: 10,
      availableSeats,
      waitlistCount,
      formingCount: index === 1 ? 1 : 0,
      knownPlayersCount: index,
      openTables: [
        {
          id: `${clubId}-table-${index + 1}`,
          gameId: `${clubId}-game-${index + 1}`,
          label: `Table ${index + 1}`,
          status: index === 1 ? 'Forming' as const : 'Running' as const,
          seatsFilled: Math.max(0, 10 - availableSeats),
          maxSeats: 10,
          availableSeats,
          collectionMode: index % 2 ? 'Time' as const : 'Drop' as const,
          tags: ['Demo'],
          startedAt: new Date(Date.now() - 1000 * 60 * (20 + index * 25)).toISOString(),
          social: {
            seatedPlayerCount: Math.max(0, 10 - availableSeats),
            adminCount: 1,
            knownPlayersCount: index
          }
        }
      ]
    };
  });
  return {
    club: {
      id: clubId,
      name: names[clubId] ?? clubId,
      address: demoClubAddresses[clubId] ?? `${clubId.replace(/-/g, ' ')} demo address`,
      phone: '555-0100'
    },
    games,
    memberships: [],
    waitlists: [],
    notifications: [],
    social: {
      activePlayerCount: 8 + games.length,
      adminCount: 1,
      knownPlayersInHouse: 0,
      waitlistCount: games.reduce((sum, game) => sum + game.waitlistCount, 0)
    },
    generatedAt: new Date().toISOString()
  };
}

function getClubMembershipPrices(club: PlayerClubSnapshot) {
  return demoClubMembershipPrices[club.club.id] ?? demoClubMembershipPrices.default;
}

function getClubFeeProfile(club: PlayerClubSnapshot, game?: PlayerSyncGame) {
  const configured = clubFeeProfiles[club.club.id] ?? { type: 'time' as const, hourly: '$10/hr' };
  const liveMode = game?.collectionMode ?? game?.openTables[0]?.collectionMode;
  if (liveMode === 'Time') {
    return configured.type === 'time' ? configured : { type: 'time' as const, hourly: '$10/hr' };
  }
  if (liveMode === 'Drop') {
    return { type: 'rake' as const, percent: 'club-set drop' };
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

function mergeDemoAndSyncedClubs(syncedClubs: PlayerClubSnapshot[]) {
  const demoById = new Map(initialClubSnapshots.map((snapshot) => [snapshot.club.id, snapshot]));
  const syncedIds = new Set(syncedClubs.map((snapshot) => snapshot.club.id));
  const mergedSyncedClubs = syncedClubs.map((synced) => {
    const demo = demoById.get(synced.club.id);
    if (!demo) return synced;
    return {
      ...demo,
      ...synced,
      club: { ...demo.club, ...synced.club },
      games: mergeRecordsById(demo.games, synced.games),
      memberships: mergeRecordsById(demo.memberships, synced.memberships),
      waitlists: mergeRecordsById(demo.waitlists, synced.waitlists),
      notifications: mergeRecordsById(demo.notifications ?? [], synced.notifications ?? []),
      social: { ...demo.social, ...synced.social }
    };
  });
  return [
    ...mergedSyncedClubs,
    ...initialClubSnapshots.filter((snapshot) => !syncedIds.has(snapshot.club.id))
  ];
}

function mergeRecordsById<T extends { id: string }>(demoRecords: T[], syncedRecords: T[]) {
  const records = new Map(demoRecords.map((record) => [record.id, record]));
  syncedRecords.forEach((record) => records.set(record.id, record));
  return Array.from(records.values());
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

function formatHourly(value: number) {
  return `${formatCurrency(value)}/hr`;
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
    gap: 16,
    justifyContent: 'center',
    paddingHorizontal: 2,
    position: 'absolute',
    top: 0,
    width: '100%'
  },
  onboardingBrand: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0
  },
  onboardingBrandSubtle: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0,
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
  idCheckPlaceholder: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderColor: 'rgba(255,255,255,0.24)',
    borderRadius: 16,
    borderStyle: 'dashed',
    borderWidth: 1,
    height: 112,
    justifyContent: 'center',
    width: '100%'
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
  friendRow: {
    alignItems: 'center',
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingVertical: 12
  },
  friendAvatar: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    height: 38,
    justifyContent: 'center',
    marginRight: 10,
    width: 38
  },
  friendAvatarText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '800'
  },
  friendBody: {
    flex: 1,
    gap: 2
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
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    gap: 9,
    padding: 15,
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
  historyTotals: {
    flexDirection: 'row',
    gap: 8
  },
  historyMetric: {
    backgroundColor: '#f6f6f3',
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    gap: 3,
    padding: 10
  },
  historySummaryPill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7
  },
  historySummaryText: {
    fontSize: 13,
    fontWeight: '900'
  },
  historyRow: {
    alignItems: 'center',
    borderTopColor: colors.line,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingTop: 12
  },
  historyDateBadge: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 10,
    minWidth: 52,
    paddingHorizontal: 8,
    paddingVertical: 8
  },
  historyDateText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900'
  },
  historyMain: {
    flex: 1,
    gap: 2
  },
  historyProfitText: {
    fontSize: 15,
    fontWeight: '900'
  },
  profitPill: {
    backgroundColor: colors.tealSoft
  },
  lossPill: {
    backgroundColor: '#fee2e2'
  },
  profitText: {
    color: colors.teal
  },
  lossText: {
    color: '#dc2626'
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
  buyAnotherPassText: { color: '#ffffff', fontSize: 13, fontWeight: '900' }
});

