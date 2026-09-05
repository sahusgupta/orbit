import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { InAppNotificationPopup } from './components/InAppNotificationPopup';
import { FiltersBottomSheet } from './components/PlayerPresentation';
import { LinearGradient } from 'expo-linear-gradient';
import {
  isActivePlayerGameRequest,
  isMembershipCurrentlyActive,
  isPlayerMembership,
  isPlayerWaitlistEntry,
  isTournamentInterestOpen,
  type PlayerAccount
} from './domain/playerSync';
import {
  advanceDiscoveryCycle,
  buildFindGameClubs,
  buildGameOpportunities,
  filterMapClubs,
  filterTournaments,
  getActiveDiscoveryOpportunity,
  getDiscoveryDeck,
  getOpportunityKey,
  getSavedOpportunities,
  selectContinuousDiscoveryOpportunities
} from './domain/discovery';
import { deriveClubsViewState } from './domain/playerClubViewState';
import { getLatestInAppNotification } from './domain/playerNotifications';
import type {
  CasinoFilter,
  DiscoveryDecision,
  GameOpportunity,
  GameTypeFilter,
  MapVenueFilter,
  Screen,
  TournamentFilter
} from './domain/playerTypes';
import { isSyncConfigured } from './data/orbitSyncApi';
import { OnboardingScreen } from './features/onboarding/OnboardingScreen';
import { DiscoveryDeck, SavedGamesStrip } from './features/discovery/DiscoveryDeck';
import { DiscoverySearchModal, GameFilterPanel, MapFilterControls } from './features/discovery/DiscoveryFilters';
import { GameDetailsScreen } from './features/discovery/DiscoveryGameDetails';
import { MyGamesSection } from './features/discovery/DiscoveryLists';
import { MapExploreScreen } from './features/discovery/MapExploreScreen';
import { discoveryStyles } from './features/discovery/discoveryStyles';
import { TournamentFilterControls, TournamentScreen } from './features/tournaments/TournamentScreen';
import { tournamentStyles } from './features/tournaments/tournamentStyles';
import { ClubMembershipPlanScreen, ClubsScreen, SeatRequestModal } from './features/clubs/ClubRoutes';
import { clubStyles } from './features/clubs/clubStyles';
import { OrbitJourney, PlayerAmbientFlow, PlayerLandingHero } from './features/home/PlayerLandingExperience';
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

const tabs: Array<{ id: Screen; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { id: 'home', label: 'Home', icon: 'home-outline' },
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
  const {
    accountLoaded,
    clearLocalPlayer,
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
    setHasAccount,
    setOnboardingStep,
    setPlayer
  } = usePlayerStorage(emptyPlayer);
  const [screen, setScreen] = useState<Screen>('home');
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
  const [discoveryDecisions, setDiscoveryDecisions] = useState<Record<string, DiscoveryDecision>>({});
  const [discoveryCycleDecisions, setDiscoveryCycleDecisions] = useState<Record<string, DiscoveryDecision>>({});
  const [selectedDiscoveryOpportunity, setSelectedDiscoveryOpportunity] = useState<GameOpportunity | null>(null);
  const [gameDetailsReturnScreen, setGameDetailsReturnScreen] = useState<'home' | 'findGames'>('findGames');
  const [discoveryNotice, setDiscoveryNotice] = useState('');
  const [avatarHovered, setAvatarHovered] = useState(false);
  const mainScrollRef = useRef<ScrollView>(null);
  const [syncStatus, setSyncStatus] = useState(
    isSyncConfigured() ? 'Connecting to published venue data...' : 'Published venue sync is not configured.'
  );
  const {
    authLoaded,
    authInitializationError,
    authStatus,
    completeAccount,
    connectPlayerAccount,
    deletePlayerAccount,
    firebaseIdentity,
    identityBusy,
    identityMessage,
    identityRequiredMinimumAge,
    identityReturnScreen,
    identityStatus,
    playerAuthEmail,
    playerAuthCode,
    playerAuthMethod,
    playerAuthPassword,
    playerAuthPhone,
    playerPhoneChallenge,
    profileSyncPaused,
    recoverPlayerAccount,
    refreshIdentityVerification,
    requireVerifiedAge,
    retryAuthInitialization,
    setPlayerAuthEmail,
    setPlayerAuthCode,
    setPlayerAuthMethod,
    setPlayerAuthPassword,
    setPlayerAuthPhone,
    showIdentityVerification,
    restartPlayerPhoneSignIn,
    signOutPlayer,
    startIdentityVerification
  } = usePlayerIdentity({
    accountLoaded,
    clearLocalPlayer,
    draftPlayer,
    platform: playerPlatform,
    player,
    setDraftPlayer,
    setHasAccount,
    setOnboardingStep,
    setPlayer,
    setScreen,
    setSyncStatus
  });
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
    tournamentLoadError,
    tournaments
  } = usePlayerLiveData({
    accountLoaded: accountLoaded && authLoaded,
    firebaseIdentity,
    hasAccount,
    platform: playerPlatform,
    player,
    profileSyncPaused,
    setDraftPlayer,
    setPlayer,
    setScreen,
    setSyncStatus
  });
  const retryPlayerPersistence = () => {
    retryPlayerStorage();
    retryLiveData();
  };
  const {
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
  } = usePlayerClubs({
    actionsReady: liveDataStatus === 'ready',
    clockNow,
    platform: playerPlatform,
    player,
    requireVerifiedAge,
    setClubMembershipMessage,
    setClubs,
    setScreen,
    setSelectedClubId,
    setSyncStatus
  });
  const { expressInterest, pendingTournamentIds, tournamentMessage, withdrawInterest } = usePlayerTournaments({
    firebaseIdentity,
    getClubMinimumAge: (clubId) => clubs.find((club) => club.club.id === clubId)?.club.minimumAge === 18 ? 18 : 21,
    player,
    requireVerifiedAge,
    setTournamentInterests
  });

  const selectedClub = clubs.find((club) => club.club.id === selectedClubId);
  const activeInAppNotification = useMemo(
    () => dismissedAlertsLoaded ? getLatestInAppNotification(clubs, dismissedNotificationIds) : null,
    [clubs, dismissedAlertsLoaded, dismissedNotificationIds]
  );
  const memberships = clubs.flatMap((club) => club.memberships.filter((membership) => isPlayerMembership(membership, player)));
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
  const memberClubs = clubs.filter((club) => membershipClubIds.has(club.club.id) || club.timeAccess?.linked);
  const selectedMemberClub = memberClubs.find((club) => club.club.id === selectedClubId);
  const clubsViewState = deriveClubsViewState(liveDataStatus, memberClubs, selectedMemberClub, liveDataPartial, clubSelectionNotice);
  const selectedMembership = selectedMemberClub?.memberships.find((membership) => isPlayerMembership(membership, player));
  const playerWaitlists = selectedMemberClub?.waitlists.filter((entry) => isPlayerWaitlistEntry(entry, player)) ?? [];
  const selectedClubTournaments = selectedMemberClub ? tournaments.filter((tournament) => tournament.clubId === selectedMemberClub.club.id) : [];
  const findGameClubs = useMemo(() => buildFindGameClubs(clubs), [clubs]);
  const playerHomeCoordinate = null;
  const mappedClubs = useMemo(
    () => filterMapClubs(findGameClubs, mapQuery, 'none', mapVenueFilter, playerHomeCoordinate),
    [findGameClubs, mapQuery, mapVenueFilter]
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
    [clockNow, clubs, player.id, tournamentClubFilter, tournamentFilter, tournamentQuery, tournamentInterests, tournaments]
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
    setDiscoveryDecisions({});
    setDiscoveryCycleDecisions({});
    setSelectedDiscoveryOpportunity(null);
    setDiscoveryNotice('');
    setSeatRequestDraft(null);
    setSeatRequestMessage('');
    setClubMembershipMessage('');
    setClubSelectionNotice('');
    setSelectedClubId('');
  }, [hasAccount]);

  useEffect(() => {
    mainScrollRef.current?.scrollTo({ y: 0, animated: false });
    setShowDiscoverySearch(false);
    setShowDiscoveryFilters(false);
    setShowTournamentFilters(false);
    setShowMapFilters(false);
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
      gameTypeFilter,
      joinedClubIds,
      nowMs: clockNow,
      player,
      playerHomeCoordinate,
      selectedCasinoFilter,
      selectedFilterClubId,
      stakesFilter
    }),
    [activePlayerGameKeys, clockNow, favoriteClubIds, findGameClubs, fitScoreFilterEnabled, gameQuery, gameTypeFilter, joinedClubIds, player, selectedCasinoFilter, selectedFilterClubId, stakesFilter]
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
    [activePlayerGameKeys, clockNow, favoriteClubIds, findGameClubs, joinedClubIds, player]
  );
  const discoverySelection = useMemo(
    () => selectContinuousDiscoveryOpportunities(opportunities, broadOpportunities),
    [broadOpportunities, opportunities]
  );
  const displayedOpportunities = discoverySelection.opportunities;
  const discoveryDeck = useMemo(
    () => getDiscoveryDeck(displayedOpportunities, discoveryCycleDecisions),
    [discoveryCycleDecisions, displayedOpportunities]
  );
  const savedOpportunities = useMemo(
    () => getSavedOpportunities(displayedOpportunities, discoveryDecisions),
    [discoveryDecisions, displayedOpportunities]
  );
  const activeDiscoveryOpportunity = useMemo(
    () => getActiveDiscoveryOpportunity(broadOpportunities, selectedDiscoveryOpportunity),
    [broadOpportunities, selectedDiscoveryOpportunity]
  );

  useEffect(() => {
    if (screen === 'clubSignup' && !selectedClub) setScreen('clubs');
  }, [screen, selectedClub]);

  const decideDiscoveryOpportunity = (item: GameOpportunity, decision: DiscoveryDecision) => {
    const key = getOpportunityKey(item);
    setDiscoveryDecisions((current) => ({ ...current, [key]: decision }));
    setDiscoveryCycleDecisions((current) => advanceDiscoveryCycle(displayedOpportunities, current, item, decision));
    if (decision === 'saved') {
      setDiscoveryNotice(`${item.game.name} saved. Review the venue's published details and request options.`);
      setSelectedDiscoveryOpportunity(item);
      setGameDetailsReturnScreen('findGames');
      setScreen('gameDetails');
    } else {
      setSelectedDiscoveryOpportunity(null);
      setDiscoveryNotice(`Passed on ${item.game.name}.`);
    }
  };

  const openDiscoveryGame = (item: GameOpportunity) => {
    setSelectedDiscoveryOpportunity(item);
    setGameDetailsReturnScreen(screen === 'home' ? 'home' : 'findGames');
    setScreen('gameDetails');
  };

  const closeDiscoveryGame = () => {
    setSelectedDiscoveryOpportunity(null);
    setScreen(gameDetailsReturnScreen);
  };

  useEffect(() => {
    if (screen !== 'gameDetails' && screen !== 'findGames') return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === 'gameDetails') {
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

  const resetDiscoveryDeck = () => {
    setDiscoveryCycleDecisions({});
    if (displayedOpportunities.length) {
      setDiscoveryNotice('Discovery deck refreshed.');
    } else {
      setDiscoveryNotice('Checking for newly published game matches...');
      retryLiveData();
    }
  };

  if (!accountLoaded || !authLoaded) {
    return (
      <SafeAreaProvider>
        <SafeAreaView accessibilityLabel="Loading Orbit Player" accessibilityRole="progressbar" style={styles.safeArea}>
          <View style={[styles.content, { gap: 14, paddingTop: 36 }]}>
            <View style={[styles.emptyState, { minHeight: 94 }]} />
            <View style={[styles.emptyState, { minHeight: 180 }]} />
            <Text style={styles.muted}>Restoring your Orbit Player account and secure sign-in...</Text>
          </View>
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
            <Pressable accessibilityRole="button" onPress={retryAuthInitialization} style={styles.compactButton}>
              <Text style={styles.compactButtonText}>Retry secure sign-in cleanup</Text>
            </Pressable>
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
        onComplete={completeAccount}
      />
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <LinearGradient colors={['#060c1a', '#0b1020', '#10182b']} style={styles.appBackdrop} />
        <PlayerAmbientFlow />
        <View style={styles.shell}>
          {screen !== 'gameDetails' && screen !== 'home' ? (
            <View style={styles.header}>
              <View>
                <Text style={[styles.eyebrow, styles.darkShellEyebrow]}>{screen === 'clubs' ? 'Your memberships' : screen === 'tournaments' ? 'Upcoming games' : screen === 'map' ? 'Published venues' : 'Orbit Player'}</Text>
                <Text style={[styles.title, styles.darkShellTitle]}>{screen === 'clubSignup' ? 'Membership request' : getScreenTitle(screen)}</Text>
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
              <PlayerLandingHero
                opportunities={broadOpportunities}
                inventoryPartial={liveDataPartial}
                inventoryStatus={liveDataStatus}
                openTournamentCount={visibleTournaments.filter(({ tournament }) => isTournamentInterestOpen(tournament, clockNow)).length}
                clubCount={findGameClubs.length}
                onFindGame={() => setScreen('findGames')}
                onOpenGame={openDiscoveryGame}
                onBrowseTournaments={() => setScreen('tournaments')}
                onBrowseClubs={() => setScreen('clubs')}
              />
            ) : null}
            {screen === 'home' ? <OrbitJourney /> : null}
            {liveDataStatus === 'loading' && !clubs.length ? (
              <View accessibilityLabel="Loading published venues" accessibilityRole="progressbar" style={[styles.emptyState, { minHeight: 132 }]}>
                <Text style={styles.cardTitle}>Loading published venues...</Text>
                <Text style={styles.muted}>Your saved account remains available while Orbit reconnects.</Text>
              </View>
            ) : null}
            {liveDataStatus === 'error' ? (
              <View accessibilityRole="alert" style={styles.emptyState}>
                <Text style={styles.cardTitle}>Published venue data is unavailable</Text>
                <Text style={styles.muted}>{syncStatus}</Text>
                <Pressable accessibilityRole="button" onPress={retryLiveData} style={styles.compactButton}>
                  <Text style={styles.compactButtonText}>Retry published data</Text>
                </Pressable>
              </View>
            ) : null}
            {liveDataStatus !== 'error' && tournamentLoadError ? (
              <View accessibilityRole="alert" style={styles.emptyState}>
                <Text style={styles.cardTitle}>Some published data could not be refreshed</Text>
                <Text style={styles.muted}>{tournamentLoadError}</Text>
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
                backLabel={gameDetailsReturnScreen === 'home' ? 'Home' : 'Matches'}
                onBack={closeDiscoveryGame}
                onDirections={() => {
                  if (activeDiscoveryOpportunity) openDirections(activeDiscoveryOpportunity.club);
                }}
                onJoin={() => {
                  const item = activeDiscoveryOpportunity;
                  if (item) joinWaitlist(item.club, item.game);
                }}
                onRefresh={retryLiveData}
                readOnly={liveDataStatus !== 'ready'}
                onViewStore={() => {
                  if (activeDiscoveryOpportunity) openClubSignup(activeDiscoveryOpportunity.club);
                }}
              />
            ) : null}
            {screen === 'identityVerification' ? (
              <IdentityVerificationScreen
                status={identityStatus}
                signedIn={Boolean(firebaseIdentity)}
                busy={identityBusy}
                message={identityMessage}
                requiredMinimumAge={identityRequiredMinimumAge}
                onBack={() => setScreen(identityReturnScreen)}
                onOpenSettings={playerPlatform.openAppSettings}
                onSignIn={() => setScreen('settings')}
                onStart={startIdentityVerification}
                onRefresh={refreshIdentityVerification}
              />
            ) : null}
            {screen === 'findGames' ? (
              <>
                <Pressable accessibilityLabel="Back to Home" accessibilityRole="button" style={styles.inlineBackAction} onPress={() => setScreen('home')}>
                  <Ionicons name="chevron-back" size={17} color={colors.primary} />
                  <Text style={styles.inlineBackText}>Home</Text>
                </Pressable>
                <MyGamesSection
                  games={activePlayerGames}
                  message={gameRequestMessage}
                  readOnly={liveDataStatus !== 'ready'}
                  onCancel={(club, game, entry) => cancelWaitlist(club, game, entry)}
                />
                <View style={styles.sectionHeader}>
                  <View>
                    <Text style={styles.sectionTitle}>Your game matches</Text>
                    <Text style={styles.muted}>Swipe left to pass or right to save. Requested games stay in My Games.</Text>
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

                {discoverySelection.filtersRelaxed ? (
                  <View accessibilityLiveRegion="polite" style={styles.discoveryNotice}>
                    <Ionicons name="options-outline" size={16} color={colors.primary} />
                    <Text style={styles.discoveryNoticeText}>No exact filter matches. Showing other published games so you can keep matching.</Text>
                    <Pressable accessibilityRole="button" onPress={clearDiscoveryFilters} style={styles.compactButton}>
                      <Text style={styles.compactButtonText}>Clear filters</Text>
                    </Pressable>
                  </View>
                ) : null}

                <DiscoveryDeck
                  opportunities={discoveryDeck}
                  inventoryPartial={liveDataPartial}
                  inventoryStatus={liveDataStatus}
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
              </>
            ) : null}

            {screen === 'tournaments' ? (
              <TournamentScreen
                query={tournamentQuery}
                onQueryChange={setTournamentQuery}
                onOpenFilters={() => setShowTournamentFilters(true)}
                opportunities={visibleTournaments}
                hasOrbitAccount={Boolean(firebaseIdentity && firebaseIdentity.uid === player.id)}
                readOnly={liveDataStatus !== 'ready' || Boolean(tournamentLoadError)}
                message={tournamentMessage}
                pendingTournamentIds={pendingTournamentIds}
                onSelectClub={(club) => {
                  setSelectedClubId(club.club.id);
                  setScreen('clubs');
                }}
                onExpressInterest={expressInterest}
                onWithdrawInterest={withdrawInterest}
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
                  setSelectedFilterClubId(club.club.id);
                  setScreen('findGames');
                }}
                onRequestAccess={openClubSignup}
              />
            ) : null}

            {screen === 'clubs' ? (
              <ClubsScreen
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
                onGame={(game) => {
                  if (selectedMemberClub) joinWaitlist(selectedMemberClub, game);
                }}
                onManageAccess={() => {
                  if (selectedMemberClub) openClubSignup(selectedMemberClub);
                }}
                onViewEvents={() => {
                  if (!selectedMemberClub) return;
                  setTournamentClubFilter(selectedMemberClub.club.id);
                  setScreen('tournaments');
                }}
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

            {screen === 'settings' ? (
              <SettingsScreen
                firebaseIdentity={firebaseIdentity}
                authStatus={authStatus}
                playerAuthMethod={playerAuthMethod}
                setPlayerAuthMethod={setPlayerAuthMethod}
                playerAuthEmail={playerAuthEmail}
                setPlayerAuthEmail={setPlayerAuthEmail}
                playerAuthPhone={playerAuthPhone}
                setPlayerAuthPhone={setPlayerAuthPhone}
                playerAuthCode={playerAuthCode}
                setPlayerAuthCode={setPlayerAuthCode}
                playerPhoneChallenge={playerPhoneChallenge}
                playerAuthPassword={playerAuthPassword}
                setPlayerAuthPassword={setPlayerAuthPassword}
                connectPlayerAccount={connectPlayerAccount}
                recoverPlayerAccount={recoverPlayerAccount}
                restartPlayerPhoneSignIn={restartPlayerPhoneSignIn}
                identityStatus={identityStatus}
                profileEditingReady={profileEditingReady}
                showIdentityVerification={showIdentityVerification}
                player={player}
                setPlayer={setPlayer}
                signOutPlayer={signOutPlayer}
                deletePlayerAccount={deletePlayerAccount}
              />
            ) : null}
          </ScrollView>

          {screen !== 'gameDetails' && screen !== 'identityVerification' ? (
            <View accessibilityLabel="Primary navigation" accessibilityRole="tablist" style={styles.tabBar}>
              {tabs.map((tab) => {
                const active = screen === tab.id || (tab.id === 'home' && screen === 'findGames');
                return (
                  <Pressable
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    key={tab.id}
                    onPress={() => {
                      setScreen(tab.id);
                      setSelectedDiscoveryOpportunity(null);
                    }}
                    style={[styles.tab, active && styles.activeTab]}
                  >
                    <Ionicons name={tab.icon} size={19} color={active ? '#6f91ff' : '#566680'} />
                    <Text style={[styles.tabText, active && styles.activeTabText]}>{tab.label}</Text>
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

function getScreenTitle(screen: Screen) {
  if (screen === 'findGames') return 'Game Matches';
  if (screen === 'settings') return 'Profile';
  if (screen === 'identityVerification') return 'Age Verification';
  return tabs.find((tab) => tab.id === screen)?.label ?? 'Orbit';
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
    fontWeight: '700',
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
    fontWeight: '700'
  },
  content: {
    gap: 10,
    paddingBottom: 104
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
    fontWeight: '700'
  },
  activeTabText: {
    color: '#6f91ff'
  }
}));

const styles = { ...sharedStyles, ...discoveryStyles, ...tournamentStyles, ...clubStyles, ...playerAppStyles };

