import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  BadgeCheck,
  Bell,
  ChevronRight,
  Download,
  KeyRound,
  LockKeyhole,
  Plus,
  Users,
  X
} from 'lucide-react';
import branding from '../branding.config.json';
import type {
  Player as PokerTablePlayer,
  PokerTableDealerControl,
  PokerTableRevenueEstimate
} from './components/PokerTable';
import AppShell, { type PrimaryDestination, type ShellCommand } from './components/AppShell';
import FloorView from './components/FloorView';
import {
  createBackupEnvelope,
  getGameFrequencyRank,
  getTimerStatusFromSeconds,
  readBackupEnvelope,
  resolveGameId
} from './lib/appCore';
import { createRoomDataExport, downloadTextFile } from './lib/dataExport';
import { buildFloorActivityItems } from './features/floor/floorActivity';
import { AccountRecoveryValidationError, recoverAccountLogin } from './lib/accountRecovery';
import { validateMembershipQrCheckIn } from './lib/membershipQr';
import {
  findUniqueProfileReference,
  hasProfileReference
} from './lib/profileRelationships';
import { sendFirebasePasswordResetEmail, signInOrCreateFirebaseEmailAccount, signInToFirebaseWithEmail, signOutOfFirebase } from './lib/firebaseAuthFacade';
import { RecoveryBoundary } from './components/RecoveryBoundary';
import { getBalancePlans, parseGroupMeMessages, type BalancePlanResult } from './lib/resultBuilders';
import { validateLocalImport } from './lib/fileImportValidation';
import {
  nextYearDate,
  normalizeState,
  nowIso,
  seedState,
  todayDate,
  uid
} from './domain/state';
import {
  mergeImportedProfiles,
  parseCsvRows,
  parsePastedProfiles,
  profilesFromImportedRecords,
  type ProfileImportContext
} from './domain/profileImport';
import {
  correctWaitlistInterestTimestamp,
  ensureWaitlistInterest,
  getWaitlistDemandPrompt,
  patchWaitlistInterest,
  removeWaitlistInterest,
  upsertWaitlistInterest,
  type WaitlistDemandPrompt
} from './application/management/waitlistCommands';
import {
  getActivePlayerSessionsForTable,
  getAvailableSeatNumber as getAvailableSeatNumberFromState,
  movePlayerToTable as movePlayerToTableInState,
  seatPlayerInState as seatPlayerWithCommand,
  type SeatPlayerPayload,
  type SeatPlayerResult
} from './application/management/seatingCommands';
import {
  addPlayerBuyIn,
  addPlayerTime as addPlayerTimeInState,
  assignTableDealer,
  correctPlayerSession,
  endTableDealerAssignment,
  getPlayerSeatChangeError,
  markInterestPlayerLeft,
  markPlayerSessionLeft as markPlayerSessionLeftInState,
  recordTableDrop,
  recordTableHands,
  setTableCollectionMode as setTableCollectionModeInState
} from './application/management/playerSessionCommands';
import {
  applyDefaultTableCap,
  createBalancedTable as createBalancedTableInState,
  createDemandFormingTable,
  createFormingTable,
  createPhysicalTable as createPhysicalTableInState,
  createPlannedTable,
  startTableWithPlayers,
  switchRunningTableGame
} from './application/management/tableCommands';
import {
  correctTableTimestamp,
  recordTableLifecycleEvent,
  updateTableSession
} from './application/management/tableLifecycleCommands';
import {
  clearTableInState,
  deleteTableInState,
  mergeTableInState
} from './application/management/tableOperationsCommands';
import {
  buildPlayerProfile as buildPlayerProfileInState,
  checkProfileIntoClub,
  createActiveMemberProfile,
  deleteProfile as deleteProfileFromState,
  mergeDuplicateProfiles as mergeDuplicateProfilesInState,
  removeProfileFromClub as removeProfileFromClubInState,
  saveEditedProfile
} from './application/management/profileCommands';
import {
  activateInPersonMembership as activateInPersonMembershipInState,
  approveMembershipRequest as approveMembershipRequestInState
} from './application/management/membershipCommands';
import {
  getNightCloseLockError,
  getNightCloseReopenError,
  lockNightClose,
  reopenNightClose as reopenNightCloseInState,
  saveNightClose as saveNightCloseInState,
  signNightClose as signNightCloseInState
} from './application/management/closeoutCommands';
import {
  useStaffRequestNotifications,
  type StaffRequestNotice
} from './application/management/sync/staffRequestNotifications';
import { useManagementStartupSync } from './application/management/sync/useManagementStartupSync';
import {
  useManagementStorageSync,
  useManagementUpdatePreservation
} from './application/management/sync/useManagementPersistenceEvents';
import { useManagementPlayerUpdateSync } from './application/management/sync/useManagementPlayerUpdateSync';
import { useManagementPilotAccessRefresh } from './application/management/sync/useManagementPilotAccessRefresh';
import {
  createTournamentActions,
  formatTournamentTime,
  getNextTournamentLevel,
  getTournamentActivePlayers,
  getTournamentAverageStack,
  getTournamentEntries,
  getTournamentLevel,
  getTournamentLevelRemainingSeconds,
  getTournamentPrizePool,
  useSelectedTournament,
  useTournamentSelectionRepair,
  useTournamentWorkspaceState
} from './features/tournaments/tournamentWorkspace';
import {
  createMembershipQrDialogActions,
  createNewProfileDraft,
  useMembershipQrScanner,
  usePlayerDialogState,
  useProfileFormState,
  useProfileWorkspaceSelectors
} from './features/profiles/profileWorkspace';
import {
  useSettingsWorkspaceState,
  useSettingsWorkspaceSync,
  type BackendStatus
} from './features/settings/settingsWorkspace';
import {
  getNightCloseWorkspace,
  toLocalDateValue,
  useReportingWorkspaceSelectors,
  useReportingWorkspaceState
} from './features/reporting/reportingWorkspace';
import { useFloorWorkspaceState } from './features/floor/floorWorkspace';
import TableBuyInLedger from './features/floor/TableBuyInLedger';
import {
  useGamesWorkspaceState,
  type GroupMeCandidate
} from './features/games/gamesWorkspace';
import {
  canUseRendererFirebaseAuth,
  loadExistingManagementStateForAccount,
  loadManagementState,
  saveManagementState
} from './app/persistence/managementPersistence';
import {
  getCollectionProfile,
  getTableFinancialOverview
} from './domain/reporting';
import {
  getAccountKeyFromState,
  hasPersistedSignIn,
  isPilotAccessActive,
  managementStorageKey as storageKey,
  persistSignIn,
  restorePersistedSignIn,
  type ManagementSessionBinding,
  touchPersistedSignIn,
  safeAccountKeyPart,
  validatePilotKey
} from './domain/licensing';
import { hashStaffPin, verifyStaffSecret } from './domain/staffAuth';
import {
  buildAnalyticalReportPayload,
  type AnalyticalReportPayload
} from './domain/analytics';
import {
  getAverageStackForTable,
  getDemand,
  getPlayerLoggedHours,
  getRunningSessions,
  getSessionBuyIns,
  getStaffScripts,
  getViabilityState
} from './domain/operations';
import {
  activeInterestStatuses,
  getInClubInterests,
  getLikelyParticipants,
  getParticipantPool,
  getProfileForInterest,
  inactiveInterestStatuses
} from './domain/participants';
import type {
  AppRoute,
  AppState,
  CollectionProfile,
  GameConfig,
  GameSession,
  Interest,
  InterestStatus,
  PersistedAppState,
  PersistedStateRecord,
  PilotAccess,
  PlayerProfile,
  PlayerSession,
  StaffAccount,
  TableCap,
  TableEvent,
  TableEventType,
  TableTag,
  UsageEvent
} from './domain/types';
import './styles.css';

const BuilderView = React.lazy(() => import('./components/BuilderView'));
const KpisView = React.lazy(() => import('./components/KpisView'));
const ProfilesView = React.lazy(() => import('./components/ProfilesView'));
const SettingsView = React.lazy(() => import('./components/SettingsView'));
const SignalsView = React.lazy(() => import('./components/SignalsView'));
const SummaryView = React.lazy(() => import('./components/SummaryView'));
const TableView = React.lazy(() => import('./components/TableView'));
const TournamentsView = React.lazy(() => import('./components/TournamentsView'));
const TournamentTvView = React.lazy(() => import('./components/TournamentTvView'));

const withRouteLoadingBoundary = (content: React.ReactNode) => (
  <RecoveryBoundary label="This workspace">
    <React.Suspense fallback={(
      <main className="route-skeleton" aria-busy="true" aria-label="Loading view">
        <span className="route-skeleton-title" />
        <span className="route-skeleton-toolbar" />
        <span className="route-skeleton-panel" />
      </main>
    )}>
      {content}
    </React.Suspense>
  </RecoveryBoundary>
);

declare global {
  interface Window {
    tableManagerDesktop?: {
      platform: string;
      isDesktop: boolean;
      openWindow: (route: AppRoute, context?: { sessionId?: string; tournamentId?: string }) => Promise<void>;
      loadState: () => Promise<PersistedStateRecord | null>;
      loadStateForAccount: (access: PilotAccess) => Promise<PersistedStateRecord | null>;
      saveState: (state: AppState) => Promise<{ ok: boolean; path: string; accountKey?: string }>;
      preserveStateForUpdate: (requestId: string, state: AppState) => Promise<{ ok: boolean }>;
      onPrepareForUpdate: (callback: (requestId: string) => void) => () => void;
      getUpdateStatus: () => Promise<{ state: string; version?: string; message?: string; updateReady?: boolean }>;
      installDownloadedUpdate: () => Promise<{ ok: boolean; error?: string }>;
      onUpdateStatus: (callback: (status: { state: string; version?: string; message?: string; updateReady?: boolean }) => void) => () => void;
      getBackendStatus: () => Promise<BackendStatus>;
      validatePilotAccess: (access: PilotAccess) => Promise<{
        ok: boolean;
        managed: boolean;
        active: boolean;
        license?: { licenseId?: string; accountKey?: string; issuedTo?: string; expiresAt?: string; status?: string } | null;
        error?: string;
      }>;
      getManagementRecoveryStatus: (access: PilotAccess) => Promise<{
        ok: boolean;
        active: boolean;
        expiresAt?: string | null;
        username?: string;
        error?: string;
      }>;
      completeManagementRecovery: (payload: { access: PilotAccess; password: string }) => Promise<{
        ok: boolean;
        accountKey?: string;
        accountLogin?: {
          username: string;
          passwordSalt: string;
          passwordHash: string;
          lastLoginAt: string;
        };
        revision?: number;
        error?: string;
      }>;
      persistManagementSession: (binding: ManagementSessionBinding) => Promise<{ ok: boolean; active: boolean; expiresAt?: string }>;
      restoreManagementSession: (binding: ManagementSessionBinding) => Promise<{ ok: boolean; active: boolean; expiresAt?: string }>;
      clearManagementSession: (accountKey: string) => Promise<{ ok: boolean; active: boolean }>;
      verifyStaffPin: (payload: { staffId: string; pin: string; access: PilotAccess }) => Promise<{
        ok: boolean;
        token?: string;
        staffId?: string;
        role?: StaffAccount['role'];
        expiresAt?: string;
        error?: string;
      }>;
      authorizeStaffAction: (payload: { token: string; action: 'staff-sign' | 'manager-lock' | 'manager-reopen' | 'staff-admin' }) => Promise<{
        ok: boolean;
        error?: string;
      }>;
      submitAnalyticalReport: (report: AnalyticalReportPayload) => Promise<ReportSubmissionResult>;
      recordClientEvent: (
        event: string,
        category: string,
        details?: Record<string, string | number | boolean | null>,
        route?: AppRoute | 'access'
      ) => Promise<{ ok: boolean }>;
      sendTextMessages: (payload: TextMessageBatch, staffToken?: string) => Promise<TextMessageBatchResult>;
      recordClientError: (payload: {
        message: string;
        source?: string;
        route?: AppRoute | 'access';
        stack?: string;
        filename?: string;
        line?: number;
        column?: number;
        details?: Record<string, string | number | boolean | null>;
      }) => Promise<{ ok: boolean }>;
    };
  }
}

type UsageDescriptor = {
  feature: string;
  action: string;
  metadata?: Record<string, string | number | boolean>;
  route?: AppRoute | 'access';
};

type BrandTheme = typeof branding.theme.default;

type ReportSubmissionResult = {
  ok: boolean;
  id: string;
  accountKey: string;
  createdAt: string;
  deliveryStatus: 'stored' | 'queued' | 'delivered';
  backend: BackendStatus;
};

type TextMessagePayload = {
  to: string;
  body: string;
  profileId?: string;
  playerName?: string;
  gameId?: string;
  reason?: 'game-forming' | 'seat-opened';
};

type TextMessageBatch = {
  messages: TextMessagePayload[];
};

type TextMessageBatchResult = {
  ok: boolean;
  sent: number;
  skipped?: number;
  error?: string;
};

type BalancePlan = BalancePlanResult<
  GameConfig,
  ReturnType<typeof getDemand>,
  GameSession,
  Interest,
  PlayerProfile
>;

const statuses: InterestStatus[] = [
  'Interested',
  'Confirmed Coming',
  'Arrived',
  'Seated',
  'Declined',
  'No-Show',
  'Left Before Seated',
  'Removed'
];
const closedInterestStatuses: InterestStatus[] = ['Seated', 'Declined', 'No-Show', 'Left Before Seated', 'Removed'];
const gameQualityTags: TableTag[] = [
  'Social',
  'Action',
  'Relaxed',
  'Competitive',
  'Deep-Stacked',
  'Beginner-Friendly',
  'Short-handed',
  'Full-ring',
  'Fast-moving',
  'Slow-moving'
];
const failedStartReasons = ['not enough arrivals', 'players declined', 'wait too long', 'table fit concern', 'staff decision', 'other'];
const tableBreakReasons = ['too few players', 'players moved', 'players left', 'game merged', 'room closing', 'other'];
const memberId = () => `mem_${crypto.getRandomValues(new Uint32Array(2))[0].toString(16)}${crypto.getRandomValues(new Uint32Array(2))[1].toString(16)}`;
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
const formatClock = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '-');
const minutesSince = (iso?: string) => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) : 0);
const formatHours = (hours: number) => `${hours.toFixed(1)}h`;
const getTimeRemainingSeconds = (session: PlayerSession, nowMs = Date.now()) => {
  if (!session.timeFeeEnabled) return 0;
  const baseRemaining = (session.timeRemainingMinutes ?? 0) * 60;
  const lastTick = new Date(session.lastTimeTickAt ?? session.seatedAt).getTime();
  return Math.max(0, baseRemaining - Math.floor((nowMs - lastTick) / 1000));
};
const formatTimeLeft = (seconds: number) => {
  if (seconds <= 0) return '0:00';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  const clock = `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}` : clock;
};
const toDateTimeInput = (iso?: string) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
const fromDateTimeInput = (value: string) => (value ? new Date(value).toISOString() : undefined);
const cssBrandVariableMap: Record<keyof BrandTheme, string> = {
  ink: '--ink',
  muted: '--muted',
  canvas: '--canvas',
  panel: '--panel',
  panelSolid: '--panel-solid',
  line: '--line',
  lineStrong: '--line-strong',
  primary: '--primary',
  primaryDark: '--primary-dark',
  primarySoft: '--primary-soft',
  teal: '--teal',
  tealSoft: '--teal-soft',
  amber: '--amber',
  amberSoft: '--amber-soft',
  rose: '--rose',
  roseSoft: '--rose-soft',
  backgroundStart: '--background-start',
  backgroundAccentPrimary: '--background-accent-primary',
  backgroundAccentSecondary: '--background-accent-secondary'
};
const applyBrandTheme = (theme: BrandTheme) => {
  Object.entries(cssBrandVariableMap).forEach(([key, variable]) => {
    document.body.style.setProperty(variable, theme[key as keyof BrandTheme]);
  });
  document.body.style.setProperty('--brand-font-family', branding.theme.fontFamily);
};
function App() {
  const [state, setState] = useState<AppState>(() => loadManagementState());
  const [staffSession, setStaffSession] = useState<{ token: string; staffId: string; role: StaffAccount['role']; expiresAt: string } | null>(null);
  const getRouteFromHash = (): AppRoute =>
    window.location.hash.includes('tournament-tv')
      ? 'tournament-tv'
      : window.location.hash.includes('tournaments')
      ? 'tournaments'
      : window.location.hash.includes('table')
      ? 'table'
      : window.location.hash.includes('profiles')
      ? 'profiles'
      : window.location.hash.includes('summary')
        ? 'summary'
        : window.location.hash.includes('kpis')
          ? 'kpis'
        : window.location.hash.includes('customization') || window.location.hash.includes('settings')
          ? 'customization'
          : window.location.hash.includes('signals') || window.location.hash.includes('outreach')
            ? 'signals'
            : window.location.hash.includes('builder')
              ? 'builder'
              : 'floor';
  const [route, setRoute] = useState<AppRoute>(() => getRouteFromHash());
  const floorWorkspace = useFloorWorkspaceState(state);
  const {
    buyInDrafts,
    cashOutDraft,
    collapsedTables,
    dealerDrafts,
    dropDrafts,
    eventDrafts,
    financialOverviewTableId,
    form,
    formingGameId,
    handCountDrafts,
    openPanels,
    seatPicker,
    startPlayerDrafts,
    tableEventLogSessionId,
    tableLedgerSessionId,
    waitlistPopupOpen,
    setBuyInDrafts,
    setCashOutDraft,
    setCollapsedTables,
    setCustomTimeDrafts,
    setDealerDrafts,
    setDropDrafts,
    setEventDrafts,
    setFinancialOverviewTableId,
    setForm,
    setFormingGameId,
    setHandCountDrafts,
    setOpenPanels,
    setSeatPicker,
    setStartPlayerDrafts,
    setTableEventLogSessionId,
    setTableLedgerSessionId,
    setWaitlistPopupOpen
  } = floorWorkspace;
  const {
    checkInSearch,
    editingProfileId,
    importText,
    newProfile,
    profileEditDraft,
    profileFormMessage,
    profileSearch,
    setCheckInSearch,
    setEditingProfileId,
    setImportText,
    setNewProfile,
    setProfileEditDraft,
    setProfileFormMessage,
    setProfileSearch
  } = useProfileFormState();
  const reportingWorkspace = useReportingWorkspaceState();
  const {
    kpiCategory,
    nightCloseActuals,
    nightCloseNotes,
    reportAnchorDate,
    reportMode,
    reportPeriod,
    summaryNotes,
    setKpiCategory,
    setNightCloseActuals,
    setNightCloseNotes,
    setReportAnchorDate,
    setReportMode,
    setReportPeriod,
    setSummaryNotes
  } = reportingWorkspace;
  const {
    announceIncomingPlayerRequest,
    markStaffNotificationRead,
    replaceStaffNotifications,
    setStaffRequestNotice,
    staffNotifications,
    staffRequestNotice
  } = useStaffRequestNotifications();
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);
  const {
    coordinationConfig,
    gameFormatFilter,
    gameStakesFilter,
    gameStatusFilter,
    groupMeCandidates,
    groupMeText,
    setCoordinationConfig,
    setGameFormatFilter,
    setGameStakesFilter,
    setGameStatusFilter,
    setGroupMeCandidates,
    setGroupMeText
  } = useGamesWorkspaceState();
  const settingsWorkspace = useSettingsWorkspaceState(state);
  const {
    backendStatus,
    backupMessage,
    clubDraft,
    hasAuthenticated,
    loginDraft,
    passwordRecoveryNotice,
    passwordRecoveryStage,
    pendingPilotAccess,
    pilotKeyError,
    reportMessage,
    saveStatus,
    settingsSection,
    setupDraft,
    staffDraft,
    setBackendStatus,
    setBackupMessage,
    setClubDraft,
    setHasAuthenticated,
    setLoginDraft,
    setPasswordRecoveryNotice,
    setPasswordRecoveryStage,
    setPendingPilotAccess,
    setPilotKeyError,
    setReportMessage,
    setSaveStatus,
    setSettingsSection,
    setSetupDraft,
    setStaffDraft
  } = settingsWorkspace;
  const [accessFieldError, setAccessFieldError] = useState('');
  const [expiredDataExportMessage, setExpiredDataExportMessage] = useState('');
  const validateAccessField = (event: React.FocusEvent<HTMLInputElement>, matchesValue?: string) => {
    const input = event.currentTarget;
    const mismatch = matchesValue !== undefined && input.value !== matchesValue;
    setAccessFieldError(mismatch ? 'Password and confirmation do not match.' : input.validationMessage);
  };
  // The undo control was removed before this refactor; keep its write cadence until product scope decides whether to restore or remove it.
  const [, setUndoStack] = useState<AppState[]>([]);
  const tournamentWorkspace = useTournamentWorkspaceState();
  const {
    selectedTournamentId,
    setSelectedTournamentId,
    setTournamentDraft,
    setTournamentPayoutDrafts,
    setTournamentPlayerDraft,
    setTournamentSection,
    setTournamentView,
    tournamentDraft,
    tournamentPayoutDrafts,
    tournamentPlayerDraft,
    tournamentSection,
    tournamentView
  } = tournamentWorkspace;
  const stateRef = useRef(state);
  const {
    playerPopup,
    playerSection,
    qrManualValue,
    qrScanAttempt,
    qrScanMessage,
    qrScannerControlsRef,
    qrVideoRef,
    setPlayerPopup,
    setPlayerSection,
    setQrManualValue,
    setQrScanAttempt,
    setQrScanMessage
  } = usePlayerDialogState();
  const [clockNow, setClockNow] = useState(() => Date.now());
  const {
    analytics,
    nightCloseFinancials,
    nightCloseTotalProfit,
    reportAnalytics,
    reportDealerBreakdown,
    reportFinancials,
    reportHourlyBreakdown,
    reportIsCurrentPeriod,
    reportOpportunities,
    reportState,
    reportWindow,
    usageAnalytics
  } = useReportingWorkspaceSelectors({ clockNow, reportAnchorDate, reportPeriod, state });
  const participantPool = useMemo(
    () => getParticipantPool(state, coordinationConfig.gameId, coordinationConfig.seats),
    [state, coordinationConfig]
  );
  const likelyParticipants = useMemo(() => getLikelyParticipants(state), [state]);
  const staffScripts = useMemo(() => getStaffScripts(state), [state]);
  const inClubInterests = useMemo(() => getInClubInterests(state), [state]);
  const balancePlans = useMemo(
    () => getBalancePlans(state, { getDemand, getRunningSessions, getProfileForInterest }),
    [state]
  );
  const activeAccountKey = getAccountKeyFromState(state);
  const selectedTournament = useSelectedTournament(state.tournaments, selectedTournamentId);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useTournamentSelectionRepair(state.tournaments, selectedTournamentId, setSelectedTournamentId);

  useEffect(() => {
    const firstGameId = state.games[0]?.id;
    if (!firstGameId) return;
    const validGameIds = new Set(state.games.map((game) => game.id));

    if (!validGameIds.has(form.gameId)) {
      setForm((current) => ({ ...current, gameId: firstGameId }));
    }
    if (!validGameIds.has(newProfile.preferredGameId)) {
      setNewProfile((current) => ({
        ...current,
        preferredGameId: firstGameId,
        preferredGameIds: [firstGameId]
      }));
    }
    if (!validGameIds.has(coordinationConfig.gameId)) {
      setCoordinationConfig((current) => ({ ...current, gameId: firstGameId }));
    }
  }, [state.games, form.gameId, newProfile.preferredGameId, coordinationConfig.gameId]);

  const {
    activeMemberProfiles,
    approvedMembershipProfiles,
    checkInMatches,
    duplicateProfiles,
    membershipDirectoryProfiles,
    pendingMembershipProfiles,
    todayPlayerActivity
  } = useProfileWorkspaceSelectors({ checkInSearch, profileSearch, state, toLocalDateValue });

  useEffect(() => {
    const seenPlayers = new Set<string>();
    const inClubPlayers = inClubInterests
      .slice()
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
      .filter((interest) => {
        const key = interest.profileId || interest.playerName.toLowerCase();
        if (seenPlayers.has(key)) return false;
        seenPlayers.add(key);
        return true;
      });
    if (inClubPlayers.length < 14) return;

    const accountKey = getAccountKeyFromState(state);
    const promptKey = `${storageKey}:two-table-prompt:${accountKey}:${inClubPlayers.length}`;
    if (localStorage.getItem(promptKey)) return;

    const gameCounts = new Map<string, number>();
    inClubPlayers.forEach((interest) => gameCounts.set(interest.gameId, (gameCounts.get(interest.gameId) ?? 0) + 1));
    const primaryGameId = [...gameCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? state.games[0]?.id;
    const primaryGameName = state.games.find((game) => game.id === primaryGameId)?.name ?? 'the main game';
    const preferredFirst = inClubPlayers
      .slice()
      .sort((left, right) => (right.gameId === primaryGameId ? 1 : 0) - (left.gameId === primaryGameId ? 1 : 0))
      .slice(0, 14);
    const tableOne = preferredFirst.filter((_, index) => index % 2 === 0).slice(0, 7);
    const tableTwo = preferredFirst.filter((_, index) => index % 2 === 1).slice(0, 7);

    localStorage.setItem(promptKey, nowIso());
    window.alert(
      `14 players are in the club. Consider forming two ${primaryGameName} tables.\n\n` +
        `Table 1: ${tableOne.map((interest) => interest.playerName).join(', ')}\n\n` +
        `Table 2: ${tableTwo.map((interest) => interest.playerName).join(', ')}`
    );
  }, [inClubInterests, state]);

  useManagementStartupSync({
    hasAuthenticated,
    setHasAuthenticated,
    setSaveStatus,
    setState,
    setUndoStack,
    state
  });

  useEffect(() => {
    document.body.classList.toggle('low-light', state.settings.lowLight);
    applyBrandTheme(state.settings.lowLight ? branding.theme.lowLight : branding.theme.default);
    document.title = branding.product.name;
  }, [state.settings.lowLight]);

  useEffect(() => {
    if (!hasAuthenticated) return;
    let idleTimer = 0;
    const expireSession = async () => {
      await persistSignIn(state, false);
      await signOutOfFirebase().catch(() => undefined);
      setStaffSession(null);
      setHasAuthenticated(false);
    };
    const refreshIdleSession = () => {
      const staysSignedIn = touchPersistedSignIn(state);
      window.clearTimeout(idleTimer);
      if (!staysSignedIn) idleTimer = window.setTimeout(() => void expireSession(), 30 * 60 * 1000);
    };
    refreshIdleSession();
    window.addEventListener('keydown', refreshIdleSession);
    window.addEventListener('pointerdown', refreshIdleSession);
    return () => {
      window.clearTimeout(idleTimer);
      window.removeEventListener('keydown', refreshIdleSession);
      window.removeEventListener('pointerdown', refreshIdleSession);
    };
  }, [hasAuthenticated, state.settings.pilotAccess?.licenseId]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useManagementUpdatePreservation(state);

  useEffect(() => {
    // Backend status is advisory; the shell retains its initial disconnected status if unavailable.
    window.tableManagerDesktop?.getBackendStatus()
      .then((status) => setBackendStatus(status))
      .catch(() => undefined);
  }, []);

  useManagementPilotAccessRefresh({ setState, state });

  useSettingsWorkspaceSync({ setClubDraft, setHasAuthenticated, state });

  useManagementStorageSync(setState);

  useEffect(() => {
    const syncRoute = () => {
      setRoute(getRouteFromHash());
    };

    window.addEventListener('hashchange', syncRoute);
    return () => window.removeEventListener('hashchange', syncRoute);
  }, []);

  useManagementPlayerUpdateSync({
    activeAccountKey,
    announceIncomingPlayerRequest,
    hasAuthenticated,
    setSaveStatus,
    setState,
    setUndoStack,
    state,
    stateRef
  });

  useEffect(() => {
    const reportError = (payload: {
      message: string;
      source?: string;
      stack?: string;
      filename?: string;
      line?: number;
      column?: number;
    }) => {
      // Error telemetry must never recurse into a renderer failure.
      window.tableManagerDesktop?.recordClientError({ ...payload, route }).catch(() => undefined);
    };
    const onError = (event: ErrorEvent) => {
      reportError({
        message: event.message || 'Renderer error',
        source: 'renderer-window-error',
        stack: event.error?.stack || '',
        filename: event.filename,
        line: event.lineno,
        column: event.colno
      });
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      reportError({
        message: reason instanceof Error ? reason.message : String(reason || 'Unhandled promise rejection'),
        source: 'renderer-unhandled-rejection',
        stack: reason instanceof Error ? reason.stack || '' : ''
      });
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, [route]);

  const withUsageEvent = (next: AppState, usage?: UsageDescriptor): AppState => {
    if (!usage) return next;
    const activeStaff = next.settings.staffAccounts.find((staff) => staff.id === next.settings.activeStaffId);
    const event: UsageEvent = {
      id: uid(),
      feature: usage.feature,
      action: usage.action,
      route: usage.route ?? route,
      timestamp: nowIso(),
      staffId: activeStaff?.id,
      staffName: activeStaff?.name,
      staffRole: activeStaff?.role,
      accountKey: getAccountKeyFromState(next),
      metadata: usage.metadata
    };
    // Usage telemetry is best-effort and never changes the state mutation result.
    window.tableManagerDesktop?.recordClientEvent(
      usage.action.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'usage-event',
      'usage',
      {
        feature: usage.feature,
        action: usage.action,
        accountKey: event.accountKey,
        staffRole: activeStaff?.role ?? '',
        staffName: activeStaff?.name ?? '',
        ...(usage.metadata ?? {})
      },
      event.route
    ).catch(() => undefined);
    return {
      ...next,
      usageEvents: [
        event,
        ...(next.usageEvents ?? [])
      ].slice(0, 5000)
    };
  };

  const persist = (nextState: AppState, trackUndo = true, usage?: UsageDescriptor) => {
    const next = withUsageEvent(nextState, usage);
    if (trackUndo) {
      setUndoStack((previous) => [state, ...previous].slice(0, 5));
    }
    setState(next);
    setSaveStatus({ state: 'saving', message: 'Saving...' });
    saveManagementState(next)
      .then((result) => {
        if (!result.ok) {
          setSaveStatus({ state: 'error', message: result.error || 'Saved to cache only; server reconciliation required' });
          return;
        }
        setSaveStatus({
          state: result.cloud === 'failed' ? 'error' : 'saved',
          message: result.cloud === 'published'
            ? `Published ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
            : result.cloud === 'failed'
              ? 'Server saved; player projection failed and will retry'
              : 'Server saved; player projection pending'
        });
      })
      .catch((error) => {
        setSaveStatus({
          state: 'error',
          message: error instanceof Error ? `Save failed: ${error.message}` : 'Save failed'
        });
      });
  };

  const addInterest = (event: React.FormEvent) => {
    event.preventDefault();
    const playerName = form.playerName.trim();
    if (!playerName) return;
    const existingProfile = state.profiles.find(
      (profile: { name: string; }) => profile.name.trim().toLowerCase() === playerName.toLowerCase()
    );
    if (form.status === 'Seated') {
      const openSessions = getOpenSeatSessions(form.gameId);
      const selectedOpenSession = form.tableId ? openSessions.find((session) => session.id === form.tableId) : undefined;
      if (form.tableId && !selectedOpenSession) {
        window.alert('Choose an open table for this game.');
        return;
      }
      const openSession = selectedOpenSession ?? (
        openSessions.length === 1
          ? openSessions[0]
          : undefined
      );
      if (!openSession && openSessions.length > 1) {
        window.alert('Choose which table to seat this player at.');
        return;
      }
      if (openSession) {
        const requestedSeatNumber = form.seatNumber.trim() ? Number(form.seatNumber) : undefined;
        const initialBuyIn = form.initialBuyIn.trim() ? Number(form.initialBuyIn) : undefined;
        if (requestedSeatNumber !== undefined && (!Number.isInteger(requestedSeatNumber) || requestedSeatNumber <= 0)) {
          window.alert('Enter a valid seat number.');
          return;
        }
        if (initialBuyIn !== undefined && (!Number.isFinite(initialBuyIn) || initialBuyIn <= 0)) {
          window.alert('Enter a valid initial buy-in amount.');
          return;
        }
        const targetProfile = existingProfile ?? buildPlayerProfile(playerName, openSession.gameId, {
          notes: 'Created from Quick Add seating'
        });
        const seatingState = existingProfile ? state : { ...state, profiles: [...state.profiles, targetProfile] };
        const result = seatPlayerInState(seatingState, openSession.id, {
          playerName,
          profileId: targetProfile.id,
          requestedSeatNumber,
          initialBuyIn,
          note: form.notes.trim() || 'Seated from Quick Add'
        });
        if (!result.ok) {
          window.alert(result.error);
          return;
        }
        persist(result.state, true, {
          feature: 'Seating',
          action: existingProfile ? 'Quick seated player' : 'Quick seated new profile',
          metadata: { gameId: openSession.gameId, tableId: openSession.id, seatNumber: result.seatNumber }
        });
        setForm({ ...form, playerName: '', notes: '', tableId: '', seatNumber: '', initialBuyIn: '' });
        return;
      }
      window.alert('No open seats are available for that game.');
      return;
    }
    const result = upsertWaitlistInterest(state, {
      playerName,
      gameId: form.gameId,
      status: form.status,
      notes: form.notes
    }, { createId: uid, nowIso });
    const nextState = applyWaitlistDemandPrompt(result.state, result.demandPrompt);
    persist(nextState, true, {
      feature: 'Waitlist',
      action: result.updatedExisting ? 'Updated active member status' : 'Added interest',
      metadata: { status: form.status, gameId: form.gameId }
    });
    setForm({ ...form, playerName: '', notes: '', tableId: '', seatNumber: '', initialBuyIn: '' });
  };

  const checkInProfileFromSearch = (profile: PlayerProfile) => {
    const existingInterest = findUniqueProfileReference(
      state.interests,
      state.profiles,
      profile,
      (interest) => !inactiveInterestStatuses.includes(interest.status)
    );
    setForm({
      playerName: profile.name,
      gameId: existingInterest?.gameId ?? profile.preferredGameIds[0] ?? form.gameId,
      status: existingInterest?.status ?? 'Confirmed Coming',
      notes: existingInterest?.notes ?? (profile.notes ? `Profile note: ${profile.notes}` : ''),
      tableId: '',
      seatNumber: '',
      initialBuyIn: ''
    });
    setCheckInSearch('');
    window.requestAnimationFrame(() => document.getElementById('quick-add-status')?.focus());
  };

  const updateInterest = (id: string, patch: Partial<Interest>) => {
    const result = patchWaitlistInterest(state, id, patch, { nowIso });
    persist(
      applyWaitlistDemandPrompt(result.state, result.demandPrompt),
      true,
      { feature: 'Waitlist', action: patch.status ? 'Updated status' : 'Edited interest', metadata: { status: patch.status ?? '', interestId: id } }
    );
  };

  // Kept as a named application boundary for the characterized correction workflow.
  const updateInterestTimestamp = (id: string, key: 'interestedAt' | 'confirmedAt' | 'arrivedAt' | 'seatedAt' | 'closedAt', value: string) => {
    const nextValue = fromDateTimeInput(value);
    persist(correctWaitlistInterestTimestamp(state, id, key, nextValue, { createId: uid, nowIso }));
  };

  const updatePlayerSession = (sessionId: string, patch: Partial<PlayerSession>, editKey: string) => {
    persist(correctPlayerSession(state, sessionId, patch, editKey, { createId: uid, nowIso }));
  };

  const changePlayerSeat = (playerSession: PlayerSession, seatNumber: number) => {
    const error = getPlayerSeatChangeError(state, playerSession, seatNumber);
    if (error) {
      window.alert(error);
      return;
    }
    updatePlayerSession(playerSession.id, { seatNumber }, 'seatNumber');
  };

  const setTableCollectionMode = (sessionId: string, collectionMode: 'Time' | 'Drop') => {
    persist(setTableCollectionModeInState(state, sessionId, collectionMode, { nowIso }));
  };

  const addPlayerTime = (playerSession: PlayerSession, minutes: number) => {
    const result = addPlayerTimeInState(state, playerSession, minutes, { createId: uid, nowIso, nowMs: Date.now });
    if (!result.ok) return;
    persist(result.state, true, { feature: 'Table time', action: 'Added player time', metadata: { minutes, gameId: playerSession.gameId } });
    setCustomTimeDrafts((drafts) => ({ ...drafts, [playerSession.id]: '' }));
  };

  const addBuyIn = (playerSession: PlayerSession, amountOverride?: number, noteOverride?: string) => {
    const draft = buyInDrafts[playerSession.id] ?? { amount: '', note: '' };
    const amount = amountOverride ?? Number(draft.amount);
    const note = noteOverride ?? draft.note.trim();
    const result = addPlayerBuyIn(state, playerSession, amount, note, { createId: uid, nowIso });
    if (!result.ok) {
      if (result.error) window.alert(result.error);
      return;
    }
    persist(result.state, true, { feature: 'Buy-ins', action: 'Added buy-in', metadata: { amount, gameId: playerSession.gameId } });
    setBuyInDrafts((drafts) => ({ ...drafts, [playerSession.id]: { amount: '', note: '' } }));
  };

  const addTableDrop = (session: GameSession) => {
    const draft = dropDrafts[session.id] ?? { amount: '', note: '' };
    const amount = Number(draft.amount);
    const result = recordTableDrop(state, session, amount, draft.note, { createId: uid, nowIso });
    if (!result.ok) {
      if (result.error) window.alert(result.error);
      return;
    }
    persist(result.state, true, { feature: 'Drop tracking', action: 'Recorded table drop', metadata: { amount, gameId: session.gameId } });
    setDropDrafts((drafts) => ({ ...drafts, [session.id]: { amount: '', note: '' } }));
  };

  const assignDealer = (session: GameSession, dealerNameOverride?: string) => {
    const dealerName = dealerNameOverride ?? dealerDrafts[session.id] ?? '';
    const result = assignTableDealer(state, session, dealerName, { createId: uid, nowIso });
    if (!result.ok) {
      if (result.error) window.alert(result.error);
      return;
    }
    persist(result.state, true, { feature: 'Dealer tracking', action: 'Assigned dealer', metadata: { dealerName: dealerName.trim(), tableId: session.id } });
  };

  const endDealerAssignment = (session: GameSession) => {
    persist(endTableDealerAssignment(state, session, { nowIso }), true, {
      feature: 'Dealer tracking',
      action: 'Ended dealer assignment',
      metadata: { tableId: session.id }
    });
  };

  const recordHands = (session: GameSession) => {
    const hands = Number(handCountDrafts[session.id]);
    const result = recordTableHands(state, session, hands, { createId: uid, nowIso });
    if (!result.ok) {
      if (result.error) window.alert(result.error);
      return;
    }
    persist(result.state, true, { feature: 'Hand tracking', action: 'Recorded hands', metadata: { hands, tableId: session.id } });
    setHandCountDrafts((drafts) => ({ ...drafts, [session.id]: '' }));
  };

  const deleteInterest = (id: string) => {
    if (!window.confirm('Remove this interest entry?')) return;
    persist(removeWaitlistInterest(state, id), true, {
      feature: 'Waitlist',
      action: 'Removed interest'
    });
  };

  const getSeatOptions = (gameId: string) =>
    state.interests.filter(
      (interest) =>
        interest.gameId === gameId &&
        !closedInterestStatuses.includes(interest.status)
    );

  const getAvailableSeatNumber = (session: GameSession, requestedSeat?: number) =>
    getAvailableSeatNumberFromState(state, session, requestedSeat);

  const getOpenSeatSessions = (gameId?: string) =>
    state.sessions
      .filter((session) => session.status !== 'Closed' && session.status !== 'Failed to Start')
      .filter((session) => !gameId || session.gameId === gameId)
      .filter((session) => Boolean(getAvailableSeatNumber(session)))
      .sort((a, b) => {
        const aRunning = a.status === 'Running' ? 0 : 1;
        const bRunning = b.status === 'Running' ? 0 : 1;
        return aRunning - bRunning || a.startedAt.localeCompare(b.startedAt);
      });

  const getGameName = (gameId?: string) => state.games.find((game) => game.id === gameId)?.name ?? gameId ?? 'Unknown game';

  const getGamePlayEntries = (profile: PlayerProfile) =>
    Object.entries(profile.gamePlayCounts ?? {})
      .filter(([, count]) => count > 0)
      .sort((left, right) => right[1] - left[1] || getGameName(left[0]).localeCompare(getGameName(right[0])));

  const getMostPlayedGameId = (profile: PlayerProfile) => getGamePlayEntries(profile)[0]?.[0] ?? profile.mostPlayedGameId ?? profile.preferredGameId;

  const getMostPlayedGameName = (profile: PlayerProfile) => getGameName(getMostPlayedGameId(profile));

  const getClubDisplayName = (sourceState = state) =>
    sourceState.settings.clubAccount?.clubName?.trim() ||
    sourceState.settings.clubAccount?.accountName?.trim() ||
    branding.product.name;

  const buildPlayerProfile = (
    name: string,
    gameId: string,
    patch: Partial<PlayerProfile> = {}
  ): PlayerProfile => buildPlayerProfileInState(
    state,
    name,
    gameId,
    patch,
    { createProfileId: memberId, todayDate, nextYearDate }
  );

  const getInAppNotificationRecipients = (sourceState: AppState, gameId: string) => {
    const activeProfileIds = new Set(
      sourceState.playerSessions
        .filter((playerSession) => !playerSession.leftAt)
        .map((playerSession) => playerSession.profileId)
        .filter(Boolean)
    );
    const activePlayerNames = new Set(
      sourceState.playerSessions
        .filter((playerSession) => !playerSession.leftAt)
        .map((playerSession) => playerSession.playerName.trim().toLowerCase())
    );

    return sourceState.profiles.filter(
      (profile) =>
        (getGameFrequencyRank(profile.gamePlayCounts, gameId) === 1 || getGameFrequencyRank(profile.gamePlayCounts, gameId) === 2) &&
        !activeProfileIds.has(profile.id) &&
        !activePlayerNames.has(profile.name.trim().toLowerCase())
    );
  };

  const withGameFrequencyInAppNotifications = (
    sourceState: AppState,
    gameId: string,
    reason: 'game-forming' | 'seat-opened'
  ) => {
    const game = sourceState.games.find((item) => item.id === gameId);
    if (!game) return sourceState;

    const recipients = getInAppNotificationRecipients(sourceState, gameId);
    if (!recipients.length) return sourceState;

    const cardHouse = getClubDisplayName(sourceState);
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
    const body =
      reason === 'game-forming'
        ? `${game.name} is forming right now at ${cardHouse}! Text back to get on the waitlist`
        : `A seat has opened for ${game.name} at ${cardHouse}! Text back to get on the waitlist`;
    return {
      ...sourceState,
      inAppNotifications: [
        ...recipients.map((profile) => ({
          id: uid(),
          clubId: getAccountKeyFromState(sourceState),
          gameId,
          title: game.name,
          body,
          reason,
          createdAt,
          expiresAt,
          targetPlayerIds: [profile.id],
          targetPlayerNames: [profile.name]
        })),
        ...sourceState.inAppNotifications.filter((notification) => !notification.expiresAt || notification.expiresAt > createdAt).slice(0, 200)
      ]
    };
  };

  const seatPlayerInState = (
    sourceState: AppState,
    tableId: string,
    payload: SeatPlayerPayload
  ): SeatPlayerResult => seatPlayerWithCommand(sourceState, tableId, payload, { createId: uid, nowIso });

  const addSessionToState = (sourceState: AppState, gameId: string, note = 'Table forming') => {
    return createDemandFormingTable(sourceState, gameId, note, { createId: uid, nowIso })?.state ?? sourceState;
  };

  const switchOpenTableToGame = (sourceState: AppState, targetGameId: string) => {
    return switchRunningTableGame(sourceState, targetGameId, { createId: uid, nowIso }).state;
  };

  const applyWaitlistDemandPrompt = (sourceState: AppState, prompt: WaitlistDemandPrompt | null) => {
    if (!prompt) return sourceState;
    const choice = window.prompt(prompt.message, prompt.defaultChoice);
    if (!choice) return sourceState;
    if (choice.trim().toLowerCase().startsWith('switch')) return switchOpenTableToGame(sourceState, prompt.gameId);
    if (choice.trim().toLowerCase().startsWith('start')) {
      return addSessionToState(sourceState, prompt.gameId, `Prompted by ${prompt.activeCount} interested players`);
    }
    return sourceState;
  };

  const promptDemandAction = (sourceState: AppState, gameId: string) =>
    applyWaitlistDemandPrompt(sourceState, getWaitlistDemandPrompt(sourceState, gameId));

  const getSeatPickerCandidates = (session: GameSession, query = '') => {
    const seatedProfileIds = new Set(
      state.playerSessions
        .filter((playerSession) => !playerSession.leftAt)
        .map((playerSession) => playerSession.profileId)
        .filter(Boolean)
    );
    const seatedNames = new Set(
      state.playerSessions
        .filter((playerSession) => !playerSession.leftAt)
        .map((playerSession) => playerSession.playerName.trim().toLowerCase())
        .filter(Boolean)
    );
    const queryParts = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return state.profiles
      .filter((profile) => {
        if (seatedProfileIds.has(profile.id) || seatedNames.has(profile.name.trim().toLowerCase())) return false;
        if (!queryParts.length) return true;
        const haystack = [
          profile.name,
          profile.phone,
          profile.preferredStakes,
          profile.notes,
          ...(profile.preferredGameIds || []).map((gameId) => state.games.find((game) => game.id === gameId)?.name || gameId)
        ].join(' ').toLowerCase();
        return queryParts.every((part) => haystack.includes(part));
      })
      .map((profile) => {
        const activeInterest = findUniqueProfileReference(
          state.interests,
          state.profiles,
          profile,
          (interest) => activeInterestStatuses.includes(interest.status)
        );
        const preferredGame = state.games.find((game) => game.id === (profile.preferredGameIds?.[0] || profile.preferredGameId));
        const isCheckedIn = Boolean(activeInterest?.status === 'Arrived' || activeInterest?.status === 'Seated');
        const gameContext = activeInterest
          ? state.games.find((game) => game.id === activeInterest.gameId)?.name
          : preferredGame?.name;
        return {
          profile,
          activeInterest,
          isCheckedIn,
          gameContext: gameContext || state.games.find((game) => game.id === session.gameId)?.name || 'Any game'
        };
      })
      .sort((left, right) => Number(right.isCheckedIn) - Number(left.isCheckedIn) || left.profile.name.localeCompare(right.profile.name));
  };

  const setSeatPickerError = (error: string) => {
    setSeatPicker((current) => (current ? { ...current, error } : current));
  };

  const openSeatPicker = (session: GameSession, requestedSeatNumber?: number) => {
    const seatNumber = getAvailableSeatNumber(session, requestedSeatNumber);
    setSeatPicker({
      sessionId: session.id,
      seatNumber: seatNumber ?? 0,
      search: '',
      timeMinutes: '',
      initialBuyIn: '',
      error: seatNumber ? undefined : 'Table full. No open seats remain.'
    });
  };

  const seatProfileAtTable = (
    session: GameSession,
    seatNumber: number,
    profile: PlayerProfile,
    initialTimeMinutes?: number,
    initialBuyIn?: number
  ) => {
    if (!seatNumber) {
      setSeatPickerError('Table full. No open seats remain.');
      return;
    }
    const isTimeCollection = session.collectionMode === 'Time' || session.timeFeeBased;
    const timeMinutes = isTimeCollection ? Math.max(0, Number(initialTimeMinutes ?? 0)) : undefined;
    if (isTimeCollection && !Number.isFinite(timeMinutes)) {
      setSeatPickerError('Enter a valid amount of purchased time.');
      return;
    }
    if (initialBuyIn !== undefined && (!Number.isFinite(initialBuyIn) || initialBuyIn <= 0)) {
      setSeatPickerError('Enter a valid initial buy-in amount.');
      return;
    }
    const timestamp = nowIso();
    const alreadyInClub = hasProfileReference(
      state.interests,
      state.profiles,
      profile,
      (interest) => activeInterestStatuses.includes(interest.status)
    );
    const checkedInState: AppState = alreadyInClub
      ? state
      : {
          ...state,
          interests: ensureWaitlistInterest(
            state,
            profile,
            session.gameId,
            'Arrived',
            'Checked in from table seat picker',
            timestamp,
            uid
          )
        };
    const interest = findUniqueProfileReference(
      checkedInState.interests,
      checkedInState.profiles,
      profile,
      (item) => item.gameId === session.gameId && activeInterestStatuses.includes(item.status)
    ) ?? findUniqueProfileReference(
      checkedInState.interests,
      checkedInState.profiles,
      profile,
      (item) => activeInterestStatuses.includes(item.status)
    );
    const result = seatPlayerInState(checkedInState, session.id, {
      playerName: profile.name,
      profileId: profile.id,
      interestId: interest?.id,
      requestedSeatNumber: seatNumber,
      initialTimeMinutes: timeMinutes,
      initialBuyIn,
      note: alreadyInClub ? 'Seated' : 'Checked in and seated'
    });
    if (!result.ok) {
      setSeatPickerError(result.error);
      return;
    }
    persist(result.state, true, {
      feature: 'Seating',
      action: alreadyInClub ? 'Seated player' : 'Checked in and seated player',
      metadata: { gameId: session.gameId, tableId: session.id, seatNumber: result.seatNumber, timeMinutes: timeMinutes ?? 0 }
    });
    setSeatPicker(null);
  };

  const seatTypedNameAtTable = (
    session: GameSession,
    seatNumber: number,
    playerName: string,
    initialTimeMinutes?: number,
    initialBuyIn?: number
  ) => {
    const trimmedName = playerName.trim();
    if (!trimmedName) {
      setSeatPickerError('Search or enter a player name before seating.');
      return;
    }
    if (!seatNumber) {
      setSeatPickerError('Table full. No open seats remain.');
      return;
    }
    const isTimeCollection = session.collectionMode === 'Time' || session.timeFeeBased;
    const timeMinutes = isTimeCollection ? Math.max(0, Number(initialTimeMinutes ?? 0)) : undefined;
    if (isTimeCollection && !Number.isFinite(timeMinutes)) {
      setSeatPickerError('Enter a valid amount of purchased time.');
      return;
    }
    if (initialBuyIn !== undefined && (!Number.isFinite(initialBuyIn) || initialBuyIn <= 0)) {
      setSeatPickerError('Enter a valid initial buy-in amount.');
      return;
    }
    const existingProfile = state.profiles.find((profile) => profile.name.trim().toLowerCase() === trimmedName.toLowerCase());
    const targetProfile = existingProfile ?? buildPlayerProfile(trimmedName, session.gameId, {
      notes: 'Created from table seating'
    });
    const seatingState = existingProfile ? state : { ...state, profiles: [...state.profiles, targetProfile] };
    const result = seatPlayerInState(seatingState, session.id, {
      playerName: trimmedName,
      profileId: targetProfile.id,
      requestedSeatNumber: seatNumber,
      initialTimeMinutes: timeMinutes,
      initialBuyIn,
      note: existingProfile ? 'Seated from table picker' : 'Created profile and seated'
    });
    if (!result.ok) {
      setSeatPickerError(result.error);
      return;
    }
    persist(result.state, true, {
      feature: 'Seating',
      action: existingProfile ? 'Seated player' : 'Created profile and seated player',
      metadata: { gameId: session.gameId, tableId: session.id, seatNumber: result.seatNumber, timeMinutes: timeMinutes ?? 0 }
    });
    setSeatPicker(null);
  };

  const seatInterestAtTable = (interest: Interest, tableId?: string, seatNumber?: number) => {
    const table = tableId
      ? state.sessions.find((session: { id: string; status: string; }) => session.id === tableId && session.status !== 'Closed' && session.status !== 'Failed to Start')
      : state.sessions.find((session: { gameId: string; status: string; }) => session.gameId === interest.gameId && session.status !== 'Closed' && session.status !== 'Failed to Start');
    if (!table) {
      updateInterest(interest.id, { status: 'Seated' });
      return;
    }
    const result = seatPlayerInState(state, table.id, {
      playerName: interest.playerName,
      profileId: interest.profileId,
      interestId: interest.id,
      requestedSeatNumber: seatNumber,
      note: 'Seated from waitlist'
    });
    if (!result.ok) {
      window.alert(result.error);
      return;
    }
    persist(result.state, true, { feature: 'Seating', action: 'Seated player', metadata: { gameId: interest.gameId, tableId: table.id, seatNumber: result.seatNumber } });
  };

  const toggleStartPlayer = (sessionId: string, interestId: string) => {
    setStartPlayerDrafts((drafts) => {
      const current = drafts[sessionId] ?? [];
      return {
        ...drafts,
        [sessionId]: current.includes(interestId)
          ? current.filter((id) => id !== interestId)
          : [...current, interestId]
      };
    });
  };

  const startSessionWithPlayers = (session: GameSession) => {
    const selectedIds = startPlayerDrafts[session.id] ?? [];
    const triggeringCardHouse = getClubDisplayName(state);
    const result = startTableWithPlayers(
      state,
      session,
      selectedIds,
      triggeringCardHouse,
      { createId: uid, nowIso }
    );
    persist(result.state, true, {
      feature: 'Tables',
      action: 'Started table',
      metadata: { gameId: session.gameId, players: result.selectedPlayerCount + result.alreadySeatedCount }
    });
    window.setTimeout(() => {
      setSaveStatus({ state: 'saved', message: `Messaging trigger: ${triggeringCardHouse}` });
    }, 350);
    // Operational telemetry is best-effort; the completed table transition remains authoritative.
    window.tableManagerDesktop?.recordClientEvent('table-started', 'tables', {
      gameId: session.gameId,
      tableId: session.id,
      tableLabel: result.table?.label ?? session.label,
      playerCount: result.playerCount,
      selectedPlayers: result.selectedPlayerCount,
      alreadySeated: result.alreadySeatedCount
    }, route).catch(() => undefined);
    if (result.skippedErrors.length) {
      setSaveStatus({ state: 'error', message: result.skippedErrors[0] });
    }
    setStartPlayerDrafts((drafts) => ({ ...drafts, [session.id]: [] }));
  };

  const movePlayerToTable = (playerSession: PlayerSession, targetTableId: string) => {
    const result = movePlayerToTableInState(state, playerSession, targetTableId, { createId: uid, nowIso });
    if (!result.ok) {
      if (result.error) window.alert(result.error);
      return;
    }
    persist(result.state, true, {
      feature: 'Tables',
      action: 'Moved player',
      metadata: { fromTableId: playerSession.tableId, toTableId: targetTableId }
    });
  };

  const getMoveTargets = (sourceTableId: string) =>
    state.sessions
      .filter((session) => session.id !== sourceTableId && session.status !== 'Closed' && session.status !== 'Failed to Start')
      .map((session) => ({
        id: session.id,
        label: `${session.label} - ${state.games.find((game) => game.id === session.gameId)?.name ?? 'Table'}`,
        openSeats: Math.max(0, session.maxSeats - getActivePlayerSessionsForTable(state, session.id).length)
      }))
      .filter((target) => target.openSeats > 0);

  // Kept as a named application boundary: characterization coverage invokes this
  // transition directly even though the current view does not render its control.
  const markPlayerLeft = (interest: Interest) => {
    const result = markInterestPlayerLeft(state, interest, { nowIso });
    const finalState = result.notification
      ? withGameFrequencyInAppNotifications(result.state, result.notification.gameId, result.notification.reason)
      : result.state;
    persist(finalState);
  };

  const markPlayerSessionLeft = (playerSession: PlayerSession, cashOutAmount: number | undefined, cashOutNote = '') => {
    const result = markPlayerSessionLeftInState(
      state,
      playerSession,
      cashOutAmount,
      cashOutNote,
      { createId: uid, nowIso }
    );
    const finalState = withGameFrequencyInAppNotifications(
      result.state,
      result.notification.gameId,
      result.notification.reason
    );
    persist(finalState, true, { feature: 'Seating', action: 'Marked player left', metadata: { gameId: playerSession.gameId, tableId: playerSession.tableId } });
  };

  const requestPlayerCashOut = (playerSession: PlayerSession) => {
    setCashOutDraft({ playerSessionId: playerSession.id, amount: '', note: '' });
  };

  const addPhysicalTable = (labelInput: string, maxSeats: TableCap) => {
    const label = labelInput.trim();
    if (!label) return;
    const result = createPhysicalTableInState(state, label, maxSeats, { createId: uid, nowIso });
    if (!result) {
      window.alert('A permanent table with this name already exists.');
      return;
    }
    persist(result.state, true, {
      feature: 'Tables',
      action: 'Added permanent table',
      metadata: { label, maxSeats }
    });
  };

  const addSession = (gameId: string, physicalTableId?: string) => {
    const result = createFormingTable(state, gameId, { createId: uid, nowIso }, physicalTableId);
    if (!result) {
      if (physicalTableId) window.alert('That physical table is no longer available.');
      else if ((state.physicalTables ?? []).length) window.alert('No permanent tables are currently available.');
      return;
    }
    const createdSession = result.state.sessions.find((session) => session.id === result.sessionId);
    const notifiedState = withGameFrequencyInAppNotifications(result.state, gameId, 'game-forming');
    persist(notifiedState, true, {
      feature: 'Tables',
      action: 'Created forming table',
      metadata: {
        gameId,
        ...(createdSession?.physicalTableId ? { physicalTableId: createdSession.physicalTableId } : {})
      }
    });
    if (result.defaultStartPlayerIds.length) {
      setStartPlayerDrafts((drafts) => ({ ...drafts, [result.sessionId]: result.defaultStartPlayerIds }));
    }
  };

  const addPlannedSession = () => {
    const result = createPlannedTable(
      state,
      coordinationConfig.gameId,
      participantPool,
      { createId: uid, nowIso }
    );
    if (!result) {
      if ((state.physicalTables ?? []).length) window.alert('No permanent tables are currently available.');
      return;
    }
    persist(result.state, true, {
      feature: 'Table builder',
      action: 'Created planned table',
      metadata: { gameId: coordinationConfig.gameId, players: result.playerCount }
    });
  };

  const createBalancedTable = (plan: BalancePlan) => {
    const nextState = createBalancedTableInState(state, plan, { createId: uid, nowIso });
    if (!nextState) {
      if ((state.physicalTables ?? []).length) window.alert('No permanent table has enough open seats for this balance.');
      return;
    }
    persist(nextState, true, {
      feature: 'Table builder',
      action: 'Created balanced table',
      metadata: { gameId: plan.game.id, players: plan.tableBProjectedSeats }
    });
  };

  const updateSession = (id: string, patch: Partial<GameSession>) => {
    persist(updateTableSession(state, id, patch, { createId: uid, nowIso }));
  };

  const updateSessionTimestamp = (id: string, key: 'startedAt' | 'endedAt', value: string) => {
    const nextValue = fromDateTimeInput(value);
    persist(correctTableTimestamp(state, id, key, nextValue, { createId: uid, nowIso }));
  };

  const recordTableEvent = (session: GameSession, type: TableEventType, reason: string, note = '') => {
    persist(
      recordTableLifecycleEvent(state, session, type, reason, note, { createId: uid, nowIso }),
      true,
      { feature: 'Tables', action: type, metadata: { gameId: session.gameId, tableId: session.id, reason } }
    );
  };

  const failFormingGame = (session: GameSession) => {
    const draft = eventDrafts[session.id];
    recordTableEvent(session, 'Failed to Start', draft?.failReason || failedStartReasons[0], draft?.failNote ?? '');
  };

  const beginEditProfile = (profile: PlayerProfile) => {
    setEditingProfileId(profile.id);
    setProfileEditDraft({ ...profile });
    setProfileFormMessage('');
  };

  const cancelEditProfile = () => {
    setEditingProfileId(null);
    setProfileEditDraft(null);
  };

  const saveProfileEdit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!profileEditDraft) return;
    const result = saveEditedProfile(state, profileEditDraft);
    if (!result.ok) {
      setProfileFormMessage(result.message);
      return;
    }
    persist(result.state, true, {
      feature: 'Profiles',
      action: 'Updated profile',
      metadata: { profileId: result.profile.id }
    });
    setProfileFormMessage(result.message);
    cancelEditProfile();
  };

  const activateInPersonMembership = (profile: PlayerProfile) => {
    const result = activateInPersonMembershipInState(
      state,
      profile,
      { accountKey: getAccountKeyFromState(state), clubDisplayName: getClubDisplayName(state) },
      { createId: uid, nowDate: () => new Date() }
    );
    if (!result.ok) {
      if (result.message) setProfileFormMessage(result.message);
      return;
    }
    persist(result.state, true, {
      feature: 'Profiles',
      action: 'Activated in-person membership',
      metadata: { profileId: profile.id, plan: profile.membershipPlan || 'monthly' }
    });
    setProfileFormMessage(result.message);
  };

  const approveMembershipRequest = (profile: PlayerProfile) => {
    const result = approveMembershipRequestInState(
      state,
      profile,
      { accountKey: getAccountKeyFromState(state), clubDisplayName: getClubDisplayName(state) },
      { createId: uid, nowIso, nowMs: Date.now }
    );
    if (!result.ok) return;
    persist(result.state, true, {
      feature: 'Profiles',
      action: 'Approved membership application',
      metadata: { profileId: profile.id, plan: profile.membershipPlan || 'monthly' }
    });
    setProfileFormMessage(result.message);
  };

  const addProfile = (event: React.FormEvent) => {
    event.preventDefault();
    const result = createActiveMemberProfile(
      state,
      newProfile,
      { createProfileId: memberId, createId: uid, nowDate: () => new Date(), nowIso }
    );
    if (!result.ok) {
      if (result.code === 'duplicate-name') setProfileSearch(result.profileName);
      setProfileFormMessage(result.message);
      return;
    }
    persist(result.state, true, {
      feature: 'Profiles',
      action: 'Added profile',
      metadata: { preferredGameId: newProfile.preferredGameId }
    });
    setProfileFormMessage(result.message);
    setNewProfile(createNewProfileDraft());
  };

  const deleteProfile = (id: string) => {
    if (!window.confirm('Remove this profile? Existing sessions and interest entries will keep the player name.')) return;
    persist(deleteProfileFromState(state, id));
  };

  const updateScriptTemplate = (index: number, value: string) => {
    persist({
      ...state,
      scriptTemplates: state.scriptTemplates.map((template, templateIndex) => (templateIndex === index ? value : template))
    });
  };

  const exportPilotReport = () => {
    const report = buildAnalyticalReportPayload(state, analytics, usageAnalytics);
    const rows = [
      [branding.product.pilotReportName, new Date().toISOString()],
      ['Club', report.account.clubName],
      ['Account', report.account.accountName],
      ['Contact', report.account.contactName],
      ['Email', report.account.email],
      ['License', report.account.license],
      ['Occupied seat-hours', String(report.operational.occupiedSeatHours)],
      ['Average wait', `${report.operational.averageWaitMinutes}m`],
      ['Waitlist conversion', `${report.operational.waitlistConversionRate}%`],
      ['Games started', String(report.operational.gamesStarted)],
      ['Table breaks', String(report.operational.tableBreaks)],
      ['Failed starts', String(report.operational.failedStarts)],
      ['Estimated time-fee revenue', `$${report.operational.estimatedTimeFeeRevenue}`],
      ['Expired time seats', String(report.operational.expiredTimeFeeSeats)],
      ['Recorded table drop', `$${report.operational.recordedDropTotal}`],
      ['Estimated drop revenue', `$${report.operational.estimatedDropRevenue}`],
      [''],
      ['Collection by game', 'Time fees est.', 'Recorded drop', 'Estimated drop'],
      ...report.collectionByGame.map((entry) => [entry.game, `$${entry.timeRevenue.toFixed(2)}`, `$${entry.recordedDrop.toFixed(2)}`, `$${entry.estimatedDrop.toFixed(2)}`]),
      ['Usage events', report.usage.totalEvents.toString()],
      ['Usage events last 24h', report.usage.eventsLast24Hours.toString()],
      ['Usage events last 7d', report.usage.eventsLast7Days.toString()],
      [''],
      ['Feature usage', 'Count', 'Last used'],
      ...report.usage.features.map((entry) => [entry.feature, entry.count.toString(), entry.lastUsedAt]),
      [''],
      ['Action usage', 'Feature', 'Count', 'Last used'],
      ...report.usage.actions.map((entry) => [entry.action, entry.feature, entry.count.toString(), entry.lastUsedAt]),
      [''],
      ['Staff usage', 'Role', 'Count', 'Last used'],
      ...report.usage.staff.map((entry) => [entry.staffName, entry.staffRole, entry.count.toString(), entry.lastUsedAt]),
      [''],
      ['Recent usage events', 'Feature', 'Action', 'Staff', 'Route'],
      ...report.usage.recentEvents.map((entry) => [entry.timestamp, entry.feature, entry.action, entry.staffName ?? '', entry.route]),
      [''],
      ['Feedback count', state.feedback.length.toString()],
      ...report.feedback.map((entry) => [`${entry.role} feedback`, entry.text])
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const result = downloadTextFile({
      content: csv,
      fileName: `table-manager-pilot-${new Date().toISOString().slice(0, 10)}.csv`,
      mimeType: 'text/csv'
    });
    setReportMessage(result.ok ? 'Pilot report exported.' : `Pilot report export failed: ${result.error}`);
  };

  const submitAnalyticalReport = async () => {
    setReportMessage('Submitting report...');
    try {
      const result = await window.tableManagerDesktop?.submitAnalyticalReport(buildAnalyticalReportPayload(state, analytics, usageAnalytics));
      if (!result) {
        setReportMessage('Embedded backend is only available in the desktop app.');
        return;
      }
      setBackendStatus(result.backend);
      const deliveryLabel = result.deliveryStatus === 'delivered' ? 'delivered' : result.deliveryStatus === 'queued' ? 'queued for retry' : 'stored locally';
      setReportMessage(`Report ${deliveryLabel} at ${formatClock(result.createdAt)}.`);
      persist(state, false, { feature: 'Reporting backend', action: 'Submitted analytical report' });
    } catch (error) {
      setReportMessage(error instanceof Error ? `Report failed: ${error.message}` : 'Report failed.');
    }
  };

  const mergeDuplicateProfiles = (profilesToMerge: PlayerProfile[]) => {
    if (!profilesToMerge.length) return;
    persist(mergeDuplicateProfilesInState(state, profilesToMerge));
  };

  const addProfileToClub = (profile: PlayerProfile, sourceState = state) => {
    const result = checkProfileIntoClub(sourceState, profile, { createId: uid, nowIso });
    const nextState = promptDemandAction(result.state, result.preferredGameId);
    persist(nextState, true, {
      feature: 'Profiles',
      action: 'Checked player into club',
      metadata: { preferredGameId: result.preferredGameId, seated: false }
    });
  };

  const handleMembershipQrCheckIn = (rawValue: string) => {
    const sourceState = stateRef.current;
    const validation = validateMembershipQrCheckIn(rawValue, getAccountKeyFromState(sourceState), sourceState.profiles);
    if (!validation.ok) {
      const messages = {
        invalid: 'That is not a valid Orbit membership QR code.',
        'wrong-club': 'This membership belongs to a different card room.',
        'not-found': 'No matching member was found in this card room.',
        'approved-not-active': `${validation.profile?.name ?? 'This player'} is approved but not active. Verify ID and payment, then activate the membership first.`,
        inactive: `${validation.profile?.name ?? 'This player'} does not have an active membership.`
      };
      setQrScanMessage(messages[validation.code]);
      return;
    }
    const profile = validation.profile as PlayerProfile;

    const alreadyInClub = hasProfileReference(getInClubInterests(sourceState), sourceState.profiles, profile);
    if (alreadyInClub) {
      setQrScanMessage(`${profile.name} is already checked in.`);
      return;
    }

    addProfileToClub(profile, sourceState);
    setQrManualValue('');
    setQrScanMessage(`${profile.name} checked in successfully.`);
  };

  useMembershipQrScanner({
    onCode: handleMembershipQrCheckIn,
    playerPopup,
    qrScanAttempt,
    qrScannerControlsRef,
    qrVideoRef,
    setQrScanMessage
  });

  const {
    openQrScanner,
    restartQrScanner,
    submitQrManual
  } = createMembershipQrDialogActions({
    onCode: handleMembershipQrCheckIn,
    qrManualValue,
    qrScannerControlsRef,
    setPlayerPopup,
    setQrManualValue,
    setQrScanAttempt,
    setQrScanMessage
  });

  const removeProfileFromClub = (profile: PlayerProfile) => {
    persist(removeProfileFromClubInState(state, profile));
  };

  const profileImportContext: ProfileImportContext = {
    games: state.games,
    createProfileId: memberId,
    todayDate,
    nextYearDate,
    resolveGameId,
    validTableTags: gameQualityTags
  };

  const commitImportedProfiles = (imported: PlayerProfile[]) => {
    if (!imported.length) return;
    const result = mergeImportedProfiles(state.profiles, imported);
    persist({ ...state, profiles: result.profiles }, true, {
      feature: 'Profiles',
      action: 'Imported profiles',
      metadata: { count: result.importedProfiles.length }
    });
  };

  const importProfileFile = async (file?: File) => {
    if (!file) return;
    try {
      if (file.name.toLowerCase().endsWith('.csv')) {
        await validateLocalImport(file, 'profile-csv');
        const rows = parseCsvRows(await file.text());
        commitImportedProfiles(profilesFromImportedRecords(rows, profileImportContext));
        setImportText('');
        return;
      }
      await validateLocalImport(file, 'profile-xlsx');
      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const sheet = workbook.worksheets[0];
      const headerRow = sheet.getRow(1).values as unknown[];
      const headers = headerRow.slice(1).map((value) => String(value ?? '').trim());
      const rows: Record<string, unknown>[] = [];
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const values = row.values as unknown[];
        const record = headers.reduce<Record<string, unknown>>((next, header, index) => {
          if (header) next[header] = values[index + 1] ?? '';
          return next;
        }, {});
        if (Object.values(record).some((value) => String(value ?? '').trim())) rows.push(record);
      });
      commitImportedProfiles(profilesFromImportedRecords(rows, profileImportContext));
      setImportText('');
    } catch {
      window.alert('Unable to import that profile file.');
    }
  };

  const importProfiles = () => {
    if (!importText.trim()) return;
    commitImportedProfiles(parsePastedProfiles(importText, profileImportContext));
    setImportText('');
  };

  const {
    currentNightClose,
    effectiveNightCloseActuals,
    nightCloseHasMissingActual,
    nightCloseTables,
    nightCloseTotals,
    nightCloseWarnings
  } = getNightCloseWorkspace(state, nightCloseActuals);

  const saveNightClose = () => {
    const result = saveNightCloseInState(
      state,
      { current: currentNightClose, tables: nightCloseTables, warnings: nightCloseWarnings, notes: nightCloseNotes },
      currentNightClose?.status ?? 'Draft',
      { createId: uid, nowIso, todayDate }
    );
    if (!result.ok) return currentNightClose;
    persist(result.state, true, { feature: 'Night close', action: 'Saved reconciliation draft', route: 'summary' });
    return result.record;
  };

  const authorizeStaffAction = async (action: 'staff-sign' | 'manager-lock' | 'manager-reopen' | 'staff-admin') => {
    if (!staffSession || staffSession.staffId !== state.settings.activeStaffId || !window.tableManagerDesktop?.authorizeStaffAction) {
      window.alert('Select and verify an active staff account before this action.');
      return false;
    }
    const result = await window.tableManagerDesktop.authorizeStaffAction({ token: staffSession.token, action });
    if (!result.ok) {
      setStaffSession(null);
      window.alert(result.error || 'Staff reauthentication is required.');
      return false;
    }
    return true;
  };

  const signNightClose = async () => {
    if (!await authorizeStaffAction('staff-sign')) return;
    const result = signNightCloseInState(
      state,
      { current: currentNightClose, tables: nightCloseTables, warnings: nightCloseWarnings, notes: nightCloseNotes },
      nightCloseTotals,
      { createId: uid, nowIso, todayDate }
    );
    if (!result.ok) {
      if (result.message) window.alert(result.message);
      return;
    }
    persist(result.state, true,
      { feature: 'Night close', action: 'Staff signed reconciliation', route: 'summary', metadata: { discrepancy: Number(nightCloseTotals.discrepancy.toFixed(2)) } });
  };

  const approveAndLockNightClose = async () => {
    const validationError = getNightCloseLockError(state, currentNightClose);
    if (validationError) {
      window.alert(validationError);
      return;
    }
    if (!await authorizeStaffAction('manager-lock')) return;
    if (!window.confirm(
      `Lock tonight's reconciliation with a ${nightCloseTotals.discrepancy < 0 ? '-' : '+'}$${Math.abs(nightCloseTotals.discrepancy).toFixed(2)} discrepancy?\n\nThis will close every current table, remove all seated players, and reset Recent Activity.`
    )) return;
    if (!currentNightClose) return;
    const result = lockNightClose(
      state,
      { current: currentNightClose, tables: nightCloseTables, warnings: nightCloseWarnings, notes: nightCloseNotes },
      nightCloseTotals,
      analytics.currentNight,
      { createId: uid, nowIso, todayDate }
    );
    if (!result.ok) {
      if (result.message) window.alert(result.message);
      return;
    }
    persist(result.state, true, {
      feature: 'Night close',
      action: 'Manager approved and locked night',
      route: 'summary',
      metadata: { discrepancy: Number(nightCloseTotals.discrepancy.toFixed(2)) }
    });
  };

  const reopenNightClose = async () => {
    const validationError = getNightCloseReopenError(state, currentNightClose);
    if (validationError) {
      window.alert(validationError);
      return;
    }
    if (!await authorizeStaffAction('manager-reopen')) return;
    const reason = window.prompt('Reason for reopening this locked reconciliation:')?.trim();
    if (!reason || !currentNightClose) return;
    const result = reopenNightCloseInState(state, currentNightClose, reason, { createId: uid, nowIso, todayDate });
    if (!result.ok) {
      if (result.message) window.alert(result.message);
      return;
    }
    persist(result.state, true,
      { feature: 'Night close', action: 'Reopened locked reconciliation', route: 'summary' });
  };

  const exportJson = () => {
    const backup = createBackupEnvelope(state);
    const result = downloadTextFile({
      content: JSON.stringify(backup, null, 2),
      fileName: `table-manager-backup-${backup.exportedAt.slice(0, 10)}.json`,
      mimeType: 'application/json'
    });
    setBackupMessage(result.ok ? 'Restorable backup exported.' : `Backup export failed: ${result.error}`);
  };

  const downloadRoomDataExport = () => {
    const roomData = createRoomDataExport(state);
    return downloadTextFile({
      content: JSON.stringify(roomData, null, 2),
      fileName: `orbit-room-data-${roomData.exportedAt.slice(0, 10)}.json`,
      mimeType: 'application/json;charset=utf-8'
    });
  };

  const exportRoomData = () => {
    const result = downloadRoomDataExport();
    setBackupMessage(result.ok ? 'Room data exported.' : `Room data export failed: ${result.error}`);
  };

  const importBackupFile = async (file?: File) => {
    setBackupMessage('');
    if (!file) return;
    try {
      await validateLocalImport(file, 'backup-json');
      const parsed = JSON.parse(await file.text());
      const backup = readBackupEnvelope<PersistedAppState>(parsed);
      const restored = normalizeState(backup.state);
      if (!window.confirm(`Restore backup from ${backup.exportedAt || 'unknown date'}? This replaces the current local app state.`)) return;
      persist(restored, true, { feature: 'Data safety', action: 'Restored backup' });
      setBackupMessage('Backup restored.');
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : 'Unable to restore backup.');
    }
  };

  const exportCsv = () => {
    const rows = [
      ['Metric', 'Value'],
      ['Report period', reportWindow.label],
      ['Total profit (gross)', `$${reportFinancials.totalProfit.toFixed(2)}`],
      ['Time-fee payments', `$${reportFinancials.timeFees.toFixed(2)}`],
      ['Recorded table drop', `$${reportFinancials.recordedDrop.toFixed(2)}`],
      ['Membership revenue', `$${reportFinancials.membershipRevenue.toFixed(2)}`],
      ['Tournament revenue', `$${reportFinancials.tournamentRevenue.toFixed(2)}`],
      ['Hands logged', reportState.handCountLogs.reduce((sum, entry) => sum + entry.hands, 0).toString()],
      ['Occupied seat-hours', reportAnalytics.currentNight.occupiedSeatHours.toFixed(2)],
      ['Average seat-hours/player', reportAnalytics.averageSeatHoursPerPlayer.toFixed(2)],
      ['Average wait minutes', reportAnalytics.averageWaitMinutes.toFixed(0)],
      ['Waitlist conversion', `${(reportAnalytics.conversionRate * 100).toFixed(0)}%`],
      ['Games started', reportState.sessions.filter((session) => session.status !== 'Failed to Start').length.toString()],
      ['Failed starts', reportAnalytics.failedStarts.toString()],
      ['Table breaks', reportAnalytics.tableBreaks.toString()],
      ['Peak active tables', reportAnalytics.peakActiveTables.toString()],
      ['Median wait minutes', reportAnalytics.medianWaitMinutes.toFixed(0)],
      ['Confirmed to arrived', `${(reportAnalytics.confirmedArrivalRate * 100).toFixed(0)}%`],
      ['Waitlist abandonment', reportAnalytics.waitlistAbandonmentCount.toString()],
      ['Lost seat-hour estimate', reportAnalytics.lostSeatHourEstimate.toFixed(1)],
      ['Expired time-fee seats', reportAnalytics.expiredTimeFeeSeats.toString()],
      ['Estimated drop revenue', `$${reportAnalytics.estimatedDropRevenue.toFixed(2)}`],
      ...reportFinancials.collectionByGame.flatMap((item) => [
        [`Time fees revenue - ${item.game}`, `$${item.timeFees.toFixed(2)}`],
        [`Recorded drop - ${item.game}`, `$${item.recordedDrop.toFixed(2)}`],
        [`Estimated drop - ${item.game}`, `$${(reportAnalytics.collectionValueByGame.find((estimate) => estimate.game === item.game)?.estimatedDrop ?? 0).toFixed(2)}`]
      ]),
      ...reportHourlyBreakdown.flatMap((item) => {
        const start = new Date(item.startMs);
        const end = new Date(item.startMs + 36e5);
        const label = `${start.toLocaleDateString()} ${start.toLocaleTimeString([], { hour: 'numeric' })}-${end.toLocaleTimeString([], { hour: 'numeric' })}`;
        return [
          [`Hourly total - ${label}`, `$${item.total.toFixed(2)}`],
          [`Hourly drop - ${label}`, `$${item.drop.toFixed(2)}`],
          [`Hourly time fees - ${label}`, `$${item.timeFees.toFixed(2)}`],
          [`Hourly memberships/tournaments - ${label}`, `$${item.otherRevenue.toFixed(2)}`]
        ];
      }),
      ...reportDealerBreakdown.flatMap((dealer) => [
        [`Dealer hours - ${dealer.dealerName}`, dealer.hours.toFixed(2)],
        [`Dealer hands - ${dealer.dealerName}`, dealer.hands.toString()],
        [`Dealer hands/hour - ${dealer.dealerName}`, dealer.handsPerHour.toFixed(2)]
      ]),
      ...reportAnalytics.waitByGame.map((item) => [`Wait by game - ${item.game}`, item.count ? `${item.averageMinutes.toFixed(0)} minutes` : 'No seated waits']),
      ...reportState.tableEvents
        .filter((event: { type: string; }) => event.type === 'Failed to Start' || event.type === 'Broke')
        .map((event: TableEvent) => [`${event.type} reason`, `${event.reason || 'Unspecified'}${event.note ? ` - ${event.note}` : ''}`])
    ];
    const csv = rows.map((row) => row.map((cell: string) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
    const result = downloadTextFile({
      content: csv,
      fileName: `table-manager-${reportPeriod}-report-${reportAnchorDate}.csv`,
      mimeType: 'text/csv'
    });
    if (!result.ok) window.alert(`Report export failed: ${result.error}`);
  };

  const scanGroupMeText = () => {
    setGroupMeCandidates(parseGroupMeMessages(groupMeText, state.games, { createId: uid, getTimestamp: nowIso }));
    persist(state, false, { feature: 'Signals', action: 'Scanned pasted messages' });
  };

  const acceptGroupMeCandidate = (candidate: GroupMeCandidate) => {
    const existingProfile = state.profiles.find((profile: { name: string; }) => profile.name.toLowerCase() === candidate.playerName.toLowerCase());
    persist({
      ...state,
      interests: [
        {
          id: uid(),
          profileId: existingProfile?.id,
          playerName: candidate.playerName,
          gameId: candidate.gameId,
          status: candidate.status,
          timestamp: candidate.timestamp,
          interestedAt: candidate.timestamp,
          confirmedAt: candidate.status === 'Confirmed Coming' ? candidate.timestamp : undefined,
          arrivedAt: candidate.status === 'Arrived' ? candidate.timestamp : undefined,
          notes: `GroupMe/pasted: ${candidate.sourceText}`
        },
        ...state.interests
      ]
    }, true, { feature: 'Signals', action: 'Accepted message candidate', metadata: { gameId: candidate.gameId, confidence: candidate.confidence } });
    setGroupMeCandidates((candidates) => candidates.filter((item) => item.id !== candidate.id));
  };

  const rejectGroupMeCandidate = (id: string) => {
    setGroupMeCandidates((candidates) => candidates.filter((item) => item.id !== id));
  };

  const copyMessage = (message: string) => {
    // Clipboard access is optional; analytics preserves the existing attempted-copy policy.
    navigator.clipboard?.writeText(message).catch(() => undefined);
    persist(state, false, { feature: 'Staff scripts', action: 'Copied script' });
  };

  const openRoute = (target: Exclude<AppRoute, 'floor'>) => {
    window.location.hash = `/${target}`;
  };

  const openTableView = (sessionId: string) => {
    localStorage.setItem(`${storageKey}:table-view-session`, sessionId);
    window.location.hash = `/table?sessionId=${encodeURIComponent(sessionId)}`;
  };

  const openTournamentTv = (tournamentId: string) => {
    localStorage.setItem(`${storageKey}:tournament-tv-id`, tournamentId);
    const tvRoute = `/tournament-tv?tournamentId=${encodeURIComponent(tournamentId)}`;
    if (window.tableManagerDesktop) {
      window.tableManagerDesktop.openWindow('tournament-tv', { tournamentId }).catch(() => {
        window.alert('TV View could not open. Try again or restart Orbit.');
      });
      return;
    }
    const tvUrl = new URL(window.location.href);
    tvUrl.hash = tvRoute;
    const tvWindow = window.open(
      tvUrl.toString(),
      `orbit-tournament-tv-${tournamentId}`,
      'popup,width=1280,height=720'
    );
    if (tvWindow) {
      tvWindow.opener = null;
    } else {
      window.alert('TV View could not open. Allow pop-ups for Orbit and try again.');
    }
  };

  const closeRoute = () => {
    window.location.hash = '/floor';
  };

  const persistTournamentState = (nextState: AppState, usageAction: string) => {
    persist(nextState, true, { feature: 'Tournament manager', action: usageAction, route: 'tournaments' });
  };

  const {
    addTournamentEntry,
    advanceTournamentLevel,
    beginTournamentEdit,
    checkInTournamentPlayer,
    createTournament,
    drawTournamentTables,
    eliminateTournamentPlayer,
    pauseTournament,
    registerTournamentPlayer,
    resumeTournament,
    runTournamentAgain,
    saveTournamentSettings,
    startTournament,
    updateTournamentPayout
  } = createTournamentActions({
    ...tournamentWorkspace,
    clockNow,
    onPersist: persistTournamentState,
    selectedTournament,
    state
  });

  const updateSettings = (patch: Partial<AppState['settings']>) => {
    persist({ ...state, settings: { ...state.settings, ...patch } }, true, {
      feature: 'Settings',
      action: 'Updated settings',
      metadata: { keys: Object.keys(patch).join(',') }
    });
  };

  const updateDefaultTableCap = (cap: TableCap) => {
    persist(applyDefaultTableCap(state, cap), true, {
      feature: 'Settings',
      action: 'Updated table cap',
      metadata: { cap }
    });
  };

  const parseInitialGames = (input: string) =>
    input
      .split(/\r?\n|,/)
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => ({
        id: safeAccountKeyPart(name) || uid(),
        name,
        maxSeats: 10,
        minInRoomForLikely: 3,
        minFlexibleForLikely: 2,
        minTotalForViable: 6
      }));

  const createAccountLogin = async () => {
    const username = (setupDraft.username || clubDraft.email).trim().toLowerCase();
    const password = setupDraft.password;
    if (!/^\S+@\S+\.\S+$/.test(username) || password.length < 12) {
      setPilotKeyError('Enter a valid login email and a password or passphrase with at least 12 characters.');
      return null;
    }
    if (password !== setupDraft.confirmPassword) {
      setPilotKeyError('Password and confirmation do not match.');
      return null;
    }
    const salt = randomToken();
    return {
      username,
      passwordSalt: salt,
      passwordHash: await hashStaffPin(password, salt),
      createdAt: nowIso()
    };
  };

  const persistRequestedSignIn = async (next: AppState, staySignedIn: boolean) => {
    const persisted = await persistSignIn(next, staySignedIn);
    if (persisted) return true;
    await signOutOfFirebase().catch(() => undefined);
    setPilotKeyError('Orbit could not securely save this sign-in choice. Check local app storage access and try again.');
    return false;
  };

  const signInToAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    const accountLogin = state.settings.accountLogin;
    if (!accountLogin) return;
    if (!isPilotAccessActive(state.settings.pilotAccess)) {
      setPilotKeyError('This pilot key has expired. Load a current key to continue.');
      return;
    }
    const passwordMatches = await verifyStaffSecret(loginDraft.password, accountLogin.passwordSalt, accountLogin.passwordHash);
    if (loginDraft.username.trim().toLowerCase() !== accountLogin.username.toLowerCase() || !passwordMatches) {
      setPilotKeyError('Email or password is incorrect.');
      return;
    }
    if (canUseRendererFirebaseAuth()) {
      try {
        await signInOrCreateFirebaseEmailAccount(loginDraft.username, loginDraft.password);
      } catch {
        setPilotKeyError('Firebase could not authenticate or migrate this account. Confirm Email/Password sign-in is enabled and try again.');
        return;
      }
    }
    const next = {
      ...state,
      settings: {
        ...state.settings,
        accountLogin: {
          ...accountLogin,
          passwordHash: accountLogin.passwordHash.startsWith('pbkdf2-sha256$')
            ? accountLogin.passwordHash
            : await hashStaffPin(loginDraft.password, accountLogin.passwordSalt),
          lastLoginAt: nowIso()
        }
      }
    };
    if (!await persistRequestedSignIn(next, loginDraft.staySignedIn)) return;
    setHasAuthenticated(true);
    setPilotKeyError('');
    persist(next, false, { feature: 'Account', action: 'Signed in', route: 'access' });
  };

  const exportRoomDataFromExpiredAccess = async (event: React.FormEvent) => {
    event.preventDefault();
    setExpiredDataExportMessage('');
    const accountLogin = state.settings.accountLogin;
    if (!accountLogin?.passwordSalt || !accountLogin.passwordHash) {
      setExpiredDataExportMessage('This installation does not have a local account that can authorize an export.');
      return;
    }

    let passwordMatches = false;
    try {
      passwordMatches = await verifyStaffSecret(
        loginDraft.password,
        accountLogin.passwordSalt,
        accountLogin.passwordHash
      );
    } catch {
      passwordMatches = false;
    }

    if (
      loginDraft.username.trim().toLowerCase() !== accountLogin.username.trim().toLowerCase() ||
      !passwordMatches
    ) {
      setLoginDraft((current) => ({ ...current, password: '' }));
      setExpiredDataExportMessage('Email or password is incorrect. Room data was not exported.');
      return;
    }

    const result = downloadRoomDataExport();
    setLoginDraft((current) => ({ ...current, password: '' }));
    setExpiredDataExportMessage(
      result.ok ? 'Room data exported.' : `Room data export failed: ${result.error}`
    );
  };

  const clearTable = (sessionId: string) => {
    const session = state.sessions.find((item) => item.id === sessionId);
    if (!session) return;
    const seatedCount = getActivePlayerSessionsForTable(state, session.id).length;
    if (!window.confirm(
      `Clear ${session.label}? This closes the live session and removes ${seatedCount} seated player${seatedCount === 1 ? '' : 's'} without entering cash-out amounts.`
    )) return;
    const result = clearTableInState(state, session.id, { createId: uid, nowIso });
    if (!result.ok) {
      window.alert(result.error);
      return;
    }
    persist(result.state, true, {
      feature: 'Tables',
      action: 'Cleared table',
      metadata: { gameId: session.gameId, tableId: session.id, players: seatedCount }
    });
  };

  const deleteTable = (tableId: string) => {
    const physicalTable = (state.physicalTables ?? []).find((table) => table.id === tableId);
    const session = state.sessions.find((item) =>
      item.id === tableId || item.physicalTableId === tableId
    );
    const label = physicalTable?.label ?? session?.label ?? 'this table';
    if (!window.confirm(
      `Delete ${label}? The table will be removed from the floor. Any live session will be closed, while financial and audit history remains available.`
    )) return;
    const result = deleteTableInState(state, { id: tableId }, { createId: uid, nowIso });
    if (!result.ok) {
      window.alert(result.error);
      return;
    }
    persist(result.state, true, {
      feature: 'Tables',
      action: 'Deleted table',
      metadata: { tableId, label }
    });
  };

  const mergeTable = (sourceSessionId: string, targetSessionId: string) => {
    const source = state.sessions.find((session) => session.id === sourceSessionId);
    const target = state.sessions.find((session) => session.id === targetSessionId);
    const result = mergeTableInState(state, sourceSessionId, targetSessionId, { createId: uid, nowIso });
    if (!result.ok) {
      window.alert(result.error);
      return;
    }
    persist(result.state, true, {
      feature: 'Tables',
      action: 'Merged tables',
      metadata: {
        fromTableId: sourceSessionId,
        toTableId: targetSessionId,
        players: result.movedPlayerCount ?? 0,
        fromLabel: source?.label ?? sourceSessionId,
        toLabel: target?.label ?? targetSessionId
      }
    });
  };

  const exportLegacyRoomDataFromExpiredAccess = () => {
    setExpiredDataExportMessage('');
    const result = downloadRoomDataExport();
    setExpiredDataExportMessage(
      result.ok ? 'Room data exported.' : `Room data export failed: ${result.error}`
    );
  };

  const resetPasswordRecovery = () => {
    setPasswordRecoveryStage('idle');
    setPasswordRecoveryNotice('');
    setPilotKeyError('');
    setLoginDraft((current) => ({ ...current, password: '' }));
  };

  const requestAccountPasswordReset = async () => {
    const accountLogin = state.settings.accountLogin;
    if (!accountLogin) return;
    if (!canUseRendererFirebaseAuth()) {
      setPilotKeyError('Password recovery requires Firebase connectivity. Contact Orbit support if this installation is offline.');
      return;
    }

    setPasswordRecoveryStage('sending');
    setPasswordRecoveryNotice('');
    setPilotKeyError('');
    setLoginDraft((current) => ({ ...current, username: accountLogin.username, password: '' }));
    try {
      await sendFirebasePasswordResetEmail(accountLogin.username);
      setPasswordRecoveryStage('sent');
      setPasswordRecoveryNotice('A password reset link was sent to the card house login email. Choose a new password there, then return here to finish recovery.');
    } catch {
      setPasswordRecoveryStage('idle');
      setPilotKeyError('Orbit could not send the password reset email. Confirm the internet connection and contact Orbit support if the problem continues.');
    }
  };

  const requestOwnerAssistedRecovery = async () => {
    const accountLogin = state.settings.accountLogin;
    const access = state.settings.pilotAccess;
    const desktop = window.tableManagerDesktop;
    if (!accountLogin || !access || !isPilotAccessActive(access)) {
      setPilotKeyError('Load a current pilot key before using owner-assisted recovery.');
      return;
    }
    if (!desktop?.getManagementRecoveryStatus) {
      setPilotKeyError('Owner-assisted recovery requires the Orbit desktop app and server connectivity.');
      return;
    }

    setPasswordRecoveryStage('owner-checking');
    setPasswordRecoveryNotice('');
    setPilotKeyError('');
    try {
      const result = await desktop.getManagementRecoveryStatus(access);
      if (!result.ok || !result.active) {
        setPasswordRecoveryStage('idle');
        setPilotKeyError(result.error || 'No active owner recovery override was found. Ask Orbit support to start one, then try again.');
        return;
      }
      const username = String(result.username || accountLogin.username).trim().toLowerCase();
      if (username !== accountLogin.username.trim().toLowerCase()) {
        setPasswordRecoveryStage('idle');
        setPilotKeyError('The recovery override does not match this card-house login. Contact Orbit support.');
        return;
      }
      setLoginDraft((current) => ({ ...current, username, password: '' }));
      setPasswordRecoveryStage('owner-ready');
      setPasswordRecoveryNotice(`Owner-assisted recovery is active${result.expiresAt ? ` until ${new Date(result.expiresAt).toLocaleString()}` : ''}. Choose one new password now; this override can be used only once.`);
    } catch {
      setPasswordRecoveryStage('idle');
      setPilotKeyError('Orbit could not check the recovery override. Confirm the internet connection and try again.');
    }
  };

  const completeOwnerAssistedRecovery = async (event: React.FormEvent) => {
    event.preventDefault();
    const accountLogin = state.settings.accountLogin;
    const access = state.settings.pilotAccess;
    const desktop = window.tableManagerDesktop;
    if (!accountLogin || !access || passwordRecoveryStage !== 'owner-ready') return;
    if (!isPilotAccessActive(access)) {
      setPilotKeyError('This pilot key has expired. Load a current key to continue.');
      return;
    }
    if (!desktop?.completeManagementRecovery) {
      setPilotKeyError('Owner-assisted recovery requires the Orbit desktop app and server connectivity.');
      return;
    }

    setPasswordRecoveryStage('owner-completing');
    setPilotKeyError('');
    try {
      const result = await desktop.completeManagementRecovery({ access, password: loginDraft.password });
      if (!result.ok || !result.accountLogin?.passwordHash || !result.accountLogin.passwordSalt) {
        throw new AccountRecoveryValidationError(result.error || 'Owner-assisted recovery could not be completed.');
      }
      const recoveredLogin = {
        ...accountLogin,
        ...result.accountLogin,
        username: result.accountLogin.username.trim().toLowerCase()
      };
      const next = {
        ...state,
        settings: {
          ...state.settings,
          accountLogin: recoveredLogin
        }
      };
      if (canUseRendererFirebaseAuth()) {
        void signInToFirebaseWithEmail(recoveredLogin.username, loginDraft.password).catch(() => undefined);
      }
      if (!await persistRequestedSignIn(next, loginDraft.staySignedIn)) {
        setPasswordRecoveryStage('owner-ready');
        return;
      }
      setHasAuthenticated(true);
      setPasswordRecoveryStage('idle');
      setPasswordRecoveryNotice('');
      setPilotKeyError('');
      persist(next, false, { feature: 'Account', action: 'Completed owner-assisted recovery', route: 'access' });
    } catch (error) {
      setPasswordRecoveryStage('owner-ready');
      setPilotKeyError(error instanceof Error ? error.message : 'Owner-assisted recovery could not be completed.');
    }
  };

  const completeAccountPasswordRecovery = async (event: React.FormEvent) => {
    event.preventDefault();
    const accountLogin = state.settings.accountLogin;
    if (!accountLogin || passwordRecoveryStage !== 'sent') return;
    if (!isPilotAccessActive(state.settings.pilotAccess)) {
      setPilotKeyError('This pilot key has expired. Load a current key to continue.');
      return;
    }

    setPasswordRecoveryStage('verifying');
    setPilotKeyError('');
    try {
      const recoveredLogin = await recoverAccountLogin({
        accountLogin,
        username: loginDraft.username,
        password: loginDraft.password,
        authenticate: signInToFirebaseWithEmail,
        createSalt: randomToken,
        hashPassword: hashStaffPin,
        now: nowIso
      });
      const next = {
        ...state,
        settings: {
          ...state.settings,
          accountLogin: recoveredLogin
        }
      };
      if (!await persistRequestedSignIn(next, loginDraft.staySignedIn)) {
        setPasswordRecoveryStage('sent');
        return;
      }
      setHasAuthenticated(true);
      setPasswordRecoveryStage('idle');
      setPasswordRecoveryNotice('');
      setPilotKeyError('');
      persist(next, false, { feature: 'Account', action: 'Recovered login', route: 'access' });
    } catch (error) {
      setPasswordRecoveryStage('sent');
      setPilotKeyError(
        error instanceof AccountRecoveryValidationError
          ? error.message
          : 'Firebase could not verify the new password. Complete the reset email first, then try again.'
      );
    }
  };

  const createLoginForExistingAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    const accountLogin = await createAccountLogin();
    if (!accountLogin) return;
    if (canUseRendererFirebaseAuth()) {
      try { await signInOrCreateFirebaseEmailAccount(accountLogin.username, setupDraft.password); }
      catch { setPilotKeyError('Unable to authenticate or create the Firebase email/password account.'); return; }
    }
    const next = {
      ...state,
      settings: {
        ...state.settings,
        accountLogin
      }
    };
    if (!await persistRequestedSignIn(next, setupDraft.staySignedIn)) return;
    setHasAuthenticated(true);
    setPilotKeyError('');
    persist(next, true, { feature: 'Account', action: 'Created login', route: 'access' });
  };

  const updateCollectionProfile = (gameId: string, patch: Partial<CollectionProfile>) => {
    const current = getCollectionProfile(state, gameId);
    const nextProfile = { ...current, ...patch, gameId };
    const collectionProfiles = [
      ...state.settings.collectionProfiles.filter((profile) => profile.gameId !== gameId),
      nextProfile
    ];
    const collectionMode = nextProfile.collectionMode;
    const timeFeeBased = collectionMode === 'Time';
    persist({
      ...state,
      settings: { ...state.settings, collectionProfiles },
      sessions: state.sessions.map((session) =>
        session.gameId === gameId && session.status !== 'Closed' && session.status !== 'Failed to Start'
          ? { ...session, collectionMode, timeFeeBased }
          : session
      ),
      playerSessions: state.playerSessions.map((playerSession) =>
        playerSession.gameId === gameId && !playerSession.leftAt
          ? { ...playerSession, timeFeeEnabled: timeFeeBased, lastTimeTickAt: playerSession.lastTimeTickAt ?? nowIso() }
          : playerSession
      )
    }, true, { feature: 'Settings', action: 'Updated collection profile', metadata: { gameId, collectionMode } });
  };

  const loadExistingAccountState = async (access: PilotAccess) => {
    const next = await loadExistingManagementStateForAccount(access);
    if (!next) return false;
    setUndoStack([]);
    setHasAuthenticated(await restorePersistedSignIn(next));
    persist(next, false, { feature: 'Account', action: 'Loaded existing pilot key', route: 'access' });
    setPendingPilotAccess(null);
    setPilotKeyError('');
    window.location.hash = '/floor';
    return true;
  };

  const loadPilotKeyFile = async (file?: File) => {
    setPilotKeyError('');
    setPendingPilotAccess(null);
    if (!file) return;
    let parsed: unknown;
    try {
      await validateLocalImport(file, 'pilot-key-json');
      const text = await file.text();
      parsed = JSON.parse(text);
    } catch {
      setPilotKeyError('Key file must be valid JSON.');
      return;
    }

    const result = await validatePilotKey(parsed, file.name);
    if (result.error || !result.access) {
      setPilotKeyError(result.error ?? 'Unable to validate this key file.');
      return;
    }
    if (await loadExistingAccountState(result.access)) return;
    setPendingPilotAccess(result.access);
  };

  const activatePilotAccess = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pendingPilotAccess) {
      setPilotKeyError('Load a valid key file first.');
      return;
    }
    if (!clubDraft.clubName.trim() || !clubDraft.accountName.trim() || !clubDraft.contactName.trim() || !clubDraft.email.trim()) {
      setPilotKeyError('Club name, account name, contact name, and email are required.');
      return;
    }
    const accountLogin = await createAccountLogin();
    if (!accountLogin) return;
    if (canUseRendererFirebaseAuth()) {
      try { await signInOrCreateFirebaseEmailAccount(accountLogin.username, setupDraft.password); }
      catch { setPilotKeyError('Unable to authenticate or create the Firebase email/password account.'); return; }
    }
    const games = parseInitialGames(setupDraft.initialGames);
    if (!games.length) {
      setPilotKeyError('Add at least one game offered by this card house.');
      return;
    }
    const next = normalizeState({
      ...seedState,
      games,
      settings: {
        ...seedState.settings,
        pilotAccess: pendingPilotAccess,
        clubAccount: {
          ...clubDraft,
          clubName: clubDraft.clubName.trim(),
          accountName: clubDraft.accountName.trim(),
          contactName: clubDraft.contactName.trim(),
          email: clubDraft.email.trim().toLowerCase(),
          phone: clubDraft.phone.trim(),
          address: clubDraft.address.trim()
        },
        accountLogin,
        defaultCollectionMode: setupDraft.defaultCollectionMode,
        defaultHourlyFee: setupDraft.defaultHourlyFee,
        defaultEstimatedDropPerSeatHour: setupDraft.defaultEstimatedDropPerSeatHour,
        collectionProfiles: games.map((game) => ({
          gameId: game.id,
          collectionMode: setupDraft.defaultCollectionMode,
          hourlyFee: setupDraft.defaultHourlyFee,
          estimatedDropPerSeatHour: setupDraft.defaultEstimatedDropPerSeatHour
        }))
      }
    });
    if (!await persistRequestedSignIn(next, setupDraft.staySignedIn)) return;
    setHasAuthenticated(true);
    persist(next, true, { feature: 'Account', action: 'Activated pilot key', route: 'access' });
    window.location.hash = '/floor';
  };

  const applyReplacementPilotKey = async (file?: File) => {
    setPilotKeyError('');
    if (!file) return;
    try {
      await validateLocalImport(file, 'pilot-key-json');
      const text = await file.text();
      const parsed = JSON.parse(text);
      const result = await validatePilotKey(parsed, file.name);
      if (result.error || !result.access) {
        setPilotKeyError(result.error ?? 'Unable to validate this key file.');
        return;
      }
      const loadedExistingAccount = await loadExistingAccountState(result.access);
      if (!loadedExistingAccount) {
        setPilotKeyError(
          'No separate card house account exists for that key on this installation. Current logs were left under this account.'
        );
      }
    } catch {
      setPilotKeyError('Key file must be valid JSON.');
    }
  };

  const saveClubAccount = (event: React.FormEvent) => {
    event.preventDefault();
    if (!clubDraft.clubName.trim() || !clubDraft.accountName.trim() || !clubDraft.contactName.trim() || !clubDraft.email.trim()) {
      setPilotKeyError('Club name, account name, contact name, and email are required.');
      return;
    }
    setPilotKeyError('');
    updateSettings({
      clubAccount: {
        ...clubDraft,
        clubName: clubDraft.clubName.trim(),
        accountName: clubDraft.accountName.trim(),
        contactName: clubDraft.contactName.trim(),
        email: clubDraft.email.trim().toLowerCase(),
        phone: clubDraft.phone.trim(),
        address: clubDraft.address.trim()
      }
    });
  };

  const addStaffAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    if (state.settings.staffAccounts.some((staff) => staff.active) && !await authorizeStaffAction('staff-admin')) return;
    const name = staffDraft.name.trim();
    const pin = staffDraft.pin.trim();
    if (!name || pin.length < 4) {
      setBackupMessage('Staff name and a PIN with at least 4 digits are required.');
      return;
    }
    const salt = randomToken();
    const account: StaffAccount = {
      id: uid(),
      name,
      role: staffDraft.role,
      pinSalt: salt,
      pinHash: await hashStaffPin(pin, salt),
      active: true,
      createdAt: nowIso(),
      lastSelectedAt: nowIso()
    };
    persist({
      ...state,
      settings: {
        ...state.settings,
        staffAccounts: [...state.settings.staffAccounts, account],
        activeStaffId: state.settings.activeStaffId
      }
    }, true, { feature: 'Staff accounts', action: 'Added staff account', metadata: { role: account.role } });
    setStaffDraft({ name: '', role: 'Floor', pin: '' });
    setBackupMessage('Staff account added.');
  };

  const selectActiveStaff = async (staffId: string) => {
    if (!staffId) {
      setStaffSession(null);
    } else {
      const pin = window.prompt('Enter this staff member\'s PIN to activate their account:') || '';
      const access = state.settings.pilotAccess;
      const result = access && window.tableManagerDesktop?.verifyStaffPin
        ? await window.tableManagerDesktop.verifyStaffPin({ staffId, pin, access })
        : { ok: false, error: 'Trusted desktop staff verification is unavailable.' };
      if (!result.ok || !result.token || !result.staffId || !result.role || !result.expiresAt) {
        setStaffSession(null);
        window.alert(result.error || 'Staff verification failed.');
        return;
      }
      setStaffSession({ token: result.token, staffId: result.staffId, role: result.role, expiresAt: result.expiresAt });
    }
    persist({
      ...state,
      settings: {
        ...state.settings,
        activeStaffId: staffId || undefined,
        staffAccounts: state.settings.staffAccounts.map((staff) =>
          staff.id === staffId ? { ...staff, lastSelectedAt: nowIso() } : staff
        )
      }
    }, true, { feature: 'Staff accounts', action: staffId ? 'Selected active staff' : 'Cleared active staff' });
  };

  const deactivateStaffAccount = async (staffId: string) => {
    if (!await authorizeStaffAction('staff-admin')) return;
    if (staffSession?.staffId === staffId) setStaffSession(null);
    persist({
      ...state,
      settings: {
        ...state.settings,
        activeStaffId: state.settings.activeStaffId === staffId ? undefined : state.settings.activeStaffId,
        staffAccounts: state.settings.staffAccounts.map((staff) =>
          staff.id === staffId ? { ...staff, active: false } : staff
        )
      }
    }, true, { feature: 'Staff accounts', action: 'Deactivated staff account' });
  };

  const togglePanel = (panelId: string) => {
    setOpenPanels((panels) => ({ ...panels, [panelId]: !panels[panelId] }));
  };

  const applyDefaultCollectionToActiveTables = () => {
    const collectionMode = state.settings.defaultCollectionMode;
    const timeFeeBased = collectionMode === 'Time';
    persist({
      ...state,
      sessions: state.sessions.map((session) =>
        session.status !== 'Closed' && session.status !== 'Failed to Start'
          ? { ...session, collectionMode, timeFeeBased }
          : session
      ),
      playerSessions: state.playerSessions.map((playerSession) =>
        !playerSession.leftAt
          ? { ...playerSession, timeFeeEnabled: timeFeeBased, lastTimeTickAt: playerSession.lastTimeTickAt ?? nowIso() }
          : playerSession
      )
    });
  };

  const navigatePrimary = (destination: PrimaryDestination) => {
    const routes: Record<PrimaryDestination, AppRoute> = {
      floor: 'floor', players: 'profiles', games: 'builder', tournaments: 'tournaments', reports: 'summary', settings: 'customization'
    };
    window.location.hash = `/${routes[destination]}`;
  };
  const activeStaffAccount = state.settings.staffAccounts.find((staff) => staff.id === state.settings.activeStaffId);
  const shellCommands: ShellCommand[] = [
    ...state.profiles.slice(0, 30).map((profile) => ({ id: `player-${profile.id}`, label: `Player: ${profile.name}`, group: 'Players', keywords: `${profile.phone} ${profile.preferredStakes}`, action: () => { setProfileSearch(profile.name); openRoute('profiles'); } })),
    ...state.sessions.filter((session) => session.status !== 'Closed' && session.status !== 'Failed to Start').map((session) => ({ id: `table-${session.id}`, label: `Open ${session.label}`, group: 'Tables', action: () => openTableView(session.id) })),
    { id: 'add-interest', label: 'Add player interest', group: 'Actions', action: () => { closeRoute(); setOpenPanels((panels) => ({ ...panels, quickAdd: true })); } },
    { id: 'open-reports', label: 'Open night report', group: 'Actions', action: () => openRoute('summary') }
  ];
  const openStaffNotification = (notification: StaffRequestNotice) => {
    markStaffNotificationRead(notification);
    setNotificationCenterOpen(false);
    if (notification.kind === 'membership') {
      setPlayerSection('requests');
      navigatePrimary('players');
    } else {
      navigatePrimary('floor');
    }
  };
  const unreadStaffNotificationCount = staffNotifications.filter((notification) => !notification.read).length;
  const withShell = (active: PrimaryDestination, content: React.ReactNode) => (
    <AppShell
      active={active}
      clubName={state.settings.clubAccount?.clubName || 'Orbit Club'}
      operator={activeStaffAccount?.name}
      saveState={saveStatus.state}
      onNavigate={navigatePrimary}
      onSignOut={async () => {
        await persistSignIn(state, false);
        // Local sign-out must complete even if the optional Firebase session cannot be cleared.
        await signOutOfFirebase().catch(() => undefined);
        setHasAuthenticated(false);
      }}
      commands={shellCommands}
    >
      {staffRequestNotice ? (
        <section className="staff-request-notice" role="status" aria-live="polite">
          <div className="staff-request-notice-copy">
            <span className="staff-request-notice-icon"><Bell size={18} /></span>
            <div>
              <strong>{staffRequestNotice.title}</strong>
              <span>{staffRequestNotice.body}</span>
            </div>
          </div>
          <div className="staff-request-notice-actions">
            <button
              className="primary-button"
              onClick={() => openStaffNotification(staffRequestNotice)}
            >
              Review
            </button>
            <button className="icon-button" onClick={() => setStaffRequestNotice(null)} aria-label="Dismiss notification">
              <X size={17} />
            </button>
          </div>
        </section>
      ) : null}
      <div className="staff-notification-center">
        <button
          className="staff-notification-trigger"
          type="button"
          aria-label={`Notifications${unreadStaffNotificationCount ? `, ${unreadStaffNotificationCount} unread` : ''}`}
          onClick={() => setNotificationCenterOpen((open) => !open)}
        >
          <Bell size={19} />
          {unreadStaffNotificationCount ? <span>{unreadStaffNotificationCount > 99 ? '99+' : unreadStaffNotificationCount}</span> : null}
        </button>
        {notificationCenterOpen ? (
          <section className="staff-notification-panel" aria-label="Notifications">
            <header>
              <div><strong>Notifications</strong><span>{unreadStaffNotificationCount} unread</span></div>
              <div>
                {unreadStaffNotificationCount ? (
                  <button
                    type="button"
                    onClick={() => {
                      const next = staffNotifications.map((notification) => ({ ...notification, read: true }));
                      replaceStaffNotifications(next);
                    }}
                  >
                    Mark all read
                  </button>
                ) : null}
                <button type="button" onClick={() => setNotificationCenterOpen(false)} aria-label="Close notifications"><X size={16} /></button>
              </div>
            </header>
            <div className="staff-notification-list">
              {staffNotifications.map((notification) => (
                <button
                  className={notification.read ? '' : 'unread'}
                  type="button"
                  key={notification.id}
                  onClick={() => openStaffNotification(notification)}
                >
                  <span className="staff-notification-item-icon">{notification.kind === 'membership' ? <BadgeCheck size={17} /> : <Users size={17} />}</span>
                  <span><strong>{notification.title}</strong><small>{notification.body}</small><time>{formatClock(notification.createdAt)}</time></span>
                  <ChevronRight size={16} />
                </button>
              ))}
              {!staffNotifications.length ? <div className="staff-notification-empty">No notifications yet.</div> : null}
            </div>
          </section>
        ) : null}
      </div>
      {withRouteLoadingBoundary(content)}
    </AppShell>
  );

  if (isPilotAccessActive(state.settings.pilotAccess) && !state.settings.accountLogin) {
    return (
      <main className="access-shell">
        <section className="access-card">
          <div className="access-brand">
            <div className="access-icon">
              <LockKeyhole size={28} />
            </div>
            <div>
              <div className="eyebrow">Create login</div>
              {state.settings.clubAccount?.clubName ? (
                <h1>{state.settings.clubAccount.clubName}</h1>
              ) : (
                <img className="brand-logo access-brand-logo" src="./orbit-logo.svg" alt={branding.product.name} />
              )}
              <p>Create the login used for this card house on this installation.</p>
            </div>
          </div>
          <form className="access-step account-form" onSubmit={createLoginForExistingAccount}>
            <label className="access-field">Login email
              <input required value={setupDraft.username} onChange={(event) => setSetupDraft({ ...setupDraft, username: event.target.value })} onBlur={validateAccessField} placeholder="name@example.com" type="email" aria-describedby="access-field-error" />
            </label>
            <label className="access-field">Password or passphrase
              <input required value={setupDraft.password} onChange={(event) => setSetupDraft({ ...setupDraft, password: event.target.value })} onBlur={validateAccessField} placeholder="12 or more characters" type="password" minLength={12} aria-describedby="access-field-error" />
            </label>
            <label className="access-field">Confirm password
              <input required value={setupDraft.confirmPassword} onChange={(event) => setSetupDraft({ ...setupDraft, confirmPassword: event.target.value })} onBlur={(event) => validateAccessField(event, setupDraft.password)} placeholder="Repeat password" type="password" minLength={12} aria-describedby="access-field-error" />
            </label>
            <label className="switch-control">
              <input type="checkbox" checked={setupDraft.staySignedIn} onChange={(event) => setSetupDraft({ ...setupDraft, staySignedIn: event.target.checked })} />
              <span>Stay signed in until key expiration</span>
            </label>
            <button className="primary-button" type="submit">Create Login</button>
            {pilotKeyError || accessFieldError ? <p id="access-field-error" className="access-error" role="alert">{pilotKeyError || accessFieldError}</p> : null}
          </form>
        </section>
      </main>
    );
  }

  if (isPilotAccessActive(state.settings.pilotAccess) && !hasAuthenticated) {
    const ownerRecovery = passwordRecoveryStage === 'owner-ready' || passwordRecoveryStage === 'owner-completing';
    const choosingNewPassword = passwordRecoveryStage === 'sent' || passwordRecoveryStage === 'verifying' || ownerRecovery;
    const recoveryBusy = passwordRecoveryStage === 'sending' || passwordRecoveryStage === 'verifying' || passwordRecoveryStage === 'owner-checking' || passwordRecoveryStage === 'owner-completing';
    return (
      <main className="access-shell">
        <section className="access-card">
          <div className="access-brand">
            <div className="access-icon">
              <LockKeyhole size={28} />
            </div>
            <div>
              <div className="eyebrow">Sign in</div>
              {state.settings.clubAccount?.clubName ? (
                <h1>{state.settings.clubAccount.clubName}</h1>
              ) : (
                <img className="brand-logo access-brand-logo" src="./orbit-logo.svg" alt={branding.product.name} />
              )}
              <p>Use the login created for this card house. Access remains limited by the pilot key expiration.</p>
            </div>
          </div>
          <form className="access-step account-form" onSubmit={passwordRecoveryStage === 'idle' ? signInToAccount : ownerRecovery ? completeOwnerAssistedRecovery : completeAccountPasswordRecovery}>
            <label className="access-field">Email
              <input required value={loginDraft.username} onChange={(event) => setLoginDraft({ ...loginDraft, username: event.target.value })} onBlur={validateAccessField} placeholder="name@example.com" type="email" autoComplete="email" readOnly={passwordRecoveryStage !== 'idle'} aria-describedby="access-field-error" />
            </label>
            <label className="access-field">{choosingNewPassword ? 'New password or passphrase' : 'Password'}
              <input required value={loginDraft.password} onChange={(event) => setLoginDraft({ ...loginDraft, password: event.target.value })} onBlur={validateAccessField} placeholder={choosingNewPassword ? '12 or more characters' : 'Password'} type="password" minLength={choosingNewPassword ? 12 : undefined} maxLength={choosingNewPassword ? 128 : undefined} autoComplete={choosingNewPassword ? 'new-password' : 'current-password'} aria-describedby="access-field-error" />
            </label>
            <label className="switch-control">
              <input type="checkbox" checked={loginDraft.staySignedIn} onChange={(event) => setLoginDraft({ ...loginDraft, staySignedIn: event.target.checked })} />
              <span>Stay signed in until key expiration</span>
            </label>
            {passwordRecoveryNotice ? <p className="success-copy" role="status">{passwordRecoveryNotice}</p> : null}
            <button className="primary-button" type="submit" disabled={recoveryBusy}>
              {ownerRecovery
                ? passwordRecoveryStage === 'owner-completing' ? 'Saving...' : 'Set New Password'
                : passwordRecoveryStage === 'sent' || passwordRecoveryStage === 'verifying'
                ? passwordRecoveryStage === 'verifying' ? 'Verifying...' : 'Finish Password Reset'
                : 'Sign In'}
            </button>
            {passwordRecoveryStage === 'idle' ? (
              <>
                <button className="ghost-button" type="button" onClick={requestAccountPasswordReset}>Forgot password?</button>
                <button className="ghost-button" type="button" onClick={requestOwnerAssistedRecovery}>Use owner-assisted recovery</button>
              </>
            ) : (
              <button className="ghost-button" type="button" onClick={resetPasswordRecovery} disabled={recoveryBusy}>Back to sign in</button>
            )}
            <button className="ghost-button" type="button" onClick={() => { resetPasswordRecovery(); setState(seedState); }}>Use a different key</button>
            {pilotKeyError || accessFieldError ? <p id="access-field-error" className="access-error" role="alert">{pilotKeyError || accessFieldError}</p> : null}
          </form>
        </section>
      </main>
    );
  }

  if (!isPilotAccessActive(state.settings.pilotAccess)) {
    return (
      <main className="access-shell">
        <section className="access-card">
          <div className="access-brand">
            <div className="access-icon">
              <LockKeyhole size={28} />
            </div>
            <div>
              <div className="eyebrow">Pilot access</div>
              <img className="brand-logo access-brand-logo" src="./orbit-logo.svg" alt={branding.product.name} />
              <p>Load your pilot key file, then register the club account that will use this installation.</p>
            </div>
          </div>

          <div className="access-grid">
            <section className="access-step">
              <div className="access-step-title">
                <KeyRound size={20} />
                <h2>Key File</h2>
              </div>
              <label className="key-file-drop">
                <input
                  type="file"
                  accept="application/json,.json,.key"
                  onChange={(event) => loadPilotKeyFile(event.target.files?.[0])}
                />
                <span>{pendingPilotAccess?.keyFileName ?? 'Choose key file'}</span>
                <small>Expected JSON fields: authorizationCode and expiresAt.</small>
              </label>
              {pendingPilotAccess ? (
                <div className="access-valid">
                  <strong>Valid through {pendingPilotAccess.expiresAt}</strong>
                  <span>{pendingPilotAccess.authorizationCode}</span>
                </div>
              ) : null}
              {pilotKeyError ? <p className="access-error">{pilotKeyError}</p> : null}
            </section>

            {pendingPilotAccess ? (
            <form className="access-step account-form" onSubmit={activatePilotAccess}>
              <div className="access-step-title">
                <Users size={20} />
                <h2>Club Account</h2>
              </div>
              <label className="access-field">Club name
                <input required value={clubDraft.clubName} onChange={(event) => setClubDraft({ ...clubDraft, clubName: event.target.value })} onBlur={validateAccessField} aria-describedby="access-field-error" />
              </label>
              <label className="access-field">Account name
                <input required value={clubDraft.accountName} onChange={(event) => setClubDraft({ ...clubDraft, accountName: event.target.value })} onBlur={validateAccessField} aria-describedby="access-field-error" />
              </label>
              <label className="access-field">Primary contact
                <input required value={clubDraft.contactName} onChange={(event) => setClubDraft({ ...clubDraft, contactName: event.target.value })} onBlur={validateAccessField} aria-describedby="access-field-error" />
              </label>
              <label className="access-field">Club email
                <input required type="email" value={clubDraft.email} onChange={(event) => setClubDraft({ ...clubDraft, email: event.target.value })} onBlur={validateAccessField} placeholder="name@example.com" aria-describedby="access-field-error" />
              </label>
              <label className="access-field">Phone
                <input value={clubDraft.phone} onChange={(event) => setClubDraft({ ...clubDraft, phone: event.target.value })} placeholder="Optional" />
              </label>
              <label className="access-field">Club address
                <input value={clubDraft.address} onChange={(event) => setClubDraft({ ...clubDraft, address: event.target.value })} placeholder="Street address" />
              </label>
              <label className="access-field">Login email
                <input value={setupDraft.username} onChange={(event) => setSetupDraft({ ...setupDraft, username: event.target.value })} onBlur={validateAccessField} placeholder="Defaults to club email" type="email" aria-describedby="access-field-error" />
              </label>
              <label className="access-field">Create password or passphrase
                <input required value={setupDraft.password} onChange={(event) => setSetupDraft({ ...setupDraft, password: event.target.value })} onBlur={validateAccessField} placeholder="12 or more characters" type="password" minLength={12} aria-describedby="access-field-error" />
              </label>
              <label className="access-field">Confirm password
                <input required value={setupDraft.confirmPassword} onChange={(event) => setSetupDraft({ ...setupDraft, confirmPassword: event.target.value })} onBlur={(event) => validateAccessField(event, setupDraft.password)} placeholder="Repeat password" type="password" minLength={12} aria-describedby="access-field-error" />
              </label>
              <label className="access-field access-field-wide">Games offered
                <textarea required value={setupDraft.initialGames} onChange={(event) => setSetupDraft({ ...setupDraft, initialGames: event.target.value })} placeholder="One game per line" />
              </label>
              <div className="segmented-control">
                <button
                  type="button"
                  className={setupDraft.defaultCollectionMode === 'Drop' ? 'secondary-button active' : 'ghost-button'}
                  onClick={() => setSetupDraft({ ...setupDraft, defaultCollectionMode: 'Drop' })}
                >
                  Drop
                </button>
                <button
                  type="button"
                  className={setupDraft.defaultCollectionMode === 'Time' ? 'secondary-button active' : 'ghost-button'}
                  onClick={() => setSetupDraft({ ...setupDraft, defaultCollectionMode: 'Time' })}
                >
                  Time fees
                </button>
              </div>
              <label className="access-field">Hourly fee
                <input type="number" min="0" value={setupDraft.defaultHourlyFee} onChange={(event) => setSetupDraft({ ...setupDraft, defaultHourlyFee: Number(event.target.value) })} onBlur={validateAccessField} aria-describedby="access-field-error" />
              </label>
              <label className="access-field">Drop estimate per occupied seat-hour
                <input type="number" min="0" value={setupDraft.defaultEstimatedDropPerSeatHour} onChange={(event) => setSetupDraft({ ...setupDraft, defaultEstimatedDropPerSeatHour: Number(event.target.value) })} onBlur={validateAccessField} aria-describedby="access-field-error" />
              </label>
              <label className="switch-control">
                <input
                  type="checkbox"
                  checked={setupDraft.staySignedIn}
                  onChange={(event) => setSetupDraft({ ...setupDraft, staySignedIn: event.target.checked })}
                />
                <span>Stay signed in until key expiration</span>
              </label>
              <button className="primary-button" type="submit">
                Unlock Dashboard
              </button>
              {pilotKeyError || accessFieldError ? <p id="access-field-error" className="access-error" role="alert">{pilotKeyError || accessFieldError}</p> : null}
            </form>
            ) : (
              <section className="access-step">
                <div className="access-step-title">
                  <Users size={20} />
                  <h2>Club Account</h2>
                </div>
                <p className="muted-copy">Choose a valid pilot key first. Club details and login setup will appear here after the key is verified.</p>
              </section>
            )}
            {state.settings.accountLogin ? (
              <form className="access-step account-form" onSubmit={exportRoomDataFromExpiredAccess}>
                <div className="access-step-title">
                  <Download size={20} />
                  <h2>Export room data</h2>
                </div>
                <p className="muted-copy">
                  Verify the existing local account to download room data without renewing or unlocking operations.
                </p>
                <label className="access-field">Account email
                  <input
                    required
                    type="email"
                    autoComplete="email"
                    value={loginDraft.username}
                    onChange={(event) => setLoginDraft({ ...loginDraft, username: event.target.value })}
                    aria-describedby="expired-data-export-message"
                  />
                </label>
                <label className="access-field">Password or passphrase
                  <input
                    required
                    type="password"
                    autoComplete="current-password"
                    value={loginDraft.password}
                    onChange={(event) => setLoginDraft({ ...loginDraft, password: event.target.value })}
                    aria-describedby="expired-data-export-message"
                  />
                </label>
                <button className="secondary-button" type="submit">
                  <Download size={16} />
                  Verify &amp; Export
                </button>
                {expiredDataExportMessage ? (
                  <p
                    id="expired-data-export-message"
                    className={expiredDataExportMessage === 'Room data exported.' ? 'success-copy' : 'access-error'}
                    role={expiredDataExportMessage === 'Room data exported.' ? 'status' : 'alert'}
                  >
                    {expiredDataExportMessage}
                  </p>
                ) : null}
              </form>
            ) : (
              <section className="access-step account-form">
                <div className="access-step-title">
                  <Download size={20} />
                  <h2>Export room data</h2>
                </div>
                <p className="muted-copy">
                  This legacy room has no local sign-in to verify. Download a sanitized export without unlocking operations.
                </p>
                <button className="secondary-button" type="button" onClick={exportLegacyRoomDataFromExpiredAccess}>
                  <Download size={16} />
                  Export Room Data
                </button>
                {expiredDataExportMessage ? (
                  <p
                    id="expired-data-export-message"
                    className={expiredDataExportMessage === 'Room data exported.' ? 'success-copy' : 'access-error'}
                    role={expiredDataExportMessage === 'Room data exported.' ? 'status' : 'alert'}
                  >
                    {expiredDataExportMessage}
                  </p>
                ) : null}
              </section>
            )}
          </div>
        </section>
      </main>
    );
  }

  if (route === 'tournament-tv') {
    const routeTournamentId = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('tournamentId') ?? '';
    const tournamentId = routeTournamentId || localStorage.getItem(`${storageKey}:tournament-tv-id`) || '';
    const tournament = state.tournaments.find((item) => item.id === tournamentId) ?? selectedTournament;
    const prizePool = getTournamentPrizePool(tournament);
    const remaining = getTournamentLevelRemainingSeconds(tournament, clockNow);
    return (
      tournament ? (
        withRouteLoadingBoundary(
          <TournamentTvView tournament={tournament} nowMs={clockNow} remainingSeconds={remaining} prizePool={prizePool} />
        )
      ) : (
        <main className="orbit-tournament-display">
          <section className="tournament-tv-empty">
            <h1>No tournament selected</h1>
          </section>
        </main>
      )
    );
  }

  if (route === 'tournaments') {
    const tournament = selectedTournament;
    const currentLevel = getTournamentLevel(tournament);
    const nextLevel = getNextTournamentLevel(tournament);
    const prizePool = getTournamentPrizePool(tournament);
    const remaining = getTournamentLevelRemainingSeconds(tournament, clockNow);
    return withShell('tournaments', (
      <TournamentsView
        state={state}
        tournament={tournament}
        currentLevel={currentLevel}
        nextLevel={nextLevel}
        prizePool={prizePool}
        remaining={remaining}
        tournamentDraft={tournamentDraft}
        tournamentPayoutDrafts={tournamentPayoutDrafts}
        tournamentPlayerDraft={tournamentPlayerDraft}
        tournamentSection={tournamentSection}
        tournamentView={tournamentView}
        addTournamentEntry={addTournamentEntry}
        advanceTournamentLevel={advanceTournamentLevel}
        beginTournamentEdit={beginTournamentEdit}
        checkInTournamentPlayer={checkInTournamentPlayer}
        createTournament={createTournament}
        drawTournamentTables={drawTournamentTables}
        eliminateTournamentPlayer={eliminateTournamentPlayer}
        formatTournamentTime={formatTournamentTime}
        getTournamentActivePlayers={getTournamentActivePlayers}
        getTournamentAverageStack={getTournamentAverageStack}
        getTournamentEntries={getTournamentEntries}
        onBeginCreate={() => {
          setTournamentDraft({
            name: `Tournament ${todayDate()}`,
            buyIn: '',
            startingStack: '20000',
            levelMinutes: '20',
            rebuyPrizePercent: '100',
            tableSize: '9'
          });
          setTournamentView('create');
        }}
        openTournamentTv={openTournamentTv}
        pauseTournament={pauseTournament}
        registerTournamentPlayer={registerTournamentPlayer}
        resumeTournament={resumeTournament}
        runTournamentAgain={runTournamentAgain}
        saveTournamentSettings={saveTournamentSettings}
        setSelectedTournamentId={setSelectedTournamentId}
        setTournamentDraft={setTournamentDraft}
        setTournamentPayoutDrafts={setTournamentPayoutDrafts}
        setTournamentPlayerDraft={setTournamentPlayerDraft}
        setTournamentSection={setTournamentSection}
        setTournamentView={setTournamentView}
        startTournament={startTournament}
        updateTournamentPayout={updateTournamentPayout}
      />
    ));
  }

  if (route === 'customization') {
    return withShell('settings', (
      <SettingsView
        state={state}
        settingsSection={settingsSection}
        clubDraft={clubDraft}
        staffDraft={staffDraft}
        pilotKeyError={pilotKeyError}
        backendStatus={backendStatus}
        saveStatus={saveStatus}
        backupMessage={backupMessage}
        reportMessage={reportMessage}
        closeRoute={closeRoute}
        applyReplacementPilotKey={applyReplacementPilotKey}
        saveClubAccount={saveClubAccount}
        updateSettings={updateSettings}
        selectActiveStaff={selectActiveStaff}
        addStaffAccount={addStaffAccount}
        formatClock={formatClock}
        deactivateStaffAccount={deactivateStaffAccount}
        exportRoomData={exportRoomData}
        exportJson={exportJson}
        importBackupFile={importBackupFile}
        submitAnalyticalReport={submitAnalyticalReport}
        exportPilotReport={exportPilotReport}
        applyDefaultCollectionToActiveTables={applyDefaultCollectionToActiveTables}
        updateDefaultTableCap={updateDefaultTableCap}
        updateCollectionProfile={updateCollectionProfile}
        setBackendStatus={setBackendStatus}
        setClubDraft={setClubDraft}
        setSettingsSection={setSettingsSection}
        setStaffDraft={setStaffDraft}
      />
    ));
  }

  if (route === 'builder') {
    return withShell('games', (
      <BuilderView
        games={state.games}
        sessions={state.sessions}
        coordinationConfig={coordinationConfig}
        gameFormatFilter={gameFormatFilter}
        gameStakesFilter={gameStakesFilter}
        gameStatusFilter={gameStatusFilter}
        participantPool={participantPool}
        balancePlans={balancePlans}
        getGameDemand={(game) => getDemand(game, state.interests)}
        getGameViability={(game) => getViabilityState(state, game)}
        onAddPlannedSession={addPlannedSession}
        onBuildGame={addSession}
        onClose={closeRoute}
        onCoordinationConfigChange={setCoordinationConfig}
        onCreateBalancedTable={createBalancedTable}
        onExportPilotReport={exportPilotReport}
        onGameFormatFilterChange={setGameFormatFilter}
        onGameStakesFilterChange={setGameStakesFilter}
        onGameStatusFilterChange={setGameStatusFilter}
        onOpenOutreach={() => openRoute('signals')}
        onOpenConfiguration={() => openRoute('customization')}
      />
    ));
  }

  if (route === 'profiles') {
    return withShell('players', (
      <ProfilesView
        state={state}
        activeMemberProfiles={activeMemberProfiles}
        approvedMembershipProfiles={approvedMembershipProfiles}
        duplicateProfiles={duplicateProfiles}
        editingProfileId={editingProfileId}
        formatClock={formatClock}
        formatHours={formatHours}
        getGameName={getGameName}
        getGamePlayEntries={getGamePlayEntries}
        getMostPlayedGameName={getMostPlayedGameName}
        importProfileFile={importProfileFile}
        importProfiles={importProfiles}
        importText={importText}
        inClubInterests={inClubInterests}
        membershipDirectoryProfiles={membershipDirectoryProfiles}
        newProfile={newProfile}
        pendingMembershipProfiles={pendingMembershipProfiles}
        playerPopup={playerPopup}
        playerSection={playerSection}
        profileEditDraft={profileEditDraft}
        profileFormMessage={profileFormMessage}
        profileSearch={profileSearch}
        qrManualValue={qrManualValue}
        qrScanMessage={qrScanMessage}
        qrVideoRef={qrVideoRef}
        todayPlayerActivity={todayPlayerActivity}
        activateInPersonMembership={activateInPersonMembership}
        addProfile={addProfile}
        addProfileToClub={addProfileToClub}
        approveMembershipRequest={approveMembershipRequest}
        beginEditProfile={beginEditProfile}
        cancelEditProfile={cancelEditProfile}
        deleteInterest={deleteInterest}
        deleteProfile={deleteProfile}
        mergeDuplicateProfiles={mergeDuplicateProfiles}
        onOpenQrScanner={openQrScanner}
        onRestartQrScanner={restartQrScanner}
        onSubmitQrManual={submitQrManual}
        removeProfileFromClub={removeProfileFromClub}
        saveProfileEdit={saveProfileEdit}
        setImportText={setImportText}
        setNewProfile={setNewProfile}
        setPlayerPopup={setPlayerPopup}
        setPlayerSection={setPlayerSection}
        setProfileEditDraft={setProfileEditDraft}
        setProfileSearch={setProfileSearch}
        setQrManualValue={setQrManualValue}
        toLocalDateValue={toLocalDateValue}
      />
    ));
  }

  if (route === 'signals') {
    return withShell('games', (
      <SignalsView
        games={state.games}
        groupMeCandidates={groupMeCandidates}
        groupMeText={groupMeText}
        likelyParticipants={likelyParticipants}
        scriptTemplates={state.scriptTemplates}
        staffScripts={staffScripts}
        statuses={statuses}
        onAcceptCandidate={acceptGroupMeCandidate}
        onClose={closeRoute}
        onCopyMessage={copyMessage}
        onGroupMeTextChange={setGroupMeText}
        onOpenRoute={openRoute}
        onRejectCandidate={rejectGroupMeCandidate}
        onScanMessages={scanGroupMeText}
        onSetCandidates={setGroupMeCandidates}
        onUpdateScriptTemplate={updateScriptTemplate}
      />
    ));
  }

  if (route === 'summary') {
    return withShell('reports', (
      <SummaryView
        state={state}
        reportAnalytics={reportAnalytics}
        reportState={reportState}
        reportFinancials={reportFinancials}
        reportHourlyBreakdown={reportHourlyBreakdown}
        reportDealerBreakdown={reportDealerBreakdown}
        reportOpportunities={reportOpportunities}
        reportWindow={reportWindow}
        usageAnalytics={usageAnalytics}
        reportMode={reportMode}
        reportPeriod={reportPeriod}
        reportIsCurrentPeriod={reportIsCurrentPeriod}
        kpiCategory={kpiCategory}
        currentNightClose={currentNightClose}
        effectiveNightCloseActuals={effectiveNightCloseActuals}
        nightCloseTables={nightCloseTables}
        nightCloseWarnings={nightCloseWarnings}
        nightCloseTotals={nightCloseTotals}
        nightCloseHasMissingActual={nightCloseHasMissingActual}
        nightCloseTotalProfit={nightCloseTotalProfit}
        nightCloseFinancials={nightCloseFinancials}
        nightCloseNotes={nightCloseNotes}
        summaryNotes={summaryNotes}
        exportCsv={exportCsv}
        closeRoute={closeRoute}
        formatClock={formatClock}
        onOpenStaffSettings={() => {
          setSettingsSection('staff');
          openRoute('customization');
        }}
        onToggleLowLight={() => persist({
          ...state,
          settings: { ...state.settings, lowLight: !state.settings.lowLight }
        })}
        reopenNightClose={reopenNightClose}
        saveNightClose={saveNightClose}
        signNightClose={signNightClose}
        approveAndLockNightClose={approveAndLockNightClose}
        selectActiveStaff={selectActiveStaff}
        setKpiCategory={setKpiCategory}
        setNightCloseActuals={setNightCloseActuals}
        setNightCloseNotes={setNightCloseNotes}
        setReportAnchorDate={setReportAnchorDate}
        setReportMode={setReportMode}
        setReportPeriod={setReportPeriod}
        setSummaryNotes={setSummaryNotes}
        toLocalDateValue={toLocalDateValue}
      />
    ));
  }

  if (route === 'kpis') {
    return withShell('reports', (
      <KpisView analytics={analytics} onClose={closeRoute} onExportCsv={exportCsv} />
    ));
  }

  const floorActivityItems = buildFloorActivityItems(state);

  const quickAddOpenSeatSessions = form.status === 'Seated' ? getOpenSeatSessions(form.gameId) : [];

  const seatPickerSession = seatPicker
    ? state.sessions.find((session) => session.id === seatPicker.sessionId && session.status !== 'Closed' && session.status !== 'Failed to Start')
    : undefined;
  const seatPickerIsTimeCollection = Boolean(seatPickerSession && (seatPickerSession.collectionMode === 'Time' || seatPickerSession.timeFeeBased));
  const seatPickerCandidates = seatPickerSession ? getSeatPickerCandidates(seatPickerSession, seatPicker?.search ?? '') : [];
  const seatPickerGame = seatPickerSession ? state.games.find((game) => game.id === seatPickerSession.gameId) : undefined;
  const seatPickerTypedName = seatPicker?.search.trim() ?? '';
  const seatPickerTypedProfile = seatPickerTypedName
    ? state.profiles.find((profile) => profile.name.trim().toLowerCase() === seatPickerTypedName.toLowerCase())
    : undefined;
  const showSeatPickerTypedName = Boolean(seatPickerSession && seatPickerTypedName);
  const seatPickerInitialBuyIn = seatPicker?.initialBuyIn.trim() ? Number(seatPicker.initialBuyIn) : undefined;
  const seatPickerModal = seatPicker && seatPickerSession ? createPortal(
    <div className="modal-backdrop seat-picker-backdrop" role="dialog" aria-modal="true" aria-label={`Seat ${seatPicker.seatNumber} player`}>
      <section className="seat-picker-modal">
        <div className="seat-picker-head">
          <div>
            <span>{seatPickerSession.label} - {seatPickerGame?.name ?? 'Table'}</span>
            <h2>Seat {seatPicker.seatNumber}</h2>
          </div>
          <button className="icon-button" type="button" onClick={() => setSeatPicker(null)} title="Close player picker">
            <X size={18} />
          </button>
        </div>
        <form
          className="seat-picker-controls"
          onSubmit={(event) => {
            event.preventDefault();
            seatTypedNameAtTable(seatPickerSession, seatPicker.seatNumber, seatPickerTypedName, Number(seatPicker.timeMinutes), seatPickerInitialBuyIn);
          }}
        >
          <input
            autoFocus
            value={seatPicker.search}
            onChange={(event) => setSeatPicker((current) => current ? { ...current, search: event.target.value, error: undefined } : current)}
            placeholder="Type player name and press Enter"
          />
          <label>
            Seat #
            <input
              value={seatPicker.seatNumber || ''}
              onChange={(event) =>
                setSeatPicker((current) => current ? { ...current, seatNumber: Number(event.target.value), error: undefined } : current)
              }
              type="number"
              min="1"
              max={seatPickerSession.maxSeats}
              step="1"
            />
          </label>
          <label>
            Initial buy-in
            <input
              value={seatPicker.initialBuyIn}
              onChange={(event) => setSeatPicker((current) => current ? { ...current, initialBuyIn: event.target.value, error: undefined } : current)}
              type="number"
              min="0"
              step="1"
              placeholder="$"
            />
          </label>
          {seatPickerIsTimeCollection ? (
            <label>
              Time bought
              <input
                value={seatPicker.timeMinutes}
                onChange={(event) => setSeatPicker((current) => current ? { ...current, timeMinutes: event.target.value, error: undefined } : current)}
                type="number"
                min="0"
                step="1"
                placeholder="Optional"
              />
            </label>
          ) : null}
          <button className="primary-button" type="submit" disabled={!seatPickerTypedName || !seatPicker.seatNumber}>
            <Plus size={16} />
            Seat Player
          </button>
        </form>
        {seatPicker.error ? <div className="seat-picker-error">{seatPicker.error}</div> : null}
        <div className="seat-picker-list">
          {showSeatPickerTypedName ? (
            <button
              className="seat-picker-card"
              type="button"
              onClick={() => seatTypedNameAtTable(seatPickerSession, seatPicker.seatNumber, seatPickerTypedName, Number(seatPicker.timeMinutes), seatPickerInitialBuyIn)}
              disabled={!seatPicker.seatNumber}
            >
              <div className="seat-picker-avatar">{seatPickerTypedName.slice(0, 1).toUpperCase()}</div>
              <div>
                <strong>{seatPickerTypedName}</strong>
                <span>{seatPickerGame?.name ?? 'Table'}</span>
                <small>{seatPickerTypedProfile ? 'Load existing profile and seat' : 'Create profile automatically and seat'}</small>
              </div>
              <em>{seatPickerTypedProfile ? 'Profile' : 'New'}</em>
            </button>
          ) : null}
          {seatPickerCandidates.length ? (
            seatPickerCandidates.map(({ profile, activeInterest, isCheckedIn, gameContext }) => (
              <button
                className="seat-picker-card"
                key={profile.id}
                type="button"
                onClick={() => seatProfileAtTable(seatPickerSession, seatPicker.seatNumber, profile, Number(seatPicker.timeMinutes), seatPickerInitialBuyIn)}
                disabled={!seatPicker.seatNumber}
              >
                <div className="seat-picker-avatar">{profile.name.slice(0, 1).toUpperCase()}</div>
                <div>
                  <strong>{profile.name}</strong>
                  <span>{gameContext}</span>
                  <small>{isCheckedIn ? `Checked in${activeInterest?.status ? ` - ${activeInterest.status}` : ''}` : 'Not checked in - will check in now'}</small>
                </div>
                <em>{formatHours(profile.totalTimePlayedHours || 0)}</em>
              </button>
            ))
          ) : (
            <p className="muted-copy">
              {showSeatPickerTypedName ? 'No existing profile matches. Press Enter or Seat Player to create one and seat them.' : 'Type a player name to seat them here.'}
            </p>
          )}
        </div>
      </section>
    </div>,
    document.body,
  ) : null;

  const cashOutPlayerSession = cashOutDraft
    ? state.playerSessions.find((playerSession) => playerSession.id === cashOutDraft.playerSessionId)
    : undefined;
  const cashOutModal = cashOutDraft && cashOutPlayerSession ? createPortal(
    <div className="modal-backdrop cash-out-backdrop" role="dialog" aria-modal="true" aria-label={`Cash out ${cashOutPlayerSession.playerName}`}>
      <form
        className="cash-out-modal"
        onSubmit={(event) => {
          event.preventDefault();
          const amountInput = cashOutDraft.amount.trim();
          const amount = amountInput ? Number(amountInput) : undefined;
          if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) return;
          markPlayerSessionLeft(cashOutPlayerSession, amount, cashOutDraft.note);
          setCashOutDraft(null);
        }}
      >
        <div className="cash-out-head">
          <div><span>Close player session</span><h2>{cashOutPlayerSession.playerName}</h2></div>
          <button className="icon-button" type="button" onClick={() => setCashOutDraft(null)}><X size={18} /></button>
        </div>
        <label>Cash-out amount (optional)<input autoFocus type="number" min="0" step="0.01" value={cashOutDraft.amount} onChange={(event) => setCashOutDraft({ ...cashOutDraft, amount: event.target.value })} placeholder="$0.00" /></label>
        <label>Note<input value={cashOutDraft.note} onChange={(event) => setCashOutDraft({ ...cashOutDraft, note: event.target.value })} placeholder="Optional note" /></label>
        <div className="cash-out-actions"><button className="ghost-button" type="button" onClick={() => setCashOutDraft(null)}>Cancel</button><button className="primary-button" type="submit">Close player session</button></div>
      </form>
    </div>,
    document.body,
  ) : null;

  const ledgerSession = tableLedgerSessionId ? state.sessions.find((session) => session.id === tableLedgerSessionId) : undefined;
  const tableLedgerModal = ledgerSession ? createPortal(
    <div className="modal-backdrop cash-ledger-backdrop" role="dialog" aria-modal="true" aria-label={`${ledgerSession.label} buy-in ledger`}>
      <section className="cash-ledger-modal">
        <div className="cash-ledger-head"><div><span>{state.games.find((game) => game.id === ledgerSession.gameId)?.name ?? 'Table'}</span><h2>{ledgerSession.label} ledger</h2></div><button className="icon-button" onClick={() => setTableLedgerSessionId(null)}><X size={18} /></button></div>
        <TableBuyInLedger state={state} session={ledgerSession} formatClock={formatClock} />
      </section>
    </div>,
    document.body,
  ) : null;

  if (route === 'table') {
    const hashQuery = window.location.hash.split('?')[1] ?? '';
    const routeSessionId = new URLSearchParams(hashQuery).get('sessionId') ?? '';
    const storedSessionId = routeSessionId || localStorage.getItem(`${storageKey}:table-view-session`) || '';
    const visibleSessions = state.sessions.filter((session) => session.status !== 'Closed' && session.status !== 'Failed to Start');
    const tableSession = visibleSessions.find((session) => session.id === storedSessionId) ?? visibleSessions[0];
    const tableGame = tableSession ? state.games.find((game) => game.id === tableSession.gameId) : undefined;
    const seatedPlayers = tableSession
      ? state.playerSessions.filter((playerSession) => playerSession.tableId === tableSession.id && !playerSession.leftAt)
      : [];
    const isTimeCollection = Boolean(tableSession && (tableSession.collectionMode === 'Time' || tableSession.timeFeeBased));
    const tableAverageStack = tableSession ? getAverageStackForTable(state, tableSession.id) : 0;
    const pokerTablePlayers: PokerTablePlayer[] = seatedPlayers.map((playerSession, index) => {
      const hours = getPlayerLoggedHours(state, playerSession);
      const buyIns = getSessionBuyIns(state, playerSession);
      const buyInTotal = buyIns.reduce((sum, buyIn) => sum + buyIn.amount, 0);
      return {
        id: playerSession.id,
        seatNumber: playerSession.seatNumber ?? index + 1,
        name: playerSession.playerName,
        membershipId: playerSession.profileId ?? playerSession.id.slice(0, 8),
        joinedAt: new Date(playerSession.seatedAt).getTime(),
        hourlyTimeLimit: isTimeCollection ? Math.max(1, playerSession.timePurchasedMinutes ?? 60) : undefined,
        timeRemainingSeconds: isTimeCollection ? getTimeRemainingSeconds(playerSession, clockNow) : undefined,
        tonightHours: formatHours(hours.tonight),
        totalHours: formatHours(hours.total),
        buyInTotal,
        recentBuyIns: buyIns.slice(0, 4).map((buyIn) => ({
          id: buyIn.id,
          label: `$${buyIn.amount.toLocaleString()} at ${formatClock(buyIn.timestamp)}${buyIn.note ? ` - ${buyIn.note}` : ''}`
        }))
      };
    });
    const tableActivity = tableSession ? [
      ...state.buyIns.filter((entry) => entry.tableId === tableSession.id).map((entry) => ({ id: `buyin-${entry.id}`, timestamp: entry.timestamp, type: 'Buy-in', text: `${entry.playerName} bought in for $${entry.amount.toLocaleString()}` })),
      ...state.playerLedger.filter((entry) => entry.tableId === tableSession.id && entry.type === 'Cash-Out').map((entry) => ({ id: `cashout-${entry.id}`, timestamp: entry.timestamp, type: 'Cash-out', text: `${entry.playerName} cashed out${entry.amount !== undefined ? ` for $${entry.amount.toLocaleString()}` : ''}` })),
      ...state.dropLogs.filter((entry) => entry.tableId === tableSession.id).map((entry) => ({ id: `drop-${entry.id}`, timestamp: entry.timestamp, type: 'Drop', text: `$${entry.amount.toLocaleString()} removed from the table${entry.note ? ` · ${entry.note}` : ''}` })),
      ...state.tableEvents.filter((entry) => entry.tableId === tableSession.id).map((entry) => ({ id: `event-${entry.id}`, timestamp: entry.timestamp, type: entry.type, text: entry.note || entry.reason || entry.type }))
    ].sort((left, right) => right.timestamp.localeCompare(left.timestamp)) : [];
    const tableBuyInRows = tableSession ? state.buyIns
      .filter((entry) => entry.tableId === tableSession.id)
      .map((entry) => {
        const playerSession = state.playerSessions.find((session) =>
          session.tableId === tableSession.id && (
            entry.profileId ? session.profileId === entry.profileId : session.playerName.toLowerCase() === entry.playerName.toLowerCase()
          )
        );
        return { entry, seatNumber: playerSession?.seatNumber };
      })
      .sort((left, right) => right.entry.timestamp.localeCompare(left.entry.timestamp)) : [];
    const tableTimePlayers = seatedPlayers
      .map((playerSession) => {
        const seatedAtMs = new Date(playerSession.seatedAt).getTime();
        return {
          playerSession,
          remainingSeconds: getTimeRemainingSeconds(playerSession, clockNow),
          elapsedSeconds: Number.isFinite(seatedAtMs)
            ? Math.max(0, Math.floor((clockNow - seatedAtMs) / 1000))
            : 0,
          hasTimer: Boolean(isTimeCollection || playerSession.timeFeeEnabled)
        };
      })
      .sort((left, right) => {
        if (left.hasTimer !== right.hasTimer) return left.hasTimer ? -1 : 1;
        if (left.hasTimer && right.hasTimer) return left.remainingSeconds - right.remainingSeconds;
        return (left.playerSession.seatNumber ?? 99) - (right.playerSession.seatNumber ?? 99);
      });
    const tableFinancialOverview = tableSession
      ? getTableFinancialOverview(state, tableSession)
      : null;
    const tableSeatHours = tableSession
      ? state.playerSessions
          .filter((playerSession) => playerSession.tableId === tableSession.id)
          .reduce((sum, playerSession) => {
            const startedAt = new Date(playerSession.seatedAt).getTime();
            const endedAt = playerSession.leftAt ? new Date(playerSession.leftAt).getTime() : clockNow;
            if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return sum;
            return sum + Math.max(0, endedAt - startedAt) / 36e5;
          }, 0)
      : 0;
    const tableRevenueEstimate: PokerTableRevenueEstimate | undefined = tableSession && tableFinancialOverview
      ? isTimeCollection
        ? {
            label: 'Time revenue',
            value: `$${tableFinancialOverview.totalTimeFees.toFixed(2)}`
          }
        : {
            label: 'Est. drop revenue',
            value: `$${(tableSeatHours * getCollectionProfile(state, tableSession.gameId).estimatedDropPerSeatHour).toFixed(2)}`
          }
      : undefined;
    const currentTableDealer = tableSession
      ? state.dealerAssignments
          .filter((assignment) => assignment.tableId === tableSession.id && !assignment.endedAt)
          .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0]
      : undefined;
    const tableDealerOptions = Array.from(new Set([
      ...state.settings.staffAccounts.filter((staff) => staff.active).map((staff) => staff.name.trim()),
      ...state.dealerAssignments.map((assignment) => assignment.dealerName.trim())
    ].filter(Boolean))).sort((left, right) => left.localeCompare(right));
    const tableDealerControl: PokerTableDealerControl | undefined = tableSession
      ? {
          currentDealer: currentTableDealer?.dealerName,
          value: dealerDrafts[tableSession.id] ?? currentTableDealer?.dealerName ?? '',
          options: tableDealerOptions,
          onChange: (dealerName) => setDealerDrafts((drafts) => ({ ...drafts, [tableSession.id]: dealerName })),
          onAssign: () => assignDealer(
            tableSession,
            dealerDrafts[tableSession.id] ?? currentTableDealer?.dealerName ?? ''
          ),
          onEnd: currentTableDealer ? () => endDealerAssignment(tableSession) : undefined
        }
      : undefined;

    return <TableView
      tableGame={tableGame}
      tableSession={tableSession}
      seatedPlayers={seatedPlayers}
      tableAverageStack={tableAverageStack}
      isTimeCollection={isTimeCollection}
      seatPickerModal={seatPickerModal}
      cashOutModal={cashOutModal}
      tableLedgerModal={tableLedgerModal}
      tableActivity={tableActivity}
      tableBuyInRows={tableBuyInRows}
      tableTimePlayers={tableTimePlayers}
      pokerTablePlayers={pokerTablePlayers}
      tableRevenueEstimate={tableRevenueEstimate}
      tableDealerControl={tableDealerControl}
      tableEventLogSessionId={tableEventLogSessionId}
      seatPicker={seatPicker}
      closeRoute={closeRoute}
      formatClock={formatClock}
      formatTimeLeft={formatTimeLeft}
      getTimerStatusFromSeconds={getTimerStatusFromSeconds}
      getMoveTargets={getMoveTargets}
      openSeatPicker={openSeatPicker}
      addPlayerTime={addPlayerTime}
      addBuyIn={addBuyIn}
      requestPlayerCashOut={requestPlayerCashOut}
      changePlayerSeat={changePlayerSeat}
      movePlayerToTable={movePlayerToTable}
      setTableEventLogSessionId={setTableEventLogSessionId}
      setTableLedgerSessionId={setTableLedgerSessionId}
    />;
  }

  return withShell('floor', (
    <FloorView
      state={state}
      clockNow={clockNow}
      openPanels={openPanels}
      collapsedTables={collapsedTables}
      startPlayerDrafts={startPlayerDrafts}
      eventDrafts={eventDrafts}
      dropDrafts={dropDrafts}
      dealerDrafts={dealerDrafts}
      handCountDrafts={handCountDrafts}
      formingGameId={formingGameId}
      financialOverviewTableId={financialOverviewTableId}
      waitlistPopupOpen={waitlistPopupOpen}
      seatPickerModal={seatPickerModal}
      cashOutModal={cashOutModal}
      tableLedgerModal={tableLedgerModal}
      seatPicker={seatPicker}
      activityItems={floorActivityItems}
      quickAddOpenSeatSessions={quickAddOpenSeatSessions}
      form={form}
      statuses={statuses}
      checkInSearch={checkInSearch}
      checkInMatches={checkInMatches}
      inClubInterests={inClubInterests}
      failedStartReasons={failedStartReasons}
      tableBreakReasons={tableBreakReasons}
      setWaitlistPopupOpen={setWaitlistPopupOpen}
      setOpenPanels={setOpenPanels}
      setCollapsedTables={setCollapsedTables}
      setStartPlayerDrafts={setStartPlayerDrafts}
      setEventDrafts={setEventDrafts}
      setDropDrafts={setDropDrafts}
      setDealerDrafts={setDealerDrafts}
      setHandCountDrafts={setHandCountDrafts}
      setFormingGameId={setFormingGameId}
      setFinancialOverviewTableId={setFinancialOverviewTableId}
      setTableLedgerSessionId={setTableLedgerSessionId}
      setForm={setForm}
      setCheckInSearch={setCheckInSearch}
      minutesSince={minutesSince}
      getAvailableSeatNumber={getAvailableSeatNumber}
      getActivePlayerSessionsForTable={getActivePlayerSessionsForTable}
      getSeatOptions={getSeatOptions}
      getTimeRemainingSeconds={getTimeRemainingSeconds}
      getMoveTargets={getMoveTargets}
      formatHours={formatHours}
      formatClock={formatClock}
      formatTimeLeft={formatTimeLeft}
      toDateTimeInput={toDateTimeInput}
      togglePanel={togglePanel}
      seatInterestAtTable={seatInterestAtTable}
      updateInterest={updateInterest}
      deleteInterest={deleteInterest}
      openTableView={openTableView}
      openSeatPicker={openSeatPicker}
      startSessionWithPlayers={startSessionWithPlayers}
      updateSession={updateSession}
      recordTableEvent={recordTableEvent}
      toggleStartPlayer={toggleStartPlayer}
      addPlayerTime={addPlayerTime}
      addBuyIn={addBuyIn}
      requestPlayerCashOut={requestPlayerCashOut}
      changePlayerSeat={changePlayerSeat}
      movePlayerToTable={movePlayerToTable}
      setTableCollectionMode={setTableCollectionMode}
      updateSessionTimestamp={updateSessionTimestamp}
      assignDealer={assignDealer}
      endDealerAssignment={endDealerAssignment}
      recordHands={recordHands}
      addTableDrop={addTableDrop}
      failFormingGame={failFormingGame}
      addPhysicalTable={addPhysicalTable}
      addSession={addSession}
      setFloorViewMode={(mode) => updateSettings({ showPlayerGrid: mode === 'graphic' })}
      clearTable={clearTable}
      deleteTable={deleteTable}
      mergeTable={mergeTable}
      addInterest={addInterest}
      checkInProfileFromSearch={checkInProfileFromSearch}
    />
  ));
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RecoveryBoundary label="Orbit">
      <App />
    </RecoveryBoundary>
  </React.StrictMode>
);
