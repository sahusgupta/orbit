/** @vitest-environment jsdom */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { usePlayerStorage } from './application/usePlayerStorage';
import type { usePlayerIdentity } from './application/usePlayerIdentity';
import type { usePlayerLiveData } from './application/usePlayerLiveData';
import type { usePlayerClubs } from './application/usePlayerClubs';
import type { usePlayerTournaments } from './application/usePlayerTournaments';
import type { GameOpportunity, TournamentFilter, TournamentOpportunity } from './domain/playerTypes';
import type { PlayerAccount, PlayerClubSnapshot, PlayerSyncGame, PlayerTournament, PlayerTournamentInterest, PlayerWaitlistEntry } from './domain/playerSync';
import PlayerApp from './PlayerApp';
import type { OrbitMatchScreenProps } from './features/match/OrbitMatchScreen';
import { defaultMatchPreferences, type MatchJournal, type MatchPreferences } from './domain/orbitMatchTypes';
import { createMatchState } from '../../apps/api/src/shared/orbitMatchState.cjs';

type SearchModalProps = React.ComponentProps<typeof import('./features/discovery/DiscoveryFilters').DiscoverySearchModal>;
type GameFiltersProps = React.ComponentProps<typeof import('./features/discovery/DiscoveryFilters').GameFilterPanel>;
type ClubsScreenProps = React.ComponentProps<typeof import('./features/clubs/ClubRoutes').ClubsScreen>;

const hooks = vi.hoisted(() => ({
  storage: vi.fn(), identity: vi.fn(), liveData: vi.fn(), clubs: vi.fn(), tournaments: vi.fn()
}));
const persistence = vi.hoisted(() => ({
  loadPlayer: vi.fn(), savePlayer: vi.fn(), clearPlayer: vi.fn(),
  loadDismissedAlertIds: vi.fn(), saveDismissedAlertIds: vi.fn(),
  loadPendingPlayerAuthCleanupUid: vi.fn(), savePendingPlayerAuthCleanupUid: vi.fn(), clearPendingPlayerAuthCleanupUid: vi.fn(),
  loadPendingPlayerProfile: vi.fn(), savePendingPlayerProfile: vi.fn(), clearPendingPlayerProfile: vi.fn(),
  loadMatchJournal: vi.fn(), saveMatchJournal: vi.fn<(uid: string, journal: MatchJournal) => Promise<void>>(),
  loadLocalOrigin: vi.fn(async () => null), saveLocalOrigin: vi.fn(async () => undefined), clearLocalOrigin: vi.fn(async () => undefined)
}));
const platform = vi.hoisted(() => ({
  openAppSettings: vi.fn(), openDirections: vi.fn(), subscribeToAppState: vi.fn(() => vi.fn())
}));

vi.mock('./application/usePlayerStorage', () => ({ usePlayerStorage: hooks.storage }));
vi.mock('./application/usePlayerIdentity', () => ({ usePlayerIdentity: hooks.identity }));
vi.mock('./application/usePlayerLiveData', () => ({ usePlayerLiveData: hooks.liveData }));
vi.mock('./application/usePlayerClubs', () => ({ usePlayerClubs: hooks.clubs }));
vi.mock('./application/usePlayerTournaments', () => ({ usePlayerTournaments: hooks.tournaments }));
vi.mock('./data/orbitSyncApi', () => ({ isSyncConfigured: () => false }));
vi.mock('./data/storage/playerStorage', () => ({ playerStorage: persistence }));
vi.mock('./data/firebase/playerMatchRepository', () => ({ playerMatchPersistence: {
  loadJournal: vi.fn(), saveJournal: vi.fn(), fetchState: vi.fn(), mutate: vi.fn(), subscribe: vi.fn(() => vi.fn())
} }));
vi.mock('./app/playerPlatform', () => ({ playerPlatform: platform }));
vi.mock('./app/playerLocation', () => ({ playerLocation: { getOneShotPosition: vi.fn() } }));
vi.mock('./features/match/MatchLocationSheet', () => ({ MatchLocationSheet: () => null }));
vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const element = (tag: string) => ({ children, onPress, accessibilityLabel, accessibilityRole, accessibilityState }: {
    children?: React.ReactNode; onPress?: () => void; accessibilityLabel?: string; accessibilityRole?: string;
    accessibilityState?: { selected?: boolean };
  }) => ReactModule.createElement(tag, {
    onClick: onPress, 'aria-label': accessibilityLabel, role: accessibilityRole,
    'aria-selected': accessibilityState?.selected
  }, children);
  return {
    Appearance: { getColorScheme: () => 'dark', addChangeListener: () => ({ remove: vi.fn() }) },
    BackHandler: { addEventListener: () => ({ remove: vi.fn() }) },
    Pressable: element('button'), Text: element('span'), View: element('div'),
    ScrollView: ReactModule.forwardRef(({ children }: React.PropsWithChildren, ref) => {
      ReactModule.useImperativeHandle(ref, () => ({ scrollTo: vi.fn() }));
      return <div data-player-scroll>{children}</div>;
    }),
    StyleSheet: { create: <T,>(styles: T) => styles, absoluteFill: {} }
  };
});
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SafeAreaView: ({ children }: React.PropsWithChildren) => <div>{children}</div>
}));
vi.mock('expo-status-bar', () => ({ StatusBar: () => null }));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('./styles/sharedStyles', () => ({ sharedStyles: {} }));
vi.mock('./features/discovery/discoveryStyles', () => ({ discoveryStyles: {} }));
vi.mock('./features/tournaments/tournamentStyles', () => ({ tournamentStyles: {} }));
vi.mock('./features/clubs/clubStyles', () => ({ clubStyles: {} }));
vi.mock('./components/InAppNotificationPopup', () => ({ InAppNotificationPopup: () => null }));
vi.mock('./components/PlayerPresentation', async (importOriginal) => ({
  connectionErrorCopy: (await importOriginal<typeof import('./components/PlayerPresentation')>()).connectionErrorCopy,
  FiltersBottomSheet: ({ visible, title, children, onClose }: React.PropsWithChildren<{
    visible: boolean; title: string; onClose: () => void;
  }>) => visible ? <div role="dialog" aria-label={title}>{children}<button onClick={onClose}>Close {title}</button></div> : null
}));
vi.mock('./features/onboarding/OnboardingScreen', () => ({
  OnboardingScreen: ({ onComplete, onTryDemo, onCompleteWithMatchPreferences, accountConnection, draftPlayer }: React.ComponentProps<typeof import('./features/onboarding/OnboardingScreen').OnboardingScreen>) => <div>
    Normal onboarding<button onClick={onComplete}>Create profile</button>
    {onCompleteWithMatchPreferences ? <button onClick={onCompleteWithMatchPreferences}>Set Match preferences</button> : null}
    {onTryDemo ? <button onClick={onTryDemo}>Try sample account</button> : null}
    {accountConnection ? <button onClick={() => accountConnection.onConnect(draftPlayer)}>Connect Firebase account</button> : null}
    {accountConnection ? <button onClick={() => accountConnection.onConnect(draftPlayer, false, 'signIn')}>Sign in Firebase account</button> : null}
  </div>
}));
vi.mock('./features/home/PlayerHomeScreen', () => ({
  PlayerHomeScreen: ({ opportunities, inventoryStatus, openTournamentCount, onFindGame, onOpenGame }: {
    opportunities: GameOpportunity[]; inventoryStatus: string; openTournamentCount: number | null; onFindGame: () => void; onOpenGame: (game: GameOpportunity) => void;
  }) => <div data-inventory-status={inventoryStatus} data-event-count={openTournamentCount ?? 'unconfirmed'}>
    {opportunities.map((item) => <button key={`${item.club.club.id}:${item.game.id}`} onClick={() => onOpenGame(item)}>{item.club.club.name}: {item.game.name}</button>)}
    <button onClick={onFindGame}>Find games</button>
  </div>
}));
vi.mock('./features/match/OrbitMatchScreen', () => ({
  OrbitMatchScreen: ({ candidates, inventoryStatus, inventoryPartial, savedGames, onDetails, onDecision, onUndo, mode, onModeChange, preferences, onBack, onSearch, onFilters, searchActive, deviceScope }: OrbitMatchScreenProps) => <div data-deck-status={inventoryStatus} data-deck-partial={String(inventoryPartial)} data-match-mode={mode} data-match-preferences={JSON.stringify(preferences)} data-search-active={String(searchActive)}>
    {onBack ? <button aria-label="Back to Games" onClick={onBack}>Back to Games</button> : null}
    {onSearch ? <button aria-label="Search games" onClick={onSearch}>Search games</button> : null}
    {onFilters ? <button aria-label="Show game filters" onClick={onFilters}>Show game filters</button> : null}
    <button onClick={() => onModeChange?.('discover')}>Discover games</button>
    <button onClick={() => onModeChange?.('saved')}>Open Match saves</button>
    <button onClick={() => onModeChange?.('preferences')}>Match preferences</button>
    {mode === 'preferences' && deviceScope ? <span>This device's Match data stays separate. Signed-in Match changes sync across devices; signing in does not move these saves or preferences.</span> : null}
    {mode === 'saved' ? savedGames.map((row) => {
      const candidate = row.candidate;
      return candidate ? <button key={JSON.stringify(row.record.ref)} data-saved-club={row.record.ref.clubId} data-saved-kind={row.record.ref.kind} data-saved-id={row.record.ref.gameId} onClick={() => onDetails(candidate, 'saved')}>Saved details: {row.record.summary.gameName}</button> : null;
    }) : mode === 'discover' ? candidates.map((item) =>
    <div key={JSON.stringify(item.ref)} data-match-club={item.ref.clubId} data-match-kind={item.ref.kind} data-match-id={item.ref.gameId}>
      <button onClick={() => onDetails(item, 'deck')}>Details: {item.summary.gameName}</button>
      <button onClick={() => onDecision(item, 'saved')}>Save: {item.summary.gameName}</button>
      <button onClick={() => onDecision(item, 'passed')}>Pass: {item.summary.gameName}</button>
    </div>
  ) : null}<span>Saved games: {savedGames.length}</span><button onClick={onUndo}>Undo last swipe</button></div>
}));
vi.mock('./features/discovery/DiscoveryFilters', () => ({
  DiscoverySearchModal: ({ visible, value, onChangeText, onClose }: SearchModalProps) => visible ? <div data-game-search={value}>
    <button onClick={() => onChangeText('Unmatched map search')}>Use unmatched game search</button>
    <button onClick={onClose}>Close game search</button>
  </div> : null,
  GameFilterPanel: ({ clubs, gameType, setGameType, selectedClubId, setSelectedClubId, selectedCasinoId, setSelectedCasinoId, stakes, setStakes, fitScoreEnabled, setFitScoreEnabled }: GameFiltersProps) =>
    <div data-game-type={gameType} data-house-filter={selectedClubId} data-casino-filter={selectedCasinoId} data-stakes-filter={stakes} data-fit-filter={String(fitScoreEnabled)}>
      <button onClick={() => { setGameType('favorites'); setSelectedClubId('none'); setSelectedCasinoId('none'); setStakes('999/999'); setFitScoreEnabled(true); }}>Use conflicting discovery filters</button>
      {(['all', 'card-house', 'favorites'] as const).map((option) => <button key={option} onClick={() => setGameType(gameType === option ? 'none' : option)}>Game type: {option}</button>)}
      <button onClick={() => setSelectedClubId(selectedClubId === 'all' ? 'none' : 'all')}>Filter all houses</button>
      <button onClick={() => setSelectedCasinoId(selectedCasinoId === 'all' ? 'none' : 'all')}>Filter all casinos</button>
      {clubs.map(({ club }) => <button key={club.id} onClick={() => club.venueKind === 'Casino' ? setSelectedCasinoId(club.id) : setSelectedClubId(club.id)}>Filter venue: {club.id}</button>)}
    </div>,
  MapFilterControls: () => null
}));
vi.mock('./features/discovery/DiscoveryGameDetails', () => ({
  GameDetailsScreen: ({ item, readOnly, backLabel, onJoin, onDirections, onRefresh, onViewStore, onBack }: {
    item: GameOpportunity | null; readOnly: boolean; onJoin: () => void; onDirections: () => void;
    backLabel: string; onRefresh: () => void; onViewStore: () => void; onBack: () => void;
  }) => <div data-details-readonly={String(readOnly)} data-back-label={backLabel}>
    Game details: {item?.game.name}
    <button onClick={onJoin}>Request demo seat</button><button onClick={onDirections}>Demo directions</button>
    <button onClick={onRefresh}>Refresh demo data</button><button onClick={onViewStore}>Demo access</button>
    <button onClick={onBack}>Back from game</button>
  </div>
}));
vi.mock('./features/discovery/DiscoveryLists', () => ({
  MyGamesSection: ({ games, onCancel, readOnly, message }: {
    games: { club: PlayerClubSnapshot; game: PlayerSyncGame; entry: PlayerWaitlistEntry }[];
    onCancel: (club: PlayerClubSnapshot, game: PlayerSyncGame, entry: PlayerWaitlistEntry) => void;
    readOnly: boolean; message: string;
  }) => <div data-requests-readonly={String(readOnly)}>{message}{games.map(({ club, game, entry }) => <button disabled={readOnly} key={entry.id} onClick={() => onCancel(club, game, entry)}>Cancel: {game.name}</button>)}</div>
}));
vi.mock('./features/discovery/MapExploreScreen', () => ({
  MapExploreScreen: ({ clubs, readOnly, onDirections, onRequestAccess, onShowGames }: {
    clubs: PlayerClubSnapshot[]; readOnly: boolean; onDirections: (club: PlayerClubSnapshot) => void;
    onRequestAccess: (club: PlayerClubSnapshot) => void; onShowGames: (club: PlayerClubSnapshot) => void;
  }) => <div data-map-readonly={String(readOnly)}>{clubs.map((club) => <div key={club.club.id}>
    {club.club.name}: {club.club.address}
    <button onClick={() => onDirections(club)}>Map directions: {club.club.id}</button>
    <button onClick={() => onRequestAccess(club)}>Map access: {club.club.id}</button>
    <button onClick={() => onShowGames(club)}>Map games: {club.club.id}</button>
  </div>)}</div>
}));
vi.mock('./features/tournaments/TournamentScreen', () => ({
  TournamentFilterControls: ({ eventFilter, setEventFilter, clubFilter }: {
    eventFilter: TournamentFilter; setEventFilter: (filter: TournamentFilter) => void; clubFilter: string;
  }) => <div data-event-filter={eventFilter} data-event-club-filter={clubFilter}>
    {([['all', 'All events'], ['open', 'Interest open'], ['free', '$0 published buy-in'], ['interested', 'My interests']] as const).map(([filter, label]) =>
      <button key={filter} onClick={() => setEventFilter(filter)}>{label}</button>)}
  </div>,
  TournamentScreen: ({ query, onQueryChange, opportunities, readOnly, onOpenFilters, onExpressInterest, onWithdrawInterest, onRegisterTournament }: {
    query: string; onQueryChange: (value: string) => void; onOpenFilters: () => void;
    opportunities: TournamentOpportunity[]; readOnly: boolean; onExpressInterest: (event: PlayerTournament) => void;
    onWithdrawInterest: (event: PlayerTournament, interest: PlayerTournamentInterest) => void;
    onRegisterTournament?: (event: PlayerTournament) => void;
  }) => <div data-events-readonly={String(readOnly)} data-event-query={query}><button onClick={onOpenFilters}>Show tournament filters</button>
    <button onClick={() => onQueryChange('Unmatched club event search')}>Use unmatched event search</button>{opportunities.map(({ tournament }) => <div key={`${tournament.clubId}:${tournament.id}`} data-event-id={tournament.id} data-event-club={tournament.clubId}>
    {tournament.name}
    {onRegisterTournament ? <button onClick={() => onRegisterTournament(tournament)}>Register free: {tournament.id}</button> : null}
    <button onClick={() => onExpressInterest(tournament)}>Interest: {tournament.id}</button>
    <button onClick={() => onWithdrawInterest(tournament, {
      id: 'demo-interest', tournamentId: tournament.id, clubId: tournament.clubId, playerId: 'demo-player',
      status: 'interested', createdAt: '', updatedAt: ''
    })}>Withdraw: {tournament.id}</button>
  </div>)}</div>
}));
vi.mock('./features/clubs/ClubRoutes', () => ({
  ClubMembershipPlanScreen: () => null,
  ClubsScreen: ({ memberClubs, onManageAccess, onGame, onViewEvents, selectedMembership, viewState, onOpenMembership }: ClubsScreenProps) => <div>Membership clubs: {memberClubs.length}
    {onOpenMembership ? memberClubs.map((club) => <button key={club.club.id} onClick={() => onOpenMembership(club)}>Membership details: {club.club.id}</button>) : null}
    <button onClick={onManageAccess}>Club access</button>
    {selectedMembership && viewState.kind === 'ready' ? <button data-club-events={viewState.selectedClub.club.id} onClick={onViewEvents}>View events</button> : null}
    {memberClubs[0]?.games.map((game) => <button key={game.id} onClick={() => onGame(game)}>Club game: {game.name}</button>)}
  </div>,
  SeatRequestModal: () => null
}));
vi.mock('./features/clubs/MembershipDetailsScreen', () => ({
  MembershipDetailsScreen: ({ viewState, onBack, onManageAccess }: React.ComponentProps<typeof import('./features/clubs/MembershipDetailsScreen').MembershipDetailsScreen>) => <div data-membership-details={viewState.kind}>
    <button onClick={onBack}>Back to memberships</button>
    {viewState.kind === 'ready' ? <button onClick={onManageAccess}>Extend membership</button> : null}
  </div>
}));
vi.mock('./features/settings/IdentityVerificationScreen', () => ({ IdentityVerificationScreen: () => null }));
vi.mock('./features/settings/SettingsScreen', () => ({
  SettingsScreen: ({ onTryDemo, onOpenMatchPreferences }: { onTryDemo?: () => void; onOpenMatchPreferences?: () => void }) => <div>Normal profile settings
    {onTryDemo ? <button onClick={onTryDemo}>Try sample account</button> : null}
    {onOpenMatchPreferences ? <button onClick={onOpenMatchPreferences}>Match preferences</button> : null}
  </div>
}));

const player: PlayerAccount = { id: 'connected-player', name: 'Alex', email: 'alex@example.test', preferredGameIds: [] };
const liveClub: PlayerClubSnapshot = {
  club: { id: 'real-club', name: 'Connected venue', address: 'Example location' },
  games: [{ id: 'real-game', name: '1/2 NLH', maxSeats: 9, openTables: [{ id: 'table-1', gameId: 'real-game', label: 'Table 1', status: 'Forming', seatsFilled: 0, availableSeats: 9, maxSeats: 9, collectionMode: 'Time', tags: [], startedAt: '2026-10-10T00:00:00.000Z', social: { seatedPlayerCount: 0, adminCount: 0, knownPlayersCount: 0 } }], waitlistCount: 0, formingCount: 2, availableSeats: 0, knownPlayersCount: 0 }],
  memberships: [], waitlists: [], notifications: [],
  social: { activePlayerCount: 0, adminCount: 0, knownPlayersInHouse: 0, waitlistCount: 0 },
  generatedAt: '2026-10-10T00:00:00.000Z'
};
const publishedTournament = (interestStatus: 'open' | 'closed' = 'open'): PlayerTournament => ({
  id: 'published-event', clubId: liveClub.club.id, name: 'Published Weekend Event',
  startsAt: '2030-06-16T18:00:00.000Z', interestOpensAt: '2020-01-01T00:00:00.000Z', interestClosesAt: '2030-06-16T17:00:00.000Z',
  interestStatus, buyIn: 75, rebuysAllowed: false, addOnsAllowed: false, rules: [], withdrawalAllowed: true
});

function mapVenueInventory() {
  const clubs: PlayerClubSnapshot[] = ([
    ['map-house', 'Card house'], ['other-house', 'Card house'],
    ['map-casino', 'Casino'], ['other-casino', 'Casino']
  ] as const).map(([id, venueKind]) => ({
    ...liveClub, club: { ...liveClub.club, id, name: id, venueKind },
    games: liveClub.games.map((game) => ({ ...game, id: `${id}-game`,
      openTables: game.openTables.map((table) => ({ ...table, id: `${id}-table`, gameId: `${id}-game` })) }))
  }));
  return { clubs, tournaments: clubs.map(({ club }) => ({ ...publishedTournament(), id: `${club.id}-event`, clubId: club.id, name: `${club.id} event` })) };
}

function venueTypeInventory() {
  const clubs: PlayerClubSnapshot[] = ([
    ['kind-house', 'Card house'], ['kind-club', 'Poker club'], ['kind-casino', 'Casino']
  ] as const).map(([id, venueKind]) => ({
    ...liveClub, club: { ...liveClub.club, id, name: id, venueKind },
    games: liveClub.games.map((game) => ({ ...game, id: `${id}-cash`, name: `${id} 1/2 NLH`,
      openTables: game.openTables.map((table) => ({ ...table, id: `${id}-table`, gameId: `${id}-cash` })) }))
  }));
  return { clubs, tournaments: clubs.map(({ club }) => ({ ...publishedTournament(), id: `${club.id}-event`, clubId: club.id, name: `${club.id} NLH event` })) };
}

function fixtures() {
  const storage: ReturnType<typeof usePlayerStorage> = {
    accountLoaded: true, clearLocalPlayer: vi.fn(async () => undefined), dismissedAlertsLoaded: true,
    dismissedNotificationIds: [], dismissInAppAlert: vi.fn(), draftPlayer: player, hasAccount: true,
    onboardingStep: 0, player, playerStorageError: '', retryPlayerStorage: vi.fn(),
    setDraftPlayer: vi.fn(), setHasAccount: vi.fn(), setOnboardingStep: vi.fn(), setPlayer: vi.fn()
  };
  const identity: ReturnType<typeof usePlayerIdentity> = {
    authLoaded: true, authInitializationError: '', authStatus: 'Local profile', completeAccount: vi.fn(async () => undefined),
    connectPlayerAccount: vi.fn(async () => undefined), deletePlayerAccount: vi.fn(), firebaseIdentity: null,
    identityBusy: false, identityMessage: '', identityRequiredMinimumAge: 18, identityReturnScreen: 'home',
    identityStatus: { status: 'unverified', ageVerified: false, ageEligible: false, ageLevel: 0, minimumAge: 18,
      verifiedAt: null, capturedAt: null, failureCode: null, reviewStatus: 'not-started', verifiedDetails: null },
    playerAuthEmail: '', playerAuthCode: '', playerAuthMethod: 'email', playerAuthPassword: '', playerAuthPhone: '',
    playerPhoneChallenge: false, profileSyncPaused: false, recoverPlayerAccount: vi.fn(async () => undefined),
    refreshIdentityVerification: vi.fn(async () => null), requireVerifiedAge: vi.fn(() => false), retryAuthInitialization: vi.fn(),
    setPlayerAuthEmail: vi.fn(), setPlayerAuthCode: vi.fn(), setPlayerAuthMethod: vi.fn(), setPlayerAuthPassword: vi.fn(),
    setPlayerAuthPhone: vi.fn(), showIdentityVerification: vi.fn(), restartPlayerPhoneSignIn: vi.fn(),
    signOutPlayer: vi.fn(async () => undefined), startIdentityVerification: vi.fn(async () => undefined)
  };
  const liveData: ReturnType<typeof usePlayerLiveData> = {
    clockNow: Date.parse('2026-10-10T00:00:00.000Z'), clubMembershipMessage: '', clubSelectionNotice: '', clubs: [],
    liveDataPartial: false, liveDataStatus: 'error', profileEditingReady: true, profileSyncNotice: '', retryLiveData: vi.fn(),
    selectedClubId: '', setClubMembershipMessage: vi.fn(), setClubSelectionNotice: vi.fn(), setClubs: vi.fn(),
    setSelectedClubId: vi.fn(), setTournamentInterests: vi.fn(), tournamentInterests: [], tournamentDataStatus: 'ready', tournamentDataPartial: false, tournamentLoadError: '', tournaments: []
  };
  const clubs: ReturnType<typeof usePlayerClubs> = {
    cancelWaitlist: vi.fn(async () => undefined), clubActionPending: false, gameRequestMessage: '',
    joinWaitlist: vi.fn(), openClubSignup: vi.fn(), openDirections: vi.fn(), seatRequestDraft: null, seatRequestMessage: '',
    setSeatRequestDraft: vi.fn(), setSeatRequestMessage: vi.fn(), submitMembershipApplication: vi.fn(async () => undefined),
    submitSeatRequest: vi.fn(async () => undefined)
  };
  const tournaments: ReturnType<typeof usePlayerTournaments> = {
    expressInterest: vi.fn(async () => undefined), pendingTournamentKeys: [], tournamentMessage: '',
    registerTournament: vi.fn(async () => undefined), tournamentRegistrations: {},
    withdrawInterest: vi.fn(async () => undefined)
  };
  return { storage, identity, liveData, clubs, tournaments };
}

describe('Player session boundary', () => {
  let container: HTMLDivElement;
  let root: Root;
  let state: ReturnType<typeof fixtures>;
  const render = () => act(() => root.render(<PlayerApp />));
  const click = (label: string) => {
    const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === label || item.getAttribute('aria-label') === label);
    expect(button, `button ${label}`).toBeDefined();
    act(() => button?.click());
  };
  const clickMatching = (pattern: RegExp) => {
    const button = Array.from(container.querySelectorAll('button')).find((item) => pattern.test(item.textContent ?? ''));
    expect(button, `button matching ${pattern}`).toBeDefined();
    act(() => button?.click());
  };
  const clickAndFlush = async (label: string) => { await act(async () => { click(label); }); };
  const readyMemberEvents = (interestStatus: 'open' | 'closed' = 'open') => {
    const memberClub: PlayerClubSnapshot = { ...liveClub, memberships: [{
      id: 'published-member', clubId: liveClub.club.id, playerId: player.id, playerName: player.name,
      status: 'Active', joinedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2031-01-01T00:00:00.000Z', preferredGameIds: []
    }] };
    const otherClub: PlayerClubSnapshot = { ...liveClub, club: { ...liveClub.club, id: 'other-club', name: 'Other venue' }, games: [] };
    const event = publishedTournament(interestStatus);
    state.liveData.liveDataStatus = 'ready'; state.liveData.clubs = [memberClub, otherClub];
    state.liveData.selectedClubId = memberClub.club.id;
    state.liveData.tournaments = [event, { ...publishedTournament(), id: 'other-event', clubId: otherClub.club.id, name: 'Other venue event' }];
    return { memberClub, event };
  };
  const expectNoVenueMutation = () => {
    for (const callback of [state.clubs.joinWaitlist, state.clubs.cancelWaitlist, state.clubs.submitSeatRequest,
      state.clubs.openClubSignup, state.clubs.submitMembershipApplication, state.tournaments.expressInterest,
      state.tournaments.withdrawInterest, state.tournaments.registerTournament, state.identity.requireVerifiedAge]) expect(callback).not.toHaveBeenCalled();
  };
  const renderedMatchIds = (kind?: 'cash' | 'tournament') => Array.from(container.querySelectorAll(
    kind ? `[data-match-kind="${kind}"]` : '[data-match-id]'
  )).map((node) => node.getAttribute('data-match-id')).sort();

  beforeEach(() => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
    vi.clearAllMocks();
    state = fixtures();
    hooks.storage.mockImplementation(() => state.storage);
    hooks.identity.mockImplementation(() => state.identity);
    hooks.liveData.mockImplementation(() => state.liveData);
    hooks.clubs.mockImplementation(() => state.clubs);
    hooks.tournaments.mockImplementation(() => state.tournaments);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('waits for profile and secure sign-in restoration before showing a player experience', () => {
    state.storage.accountLoaded = false;
    render();
    expect(container.textContent).toContain('Restoring your Orbit Player account and secure sign-in...');
    expect(container.textContent).not.toContain('Normal onboarding');
    state.storage.accountLoaded = true;
    state.identity.authLoaded = false;
    render();
    expect(container.textContent).toContain('Restoring your Orbit Player account and secure sign-in...');
  });

  it('keeps normal onboarding connected to the existing account completion workflow', () => {
    state.storage.hasAccount = false;
    render();
    expect(container.textContent).toContain('Normal onboarding');
    click('Create profile');
    expect(state.identity.completeAccount).toHaveBeenCalledOnce();
  });
  it('connects first-use credentials through Firebase with the onboarding draft', () => {
    state.storage.hasAccount = false;
    render();
    click('Connect Firebase account');
    expect(state.identity.connectPlayerAccount).toHaveBeenCalledWith(state.storage.draftPlayer, false);
    expect(state.identity.completeAccount).not.toHaveBeenCalled();
  });
  it('preserves explicit sign-in intent so account recovery never creates another account', () => {
    state.storage.hasAccount = false;
    render();
    click('Sign in Firebase account');
    expect(state.identity.connectPlayerAccount).toHaveBeenCalledWith(state.storage.draftPlayer, true);
    expect(state.identity.completeAccount).not.toHaveBeenCalled();
  });
  it('opens a membership on its own route and returns to the club list', () => {
    const { memberClub } = readyMemberEvents();
    render();
    click('Clubs');
    expect(container.querySelector('[data-membership-details]')).toBeNull();
    click(`Membership details: ${memberClub.club.id}`);
    expect(container.querySelector('[data-membership-details="ready"]')).not.toBeNull();
    expect(state.liveData.setSelectedClubId).toHaveBeenCalledWith(memberClub.club.id);
    click('Extend membership');
    expect(state.clubs.openClubSignup).toHaveBeenCalledWith(memberClub);
    click('Back to memberships');
    expect(container.querySelector('[data-membership-details]')).toBeNull();
    expect(container.textContent).toContain('Membership clubs: 1');
  });
  it('keeps membership request confirmations and failures visible on the list route', () => {
    readyMemberEvents();
    state.liveData.clubMembershipMessage = 'Could not send your membership request. Try again.';
    render();
    click('Clubs');
    expect(container.textContent).toContain(state.liveData.clubMembershipMessage);
    expect(container.querySelector('[data-membership-details]')).toBeNull();
  });
  it('delegates free-event registration to the existing authenticated tournament workflow', () => {
    const { event } = readyMemberEvents();
    render();
    click('Events');
    click(`Register free: ${event.id}`);
    expect(state.tournaments.registerTournament).toHaveBeenCalledWith(event);
  });
  it('blocks stale free-event registration before invoking a remote action', () => {
    const { event } = readyMemberEvents();
    state.liveData.tournamentDataStatus = 'error';
    render();
    click('Events');
    click(`Register free: ${event.id}`);
    expect(state.tournaments.registerTournament).not.toHaveBeenCalled();
  });
  it('opens existing Match preferences only after optional onboarding completion produces a valid account', async () => {
    state.storage.hasAccount = false;
    render();
    click('Set Match preferences');
    await act(async () => { await Promise.resolve(); });
    expect(state.identity.completeAccount).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Normal onboarding');
    expect(container.querySelector('[data-match-mode]')).toBeNull();
    state.storage.hasAccount = true;
    render();
    expect(container.querySelector('[data-match-mode="preferences"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Normal onboarding');
  });
  it('clears a failed optional route intent when normal onboarding completion is chosen', async () => {
    state.storage.hasAccount = false;
    render();
    click('Set Match preferences');
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain('Normal onboarding');
    click('Create profile');
    state.storage.hasAccount = true;
    render();
    expect(state.identity.completeAccount).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-match-mode]')).toBeNull();
    expect(container.querySelector('[data-inventory-status]')).not.toBeNull();
  });
  it('explains that device Match data remains separate from signed-in changes without promising migration', () => {
    render();
    click('Find games');
    expect(container.textContent).not.toContain("This device's Match data stays separate.");
    expect(container.textContent).not.toContain('signing in does not move these saves or preferences');
    click('Match preferences');
    expect(container.textContent).toContain("This device's Match data stays separate.");
    expect(container.textContent).toContain('Signed-in Match changes sync across devices');
    expect(container.textContent).toContain('signing in does not move these saves or preferences');
    click('Discover games');
    expect(container.textContent).not.toContain("This device's Match data stays separate.");
  });

  it('keeps secure initialization errors visible and retries the existing cleanup workflow', () => {
    state.identity.authInitializationError = 'Cleanup has not finished';
    render();
    expect(container.textContent).toContain('Secure sign-in needs attention');
    expect(container.textContent).toContain('Cleanup has not finished');
    click('Retry secure sign-in cleanup');
    expect(state.identity.retryAuthInitialization).toHaveBeenCalledOnce();
  });

  it('does not replace unavailable saved profile data with onboarding', () => {
    state.storage.hasAccount = false;
    state.storage.playerStorageError = 'Saved profile could not be read';
    render();
    expect(container.textContent).toContain('Saved profile data is unavailable');
    expect(container.textContent).not.toContain('Normal onboarding');
    click('Retry saved profile');
    expect(state.storage.retryPlayerStorage).toHaveBeenCalledOnce();
  });

  it('keeps the API-unconfigured warning for a real player profile and retries live data', () => {
    render();
    expect(container.textContent).toContain('Published venue data is unavailable');
    expect(container.textContent).toContain('Published venue sync is not configured.');
    click('Retry published data');
    expect(state.liveData.retryLiveData).toHaveBeenCalledOnce();
  });

  it('keeps published-game retry and demo entry readable after a transport failure', async () => {
    const error = 'Published venue data could not be refreshed: fetch failed: java.io.IOException on http://127.0.0.1:14639/...';
    let setSyncStatus: Parameters<typeof usePlayerLiveData>[0]['setSyncStatus'] | undefined;
    hooks.liveData.mockImplementation((options: Parameters<typeof usePlayerLiveData>[0]) => {
      setSyncStatus = options.setSyncStatus;
      return state.liveData;
    });
    render();
    await act(async () => { setSyncStatus?.(error); });
    expect(container.textContent).toContain('Could not connect to published games. Try again shortly.');
    expect(container.textContent).not.toContain('java.io');
    expect(container.textContent).not.toContain('127.0.0.1');
    expect(container.textContent).toContain('Published venue data is unavailable');
    click('Retry published data');
    expect(state.liveData.retryLiveData).toHaveBeenCalledOnce();
    expect(Array.from(container.querySelectorAll('button')).some((item) => item.textContent === 'Try sample account')).toBe(true);
  });

  it('keeps partial published-data failures readable with the existing retry action', () => {
    state.liveData.liveDataStatus = 'ready';
    state.liveData.tournamentLoadError = 'Network request failed';
    render();
    expect(container.textContent).toContain('Some published data could not be refreshed');
    expect(container.textContent).toContain('Could not connect to published games. Try again shortly.');
    expect(container.textContent).not.toContain('Network request failed');
    click('Retry published data');
    expect(state.liveData.retryLiveData).toHaveBeenCalledOnce();
  });

  it('uses the supplied ready venue inventory and preserves normal profile navigation', () => {
    hooks.liveData.mockImplementation(() => ({ ...state.liveData, liveDataStatus: 'ready', clubs: [liveClub] }));
    render();
    expect(container.textContent).toContain('Connected venue: 1/2 NLH');
    expect(container.textContent).not.toContain('Published venue data is unavailable');
    expect(container.querySelector('[data-inventory-status="ready"]')).not.toBeNull();
    click('Profile');
    expect(container.textContent).toContain('Normal profile settings');
  });

  it('makes Games the first tab and keeps discovery reachable in one tap with predictable back navigation', () => {
    hooks.liveData.mockImplementation(() => ({ ...state.liveData, liveDataStatus: 'ready', clubs: [liveClub] }));
    render();
    const firstTab = () => container.querySelector('button[role="tab"]');
    expect(firstTab()?.getAttribute('aria-label')).toBe('Games');
    expect(firstTab()?.textContent).toBe('');
    expect(firstTab()?.getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('[data-deck-status]')).toBeNull();
    click('Find games');
    expect(container.querySelector('[data-deck-status="ready"]')).not.toBeNull();
    expect(firstTab()?.getAttribute('aria-selected')).toBe('true');
    clickMatching(/^Details: /);
    expect(container.querySelector('[data-back-label="Matches"]')).not.toBeNull();
    click('Back from game');
    expect(container.querySelector('[data-deck-status="ready"]')).not.toBeNull();
    click('Back to Games');
    expect(container.querySelector('[data-inventory-status="ready"]')).not.toBeNull();
    click('Connected venue: 1/2 NLH');
    expect(container.querySelector('[data-back-label="Games"]')).not.toBeNull();
    click('Back from game');
    click('Events');
    expect(firstTab()?.getAttribute('aria-selected')).toBe('false');
    click('Games');
    expect(container.querySelector('[data-inventory-status="ready"]')).not.toBeNull();
    click('Map');
    click('Map games: real-club');
    expect(container.querySelector('[data-deck-status="ready"]')).not.toBeNull();
    expect(firstTab()?.getAttribute('aria-selected')).toBe('true');
  });

  it.each(['loading', 'error'] as const)('keeps fresh cash usable but hides unconfirmed events and counts during tournament %s', async (tournamentDataStatus) => {
    Object.assign(state.liveData, venueTypeInventory(), { liveDataStatus: 'ready', tournamentDataStatus });
    render(); await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('[data-event-count]')?.getAttribute('data-event-count')).toBe('unconfirmed');
    await clickAndFlush('Find games');
    expect(renderedMatchIds('cash')).toHaveLength(3);
    expect(renderedMatchIds('tournament')).toEqual([]);
    expect(container.querySelector('[data-deck-status]')?.getAttribute('data-deck-status')).toBe('ready');
    expect(container.querySelector('[data-deck-partial]')?.getAttribute('data-deck-partial')).toBe('true');
    expectNoVenueMutation();
  });

  it.each(['loading', 'error'] as const)('uses the tournament feed state for tournament-only Match during %s', async (tournamentDataStatus) => {
    Object.assign(state.liveData, venueTypeInventory(), { liveDataStatus: 'ready', tournamentDataStatus });
    persistence.loadMatchJournal.mockResolvedValueOnce({ uid: `device:${player.id}`, confirmed: createMatchState({ ...defaultMatchPreferences, format: 'tournament' }), pending: [] });
    render(); await act(async () => { await Promise.resolve(); });
    await clickAndFlush('Find games');
    expect(renderedMatchIds()).toEqual([]);
    expect(container.querySelector('[data-deck-status]')?.getAttribute('data-deck-status')).toBe(tournamentDataStatus);
    await clickAndFlush('Events');
    expect(container.querySelector('[data-events-readonly]')?.getAttribute('data-events-readonly')).toBe('true');
    expectNoVenueMutation();
  });

  it('keeps a ready partial tournament prefix visible without publishing a complete event count', async () => {
    Object.assign(state.liveData, venueTypeInventory(), { liveDataStatus: 'ready', tournamentDataPartial: true });
    render(); await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('[data-event-count]')?.getAttribute('data-event-count')).toBe('unconfirmed');
    await clickAndFlush('Find games');
    expect(renderedMatchIds('tournament')).toHaveLength(3);
    expect(container.querySelector('[data-deck-partial]')?.getAttribute('data-deck-partial')).toBe('true');
    expectNoVenueMutation();
  });

  it.each(['any', 'cash'] as const)('records an event-feed failure only when the %s discovery format includes it', async (format) => {
    Object.assign(state.liveData, venueTypeInventory(), { liveDataStatus: 'ready', tournamentDataStatus: 'error' });
    persistence.loadMatchJournal.mockResolvedValueOnce({ uid: `device:${player.id}`, confirmed: createMatchState({ ...defaultMatchPreferences, format }), pending: [] });
    render(); await act(async () => { await Promise.resolve(); });
    await clickAndFlush('Find games');
    const events = persistence.saveMatchJournal.mock.calls.flatMap(([, journal]) => journal.confirmed?.events ?? []);
    expect(events.some((event) => event.kind === 'load-failed')).toBe(format === 'any');
    expect(events.some((event) => event.kind === 'impression')).toBe(true);
    expect(events.some((event) => event.kind === 'empty')).toBe(false);
    expectNoVenueMutation();
  });

  it.each(['all', 'none'] as const)('keeps ordinary %s venue-type selection inclusive of house, club and casino cash games and events', async (gameType) => {
    const inventory = venueTypeInventory();
    Object.assign(state.liveData, inventory, { liveDataStatus: 'ready' });
    render(); await act(async () => { await Promise.resolve(); });
    await clickAndFlush('Find games'); await clickAndFlush('Show game filters');
    await clickAndFlush('Game type: all');
    if (gameType === 'all') await clickAndFlush('Game type: all');
    expect(container.querySelector('[data-game-type]')?.getAttribute('data-game-type')).toBe(gameType);
    await clickAndFlush('Close Game filters');
    expect(renderedMatchIds()).toEqual(inventory.clubs.flatMap(({ club }) => [`${club.id}-cash`, `${club.id}-event`]).sort());
    expectNoVenueMutation();
  });

  it('uses Match favorites for ordinary venue filtering without treating Poker clubs as Card houses', async () => {
    const inventory = venueTypeInventory();
    state.storage.player = { ...player, favoriteClubIds: ['kind-club'] };
    Object.assign(state.liveData, inventory, { liveDataStatus: 'ready' });
    render(); await act(async () => { await Promise.resolve(); });
    await clickAndFlush('Find games'); await clickAndFlush('Show game filters'); await clickAndFlush('Game type: favorites'); await clickAndFlush('Close Game filters');
    expect(renderedMatchIds()).toEqual(['kind-club-cash', 'kind-club-event']);
    await clickAndFlush('Show game filters'); await clickAndFlush('Game type: favorites'); await clickAndFlush('Close Game filters');
    expect(renderedMatchIds()).toHaveLength(6);
    expect(state.storage.setPlayer).not.toHaveBeenCalled();
    expectNoVenueMutation();
  });

  it('preserves the existing Card house filter for ordinary cash recommendations', async () => {
    Object.assign(state.liveData, venueTypeInventory(), { liveDataStatus: 'ready', tournaments: [] });
    render(); await act(async () => { await Promise.resolve(); });
    await clickAndFlush('Find games'); expect(renderedMatchIds('cash')).toHaveLength(3);
    await clickAndFlush('Show game filters'); await clickAndFlush('Game type: card-house'); await clickAndFlush('Close Game filters');
    expect(renderedMatchIds()).toEqual(['kind-house-cash']);
    expectNoVenueMutation();
  });

  it.each(['kind-house', 'kind-club', 'kind-casino'])('preserves an explicit ordinary cash venue selection for %s', async (clubId) => {
    Object.assign(state.liveData, venueTypeInventory(), { liveDataStatus: 'ready', tournaments: [] });
    render(); await act(async () => { await Promise.resolve(); });
    await clickAndFlush('Find games'); await clickAndFlush('Show game filters');
    await clickAndFlush('Filter all houses'); await clickAndFlush('Filter all casinos');
    await clickAndFlush(`Filter venue: ${clubId}`); await clickAndFlush('Close Game filters');
    expect(renderedMatchIds()).toEqual([`${clubId}-cash`]);
    expectNoVenueMutation();
  });

  it('keeps saved casino cash and event records accessible when ordinary venue-type filters change', async () => {
    Object.assign(state.liveData, venueTypeInventory(), { liveDataStatus: 'ready' });
    render(); await act(async () => { await Promise.resolve(); });
    await clickAndFlush('Find games');
    await clickAndFlush('Save: kind-casino 1/2 NLH'); await clickAndFlush('Save: kind-casino NLH event');
    expect(container.textContent).toContain('Saved games: 2');
    const preferences = container.querySelector('[data-match-preferences]')?.getAttribute('data-match-preferences');
    await clickAndFlush('Show game filters'); await clickAndFlush('Game type: card-house'); await clickAndFlush('Close Game filters');
    expect(renderedMatchIds('cash')).toEqual(['kind-house-cash']);
    await clickAndFlush('Open Match saves');
    expect(Array.from(container.querySelectorAll('[data-saved-id]')).map((node) => node.getAttribute('data-saved-id')).sort()).toEqual(['kind-casino-cash', 'kind-casino-event']);
    expect(Array.from(container.querySelectorAll('[data-saved-club]')).every((node) => node.getAttribute('data-saved-club') === 'kind-casino')).toBe(true);
    expect(container.querySelector('[data-match-preferences]')?.getAttribute('data-match-preferences')).toBe(preferences);
    expect(state.storage.setPlayer).not.toHaveBeenCalled();
    expectNoVenueMutation();
  });

  it.each(['any', 'tournament'] as const)('applies Card house venue type to scheduled events with %s Match format', async (format) => {
    Object.assign(state.liveData, venueTypeInventory(), { liveDataStatus: 'ready' });
    if (format === 'tournament') persistence.loadMatchJournal.mockResolvedValueOnce({
      uid: `device:${player.id}`, confirmed: createMatchState({ ...defaultMatchPreferences, format }), pending: []
    });
    render(); await act(async () => { await Promise.resolve(); });
    await clickAndFlush('Find games');
    expect(renderedMatchIds()).toHaveLength(format === 'any' ? 6 : 3);
    const preferences = container.querySelector('[data-match-preferences]')?.getAttribute('data-match-preferences');
    await clickAndFlush('Show game filters'); await clickAndFlush('Game type: card-house');
    expect(container.querySelector('[data-game-type]')?.getAttribute('data-game-type')).toBe('card-house');
    await clickAndFlush('Close Game filters');
    expectNoVenueMutation();
    expect(container.querySelector('[data-match-preferences]')?.getAttribute('data-match-preferences')).toBe(preferences);
    expect(renderedMatchIds()).toEqual(format === 'any' ? ['kind-house-cash', 'kind-house-event'] : ['kind-house-event']);
  });

  it.each(['map-house', 'map-casino'])('shows only the selected venue cash games and events after Map handoff to %s', async (clubId) => {
    const inventory = mapVenueInventory();
    Object.assign(state.liveData, inventory, { liveDataStatus: 'ready' });
    render(); await act(async () => { await Promise.resolve(); });
    await clickAndFlush('Map'); await clickAndFlush(`Map games: ${clubId}`);
    const recommendations = Array.from(container.querySelectorAll('[data-match-club]'));
    expect(recommendations.map(node => node.getAttribute('data-match-club'))).toEqual([clubId, clubId]);
    expect(recommendations.map(node => node.getAttribute('data-match-kind')).sort()).toEqual(['cash', 'tournament']);
    expect(recommendations.map(node => node.getAttribute('data-match-id')).sort()).toEqual([`${clubId}-event`, `${clubId}-game`]);
    for (const callback of [state.clubs.joinWaitlist, state.clubs.submitSeatRequest, state.tournaments.expressInterest, state.tournaments.withdrawInterest]) expect(callback).not.toHaveBeenCalled();
  });

  it.each(['map-house', 'map-casino'])('replaces conflicting transient search and filters when Map opens %s', async (clubId) => {
    const inventory = mapVenueInventory();
    Object.assign(state.liveData, inventory, { liveDataStatus: 'ready' });
    render(); await act(async () => { await Promise.resolve(); });
    await clickAndFlush('Find games'); await clickAndFlush('Search games'); await clickAndFlush('Use unmatched game search'); await clickAndFlush('Close game search');
    await clickAndFlush('Show game filters'); await clickAndFlush('Use conflicting discovery filters');
    await clickAndFlush(`Filter venue: ${clubId === 'map-casino' ? 'other-casino' : 'other-house'}`);
    expect(container.querySelector('[data-stakes-filter]')?.getAttribute('data-stakes-filter')).toBe('999/999');
    await clickAndFlush('Close Game filters');
    expect(container.querySelectorAll('[data-match-club]')).toHaveLength(0);
    await clickAndFlush('Map'); await clickAndFlush(`Map games: ${clubId}`);
    expect(Array.from(container.querySelectorAll('[data-match-club]')).map(node => node.getAttribute('data-match-club'))).toEqual([clubId, clubId]);
    await clickAndFlush('Search games'); expect(container.querySelector('[data-game-search]')?.getAttribute('data-game-search')).toBe(''); await clickAndFlush('Close game search');
    await clickAndFlush('Show game filters');
    const filters = container.querySelector('[data-game-type]');
    expect(filters?.getAttribute('data-game-type')).toBe('all');
    expect(filters?.getAttribute('data-house-filter')).toBe(clubId === 'map-house' ? clubId : 'none');
    expect(filters?.getAttribute('data-casino-filter')).toBe(clubId === 'map-casino' ? clubId : 'none');
    expect(filters?.getAttribute('data-stakes-filter')).toBe('');
    expect(filters?.getAttribute('data-fit-filter')).toBe('false');
    for (const callback of [state.clubs.joinWaitlist, state.clubs.submitSeatRequest, state.tournaments.expressInterest, state.tournaments.withdrawInterest]) expect(callback).not.toHaveBeenCalled();
  });

  it.each(['map-house', 'map-casino'])('preserves restored Match exclusions and strict preferences while Map opens %s', async (clubId) => {
    const inventory = mapVenueInventory();
    const preferences: MatchPreferences = { ...defaultMatchPreferences, excludedClubIds: [clubId], variants: ['plo'], strictVariants: true,
      stakes: { minBigBlind: 2, maxBigBlind: 5 }, strictStakes: true, favoriteClubIds: ['other-house'] };
    persistence.loadMatchJournal.mockResolvedValueOnce({ uid: `device:${player.id}`, confirmed: createMatchState(preferences), pending: [] });
    Object.assign(state.liveData, inventory, { liveDataStatus: 'ready' });
    render(); await act(async () => { await Promise.resolve(); });
    await clickAndFlush('Find games');
    expect(JSON.parse(container.querySelector('[data-match-preferences]')?.getAttribute('data-match-preferences') ?? 'null')).toEqual(preferences);
    const journalWritesBefore = persistence.saveMatchJournal.mock.calls.length;
    await clickAndFlush('Map'); await clickAndFlush(`Map games: ${clubId}`);
    expect(container.querySelectorAll('[data-match-club]')).toHaveLength(0);
    expect(JSON.parse(container.querySelector('[data-match-preferences]')?.getAttribute('data-match-preferences') ?? 'null')).toEqual(preferences);
    await clickAndFlush('Show game filters');
    expect(container.querySelector('[data-house-filter]')?.getAttribute('data-house-filter')).toBe(clubId === 'map-house' ? clubId : 'none');
    expect(container.querySelector('[data-casino-filter]')?.getAttribute('data-casino-filter')).toBe(clubId === 'map-casino' ? clubId : 'none');
    const laterJournals = persistence.saveMatchJournal.mock.calls.slice(journalWritesBefore);
    expect(laterJournals.every(([, journal]) => journal.pending.every(operation => operation.type === 'event'))).toBe(true);
    expect(state.storage.setPlayer).not.toHaveBeenCalled();
    for (const callback of [state.clubs.joinWaitlist, state.clubs.submitSeatRequest, state.tournaments.expressInterest, state.tournaments.withdrawInterest]) expect(callback).not.toHaveBeenCalled();
  });

  it.each(['ready', 'error'] as const)('puts Match before published requests and preserves cancellation guards with %s inventory', (inventoryStatus) => {
    const entry: PlayerWaitlistEntry = { id: 'qa-request', clubId: liveClub.club.id, gameId: liveClub.games[0].id,
      playerId: player.id, playerName: player.name, status: 'Confirmed Coming', position: 0, requestedAt: '2026-10-10T00:00:00.000Z' };
    const club = { ...liveClub, waitlists: [entry] };
    state.liveData.clubs = [club]; state.liveData.liveDataStatus = inventoryStatus;
    state.clubs.gameRequestMessage = 'Published request update message';
    render(); click('Find games');
    const requests = container.querySelector('[data-requests-readonly]');
    const match = container.querySelector('[data-deck-status]');
    expect(requests).not.toBeNull(); expect(match).not.toBeNull();
    if (!requests || !match) throw new Error('Both Match and published requests must render.');
    expect(match.compareDocumentPosition(requests) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(requests?.getAttribute('data-requests-readonly')).toBe(String(inventoryStatus !== 'ready'));
    expect(requests?.textContent).toContain('Published request update message');
    click('Cancel: 1/2 NLH');
    if (inventoryStatus === 'ready') expect(state.clubs.cancelWaitlist).toHaveBeenCalledWith(club, club.games[0], entry);
    else expect(state.clubs.cancelWaitlist).not.toHaveBeenCalled();
  });

  it.each(['onboarding', 'loading', 'secure initialization error', 'profile storage error', 'API error', 'profile'] as const)(
    'offers the populated demo from %s without creating or replacing the real account',
    (entry) => {
      if (entry === 'onboarding' || entry === 'profile storage error') state.storage.hasAccount = false;
      if (entry === 'loading') state.storage.accountLoaded = false;
      if (entry === 'secure initialization error') state.identity.authInitializationError = 'Cleanup has not finished';
      if (entry === 'profile storage error') state.storage.playerStorageError = 'Saved profile could not be read';
      render();
      if (entry === 'profile') click('Profile');
      click('Try sample account');
      expect(container.querySelector('[aria-label="Sample account"]')).not.toBeNull();
      expect(container.textContent).not.toContain('Published venue data is unavailable');
      const demoInventory = container.querySelector('[data-inventory-status="ready"]');
      expect(demoInventory?.querySelectorAll('button').length).toBeGreaterThan(4);
      expect(state.storage.player).toBe(player);
      expect(state.storage.setPlayer).not.toHaveBeenCalled();
      expect(state.storage.setDraftPlayer).not.toHaveBeenCalled();
      expect(state.storage.setHasAccount).not.toHaveBeenCalled();
      expect(state.storage.clearLocalPlayer).not.toHaveBeenCalled();
      expect(state.identity.completeAccount).not.toHaveBeenCalled();
      expect(state.identity.signOutPlayer).not.toHaveBeenCalled();
    }
  );

  it('returns from saved game details to Saved mode and opens preferences from Profile', async () => {
    render();
    click('Try sample account');
    click('Find games');
    await act(async () => { clickMatching(/^Save: /); });
    click('Open Match saves');
    expect(container.querySelector('[data-match-mode="saved"]')).not.toBeNull();
    clickMatching(/^Saved details: /);
    expect(container.querySelector('[data-back-label="Matches"]')).not.toBeNull();
    click('Back from game');
    expect(container.querySelector('[data-match-mode="saved"]')).not.toBeNull();
    click('Profile');
    click('Exit sample');
    click('Profile');
    click('Match preferences');
    expect(container.querySelector('[data-match-mode="preferences"]')).not.toBeNull();
    expect(state.storage.setPlayer).not.toHaveBeenCalled();
  });
  it.each([
    { filter: 'free', label: '$0 published buy-in', interestStatus: 'open', source: 'deck' },
    { filter: 'free', label: '$0 published buy-in', interestStatus: 'open', source: 'saved' },
    { filter: 'interested', label: 'My interests', interestStatus: 'open', source: 'deck' },
    { filter: 'interested', label: 'My interests', interestStatus: 'open', source: 'saved' },
    { filter: 'open', label: 'Interest open', interestStatus: 'closed', source: 'deck' },
    { filter: 'open', label: 'Interest open', interestStatus: 'closed', source: 'saved' }
  ] as const)('opens the selected published tournament from Match $source after Events $filter ($interestStatus)', async ({ filter, label, interestStatus, source }) => {
    const event = publishedTournament(interestStatus);
    state.liveData.liveDataStatus = 'ready'; state.liveData.clubs = [liveClub]; state.liveData.tournaments = [event];
    render();
    await act(async () => { await Promise.resolve(); });
    click('Events'); click('Show tournament filters'); click(label);
    expect(container.querySelector('[data-event-filter]')?.getAttribute('data-event-filter')).toBe(filter);
    click('Close Tournament filters');
    expect(container.querySelector('[data-event-id="published-event"]')).toBeNull();
    click('Games'); click('Find games');
    if (source === 'saved') {
      await act(async () => { click(`Save: ${event.name}`); });
      click('Open Match saves'); await act(async () => { click(`Saved details: ${event.name}`); });
    } else await act(async () => { click(`Details: ${event.name}`); });
    const selected = container.querySelector('[data-event-id="published-event"]');
    expect(selected).not.toBeNull();
    expect(selected?.getAttribute('data-event-club')).toBe(event.clubId);
    expect(container.querySelector('[data-event-query]')?.getAttribute('data-event-query')).toBe(event.name);
    click('Show tournament filters');
    expect(container.querySelector('[data-event-filter]')?.getAttribute('data-event-filter')).toBe('all');
    expect(container.querySelector('[data-event-club-filter]')?.getAttribute('data-event-club-filter')).toBe(event.clubId);
    expect(state.tournaments.expressInterest).not.toHaveBeenCalled();
    expect(state.tournaments.withdrawInterest).not.toHaveBeenCalled();
    expect(state.identity.requireVerifiedAge).not.toHaveBeenCalled();
  });
  it('preserves ordinary Events filters through tab navigation and a cash-game details round trip', async () => {
    state.liveData.liveDataStatus = 'ready'; state.liveData.clubs = [liveClub]; state.liveData.tournaments = [publishedTournament()];
    render();
    await act(async () => { await Promise.resolve(); });
    click('Events'); click('Show tournament filters'); click('My interests'); click('Close Tournament filters');
    click('Games'); click('Events'); click('Show tournament filters');
    expect(container.querySelector('[data-event-filter]')?.getAttribute('data-event-filter')).toBe('interested');
    click('Close Tournament filters'); click('Games'); click('Find games');
    await act(async () => { click('Details: 1/2 NLH'); });
    click('Back from game');
    click('Events'); click('Show tournament filters');
    expect(container.querySelector('[data-event-filter]')?.getAttribute('data-event-filter')).toBe('interested');
    expect(container.querySelector('[data-event-club-filter]')?.getAttribute('data-event-club-filter')).toBe('all');
    expect(container.querySelector('[data-event-query]')?.getAttribute('data-event-query')).toBe('');
  });

  it('opens the selected member club events from a clean Clubs entry without creating requests or interests', async () => {
    const { memberClub, event } = readyMemberEvents();
    await act(async () => { root.render(<PlayerApp />); });
    await clickAndFlush('Clubs');
    expect(container.querySelector('[data-club-events]')?.getAttribute('data-club-events')).toBe(memberClub.club.id);
    await clickAndFlush('View events');
    expect(Array.from(container.querySelectorAll('[data-event-id]')).map(node => node.getAttribute('data-event-id'))).toEqual([event.id]);
    expect(container.querySelector('[data-event-query]')?.getAttribute('data-event-query')).toBe('');
    await clickAndFlush('Show tournament filters');
    expect(container.querySelector('[data-event-filter]')?.getAttribute('data-event-filter')).toBe('all');
    expect(container.querySelector('[data-event-club-filter]')?.getAttribute('data-event-club-filter')).toBe(memberClub.club.id);
    expectNoVenueMutation();
  });

  it('preserves ordinary Events query and status through tabs and a cash-game details round trip', async () => {
    readyMemberEvents();
    await act(async () => { root.render(<PlayerApp />); });
    await clickAndFlush('Events'); await clickAndFlush('Use unmatched event search');
    await clickAndFlush('Show tournament filters'); await clickAndFlush('My interests'); await clickAndFlush('Close Tournament filters');
    await clickAndFlush('Games'); await clickAndFlush('Events'); await clickAndFlush('Show tournament filters');
    expect(container.querySelector('[data-event-filter]')?.getAttribute('data-event-filter')).toBe('interested');
    await clickAndFlush('Close Tournament filters');
    expect(container.querySelector('[data-event-query]')?.getAttribute('data-event-query')).toBe('Unmatched club event search');
    await clickAndFlush('Games'); await clickAndFlush('Find games'); await clickAndFlush('Details: 1/2 NLH');
    await clickAndFlush('Back from game'); await clickAndFlush('Events'); await clickAndFlush('Show tournament filters');
    expect(container.querySelector('[data-event-filter]')?.getAttribute('data-event-filter')).toBe('interested');
    expect(container.querySelector('[data-event-club-filter]')?.getAttribute('data-event-club-filter')).toBe('all');
    await clickAndFlush('Close Tournament filters');
    expect(container.querySelector('[data-event-query]')?.getAttribute('data-event-query')).toBe('Unmatched club event search');
    expectNoVenueMutation();
  });

  it.each([
    { filter: 'all', label: 'All events', interestStatus: 'open', search: true },
    { filter: 'free', label: '$0 published buy-in', interestStatus: 'open', search: false },
    { filter: 'interested', label: 'My interests', interestStatus: 'open', search: false },
    { filter: 'open', label: 'Interest open', interestStatus: 'closed', search: false },
    { filter: 'free', label: '$0 published buy-in', interestStatus: 'open', search: true },
    { filter: 'interested', label: 'My interests', interestStatus: 'open', search: true },
    { filter: 'open', label: 'Interest open', interestStatus: 'closed', search: true }
  ] as const)('opens member club events after stale Events $filter/search=$search without mutating venue state', async ({ filter, label, interestStatus, search }) => {
    const { memberClub, event } = readyMemberEvents(interestStatus);
    await act(async () => { root.render(<PlayerApp />); });
    await clickAndFlush('Events');
    if (search) await clickAndFlush('Use unmatched event search');
    await clickAndFlush('Show tournament filters'); await clickAndFlush(label);
    expect(container.querySelector('[data-event-filter]')?.getAttribute('data-event-filter')).toBe(filter);
    await clickAndFlush('Close Tournament filters');
    expect(container.querySelector(`[data-event-id="${event.id}"]`)).toBeNull();
    await clickAndFlush('Clubs');
    expect(container.querySelector('[data-club-events]')?.getAttribute('data-club-events')).toBe(memberClub.club.id);
    await clickAndFlush('View events');
    expect(Array.from(container.querySelectorAll('[data-event-id]')).map(node => node.getAttribute('data-event-id'))).toEqual([event.id]);
    expect(container.querySelector(`[data-event-id="${event.id}"]`)?.getAttribute('data-event-club')).toBe(memberClub.club.id);
    expect(container.querySelector('[data-event-query]')?.getAttribute('data-event-query')).toBe('');
    await clickAndFlush('Show tournament filters');
    expect(container.querySelector('[data-event-filter]')?.getAttribute('data-event-filter')).toBe('all');
    expect(container.querySelector('[data-event-club-filter]')?.getAttribute('data-event-club-filter')).toBe(memberClub.club.id);
    expectNoVenueMutation();
  });

  it('keeps demo browsing, requests, directions, and tournament intent isolated from live callbacks and persistence', () => {
    render();
    click('Try sample account');
    for (const method of Object.values(persistence)) method.mockClear();
    hooks.storage.mockClear();
    hooks.identity.mockClear();
    hooks.liveData.mockClear();
    click('Find games');
    clickMatching(/^Cancel: /);
    expect(container.textContent).toContain('These venues and games are fictional.');
    clickMatching(/^Details: /);
    click('Request demo seat');
    click('Demo directions');
    click('Demo access');
    click('Refresh demo data');
    click('Back from game');
    click('Events');
    clickMatching(/^Interest: /);
    clickMatching(/^Withdraw: /);
    click('Map');
    expect(container.textContent).toContain('Austin, TX');
    expect(container.textContent).toContain('Chicago, IL');
    expect(container.textContent).toContain('Denver, CO');
    expect(container.textContent).toContain('Las Vegas, NV');
    clickMatching(/^Map directions: /);
    clickMatching(/^Map access: /);
    click('Clubs');
    click('Club access');
    clickMatching(/^Club game: /);
    click('Profile');
    expect(container.textContent).toContain('Changes are not saved.');
    expect(container.textContent).not.toContain('Sample profile');
    expect(container.textContent).not.toContain('Normal profile settings');
    expect(hooks.storage).not.toHaveBeenCalled();
    expect(hooks.identity).not.toHaveBeenCalled();
    expect(hooks.liveData).not.toHaveBeenCalled();
    for (const method of Object.values(persistence)) expect(method).not.toHaveBeenCalled();
    for (const callback of [state.clubs.joinWaitlist, state.clubs.cancelWaitlist, state.clubs.openClubSignup,
      state.clubs.openDirections, state.clubs.submitMembershipApplication, state.clubs.submitSeatRequest,
      state.tournaments.expressInterest, state.tournaments.withdrawInterest]) expect(callback).not.toHaveBeenCalled();
    expect(platform.openDirections).not.toHaveBeenCalled();
    expect(state.storage.setPlayer).not.toHaveBeenCalled();
  });

  it('keeps demo feedback outside the scroll area and preserves dismissal and navigation cleanup', () => {
    render(); click('Try sample account'); click('Find games'); clickMatching(/^Cancel: /);
    const feedback = () => Array.from(container.querySelectorAll('[role="alert"]')).find(node => node.textContent?.includes('These venues and games are fictional.'));
    expect(feedback()).toBeDefined();
    expect(feedback()?.closest('[data-player-scroll]')).toBeNull();
    expect(state.clubs.cancelWaitlist).not.toHaveBeenCalled();
    click('Dismiss sample notice'); expect(feedback()).toBeUndefined();
    clickMatching(/^Cancel: /); expect(feedback()).toBeDefined();
    click('Profile'); expect(feedback()).toBeUndefined();
  });

  it('resets sample games and discovery decisions and reloads the full catalog when demo is reopened', async () => {
    render();
    click('Try sample account');
    const initialInventoryCount = container.querySelector('[data-inventory-status="ready"]')?.querySelectorAll('button').length;
    click('Find games');
    expect(container.textContent).toContain('Saved games: 0');
    await act(async () => { clickMatching(/^Save: /); });
    expect(container.querySelector('[data-details-readonly]')).toBeNull();
    expect(container.textContent).toContain('Saved games: 1');
    await act(async () => { clickMatching(/^Pass: /); });
    expect(container.querySelector('[aria-label="Demo options"]')).toBeNull();
    click('Profile');
    click('Reset sample games');
    expect(container.querySelector('[data-inventory-status="ready"]')?.querySelectorAll('button').length).toBe(initialInventoryCount);
    click('Find games');
    expect(container.textContent).toContain('Saved games: 0');
    expect(container.querySelector('[data-saved-games]')).toBeNull();
    click('Profile');
    click('Exit sample');
    expect(container.textContent).toContain('Published venue data is unavailable');
    click('Try sample account');
    expect(container.querySelector('[data-inventory-status="ready"]')?.querySelectorAll('button').length).toBe(initialInventoryCount);
  });

  it('returns from demo to the same connected account and its supplied published inventory', () => {
    hooks.liveData.mockImplementation(() => ({ ...state.liveData, liveDataStatus: 'ready', clubs: [liveClub] }));
    render();
    click('Profile');
    click('Try sample account');
    expect(container.textContent).not.toContain('Connected venue: 1/2 NLH');
    click('Profile');
    expect(container.textContent).toContain('Alex Example');
    hooks.storage.mockClear();
    hooks.identity.mockClear();
    hooks.liveData.mockClear();
    click('Exit sample');
    expect(container.textContent).toContain('Connected venue: 1/2 NLH');
    expect(container.textContent).not.toContain('Sample account');
    expect(hooks.storage).toHaveBeenCalledOnce();
    expect(hooks.identity).toHaveBeenCalledOnce();
    expect(hooks.liveData).toHaveBeenCalledOnce();
    expect(state.storage.player).toBe(player);
    expect(state.storage.setPlayer).not.toHaveBeenCalled();
    expect(state.storage.clearLocalPlayer).not.toHaveBeenCalled();
    expect(state.identity.signOutPlayer).not.toHaveBeenCalled();
    expect(state.identity.deletePlayerAccount).not.toHaveBeenCalled();
    click('Profile');
    expect(container.textContent).toContain('Normal profile settings');
  });
});
