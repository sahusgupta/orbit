import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as Dialog from '@radix-ui/react-dialog';
import {
  BadgeCheck,
  Bell,
  ChevronDown,
  ChevronUp,
  Clock,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit3,
  Eye,
  FileText,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  MessageCircle,
  MoreHorizontal,
  Moon,
  Plus,
  Play,
  Save,
  Settings,
  Target,
  Trash2,
  Upload,
  Users,
  WalletCards,
  X
} from 'lucide-react';
import branding from '../branding.config.json';
import PokerTable, { type Player as PokerTablePlayer } from './components/PokerTable';
import AppShell, { type PrimaryDestination, type ShellCommand } from './components/AppShell';
import BuilderView from './components/BuilderView';
import FloorView from './components/FloorView';
import KpisView from './components/KpisView';
import PanelTitle from './components/PanelTitle';
import ProfilesView from './components/ProfilesView';
import SettingsView from './components/SettingsView';
import SignalsView, { type GroupMeCandidate } from './components/SignalsView';
import SummaryView from './components/SummaryView';
import TableView from './components/TableView';
import TournamentsView from './components/TournamentsView';
import TournamentTvView from './components/TournamentTvView';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './components/ui/dropdown-menu';
import {
  countActivePlayersForTable,
  createBackupEnvelope,
  filterRecentActivityAfterClose,
  getGameFrequencyRank,
  getLatestLockedNightCloseAt,
  getTimerStatusFromMinutes,
  getTimerStatusFromSeconds,
  readBackupEnvelope,
  resolveGameId
} from './lib/appCore';
import { AccountRecoveryValidationError, recoverAccountLogin } from './lib/accountRecovery';
import { validateMembershipQrCheckIn } from './lib/membershipQr';
import {
  findUniqueProfileReference,
  hasProfileReference
} from './lib/profileRelationships';
import { sendFirebasePasswordResetEmail, signInOrCreateFirebaseEmailAccount, signInToFirebaseWithEmail, signOutOfFirebase } from './lib/firebaseClubSync';
import { getBalancePlans, parseGroupMeMessages, type BalancePlanResult } from './lib/resultBuilders';
import {
  nextYearDate,
  normalizeState,
  normalizeTableCap,
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
  syncSessionSeatCount,
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
  createBalancedTable as createBalancedTableInState,
  createDemandFormingTable,
  createFormingTable,
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
import {
  canUseRendererFirebaseAuth,
  loadExistingManagementStateForAccount,
  loadManagementState,
  saveManagementState
} from './app/persistence/managementPersistence';
import {
  getCollectionProfile
} from './domain/reporting';
import {
  getAccountKeyFromState,
  getAuthStorageKey,
  hasPersistedSignIn,
  isPilotAccessActive,
  managementStorageKey as storageKey,
  persistSignIn,
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
  getClosestGameLabel,
  getDemand,
  getOpenSessions,
  getOverflowOpportunities,
  getPlayerLoggedHours,
  getRunningSessions,
  getSessionBuyIns,
  getSessionSeatHours,
  getStaffScripts,
  getTableHealth,
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
  GameStatus,
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
  Tournament,
  UsageEvent
} from './domain/types';
import './styles.css';

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
      getBackendStatus: () => Promise<BackendStatus>;
      validatePilotAccess: (access: PilotAccess) => Promise<{
        ok: boolean;
        managed: boolean;
        active: boolean;
        license?: { licenseId?: string; accountKey?: string; issuedTo?: string; expiresAt?: string; status?: string } | null;
        error?: string;
      }>;
      submitAnalyticalReport: (report: AnalyticalReportPayload) => Promise<ReportSubmissionResult>;
      recordClientEvent: (
        event: string,
        category: string,
        details?: Record<string, string | number | boolean | null>,
        route?: AppRoute | 'access'
      ) => Promise<{ ok: boolean }>;
      sendTextMessages: (payload: TextMessageBatch) => Promise<TextMessageBatchResult>;
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
const tableCaps = [6, 8, 10] as const satisfies readonly TableCap[];
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
const getLevelsUntilBreak = (tournament?: Tournament | null) => {
  if (!tournament) return null;
  for (let index = tournament.currentLevelIndex; index < tournament.levels.length; index += 1) {
    if (tournament.levels[index]?.breakAfter) return index - tournament.currentLevelIndex + 1;
  }
  return null;
};
const formatMinutesLeft = (minutes: number) => {
  if (minutes <= 0) return '0m';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours ? `${hours}h ${mins}m` : `${mins}m`;
};
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
const getTimeStatus = getTimerStatusFromMinutes;
const toDateTimeInput = (iso?: string) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
const fromDateTimeInput = (value: string) => (value ? new Date(value).toISOString() : undefined);
const markManualEdit = (edits: Record<string, string> | undefined, key: string) => ({ ...(edits ?? {}), [key]: nowIso() });
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
    overviewTableId,
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
    setOverviewTableId,
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
  const [groupMeText, setGroupMeText] = useState('');
  const [groupMeCandidates, setGroupMeCandidates] = useState<GroupMeCandidate[]>([]);
  const [staffFeedback, setStaffFeedback] = useState('');
  const [ownerFeedback, setOwnerFeedback] = useState('');
  const settingsWorkspace = useSettingsWorkspaceState(state);
  const {
    backendStatus,
    clubDraft,
    hasAuthenticated,
    loginDraft,
    passwordRecoveryNotice,
    passwordRecoveryStage,
    pendingPilotAccess,
    pilotKeyError,
    saveStatus,
    settingsSection,
    setupDraft,
    staffDraft,
    setBackendStatus,
    setClubDraft,
    setHasAuthenticated,
    setLoginDraft,
    setPasswordRecoveryNotice,
    setPasswordRecoveryStage,
    setPendingPilotAccess,
    setPilotKeyError,
    setSaveStatus,
    setSettingsSection,
    setSetupDraft,
    setStaffDraft
  } = settingsWorkspace;
  const [reportMessage, setReportMessage] = useState('');
  const [backupMessage, setBackupMessage] = useState('');
  const [undoStack, setUndoStack] = useState<AppState[]>([]);
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
  const [gameFormatFilter, setGameFormatFilter] = useState('All formats');
  const [gameStakesFilter, setGameStakesFilter] = useState('All stakes');
  const [gameStatusFilter, setGameStatusFilter] = useState('All statuses');
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [coordinationConfig, setCoordinationConfig] = useState({ gameId: 'nlh-1-2', seats: 10 });
  const {
    analytics,
    nightCloseFinancials,
    nightCloseTotalProfit,
    operationalOpportunities,
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
  const overflowOpportunities = useMemo(() => getOverflowOpportunities(state), [state]);
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
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useManagementUpdatePreservation(state);

  useEffect(() => {
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
      setUndoStack((previous: any) => [state, ...previous].slice(0, 5));
    }
    setState(next);
    setSaveStatus({ state: 'saving', message: 'Saving...' });
    saveManagementState(next)
      .then(() => setSaveStatus({ state: 'saved', message: `Saved ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` }))
      .catch((error) => {
        setSaveStatus({
          state: 'error',
          message: error instanceof Error ? `Save failed: ${error.message}` : 'Save failed'
        });
      });
  };

  const withCorrectionLog = (next: AppState, entity: string, field: string, note: string) => ({
    ...next,
    correctionLog: [
      {
        id: uid(),
        entity,
        field,
        note,
        timestamp: nowIso()
      },
      ...next.correctionLog
    ].slice(0, 50)
  });

  const undoLastAction = () => {
    const [previous, ...rest] = undoStack;
    if (!previous) return;
    setUndoStack(rest);
    setState(previous);
    setSaveStatus({ state: 'saving', message: 'Saving undo...' });
    saveManagementState(previous)
      .then(() => setSaveStatus({ state: 'saved', message: 'Undo saved' }))
      .catch(() => setSaveStatus({ state: 'error', message: 'Undo save failed' }));
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

  const quickFillProfile = (profile: PlayerProfile) => {
    setForm({
      playerName: profile.name,
      gameId: profile.preferredGameIds[0] ?? form.gameId,
      status: 'Confirmed Coming',
      notes: profile.notes ? `Profile note: ${profile.notes}` : '',
      tableId: '',
      seatNumber: '',
      initialBuyIn: ''
    });
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

  const assignDealer = (session: GameSession) => {
    const dealerName = dealerDrafts[session.id] ?? '';
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

  const findOpenSeatSession = (gameId?: string) => getOpenSeatSessions(gameId)[0];

  const findAnyRunningOpenSeatSession = () =>
    state.sessions
      .filter((session) => session.status === 'Running' && Boolean(getAvailableSeatNumber(session)))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0];

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

  const seatInterest = (interest: Interest) => seatInterestAtTable(interest);

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

  const markPlayerLeft = (interest: Interest) => {
    const result = markInterestPlayerLeft(state, interest, { nowIso });
    const finalState = result.notification
      ? withGameFrequencyInAppNotifications(result.state, result.notification.gameId, result.notification.reason)
      : result.state;
    persist(finalState);
  };

  const markPlayerSessionLeft = (playerSession: PlayerSession, cashOutAmount: number, cashOutNote = '') => {
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

  const addSession = (gameId: string) => {
    const result = createFormingTable(state, gameId, { createId: uid, nowIso });
    if (!result) return;
    const notifiedState = withGameFrequencyInAppNotifications(result.state, gameId, 'game-forming');
    persist(notifiedState, true, { feature: 'Tables', action: 'Created forming table', metadata: { gameId } });
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
    if (!result) return;
    persist(result.state, true, {
      feature: 'Table builder',
      action: 'Created planned table',
      metadata: { gameId: coordinationConfig.gameId, players: result.playerCount }
    });
  };

  const createBalancedTable = (plan: BalancePlan) => {
    persist(createBalancedTableInState(state, plan, { createId: uid, nowIso }), true, {
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
      scriptTemplates: state.scriptTemplates.map((template: any, templateIndex: number) => (templateIndex === index ? value : template))
    });
  };

  const addFeedback = (role: 'Staff' | 'Owner', text: string) => {
    if (!text.trim()) return;
    persist({
      ...state,
      feedback: [
        {
          id: uid(),
          role,
          text: text.trim(),
          createdAt: nowIso()
        },
        ...state.feedback
      ]
    }, true, { feature: 'Feedback', action: `Added ${role.toLowerCase()} feedback` });
    if (role === 'Staff') setStaffFeedback('');
    if (role === 'Owner') setOwnerFeedback('');
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
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `table-manager-pilot-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
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
        const rows = parseCsvRows(await file.text());
        commitImportedProfiles(profilesFromImportedRecords(rows, profileImportContext));
        setImportText('');
        return;
      }
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

  const signNightClose = () => {
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

  const approveAndLockNightClose = () => {
    const validationError = getNightCloseLockError(state, currentNightClose);
    if (validationError) {
      window.alert(validationError);
      return;
    }
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

  const reopenNightClose = () => {
    const validationError = getNightCloseReopenError(state, currentNightClose);
    if (validationError) {
      window.alert(validationError);
      return;
    }
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
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `table-manager-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setBackupMessage('Backup exported.');
  };

  const importBackupFile = async (file?: File) => {
    setBackupMessage('');
    if (!file) return;
    try {
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
      ...reportAnalytics.waitByGame.map((item: { game: any; count: any; averageMinutes: number; }) => [`Wait by game - ${item.game}`, item.count ? `${item.averageMinutes.toFixed(0)} minutes` : 'No seated waits']),
      ...reportState.tableEvents
        .filter((event: { type: string; }) => event.type === 'Failed to Start' || event.type === 'Broke')
        .map((event: TableEvent) => [`${event.type} reason`, `${event.reason || 'Unspecified'}${event.note ? ` - ${event.note}` : ''}`])
    ];
    const csv = rows.map((row) => row.map((cell: string) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `table-manager-${reportPeriod}-report-${reportAnchorDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
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
        window.location.hash = tvRoute;
      });
      return;
    }
    window.location.hash = tvRoute;
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
    openTournamentTv,
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
    persist({
      ...state,
      games: state.games.map((game) => ({ ...game, maxSeats: cap })),
      sessions: state.sessions.map((session) => {
        const activeSeats = getActivePlayerSessionsForTable(state, session.id).length;
        const safeCap = Math.max(cap, normalizeTableCap(activeSeats));
        return { ...session, maxSeats: safeCap, seatsFilled: Math.min(safeCap, activeSeats) };
      }),
      settings: { ...state.settings, defaultTableCap: cap }
    }, true, {
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
    if (!/^\S+@\S+\.\S+$/.test(username) || password.length < 8) {
      setPilotKeyError('Enter a valid login email and a password with at least 8 characters.');
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
    persistSignIn(next, loginDraft.staySignedIn);
    setHasAuthenticated(true);
    setPilotKeyError('');
    persist(next, false, { feature: 'Account', action: 'Signed in', route: 'access' });
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
      persistSignIn(next, loginDraft.staySignedIn);
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
    persistSignIn(next, setupDraft.staySignedIn);
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
    setHasAuthenticated(hasPersistedSignIn(next));
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
    persistSignIn(next, setupDraft.staySignedIn);
    setHasAuthenticated(true);
    persist(next, true, { feature: 'Account', action: 'Activated pilot key', route: 'access' });
    window.location.hash = '/floor';
  };

  const applyReplacementPilotKey = async (file?: File) => {
    setPilotKeyError('');
    if (!file) return;
    try {
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
        activeStaffId: state.settings.activeStaffId ?? account.id
      }
    }, true, { feature: 'Staff accounts', action: 'Added staff account', metadata: { role: account.role } });
    setStaffDraft({ name: '', role: 'Floor', pin: '' });
    setBackupMessage('Staff account added.');
  };

  const selectActiveStaff = (staffId: string) => {
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

  const deactivateStaffAccount = (staffId: string) => {
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
      onSignOut={() => { persistSignIn(state, false); signOutOfFirebase().catch(() => undefined); setHasAuthenticated(false); }}
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
      {content}
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
            <input value={setupDraft.username} onChange={(event) => setSetupDraft({ ...setupDraft, username: event.target.value })} placeholder="Login email" type="email" />
            <input value={setupDraft.password} onChange={(event) => setSetupDraft({ ...setupDraft, password: event.target.value })} placeholder="Password" type="password" />
            <input value={setupDraft.confirmPassword} onChange={(event) => setSetupDraft({ ...setupDraft, confirmPassword: event.target.value })} placeholder="Confirm password" type="password" />
            <label className="switch-control">
              <input type="checkbox" checked={setupDraft.staySignedIn} onChange={(event) => setSetupDraft({ ...setupDraft, staySignedIn: event.target.checked })} />
              <span>Stay signed in until key expiration</span>
            </label>
            <button className="primary-button" type="submit">Create Login</button>
            {pilotKeyError ? <p className="access-error">{pilotKeyError}</p> : null}
          </form>
        </section>
      </main>
    );
  }

  if (isPilotAccessActive(state.settings.pilotAccess) && !hasAuthenticated) {
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
          <form className="access-step account-form" onSubmit={passwordRecoveryStage === 'idle' ? signInToAccount : completeAccountPasswordRecovery}>
            <input value={loginDraft.username} onChange={(event) => setLoginDraft({ ...loginDraft, username: event.target.value })} placeholder="Email" type="email" autoComplete="email" readOnly={passwordRecoveryStage !== 'idle'} />
            <input value={loginDraft.password} onChange={(event) => setLoginDraft({ ...loginDraft, password: event.target.value })} placeholder={passwordRecoveryStage === 'sent' ? 'New password' : 'Password'} type="password" autoComplete={passwordRecoveryStage === 'sent' ? 'new-password' : 'current-password'} />
            <label className="switch-control">
              <input type="checkbox" checked={loginDraft.staySignedIn} onChange={(event) => setLoginDraft({ ...loginDraft, staySignedIn: event.target.checked })} />
              <span>Stay signed in until key expiration</span>
            </label>
            {passwordRecoveryNotice ? <p className="success-copy" role="status">{passwordRecoveryNotice}</p> : null}
            <button className="primary-button" type="submit" disabled={passwordRecoveryStage === 'sending' || passwordRecoveryStage === 'verifying'}>
              {passwordRecoveryStage === 'sent' || passwordRecoveryStage === 'verifying'
                ? passwordRecoveryStage === 'verifying' ? 'Verifying...' : 'Finish Password Reset'
                : 'Sign In'}
            </button>
            {passwordRecoveryStage === 'idle' ? (
              <button className="ghost-button" type="button" onClick={requestAccountPasswordReset}>Forgot password?</button>
            ) : (
              <button className="ghost-button" type="button" onClick={resetPasswordRecovery} disabled={passwordRecoveryStage === 'sending' || passwordRecoveryStage === 'verifying'}>Back to sign in</button>
            )}
            <button className="ghost-button" type="button" onClick={() => { resetPasswordRecovery(); setState(seedState); }}>Use a different key</button>
            {pilotKeyError ? <p className="access-error">{pilotKeyError}</p> : null}
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
              <input
                value={clubDraft.clubName}
                onChange={(event) => setClubDraft({ ...clubDraft, clubName: event.target.value })}
                placeholder="Club name"
              />
              <input
                value={clubDraft.accountName}
                onChange={(event) => setClubDraft({ ...clubDraft, accountName: event.target.value })}
                placeholder="Account name"
              />
              <input
                value={clubDraft.contactName}
                onChange={(event) => setClubDraft({ ...clubDraft, contactName: event.target.value })}
                placeholder="Primary contact"
              />
              <input
                type="email"
                value={clubDraft.email}
                onChange={(event) => setClubDraft({ ...clubDraft, email: event.target.value })}
                placeholder="Email"
              />
              <input
                value={clubDraft.phone}
                onChange={(event) => setClubDraft({ ...clubDraft, phone: event.target.value })}
                placeholder="Phone"
              />
              <input
                value={clubDraft.address}
                onChange={(event) => setClubDraft({ ...clubDraft, address: event.target.value })}
                placeholder="Club address"
              />
              <input
                value={setupDraft.username}
                onChange={(event) => setSetupDraft({ ...setupDraft, username: event.target.value })}
                placeholder="Login email (defaults to club email)"
                type="email"
              />
              <input
                value={setupDraft.password}
                onChange={(event) => setSetupDraft({ ...setupDraft, password: event.target.value })}
                placeholder="Create password"
                type="password"
              />
              <input
                value={setupDraft.confirmPassword}
                onChange={(event) => setSetupDraft({ ...setupDraft, confirmPassword: event.target.value })}
                placeholder="Confirm password"
                type="password"
              />
              <textarea
                value={setupDraft.initialGames}
                onChange={(event) => setSetupDraft({ ...setupDraft, initialGames: event.target.value })}
                placeholder="Games offered, one per line"
              />
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
              <input
                type="number"
                min="0"
                value={setupDraft.defaultHourlyFee}
                onChange={(event) => setSetupDraft({ ...setupDraft, defaultHourlyFee: Number(event.target.value) })}
                placeholder="Hourly fee"
              />
              <input
                type="number"
                min="0"
                value={setupDraft.defaultEstimatedDropPerSeatHour}
                onChange={(event) => setSetupDraft({ ...setupDraft, defaultEstimatedDropPerSeatHour: Number(event.target.value) })}
                placeholder="Drop estimate per occupied seat-hour"
              />
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
        <TournamentTvView tournament={tournament} nowMs={clockNow} remainingSeconds={remaining} prizePool={prizePool} />
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

  const latestLockedNightCloseAt = getLatestLockedNightCloseAt(state.nightCloses);
  const liveFeedItems = filterRecentActivityAfterClose([
    ...state.playerLedger.map((entry) => {
      const game = state.games.find((item) => item.id === entry.gameId);
      const amount = entry.amount ? ` $${entry.amount.toLocaleString()}` : '';
      return {
        id: `ledger-${entry.id}`,
        timestamp: entry.timestamp,
        label: entry.type,
        actor: entry.playerName,
        detail: `${game?.name ?? 'Floor'}${amount}${entry.note ? ` - ${entry.note}` : ''}`,
        kind: entry.type.toLowerCase().replace(/\s+/g, '-')
      };
    }),
    ...state.tableEvents.map((event) => {
      const game = state.games.find((item) => item.id === event.gameId);
      return {
        id: `table-${event.id}`,
        timestamp: event.timestamp,
        label: event.type,
        actor: game?.name ?? 'Table',
        detail: [event.note, event.reason, event.playerCount ? `${event.playerCount} players` : ''].filter(Boolean).join(' - '),
        kind: 'table'
      };
    }),
    ...state.dropLogs.map((drop) => {
      const game = state.games.find((item) => item.id === drop.gameId);
      return {
        id: `drop-${drop.id}`,
        timestamp: drop.timestamp,
        label: 'Drop',
        actor: game?.name ?? 'Table',
        detail: `$${drop.amount.toLocaleString()}${drop.note ? ` - ${drop.note}` : ''}`,
        kind: 'drop'
      };
    })
  ], latestLockedNightCloseAt)
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .slice(0, 18);

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
  const seatPickerModal = seatPicker && seatPickerSession ? (
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
    </div>
  ) : null;

  const cashOutPlayerSession = cashOutDraft
    ? state.playerSessions.find((playerSession) => playerSession.id === cashOutDraft.playerSessionId)
    : undefined;
  const cashOutModal = cashOutDraft && cashOutPlayerSession ? (
    <div className="modal-backdrop cash-out-backdrop" role="dialog" aria-modal="true" aria-label={`Cash out ${cashOutPlayerSession.playerName}`}>
      <form
        className="cash-out-modal"
        onSubmit={(event) => {
          event.preventDefault();
          const amount = Number(cashOutDraft.amount);
          if (!Number.isFinite(amount) || amount < 0) return;
          markPlayerSessionLeft(cashOutPlayerSession, amount, cashOutDraft.note);
          setCashOutDraft(null);
        }}
      >
        <div className="cash-out-head">
          <div><span>Close player session</span><h2>{cashOutPlayerSession.playerName}</h2></div>
          <button className="icon-button" type="button" onClick={() => setCashOutDraft(null)}><X size={18} /></button>
        </div>
        <label>Cash-out amount<input autoFocus type="number" min="0" step="0.01" required value={cashOutDraft.amount} onChange={(event) => setCashOutDraft({ ...cashOutDraft, amount: event.target.value })} placeholder="$0.00" /></label>
        <label>Note<input value={cashOutDraft.note} onChange={(event) => setCashOutDraft({ ...cashOutDraft, note: event.target.value })} placeholder="Optional note" /></label>
        <div className="cash-out-actions"><button className="ghost-button" type="button" onClick={() => setCashOutDraft(null)}>Cancel</button><button className="primary-button" type="submit">Record cash-out</button></div>
      </form>
    </div>
  ) : null;

  const ledgerSession = tableLedgerSessionId ? state.sessions.find((session) => session.id === tableLedgerSessionId) : undefined;
  const tableLedgerModal = ledgerSession ? (
    <div className="modal-backdrop cash-ledger-backdrop" role="dialog" aria-modal="true" aria-label={`${ledgerSession.label} buy-in ledger`}>
      <section className="cash-ledger-modal">
        <div className="cash-ledger-head"><div><span>{state.games.find((game) => game.id === ledgerSession.gameId)?.name ?? 'Table'}</span><h2>{ledgerSession.label} ledger</h2></div><button className="icon-button" onClick={() => setTableLedgerSessionId(null)}><X size={18} /></button></div>
        <TableBuyInLedger state={state} session={ledgerSession} />
      </section>
    </div>
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
    const tableWaitlist = tableSession
      ? state.interests
          .filter((interest) => interest.gameId === tableSession.gameId && activeInterestStatuses.includes(interest.status))
          .sort((left, right) => left.interestedAt.localeCompare(right.interestedAt))
      : [];
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
      .map((playerSession) => ({
        playerSession,
        remainingSeconds: getTimeRemainingSeconds(playerSession, clockNow),
        hasTimer: Boolean(isTimeCollection || playerSession.timeFeeEnabled)
      }))
      .sort((left, right) => {
        if (left.hasTimer !== right.hasTimer) return left.hasTimer ? -1 : 1;
        if (left.hasTimer && right.hasTimer) return left.remainingSeconds - right.remainingSeconds;
        return (left.playerSession.seatNumber ?? 99) - (right.playerSession.seatNumber ?? 99);
      });

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
      analytics={analytics}
      clockNow={clockNow}
      openPanels={openPanels}
      collapsedTables={collapsedTables}
      startPlayerDrafts={startPlayerDrafts}
      eventDrafts={eventDrafts}
      dropDrafts={dropDrafts}
      dealerDrafts={dealerDrafts}
      handCountDrafts={handCountDrafts}
      formingGameId={formingGameId}
      overviewTableId={overviewTableId}
      financialOverviewTableId={financialOverviewTableId}
      waitlistPopupOpen={waitlistPopupOpen}
      seatPickerModal={seatPickerModal}
      cashOutModal={cashOutModal}
      tableLedgerModal={tableLedgerModal}
      seatPicker={seatPicker}
      liveFeedItems={liveFeedItems}
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
      setOverviewTableId={setOverviewTableId}
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
      addSession={addSession}
      addInterest={addInterest}
      checkInProfileFromSearch={checkInProfileFromSearch}
    />
  ));
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <article className="metric-card">
      <div className="metric-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

function TableBuyInLedger({ state, session }: { state: AppState; session: GameSession }) {
  // Keep the raw event rows intact: each reload/add-on is its own ledger entry,
  // even when several entries belong to the same player.
  const buyIns = state.buyIns
    .filter((entry) => entry.tableId === session.id)
    .map((entry, recordedOrder) => ({ ...entry, recordedOrder }));
  const cashOuts = state.playerLedger.filter((entry) => entry.tableId === session.id && entry.type === 'Cash-Out');
  const drops = state.dropLogs.filter((entry) => entry.tableId === session.id);
  const collectionProfile = getCollectionProfile(state, session.gameId);
  const timeFees = (session.collectionMode === 'Time' || session.timeFeeBased)
    ? state.playerSessions
        .filter((playerSession) => playerSession.tableId === session.id && (playerSession.timePurchasedMinutes ?? 0) > 0)
        .map((playerSession) => ({
          id: `time-${playerSession.id}`,
          playerName: playerSession.playerName,
          amount: ((playerSession.timePurchasedMinutes ?? 0) / 60) * collectionProfile.hourlyFee,
          timestamp: playerSession.lastTimeTickAt || playerSession.seatedAt,
          note: `${playerSession.timePurchasedMinutes ?? 0} minutes purchased`
        }))
    : [];
  const totalBuyIns = buyIns.reduce((sum, entry) => sum + entry.amount, 0);
  const totalCashOuts = cashOuts.reduce((sum, entry) => sum + (entry.amount ?? 0), 0);
  const totalDrop = drops.reduce((sum, entry) => sum + entry.amount, 0);
  const totalTimeFees = timeFees.reduce((sum, entry) => sum + entry.amount, 0);
  const totalHouseRevenue = totalDrop + totalTimeFees;
  const cashInPlay = totalBuyIns - totalCashOuts - totalDrop;
  const entries = [
    ...buyIns.map((entry) => ({ ...entry, kind: 'Buy-in', direction: 'in' as const })),
    ...cashOuts.map((entry) => ({ ...entry, amount: entry.amount ?? 0, kind: 'Cash-out', direction: 'out' as const })),
    ...drops.map((entry) => ({ ...entry, playerName: 'House collection', kind: 'Drop', direction: 'fee' as const })),
    ...timeFees.map((entry) => ({ ...entry, kind: 'Time fee', direction: 'in' as const }))
  ].sort((left, right) => {
    const timestampOrder = right.timestamp.localeCompare(left.timestamp);
    if (timestampOrder !== 0) return timestampOrder;
    return ('recordedOrder' in left ? left.recordedOrder : Number.MAX_SAFE_INTEGER)
      - ('recordedOrder' in right ? right.recordedOrder : Number.MAX_SAFE_INTEGER);
  });

  return (
    <section className="cash-ledger">
      <div className="cash-ledger-summary">
        <article><span>Total buy-ins</span><strong>${totalBuyIns.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></article>
        <article><span>Cash-outs</span><strong>${totalCashOuts.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></article>
        <article><span>House revenue</span><strong>${totalHouseRevenue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></article>
        <article className="cash-ledger-balance"><span>Cash in play</span><strong>${cashInPlay.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></article>
      </div>
      <div className="cash-ledger-reconcile">
        <span>Reconciliation</span>
        <code>${totalBuyIns.toLocaleString()} − ${totalCashOuts.toLocaleString()} − ${totalDrop.toLocaleString(undefined, { maximumFractionDigits: 2 })} drop = ${cashInPlay.toLocaleString(undefined, { maximumFractionDigits: 2 })} in play; +${totalTimeFees.toLocaleString(undefined, { maximumFractionDigits: 2 })} time paid separately</code>
      </div>
      <div className="cash-ledger-log">
        {entries.length ? entries.map((entry) => (
          <article className={`cash-ledger-entry ${entry.direction}`} key={`${entry.kind}-${entry.id}`}>
            <div className="cash-ledger-marker" />
            <time dateTime={entry.timestamp}>{formatClock(entry.timestamp)}</time>
            <div className="cash-ledger-entry-copy">
              <strong>{entry.kind}</strong>
              <span>{entry.playerName}{entry.note ? ` · ${entry.note}` : ''}</span>
            </div>
            <em>{entry.direction === 'in' ? '+' : '−'}${entry.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</em>
          </article>
        )) : <div className="cash-ledger-empty"><strong>No transactions yet</strong><span>Buy-ins, cash-outs, drop, and time fees will appear here.</span></div>}
      </div>
    </section>
  );
}


function TagPicker({ selected, onChange }: { selected: TableTag[]; onChange: (tags: TableTag[]) => void }) {
  return (
    <div className="tag-picker">
      {gameQualityTags.map((tag) => {
        const active = selected.includes(tag);
        return (
          <button
            className={active ? 'tag active' : 'tag'}
            key={tag}
            type="button"
            onClick={() => onChange(active ? selected.filter((item) => item !== tag) : [...selected, tag])}
          >
            {tag}
          </button>
        );
      })}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
