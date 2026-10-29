import { PlayerThemeProvider, usePlayerTheme, useThemedStyles } from './styles/PlayerThemeProvider';
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { InAppNotificationPopup } from './components/InAppNotificationPopup';
import { connectionErrorCopy, FiltersBottomSheet } from './components/PlayerPresentation';
import {
  isActivePlayerGameRequest,
  isMembershipCurrentlyActive,
  isPlayerMembership,
  isPlayerWaitlistEntry,
  isTournamentInterestOpen,
  type PlayerAccount
} from './domain/playerSync';
import {
  buildFindGameClubs,
  buildGameOpportunities,
  filterMapClubs,
  filterTournaments,
  isCasinoClub,
  getVenueKind,
  getOpportunityKey
} from './domain/discovery';
import { deriveClubsViewState } from './domain/playerClubViewState';
import { getLatestInAppNotification } from './domain/playerNotifications';
import type {
  CasinoFilter,
  GameOpportunity,
  GameTypeFilter,
  MapVenueFilter,
  Screen,
  TournamentFilter
} from './domain/playerTypes';
import { isSyncConfigured } from './data/orbitSyncApi';
import { OnboardingScreen } from './features/onboarding/OnboardingScreen';
import { OrbitMatchScreen, type MatchMode } from './features/match/OrbitMatchScreen';
import { DiscoverySearchModal, GameFilterPanel, MapFilterControls } from './features/discovery/DiscoveryFilters';
import { GameDetailsScreen } from './features/discovery/DiscoveryGameDetails';
import { MyGamesSection } from './features/discovery/DiscoveryLists';
import { MapExploreScreen } from './features/discovery/MapExploreScreen';
import { discoveryStyles } from './features/discovery/discoveryStyles';
import { TournamentFilterControls, TournamentScreen } from './features/tournaments/TournamentScreen';
import { tournamentStyles } from './features/tournaments/tournamentStyles';
import { ClubMembershipPlanScreen, ClubsScreen, SeatRequestModal } from './features/clubs/ClubRoutes';
import { MembershipDetailsScreen } from './features/clubs/MembershipDetailsScreen';
import { getMembershipPalette } from './features/clubs/membershipPresentation';
import { clubStyles } from './features/clubs/clubStyles';
import { PlayerHomeScreen } from './features/home/PlayerHomeScreen';
import { IdentityVerificationScreen } from './features/settings/IdentityVerificationScreen';
import { SettingsScreen } from './features/settings/SettingsScreen';
import { sharedStyles } from './styles/sharedStyles';
import { applyDarkComponentTheme, colors } from './styles/playerTheme';
import { usePlayerStorage } from './application/usePlayerStorage';
import { usePlayerIdentity } from './application/usePlayerIdentity';
import { playerPlatform } from './app/playerPlatform';
import { usePlayerLiveData } from './application/usePlayerLiveData';
import { usePlayerTournaments } from './application/usePlayerTournaments';
import { usePlayerClubs } from './application/usePlayerClubs';
import type { PlayerSessionIdentity, PlayerSessionLiveData, PlayerSessionStorage } from './application/playerSession';
import { useDemoPlayerSession } from './demo/useDemoPlayerSession';
import { usePlayerMatch } from './application/usePlayerMatch';
import { usePlayerLocation } from './application/usePlayerLocation';
import { MatchLocationSheet } from './features/match/MatchLocationSheet';
import { matchReferenceKey, type MatchCandidate, type MatchPreferences, type MatchReference } from './domain/orbitMatchTypes';

const tabs: Array<{ id: Screen; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { id: 'home', label: 'Games', icon: 'layers-outline' },
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
  preferredGameIds: [],
  favoriteClubIds: [],
  preferredStakes: '',
  typicalAvailability: ''
};
export default function PlayerApp() {
  const [demoMode, setDemoMode] = useState(false);
  return <PlayerThemeProvider><PlayerThemeStatusBar />{demoMode
    ? <DemoPlayerSession onExitDemo={() => setDemoMode(false)} />
    : <ConnectedPlayerSession onTryDemo={() => setDemoMode(true)} />}</PlayerThemeProvider>;
}

function PlayerThemeStatusBar() {
  const { statusBarStyle } = usePlayerTheme();
  return <StatusBar style={statusBarStyle} />;
}

function ConnectedPlayerSession({ onTryDemo }: { onTryDemo: () => void }) {
  const storage = usePlayerStorage(emptyPlayer);
  const [screen, setScreen] = useState<Screen>('home');
  const [syncStatus, setSyncStatus] = useState(
    isSyncConfigured() ? 'Connecting to published venue data...' : 'Published venue sync is not configured.'
  );
  const identity = usePlayerIdentity({
    accountLoaded: storage.accountLoaded,
    clearLocalPlayer: storage.clearLocalPlayer,
    draftPlayer: storage.draftPlayer,
    platform: playerPlatform,
    player: storage.player,
    setDraftPlayer: storage.setDraftPlayer,
    setHasAccount: storage.setHasAccount,
    setOnboardingStep: storage.setOnboardingStep,
    setPlayer: storage.setPlayer,
    setScreen,
    setSyncStatus
  });
  const liveData = usePlayerLiveData({
    accountLoaded: storage.accountLoaded && identity.authLoaded,
    firebaseIdentity: identity.firebaseIdentity,
    hasAccount: storage.hasAccount,
    platform: playerPlatform,
    player: storage.player,
    profileSyncPaused: identity.profileSyncPaused,
    setDraftPlayer: storage.setDraftPlayer,
    setPlayer: storage.setPlayer,
    setScreen,
    setSyncStatus
  });
  return <PlayerExperience storage={storage} identity={identity} liveData={liveData}
    screen={screen} setScreen={setScreen} syncStatus={syncStatus} setSyncStatus={setSyncStatus} onTryDemo={onTryDemo} />;
}

function DemoPlayerSession({ onExitDemo }: { onExitDemo: () => void }) {
  const { storage, liveData } = useDemoPlayerSession();
  const [screen, setScreen] = useState<Screen>('home');
  const [syncStatus, setSyncStatus] = useState('Sample account ready. All venues and games are fictional.');
  const [experienceVersion, setExperienceVersion] = useState(0);
  const resetDemo = () => {
    liveData.retryLiveData();
    setScreen('home');
    setSyncStatus('Sample games restored. All venues and games are fictional.');
    setExperienceVersion((current) => current + 1);
  };
  return <PlayerExperience key={experienceVersion} storage={storage} identity={null} liveData={liveData}
    screen={screen} setScreen={setScreen} syncStatus={syncStatus} setSyncStatus={setSyncStatus}
    onExitDemo={onExitDemo} onResetDemo={resetDemo} />;
}

function PlayerExperience({ storage, identity, liveData, screen, setScreen, syncStatus, setSyncStatus, onTryDemo, onExitDemo, onResetDemo }: {
  storage: PlayerSessionStorage;
  identity: PlayerSessionIdentity | null;
  liveData: PlayerSessionLiveData;
  screen: Screen;
  setScreen: Dispatch<SetStateAction<Screen>>;
  syncStatus: string;
  setSyncStatus: Dispatch<SetStateAction<string>>;
  onTryDemo?: () => void;
  onExitDemo?: () => void;
  onResetDemo?: () => void;
}) {
  const styles = useThemedStyles(baseStyles);
  const { colors, scheme } = usePlayerTheme();
  const membershipSurface = screen === 'clubs' || screen === 'membershipDetails';
  const membershipPalette = getMembershipPalette(scheme);
  const demoMode = identity === null;
  const authLoaded = identity?.authLoaded ?? true;
  const authInitializationError = identity?.authInitializationError ?? '';
  const firebaseIdentity = identity?.firebaseIdentity ?? null;
  const requireVerifiedAge: PlayerSessionIdentity['requireVerifiedAge'] = identity?.requireVerifiedAge ?? (() => false);
  const {
    accountLoaded,
    dismissedAlertsLoaded,
    dismissedNotificationIds,
    dismissInAppAlert,
    draftPlayer,
    hasAccount,
    onboardingStep,
    player,
    playerStorageError,
    retryPlayerStorage,
    setDraftPlayer,
    setOnboardingStep,
    setPlayer
  } = storage;
  const [gameQuery, setGameQuery] = useState('');
  const [tournamentQuery, setTournamentQuery] = useState('');
  const [tournamentFilter, setTournamentFilter] = useState<TournamentFilter>('all');
  const [tournamentClubFilter, setTournamentClubFilter] = useState('all');
  const [selectedCasinoFilter, setSelectedCasinoFilter] = useState<CasinoFilter>('all');
  const [mapQuery, setMapQuery] = useState('');
  const [mapVenueFilter, setMapVenueFilter] = useState<MapVenueFilter>('all');
  const [gameTypeFilter, setGameTypeFilter] = useState<GameTypeFilter>('all');
  const [selectedFilterClubId, setSelectedFilterClubId] = useState('all');
  const [stakesFilter, setStakesFilter] = useState('');
  const [fitScoreFilterEnabled, setFitScoreFilterEnabled] = useState(false);
  const [showDiscoveryFilters, setShowDiscoveryFilters] = useState(false);
  const [showDiscoverySearch, setShowDiscoverySearch] = useState(false);
  const [showTournamentFilters, setShowTournamentFilters] = useState(false);
  const [showMapFilters, setShowMapFilters] = useState(false);
  const [showMatchLocation, setShowMatchLocation] = useState(false);
  const [matchMode, setMatchMode] = useState<MatchMode>('discover');
  const [onboardingMatchPreferences, setOnboardingMatchPreferences] = useState(false);
  useEffect(() => {
    if (!hasAccount || !onboardingMatchPreferences) return;
    setOnboardingMatchPreferences(false);
    setMatchMode('preferences');
    setScreen('findGames');
  }, [hasAccount, onboardingMatchPreferences, setScreen]);
  const [selectedDiscoveryOpportunity, setSelectedDiscoveryOpportunity] = useState<GameOpportunity | null>(null);
  const [gameDetailsReturnScreen, setGameDetailsReturnScreen] = useState<'home' | 'findGames'>('findGames');
  const [demoActionMessage, setDemoActionMessage] = useState('');
  const mainScrollRef = useRef<ScrollViewInstance>(null);
  const [contentHeight, setContentHeight] = useState(0);
  const matchDetailsRef = useRef<MatchReference | null>(null);
  const {
    clockNow,
    clubMembershipMessage,
    clubSelectionNotice,
    clubs,
    liveDataPartial,
    liveDataStatus,
    profileEditingReady,
    profileSyncNotice,
    retryLiveData,
    selectedClubId,
    setClubMembershipMessage,
    setClubSelectionNotice,
    setClubs,
    setSelectedClubId,
    setTournamentInterests,
    tournamentInterests,
    tournamentDataStatus,
    tournamentDataPartial,
    tournamentLoadError,
    tournaments
  } = liveData;
  const tournamentInventoryStatus = liveDataStatus === 'ready' ? tournamentDataStatus : liveDataStatus;
  const tournamentInventoryPartial = liveDataPartial || tournamentDataPartial;
  const retryPlayerPersistence = () => {
    retryPlayerStorage();
    retryLiveData();
  };
  const {
    cancelWaitlist: cancelLiveWaitlist,
    clubActionPending,
    gameRequestMessage,
    joinWaitlist: joinLiveWaitlist,
    openClubSignup: openLiveClubSignup,
    openDirections: openLiveDirections,
    seatRequestDraft,
    seatRequestMessage,
    setSeatRequestDraft,
    setSeatRequestMessage,
    submitMembershipApplication: submitLiveMembershipApplication,
    submitSeatRequest: submitLiveSeatRequest
  } = usePlayerClubs({
    actionsReady: !demoMode && liveDataStatus === 'ready',
    clockNow,
    clubs,
    platform: playerPlatform,
    player,
    requireVerifiedAge,
    setClubMembershipMessage,
    setClubs,
    setScreen,
    setSelectedClubId,
    setSyncStatus,
    onSeatRequestSuccess: ({ clubId, gameId, matchAttribution: attribution }) => {
      if (!attribution || attribution.uid !== player.id
        || Date.now() - attribution.initiatedAt > 10 * 60_000) return;
      void match.controller.current?.recordEvent({ kind: 'waitlist-success', ref: { clubId, gameId, kind: 'cash' }, saveMutationId: attribution.saveMutationId });
    }
  });
  const { expressInterest: expressLiveInterest, pendingTournamentKeys, tournamentMessage, withdrawInterest: withdrawLiveInterest,
    registerTournament: registerLiveTournament, tournamentRegistrations } = usePlayerTournaments({
    firebaseIdentity,
    getClubMinimumAge: (clubId) => clubs.find((club) => club.club.id === clubId)?.club.minimumAge === 18 ? 18 : 21,
    player,
    requireVerifiedAge,
    setTournamentInterests,
    tournaments
  });

  // Demo inventory is for exploration. Never pass fictional IDs to live actions,
  // even if a real Firebase session is still saved on the device.
  const showDemoActionNotice = () => setDemoActionMessage('These venues and games are fictional. Use a real account for venue requests, check-in, and directions.');
  const joinWaitlist: typeof joinLiveWaitlist = (...args) => demoMode ? showDemoActionNotice() : joinLiveWaitlist(...args);
  const openClubSignup: typeof openLiveClubSignup = (...args) => demoMode ? showDemoActionNotice() : openLiveClubSignup(...args);
  const openDirections: typeof openLiveDirections = (...args) => demoMode ? showDemoActionNotice() : openLiveDirections(...args);
  const cancelWaitlist: typeof cancelLiveWaitlist = async (...args) => demoMode ? showDemoActionNotice() : cancelLiveWaitlist(...args);
  const submitMembershipApplication: typeof submitLiveMembershipApplication = async (...args) => demoMode ? showDemoActionNotice() : submitLiveMembershipApplication(...args);
  const submitSeatRequest: typeof submitLiveSeatRequest = async () => demoMode ? showDemoActionNotice() : submitLiveSeatRequest();
  const expressInterest: typeof expressLiveInterest = async (...args) => demoMode ? showDemoActionNotice() : expressLiveInterest(...args);
  const withdrawInterest: typeof withdrawLiveInterest = async (...args) => demoMode ? showDemoActionNotice() : withdrawLiveInterest(...args);
  const registerTournament: typeof registerLiveTournament = async (tournament) => {
    if (demoMode) { showDemoActionNotice(); return; }
    if (tournamentInventoryStatus !== 'ready') return;
    await registerLiveTournament(tournament);
  };

  const selectedClub = clubs.find((club) => club.club.id === selectedClubId);
  const activeInAppNotification = useMemo(
    () => dismissedAlertsLoaded ? getLatestInAppNotification(clubs, dismissedNotificationIds) : null,
    [clubs, dismissedAlertsLoaded, dismissedNotificationIds]
  );
  const memberships = useMemo(() => clubs.flatMap((club) => club.memberships.filter((membership) => isPlayerMembership(membership, player))), [clubs, player]);
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
  const joinedClubIds = useMemo(() => new Set(memberships.filter((membership) => isMembershipCurrentlyActive(membership, clockNow)).map((membership) => membership.clubId)), [memberships, clockNow]);
  const membershipClubIds = useMemo(() => new Set(memberships.map((membership) => membership.clubId)), [memberships]);
  const favoriteClubIds = player.favoriteClubIds ?? [];
  const memberClubs = clubs.filter((club) => membershipClubIds.has(club.club.id) || club.timeAccess?.linked);
  const selectedMemberClub = memberClubs.find((club) => club.club.id === selectedClubId);
  const clubsViewState = deriveClubsViewState(liveDataStatus, memberClubs, selectedMemberClub, liveDataPartial, clubSelectionNotice);
  const selectedMembership = selectedMemberClub?.memberships.find((membership) => isPlayerMembership(membership, player));
  const playerWaitlists = selectedMemberClub?.waitlists.filter((entry) => isPlayerWaitlistEntry(entry, player)) ?? [];
  const selectedClubTournaments = selectedMemberClub ? tournaments.filter((tournament) => tournament.clubId === selectedMemberClub.club.id) : [];
  const findGameClubs = useMemo(() => buildFindGameClubs(clubs), [clubs]);
  const location = usePlayerLocation({ owner: `${demoMode ? 'demo' : firebaseIdentity?.uid === player.id ? 'account' : 'device'}:${player.id}`,
    demoMode, enabled: accountLoaded && authLoaded && hasAccount });
  const playerHomeCoordinate = location.origin;
  const mappedClubs = useMemo(
    () => filterMapClubs(findGameClubs, '', 'none', mapVenueFilter, playerHomeCoordinate),
    [findGameClubs, mapVenueFilter, playerHomeCoordinate]
  );
  const visibleTournaments = useMemo(
    () => filterTournaments({
      clubs,
      originCoordinate: playerHomeCoordinate,
      playerId: player.id,
      query: tournamentQuery,
      interests: tournamentInterests,
      nowMs: clockNow,
      tournamentClubFilter,
      tournamentDistanceFilter: 'none',
      tournamentFilter,
      tournaments
    }),
    [clockNow, clubs, player.id, playerHomeCoordinate, tournamentClubFilter, tournamentFilter, tournamentQuery, tournamentInterests, tournaments]
  );

  useEffect(() => {
    if (hasAccount) return;
    setScreen('home');
    setGameQuery('');
    setTournamentQuery('');
    setTournamentFilter('all');
    setTournamentClubFilter('all');
    setSelectedCasinoFilter('all');
    setMapQuery('');
    setMapVenueFilter('all');
    setGameTypeFilter('all');
    setSelectedFilterClubId('all');
    setStakesFilter('');
    setFitScoreFilterEnabled(false);
    setSelectedDiscoveryOpportunity(null);
    setSeatRequestDraft(null);
    setSeatRequestMessage('');
    setClubMembershipMessage('');
    setClubSelectionNotice('');
    setSelectedClubId('');
  }, [hasAccount]);

  useEffect(() => {
    mainScrollRef.current?.scrollTo({ y: 0, animated: false });
    setDemoActionMessage('');
    setShowDiscoverySearch(false);
    setShowDiscoveryFilters(false);
    setShowTournamentFilters(false);
    setShowMapFilters(false);
    setShowMatchLocation(false);
    setSeatRequestDraft(null);
    setSeatRequestMessage('');
    if (screen !== 'gameDetails') setSelectedDiscoveryOpportunity(null);
  }, [screen]);

  const opportunities = useMemo(
    () => buildGameOpportunities({
      activePlayerGameKeys,
      distanceFilter: 'none',
      favoriteClubIds,
      findGameClubs,
      fitScoreFilterEnabled,
      gameQuery,
      gameTypeFilter: gameTypeFilter === 'favorites' ? 'all' : gameTypeFilter,
      joinedClubIds,
      nowMs: clockNow,
      player,
      playerHomeCoordinate,
      selectedCasinoFilter,
      selectedFilterClubId,
      stakesFilter
    }),
    [activePlayerGameKeys, clockNow, favoriteClubIds, findGameClubs, fitScoreFilterEnabled, gameQuery, gameTypeFilter, joinedClubIds, player, playerHomeCoordinate, selectedCasinoFilter, selectedFilterClubId, stakesFilter]
  );

  const broadOpportunities = useMemo(
    () => buildGameOpportunities({
      activePlayerGameKeys,
      distanceFilter: 'none',
      favoriteClubIds,
      findGameClubs,
      fitScoreFilterEnabled: false,
      gameQuery: '',
      gameTypeFilter: 'all',
      joinedClubIds,
      nowMs: clockNow,
      player,
      playerHomeCoordinate,
      selectedCasinoFilter: 'all',
      selectedFilterClubId: 'all',
      stakesFilter: ''
    }),
    [activePlayerGameKeys, clockNow, favoriteClubIds, findGameClubs, joinedClubIds, player, playerHomeCoordinate]
  );
  const filteredGameKeys = useMemo(() => new Set(opportunities.map((item) => matchReferenceKey({ clubId: item.club.club.id, gameId: item.game.id, kind: 'cash' }))), [opportunities]);
  const matchFilter = useCallback((candidate: MatchCandidate, preferences: MatchPreferences) => {
    if (gameTypeFilter === 'favorites' && !preferences.favoriteClubIds.includes(candidate.ref.clubId)) return false;
    if (candidate.ref.kind === 'cash') return filteredGameKeys.has(matchReferenceKey(candidate.ref));
    const club = findGameClubs.find((item) => item.club.id === candidate.ref.clubId);
    if (!club) return false;
    if (gameTypeFilter === 'card-house' && getVenueKind(club) !== 'Card house') return false;
    const filter = isCasinoClub(club) ? selectedCasinoFilter : selectedFilterClubId;
    if (filter === 'none' || filter !== 'all' && filter !== candidate.ref.clubId) return false;
    return !gameQuery.trim() || `${candidate.summary.gameName} ${candidate.summary.venueName}`.toLowerCase().includes(gameQuery.trim().toLowerCase());
  }, [filteredGameKeys, gameQuery, gameTypeFilter, findGameClubs, selectedFilterClubId, selectedCasinoFilter]);
  const match = usePlayerMatch({ player, authenticatedUid: firebaseIdentity?.uid ?? null, demoMode,
    enabled: accountLoaded && authLoaded && hasAccount, clubs, tournaments, activeGameKeys: activePlayerGameKeys,
    origin: playerHomeCoordinate, nowMs: clockNow, inventoryStatus: liveDataStatus, inventoryPartial: liveDataPartial,
    tournamentDataStatus, tournamentDataPartial,
    candidateFilter: matchFilter });
  const activeDiscoveryCandidate = selectedDiscoveryOpportunity
    ? match.catalog.find((candidate) => candidate.ref.kind === 'cash' && candidate.ref.clubId === selectedDiscoveryOpportunity.club.club.id && candidate.ref.gameId === selectedDiscoveryOpportunity.game.id)
    : null;
  const activeDiscoveryOpportunity = activeDiscoveryCandidate?.status !== 'inactive' ? activeDiscoveryCandidate?.opportunity ?? null : null;

  useEffect(() => {
    if (screen === 'clubSignup' && !selectedClub) setScreen('clubs');
  }, [screen, selectedClub]);

  const openDiscoveryGame = (item: GameOpportunity) => {
    matchDetailsRef.current = null;
    setSelectedDiscoveryOpportunity(item);
    setGameDetailsReturnScreen(screen === 'home' ? 'home' : 'findGames');
    setScreen('gameDetails');
  };

  const closeDiscoveryGame = () => {
    matchDetailsRef.current = null;
    setSelectedDiscoveryOpportunity(null);
    setScreen(gameDetailsReturnScreen);
  };

  const openMatchDetails = (candidate: MatchCandidate, source: 'deck' | 'saved') => {
    void match.controller.current?.recordEvent({ kind: source === 'saved' ? 'saved-revisit' : 'details', ref: candidate.ref });
    if (candidate.opportunity) {
      openDiscoveryGame(candidate.opportunity);
      matchDetailsRef.current = candidate.ref;
    }
    else if (candidate.tournament) {
      setTournamentFilter('all');
      setTournamentClubFilter(candidate.ref.clubId);
      setTournamentQuery(candidate.tournament.name);
      setScreen('tournaments');
    }
  };

  useEffect(() => {
    if (screen !== 'findGames' || !match.ready) return;
    void match.controller.current?.recordEvent({ kind: 'opened' });
    if (matchMode !== 'discover') return;
    const candidate = match.ranked[0];
    if (match.discoveryStatus === 'ready') {
      if (candidate) void match.controller.current?.recordEvent({ kind: 'impression', ref: candidate.ref });
      else if (!match.discoveryPartial) void match.controller.current?.recordEvent({ kind: 'empty' });
    }
    if (match.discoveryStatus === 'error' || match.state.preferences.format !== 'cash' && tournamentDataStatus === 'error') {
      void match.controller.current?.recordEvent({ kind: 'load-failed' });
    }
  }, [screen, matchMode, match.ready, match.ranked[0]?.ref.clubId, match.ranked[0]?.ref.gameId, match.ranked[0]?.ref.kind, match.discoveryStatus, match.discoveryPartial, match.state.preferences.format, tournamentDataStatus]);

  useEffect(() => {
    if (screen !== 'gameDetails' && screen !== 'findGames' && screen !== 'membershipDetails') return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === 'membershipDetails') {
        setScreen('clubs');
      } else if (screen === 'gameDetails') {
        setSelectedDiscoveryOpportunity(null);
        setScreen(gameDetailsReturnScreen);
      } else {
        setScreen('home');
      }
      return true;
    });
    return () => subscription.remove();
  }, [gameDetailsReturnScreen, screen]);

  const clearDiscoveryFilters = () => {
    setGameQuery('');
    setGameTypeFilter('all');
    setSelectedFilterClubId('all');
    setSelectedCasinoFilter('all');
    setStakesFilter('');
    setFitScoreFilterEnabled(false);
  };

  if (!accountLoaded || !authLoaded) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.safeArea}>
          <View accessibilityLabel="Loading Orbit Player" accessibilityRole="progressbar" style={[styles.content, { gap: 14, paddingTop: 36 }]}>
            <View style={[styles.emptyState, { minHeight: 94 }]} />
            <View style={[styles.emptyState, { minHeight: 180 }]} />
            <Text style={styles.muted}>Restoring your Orbit Player account and secure sign-in...</Text>
          </View>
          <View style={styles.content}><DemoEntryButton onPress={onTryDemo} /></View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  if (authInitializationError) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.safeArea}>
          <View accessibilityRole="alert" style={[styles.content, styles.emptyState]}>
            <Text style={styles.cardTitle}>Secure sign-in needs attention</Text>
            <Text style={styles.muted}>{authInitializationError}</Text>
            <Pressable accessibilityRole="button" onPress={identity?.retryAuthInitialization} style={styles.compactButton}>
              <Text style={styles.compactButtonText}>Retry secure sign-in cleanup</Text>
            </Pressable>
            <DemoEntryButton onPress={onTryDemo} />
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  if (playerStorageError && !hasAccount) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.safeArea}>
          <View accessibilityRole="alert" style={[styles.content, styles.emptyState]}>
            <Text style={styles.cardTitle}>Saved profile data is unavailable</Text>
            <Text style={styles.muted}>{playerStorageError}</Text>
            <Pressable accessibilityRole="button" onPress={retryPlayerStorage} style={styles.compactButton}>
              <Text style={styles.compactButtonText}>Retry saved profile</Text>
            </Pressable>
            <DemoEntryButton onPress={onTryDemo} />
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  if (!hasAccount) {
    return (
      <OnboardingScreen
        draftPlayer={draftPlayer}
        onboardingStep={onboardingStep}
        setDraftPlayer={setDraftPlayer}
        setOnboardingStep={setOnboardingStep}
        onComplete={() => { setOnboardingMatchPreferences(false); void identity?.completeAccount(); }}
        onCompleteWithMatchPreferences={() => { setOnboardingMatchPreferences(true); void identity?.completeAccount(); }}
        onTryDemo={onTryDemo}
        accountConnection={identity ? {
          connected: Boolean(identity.firebaseIdentity),
          email: identity.playerAuthEmail,
          password: identity.playerAuthPassword,
          status: identity.authStatus,
          busy: identity.profileSyncPaused,
          onChangeEmail: identity.setPlayerAuthEmail,
          onChangePassword: identity.setPlayerAuthPassword,
          onConnect: (profile, withMatchPreferences, intent) => {
            setOnboardingMatchPreferences(Boolean(withMatchPreferences));
            void identity.connectPlayerAccount(profile, intent === 'signIn');
          },
          onRecover: identity.recoverPlayerAccount
        } : undefined}
      />
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.safeArea, membershipSurface && { backgroundColor: membershipPalette.canvas }]}>
        <View style={styles.shell}>
          {screen !== 'gameDetails' && screen !== 'findGames' ? (
            <View style={styles.header}>
              <Text accessibilityRole="header" style={[styles.title, membershipSurface && { color: membershipPalette.ink }]}>{screen === 'clubSignup' ? 'Membership request' : getScreenTitle(screen)}</Text>
              <Pressable
                accessibilityLabel="Open settings"
                accessibilityRole="button"
                style={[styles.avatar, membershipSurface && { backgroundColor: membershipPalette.panel, borderColor: membershipPalette.line }]}
                onPress={() => setScreen('settings')}
              >
                <Text style={[styles.avatarText, membershipSurface && { color: membershipPalette.accent }]}>{player.name.slice(0, 1)}</Text>
              </Pressable>
            </View>
          ) : null}

          {demoMode ? (
            <View accessibilityLabel="Sample account" style={styles.demoBar}>
              <Ionicons name="play-circle-outline" size={16} color={colors.muted} />
              <Text style={styles.demoLabel}>Sample · fictional venues</Text>
            </View>
          ) : null}
          {demoActionMessage ? (
            <View accessibilityRole="alert" style={styles.demoNotice}>
              <Text style={[styles.muted, { flex: 1 }]}>{demoActionMessage}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Dismiss sample notice" onPress={() => setDemoActionMessage('')} style={styles.demoOptions}>
                <Ionicons name="close" size={20} color={colors.muted} />
              </Pressable>
            </View>
          ) : null}
          <ScrollView ref={mainScrollRef} style={styles.mainScroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
            onLayout={(event) => setContentHeight(event.nativeEvent.layout.height)}
            showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, screen === 'findGames' && styles.matchContent]}>
            {playerStorageError || profileSyncNotice ? (
              <View accessibilityRole="alert" style={styles.emptyState}>
                <Text style={styles.cardTitle}>Profile changes need attention</Text>
                <Text style={styles.muted}>{playerStorageError || profileSyncNotice}</Text>
                <Pressable accessibilityRole="button" onPress={retryPlayerPersistence} style={styles.compactButton}>
                  <Text style={styles.compactButtonText}>Retry profile save</Text>
                </Pressable>
              </View>
            ) : null}
            {screen === 'home' ? (
              <PlayerHomeScreen
                opportunities={broadOpportunities}
                inventoryPartial={liveDataPartial}
                inventoryStatus={liveDataStatus}
                openTournamentCount={tournamentInventoryStatus === 'ready' && !tournamentInventoryPartial ? visibleTournaments.filter(({ tournament }) => isTournamentInterestOpen(tournament, clockNow)).length : null}
                clubCount={memberClubs.length}
                onFindGame={() => { setMatchMode('discover'); setScreen('findGames'); }}
                onOpenGame={openDiscoveryGame}
                onBrowseTournaments={() => setScreen('tournaments')}
                onBrowseClubs={() => setScreen('clubs')}
              />
            ) : null}
            {screen !== 'home' && liveDataStatus === 'loading' && !clubs.length ? (
              <View accessibilityLabel="Loading published venues" accessibilityRole="progressbar" style={[styles.emptyState, { minHeight: 132 }]}>
                <Text style={styles.cardTitle}>Loading published venues...</Text>
                <Text style={styles.muted}>Your saved account remains available while Orbit reconnects.</Text>
              </View>
            ) : null}
            {liveDataStatus === 'error' ? (
              <View accessibilityRole="alert" style={styles.emptyState}>
                <Text style={styles.cardTitle}>Published venue data is unavailable</Text>
                <Text style={styles.muted}>{connectionErrorCopy(syncStatus, 'published games')}</Text>
                <Pressable accessibilityRole="button" onPress={retryLiveData} style={styles.compactButton}>
                  <Text style={styles.compactButtonText}>Retry published data</Text>
                </Pressable>
                <DemoEntryButton onPress={onTryDemo} />
              </View>
            ) : null}
            {liveDataStatus !== 'error' && tournamentLoadError ? (
              <View accessibilityRole="alert" style={styles.emptyState}>
                <Text style={styles.cardTitle}>Some published data could not be refreshed</Text>
                <Text style={styles.muted}>{connectionErrorCopy(tournamentLoadError, 'published games')}</Text>
                <Pressable accessibilityRole="button" onPress={retryLiveData} style={styles.compactButton}>
                  <Text style={styles.compactButtonText}>Retry published data</Text>
                </Pressable>
              </View>
            ) : null}
            {screen === 'gameDetails' && selectedDiscoveryOpportunity ? (
              <GameDetailsScreen
                key={getOpportunityKey(selectedDiscoveryOpportunity)}
                item={activeDiscoveryOpportunity}
                player={player}
                backLabel={gameDetailsReturnScreen === 'home' ? 'Games' : 'Matches'}
                activeRequest={Boolean(activeDiscoveryCandidate?.activeRequest)}
                onViewRequest={() => setScreen('findGames')}
                onBack={closeDiscoveryGame}
                onDirections={() => {
                  if (activeDiscoveryOpportunity) openDirections(activeDiscoveryOpportunity.club);
                }}
                onJoin={() => {
                  const item = activeDiscoveryOpportunity;
                  if (item) {
                    const ref = matchDetailsRef.current;
                    const saved = ref ? match.state.decisions.find((record) => record.decision === 'saved' && matchReferenceKey(record.ref) === matchReferenceKey(ref)) : undefined;
                    const attribution = !demoMode && saved && !activeDiscoveryCandidate?.activeRequest
                      ? { uid: player.id, saveMutationId: saved.mutationId, initiatedAt: Date.now() } : undefined;
                    joinWaitlist(item.club, item.game, attribution);
                  }
                }}
                onRefresh={retryLiveData}
                readOnly={liveDataStatus !== 'ready'}
                onViewStore={() => {
                  if (activeDiscoveryOpportunity) openClubSignup(activeDiscoveryOpportunity.club);
                }}
              />
            ) : null}
            {screen === 'identityVerification' && identity ? (
              <IdentityVerificationScreen
                status={identity.identityStatus}
                signedIn={Boolean(firebaseIdentity)}
                busy={identity.identityBusy}
                message={identity.identityMessage}
                requiredMinimumAge={identity.identityRequiredMinimumAge}
                onBack={() => setScreen(identity.identityReturnScreen)}
                onOpenSettings={playerPlatform.openAppSettings}
                onSignIn={() => setScreen('settings')}
                onStart={identity.startIdentityVerification}
                onRefresh={identity.refreshIdentityVerification}
              />
            ) : null}
            {screen === 'findGames' ? (
              <>
                <DiscoverySearchModal
                  visible={showDiscoverySearch}
                  value={gameQuery}
                  onChangeText={setGameQuery}
                  onClose={() => setShowDiscoverySearch(false)}
                />
                <OrbitMatchScreen
                  minimumHeight={Math.max(0, contentHeight - 16)}
                  onBack={() => setScreen('home')}
                  onSearch={() => setShowDiscoverySearch(true)}
                  onFilters={() => setShowDiscoveryFilters(true)}
                  searchActive={Boolean(gameQuery)}
                  deviceScope={match.scope === 'device'}
                  mode={matchMode}
                  onModeChange={setMatchMode}
                  candidates={match.ranked}
                  savedGames={match.savedGames}
                  inventoryPartial={matchMode === 'discover' ? match.discoveryPartial : liveDataPartial}
                  inventoryStatus={matchMode === 'discover' ? match.discoveryStatus : liveDataStatus}
                  storageReady={match.ready}
                  pending={match.working}
                  error={match.error}
                  canUndo={Boolean(match.state.undo)}
                  preferences={match.state.preferences}
                  preferencesRevision={match.state.preferencesRevision}
                  timeZone={match.timeZone}
                  clubs={clubs.map(({ club }) => ({ id: club.id, name: club.name }))}
                  originLabel={location.originLabel}
                  onSelectOrigin={() => setShowMatchLocation(true)}
                  onClearOrigin={() => { void location.clear(); }}
                  onDecision={(candidate, decision) => { void match.controller.current?.decide(candidate.ref, candidate.summary, decision); }}
                  onUndo={() => { void match.controller.current?.undo(); }}
                  onRemoveSaved={(record) => { void match.controller.current?.remove(record); }}
                  onDetails={openMatchDetails}
                  onPreferences={(preferences, baseRevision) => match.controller.current?.preferences(preferences, baseRevision) ?? false}
                  onRetry={() => { match.retry(); retryLiveData(); }}
                />
                {match.pending && !match.working ? <Text accessibilityLiveRegion="polite" style={styles.muted}>Your changes are saved on this device and waiting to sync.</Text> : null}
                {location.error ? <View accessibilityRole="alert" style={styles.demoNotice}>
                  <Text style={styles.muted}>{location.error}</Text>
                  <Pressable accessibilityRole="button" onPress={() => setShowMatchLocation(true)} style={styles.compactButton}><Text style={styles.compactButtonText}>Choose search location</Text></Pressable>
                </View> : null}
                {activePlayerGames.length || gameRequestMessage ? <MyGamesSection
                  games={activePlayerGames}
                  message={gameRequestMessage}
                  readOnly={liveDataStatus !== 'ready'}
                  onCancel={(club, game, entry) => cancelWaitlist(club, game, entry)}
                /> : null}
              </>
            ) : null}

            {screen === 'tournaments' ? (
              <TournamentScreen
                query={tournamentQuery}
                onQueryChange={setTournamentQuery}
                onOpenFilters={() => setShowTournamentFilters(true)}
                opportunities={visibleTournaments}
                hasOrbitAccount={demoMode || Boolean(firebaseIdentity && firebaseIdentity.uid === player.id)}
                readOnly={tournamentInventoryStatus !== 'ready'}
                inventoryStatus={tournamentInventoryStatus}
                inventoryPartial={tournamentInventoryPartial}
                message={tournamentMessage}
                pendingTournamentKeys={pendingTournamentKeys}
                onSelectClub={(club) => {
                  setSelectedClubId(club.club.id);
                  setScreen('clubs');
                }}
                onExpressInterest={expressInterest}
                onWithdrawInterest={withdrawInterest}
                onRegisterTournament={registerTournament}
                tournamentRegistrations={tournamentRegistrations}
              />
            ) : null}



            {screen === 'map' ? (
              <MapExploreScreen
                clubs={mappedClubs}
                query={mapQuery}
                readOnly={liveDataStatus !== 'ready'}
                setQuery={setMapQuery}
                onOpenFilters={() => setShowMapFilters(true)}
                onDirections={openDirections}
                onShowGames={(club) => {
                  setGameQuery('');
                  setGameTypeFilter('all');
                  setStakesFilter('');
                  setFitScoreFilterEnabled(false);
                  setSelectedFilterClubId(isCasinoClub(club) ? 'none' : club.club.id);
                  setSelectedCasinoFilter(isCasinoClub(club) ? club.club.id : 'none');
                  setMatchMode('discover');
                  setScreen('findGames');
                }}
                onRequestAccess={openClubSignup}
              />
            ) : null}

            {screen === 'clubs' ? (
              <ClubsScreen
                demoMode={demoMode}
                memberClubs={memberClubs}
                selectedMembership={selectedMembership}
                viewState={clubsViewState}
                player={player}
                originCoordinate={playerHomeCoordinate}
                nowMs={clockNow}
                message={clubMembershipMessage}
                waitlists={playerWaitlists}
                tournaments={selectedClubTournaments}
                onSelectClub={(club) => {
                  setClubSelectionNotice('');
                  setSelectedClubId(club.club.id);
                }}
                onOpenMembership={(club) => {
                  setClubSelectionNotice('');
                  setSelectedClubId(club.club.id);
                  setScreen('membershipDetails');
                }}
                onGame={(game) => {
                  if (selectedMemberClub) joinWaitlist(selectedMemberClub, game);
                }}
                onManageAccess={() => {
                  if (selectedMemberClub) openClubSignup(selectedMemberClub);
                }}
                onViewEvents={() => {
                  if (!selectedMemberClub) return;
                  setTournamentQuery('');
                  setTournamentFilter('all');
                  setTournamentClubFilter(selectedMemberClub.club.id);
                  setScreen('tournaments');
                }}
              />
            ) : null}

            {screen === 'clubs' && clubMembershipMessage ? (
              <Text accessibilityLiveRegion="polite" style={styles.actionStatus}>{clubMembershipMessage}</Text>
            ) : null}

            {screen === 'membershipDetails' ? (
              <MembershipDetailsScreen
                viewState={clubsViewState}
                player={player}
                nowMs={clockNow}
                message={clubMembershipMessage}
                demoMode={demoMode}
                onBack={() => setScreen('clubs')}
                onManageAccess={() => { if (selectedMemberClub) openClubSignup(selectedMemberClub); }}
              />
            ) : null}

            {screen === 'clubSignup' && selectedClub && liveDataStatus === 'ready' ? (
              <ClubMembershipPlanScreen
                key={selectedClub.club.id}
                club={selectedClub}
                message={clubMembershipMessage}
                player={player}
                busy={clubActionPending}
                onBack={() => setScreen('clubs')}
                onSubmit={(membershipOption) => submitMembershipApplication(selectedClub, membershipOption)}
              />
            ) : null}
            {screen === 'clubSignup' && (!selectedClub || liveDataStatus !== 'ready') ? (
              <View accessibilityRole="alert" style={styles.emptyState}>
                <Text style={styles.cardTitle}>{selectedClub ? 'Club access is temporarily read-only' : 'That club is no longer available'}</Text>
                <Text style={styles.muted}>{selectedClub
                  ? 'Orbit must refresh the current venue catalog before you can send a membership request.'
                  : 'Return to the current club list or refresh published data.'}</Text>
                <Pressable accessibilityRole="button" onPress={retryLiveData} style={styles.compactButton}>
                  <Text style={styles.compactButtonText}>Refresh published data</Text>
                </Pressable>
              </View>
            ) : null}

            {screen === 'settings' && identity ? (
              <SettingsScreen
                onOpenMatchPreferences={() => { setMatchMode('preferences'); setScreen('findGames'); }}
                firebaseIdentity={firebaseIdentity}
                authStatus={identity.authStatus}
                playerAuthMethod={identity.playerAuthMethod}
                setPlayerAuthMethod={identity.setPlayerAuthMethod}
                playerAuthEmail={identity.playerAuthEmail}
                setPlayerAuthEmail={identity.setPlayerAuthEmail}
                playerAuthPhone={identity.playerAuthPhone}
                setPlayerAuthPhone={identity.setPlayerAuthPhone}
                playerAuthCode={identity.playerAuthCode}
                setPlayerAuthCode={identity.setPlayerAuthCode}
                playerPhoneChallenge={identity.playerPhoneChallenge}
                playerAuthPassword={identity.playerAuthPassword}
                setPlayerAuthPassword={identity.setPlayerAuthPassword}
                connectPlayerAccount={() => { void identity.connectPlayerAccount(); }}
                recoverPlayerAccount={identity.recoverPlayerAccount}
                restartPlayerPhoneSignIn={identity.restartPlayerPhoneSignIn}
                identityStatus={identity.identityStatus}
                profileEditingReady={profileEditingReady}
                showIdentityVerification={identity.showIdentityVerification}
                player={player}
                setPlayer={setPlayer}
                signOutPlayer={identity.signOutPlayer}
                deletePlayerAccount={identity.deletePlayerAccount}
                onTryDemo={onTryDemo}
              />
            ) : null}
            {screen === 'settings' && demoMode ? (
              <View style={styles.accountCard}>
                <Text style={styles.cardTitle}>{player.name}</Text>
                <Text style={styles.muted}>{player.email}</Text>
                <Text style={styles.muted}>Changes are not saved.</Text>
                <View accessibilityLabel="Sample settings">
                  <Pressable accessibilityRole="button" accessibilityLabel="Match preferences" onPress={() => { setMatchMode('preferences'); setScreen('findGames'); }} style={styles.demoMenuAction}>
                    <Ionicons name="options-outline" size={20} color={colors.primary} />
                    <Text style={styles.demoOptionsText}>Match preferences</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="Reset sample games" onPress={onResetDemo} style={styles.demoMenuAction}>
                    <Ionicons name="refresh-outline" size={20} color={colors.primary} />
                    <Text style={styles.demoOptionsText}>Reset sample games</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="Exit sample" onPress={onExitDemo} style={styles.demoMenuAction}>
                    <Ionicons name="log-out-outline" size={20} color={colors.primary} />
                    <Text style={styles.demoOptionsText}>Exit sample</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </ScrollView>

          {screen !== 'gameDetails' && screen !== 'identityVerification' ? (
            <View accessibilityLabel="Primary navigation" accessibilityRole="tablist" style={[styles.tabBar, membershipSurface && { backgroundColor: membershipPalette.panel, borderColor: membershipPalette.line }]}>
              {tabs.map((tab) => {
                const active = screen === tab.id || (tab.id === 'home' && screen === 'findGames')
                  || (tab.id === 'clubs' && (screen === 'membershipDetails' || screen === 'clubSignup'));
                return (
                  <Pressable
                    accessibilityRole="tab"
                    accessibilityLabel={tab.label}
                    accessibilityState={{ selected: active }}
                    key={tab.id}
                    onPress={() => {
                      setScreen(tab.id);
                      setSelectedDiscoveryOpportunity(null);
                    }}
                    style={[styles.tab, active && styles.activeTab, active && membershipSurface && { backgroundColor: membershipPalette.accentSoft }]}
                  >
                    <Ionicons name={tab.icon} size={22} color={membershipSurface ? active ? membershipPalette.accent : membershipPalette.muted : active ? colors.primary : colors.muted} />
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>
        <FiltersBottomSheet
          visible={showDiscoveryFilters}
          title="Game filters"
          onClose={() => setShowDiscoveryFilters(false)}
          onReset={() => {
            clearDiscoveryFilters();
          }}
        >
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
          }}
        >
          <TournamentFilterControls
            clubs={clubs}
            eventFilter={tournamentFilter}
            setEventFilter={setTournamentFilter}
            clubFilter={tournamentClubFilter}
            setClubFilter={setTournamentClubFilter}
          />
        </FiltersBottomSheet>
        <FiltersBottomSheet
          visible={showMapFilters}
          title="Map filters"
          onClose={() => setShowMapFilters(false)}
          onReset={() => {
            setMapVenueFilter('all');
          }}
        >
          <MapFilterControls
            venue={mapVenueFilter}
            setVenue={setMapVenueFilter}
          />
        </FiltersBottomSheet>
        <MatchLocationSheet visible={showMatchLocation} onClose={() => setShowMatchLocation(false)} controller={location} clubs={clubs} demoMode={demoMode} />
        <SeatRequestModal
          draft={seatRequestDraft}
          message={seatRequestMessage}
          busy={clubActionPending}
          readOnly={liveDataStatus !== 'ready'}
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

function DemoEntryButton({ onPress }: { onPress?: () => void }) {
  const styles = useThemedStyles(baseStyles);
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.compactButton}>
      <Text style={styles.compactButtonText}>Try sample account</Text>
    </Pressable>
  ) : null;
}

function getScreenTitle(screen: Screen) {
  if (screen === 'clubs') return 'Your wallet';
  if (screen === 'membershipDetails') return 'Club pass';
  if (screen === 'findGames') return 'Orbit Match';
  if (screen === 'settings') return 'Profile';
  if (screen === 'identityVerification') return 'Age Verification';
  return tabs.find((tab) => tab.id === screen)?.label ?? 'Orbit';
}

const playerAppStyles = StyleSheet.create(applyDarkComponentTheme({
  shell: {
    alignSelf: 'center',
    flex: 1,
    width: '100%'
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 60,
    paddingHorizontal: 16,
    paddingVertical: 8
  },
  title: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 0,
    lineHeight: 32,
    flex: 1,
    textShadowRadius: 0
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 999,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700'
  },
  content: {
    flexGrow: 1,
    gap: 16,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24
  },
  matchContent: { paddingHorizontal: 8, paddingBottom: 8 },
  mainScroll: { flex: 1 },
  demoBar: {
    alignItems: 'center',
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 28,
    paddingHorizontal: 16
  },
  demoLabel: { color: colors.muted, fontSize: 12 },
  demoOptions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44
  },
  demoOptionsText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  demoMenuAction: {
    alignItems: 'center',
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 52
  },
  demoNotice: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderRadius: 10,
    flexDirection: 'row',
    gap: 8,
    paddingLeft: 12
  },
  tabBar: {
    alignSelf: 'flex-end',
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 28,
    flexDirection: 'row',
    gap: 2,
    margin: 12,
    padding: 4,
  },
  tab: {
    alignItems: 'center',
    borderRadius: 22,
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center'
  },
  activeTab: {
    backgroundColor: colors.primarySoft
  },
}));

const baseStyles = { ...sharedStyles, ...discoveryStyles, ...tournamentStyles, ...clubStyles, ...playerAppStyles };

