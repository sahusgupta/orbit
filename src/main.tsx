import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as Dialog from '@radix-ui/react-dialog';
import type { IScannerControls } from '@zxing/browser';
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
import PanelTitle from './components/PanelTitle';
import ProfilesView from './components/ProfilesView';
import SignalsView, { type GroupMeCandidate } from './components/SignalsView';
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
import { createMembershipWindow, parseMembershipPrice } from './lib/membership';
import { validateMembershipQrCheckIn } from './lib/membershipQr';
import {
  findUniqueProfileReference,
  getProfileReferenceMatches,
  hasProfileReference
} from './lib/profileRelationships';
import { loadClubStateFromFirebase, saveClubStateToFirebase, signInOrCreateFirebaseEmailAccount, signOutOfFirebase, subscribeToPlayerRequestUpdates, syncPlayerUpdatesToClubState } from './lib/firebaseClubSync';
import { rendererFirebaseSyncEnabled } from './lib/firebaseConfig';
import { buildNightCloseTables } from './lib/nightClose';
import {
  getBalancePlans,
  getTodayPlayerActivity,
  parseGroupMeMessages,
  type BalancePlanResult
} from './lib/resultBuilders';
import { mergeSyncedList } from './lib/syncedList';
import {
  defaultTournamentLevels,
  defaultTournamentPayouts,
  nextYearDate,
  normalizeState,
  normalizeTableCap,
  nowIso,
  parsePersistedAppState,
  seedState,
  todayDate,
  uid
} from './domain/state';
import {
  getCollectionProfile,
  getDealerReport,
  getReportFinancials,
  getReportHourlyBreakdown,
  getReportState,
  getReportWindow,
  getTableFinancialOverview,
  getTablePlayerFinancialOverview,
  shiftReportAnchor
} from './domain/reporting';
import {
  getAccountKeyFromAccess,
  getAccountKeyFromState,
  getAuthStorageKey,
  getStorageKeyForState,
  hasPersistedSignIn,
  isFutureDate,
  isPilotAccessActive,
  managementStorageKey as storageKey,
  persistSignIn,
  safeAccountKeyPart,
  validatePilotKey
} from './domain/licensing';
import { hashStaffPin, verifyStaffSecret } from './domain/staffAuth';
import {
  buildAnalyticalReportPayload,
  getAnalytics,
  getOperationalOpportunities,
  getUsageAnalytics,
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
  getTimeRemainingMinutes,
  getViabilityState,
  hoursBetween
} from './domain/operations';
import {
  activeInterestStatuses,
  getInClubInterests,
  getLikelyParticipants,
  getParticipantPool,
  getProfileForInterest,
  hasParticipantInterest,
  inactiveInterestStatuses,
  lacksParticipantInterest
} from './domain/participants';
import type {
  AppRoute,
  AppState,
  ClubAccount,
  CollectionProfile,
  GameConfig,
  GameSession,
  GameStatus,
  Interest,
  InterestStatus,
  NightCloseAudit,
  NightCloseRecord,
  NightCloseStatus,
  PersistedAppState,
  PersistedStateRecord,
  PilotAccess,
  PlayerInAppNotification,
  PlayerProfile,
  PlayerSession,
  ReportPeriod,
  StaffAccount,
  StaffRole,
  TableCap,
  TableEvent,
  TableEventType,
  TableTag,
  Tournament,
  TournamentPlayer,
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

type TodayPlayerRow = {
  id: string;
  playerName: string;
  profileId?: string;
  status: InterestStatus;
  gameName: string;
  tableLabel?: string;
  seatNumber?: number;
  timestamp: string;
  activeMember: boolean;
};

type StaffRequestNotice = {
  id: string;
  kind: 'membership' | 'seat';
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
};

type UsageDescriptor = {
  feature: string;
  action: string;
  metadata?: Record<string, string | number | boolean>;
  route?: AppRoute | 'access';
};

type BrandTheme = typeof branding.theme.default;

type SaveStatus =
  | { state: 'idle'; message: string }
  | { state: 'saving'; message: string }
  | { state: 'saved'; message: string }
  | { state: 'error'; message: string };

type BackendStatus = {
  running: boolean;
  host: string;
  port: number;
  reportCount: number;
};

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

type SeatPickerState = {
  sessionId: string;
  seatNumber: number;
  search: string;
  timeMinutes: string;
  initialBuyIn: string;
  error?: string;
};

type SeatPlayerPayload = {
  playerName?: string;
  profileId?: string;
  interestId?: string;
  requestedSeatNumber?: number;
  initialTimeMinutes?: number;
  initialBuyIn?: number;
  note?: string;
};

type SeatPlayerResult =
  | { ok: true; state: AppState; seatNumber: number; playerName: string; profileId?: string; tableId: string; gameId: string }
  | { ok: false; error: string };

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
const toLocalDateValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatClock = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '-');
const minutesSince = (iso?: string) => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) : 0);
const formatHours = (hours: number) => `${hours.toFixed(1)}h`;
const formatTournamentTime = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};
const getTournamentLevel = (tournament?: Tournament | null) => tournament?.levels[tournament.currentLevelIndex] ?? null;
const getNextTournamentLevel = (tournament?: Tournament | null) => tournament?.levels[(tournament.currentLevelIndex ?? 0) + 1] ?? null;
const getTournamentLevelRemainingSeconds = (tournament: Tournament | null | undefined, nowMs = Date.now()) => {
  const level = getTournamentLevel(tournament);
  if (!tournament || !level) return 0;
  if (tournament.status === 'Paused') return tournament.pausedRemainingSeconds ?? level.durationMinutes * 60;
  if (tournament.status !== 'Running' || !tournament.levelStartedAt) return level.durationMinutes * 60;
  return Math.max(0, level.durationMinutes * 60 - Math.floor((nowMs - new Date(tournament.levelStartedAt).getTime()) / 1000));
};
const getTournamentEntries = (tournament?: Tournament | null) =>
  (tournament?.players ?? []).reduce((sum, player) => sum + 1 + player.rebuys + player.addOns, 0);
const getTournamentActivePlayers = (tournament?: Tournament | null) =>
  (tournament?.players ?? []).filter((player) => player.status !== 'Eliminated').length;
const getTournamentPrizePool = (tournament?: Tournament | null) =>
  (tournament?.players ?? []).reduce((sum, player) => sum + player.buyIn + player.rebuys * (tournament?.rebuyPrice ?? player.buyIn) * ((tournament?.rebuyPrizePercent ?? 100) / 100) + player.addOns * (tournament?.addOnPrice ?? player.buyIn) * ((tournament?.rebuyPrizePercent ?? 100) / 100), 0);
const getTournamentAverageStack = (tournament?: Tournament | null) => {
  const activePlayers = getTournamentActivePlayers(tournament);
  if (!tournament || !activePlayers) return 0;
  const totalChips = (tournament.players ?? []).reduce((sum, player) => sum + (1 + player.rebuys + player.addOns) * player.startingStack, 0);
  return Math.round(totalChips / activePlayers);
};
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
const localOrbitBridgeBaseUrl = (import.meta.env.VITE_ORBIT_LOCAL_API_URL || 'http://127.0.0.1:4629').replace(/\/$/, '');
const publishStateToLocalOrbitBridge = (state: AppState) =>
  fetch(`${localOrbitBridgeBaseUrl}/state`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state })
  }).catch(() => undefined);
const emptyClubAccount: ClubAccount = {
  clubName: '',
  accountName: '',
  contactName: '',
  email: '',
  phone: '',
  address: ''
};
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
function loadState(): AppState {
  try {
    const lastKey = localStorage.getItem(`${storageKey}:last-account`);
    const stored = localStorage.getItem(lastKey || storageKey) ?? localStorage.getItem(storageKey);
    if (!stored) return seedState;
    const parsed = parsePersistedAppState(stored);
    return parsed ? normalizeState(parsed) : seedState;
  } catch {
    return seedState;
  }
}

function canUseRendererFirebaseAuth() {
  return rendererFirebaseSyncEnabled;
}

function saveState(state: AppState) {
  const accountStorageKey = getStorageKeyForState(state);
  localStorage.setItem(accountStorageKey, JSON.stringify(state));
  localStorage.setItem(`${storageKey}:last-account`, accountStorageKey);
  const localSave = window.tableManagerDesktop?.saveState(state) ?? Promise.resolve({ ok: true, path: 'browser-local-storage' });
  if (!window.tableManagerDesktop) {
    void publishStateToLocalOrbitBridge(state);
  }
  if (canUseRendererFirebaseAuth()) {
    saveClubStateToFirebase(state).catch(() => undefined);
  }
  return localSave.then((result) => {
    return { ...result, cloud: 'firebase-pending' };
  });
}

function App() {
  const [state, setState] = useState<AppState>(() => loadState());
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
  const [form, setForm] = useState({
    playerName: '',
    gameId: 'nlh-1-2',
    status: 'Confirmed Coming' as InterestStatus,
    notes: '',
    tableId: '',
    seatNumber: '',
    initialBuyIn: ''
  });
  const [checkInSearch, setCheckInSearch] = useState('');
  const [newProfile, setNewProfile] = useState({
    name: '',
    birthday: '',
    membershipStartDate: todayDate(),
    membershipExpirationDate: nextYearDate(),
    membershipPlan: 'monthly' as 'day' | 'monthly',
    membershipAmount: 0,
    totalTimePlayedHours: 0,
    lastSessionTimePlayedHours: 0,
    commonlyPlaysWithProfileIds: [] as string[],
    preferredGameIds: ['nlh-1-2'],
    preferredGameId: 'nlh-1-2',
    phone: '',
    preferredStakes: '',
    typicalBuyInMin: 200,
    typicalBuyInMax: 500,
    usualCompanions: '',
    typicalAvailability: '',
    willingnessToMove: true,
    preferredTags: [] as TableTag[],
    notes: ''
  });
  const [importText, setImportText] = useState('');
  const [summaryNotes, setSummaryNotes] = useState('');
  const [profileSearch, setProfileSearch] = useState('');
  const [profileFormMessage, setProfileFormMessage] = useState('');
  const [staffRequestNotice, setStaffRequestNotice] = useState<StaffRequestNotice | null>(null);
  const [staffNotifications, setStaffNotifications] = useState<StaffRequestNotice[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(`${storageKey}:staff-notifications`) || '[]');
    } catch {
      return [];
    }
  });
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [profileEditDraft, setProfileEditDraft] = useState<PlayerProfile | null>(null);
  const [groupMeText, setGroupMeText] = useState('');
  const [groupMeCandidates, setGroupMeCandidates] = useState<GroupMeCandidate[]>([]);
  const [staffFeedback, setStaffFeedback] = useState('');
  const [ownerFeedback, setOwnerFeedback] = useState('');
  const [pendingPilotAccess, setPendingPilotAccess] = useState<PilotAccess | null>(null);
  const [pilotKeyError, setPilotKeyError] = useState('');
  const [hasAuthenticated, setHasAuthenticated] = useState(() => hasPersistedSignIn(state));
  const hasPublishedStartupSnapshot = useRef(false);
  const [loginDraft, setLoginDraft] = useState({ username: '', password: '', staySignedIn: false });
  const [setupDraft, setSetupDraft] = useState({
    username: '',
    password: '',
    confirmPassword: '',
    initialGames: '',
    defaultCollectionMode: 'Drop' as 'Time' | 'Drop',
    defaultHourlyFee: 0,
    defaultEstimatedDropPerSeatHour: 0,
    staySignedIn: true
  });
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ state: 'idle', message: 'Ready' });
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const [reportMessage, setReportMessage] = useState('');
  const [backupMessage, setBackupMessage] = useState('');
  const [clubDraft, setClubDraft] = useState<ClubAccount>(() => state.settings.clubAccount ?? emptyClubAccount);
  const [staffDraft, setStaffDraft] = useState<{ name: string; role: StaffRole; pin: string }>({ name: '', role: 'Floor', pin: '' });
  const [undoStack, setUndoStack] = useState<AppState[]>([]);
  const [eventDrafts, setEventDrafts] = useState<Record<string, { failReason: string; failNote: string; breakReason: string; breakNote: string }>>({});
  const [seatPicker, setSeatPicker] = useState<SeatPickerState | null>(null);
  const [startPlayerDrafts, setStartPlayerDrafts] = useState<Record<string, string[]>>({});
  const [formingGameId, setFormingGameId] = useState(() => state.games[0]?.id ?? '');
  const [tableLedgerSessionId, setTableLedgerSessionId] = useState<string | null>(null);
  const [tableEventLogSessionId, setTableEventLogSessionId] = useState<string | null>(null);
  const [cashOutDraft, setCashOutDraft] = useState<{ playerSessionId: string; amount: string; note: string } | null>(null);
  const [buyInDrafts, setBuyInDrafts] = useState<Record<string, { amount: string; note: string }>>({});
  const [dropDrafts, setDropDrafts] = useState<Record<string, { amount: string; note: string }>>({});
  const [dealerDrafts, setDealerDrafts] = useState<Record<string, string>>({});
  const [handCountDrafts, setHandCountDrafts] = useState<Record<string, string>>({});
  const [selectedTournamentId, setSelectedTournamentId] = useState('');
  const [tournamentView, setTournamentView] = useState<'library' | 'create' | 'edit' | 'manage'>('library');
  const [tournamentSection, setTournamentSection] = useState<'clock' | 'players' | 'tables' | 'payouts'>('clock');
  const [tournamentDraft, setTournamentDraft] = useState({
    name: `Tournament ${todayDate()}`,
    buyIn: '100',
    startingStack: '20000',
    levelMinutes: '20',
    rebuyPrizePercent: '100',
    tableSize: '9'
  });
  const [tournamentPlayerDraft, setTournamentPlayerDraft] = useState({ name: '', profileId: '', phone: '', email: '' });
  const [tournamentPayoutDrafts, setTournamentPayoutDrafts] = useState<Record<number, string>>({});
  const [customTimeDrafts, setCustomTimeDrafts] = useState<Record<string, string>>({});
  const [collapsedTables, setCollapsedTables] = useState<Record<string, boolean>>({});
  const [openPanels, setOpenPanels] = useState<Record<string, boolean>>({
    currentTables: true,
    waitlist: true,
    tableOverview: true,
    tableFinancials: true,
    recentActivity: true,
    formingGames: true,
    kpis: false,
    quickAdd: false
  });
  const stateRef = useRef(state);
  const [overviewTableId, setOverviewTableId] = useState('all-time-overview');
  const [financialOverviewTableId, setFinancialOverviewTableId] = useState('all-table-financials');
  const [waitlistPopupOpen, setWaitlistPopupOpen] = useState(false);
  const [playerPopup, setPlayerPopup] = useState<'add' | 'ledger' | 'scan' | null>(null);
  const [qrScanMessage, setQrScanMessage] = useState('Point the camera at an active Orbit membership QR code.');
  const [qrManualValue, setQrManualValue] = useState('');
  const [qrScanAttempt, setQrScanAttempt] = useState(0);
  const qrVideoRef = useRef<HTMLVideoElement | null>(null);
  const qrScannerControlsRef = useRef<IScannerControls | null>(null);
  const [playerSection, setPlayerSection] = useState<'memberships' | 'requests' | 'today'>('memberships');
  const [settingsSection, setSettingsSection] = useState<'club' | 'staff' | 'tables' | 'data' | 'display' | 'legal'>('club');
  const [reportMode, setReportMode] = useState<'kpis' | 'night' | 'close'>('kpis');
  const [nightCloseActuals, setNightCloseActuals] = useState<Record<string, string>>({});
  const [nightCloseNotes, setNightCloseNotes] = useState('');
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>('day');
  const [reportAnchorDate, setReportAnchorDate] = useState(() => toLocalDateValue(new Date()));
  const [kpiCategory, setKpiCategory] = useState<'operations' | 'waitlist' | 'tables' | 'collections'>('operations');
  const [gameFormatFilter, setGameFormatFilter] = useState('All formats');
  const [gameStakesFilter, setGameStakesFilter] = useState('All stakes');
  const [gameStatusFilter, setGameStatusFilter] = useState('All statuses');
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [coordinationConfig, setCoordinationConfig] = useState({ gameId: 'nlh-1-2', seats: 10 });
  const analytics = useMemo(() => getAnalytics(state), [state]);
  const reportWindow = useMemo(() => getReportWindow(reportPeriod, reportAnchorDate), [reportPeriod, reportAnchorDate]);
  const reportState = useMemo(() => getReportState(state, reportWindow), [state, reportWindow]);
  const reportAnalytics = useMemo(() => getAnalytics(reportState), [reportState]);
  const reportFinancials = useMemo(() => getReportFinancials(state, reportWindow), [state, reportWindow]);
  const nightCloseReportDate = toLocalDateValue(new Date(clockNow));
  const nightCloseReportWindow = useMemo(() => getReportWindow('day', nightCloseReportDate), [nightCloseReportDate]);
  const nightCloseFinancials = useMemo(
    () => getReportFinancials(state, nightCloseReportWindow),
    [state, nightCloseReportWindow]
  );
  const nightCloseTotalProfit =
    nightCloseFinancials.recordedDrop + nightCloseFinancials.timeFees + nightCloseFinancials.membershipRevenue;
  const reportHourlyBreakdown = useMemo(() => getReportHourlyBreakdown(state, reportWindow, reportFinancials), [state, reportWindow, reportFinancials]);
  const reportDealerBreakdown = useMemo(() => getDealerReport(state, reportWindow), [state, reportWindow]);
  const reportOpportunities = useMemo(() => getOperationalOpportunities(reportState, reportAnalytics), [reportState, reportAnalytics]);
  const currentReportWindow = getReportWindow(reportPeriod, toLocalDateValue(new Date()));
  const reportIsCurrentPeriod = reportPeriod === 'all' || reportWindow.startMs >= currentReportWindow.startMs;
  const usageAnalytics = useMemo(() => getUsageAnalytics(state), [state]);
  const operationalOpportunities = useMemo(() => getOperationalOpportunities(state, analytics), [state, analytics]);
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
  const selectedTournament = useMemo(
    () => state.tournaments.find((tournament) => tournament.id === selectedTournamentId) ?? state.tournaments[0] ?? null,
    [selectedTournamentId, state.tournaments]
  );

  const announceIncomingPlayerRequest = (previousState: AppState, nextState: AppState) => {
    const showNotification = (notice: Omit<StaffRequestNotice, 'createdAt' | 'read'>) => {
      const notification: StaffRequestNotice = { ...notice, createdAt: nowIso(), read: false };
      setStaffRequestNotice(notification);
      setStaffNotifications((current) => {
        const next = [notification, ...current.filter((item) => item.id !== notification.id)].slice(0, 100);
        localStorage.setItem(`${storageKey}:staff-notifications`, JSON.stringify(next));
        return next;
      });
    };
    const membershipRequest = nextState.profiles
      .filter((profile) => profile.membershipStatus === 'Requested')
      .filter((profile) => !previousState.profiles.some((candidate) =>
        candidate.id === profile.id &&
        candidate.membershipStatus === 'Requested' &&
        candidate.membershipRequestedAt === profile.membershipRequestedAt
      ))
      .sort((left, right) => Date.parse(right.membershipRequestedAt || '') - Date.parse(left.membershipRequestedAt || ''))[0];
    if (membershipRequest) {
      showNotification({
        id: `membership-${membershipRequest.id}-${membershipRequest.membershipRequestedAt || Date.now()}`,
        kind: 'membership',
        title: 'New membership request',
        body: `${membershipRequest.name} applied from the player app.`
      });
      return;
    }

    const seatRequest = nextState.interests
      .filter((interest) => !previousState.interests.some((candidate) => candidate.id === interest.id))
      .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))[0];
    if (seatRequest) {
      const gameName = nextState.games.find((game) => game.id === seatRequest.gameId)?.name ?? 'a game';
      showNotification({
        id: `seat-${seatRequest.id}`,
        kind: 'seat',
        title: 'New seat request',
        body: `${seatRequest.playerName} requested a seat in ${gameName}.`
      });
    }
  };

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!openPanels.quickAdd) return;
    const closeQuickAddOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenPanels((panels) => ({ ...panels, quickAdd: false }));
      }
    };
    window.addEventListener('keydown', closeQuickAddOnEscape);
    return () => window.removeEventListener('keydown', closeQuickAddOnEscape);
  }, [openPanels.quickAdd]);

  useEffect(() => {
    if (!selectedTournamentId && state.tournaments[0]) {
      setSelectedTournamentId(state.tournaments[0].id);
    }
    if (selectedTournamentId && !state.tournaments.some((tournament) => tournament.id === selectedTournamentId)) {
      setSelectedTournamentId(state.tournaments[0]?.id ?? '');
    }
  }, [selectedTournamentId, state.tournaments]);

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

  const recentProfiles = useMemo(() => {
    const recentNames = [...state.interests]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .map((interest) => interest.playerName.toLowerCase());
    return state.profiles
      .map((profile: { name: string; }) => ({
        profile,
        recentIndex: recentNames.indexOf(profile.name.toLowerCase()),
        count: state.interests.filter((interest: { playerName: string; }) => interest.playerName.toLowerCase() === profile.name.toLowerCase()).length
      }))
      .sort((a: { recentIndex: number; count: number; }, b: { recentIndex: number; count: number; }) => (a.recentIndex === -1 ? 999 : a.recentIndex) - (b.recentIndex === -1 ? 999 : b.recentIndex) || b.count - a.count)
      .slice(0, 4)
      .map((item: { profile: any; }) => item.profile);
  }, [state]);
  const checkInMatches = useMemo(() => {
    const queryParts = checkInSearch
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (!queryParts.length) return recentProfiles;
    return state.profiles
      .filter((profile) => {
        const name = profile.name.toLowerCase();
        const nameParts = name.split(/\s+/);
        return queryParts.every((part) => name.includes(part) || nameParts.some((namePart) => namePart.startsWith(part)));
      })
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, 8);
  }, [checkInSearch, recentProfiles, state.profiles]);
  const filteredProfiles = useMemo(() => {
    const query = profileSearch.trim().toLowerCase();
    if (!query) return state.profiles;
    return state.profiles.filter((profile) =>
      [
        profile.name,
        profile.id,
        profile.preferredStakes,
        profile.typicalAvailability,
        profile.usualCompanions.join(' '),
        profile.commonlyPlaysWithProfileIds
          .map((id) => state.profiles.find((candidate) => candidate.id === id)?.name)
          .filter(Boolean)
          .join(' '),
        profile.notes
      ]
        .join(' ')
        .toLowerCase()
        .includes(query)
    );
  }, [state.profiles, profileSearch]);
  const activeMemberProfiles = useMemo(
    () => filteredProfiles.filter((profile) => profile.membershipStatus === 'Active' && isFutureDate(profile.membershipExpiresAt || profile.membershipExpirationDate)),
    [filteredProfiles]
  );
  const pendingMembershipProfiles = useMemo(
    () => filteredProfiles.filter((profile) => profile.membershipStatus === 'Requested'),
    [filteredProfiles]
  );
  const approvedMembershipProfiles = useMemo(
    () => filteredProfiles.filter((profile) => profile.membershipStatus === 'Approved'),
    [filteredProfiles]
  );
  const membershipDirectoryProfiles = useMemo(
    () => filteredProfiles.filter((profile) => profile.membershipStatus !== 'Requested' && profile.membershipStatus !== 'Approved'),
    [filteredProfiles]
  );
  const todayPlayerActivity = useMemo<TodayPlayerRow[]>(
    () => getTodayPlayerActivity(state, { currentDate: new Date(), toLocalDateValue, isFutureDate }),
    [state.games, state.interests, state.playerSessions, state.profiles, state.sessions]
  );
  const duplicateProfiles = useMemo(() => {
    const groups = new Map<string, PlayerProfile[]>();
    state.profiles.forEach((profile: PlayerProfile) => {
      const key = profile.name.trim().toLowerCase();
      groups.set(key, [...(groups.get(key) ?? []), profile]);
    });
    return [...groups.values()].filter((group) => group.length > 1);
  }, [state.profiles]);

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

  useEffect(() => {
    window.tableManagerDesktop?.loadState().then((record) => {
      if (record?.state) {
        const next = normalizeState(record.state);
        setUndoStack([]);
        setState(next);
        setHasAuthenticated(hasPersistedSignIn(next));
        const accountStorageKey = getStorageKeyForState(next);
        localStorage.setItem(accountStorageKey, JSON.stringify(next));
        localStorage.setItem(`${storageKey}:last-account`, accountStorageKey);
        if (canUseRendererFirebaseAuth()) {
          loadClubStateFromFirebase<AppState>(getAccountKeyFromState(next))
            .then((cloudRecord) => {
              if (!cloudRecord?.state) {
                saveClubStateToFirebase(next).catch(() => undefined);
                return;
              }
              if (cloudRecord.savedAt && record.savedAt && cloudRecord.savedAt <= record.savedAt) return;
              const cloudState = normalizeState(cloudRecord.state);
              setUndoStack([]);
              setState(cloudState);
              setHasAuthenticated(hasPersistedSignIn(cloudState));
              const cloudStorageKey = getStorageKeyForState(cloudState);
              localStorage.setItem(cloudStorageKey, JSON.stringify(cloudState));
              localStorage.setItem(`${storageKey}:last-account`, cloudStorageKey);
              setSaveStatus({ state: 'saved', message: 'Synced from Firebase' });
            })
            .catch(() => undefined);
        }
      }
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!hasAuthenticated || !canUseRendererFirebaseAuth()) {
      hasPublishedStartupSnapshot.current = false;
      return;
    }
    if (hasPublishedStartupSnapshot.current) return;
    hasPublishedStartupSnapshot.current = true;
    saveClubStateToFirebase(state).catch(() => {
      hasPublishedStartupSnapshot.current = false;
    });
  }, [hasAuthenticated, state]);

  useEffect(() => {
    document.body.classList.toggle('low-light', state.settings.lowLight);
    applyBrandTheme(state.settings.lowLight ? branding.theme.lowLight : branding.theme.default);
    document.title = branding.product.name;
  }, [state.settings.lowLight]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const desktop = window.tableManagerDesktop;
    if (!desktop?.onPrepareForUpdate) return undefined;
    return desktop.onPrepareForUpdate((requestId) => {
      void desktop.preserveStateForUpdate(requestId, state);
    });
  }, [state]);

  useEffect(() => {
    window.tableManagerDesktop?.getBackendStatus()
      .then((status) => setBackendStatus(status))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const access = state.settings.pilotAccess;
    const validatePilotAccess = window.tableManagerDesktop?.validatePilotAccess;
    if (!access?.authorizationCode || !validatePilotAccess) return undefined;
    let cancelled = false;

    const refresh = async () => {
      let result = await validatePilotAccess(access).catch(() => null);
      if (cancelled || !result) return;
      if (!result.managed) {
        // One-time migration: publishing the already activated signed key lets the
        // API register it without asking the venue to load a replacement file.
        await window.tableManagerDesktop?.saveState(state).catch(() => undefined);
        result = await validatePilotAccess(access).catch(() => null);
      }
      if (cancelled || !result?.managed || !result.license?.expiresAt) return;
      setState((current) => {
        const currentAccess = current.settings.pilotAccess;
        if (!currentAccess || currentAccess.authorizationCode !== access.authorizationCode) return current;
        if (currentAccess.expiresAt === result.license!.expiresAt && currentAccess.serverManaged) return current;
        const next = {
          ...current,
          settings: {
            ...current.settings,
            pilotAccess: {
              ...currentAccess,
              expiresAt: result.license!.expiresAt!,
              issuedTo: result.license!.issuedTo || currentAccess.issuedTo,
              licenseId: result.license!.licenseId || currentAccess.licenseId,
              serverManaged: true
            }
          }
        };
        localStorage.setItem(getStorageKeyForState(next), JSON.stringify(next));
        localStorage.setItem(`${storageKey}:last-account`, getStorageKeyForState(next));
        window.tableManagerDesktop?.saveState(next).catch(() => undefined);
        return next;
      });
    };

    void refresh();
    const timer = window.setInterval(refresh, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [state.settings.pilotAccess?.authorizationCode, state.settings.pilotAccess?.licenseId]);

  useEffect(() => {
    setClubDraft(state.settings.clubAccount ?? emptyClubAccount);
  }, [state.settings.clubAccount]);

  useEffect(() => {
    if (!isPilotAccessActive(state.settings.pilotAccess)) {
      setHasAuthenticated(false);
    }
  }, [state.settings.pilotAccess]);

  useEffect(() => {
    const syncState = (event: StorageEvent) => {
      if (event.key === localStorage.getItem(`${storageKey}:last-account`) || event.key === storageKey) {
        setState(loadState());
      }
    };

    window.addEventListener('storage', syncState);
    return () => window.removeEventListener('storage', syncState);
  }, []);

  useEffect(() => {
    const syncRoute = () => {
      setRoute(getRouteFromHash());
    };

    window.addEventListener('hashchange', syncRoute);
    return () => window.removeEventListener('hashchange', syncRoute);
  }, []);

  useEffect(() => {
    if (!hasAuthenticated || !activeAccountKey || window.tableManagerDesktop) return;
    let cancelled = false;
    let bridgeInitialized = false;

    const syncLocalPlayerUpdates = async () => {
      try {
        const response = await fetch(`${localOrbitBridgeBaseUrl}/state/${encodeURIComponent(activeAccountKey)}`);
        if (response.status === 404) {
          if (!bridgeInitialized) {
            const published = await publishStateToLocalOrbitBridge(stateRef.current);
            bridgeInitialized = Boolean(published?.ok);
          }
          return;
        }
        if (!response.ok) return;
        bridgeInitialized = true;
        const record = await response.json() as { state?: AppState };
        if (cancelled || !record.state) return;
        const latestState = stateRef.current;
        announceIncomingPlayerRequest(latestState, record.state);
        const sameProfiles = JSON.stringify(record.state.profiles) === JSON.stringify(latestState.profiles);
        const sameInterests = JSON.stringify(record.state.interests) === JSON.stringify(latestState.interests);
        if (sameProfiles && sameInterests) return;
        const mergedState: AppState = {
          ...latestState,
          profiles: mergeSyncedList(latestState.profiles, record.state.profiles ?? []),
          interests: mergeSyncedList(latestState.interests, record.state.interests ?? [])
        };
        stateRef.current = mergedState;
        setState(mergedState);
        localStorage.setItem(getStorageKeyForState(mergedState), JSON.stringify(mergedState));
        localStorage.setItem(`${storageKey}:last-account`, getStorageKeyForState(mergedState));
        setSaveStatus({ state: 'saved', message: 'Player app updates synced' });
      } catch {
        // The local bridge is optional when Core is running without the linked dev command.
      }
    };

    void syncLocalPlayerUpdates();
    const timer = window.setInterval(() => void syncLocalPlayerUpdates(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeAccountKey, hasAuthenticated]);

  useEffect(() => {
    if (!hasAuthenticated || !activeAccountKey || !window.tableManagerDesktop || !state.settings.pilotAccess) return;
    let cancelled = false;
    let syncInFlight = false;

    const syncDesktopApiUpdates = async () => {
      if (syncInFlight) return;
      syncInFlight = true;
      try {
        const record = await window.tableManagerDesktop?.loadStateForAccount(state.settings.pilotAccess!);
        if (cancelled || !record?.state) return;
        const remoteState = normalizeState(record.state);
        const latestState = stateRef.current;
        const sameProfiles = JSON.stringify(remoteState.profiles) === JSON.stringify(latestState.profiles);
        const sameInterests = JSON.stringify(remoteState.interests) === JSON.stringify(latestState.interests);
        if (sameProfiles && sameInterests) return;

        announceIncomingPlayerRequest(latestState, remoteState);
        const mergedState: AppState = {
          ...latestState,
          profiles: mergeSyncedList(latestState.profiles, remoteState.profiles),
          interests: mergeSyncedList(latestState.interests, remoteState.interests)
        };
        stateRef.current = mergedState;
        setState(mergedState);
        setSaveStatus({ state: 'saved', message: 'Player app updates synced' });
      } catch {
        // The existing Firebase listener remains available if the API is offline.
      } finally {
        syncInFlight = false;
      }
    };

    void syncDesktopApiUpdates();
    const timer = window.setInterval(() => void syncDesktopApiUpdates(), 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeAccountKey, hasAuthenticated, state.settings.pilotAccess?.licenseId]);

  useEffect(() => {
    if (!activeAccountKey) return;
    let cancelled = false;
    let syncInFlight = false;
    let syncQueued = false;

    const syncPlayerUpdates = async () => {
      if (syncInFlight) {
        syncQueued = true;
        return;
      }
      syncInFlight = true;
      try {
        const nextState = await syncPlayerUpdatesToClubState<AppState>(stateRef.current);
        if (cancelled) return;
        const latestState = stateRef.current;
        announceIncomingPlayerRequest(latestState, nextState);
        const sameProfiles = JSON.stringify(nextState.profiles) === JSON.stringify(latestState.profiles);
        const sameInterests = JSON.stringify(nextState.interests) === JSON.stringify(latestState.interests);
        const sameTournaments = JSON.stringify(nextState.tournaments) === JSON.stringify(latestState.tournaments);
        const sameRevenue = JSON.stringify(nextState.revenueTransactions) === JSON.stringify(latestState.revenueTransactions);
        if (sameProfiles && sameInterests && sameTournaments && sameRevenue) return;

        const mergedState: AppState = {
          ...latestState,
          profiles: mergeSyncedList(latestState.profiles, nextState.profiles),
          interests: mergeSyncedList(latestState.interests, nextState.interests),
          tournaments: mergeSyncedList(latestState.tournaments, nextState.tournaments),
          revenueTransactions: mergeSyncedList(latestState.revenueTransactions, nextState.revenueTransactions)
        };
        stateRef.current = mergedState;
        setUndoStack((current) => [latestState, ...current].slice(0, 20));
        setState(mergedState);
        setSaveStatus({ state: 'saving', message: 'Syncing player updates...' });
        try {
          await saveState(mergedState);
          if (!cancelled) setSaveStatus({ state: 'saved', message: 'Player updates synced' });
        } catch {
          if (!cancelled) setSaveStatus({ state: 'error', message: 'Player update sync failed' });
        }
      } catch {
        // Firestore listeners and the periodic reconciliation pass will retry.
      } finally {
        syncInFlight = false;
        if (syncQueued && !cancelled) {
          syncQueued = false;
          void syncPlayerUpdates();
        }
      }
    };

    const unsubscribe = subscribeToPlayerRequestUpdates(activeAccountKey, () => void syncPlayerUpdates());
    const reconciliationTimer = window.setInterval(() => void syncPlayerUpdates(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(reconciliationTimer);
      unsubscribe();
    };
  }, [activeAccountKey]);

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
    saveState(next)
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
    saveState(previous)
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
    const existingActiveInterest = state.interests.find(
      (interest) =>
        !inactiveInterestStatuses.includes(interest.status) &&
        (
          (existingProfile && interest.profileId === existingProfile.id) ||
          interest.playerName.trim().toLowerCase() === playerName.toLowerCase()
        )
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
    const timestamp = nowIso();
    const statusTimestamps =
      form.status === 'Confirmed Coming'
        ? { confirmedAt: timestamp, closedAt: undefined }
        : form.status === 'Arrived'
          ? { arrivedAt: timestamp, closedAt: undefined }
          : ['Declined', 'No-Show', 'Left Before Seated', 'Removed'].includes(form.status)
            ? { closedAt: timestamp }
            : { closedAt: undefined };
    const nextInterest: Interest = existingActiveInterest
      ? {
          ...existingActiveInterest,
          profileId: existingProfile?.id ?? existingActiveInterest.profileId,
          playerName,
          gameId: form.gameId,
          status: form.status,
          notes: form.notes.trim(),
          timestamp,
          ...statusTimestamps
        }
      : {
          id: uid(),
          profileId: existingProfile?.id,
          playerName,
          gameId: form.gameId,
          status: form.status,
          notes: form.notes.trim(),
          timestamp,
          interestedAt: timestamp,
          confirmedAt: form.status === 'Confirmed Coming' ? timestamp : undefined,
          arrivedAt: form.status === 'Arrived' ? timestamp : undefined,
          seatedAt: undefined,
          closedAt: ['Declined', 'No-Show', 'Left Before Seated', 'Removed'].includes(form.status) ? timestamp : undefined
        };
    const nextState = promptDemandAction({
      ...state,
      interests: existingActiveInterest
        ? state.interests.map((interest) => interest.id === existingActiveInterest.id ? nextInterest : interest)
        : [nextInterest, ...state.interests]
    }, form.gameId);
    persist(nextState, true, {
      feature: 'Waitlist',
      action: existingActiveInterest ? 'Updated active member status' : 'Added interest',
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
    const timestampPatch =
      patch.status === 'Confirmed Coming'
        ? { confirmedAt: nowIso() }
        : patch.status === 'Arrived'
          ? { arrivedAt: nowIso() }
          : patch.status === 'Seated'
            ? { seatedAt: nowIso() }
            : patch.status && ['Declined', 'No-Show', 'Left Before Seated', 'Removed'].includes(patch.status)
              ? { closedAt: nowIso() }
              : {};
    const nextState = {
      ...state,
      interests: state.interests.map((interest: Interest) =>
        interest.id === id
          ? {
              ...interest,
              ...patch,
              ...timestampPatch,
              timestamp: patch.status ? nowIso() : interest.timestamp,
              manualEdits: Object.keys(patch).reduce(
                (edits, key) => markManualEdit(edits, key),
                interest.manualEdits
              )
            }
          : interest
      )
    };
    const changedInterest = nextState.interests.find((interest) => interest.id === id);
    persist(
      changedInterest && activeInterestStatuses.includes(changedInterest.status)
        ? promptDemandAction(nextState, changedInterest.gameId)
        : nextState,
      true,
      { feature: 'Waitlist', action: patch.status ? 'Updated status' : 'Edited interest', metadata: { status: patch.status ?? '', interestId: id } }
    );
  };

  const updateInterestTimestamp = (id: string, key: 'interestedAt' | 'confirmedAt' | 'arrivedAt' | 'seatedAt' | 'closedAt', value: string) => {
    const nextValue = fromDateTimeInput(value);
    const interest = state.interests.find((item: { id: string; }) => item.id === id);
    persist(withCorrectionLog({
      ...state,
      interests: state.interests.map((item: Interest) =>
        item.id === id ? { ...item, [key]: nextValue, manualEdits: markManualEdit(item.manualEdits, key) } : item
      ),
      playerSessions: state.playerSessions.map((session: PlayerSession) => {
        if (!interest || session.playerName !== interest.playerName || session.gameId !== interest.gameId) return session;
        if (key === 'seatedAt' && nextValue) return { ...session, seatedAt: nextValue, manualEdits: markManualEdit(session.manualEdits, 'seatedAt') };
        if (key === 'closedAt') return { ...session, leftAt: nextValue, manualEdits: markManualEdit(session.manualEdits, 'leftAt') };
        return session;
      })
    }, interest?.playerName ?? id, key, 'Timestamp corrected'));
  };

  const updatePlayerSession = (sessionId: string, patch: Partial<PlayerSession>, editKey: string) => {
    persist(withCorrectionLog({
      ...state,
      playerSessions: state.playerSessions.map((session: PlayerSession) =>
        session.id === sessionId ? { ...session, ...patch, manualEdits: markManualEdit(session.manualEdits, editKey) } : session
      )
    }, sessionId, editKey, 'Player session corrected'));
  };

  const changePlayerSeat = (playerSession: PlayerSession, seatNumber: number) => {
    const table = state.sessions.find((session) => session.id === playerSession.tableId);
    if (!table || !Number.isInteger(seatNumber) || seatNumber < 1 || seatNumber > table.maxSeats) {
      window.alert('Choose a valid seat number.');
      return;
    }
    const occupied = state.playerSessions.some(
      (session) =>
        session.id !== playerSession.id &&
        session.tableId === playerSession.tableId &&
        !session.leftAt &&
        session.seatNumber === seatNumber
    );
    if (occupied) {
      window.alert(`Seat ${seatNumber} is already occupied.`);
      return;
    }
    updatePlayerSession(playerSession.id, { seatNumber }, 'seatNumber');
  };

  const setTableCollectionMode = (sessionId: string, collectionMode: 'Time' | 'Drop') => {
    const timeFeeBased = collectionMode === 'Time';
    persist({
      ...state,
      sessions: state.sessions.map((session) => (session.id === sessionId ? { ...session, collectionMode, timeFeeBased } : session)),
      playerSessions: state.playerSessions.map((playerSession) =>
        playerSession.tableId === sessionId && !playerSession.leftAt
          ? { ...playerSession, timeFeeEnabled: timeFeeBased, lastTimeTickAt: playerSession.lastTimeTickAt ?? nowIso() }
          : playerSession
      )
    });
  };

  const addPlayerTime = (playerSession: PlayerSession, minutes: number) => {
    if (!minutes || minutes <= 0) return;
    const remaining = getTimeRemainingMinutes(playerSession);
    const timestamp = nowIso();
    const amount = (minutes / 60) * getCollectionProfile(state, playerSession.gameId).hourlyFee;
    persist({
      ...state,
      playerSessions: state.playerSessions.map((session) =>
        session.id === playerSession.id
          ? {
              ...session,
              timePurchasedMinutes: (session.timePurchasedMinutes ?? 0) + minutes,
              timeRemainingMinutes: remaining + minutes,
              lastTimeTickAt: timestamp,
              timeFeeEnabled: true
            }
          : session
      ),
      timeFeeLogs: [
        ...state.timeFeeLogs,
        {
          id: uid(),
          playerSessionId: playerSession.id,
          tableId: playerSession.tableId,
          gameId: playerSession.gameId,
          playerName: playerSession.playerName,
          minutes,
          amount,
          timestamp
        }
      ],
      tableEvents: [
        ...state.tableEvents,
        {
          id: uid(),
          type: 'Merged',
          gameId: playerSession.gameId,
          tableId: playerSession.tableId,
          timestamp,
          playerCount: state.sessions.find((session) => session.id === playerSession.tableId)?.seatsFilled ?? 0,
          reason: 'time added',
          note: `${minutes} minutes added for ${playerSession.playerName}`
        }
      ]
    }, true, { feature: 'Table time', action: 'Added player time', metadata: { minutes, gameId: playerSession.gameId } });
    setCustomTimeDrafts((drafts) => ({ ...drafts, [playerSession.id]: '' }));
  };

  const addBuyIn = (playerSession: PlayerSession, amountOverride?: number, noteOverride?: string) => {
    const draft = buyInDrafts[playerSession.id] ?? { amount: '', note: '' };
    const amount = amountOverride ?? Number(draft.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      window.alert('Enter a buy-in amount.');
      return;
    }
    persist({
      ...state,
      buyIns: [
        {
          id: uid(),
          profileId: playerSession.profileId,
          playerName: playerSession.playerName,
          tableId: playerSession.tableId,
          gameId: playerSession.gameId,
          amount,
          timestamp: nowIso(),
          note: noteOverride ?? draft.note.trim()
        },
        ...state.buyIns
      ],
      playerLedger: [
        {
          id: uid(),
          type: 'Buy-In',
          profileId: playerSession.profileId,
          playerName: playerSession.playerName,
          tableId: playerSession.tableId,
          gameId: playerSession.gameId,
          amount,
          timestamp: nowIso(),
          note: noteOverride ?? draft.note.trim()
        },
        ...state.playerLedger
      ]
    }, true, { feature: 'Buy-ins', action: 'Added buy-in', metadata: { amount, gameId: playerSession.gameId } });
    setBuyInDrafts((drafts) => ({ ...drafts, [playerSession.id]: { amount: '', note: '' } }));
  };

  const addTableDrop = (session: GameSession) => {
    const draft = dropDrafts[session.id] ?? { amount: '', note: '' };
    const amount = Number(draft.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      window.alert('Enter the amount removed from the table.');
      return;
    }
    persist({
      ...state,
      dropLogs: [
        {
          id: uid(),
          tableId: session.id,
          gameId: session.gameId,
          amount,
          timestamp: nowIso(),
          note: draft.note.trim()
        },
        ...state.dropLogs
      ]
    }, true, { feature: 'Drop tracking', action: 'Recorded table drop', metadata: { amount, gameId: session.gameId } });
    setDropDrafts((drafts) => ({ ...drafts, [session.id]: { amount: '', note: '' } }));
  };

  const assignDealer = (session: GameSession) => {
    const dealerName = (dealerDrafts[session.id] ?? '').trim();
    if (!dealerName) {
      window.alert('Enter or select a dealer name.');
      return;
    }
    const timestamp = nowIso();
    persist({
      ...state,
      dealerAssignments: [
        ...state.dealerAssignments.map((assignment) =>
          assignment.tableId === session.id && !assignment.endedAt ? { ...assignment, endedAt: timestamp } : assignment
        ),
        { id: uid(), tableId: session.id, gameId: session.gameId, dealerName, startedAt: timestamp }
      ]
    }, true, { feature: 'Dealer tracking', action: 'Assigned dealer', metadata: { dealerName, tableId: session.id } });
  };

  const endDealerAssignment = (session: GameSession) => {
    const timestamp = nowIso();
    persist({
      ...state,
      dealerAssignments: state.dealerAssignments.map((assignment) =>
        assignment.tableId === session.id && !assignment.endedAt ? { ...assignment, endedAt: timestamp } : assignment
      )
    }, true, { feature: 'Dealer tracking', action: 'Ended dealer assignment', metadata: { tableId: session.id } });
  };

  const recordHands = (session: GameSession) => {
    const hands = Number(handCountDrafts[session.id]);
    if (!Number.isInteger(hands) || hands <= 0) {
      window.alert('Enter the number of hands dealt since the last count.');
      return;
    }
    persist({
      ...state,
      handCountLogs: [
        ...state.handCountLogs,
        { id: uid(), tableId: session.id, gameId: session.gameId, hands, timestamp: nowIso() }
      ]
    }, true, { feature: 'Hand tracking', action: 'Recorded hands', metadata: { hands, tableId: session.id } });
    setHandCountDrafts((drafts) => ({ ...drafts, [session.id]: '' }));
  };

  const deleteInterest = (id: string) => {
    if (!window.confirm('Remove this interest entry?')) return;
    persist({ ...state, interests: state.interests.filter((interest: { id: string; }) => interest.id !== id) }, true, {
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

  const getActivePlayerSessionsForTable = (sourceState: AppState, tableId: string) =>
    sourceState.playerSessions.filter((playerSession) => playerSession.tableId === tableId && !playerSession.leftAt);

  const getAvailableSeatNumberFromState = (sourceState: AppState, session: GameSession, requestedSeat?: number) => {
    const occupiedSeats = new Set(
      sourceState.playerSessions
        .filter((playerSession) => playerSession.tableId === session.id && !playerSession.leftAt)
        .map((playerSession) => playerSession.seatNumber)
        .filter((seat): seat is number => Number.isInteger(seat))
    );
    const seats = Array.from({ length: session.maxSeats }, (_, index) => index + 1);
    if (requestedSeat !== undefined) {
      if (seats.includes(requestedSeat) && !occupiedSeats.has(requestedSeat)) return requestedSeat;
      return undefined;
    }
    return seats.find((seat) => !occupiedSeats.has(seat));
  };

  const getAvailableSeatNumber = (session: GameSession, requestedSeat?: number) =>
    getAvailableSeatNumberFromState(state, session, requestedSeat);

  const syncSessionSeatCount = (sourceState: AppState, tableId: string, patch: Partial<GameSession> = {}) => ({
    ...sourceState,
    sessions: sourceState.sessions.map((session) =>
      session.id === tableId
        ? {
            ...session,
            ...patch,
            seatsFilled: Math.min(session.maxSeats, getActivePlayerSessionsForTable(sourceState, tableId).length)
          }
        : session
    )
  });

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
  ): PlayerProfile => {
    const preferredGame = state.games.find((game) => game.id === gameId) ?? state.games[0];
    const preferredGameId = preferredGame?.id ?? gameId ?? 'nlh-1-2';
    return {
      id: patch.id ?? memberId(),
      name: name.trim(),
      phone: patch.phone ?? '',
      birthday: patch.birthday ?? '',
      membershipStartDate: patch.membershipStartDate ?? todayDate(),
      membershipExpirationDate: patch.membershipExpirationDate ?? nextYearDate(),
      totalTimePlayedHours: patch.totalTimePlayedHours ?? 0,
      lastSessionTimePlayedHours: patch.lastSessionTimePlayedHours ?? 0,
      commonlyPlaysWithProfileIds: patch.commonlyPlaysWithProfileIds ?? [],
      preferredGameId: patch.preferredGameId ?? preferredGameId,
      preferredGameIds: patch.preferredGameIds?.length ? patch.preferredGameIds : [preferredGameId],
      gamePlayCounts: patch.gamePlayCounts ?? {},
      mostPlayedGameId: patch.mostPlayedGameId ?? preferredGameId,
      preferredStakes: patch.preferredStakes ?? preferredGame?.name ?? '',
      typicalBuyInMin: patch.typicalBuyInMin ?? 200,
      typicalBuyInMax: patch.typicalBuyInMax ?? 500,
      willingnessToMove: patch.willingnessToMove ?? true,
      typicalAvailability: patch.typicalAvailability ?? '',
      usualCompanions: patch.usualCompanions ?? [],
      preferredTags: patch.preferredTags ?? [],
      notes: patch.notes ?? ''
    };
  };

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

  const withProfileGameLogged = (sourceState: AppState, profileId: string | undefined, playerName: string, gameId: string) => ({
    ...sourceState,
    profiles: sourceState.profiles.map((profile) => {
      const sameProfile = profileId
        ? profile.id === profileId
        : profile.name.toLowerCase() === playerName.toLowerCase();
      if (!sameProfile) return profile;
      const gamePlayCounts = {
        ...(profile.gamePlayCounts ?? {}),
        [gameId]: (profile.gamePlayCounts?.[gameId] ?? 0) + 1
      };
      const mostPlayedGameId =
        Object.entries(gamePlayCounts)
          .sort((left, right) => right[1] - left[1] || getGameName(left[0]).localeCompare(getGameName(right[0])))[0]?.[0] ?? gameId;
      return {
        ...profile,
        gamePlayCounts,
        mostPlayedGameId,
        preferredGameIds: Array.from(new Set([...(profile.preferredGameIds ?? []), gameId]))
      };
    })
  });

  const ensureInterestEntry = (
    sourceState: AppState,
    profile: PlayerProfile,
    gameId: string,
    status: InterestStatus,
    note: string,
    timestamp: string
  ) => {
    const existingRelationship = findUniqueProfileReference(
      sourceState.interests,
      sourceState.profiles,
      profile,
      (interest) => !inactiveInterestStatuses.includes(interest.status)
    );
    const existing = existingRelationship?.gameId === gameId ? existingRelationship : undefined;
    if (existing) {
      return sourceState.interests.map((interest) =>
        interest.id === existing.id
          ? {
              ...interest,
              status: interest.status === 'Seated' ? interest.status : status,
              profileId: profile.id,
              timestamp,
              interestedAt: interest.interestedAt ?? timestamp,
              arrivedAt: status === 'Arrived' ? interest.arrivedAt ?? timestamp : interest.arrivedAt,
              notes: interest.notes || note
            }
          : interest
      );
    }
    return [
      {
        id: uid(),
        profileId: profile.id,
        playerName: profile.name,
        gameId,
        status,
        timestamp,
        interestedAt: timestamp,
        arrivedAt: status === 'Arrived' ? timestamp : undefined,
        notes: note
      },
      ...sourceState.interests
    ];
  };

  const seatPlayerInState = (sourceState: AppState, tableId: string, payload: SeatPlayerPayload): SeatPlayerResult => {
    const session = sourceState.sessions.find((item) => item.id === tableId && item.status !== 'Closed' && item.status !== 'Failed to Start');
    if (!session) return { ok: false, error: 'This table is no longer open.' };

    const timestamp = nowIso();
    const profile = payload.profileId
      ? sourceState.profiles.find((item) => item.id === payload.profileId)
      : payload.playerName
        ? sourceState.profiles.find((item) => item.name.toLowerCase() === payload.playerName?.trim().toLowerCase())
        : undefined;
    const interest = payload.interestId
      ? sourceState.interests.find((item) => item.id === payload.interestId)
      : payload.playerName
        ? sourceState.interests.find(
            (item) =>
              item.gameId === session.gameId &&
              item.playerName.toLowerCase() === payload.playerName?.trim().toLowerCase() &&
              !closedInterestStatuses.includes(item.status)
          )
        : undefined;
    const playerName = (payload.playerName || profile?.name || interest?.playerName || '').trim();
    if (!playerName) return { ok: false, error: 'Choose a player or enter a player name.' };

    const profileId = profile?.id ?? payload.profileId ?? interest?.profileId;
    const duplicate = sourceState.playerSessions.find((playerSession) => {
      const samePlayer = profileId
        ? playerSession.profileId === profileId
        : playerSession.playerName.toLowerCase() === playerName.toLowerCase();
      return samePlayer && !playerSession.leftAt;
    });
    if (duplicate) return { ok: false, error: `${playerName} is already seated.` };

    const seatNumber = getAvailableSeatNumberFromState(sourceState, session, payload.requestedSeatNumber);
    if (!seatNumber) return { ok: false, error: 'Table full. No open seats remain.' };

    const isTimeCollection = session.timeFeeBased || session.collectionMode === 'Time';
    const timeMinutes = isTimeCollection ? Math.max(0, Number(payload.initialTimeMinutes ?? 0)) : 0;
    const initialBuyInAmount = Number(payload.initialBuyIn ?? 0);
    const hasInitialBuyIn = Number.isFinite(initialBuyInAmount) && initialBuyInAmount > 0;
    const matchingInterest = interest ?? sourceState.interests.find(
      (item) =>
        item.gameId === session.gameId &&
        !closedInterestStatuses.includes(item.status) &&
        (profileId ? item.profileId === profileId : item.playerName.toLowerCase() === playerName.toLowerCase())
    );
    const interests = sourceState.interests.map((item) =>
      matchingInterest && item.id === matchingInterest.id
        ? {
            ...item,
            status: 'Seated' as InterestStatus,
            profileId: profileId ?? item.profileId,
            seatedAt: item.seatedAt ?? timestamp,
            timestamp
          }
        : item
    );
    const seatedState: AppState = withProfileGameLogged({
      ...sourceState,
      interests,
      playerSessions: [
        ...sourceState.playerSessions,
        {
          id: uid(),
          playerName,
          profileId,
          gameId: session.gameId,
          tableId: session.id,
          seatNumber,
          seatedAt: timestamp,
          timePurchasedMinutes: timeMinutes,
          timeRemainingMinutes: timeMinutes,
          lastTimeTickAt: timestamp,
          timeFeeEnabled: isTimeCollection && timeMinutes > 0
        }
      ],
      buyIns: hasInitialBuyIn
        ? [
            {
              id: uid(),
              profileId,
              playerName,
              tableId: session.id,
              gameId: session.gameId,
              amount: initialBuyInAmount,
              timestamp,
              note: 'Initial buy-in'
            },
            ...sourceState.buyIns
          ]
        : sourceState.buyIns,
      playerLedger: [
        ...(hasInitialBuyIn
          ? [
              {
                id: uid(),
                type: 'Buy-In' as const,
                profileId,
                playerName,
                tableId: session.id,
                gameId: session.gameId,
                amount: initialBuyInAmount,
                timestamp,
                note: 'Initial buy-in'
              }
            ]
          : []),
        {
          id: uid(),
          type: 'Check-In' as const,
          profileId,
          playerName,
          tableId: session.id,
          gameId: session.gameId,
          timestamp,
          note: `${payload.note ?? 'Seated'}: seat ${seatNumber}`
        },
        ...sourceState.playerLedger
      ]
    }, profileId, playerName, session.gameId);
    const nextStatus = session.status === 'Forming' ? 'Running' as GameStatus : session.status;
    return {
      ok: true,
      state: syncSessionSeatCount(seatedState, session.id, { status: nextStatus, startedAt: nextStatus === 'Running' ? session.startedAt || timestamp : session.startedAt }),
      seatNumber,
      playerName,
      profileId,
      tableId: session.id,
      gameId: session.gameId
    };
  };

  const buildSeatedState = (sourceState: AppState, session: GameSession, profile: PlayerProfile, seatNumber: number, note: string) => {
    const result = seatPlayerInState(sourceState, session.id, {
      playerName: profile.name,
      profileId: profile.id,
      requestedSeatNumber: seatNumber,
      note
    });
    return result.ok ? result.state : sourceState;
  };

  const getActiveInterestCount = (sourceState: AppState, gameId: string) =>
    sourceState.interests.filter((interest) => interest.gameId === gameId && activeInterestStatuses.includes(interest.status)).length;

  const addSessionToState = (sourceState: AppState, gameId: string, note = 'Table forming') => {
    const game = sourceState.games.find((item) => item.id === gameId);
    if (!game) return sourceState;
    const collectionProfile = getCollectionProfile(sourceState, gameId);
    const currentCount = sourceState.sessions.filter((session) => session.gameId === gameId && session.status !== 'Closed').length;
    const timestamp = nowIso();
    return {
      ...sourceState,
      sessions: [
        ...sourceState.sessions,
        {
          id: uid(),
          gameId,
          label: currentCount ? `Table ${currentCount + 1}` : 'Main Table',
          status: 'Forming' as GameStatus,
          seatsFilled: 0,
          maxSeats: game.maxSeats,
          timeFeeBased: collectionProfile.collectionMode === 'Time',
          collectionMode: collectionProfile.collectionMode,
          tags: [],
          startedAt: timestamp
        }
      ],
      tableEvents: [
        ...sourceState.tableEvents,
        {
          id: uid(),
          type: 'Created' as TableEventType,
          gameId,
          timestamp,
          playerCount: 0,
          note
        }
      ]
    };
  };

  const switchOpenTableToGame = (sourceState: AppState, targetGameId: string) => {
    const targetGame = sourceState.games.find((game) => game.id === targetGameId);
    const table = sourceState.sessions.find((session) => session.status === 'Running' && session.gameId !== targetGameId);
    if (!targetGame || !table) return sourceState;
    const collectionProfile = getCollectionProfile(sourceState, targetGameId);
    const timestamp = nowIso();
    return {
      ...sourceState,
      sessions: sourceState.sessions.map((session) =>
        session.id === table.id
          ? {
              ...session,
              gameId: targetGameId,
              maxSeats: targetGame.maxSeats,
              collectionMode: collectionProfile.collectionMode,
              timeFeeBased: collectionProfile.collectionMode === 'Time',
              manualEdits: markManualEdit(session.manualEdits, 'gameId')
            }
          : session
      ),
      playerSessions: sourceState.playerSessions.map((playerSession) =>
        playerSession.tableId === table.id && !playerSession.leftAt
          ? {
              ...playerSession,
              gameId: targetGameId,
              timeFeeEnabled: collectionProfile.collectionMode === 'Time',
              manualEdits: markManualEdit(playerSession.manualEdits, 'gameId')
            }
          : playerSession
      ),
      tableEvents: [
        ...sourceState.tableEvents,
        {
          id: uid(),
          type: 'Merged' as TableEventType,
          gameId: targetGameId,
          tableId: table.id,
          timestamp,
          playerCount: table.seatsFilled,
          reason: 'game switched',
          note: `${table.label} switched to ${targetGame.name}`
        }
      ]
    };
  };

  const promptDemandAction = (sourceState: AppState, gameId: string) => {
    const game = sourceState.games.find((item) => item.id === gameId);
    if (!game) return sourceState;
    const activeCount = getActiveInterestCount(sourceState, gameId);
    if (activeCount <= 5) return sourceState;
    const hasOpenTargetTable = sourceState.sessions.some(
      (session) => session.gameId === gameId && session.status !== 'Closed' && session.status !== 'Failed to Start'
    );
    if (hasOpenTargetTable) return sourceState;
    const choice = window.prompt(
      `${activeCount} players now want ${game.name}. Type "start" to create a new ${game.name} table, "switch" to convert a running table to ${game.name}, or leave blank to skip.`,
      'start'
    );
    if (!choice) return sourceState;
    if (choice.trim().toLowerCase().startsWith('switch')) return switchOpenTableToGame(sourceState, gameId);
    if (choice.trim().toLowerCase().startsWith('start')) return addSessionToState(sourceState, gameId, `Prompted by ${activeCount} interested players`);
    return sourceState;
  };

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
          interests: ensureInterestEntry(state, profile, session.gameId, 'Arrived', 'Checked in from table seat picker', timestamp)
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
    const selectedInterests = state.interests.filter((interest) => selectedIds.includes(interest.id) && !closedInterestStatuses.includes(interest.status));
    const alreadySeated = getActivePlayerSessionsForTable(state, session.id);
    const seatedAt = nowIso();
    let nextState = state;
    const seatedNames: string[] = [];
    const skippedErrors: string[] = [];
    selectedInterests.forEach((interest) => {
      const result = seatPlayerInState(nextState, session.id, {
        playerName: interest.playerName,
        profileId: interest.profileId,
        interestId: interest.id,
        note: 'Started table'
      });
      if (result.ok) {
        nextState = result.state;
        seatedNames.push(result.playerName);
      } else {
        skippedErrors.push(result.error);
      }
    });
    nextState = syncSessionSeatCount(nextState, session.id, { status: 'Running', startedAt: seatedAt });
    const table = nextState.sessions.find((item) => item.id === session.id);
    const playerCount = table?.seatsFilled ?? alreadySeated.length + seatedNames.length;
    const triggeringCardHouse = getClubDisplayName(nextState);
    persist({
      ...nextState,
      tableEvents: [
        ...nextState.tableEvents,
        {
          id: uid(),
          type: 'Started' as TableEventType,
          gameId: session.gameId,
          tableId: session.id,
          timestamp: seatedAt,
          playerCount,
          note: `${
            seatedNames.length || alreadySeated.length
              ? `Started with ${[...alreadySeated.map((player) => player.playerName), ...seatedNames].join(', ')}`
              : 'Started empty'
          } - messaging trigger: ${triggeringCardHouse}`
        }
      ]
    }, true, { feature: 'Tables', action: 'Started table', metadata: { gameId: session.gameId, players: selectedInterests.length + alreadySeated.length } });
    window.setTimeout(() => {
      setSaveStatus({ state: 'saved', message: `Messaging trigger: ${triggeringCardHouse}` });
    }, 350);
    window.tableManagerDesktop?.recordClientEvent('table-started', 'tables', {
      gameId: session.gameId,
      tableId: session.id,
      tableLabel: table?.label ?? session.label,
      playerCount,
      selectedPlayers: selectedInterests.length,
      alreadySeated: alreadySeated.length
    }, route).catch(() => undefined);
    if (skippedErrors.length) {
      setSaveStatus({ state: 'error', message: skippedErrors[0] });
    }
    setStartPlayerDrafts((drafts) => ({ ...drafts, [session.id]: [] }));
  };

  const movePlayerToTable = (playerSession: PlayerSession, targetTableId: string) => {
    if (playerSession.tableId === targetTableId) return;
    const sourceTable = state.sessions.find((session: GameSession) => session.id === playerSession.tableId);
    const targetTable = state.sessions.find((session: GameSession) => session.id === targetTableId);
    if (!targetTable) return;
    const targetSeatNumber = getAvailableSeatNumber(targetTable, playerSession.seatNumber) ?? getAvailableSeatNumber(targetTable);
    if (!targetSeatNumber) {
      window.alert('No open seats on the target table.');
      return;
    }
    const movedState: AppState = {
      ...state,
      playerSessions: state.playerSessions.map((session: PlayerSession) =>
        session.id === playerSession.id
          ? { ...session, tableId: targetTableId, seatNumber: targetSeatNumber, manualEdits: markManualEdit(markManualEdit(session.manualEdits, 'tableId'), 'seatNumber') }
          : session
      ),
      tableEvents: [
        ...state.tableEvents,
        {
          id: uid(),
          type: 'Merged',
          gameId: targetTable.gameId,
          tableId: targetTable.id,
          timestamp: nowIso(),
          playerCount: targetTable.seatsFilled + 1,
          reason: 'player moved',
          note: `${playerSession.playerName} moved from ${sourceTable?.label ?? 'unknown table'} to ${targetTable.label}`
        }
      ]
    };
    persist(syncSessionSeatCount(syncSessionSeatCount(movedState, playerSession.tableId), targetTableId), true, {
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
    const openSession = state.playerSessions.find(
      (session: PlayerSession) => session.playerName === interest.playerName && session.gameId === interest.gameId && !session.leftAt
    );

    const nextState: AppState = {
      ...state,
      interests: state.interests.map((item: Interest) =>
        item.id === interest.id ? { ...item, status: 'Removed', closedAt: nowIso(), timestamp: nowIso() } : item
      ),
      playerSessions: state.playerSessions.map((session: PlayerSession) =>
        session.id === openSession?.id ? { ...session, leftAt: nowIso() } : session
      )
    };
    const finalState = openSession
      ? withGameFrequencyInAppNotifications(syncSessionSeatCount(nextState, openSession.tableId), openSession.gameId, 'seat-opened')
      : nextState;
    persist(finalState);
  };

  const markPlayerSessionLeft = (playerSession: PlayerSession, cashOutAmount: number, cashOutNote = '') => {
    const leftAt = nowIso();
    const sessionHours = hoursBetween(playerSession.seatedAt, leftAt);
    const fallbackProfileMatches = playerSession.profileId
      ? []
      : state.profiles.filter((profile) => profile.name.toLowerCase() === playerSession.playerName.toLowerCase());
    const departureProfileId = playerSession.profileId || (fallbackProfileMatches.length === 1 ? fallbackProfileMatches[0].id : undefined);
    const nextState: AppState = {
      ...state,
      interests: state.interests.map((interest) => {
        const samePlayer = playerSession.profileId
          ? interest.profileId === playerSession.profileId
          : interest.playerName.toLowerCase() === playerSession.playerName.toLowerCase() && interest.gameId === playerSession.gameId;
        return samePlayer && interest.status === 'Seated'
          ? { ...interest, status: 'Removed', closedAt: leftAt, timestamp: leftAt }
          : interest;
      }),
      playerSessions: state.playerSessions.map((session) =>
        session.id === playerSession.id ? { ...session, leftAt, manualEdits: markManualEdit(session.manualEdits, 'leftAt') } : session
      ),
      playerLedger: [
        {
          id: uid(),
          type: 'Cash-Out',
          profileId: playerSession.profileId,
          playerName: playerSession.playerName,
          tableId: playerSession.tableId,
          gameId: playerSession.gameId,
          amount: cashOutAmount,
          timestamp: leftAt,
          note: cashOutNote.trim() || (cashOutAmount === 0 ? 'Player left table with no cash out' : 'Player left table')
        },
        ...state.playerLedger
      ],
      profiles: state.profiles.map((profile) =>
        profile.id === departureProfileId
          ? {
              ...profile,
              totalTimePlayedHours: (profile.totalTimePlayedHours ?? 0) + sessionHours,
              lastSessionTimePlayedHours: sessionHours
            }
          : profile
      )
    };
    const finalState = withGameFrequencyInAppNotifications(syncSessionSeatCount(nextState, playerSession.tableId), playerSession.gameId, 'seat-opened');
    persist(finalState, true, { feature: 'Seating', action: 'Marked player left', metadata: { gameId: playerSession.gameId, tableId: playerSession.tableId } });
  };

  const requestPlayerCashOut = (playerSession: PlayerSession) => {
    setCashOutDraft({ playerSessionId: playerSession.id, amount: '', note: '' });
  };

  const addSession = (gameId: string) => {
    const game = state.games.find((item: { id: string; }) => item.id === gameId);
    if (!game) return;
    const collectionProfile = getCollectionProfile(state, gameId);
    const currentCount = state.sessions.filter((session: { gameId: string; status: string; }) => session.gameId === gameId && session.status !== 'Closed').length;
    const sessionId = uid();
    const defaultStartPlayerIds = getSeatOptions(gameId).slice(0, game.maxSeats).map((interest) => interest.id);
    const nextState: AppState = {
      ...state,
      sessions: [
        ...state.sessions,
        {
          id: sessionId,
          gameId,
          label: currentCount ? `Table ${currentCount + 1}` : 'Main Table',
          status: 'Forming',
          seatsFilled: 0,
          maxSeats: game.maxSeats,
          timeFeeBased: collectionProfile.collectionMode === 'Time',
          collectionMode: collectionProfile.collectionMode,
          tags: [],
          startedAt: nowIso()
        }
      ],
      tableEvents: [
        ...state.tableEvents,
        {
          id: uid(),
          type: 'Created',
          gameId,
          timestamp: nowIso(),
          playerCount: 0,
          note: 'Table forming'
        }
      ]
    };
    const notifiedState = withGameFrequencyInAppNotifications(nextState, gameId, 'game-forming');
    persist(notifiedState, true, { feature: 'Tables', action: 'Created forming table', metadata: { gameId } });
    if (defaultStartPlayerIds.length) {
      setStartPlayerDrafts((drafts) => ({ ...drafts, [sessionId]: defaultStartPlayerIds }));
    }
  };

  const addPlannedSession = () => {
    const game = state.games.find((item: { id: any; }) => item.id === coordinationConfig.gameId);
    if (!game) return;
    const collectionProfile = getCollectionProfile(state, game.id);
    const currentCount = state.sessions.filter((session: { gameId: any; status: string; }) => session.gameId === game.id && session.status !== 'Closed').length;
    const newInterests = participantPool
      .filter(lacksParticipantInterest)
      .map((candidate): Interest => ({
        id: uid(),
        profileId: candidate.profile?.id,
        playerName: candidate.playerName,
        gameId: game.id,
        status: 'Interested' as InterestStatus,
        notes: 'Connected participant',
        timestamp: nowIso(),
        interestedAt: nowIso()
      }));
    persist({
      ...state,
      interests: [...newInterests, ...state.interests],
      sessions: [
        ...state.sessions,
        {
          id: uid(),
          gameId: game.id,
          label: currentCount ? `Coordinated Table ${currentCount + 1}` : 'Coordinated Table',
          status: 'Forming',
          seatsFilled: 0,
          maxSeats: game.maxSeats,
          timeFeeBased: collectionProfile.collectionMode === 'Time',
          collectionMode: collectionProfile.collectionMode,
          plannedPlayerIds: [
            ...participantPool.filter(hasParticipantInterest).map((candidate) => candidate.interest.id),
            ...newInterests.map((interest) => interest.id)
          ],
          tags: [],
          startedAt: nowIso()
        }
      ],
      tableEvents: [
        ...state.tableEvents,
        {
          id: uid(),
          type: 'Created',
          gameId: game.id,
          timestamp: nowIso(),
          playerCount: participantPool.length,
          note: participantPool.length ? 'Staff-created planned table' : 'Staff-created empty table'
        }
      ]
    }, true, { feature: 'Table builder', action: 'Created planned table', metadata: { gameId: game.id, players: participantPool.length } });
  };

  const createBalancedTable = (plan: BalancePlan) => {
    const currentCount = state.sessions.filter((session: { gameId: string; status: string; }) => session.gameId === plan.game.id && session.status !== 'Closed').length;
    persist({
      ...state,
      sessions: [
        ...state.sessions.map((session: GameSession) =>
          session.id === plan.fromTable.id
            ? {
                ...session,
                seatsFilled: plan.tableASeatsAfterMove,
                plannedPlayerIds: (session.plannedPlayerIds ?? []).filter(
                  (id: string | undefined) => !plan.moveCandidates.some((candidate) => candidate.interest?.id === id)
                )
              }
            : session
        ),
        {
          id: uid(),
          gameId: plan.game.id,
          label: `Balanced Table ${currentCount + 1}`,
          status: 'Forming',
          seatsFilled: plan.tableBProjectedSeats,
          maxSeats: plan.game.maxSeats,
          timeFeeBased: plan.fromTable.timeFeeBased ?? false,
          collectionMode: plan.fromTable.collectionMode ?? (plan.fromTable.timeFeeBased ? 'Time' : 'Drop'),
          plannedPlayerIds: plan.moveCandidates.map((candidate) => candidate.interest!.id),
          tags: [],
          startedAt: nowIso()
        }
      ],
      tableEvents: [
        ...state.tableEvents,
        {
          id: uid(),
          type: 'Created',
          gameId: plan.game.id,
          tableId: plan.fromTable.id,
          timestamp: nowIso(),
          playerCount: plan.tableBProjectedSeats,
          note: `Table B created from Table A balance option: ${plan.moveCandidates.map((candidate) => candidate.playerName).join(', ')}`
        }
      ]
    }, true, { feature: 'Table builder', action: 'Created balanced table', metadata: { gameId: plan.game.id, players: plan.tableBProjectedSeats } });
  };

  const updateSession = (id: string, patch: Partial<GameSession>) => {
    const current = state.sessions.find((session: { id: string; }) => session.id === id);
    const eventType: TableEventType | undefined =
      patch.status === 'Running'
        ? 'Started'
        : patch.status === 'Closed'
          ? current?.status === 'Forming'
            ? 'Failed to Start'
            : 'Closed'
          : undefined;
    persist({
      ...state,
      sessions: state.sessions.map((session: GameSession) => {
        if (session.id !== id) return session;
        const closed = patch.status === 'Closed' && !session.endedAt;
        return {
          ...session,
          ...patch,
          endedAt: closed ? nowIso() : patch.status === 'Running' ? undefined : session.endedAt,
          manualEdits: Object.keys(patch).reduce((edits, key) => markManualEdit(edits, key), session.manualEdits)
        };
      }),
      tableEvents:
        eventType && current
          ? [
              ...state.tableEvents,
              {
                id: uid(),
                type: eventType,
                gameId: current.gameId,
                tableId: current.id,
                timestamp: nowIso(),
                playerCount: current.seatsFilled,
                note: ''
              }
            ]
          : state.tableEvents
    });
  };

  const updateSessionTimestamp = (id: string, key: 'startedAt' | 'endedAt', value: string) => {
    const nextValue = fromDateTimeInput(value);
    persist(withCorrectionLog({
      ...state,
      sessions: state.sessions.map((session: GameSession) =>
        session.id === id ? { ...session, [key]: nextValue, manualEdits: markManualEdit(session.manualEdits, key) } : session
      )
    }, id, key, 'Table timestamp corrected'));
  };

  const recordTableEvent = (session: GameSession, type: TableEventType, reason: string, note = '') => {
    const timestamp = nowIso();
    persist({
      ...state,
      sessions: state.sessions.map((item: GameSession) =>
        item.id === session.id
          ? {
              ...item,
              status: type === 'Started' ? 'Running' : type === 'Failed to Start' ? 'Failed to Start' : type === 'Broke' || type === 'Closed' ? 'Closed' : item.status,
              endedAt:
                type === 'Failed to Start' || type === 'Broke' || type === 'Closed'
                  ? item.endedAt ?? timestamp
                  : item.endedAt
            }
          : item
      ),
      playerSessions:
        type === 'Broke' || type === 'Closed'
          ? state.playerSessions.map((playerSession: PlayerSession) =>
              playerSession.tableId === session.id && !playerSession.leftAt
                ? { ...playerSession, leftAt: timestamp }
                : playerSession
            )
          : state.playerSessions,
      dealerAssignments:
        type === 'Broke' || type === 'Closed' || type === 'Failed to Start'
          ? state.dealerAssignments.map((assignment) =>
              assignment.tableId === session.id && !assignment.endedAt ? { ...assignment, endedAt: timestamp } : assignment
            )
          : state.dealerAssignments,
      tableEvents: [
        ...state.tableEvents,
        {
          id: uid(),
          type,
          gameId: session.gameId,
          tableId: session.id,
          timestamp,
          playerCount: session.seatsFilled,
          reason,
          note
        }
      ]
    }, true, { feature: 'Tables', action: type, metadata: { gameId: session.gameId, tableId: session.id, reason } });
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
    const profileName = profileEditDraft.name.trim();
    if (!profileName) {
      setProfileFormMessage('Enter a player name before saving the profile.');
      return;
    }
    const duplicate = state.profiles.find(
      (profile) => profile.id !== profileEditDraft.id && profile.name.trim().toLowerCase() === profileName.toLowerCase()
    );
    if (duplicate) {
      setProfileFormMessage(`${profileName} already has a profile.`);
      return;
    }
    const preferredGameIds = profileEditDraft.preferredGameIds?.length
      ? profileEditDraft.preferredGameIds
      : [profileEditDraft.preferredGameId || state.games[0]?.id || 'nlh-1-2'];
    const savedProfile: PlayerProfile = {
      ...profileEditDraft,
      name: profileName,
      phone: profileEditDraft.phone.trim(),
      membershipStartDate: profileEditDraft.membershipStartDate,
      membershipExpirationDate: profileEditDraft.membershipExpirationDate,
      preferredGameId: profileEditDraft.preferredGameId || preferredGameIds[0],
      preferredGameIds,
      preferredStakes: profileEditDraft.preferredStakes.trim(),
      typicalAvailability: profileEditDraft.typicalAvailability.trim(),
      notes: profileEditDraft.notes.trim()
    };
    persist({
      ...state,
      profiles: state.profiles.map((profile) => (profile.id === savedProfile.id ? savedProfile : profile)),
      interests: state.interests.map((interest) =>
        interest.profileId === savedProfile.id ? { ...interest, playerName: savedProfile.name } : interest
      ),
      playerSessions: state.playerSessions.map((session) =>
        session.profileId === savedProfile.id ? { ...session, playerName: savedProfile.name } : session
      ),
      buyIns: state.buyIns.map((buyIn) =>
        buyIn.profileId === savedProfile.id ? { ...buyIn, playerName: savedProfile.name } : buyIn
      ),
      playerLedger: state.playerLedger.map((entry) =>
        entry.profileId === savedProfile.id ? { ...entry, playerName: savedProfile.name } : entry
      )
    }, true, { feature: 'Profiles', action: 'Updated profile', metadata: { profileId: savedProfile.id } });
    setProfileFormMessage(`${savedProfile.name} profile updated.`);
    cancelEditProfile();
  };

  const activateInPersonMembership = (profile: PlayerProfile) => {
    if (profile.membershipStatus !== 'Approved') {
      setProfileFormMessage(`Approve ${profile.name}'s application before activating the membership.`);
      return;
    }
    const membership = createMembershipWindow(profile.membershipPlan || 'monthly', new Date(), profile.membershipDurationDays);
    const { startedAt, expiresAt } = membership;
    const amount = parseMembershipPrice(profile.membershipPriceLabel);
    const activatedAt = startedAt.toISOString();
    const membershipNotification: PlayerInAppNotification = {
      id: uid(),
      clubId: getAccountKeyFromState(state),
      gameId: '',
      title: 'Membership active',
      body: `Your membership at ${getClubDisplayName(state)} is active. You can now request seats from the player app.`,
      reason: 'membership-activated',
      createdAt: activatedAt,
      expiresAt: new Date(startedAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      targetPlayerIds: [profile.id],
      targetPlayerNames: [profile.name]
    };
    persist({
      ...state,
      profiles: state.profiles.map((candidate) => candidate.id === profile.id ? {
        ...candidate,
        membershipStartDate: membership.startDate,
        membershipExpirationDate: membership.expirationDate,
        membershipExpiresAt: expiresAt.toISOString(),
        membershipPaymentMethod: 'in-person',
        membershipStatus: 'Active'
      } : candidate),
      revenueTransactions: amount > 0 ? [
        ...state.revenueTransactions,
        {
          id: uid(),
          type: 'membership',
          amountCents: Math.round(amount * 100),
          occurredAt: startedAt.toISOString(),
          paymentStatus: 'paid',
          source: 'manual',
          playerId: profile.id,
          playerName: profile.name,
          membershipPlan: profile.membershipPlan || 'monthly'
        }
      ] : state.revenueTransactions,
      inAppNotifications: [
        membershipNotification,
        ...state.inAppNotifications.filter((notification) => !notification.expiresAt || notification.expiresAt > activatedAt).slice(0, 200)
      ]
    }, true, { feature: 'Profiles', action: 'Activated in-person membership', metadata: { profileId: profile.id, plan: profile.membershipPlan || 'monthly' } });
    setProfileFormMessage(`${profile.name}'s ${profile.membershipPlan === 'day' ? 'day pass' : 'monthly membership'} is active.`);
  };

  const approveMembershipRequest = (profile: PlayerProfile) => {
    if (profile.membershipStatus !== 'Requested') return;
    const approvedAt = nowIso();
    const membershipNotification: PlayerInAppNotification = {
      id: uid(),
      clubId: getAccountKeyFromState(state),
      gameId: '',
      title: 'Membership approved',
      body: `${getClubDisplayName(state)} approved your application. Bring your ID and pay the club's fee at the front desk to activate it.`,
      reason: 'membership-approved',
      createdAt: approvedAt,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      targetPlayerIds: [profile.id],
      targetPlayerNames: [profile.name]
    };
    persist({
      ...state,
      profiles: state.profiles.map((candidate) => candidate.id === profile.id ? {
        ...candidate,
        membershipStatus: 'Approved',
        membershipStartDate: '',
        membershipExpirationDate: '',
        membershipExpiresAt: undefined
      } : candidate),
      inAppNotifications: [
        membershipNotification,
        ...state.inAppNotifications.filter((notification) => !notification.expiresAt || notification.expiresAt > approvedAt).slice(0, 200)
      ]
    }, true, { feature: 'Profiles', action: 'Approved membership application', metadata: { profileId: profile.id, plan: profile.membershipPlan || 'monthly' } });
    setProfileFormMessage(`${profile.name} is approved. Verify ID and payment at the front desk to activate.`);
  };

  const addProfile = (event: React.FormEvent) => {
    event.preventDefault();
    const profileName = newProfile.name.trim();
    if (!profileName) {
      setProfileFormMessage('Enter a player name before adding the profile.');
      return;
    }
    const duplicate = state.profiles.find((profile) => profile.name.trim().toLowerCase() === profileName.toLowerCase());
    if (duplicate) {
      setProfileSearch(profileName);
      setProfileFormMessage(`${profileName} already has a profile.`);
      return;
    }
    const preferredGame = state.games.find((game) => game.id === newProfile.preferredGameId);
    const membership = createMembershipWindow(newProfile.membershipPlan);
    const membershipStart = membership.startedAt;
    const membershipExpires = membership.expiresAt;
    const membershipAmount = parseMembershipPrice(newProfile.membershipAmount);
    persist({
      ...state,
      profiles: [
        ...state.profiles,
        {
          id: memberId(),
          name: profileName,
          phone: newProfile.phone.trim(),
          birthday: newProfile.birthday,
          membershipStartDate: membership.startDate,
          membershipExpirationDate: membership.expirationDate,
          membershipExpiresAt: membershipExpires.toISOString(),
          membershipPlan: newProfile.membershipPlan,
          membershipPaymentMethod: 'core',
          membershipStatus: 'Active',
          membershipRequestedAt: membershipStart.toISOString(),
          membershipPriceLabel: membershipAmount ? `$${membershipAmount.toFixed(2)}` : undefined,
          totalTimePlayedHours: newProfile.totalTimePlayedHours,
          lastSessionTimePlayedHours: newProfile.lastSessionTimePlayedHours,
          commonlyPlaysWithProfileIds: newProfile.commonlyPlaysWithProfileIds,
          preferredGameId: newProfile.preferredGameId,
          preferredGameIds: [newProfile.preferredGameId],
          gamePlayCounts: {},
          mostPlayedGameId: newProfile.preferredGameId,
          preferredStakes:
            newProfile.preferredStakes.trim() ||
            preferredGame?.name ||
            '',
          typicalBuyInMin: newProfile.typicalBuyInMin,
          typicalBuyInMax: newProfile.typicalBuyInMax,
          willingnessToMove: newProfile.willingnessToMove,
          typicalAvailability: newProfile.typicalAvailability.trim(),
          preferredTags: newProfile.preferredTags,
          usualCompanions: newProfile.usualCompanions
            .split(',')
            .map((name: string) => name.trim())
            .filter(Boolean),
          notes: newProfile.notes.trim()
        }
      ],
      revenueTransactions: membershipAmount > 0 ? [
        ...state.revenueTransactions,
        {
          id: uid(),
          type: 'membership',
          amountCents: Math.round(membershipAmount * 100),
          occurredAt: membershipStart.toISOString(),
          paymentStatus: 'paid',
          source: 'manual',
          playerName: profileName,
          membershipPlan: newProfile.membershipPlan
        }
      ] : state.revenueTransactions
    }, true, { feature: 'Profiles', action: 'Added profile', metadata: { preferredGameId: newProfile.preferredGameId } });
    setProfileFormMessage(`${profileName} profile added.`);
    setNewProfile({
      name: '',
      birthday: '',
      membershipStartDate: todayDate(),
      membershipExpirationDate: nextYearDate(),
      membershipPlan: 'monthly',
      membershipAmount: 0,
      totalTimePlayedHours: 0,
      lastSessionTimePlayedHours: 0,
      commonlyPlaysWithProfileIds: [],
      preferredGameIds: ['nlh-1-2'],
      preferredGameId: 'nlh-1-2',
      phone: '',
      preferredStakes: '',
      typicalBuyInMin: 200,
      typicalBuyInMax: 500,
      usualCompanions: '',
      typicalAvailability: '',
      willingnessToMove: true,
      preferredTags: [],
      notes: ''
    });
  };

  const deleteProfile = (id: string) => {
    if (!window.confirm('Remove this profile? Existing sessions and interest entries will keep the player name.')) return;
    persist({
      ...state,
      profiles: state.profiles.filter((profile) => profile.id !== id),
      interests: state.interests.map((interest) =>
        interest.profileId === id ? { ...interest, profileId: undefined } : interest
      )
    });
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
    const [primary, ...duplicates] = profilesToMerge;
    if (!primary) return;
    const duplicateIds = new Set(duplicates.map((profile) => profile.id));
    const gamePlayCounts = profilesToMerge.reduce<Record<string, number>>((counts, profile) => {
      Object.entries(profile.gamePlayCounts ?? {}).forEach(([gameId, count]) => {
        counts[gameId] = (counts[gameId] ?? 0) + count;
      });
      return counts;
    }, {});
    const mostPlayedGameId =
      Object.entries(gamePlayCounts)
        .sort((left, right) => right[1] - left[1] || getGameName(left[0]).localeCompare(getGameName(right[0])))[0]?.[0] ??
      primary.mostPlayedGameId ??
      primary.preferredGameId;
    const merged: PlayerProfile = {
      ...primary,
      birthday: primary.birthday || profilesToMerge.find((profile) => profile.birthday)?.birthday || '',
      membershipStartDate:
        profilesToMerge
          .map((profile) => profile.membershipStartDate)
          .filter(Boolean)
          .sort()[0] ?? primary.membershipStartDate,
      membershipExpirationDate:
        profilesToMerge
          .map((profile) => profile.membershipExpirationDate)
          .filter(Boolean)
          .sort()
          .at(-1) ?? primary.membershipExpirationDate,
      totalTimePlayedHours: profilesToMerge.reduce((sum, profile) => sum + (profile.totalTimePlayedHours ?? 0), 0),
      lastSessionTimePlayedHours: Math.max(...profilesToMerge.map((profile) => profile.lastSessionTimePlayedHours ?? 0)),
      commonlyPlaysWithProfileIds: Array.from(
        new Set(profilesToMerge.flatMap((profile) => profile.commonlyPlaysWithProfileIds ?? []).filter((id) => id !== primary.id && !duplicateIds.has(id)))
      ),
      preferredGameId: primary.preferredGameId || profilesToMerge.find((profile) => profile.preferredGameId)?.preferredGameId || primary.preferredGameIds[0],
      preferredGameIds: Array.from(new Set(profilesToMerge.flatMap((profile) => profile.preferredGameIds))),
      gamePlayCounts,
      mostPlayedGameId,
      preferredStakes: Array.from(
        new Set(profilesToMerge.flatMap((profile) => profile.preferredStakes.split(',').map((item) => item.trim()).filter(Boolean)))
      ).join(', '),
      typicalBuyInMin: Math.min(...profilesToMerge.map((profile) => profile.typicalBuyInMin || primary.typicalBuyInMin)),
      typicalBuyInMax: Math.max(...profilesToMerge.map((profile) => profile.typicalBuyInMax || primary.typicalBuyInMax)),
      willingnessToMove: profilesToMerge.some((profile) => profile.willingnessToMove),
      typicalAvailability: Array.from(new Set(profilesToMerge.map((profile) => profile.typicalAvailability).filter(Boolean))).join(', '),
      usualCompanions: Array.from(new Set(profilesToMerge.flatMap((profile) => profile.usualCompanions))),
      preferredTags: Array.from(new Set(profilesToMerge.flatMap((profile) => profile.preferredTags))),
      notes: Array.from(new Set(profilesToMerge.map((profile) => profile.notes).filter(Boolean))).join(' | ')
    };

    persist({
      ...state,
      profiles: state.profiles.map((profile) => (profile.id === primary.id ? merged : profile)).filter((profile) => !duplicateIds.has(profile.id)),
      interests: state.interests.map((interest) =>
        interest.profileId && duplicateIds.has(interest.profileId) ? { ...interest, profileId: primary.id } : interest
      ),
      playerSessions: state.playerSessions.map((session) =>
        session.profileId && duplicateIds.has(session.profileId) ? { ...session, profileId: primary.id } : session
      )
    });
  };

  const addProfileToClub = (profile: PlayerProfile, sourceState = state) => {
    const existingInterest = findUniqueProfileReference(
      sourceState.interests,
      sourceState.profiles,
      profile,
      (interest) => !inactiveInterestStatuses.includes(interest.status)
    );
    const preferredGameId = profile.preferredGameIds[0] ?? sourceState.games[0]?.id ?? 'nlh-1-2';
    const timestamp = nowIso();
    let nextState = {
      ...sourceState,
      interests: ensureInterestEntry(sourceState, profile, existingInterest?.gameId || preferredGameId, 'Arrived', 'Checked in at club entry', timestamp),
      playerLedger: [
        {
          id: uid(),
          type: 'Check-In' as const,
          profileId: profile.id,
          playerName: profile.name,
          gameId: existingInterest?.gameId || preferredGameId,
          timestamp,
          note: 'Checked in at club entry'
        },
        ...sourceState.playerLedger
      ]
    };

    nextState = promptDemandAction(nextState, preferredGameId);
    persist(nextState, true, {
      feature: 'Profiles',
      action: 'Checked player into club',
      metadata: { preferredGameId, seated: false }
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

  useEffect(() => {
    if (playerPopup !== 'scan' || !qrVideoRef.current) return undefined;
    let disposed = false;
    setQrScanMessage('Starting camera…');
    import('@zxing/browser').then(({ BrowserQRCodeReader }) => {
      if (disposed || !qrVideoRef.current) return;
      const reader = new BrowserQRCodeReader();
      return reader.decodeFromVideoDevice(undefined, qrVideoRef.current, (result, _error, controls) => {
        if (!result || disposed) return;
        controls.stop();
        qrScannerControlsRef.current = null;
        handleMembershipQrCheckIn(result.getText());
      });
    }).then((controls) => {
      if (!controls) return;
      if (disposed) {
        controls.stop();
        return;
      }
      qrScannerControlsRef.current = controls;
      setQrScanMessage('Point the camera at an active Orbit membership QR code.');
    }).catch(() => {
      if (!disposed) setQrScanMessage('Camera unavailable. Use a USB scanner or paste the QR value below.');
    });

    return () => {
      disposed = true;
      qrScannerControlsRef.current?.stop();
      qrScannerControlsRef.current = null;
    };
  }, [playerPopup, qrScanAttempt]);

  const removeProfileFromClub = (profile: PlayerProfile) => {
    const matchingInterestIds = new Set(
      getProfileReferenceMatches(
        state.interests,
        state.profiles,
        profile,
        (interest) => interest.status === 'Arrived'
      ).map((interest) => interest.id)
    );
    persist({
      ...state,
      interests: state.interests.filter((interest) => !matchingInterestIds.has(interest.id))
    });
  };

  const commitImportedProfiles = (imported: PlayerProfile[]) => {
    if (!imported.length) return;
    const existingNames = new Set(state.profiles.map((profile: { name: string; }) => profile.name.toLowerCase()));
    const uniqueImports = imported.filter((profile) => !existingNames.has(profile.name.toLowerCase()));
    const allProfiles = [...state.profiles, ...uniqueImports];
    const enrichedImports = uniqueImports.map((profile) => ({
      ...profile,
      commonlyPlaysWithProfileIds: profile.commonlyPlaysWithProfileIds.length
        ? profile.commonlyPlaysWithProfileIds
        : profile.usualCompanions
            .map((name) => allProfiles.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase())?.id)
            .filter((id): id is string => Boolean(id))
    }));
    persist({ ...state, profiles: [...state.profiles, ...enrichedImports] }, true, {
      feature: 'Profiles',
      action: 'Imported profiles',
      metadata: { count: enrichedImports.length }
    });
  };

  const importedValue = (item: Record<string, unknown>, aliases: string[]) => {
    const normalizedAliases = new Set(aliases.map((alias) => alias.toLowerCase().replace(/[^a-z0-9]/g, '')));
    const match = Object.entries(item).find(([key]) => normalizedAliases.has(key.toLowerCase().replace(/[^a-z0-9]/g, '')));
    return match?.[1];
  };

  const importedString = (item: Record<string, unknown>, aliases: string[], fallback = '') => {
    const value = importedValue(item, aliases);
    return value === undefined || value === null ? fallback : String(value).trim();
  };

  const importedDate = (item: Record<string, unknown>, aliases: string[], fallback: string) => {
    const value = importedValue(item, aliases);
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    if (typeof value === 'number' && Number.isFinite(value)) {
      const excelEpoch = Date.UTC(1899, 11, 30);
      return new Date(excelEpoch + value * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    }
    const text = value === undefined || value === null ? '' : String(value).trim();
    if (!text) return fallback;
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    return text.slice(0, 10);
  };

  const importedNumber = (item: Record<string, unknown>, aliases: string[], fallback = 0) => {
    const value = Number(importedValue(item, aliases) ?? fallback);
    return Number.isFinite(value) ? value : fallback;
  };

  const profileFromImportedRecord = (item: Record<string, unknown>): PlayerProfile => {
    const firstName = importedString(item, ['firstName', 'First Name', 'first']);
    const lastName = importedString(item, ['lastName', 'Last Name', 'last']);
    const fullName = importedString(item, ['name', 'Name', 'playerName', 'Player Name', 'player', 'Player', 'customerName', 'Customer Name']);
    const name = fullName || [firstName, lastName].filter(Boolean).join(' ');
    const preferredStakes = importedString(item, ['preferredStakes', 'Preferred Stakes', 'preferredGame', 'Preferred Game', 'stakes', 'Game']);
    const preferredGameId = resolveGameId(
      state.games,
      importedString(item, ['preferredGameId', 'Preferred Game Id', 'preferredGame', 'Preferred Game', 'stakes', 'Game'], preferredStakes),
      resolveGameId(state.games, preferredStakes, state.games[0]?.id ?? '')
    );
    const companionNames = importedString(item, ['usualCompanions', 'companions', 'Companions', 'commonlyPlaysWith', 'Commonly Plays With'])
      .split(/[|;]/)
      .map((name) => name.trim())
      .filter(Boolean);
    return {
      id: importedString(item, ['id', 'ID', 'memberId', 'Member ID', 'membershipId', 'Membership ID', 'playerId', 'Player ID', 'cardNumber', 'Card Number', 'cardId', 'Card ID'], memberId()),
      name,
      phone: importedString(item, ['phone', 'Phone', 'phoneNumber', 'Phone Number', 'mobile', 'Mobile', 'cell', 'Cell']),
      birthday: importedDate(item, ['birthday', 'Birthday', 'dob', 'DOB', 'dateOfBirth', 'Date of Birth'], ''),
      membershipStartDate: importedDate(item, ['membershipStartDate', 'Membership Start', 'memberSince', 'Member Since', 'joinDate', 'Join Date', 'createdAt', 'Created At'], todayDate()),
      membershipExpirationDate: importedDate(item, ['membershipExpirationDate', 'Membership Expiration', 'expiresAt', 'Expires At', 'expirationDate', 'Expiration Date', 'expiryDate', 'Expiry Date'], nextYearDate()),
      totalTimePlayedHours: importedNumber(item, ['totalTimePlayedHours', 'totalTimePlayed', 'Total Time Played', 'lifetimeHours', 'Lifetime Hours']),
      lastSessionTimePlayedHours: importedNumber(item, ['lastSessionTimePlayedHours', 'lastSessionTimePlayed', 'Last Session Time Played']),
      commonlyPlaysWithProfileIds: [],
      preferredGameId,
      preferredGameIds: preferredGameId ? [preferredGameId] : [],
      gamePlayCounts: {},
      mostPlayedGameId: preferredGameId,
      preferredStakes,
      typicalBuyInMin: importedNumber(item, ['typicalBuyInMin', 'buyInMin', 'Buy In Min']),
      typicalBuyInMax: importedNumber(item, ['typicalBuyInMax', 'buyInMax', 'Buy In Max']),
      willingnessToMove: ['yes', 'true', 'y', '1'].includes(importedString(item, ['willingnessToMove', 'moveTables', 'Move Tables']).toLowerCase()),
      typicalAvailability: importedString(item, ['typicalAvailability', 'availability', 'Availability']),
      preferredTags: Array.isArray(item.preferredTags) ? item.preferredTags as TableTag[] : [],
      usualCompanions: companionNames,
      notes: importedString(item, ['notes', 'Notes', 'note', 'Note'])
    };
  };

  const parseCsvRows = (text: string) => {
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    if (!lines.length) return [];

    const parseLine = (line: string) => {
      const cells: string[] = [];
      let cell = '';
      let quoted = false;

      for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        const next = line[index + 1];
        if (char === '"' && quoted && next === '"') {
          cell += '"';
          index += 1;
          continue;
        }
        if (char === '"') {
          quoted = !quoted;
          continue;
        }
        if (char === ',' && !quoted) {
          cells.push(cell.trim());
          cell = '';
          continue;
        }
        cell += char;
      }

      cells.push(cell.trim());
      return cells;
    };

    const [headerLine, ...dataLines] = lines;
    const headers = parseLine(headerLine);
    return dataLines.map((line) => {
      const values = parseLine(line);
      return headers.reduce<Record<string, unknown>>((record, header, index) => {
        if (header) record[header] = values[index] ?? '';
        return record;
      }, {});
    });
  };

  const importProfileFile = async (file?: File) => {
    if (!file) return;
    try {
      if (file.name.toLowerCase().endsWith('.csv')) {
        const rows = parseCsvRows(await file.text());
        commitImportedProfiles(rows.map(profileFromImportedRecord).filter((profile) => profile.name));
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
      commitImportedProfiles(rows.map(profileFromImportedRecord).filter((profile) => profile.name));
      setImportText('');
    } catch {
      window.alert('Unable to import that profile file.');
    }
  };

  const isImportedObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

  const isImportedJsonProfile = (value: unknown): value is Record<string, unknown> =>
    isImportedObject(value) && typeof value.name === 'string' && Boolean(value.name.trim());

  const importedJsonNumber = (value: unknown) => {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const importedJsonStringArray = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

  const isTableTag = (value: unknown): value is TableTag =>
    typeof value === 'string' && gameQualityTags.some((tag) => tag === value);

  const profileFromPastedJsonRecord = (item: Record<string, unknown>): PlayerProfile => {
    const rawPreferredGameIds = importedJsonStringArray(item.preferredGameIds);
    const preferredGameId = resolveGameId(
      state.games,
      String(item.preferredGameId ?? rawPreferredGameIds[0] ?? item.preferredGame ?? item.stakes ?? ''),
      state.games[0]?.id ?? 'nlh-1-2'
    );
    const companionNames = Array.isArray(item.usualCompanions)
      ? importedJsonStringArray(item.usualCompanions)
      : String(item.usualCompanions ?? item.commonlyPlaysWith ?? item.companions ?? '')
          .split(/[|;]/)
          .map((name) => name.trim())
          .filter(Boolean);
    const preferredGameIds = rawPreferredGameIds
      .map((gameId) => resolveGameId(state.games, gameId, ''))
      .filter((gameId): gameId is string => Boolean(gameId));
    const gamePlayCountsSource = isImportedObject(item.gamePlayCounts) ? item.gamePlayCounts : {};

    return {
      id: String(item.id ?? memberId()),
      name: String(item.name).trim(),
      phone: String(item.phone ?? item.phoneNumber ?? item.mobile ?? item.cell ?? ''),
      birthday: String(item.birthday ?? ''),
      membershipStartDate: String(item.membershipStartDate ?? item.memberSince ?? todayDate()),
      membershipExpirationDate: String(item.membershipExpirationDate ?? item.expiresAt ?? nextYearDate()),
      totalTimePlayedHours: importedJsonNumber(item.totalTimePlayedHours ?? item.totalTimePlayed),
      lastSessionTimePlayedHours: importedJsonNumber(item.lastSessionTimePlayedHours ?? item.lastSessionTimePlayed),
      commonlyPlaysWithProfileIds: importedJsonStringArray(item.commonlyPlaysWithProfileIds),
      preferredGameId,
      preferredGameIds: preferredGameIds.length ? Array.from(new Set(preferredGameIds)) : [preferredGameId],
      gamePlayCounts: Object.entries(gamePlayCountsSource).reduce<Record<string, number>>((counts, [gameId, count]) => {
        const resolvedGameId = resolveGameId(state.games, gameId, '');
        const numericCount = Number(count);
        if (resolvedGameId && Number.isFinite(numericCount) && numericCount > 0) counts[resolvedGameId] = numericCount;
        return counts;
      }, {}),
      mostPlayedGameId: resolveGameId(state.games, String(item.mostPlayedGameId ?? ''), preferredGameId),
      preferredStakes: String(item.preferredStakes ?? item.stakes ?? state.games.find((game) => game.id === preferredGameId)?.name ?? ''),
      typicalBuyInMin: importedJsonNumber(item.typicalBuyInMin ?? item.buyInMin),
      typicalBuyInMax: importedJsonNumber(item.typicalBuyInMax ?? item.buyInMax),
      willingnessToMove: Boolean(item.willingnessToMove ?? item.moveTables ?? false),
      typicalAvailability: String(item.typicalAvailability ?? item.availability ?? ''),
      preferredTags: Array.isArray(item.preferredTags) ? item.preferredTags.filter(isTableTag) : [],
      usualCompanions: companionNames,
      notes: String(item.notes ?? '')
    };
  };

  const importProfiles = () => {
    const raw = importText.trim();
    if (!raw) return;

    let imported: PlayerProfile[] = [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        imported = parsed
          .filter(isImportedJsonProfile)
          .map(profileFromPastedJsonRecord);
      }
    } catch {
      imported = raw
        .split(/\r?\n/)
        .map((line: string) => line.trim())
        .filter(Boolean)
        .map((line: string) => {
          const [name, preferredStakes = '', birthday = '', membershipStart = todayDate(), membershipExpiration = nextYearDate(), companions = '', availability = '', moveTables = 'yes'] = line.split(',').map((part: string) => part.trim());
          const preferredGameId = resolveGameId(state.games, preferredStakes, state.games[0]?.id ?? 'nlh-1-2');
          return {
            id: memberId(),
            name,
            phone: '',
            birthday,
            membershipStartDate: membershipStart || todayDate(),
            membershipExpirationDate: membershipExpiration || nextYearDate(),
            totalTimePlayedHours: 0,
            lastSessionTimePlayedHours: 0,
            commonlyPlaysWithProfileIds: [],
            preferredGameId,
            preferredGameIds: [preferredGameId],
            gamePlayCounts: {},
            mostPlayedGameId: preferredGameId,
            preferredStakes,
            typicalBuyInMin: 0,
            typicalBuyInMax: 0,
            willingnessToMove: !['no', 'false', 'n'].includes(moveTables.toLowerCase()),
            typicalAvailability: availability,
            preferredTags: [],
            usualCompanions: companions
              .split(/[|;]/)
              .map((companion: string) => companion.trim())
              .filter(Boolean),
            notes: ''
          };
        })
        .filter((profile: { name: any; }) => profile.name);
    }

    commitImportedProfiles(imported);
    setImportText('');
  };

  const currentNightClose = state.nightCloses
    .filter((close) => close.date === todayDate())
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  const savedNightCloseActuals = Object.fromEntries((currentNightClose?.tables ?? []).map((table) => [table.tableId, table.actualCash === undefined ? '' : String(table.actualCash)]));
  const effectiveNightCloseActuals = { ...savedNightCloseActuals, ...nightCloseActuals };
  const calculatedNightCloseTables = buildNightCloseTables(state, effectiveNightCloseActuals);
  const nightCloseTables = currentNightClose?.status === 'Locked' ? currentNightClose.tables : calculatedNightCloseTables;
  const nightCloseWarnings = Array.from(new Set(nightCloseTables.flatMap((table) => table.warnings.map((warning) => `${table.tableLabel}: ${warning}`))));
  const nightCloseTotals = nightCloseTables.reduce((totals, table) => ({
    buyIns: totals.buyIns + table.buyIns,
    cashOuts: totals.cashOuts + table.cashOuts,
    removed: totals.removed + table.drop + table.timeFees,
    expected: totals.expected + table.expectedCash,
    actual: totals.actual + (table.actualCash ?? 0),
    discrepancy: totals.discrepancy + (table.discrepancy ?? 0)
  }), { buyIns: 0, cashOuts: 0, removed: 0, expected: 0, actual: 0, discrepancy: 0 });
  const nightCloseHasMissingActual = nightCloseTables.some((table) => table.actualCash === undefined);

  const makeNightCloseAudit = (action: NightCloseAudit['action'], note?: string): NightCloseAudit => {
    const staff = state.settings.staffAccounts.find((account) => account.id === state.settings.activeStaffId);
    return { id: uid(), action, timestamp: nowIso(), staffId: staff?.id, staffName: staff?.name ?? 'Unassigned staff', staffRole: staff?.role, note };
  };

  const saveNightClose = (nextStatus: NightCloseStatus = currentNightClose?.status ?? 'Draft') => {
    if (currentNightClose?.status === 'Locked') return currentNightClose;
    const timestamp = nowIso();
    const auditEntry = makeNightCloseAudit(currentNightClose ? 'Saved' : 'Created');
    const record: NightCloseRecord = {
      id: currentNightClose?.id ?? uid(),
      date: todayDate(),
      status: nextStatus,
      createdAt: currentNightClose?.createdAt ?? timestamp,
      updatedAt: timestamp,
      notes: nightCloseNotes || currentNightClose?.notes || '',
      tables: nightCloseTables,
      warnings: nightCloseWarnings,
      staffSignOff: currentNightClose?.staffSignOff,
      managerSignOff: currentNightClose?.managerSignOff,
      audit: [...(currentNightClose?.audit ?? []), auditEntry]
    };
    persist({
      ...state,
      nightCloses: [...state.nightCloses.filter((close) => close.id !== record.id), record]
    }, true, { feature: 'Night close', action: 'Saved reconciliation draft', route: 'summary' });
    return record;
  };

  const signNightClose = () => {
    const staff = state.settings.staffAccounts.find((account) => account.id === state.settings.activeStaffId);
    if (!staff) {
      window.alert('Select the staff member operating this station before signing.');
      return;
    }
    if (!nightCloseTables.length) {
      window.alert('There are no tables in the current shift to reconcile.');
      return;
    }
    if (nightCloseTables.some((table) => table.actualCash === undefined)) {
      window.alert('Enter an actual cash count for every table before staff sign-off.');
      return;
    }
    const timestamp = nowIso();
    const signOff = makeNightCloseAudit('Staff Signed', `Discrepancy ${nightCloseTotals.discrepancy.toFixed(2)}`);
    const record: NightCloseRecord = {
      id: currentNightClose?.id ?? uid(), date: todayDate(), status: 'Staff Signed',
      createdAt: currentNightClose?.createdAt ?? timestamp, updatedAt: timestamp,
      notes: nightCloseNotes || currentNightClose?.notes || '', tables: nightCloseTables, warnings: nightCloseWarnings,
      staffSignOff: signOff, managerSignOff: undefined,
      audit: [...(currentNightClose?.audit ?? []), signOff]
    };
    persist({ ...state, nightCloses: [...state.nightCloses.filter((close) => close.id !== record.id), record] }, true,
      { feature: 'Night close', action: 'Staff signed reconciliation', route: 'summary', metadata: { discrepancy: Number(nightCloseTotals.discrepancy.toFixed(2)) } });
  };

  const approveAndLockNightClose = () => {
    const manager = state.settings.staffAccounts.find((account) => account.id === state.settings.activeStaffId);
    if (!manager || !['Owner', 'Manager'].includes(manager.role)) {
      window.alert('A Manager or Owner must be selected to approve and lock the night.');
      return;
    }
    if (currentNightClose?.status !== 'Staff Signed') {
      window.alert('Staff sign-off is required before manager approval.');
      return;
    }
    if (!window.confirm(
      `Lock tonight's reconciliation with a ${nightCloseTotals.discrepancy < 0 ? '-' : '+'}$${Math.abs(nightCloseTotals.discrepancy).toFixed(2)} discrepancy?\n\nThis will close every current table, remove all seated players, and reset Recent Activity.`
    )) return;
    const timestamp = nowIso();
    const approval = makeNightCloseAudit('Manager Approved', `Locked with discrepancy ${nightCloseTotals.discrepancy.toFixed(2)}`);
    const lockedTables = nightCloseTables.map((table) => ({ ...table, warnings: table.warnings.filter((warning) => warning !== 'Table is still open') }));
    const lockedWarnings = Array.from(new Set(lockedTables.flatMap((table) => table.warnings.map((warning) => `${table.tableLabel}: ${warning}`))));
    const locked: NightCloseRecord = {
      ...currentNightClose,
      status: 'Locked', updatedAt: timestamp, lockedAt: timestamp,
      notes: nightCloseNotes || currentNightClose.notes, tables: lockedTables, warnings: lockedWarnings,
      managerSignOff: approval, audit: [...currentNightClose.audit, approval]
    };
    const hasHistoryForDate = state.history.some((night) => night.date === locked.date);
    persist({
      ...state,
      nightCloses: [...state.nightCloses.filter((close) => close.id !== locked.id), locked],
      history: hasHistoryForDate ? state.history : [...state.history, { ...analytics.currentNight, id: uid(), notes: locked.notes }],
      interests: [],
      sessions: state.sessions.map((session) => ({ ...session, status: 'Closed' as GameStatus, endedAt: session.endedAt ?? timestamp })),
      playerSessions: state.playerSessions.map((session) => ({ ...session, leftAt: session.leftAt ?? timestamp })),
      tableEvents: [
        ...state.tableEvents,
        ...state.sessions.filter((session) => session.status !== 'Closed').map((session) => ({
          id: uid(), type: 'Closed' as TableEventType, gameId: session.gameId, tableId: session.id,
          timestamp, playerCount: session.seatsFilled, note: 'Night reconciliation locked'
        }))
      ]
    }, true, { feature: 'Night close', action: 'Manager approved and locked night', route: 'summary', metadata: { discrepancy: Number(nightCloseTotals.discrepancy.toFixed(2)) } });
  };

  const reopenNightClose = () => {
    const manager = state.settings.staffAccounts.find((account) => account.id === state.settings.activeStaffId);
    if (!currentNightClose || !manager || !['Owner', 'Manager'].includes(manager.role)) {
      window.alert('A Manager or Owner must be selected to reopen a close.');
      return;
    }
    const reason = window.prompt('Reason for reopening this locked reconciliation:')?.trim();
    if (!reason) return;
    const auditEntry = makeNightCloseAudit('Reopened', reason);
    const reopened: NightCloseRecord = {
      ...currentNightClose, status: 'Draft', updatedAt: auditEntry.timestamp, lockedAt: undefined,
      managerSignOff: undefined, audit: [...currentNightClose.audit, auditEntry]
    };
    persist({ ...state, nightCloses: [...state.nightCloses.filter((close) => close.id !== reopened.id), reopened] }, true,
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

  const updateTournament = (tournamentId: string, updater: (tournament: Tournament) => Tournament, usageAction: string) => {
    persist({
      ...state,
      tournaments: state.tournaments.map((tournament) => (tournament.id === tournamentId ? updater(tournament) : tournament))
    }, true, { feature: 'Tournament manager', action: usageAction, route: 'tournaments' });
  };

  const createTournament = (event: React.FormEvent) => {
    event.preventDefault();
    const name = tournamentDraft.name.trim();
    if (!name) return;
    const levelMinutes = Math.max(5, Number(tournamentDraft.levelMinutes) || 20);
    const tournament: Tournament = {
      id: uid(),
      name,
      status: 'Draft',
      createdAt: nowIso(),
      currentLevelIndex: 0,
      buyIn: Math.max(0, Number(tournamentDraft.buyIn) || 0),
      startingStack: Math.max(1000, Number(tournamentDraft.startingStack) || 20000),
      rebuyPrizePercent: Math.min(100, Math.max(0, Number(tournamentDraft.rebuyPrizePercent) || 0)),
      tableSize: Math.min(10, Math.max(2, Number(tournamentDraft.tableSize) || 9)),
      levels: defaultTournamentLevels().map((level) => ({ ...level, durationMinutes: levelMinutes })),
      players: [],
      payouts: defaultTournamentPayouts()
    };
    persist({ ...state, tournaments: [tournament, ...state.tournaments] }, true, { feature: 'Tournament manager', action: 'Created tournament', route: 'tournaments' });
    setSelectedTournamentId(tournament.id);
    setTournamentView('manage');
    setTournamentSection('clock');
  };

  const beginTournamentEdit = (tournament: Tournament) => {
    setSelectedTournamentId(tournament.id);
    setTournamentDraft({
      name: tournament.name,
      buyIn: String(tournament.buyIn),
      startingStack: String(tournament.startingStack),
      levelMinutes: String(tournament.levels[0]?.durationMinutes ?? 20),
      rebuyPrizePercent: String(tournament.rebuyPrizePercent ?? 100),
      tableSize: String(tournament.tableSize ?? 9)
    });
    setTournamentView('edit');
  };

  const saveTournamentSettings = (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedTournament) return;
    const levelMinutes = Math.max(5, Number(tournamentDraft.levelMinutes) || 20);
    updateTournament(selectedTournament.id, (tournament) => ({
      ...tournament,
      name: tournamentDraft.name.trim() || tournament.name,
      buyIn: Math.max(0, Number(tournamentDraft.buyIn) || 0),
      startingStack: Math.max(1000, Number(tournamentDraft.startingStack) || 20000),
      rebuyPrizePercent: Math.min(100, Math.max(0, Number(tournamentDraft.rebuyPrizePercent) || 0)),
      tableSize: Math.min(10, Math.max(2, Number(tournamentDraft.tableSize) || 9)),
      levels: tournament.levels.map((level) => ({ ...level, durationMinutes: levelMinutes }))
    }), 'Updated tournament settings');
    setTournamentView('library');
  };

  const runTournamentAgain = (source: Tournament) => {
    const tournament: Tournament = {
      ...source,
      id: uid(),
      name: source.name,
      createdAt: nowIso(),
      status: 'Draft',
      startedAt: undefined,
      pausedAt: undefined,
      completedAt: undefined,
      currentLevelIndex: 0,
      levelStartedAt: undefined,
      pausedRemainingSeconds: undefined,
      players: []
    };
    persist({ ...state, tournaments: [tournament, ...state.tournaments] }, true, { feature: 'Tournament manager', action: 'Created recurring tournament', route: 'tournaments' });
    setSelectedTournamentId(tournament.id);
    setTournamentView('manage');
    setTournamentSection('players');
  };

  const drawTournamentTables = (tournament: Tournament) => {
    const shuffled = tournament.players.filter((player) => player.status !== 'Eliminated').map((player) => ({ player, sort: Math.random() })).sort((left, right) => left.sort - right.sort).map(({ player }) => player);
    const tableCount = Math.max(1, Math.ceil(shuffled.length / tournament.tableSize));
    const assignments = new Map(shuffled.map((player, index) => [player.id, { tableNumber: (index % tableCount) + 1, seatNumber: Math.floor(index / tableCount) + 1 }]));
    updateTournament(tournament.id, (current) => ({ ...current, players: current.players.map((player) => assignments.has(player.id) ? { ...player, ...assignments.get(player.id) } : player) }), 'Drew tournament tables');
  };

  const registerTournamentPlayer = (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedTournament) return;
    const profile = state.profiles.find((item) => item.id === tournamentPlayerDraft.profileId);
    const name = (profile?.name || tournamentPlayerDraft.name).trim();
    if (!name) return;
    const player: TournamentPlayer = {
      id: uid(),
      profileId: profile?.id,
      name,
      phone: profile?.phone || tournamentPlayerDraft.phone.trim(),
      email: tournamentPlayerDraft.email.trim(),
      buyIn: selectedTournament.buyIn,
      rebuys: 0,
      addOns: 0,
      startingStack: selectedTournament.startingStack,
      status: selectedTournament.status === 'Draft' ? 'Registered' : 'Active',
      registeredAt: nowIso()
    };
    updateTournament(selectedTournament.id, (tournament) => ({ ...tournament, players: [...tournament.players, player] }), 'Registered player');
    setTournamentPlayerDraft({ name: '', profileId: '', phone: '', email: '' });
  };

  const startTournament = (tournament: Tournament) => {
    updateTournament(tournament.id, (current) => ({
      ...current,
      status: 'Running',
      startedAt: current.startedAt ?? nowIso(),
      levelStartedAt: nowIso(),
      pausedRemainingSeconds: undefined,
      players: current.players.map((player) => ({ ...player, status: player.status === 'Registered' || player.status === 'Checked In' ? 'Active' : player.status }))
    }), 'Started tournament');
    window.setTimeout(() => openTournamentTv(tournament.id), 100);
  };

  const pauseTournament = (tournament: Tournament) => {
    updateTournament(tournament.id, (current) => ({
      ...current,
      status: 'Paused',
      pausedAt: nowIso(),
      pausedRemainingSeconds: getTournamentLevelRemainingSeconds(current, clockNow)
    }), 'Paused tournament');
  };

  const resumeTournament = (tournament: Tournament) => {
    const level = getTournamentLevel(tournament);
    const remaining = tournament.pausedRemainingSeconds ?? (level?.durationMinutes ?? 20) * 60;
    updateTournament(tournament.id, (current) => ({
      ...current,
      status: 'Running',
      levelStartedAt: new Date(Date.now() - (((level?.durationMinutes ?? 20) * 60 - remaining) * 1000)).toISOString()
    }), 'Resumed tournament');
  };

  const advanceTournamentLevel = (tournament: Tournament, direction: 1 | -1) => {
    updateTournament(tournament.id, (current) => ({
      ...current,
      currentLevelIndex: Math.min(Math.max(current.currentLevelIndex + direction, 0), Math.max(current.levels.length - 1, 0)),
      levelStartedAt: current.status === 'Running' ? nowIso() : current.levelStartedAt,
      pausedRemainingSeconds: undefined
    }), direction > 0 ? 'Advanced level' : 'Rewound level');
  };

  const eliminateTournamentPlayer = (tournament: Tournament, playerId: string) => {
    const remainingAfter = getTournamentActivePlayers(tournament) - 1;
    updateTournament(tournament.id, (current) => ({
      ...current,
      players: current.players.map((player) =>
        player.id === playerId
          ? { ...player, status: 'Eliminated', eliminatedAt: nowIso(), finishPlace: Math.max(1, remainingAfter + 1) }
          : player
      ),
      status: remainingAfter <= 1 && current.status !== 'Draft' ? 'Finished' : current.status,
      completedAt: remainingAfter <= 1 && current.status !== 'Draft' ? nowIso() : current.completedAt
    }), 'Eliminated player');
  };

  const addTournamentEntry = (tournament: Tournament, playerId: string, field: 'rebuys' | 'addOns') => {
    updateTournament(tournament.id, (current) => ({
      ...current,
      players: current.players.map((player) => (player.id === playerId ? { ...player, [field]: player[field] + 1 } : player))
    }), field === 'rebuys' ? 'Added rebuy' : 'Added add-on');
  };

  const updateTournamentPayout = (tournament: Tournament, place: number, percent: number) => {
    updateTournament(tournament.id, (current) => ({
      ...current,
      payouts: [
        ...current.payouts.filter((payout) => payout.place !== place),
        { place, percent: Math.max(0, percent) }
      ].sort((left, right) => left.place - right.place)
    }), 'Updated payout');
  };

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
    let desktopRecord: PersistedStateRecord | null | undefined;
    try {
      desktopRecord = await window.tableManagerDesktop?.loadStateForAccount(access);
    } catch {
      // Cloud or desktop lookup failures should not block activation of a valid local pilot key.
      desktopRecord = undefined;
    }
    const localRecord = desktopRecord?.state
      ? desktopRecord
      : (() => {
          const stored = localStorage.getItem(`${storageKey}:${getAccountKeyFromAccess(access)}`);
          if (!stored) return null;
          const restoredState = parsePersistedAppState(stored);
          return restoredState ? { state: restoredState } : null;
        })();
    if (!localRecord?.state) return false;

    const next = normalizeState({
      ...localRecord.state,
      settings: {
        ...localRecord.state.settings,
        pilotAccess: access
      }
    });
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

  const checkInTournamentPlayer = (tournament: Tournament, playerId: string) => {
    updateTournament(tournament.id, (current) => ({
      ...current,
      players: current.players.map((player) => player.id === playerId ? { ...player, status: 'Checked In' } : player)
    }), 'Checked in player');
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
    setStaffNotifications((current) => {
      const next = current.map((item) => item.id === notification.id ? { ...item, read: true } : item);
      localStorage.setItem(`${storageKey}:staff-notifications`, JSON.stringify(next));
      return next;
    });
    setStaffRequestNotice((current) => current?.id === notification.id ? null : current);
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
                      setStaffNotifications(next);
                      localStorage.setItem(`${storageKey}:staff-notifications`, JSON.stringify(next));
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
          <form className="access-step account-form" onSubmit={signInToAccount}>
            <input value={loginDraft.username} onChange={(event) => setLoginDraft({ ...loginDraft, username: event.target.value })} placeholder="Email" type="email" autoComplete="email" />
            <input value={loginDraft.password} onChange={(event) => setLoginDraft({ ...loginDraft, password: event.target.value })} placeholder="Password" type="password" />
            <label className="switch-control">
              <input type="checkbox" checked={loginDraft.staySignedIn} onChange={(event) => setLoginDraft({ ...loginDraft, staySignedIn: event.target.checked })} />
              <span>Stay signed in until key expiration</span>
            </label>
            <button className="primary-button" type="submit">Sign In</button>
            <button className="ghost-button" type="button" onClick={() => setState(seedState)}>Use a different key</button>
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
      <main className={`app-shell compact-shell settings-page settings-view-${settingsSection}`}>
        <header className="topbar">
          <div>
            <h1>Settings</h1>
            <p className="page-subtitle">Club, staff, tables, data, display, and legal information</p>
          </div>
          <button className="ghost-button" onClick={closeRoute}>
            <X size={18} />
            Close
          </button>
        </header>

        <nav className="settings-nav" aria-label="Settings sections">
          <button className={settingsSection === 'club' ? 'active' : ''} onClick={() => setSettingsSection('club')}>Club & license</button><button className={settingsSection === 'staff' ? 'active' : ''} onClick={() => setSettingsSection('staff')}>Staff</button><button className={settingsSection === 'tables' ? 'active' : ''} onClick={() => setSettingsSection('tables')}>Tables & fees</button><button className={settingsSection === 'data' ? 'active' : ''} onClick={() => setSettingsSection('data')}>Data</button><button className={settingsSection === 'display' ? 'active' : ''} onClick={() => setSettingsSection('display')}>Display</button><button className={settingsSection === 'legal' ? 'active' : ''} onClick={() => setSettingsSection('legal')}>Legal & support</button>
        </nav>
        <section className="customization-layout">
          <section className="panel settings-panel account-management-panel" id="settings-club">
            <PanelTitle icon={<KeyRound />} title="Account & License" />
            <div className="preference-list">
              <article className="preference-row">
                <div>
                  <strong>{state.settings.clubAccount?.clubName || 'Club account'}</strong>
                  <span>
                    {state.settings.pilotAccess
                      ? `License ${state.settings.pilotAccess.licenseId || state.settings.pilotAccess.authorizationCode} expires ${state.settings.pilotAccess.expiresAt}`
                      : 'No active license on file'}
                  </span>
                </div>
                <label className="secondary-button license-file-button">
                  Renew Key
                  <input
                    type="file"
                    accept="application/json,.json,.key"
                    onChange={(event) => applyReplacementPilotKey(event.target.files?.[0])}
                  />
                </label>
              </article>
              <form className="account-management-form" onSubmit={saveClubAccount}>
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
                  placeholder="Address"
                />
                <button className="primary-button" type="submit">
                  Save Account
                </button>
              </form>
              <article className="preference-row membership-plan-heading">
                <div><strong>Player memberships</strong><span>Create the plans published to Orbit Player. Purchases become club memberships and unlock game requests.</span></div>
                <button className="secondary-button" type="button" onClick={() => updateSettings({ membershipPlans: [...state.settings.membershipPlans, { id: `plan-${Date.now()}`, name: 'New Membership', priceLabel: '$0', durationDays: 30, description: '', active: true }] })}><Plus size={16} /> Add plan</button>
              </article>
              <div className="preference-list">
                {state.settings.membershipPlans.map((plan) => (
                  <article className="preference-row" key={plan.id}>
                    <div className="account-management-form">
                      <input value={plan.name} aria-label="Membership name" placeholder="Membership name" onChange={(event) => updateSettings({ membershipPlans: state.settings.membershipPlans.map((item) => item.id === plan.id ? { ...item, name: event.target.value } : item) })} />
                      <input value={plan.priceLabel} aria-label="Membership price" placeholder="$40/mo" onChange={(event) => updateSettings({ membershipPlans: state.settings.membershipPlans.map((item) => item.id === plan.id ? { ...item, priceLabel: event.target.value } : item) })} />
                      <input type="number" min="1" value={plan.durationDays} aria-label="Membership duration in days" onChange={(event) => updateSettings({ membershipPlans: state.settings.membershipPlans.map((item) => item.id === plan.id ? { ...item, durationDays: Math.max(1, Number(event.target.value) || 1) } : item) })} />
                      <input value={plan.description ?? ''} aria-label="Membership description" placeholder="What this plan includes" onChange={(event) => updateSettings({ membershipPlans: state.settings.membershipPlans.map((item) => item.id === plan.id ? { ...item, description: event.target.value } : item) })} />
                    </div>
                    <label><input type="checkbox" checked={plan.active} onChange={(event) => updateSettings({ membershipPlans: state.settings.membershipPlans.map((item) => item.id === plan.id ? { ...item, active: event.target.checked } : item) })} /> Published</label>
                    <button className="icon-button" type="button" aria-label={`Delete ${plan.name}`} onClick={() => updateSettings({ membershipPlans: state.settings.membershipPlans.filter((item) => item.id !== plan.id) })}><Trash2 size={16} /></button>
                  </article>
                ))}
              </div>
              {pilotKeyError ? <p className="access-error">{pilotKeyError}</p> : null}
            </div>
          </section>

          <section className="panel settings-panel" id="settings-staff">
            <PanelTitle icon={<Users />} title="Staff Accounts" />
            <div className="preference-list">
              <article className="preference-row">
                <div>
                  <strong>Active operator</strong>
                  <span>Select the staff account using this station tonight.</span>
                </div>
                <select
                  value={state.settings.activeStaffId ?? ''}
                  onChange={(event) => selectActiveStaff(event.target.value)}
                >
                  <option value="">No operator selected</option>
                  {state.settings.staffAccounts.filter((staff) => staff.active).map((staff) => (
                    <option key={staff.id} value={staff.id}>
                      {staff.name} - {staff.role}
                    </option>
                  ))}
                </select>
              </article>
              <form className="staff-account-form" onSubmit={addStaffAccount}>
                <input
                  value={staffDraft.name}
                  onChange={(event) => setStaffDraft({ ...staffDraft, name: event.target.value })}
                  placeholder="Staff name"
                />
                <select
                  value={staffDraft.role}
                  onChange={(event) => setStaffDraft({ ...staffDraft, role: event.target.value as StaffRole })}
                >
                  <option value="Floor">Floor</option>
                  <option value="Manager">Manager</option>
                  <option value="Owner">Owner</option>
                </select>
                <input
                  value={staffDraft.pin}
                  onChange={(event) => setStaffDraft({ ...staffDraft, pin: event.target.value })}
                  placeholder="PIN"
                  type="password"
                  inputMode="numeric"
                />
                <button className="secondary-button" type="submit">
                  Add Staff
                </button>
              </form>
              {state.settings.staffAccounts.length ? (
                <div className="staff-account-list">
                  {state.settings.staffAccounts.map((staff) => (
                    <article className={staff.active ? 'staff-account-row' : 'staff-account-row inactive'} key={staff.id}>
                      <div>
                        <strong>{staff.name}</strong>
                        <span>{staff.role} {staff.lastSelectedAt ? `- last selected ${formatClock(staff.lastSelectedAt)}` : ''}</span>
                      </div>
                      {staff.active ? (
                        <button className="icon-button danger" onClick={() => deactivateStaffAccount(staff.id)} title="Deactivate staff account">
                          <X size={16} />
                        </button>
                      ) : (
                        <span>Inactive</span>
                      )}
                    </article>
                  ))}
                </div>
              ) : (
                <span className="muted-copy">No staff accounts yet.</span>
              )}
            </div>
          </section>

          <section className="panel settings-panel" id="settings-data">
            <PanelTitle icon={<Download />} title="Data Safety" />
            <div className="preference-list">
              <article className="preference-row">
                <div>
                  <strong>Backup room data</strong>
                  <span>Export a full local backup with tables, profiles, settings, account details, logs, and history.</span>
                </div>
                <button className="secondary-button" onClick={exportJson}>
                  <Download size={16} />
                  Export Backup
                </button>
              </article>
              <article className="preference-row">
                <div>
                  <strong>Restore from backup</strong>
                  <span>Import an Orbit backup file after confirming it should replace this installation's local state.</span>
                </div>
                <label className="secondary-button license-file-button">
                  <Upload size={16} />
                  Restore
                  <input
                    type="file"
                    accept="application/json,.json"
                    onChange={(event) => importBackupFile(event.target.files?.[0])}
                  />
                </label>
              </article>
              <article className="preference-row">
                <div>
                  <strong>Detailed pilot report</strong>
                  <span>Export account, operational, staff usage, feature frequency, recent events, and feedback analytics.</span>
                </div>
                <div className="inline-actions">
                  <button className="secondary-button" onClick={submitAnalyticalReport}>
                    <Upload size={16} />
                    Submit
                  </button>
                  <button className="secondary-button" onClick={exportPilotReport}>
                    <Download size={16} />
                    Export
                  </button>
                </div>
              </article>
              <article className="preference-row">
                <div>
                  <strong>Embedded backend</strong>
                  <span>
                    {backendStatus?.running
                      ? `Running on ${backendStatus.host}:${backendStatus.port} with ${backendStatus.reportCount} stored report${backendStatus.reportCount === 1 ? '' : 's'}`
                      : 'Starting with the desktop app'}
                  </span>
                </div>
                <button
                  className="secondary-button"
                  onClick={() => window.tableManagerDesktop?.getBackendStatus().then((status) => setBackendStatus(status))}
                >
                  Refresh
                </button>
              </article>
              <article className="preference-row">
                <div>
                  <strong>Save status</strong>
                  <span>{saveStatus.message}</span>
                </div>
                <span className={`save-status ${saveStatus.state}`}>{saveStatus.state}</span>
              </article>
              {backupMessage ? <p className={backupMessage.includes('Backup') ? 'success-copy' : 'access-error'}>{backupMessage}</p> : null}
              {reportMessage ? <p className={reportMessage.includes('failed') ? 'access-error' : 'success-copy'}>{reportMessage}</p> : null}
            </div>
          </section>

          <section className="panel settings-panel" id="settings-tables">
            <PanelTitle icon={<Settings />} title="Table Defaults" />
            <div className="preference-list">
              <article className="preference-row">
                <div>
                  <strong>New table fee model</strong>
                  <span>Choose whether newly created tables use drop collection or player time fees.</span>
                </div>
                <div className="segmented-control">
                  <button
                    className={state.settings.defaultCollectionMode === 'Drop' ? 'secondary-button active' : 'ghost-button'}
                    onClick={() => updateSettings({ defaultCollectionMode: 'Drop' })}
                  >
                    Drop
                  </button>
                  <button
                    className={state.settings.defaultCollectionMode === 'Time' ? 'secondary-button active' : 'ghost-button'}
                    onClick={() => updateSettings({ defaultCollectionMode: 'Time' })}
                  >
                    Time fees
                  </button>
                </div>
              </article>
              <article className="preference-row">
                <div>
                  <strong>Apply default to active tables</strong>
                  <span>Update every open table and seated player timer setting to the selected collection mode.</span>
                </div>
                <button className="secondary-button" onClick={applyDefaultCollectionToActiveTables}>
                  Apply
                </button>
              </article>
              <article className="preference-row">
                <div>
                  <strong>Table cap</strong>
                  <span>Use a standard table size for new and open tables. Caps are limited to 6, 8, or 10 seats.</span>
                </div>
                <div className="segmented-control">
                  {tableCaps.map((cap) => (
                    <button
                      key={cap}
                      className={state.settings.defaultTableCap === cap ? 'secondary-button active' : 'ghost-button'}
                      onClick={() => updateDefaultTableCap(cap)}
                    >
                      {cap}
                    </button>
                  ))}
                </div>
              </article>
              <article className="preference-row">
                <div>
                  <strong>Default hourly fee</strong>
                  <span>Used for time-fee games where players pay by the hour.</span>
                </div>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={state.settings.defaultHourlyFee}
                  onChange={(event) => updateSettings({ defaultHourlyFee: Number(event.target.value) })}
                />
              </article>
              <article className="preference-row">
                <div>
                  <strong>Default drop estimate</strong>
                  <span>Estimated money removed from drop tables per occupied seat-hour when no actual drop is logged.</span>
                </div>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={state.settings.defaultEstimatedDropPerSeatHour}
                  onChange={(event) => updateSettings({ defaultEstimatedDropPerSeatHour: Number(event.target.value) })}
                />
              </article>
              {state.games.map((game) => {
                const collectionProfile = getCollectionProfile(state, game.id);
                return (
                  <article className="preference-row collection-profile-row" key={game.id}>
                    <div>
                      <strong>{game.name} collection profile</strong>
                      <span>{collectionProfile.collectionMode === 'Time' ? 'Hourly fee model' : 'Money removed from table model'}</span>
                    </div>
                    <div className="segmented-control collection-profile-control">
                      <button
                        className={collectionProfile.collectionMode === 'Drop' ? 'secondary-button active' : 'ghost-button'}
                        onClick={() => updateCollectionProfile(game.id, { collectionMode: 'Drop' })}
                      >
                        Drop
                      </button>
                      <button
                        className={collectionProfile.collectionMode === 'Time' ? 'secondary-button active' : 'ghost-button'}
                        onClick={() => updateCollectionProfile(game.id, { collectionMode: 'Time' })}
                      >
                        Time
                      </button>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={collectionProfile.hourlyFee}
                        onChange={(event) => updateCollectionProfile(game.id, { hourlyFee: Number(event.target.value) })}
                        title="Hourly fee"
                      />
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={collectionProfile.estimatedDropPerSeatHour}
                        onChange={(event) => updateCollectionProfile(game.id, { estimatedDropPerSeatHour: Number(event.target.value) })}
                        title="Estimated drop per occupied seat-hour"
                      />
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="panel settings-panel" id="settings-display">
            <PanelTitle icon={<Moon />} title="Display" />
            <div className="preference-list">
              <article className="preference-row">
                <div>
                  <strong>Dark mode</strong>
                  <span>Use the lower-brightness theme for the floor, pop-outs, and summaries.</span>
                </div>
                <label className="switch-control">
                  <input
                    type="checkbox"
                    checked={state.settings.lowLight}
                    onChange={(event) => updateSettings({ lowLight: event.target.checked })}
                  />
                  <span>{state.settings.lowLight ? 'On' : 'Off'}</span>
                </label>
              </article>
              <article className="preference-row">
                <div>
                  <strong>Recent player shortcuts</strong>
                  <span>Show quick-fill buttons below Quick Add on the landing page.</span>
                </div>
                <label className="switch-control">
                  <input
                    type="checkbox"
                    checked={state.settings.showRecentPlayers}
                    onChange={(event) => updateSettings({ showRecentPlayers: event.target.checked })}
                  />
                  <span>{state.settings.showRecentPlayers ? 'Shown' : 'Hidden'}</span>
                </label>
              </article>
            </div>
          </section>

          <section className="panel settings-panel" id="settings-legal">
            <PanelTitle icon={<FileText />} title="Legal & Support" />
            <div className="preference-list">
              <article className="preference-row">
                <div><strong>Privacy Policy</strong><span>Read how Orbit collects, uses, discloses, and retains personal data.</span></div>
                <a className="secondary-button" href="https://orbitapp-one.vercel.app/privacy" target="_blank" rel="noreferrer">Read policy</a>
              </article>
              <article className="preference-row">
                <div><strong>Terms of Service</strong><span>Read the terms that govern Orbit websites, software, apps, events, APIs, and related services.</span></div>
                <a className="secondary-button" href="https://orbitapp-one.vercel.app/terms" target="_blank" rel="noreferrer">Read terms</a>
              </article>
              <article className="preference-row">
                <div><strong>Support</strong><span>Contact Orbit for account, installation, or operating assistance.</span></div>
                <a className="secondary-button" href="https://orbitapp-one.vercel.app/support" target="_blank" rel="noreferrer">Open support</a>
              </article>
            </div>
          </section>
        </section>
      </main>
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
        onOpenQrScanner={() => {
          setQrManualValue('');
          setQrScanMessage('Point the camera at an active Orbit membership QR code.');
          setQrScanAttempt((attempt) => attempt + 1);
          setPlayerPopup('scan');
        }}
        onRestartQrScanner={() => {
          qrScannerControlsRef.current?.stop();
          qrScannerControlsRef.current = null;
          setQrScanMessage('Restarting camera…');
          setQrScanAttempt((attempt) => attempt + 1);
        }}
        onSubmitQrManual={(event) => {
          event.preventDefault();
          qrScannerControlsRef.current?.stop();
          qrScannerControlsRef.current = null;
          handleMembershipQrCheckIn(qrManualValue);
        }}
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
    const analytics = reportAnalytics;
    const gamesStartedInPeriod = reportState.sessions.filter((session) => session.status !== 'Failed to Start').length;
    const totalTableHours = reportState.sessions.reduce((sum, session) => sum + hoursBetween(session.startedAt, session.endedAt), 0);
    const totalTrackedHands = reportState.handCountLogs.reduce((sum, entry) => sum + entry.hands, 0);
    const collectionPerTableHour = totalTableHours > 0 ? reportFinancials.totalProfit / totalTableHours : 0;
    const handsPerTableHour = totalTableHours > 0 ? totalTrackedHands / totalTableHours : 0;
    const dropPerSeatHour = analytics.currentNight.occupiedSeatHours > 0 ? reportFinancials.recordedDrop / analytics.currentNight.occupiedSeatHours : 0;
    const topEarningHour = reportHourlyBreakdown.reduce<(typeof reportHourlyBreakdown)[number] | null>(
      (best, item) => !best || item.total > best.total ? item : best,
      null
    );
    const hourLabel = (startMs: number) => {
      const start = new Date(startMs);
      const end = new Date(startMs + 36e5);
      const showDate = reportPeriod !== 'day';
      return `${showDate ? `${start.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ` : ''}${start.toLocaleTimeString([], { hour: 'numeric' })}–${end.toLocaleTimeString([], { hour: 'numeric' })}`;
    };
    return withShell('reports', (
      <main className={`app-shell compact-shell reports-page reports-mode-${reportMode} reports-kpi-${kpiCategory}`}>
        <header className="topbar">
          <div>
            <h1>Reports</h1>
            <p className="page-subtitle">{reportWindow.label} performance and closeout</p>
          </div>
          <div className="topbar-actions">
            <button className="ghost-button" onClick={exportCsv}>
              <Download size={18} />
              CSV
            </button>
            <button className="ghost-button" onClick={() => window.print()}>
              <Download size={18} />
              Screenshot / Print
            </button>
            <button className="ghost-button" onClick={closeRoute}>
              <X size={18} />
              Close
            </button>
            <button
              className="ghost-button"
              onClick={() => persist({ ...state, settings: { ...state.settings, lowLight: !state.settings.lowLight } })}
            >
              {state.settings.lowLight ? 'Day Mode' : 'Low Light'}
            </button>
          </div>
        </header>

        <nav className="report-mode-switch" aria-label="Report view">
          <button className={reportMode === 'kpis' ? 'active' : ''} onClick={() => setReportMode('kpis')}>KPIs & statistics</button>
          <button className={reportMode === 'night' ? 'active' : ''} onClick={() => setReportMode('night')}>Tonight's report</button>
          <button className={reportMode === 'close' ? 'active' : ''} onClick={() => setReportMode('close')}>Night close</button>
        </nav>
        <section className="report-period-toolbar" aria-label="Report date range">
          <nav className="report-period-tabs" aria-label="Group reports by">
            {([
              ['day', 'Tonight'],
              ['week', 'Week'],
              ['month', 'Month'],
              ['year', 'Year'],
              ['all', 'All time']
            ] as [ReportPeriod, string][]).map(([period, label]) => (
              <button
                key={period}
                className={reportPeriod === period ? 'active' : ''}
                onClick={() => setReportPeriod(period)}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="report-period-navigation">
            <button
              className="ghost-button"
              disabled={reportPeriod === 'all'}
              onClick={() => setReportAnchorDate((current) => shiftReportAnchor(current, reportPeriod, -1))}
            >
              Previous
            </button>
            <strong>{reportWindow.label}</strong>
            <button
              className="ghost-button"
              disabled={reportIsCurrentPeriod}
              onClick={() => setReportAnchorDate((current) => shiftReportAnchor(current, reportPeriod, 1))}
            >
              Next
            </button>
            <button className="ghost-button" onClick={() => setReportAnchorDate(toLocalDateValue(new Date()))}>Today</button>
          </div>
        </section>

        <section className="report-profit-banner" aria-live="polite">
          <div className="report-profit-total">
            <span>Total profit · {reportWindow.label}</span>
            <strong>${reportFinancials.totalProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
            <small>Recorded drop, time fees, memberships, and tournament payments before expenses</small>
          </div>
          <div className="report-profit-breakdown">
            <article>
              <span>Recorded drop</span>
              <strong>${reportFinancials.recordedDrop.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
            </article>
            <article>
              <span>Time fees</span>
              <strong>${reportFinancials.timeFees.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
            </article>
            <article>
              <span>Memberships</span>
              <strong>${reportFinancials.membershipRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
            </article>
            <article>
              <span>Tournaments</span>
              <strong>${reportFinancials.tournamentRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
            </article>
          </div>
        </section>
        <section className="report-numerical-grid" aria-label="Detailed report numbers">
          <article><span>Collection / table-hour</span><strong>${collectionPerTableHour.toFixed(2)}</strong></article>
          <article><span>Drop / occupied seat-hour</span><strong>${dropPerSeatHour.toFixed(2)}</strong></article>
          <article><span>Hands logged</span><strong>{totalTrackedHands.toLocaleString()}</strong></article>
          <article><span>Hands / table-hour</span><strong>{handsPerTableHour.toFixed(1)}</strong></article>
          <article><span>Table-hours</span><strong>{totalTableHours.toFixed(1)}</strong></article>
          <article><span>Best earning hour</span><strong>{topEarningHour ? `$${topEarningHour.total.toFixed(0)}` : '$0'}</strong><small>{topEarningHour ? hourLabel(topEarningHour.startMs) : 'No collections logged'}</small></article>
        </section>
        {reportMode === 'kpis' ? <nav className="metric-category-menu" aria-label="Metric categories"><button className={kpiCategory === 'operations' ? 'active' : ''} onClick={() => setKpiCategory('operations')}>Operations</button><button className={kpiCategory === 'waitlist' ? 'active' : ''} onClick={() => setKpiCategory('waitlist')}>Waitlist</button><button className={kpiCategory === 'tables' ? 'active' : ''} onClick={() => setKpiCategory('tables')}>Tables</button><button className={kpiCategory === 'collections' ? 'active' : ''} onClick={() => setKpiCategory('collections')}>Collections</button></nav> : null}

        {reportMode === 'close' ? <section className="night-close-workspace">
          <header className="night-close-header">
            <div>
              <span className={`night-close-status status-${(currentNightClose?.status ?? 'Draft').toLowerCase().replace(/\s+/g, '-')}`}>{currentNightClose?.status ?? 'Draft'}</span>
              <h2>Reconcile {todayDate()}</h2>
              <p>Count each table, review exceptions, then complete staff and manager sign-off.</p>
            </div>
            <div className="night-close-header-actions">
              <button className="ghost-button" onClick={() => window.print()}><Download size={17} /> Print / PDF</button>
              {currentNightClose?.status === 'Locked' ? <button className="ghost-button danger" onClick={reopenNightClose}>Reopen with audit</button> : null}
            </div>
          </header>

          <div className="night-close-totals">
            <article><span>Total buy-ins</span><strong>${nightCloseTotals.buyIns.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></article>
            <article><span>Cash-outs</span><strong>${nightCloseTotals.cashOuts.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></article>
            <article><span>Drop + time</span><strong>${nightCloseTotals.removed.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></article>
            <article><span>Expected cash</span><strong>${nightCloseTotals.expected.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></article>
            <article><span>Actual cash</span><strong>${nightCloseTotals.actual.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></article>
            <article className={nightCloseHasMissingActual ? 'pending' : Math.abs(nightCloseTotals.discrepancy) < .01 ? 'balanced' : 'unbalanced'}><span>Over / short</span><strong>{nightCloseHasMissingActual ? 'Pending' : `${nightCloseTotals.discrepancy >= 0 ? '+' : '-'}$${Math.abs(nightCloseTotals.discrepancy).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}</strong></article>
          </div>

          <section className="night-close-profit-panel" aria-label="Tonight's total profits">
            <div className="night-close-profit-tab">Total profits</div>
            <div className="night-close-profit-total">
              <span>Tonight's total</span>
              <strong>${nightCloseTotalProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
              <small>Recorded drop + time fees + membership fees</small>
            </div>
            <div className="night-close-profit-breakdown">
              <article>
                <span>Recorded drop</span>
                <strong>${nightCloseFinancials.recordedDrop.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
              </article>
              <article>
                <span>Time fees</span>
                <strong>${nightCloseFinancials.timeFees.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
              </article>
              <article>
                <span>Membership fees</span>
                <strong>${nightCloseFinancials.membershipRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
              </article>
            </div>
          </section>

          <section className="night-close-table-panel">
            <div className="night-close-section-title"><div><h3>Table reconciliation</h3><span>{nightCloseTables.length} tables in this shift</span></div><code>Buy-ins + time − cash-outs = expected; drop is reflected in cash-outs</code></div>
            <div className="night-close-table-head"><span>Table</span><span>Buy-ins</span><span>Cash-outs</span><span>Drop / time</span><span>Expected</span><span>Actual count</span><span>Over / short</span></div>
            <div className="night-close-table-list">
              {nightCloseTables.map((table) => <article className="night-close-table-row" key={table.tableId}>
                <div><strong>{table.tableLabel}</strong><span>{table.gameName}</span></div>
                <strong>${table.buyIns.toLocaleString()}</strong>
                <strong>${table.cashOuts.toLocaleString()}</strong>
                <strong>−${table.drop.toLocaleString(undefined, { maximumFractionDigits: 2 })} / +${table.timeFees.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
                <strong>${table.expectedCash.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
                <label><span>Actual cash</span><input type="number" min="0" step=".01" disabled={Boolean(currentNightClose && currentNightClose.status !== 'Draft')} value={effectiveNightCloseActuals[table.tableId] ?? ''} onChange={(event) => setNightCloseActuals((actuals) => ({ ...actuals, [table.tableId]: event.target.value }))} placeholder="$0.00" /></label>
                <strong className={(table.discrepancy ?? 0) === 0 ? 'balanced' : 'unbalanced'}>{table.discrepancy === undefined ? 'Not recorded' : `${table.discrepancy >= 0 ? '+' : '-'}$${Math.abs(table.discrepancy).toFixed(2)}`}</strong>
                {table.warnings.length ? <div className="night-close-row-warnings">{table.warnings.map((warning) => <span key={warning}>{warning}</span>)}</div> : <div className="night-close-row-clear">Reconciled inputs complete</div>}
              </article>)}
              {!nightCloseTables.length ? <div className="night-close-empty"><strong>No current-shift tables</strong><span>Open or operate a table before starting night close.</span></div> : null}
            </div>
          </section>

          <div className="night-close-lower-grid">
            <section className="night-close-exceptions">
              <div className="night-close-section-title"><div><h3>Exceptions</h3><span>{nightCloseWarnings.length} items need review</span></div></div>
              {nightCloseWarnings.length ? <div>{nightCloseWarnings.map((warning) => <span key={warning}>{warning}</span>)}</div> : <p>All tables have complete reconciliation inputs.</p>}
            </section>
            <section className="night-close-signoff">
              <div className="night-close-section-title"><div><h3>Approval</h3><span>Every action is retained in the audit log</span></div></div>
              <div className="night-close-operator">
                <label htmlFor="night-close-staff">Staff member using this station</label>
                {state.settings.staffAccounts.some((staff) => staff.active) ? (
                  <>
                    <select
                      id="night-close-staff"
                      value={state.settings.staffAccounts.some((staff) => staff.active && staff.id === state.settings.activeStaffId) ? state.settings.activeStaffId : ''}
                      onChange={(event) => selectActiveStaff(event.target.value)}
                      disabled={currentNightClose?.status === 'Locked'}
                    >
                      <option value="">Select a staff member</option>
                      {state.settings.staffAccounts.filter((staff) => staff.active).map((staff) => (
                        <option key={staff.id} value={staff.id}>{staff.name} - {staff.role}</option>
                      ))}
                    </select>
                    <small>
                      Select the staff signer first. After staff sign-off, select a Manager or Owner here to approve and lock.
                    </small>
                  </>
                ) : (
                  <div className="night-close-no-staff">
                    <span>No active staff accounts are available.</span>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => {
                        setSettingsSection('staff');
                        openRoute('customization');
                      }}
                    >
                      Add staff in Settings
                    </button>
                  </div>
                )}
              </div>
              <textarea value={nightCloseNotes || currentNightClose?.notes || ''} onChange={(event) => setNightCloseNotes(event.target.value)} disabled={Boolean(currentNightClose && currentNightClose.status !== 'Draft')} placeholder="Close notes, discrepancy explanation, cage count, or manager comments" />
              <div className="night-close-signatures">
                <article className={currentNightClose?.staffSignOff ? 'complete' : ''}><span>Staff sign-off</span><strong>{currentNightClose?.staffSignOff?.staffName ?? 'Pending'}</strong><small>{currentNightClose?.staffSignOff ? formatClock(currentNightClose.staffSignOff.timestamp) : 'Actual counts required'}</small></article>
                <article className={currentNightClose?.managerSignOff ? 'complete' : ''}><span>Manager approval</span><strong>{currentNightClose?.managerSignOff?.staffName ?? 'Pending'}</strong><small>{currentNightClose?.managerSignOff ? formatClock(currentNightClose.managerSignOff.timestamp) : 'Manager or Owner required'}</small></article>
              </div>
              {currentNightClose?.status !== 'Locked' ? <div className="night-close-actions">
                {!currentNightClose || currentNightClose.status === 'Draft' ? <><button className="ghost-button" onClick={() => saveNightClose()}>Save draft</button><button className="secondary-button" onClick={signNightClose}>Staff sign-off</button></> : null}
                <button className="primary-button" onClick={approveAndLockNightClose}>Approve & lock night</button>
              </div> : <div className="night-close-locked"><LockKeyhole size={17} /> Locked {currentNightClose.lockedAt ? new Date(currentNightClose.lockedAt).toLocaleString() : ''}</div>}
            </section>
          </div>

          {currentNightClose?.audit.length ? <section className="night-close-audit">
            <div className="night-close-section-title"><div><h3>Audit trail</h3><span>{currentNightClose.audit.length} recorded actions</span></div></div>
            <div>{[...currentNightClose.audit].reverse().map((entry) => <article key={entry.id}><time>{new Date(entry.timestamp).toLocaleString()}</time><strong>{entry.action}</strong><span>{entry.staffName}{entry.staffRole ? ` · ${entry.staffRole}` : ''}</span><em>{entry.note ?? ''}</em></article>)}</div>
          </section> : null}
        </section> : null}

        <section className="owner-summary-grid">
          <article className="panel owner-metric">
            <span>Occupied Seat-Hours</span>
            <strong>{analytics.currentNight.occupiedSeatHours.toFixed(1)}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Avg Wait</span>
            <strong>{analytics.averageWaitMinutes.toFixed(0)}m</strong>
          </article>
          <article className="panel owner-metric">
            <span>Conversion</span>
            <strong>{(analytics.conversionRate * 100).toFixed(0)}%</strong>
          </article>
          <article className="panel owner-metric">
            <span>Games Started</span>
            <strong>{gamesStartedInPeriod}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Failed Starts</span>
            <strong>{analytics.failedStarts}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Table Breaks</span>
            <strong>{analytics.tableBreaks}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Median Wait</span>
            <strong>{analytics.medianWaitMinutes.toFixed(0)}m</strong>
          </article>
          <article className="panel owner-metric">
            <span>No-Shows</span>
            <strong>{analytics.noShows}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Left Wait</span>
            <strong>{analytics.leftBeforeSeated}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Confirmed Arrived</span>
            <strong>{(analytics.confirmedArrivalRate * 100).toFixed(0)}%</strong>
          </article>
          <article className="panel owner-metric">
            <span>Abandonment</span>
            <strong>{analytics.waitlistAbandonmentCount}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Lost Seat-Hours</span>
            <strong>{analytics.lostSeatHourEstimate.toFixed(1)}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Second Tables</span>
            <strong>{analytics.secondTablesStarted}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Peak Wait</span>
            <strong>{analytics.peakWaitlistPressure}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Arrivals</span>
            <strong>{analytics.totalArrivals}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Time Fees</span>
            <strong>${reportFinancials.timeFees.toFixed(0)}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Expired Time</span>
            <strong>{analytics.expiredTimeFeeSeats}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Recorded Drop</span>
            <strong>${reportFinancials.recordedDrop.toFixed(0)}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Drop Est.</span>
            <strong>${analytics.estimatedDropRevenue.toFixed(0)}</strong>
          </article>
        </section>

        <section className="panel summary-report">
          <PanelTitle icon={<Target />} title={`What Happened · ${reportWindow.label}`} />
          <p>
            The room generated {analytics.currentNight.occupiedSeatHours.toFixed(1)} occupied seat-hours across {gamesStartedInPeriod} tables.
            Average wait is {analytics.averageWaitMinutes.toFixed(0)} minutes, with {(analytics.conversionRate * 100).toFixed(0)}% waitlist conversion.
          </p>
          <p>
            Peak demand is {analytics.peakInterestedByGame ? `${analytics.peakInterestedByGame.game} with ${analytics.peakInterestedByGame.count} interested/in-room players` : 'not available yet'}.
            Failed starts: {analytics.failedStarts}. Table breaks: {analytics.tableBreaks}.
          </p>
          <div className="report-analysis-grid">
            <section className="report-analysis-card">
              <div className="report-analysis-heading">
                <div>
                  <span>Collections by time</span>
                  <h3>Money made each hour</h3>
                </div>
                <strong>{topEarningHour ? `${hourLabel(topEarningHour.startMs)} was highest` : 'Waiting for collection data'}</strong>
              </div>
              <div className="report-hour-list">
                {reportHourlyBreakdown.length ? reportHourlyBreakdown.map((item) => (
                  <article className={item.startMs === topEarningHour?.startMs ? 'top-hour' : ''} key={item.startMs}>
                    <time>{hourLabel(item.startMs)}</time>
                    <div><span>Drop</span><strong>${item.drop.toFixed(2)}</strong></div>
                    <div><span>Time</span><strong>${item.timeFees.toFixed(2)}</strong></div>
                    <div><span>Members/events</span><strong>${item.otherRevenue.toFixed(2)}</strong></div>
                    <div className="hour-total"><span>Total</span><strong>${item.total.toFixed(2)}</strong></div>
                  </article>
                )) : <p className="muted-copy">No drop or time-fee payments were recorded in this period.</p>}
              </div>
            </section>
            <section className="report-analysis-card">
              <div className="report-analysis-heading">
                <div>
                  <span>Dealer performance</span>
                  <h3>Who dealt each table</h3>
                </div>
              </div>
              <div className="report-dealer-list">
                {reportDealerBreakdown.length ? reportDealerBreakdown.map((dealer) => (
                  <article key={dealer.dealerName}>
                    <div><strong>{dealer.dealerName}</strong><span>{dealer.tables} table{dealer.tables === 1 ? '' : 's'} · {dealer.hours.toFixed(1)}h</span></div>
                    <div><span>Hands</span><strong>{dealer.hands}</strong></div>
                    <div><span>Hands/hr</span><strong>{dealer.handsPerHour.toFixed(1)}</strong></div>
                  </article>
                )) : <p className="muted-copy">No dealer downs tracked yet. Assign dealers from each table's Table admin section.</p>}
              </div>
            </section>
          </div>
          <div className="summary-breakdown">
            <div>
              <h3>Seat-Hours by Game</h3>
              {analytics.seatHoursByGame.map((item: { game: any; hours: number; }) => (
                <span key={item.game}>{item.game}: {item.hours.toFixed(1)}</span>
              ))}
            </div>
            <div>
              <h3>Seat-Hours by Table</h3>
              {analytics.seatHoursByTable.slice(0, 6).map((item: { table: any; game: any; hours: number; }) => (
                <span key={`${item.table}-${item.game}`}>{item.table} ({item.game}): {item.hours.toFixed(1)}</span>
              ))}
            </div>
            <div>
              <h3>Wait by Game</h3>
              {analytics.waitByGame.map((item: { game: any; count: any; averageMinutes: number; }) => (
                <span key={item.game}>{item.game}: {item.count ? `${item.averageMinutes.toFixed(0)}m avg` : 'No seated waits'}</span>
              ))}
            </div>
            <div>
              <h3>Collection Value by Game</h3>
              {reportFinancials.collectionByGame.map((item) => (
                <span key={item.game}>
                  {item.game}: ${item.timeFees.toFixed(0)} time / ${item.recordedDrop.toFixed(0)} actual drop / ${(analytics.collectionValueByGame.find((estimate) => estimate.game === item.game)?.estimatedDrop ?? 0).toFixed(0)} est. drop
                </span>
              ))}
            </div>
            <div>
              <h3>Event Reasons</h3>
              {reportState.tableEvents.filter((event: { type: string; }) => event.type === 'Failed to Start' || event.type === 'Broke').slice(-6).map((event: TableEvent) => (
                <span key={event.id}>{event.type}: {event.reason || 'Unspecified'}{event.note ? ` - ${event.note}` : ''}</span>
              ))}
              {!reportState.tableEvents.some((event: { type: string; }) => event.type === 'Failed to Start' || event.type === 'Broke') ? <span>No failed starts or breaks logged.</span> : null}
            </div>
          </div>
          <div className="summary-breakdown">
            <div>
              <h3>Last 5 Nights</h3>
              {state.history.slice(-5).reverse().map((night: { id: any; date: any; occupiedSeatHours: number; gamesStarted: any; waitlistConversionRate: number; averageActiveTables: number; }) => (
                <span key={night.id}>
                  {night.date}: {night.occupiedSeatHours.toFixed(1)} seat-hours / {night.gamesStarted} starts / {(night.waitlistConversionRate * 100).toFixed(0)}% conversion / {night.averageActiveTables.toFixed(1)} avg tables
                </span>
              ))}
              {!state.history.length ? <span>No archived nights yet.</span> : null}
            </div>
            <div>
              <h3>Operational Opportunities</h3>
              {reportOpportunities.map((item: any) => (
                <span key={item}>{item}</span>
              ))}
            </div>
            <div>
              <h3>Correction Log</h3>
              {state.correctionLog.slice(0, 8).map((entry: { id: any; timestamp: string | undefined; entity: any; field: any; }) => (
                <span key={entry.id}>{formatClock(entry.timestamp)} - {entry.entity}: {entry.field}</span>
              ))}
              {!state.correctionLog.length ? <span>No corrections logged.</span> : null}
            </div>
          </div>
          <div className="summary-breakdown">
            <div>
              <h3>Feature Usage</h3>
              {usageAnalytics.eventsByFeature.slice(0, 8).map((entry) => (
                <span key={entry.feature}>{entry.feature}: {entry.count} uses{entry.lastUsedAt ? ` / last ${formatClock(entry.lastUsedAt)}` : ''}</span>
              ))}
              {!usageAnalytics.eventsByFeature.length ? <span>No usage events recorded yet.</span> : null}
            </div>
            <div>
              <h3>Action Frequency</h3>
              {usageAnalytics.eventsByAction.slice(0, 8).map((entry) => (
                <span key={entry.key}>{entry.action}: {entry.count}</span>
              ))}
              {!usageAnalytics.eventsByAction.length ? <span>No tracked actions yet.</span> : null}
            </div>
            <div>
              <h3>Staff Activity</h3>
              {usageAnalytics.eventsByStaff.slice(0, 8).map((entry) => (
                <span key={entry.key}>{entry.staffName}{entry.staffRole ? ` (${entry.staffRole})` : ''}: {entry.count}</span>
              ))}
              {!usageAnalytics.eventsByStaff.length ? <span>No staff usage recorded yet.</span> : null}
            </div>
          </div>
          <textarea
            className="summary-notes"
            value={summaryNotes}
            onChange={(event: { target: { value: any; }; }) => setSummaryNotes(event.target.value)}
            placeholder="Owner-facing notes"
          />
          <button className="primary-button" onClick={() => setReportMode('close')}>
            <Save size={18} />
            Reconcile & Close Night
          </button>
        </section>
      </main>
    ));
  }

  if (route === 'kpis') {
    return withShell('reports', (
      <main className="app-shell compact-shell">
        <header className="topbar">
          <div>
            <div className="eyebrow">Operating metrics</div>
            <h1>KPIs</h1>
          </div>
          <div className="topbar-actions">
            <button className="ghost-button" onClick={exportCsv}>
              <Download size={18} />
              CSV
            </button>
            <button className="ghost-button" onClick={closeRoute}>
              <X size={18} />
              Close
            </button>
          </div>
        </header>

        <section className="owner-summary-grid">
          <article className="panel owner-metric">
            <span>Seat-Hours</span>
            <strong>{analytics.currentNight.occupiedSeatHours.toFixed(1)}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Active Tables</span>
            <strong>{analytics.activeTables}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Average Wait</span>
            <strong>{analytics.averageWaitMinutes.toFixed(0)}m</strong>
          </article>
          <article className="panel owner-metric">
            <span>Conversion</span>
            <strong>{(analytics.conversionRate * 100).toFixed(0)}%</strong>
          </article>
          <article className="panel owner-metric">
            <span>Failed Starts</span>
            <strong>{analytics.failedStarts}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Table Breaks</span>
            <strong>{analytics.tableBreaks}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Time Fees Est.</span>
            <strong>${analytics.estimatedTimeFeeRevenue.toFixed(0)}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Recorded Drop</span>
            <strong>${analytics.recordedDropTotal.toFixed(0)}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Drop Est.</span>
            <strong>${analytics.estimatedDropRevenue.toFixed(0)}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Expired Time</span>
            <strong>{analytics.expiredTimeFeeSeats}</strong>
          </article>
        </section>
      </main>
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

    return (
      <main className="table-view-shell">
        <header className="table-view-topbar">
          <button className="icon-button" onClick={closeRoute} title="Back to floor">
            <X size={18} />
          </button>
          <div>
            <span>{tableGame?.name ?? 'Table View'}</span>
            <h1>{tableSession?.label ?? 'No Open Table'}</h1>
          </div>
          {tableSession ? (
            <div className="table-view-stats">
              <span>{tableSession.status}</span>
              <strong>{seatedPlayers.length}/{tableSession.maxSeats}</strong>
              <em>Avg ${tableAverageStack.toLocaleString()}</em>
              <em>{isTimeCollection ? 'Time' : 'Drop'}</em>
              <button className="ghost-button" onClick={() => setTableLedgerSessionId(tableSession.id)}><WalletCards size={17} /> Ledger</button>
            </div>
          ) : null}
        </header>
        {seatPickerModal}
        {cashOutModal}
        {tableLedgerModal}
        {tableSession ? <button className="table-live-feed-overlay" onClick={() => setTableEventLogSessionId(tableSession.id)}>
          <span className="table-live-feed-title"><i /> Live feed <em>View full log →</em></span>
          <span className="table-live-feed-items">
            {tableActivity.length ? tableActivity.slice(0, 3).map((entry) => <span key={entry.id}><i className={entry.type.toLowerCase().replace(/\s+/g, '-')} /><span><strong>{entry.type}</strong>{entry.text}</span><time>{formatClock(entry.timestamp)}</time></span>) : <small>Awaiting table activity…</small>}
          </span>
        </button> : null}
        {tableSession ? <button className="table-buyin-float" onClick={() => setTableLedgerSessionId(tableSession.id)}>
          <span className="table-buyin-float-title"><WalletCards size={12} /> Buy-in ledger</span>
          <span className="table-buyin-float-rows">
            {tableBuyInRows.length ? tableBuyInRows.map(({ entry, seatNumber }) => <span key={entry.id}><i>S{seatNumber ?? '-'}</i><span>{entry.playerName}<small>{formatClock(entry.timestamp)}</small></span><em>Buy-in</em><strong>+${entry.amount.toLocaleString()}</strong></span>) : <small>No buy-ins recorded</small>}
          </span>
          <span className="table-buyin-float-total"><span>Total buy-ins</span><strong>${tableBuyInRows.reduce((sum, row) => sum + row.entry.amount, 0).toLocaleString()}</strong></span>
        </button> : null}
        {tableSession && tableEventLogSessionId === tableSession.id ? <div className="modal-backdrop table-event-log-backdrop" role="dialog" aria-modal="true" aria-label={`${tableSession.label} event log`}>
          <section className="table-event-log-modal">
            <div className="table-event-log-head"><div><span>Table event log</span><h2>{tableSession.label}</h2></div><button className="icon-button" onClick={() => setTableEventLogSessionId(null)}><X size={18} /></button></div>
            <div className="table-event-log-list">{tableActivity.length ? tableActivity.map((entry) => <article key={entry.id}><i className={entry.type.toLowerCase().replace(/\s+/g, '-')} /><div><strong>{entry.type}</strong><span>{entry.text}</span></div><time>{formatClock(entry.timestamp)}</time></article>) : <p className="muted-copy">No table activity recorded yet.</p>}</div>
          </section>
        </div> : null}

        {tableSession ? (
          <section className="table-view-grid">
            <section className="table-view-stage">
              <div className="table-view-stage-head">
                <p>Click any open seat and choose a player from the club database.</p>
                <button
                  className="ghost-button"
                  onClick={() => {
                    openSeatPicker(tableSession);
                  }}
                >
                  Next seat
                </button>
              </div>
              <div className="table-view-table">
                <div className="table-view-poker-table">
                  <PokerTable
                    players={pokerTablePlayers}
                    showTimeRemaining={isTimeCollection}
                    maxPlayers={tableSession.maxSeats}
                    selectedSeatNumber={seatPicker?.sessionId === tableSession.id ? seatPicker.seatNumber : undefined}
                    moveTargets={getMoveTargets(tableSession.id)}
                    onSeatClick={(seatNumber) =>
                      openSeatPicker(tableSession, seatNumber)
                    }
                    onAddTime={(playerId, minutes) => {
                      const playerSession = seatedPlayers.find((player) => player.id === playerId);
                      if (playerSession) addPlayerTime(playerSession, minutes);
                    }}
                    onAddBuyIn={(playerId, amount, note) => {
                      const playerSession = seatedPlayers.find((player) => player.id === playerId);
                      if (playerSession) addBuyIn(playerSession, amount, note);
                    }}
                    onRemovePlayer={(playerId) => {
                      const playerSession = seatedPlayers.find((player) => player.id === playerId);
                      if (playerSession) requestPlayerCashOut(playerSession);
                    }}
                    onChangeSeat={(playerId, seatNumber) => {
                      const playerSession = seatedPlayers.find((player) => player.id === playerId);
                      if (playerSession) changePlayerSeat(playerSession, seatNumber);
                    }}
                    onMovePlayer={(playerId, targetTableId) => {
                      const playerSession = seatedPlayers.find((player) => player.id === playerId);
                      if (playerSession) movePlayerToTable(playerSession, targetTableId);
                    }}
                  />
                </div>
              </div>
            </section>

            <aside className="table-view-time-overview" aria-label="Table time overview">
              <div className="table-view-panel-title">
                <span><Clock size={13} /> Time overview</span>
                <strong>{tableTimePlayers.filter((item) => item.hasTimer).length}</strong>
              </div>
              <div className="table-view-time-list">
                {tableTimePlayers.length ? (
                  tableTimePlayers.map(({ playerSession, remainingSeconds, hasTimer }) => {
                    const timeStatus = hasTimer ? getTimerStatusFromSeconds(remainingSeconds) : 'off';
                    return <article key={playerSession.id}>
                      <div>
                        <span>Seat {playerSession.seatNumber ?? '-'}</span>
                        <strong>{playerSession.playerName}</strong>
                      </div>
                      <em className={`time-left-pill ${timeStatus}`}>{hasTimer ? formatTimeLeft(remainingSeconds) : 'No timer'}</em>
                    </article>;
                  })
                ) : (
                  <p className="muted-copy">No players are seated at this table.</p>
                )}
              </div>
            </aside>
          </section>
        ) : (
          <section className="table-view-empty">
            <h2>No open tables</h2>
            <p>Create or run a table from the floor to use Table View.</p>
            <button className="ghost-button" onClick={closeRoute}>Back to floor</button>
          </section>
        )}
      </main>
    );
  }

  return withShell('floor', (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Floor</h1>
          <p className="page-subtitle">Live room operations</p>
        </div>
        <div className="topbar-actions">
          <button className="waitlist-icon-trigger" onClick={() => setWaitlistPopupOpen(true)} title="Open waitlist" aria-label={`Open waitlist, ${state.interests.filter((interest) => activeInterestStatuses.includes(interest.status)).length} waiting`}>
            <Users size={19} />
            {state.interests.filter((interest) => activeInterestStatuses.includes(interest.status)).length ? <span>{state.interests.filter((interest) => activeInterestStatuses.includes(interest.status)).length}</span> : null}
          </button>
          <button className="primary-button" onClick={() => setOpenPanels((panels) => ({ ...panels, quickAdd: true }))}><Plus size={18} /> Add player</button>
        </div>
      </header>
      {seatPickerModal}
      {cashOutModal}
      {tableLedgerModal}

      <Dialog.Root open={waitlistPopupOpen} onOpenChange={setWaitlistPopupOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="waitlist-popup-overlay" />
          <Dialog.Content className="waitlist-popup-content">
            <div className="waitlist-popup-header">
              <div><Dialog.Title>Waitlist</Dialog.Title><Dialog.Description>{state.interests.filter((interest) => activeInterestStatuses.includes(interest.status)).length} players need attention</Dialog.Description></div>
              <Dialog.Close asChild><button className="icon-button" aria-label="Close waitlist"><X size={18} /></button></Dialog.Close>
            </div>
            <div className="waitlist-popup-list">
              {state.interests.filter((interest) => activeInterestStatuses.includes(interest.status)).length ? state.interests
                .filter((interest) => activeInterestStatuses.includes(interest.status))
                .sort((left, right) => left.interestedAt.localeCompare(right.interestedAt))
                .map((interest) => {
                  const game = state.games.find((item) => item.id === interest.gameId);
                  const openTables = state.sessions.filter(
                    (session) =>
                      session.gameId === interest.gameId &&
                      session.status !== 'Closed' &&
                      session.status !== 'Failed to Start' &&
                      getAvailableSeatNumber(session) !== undefined
                  );
                  return <article className="waitlist-popup-row" key={interest.id}>
                    <div>
                      <strong>{interest.playerName}</strong>
                      <span>{game?.name ?? 'Unknown game'} · {interest.status === 'Confirmed Coming' ? 'Coming' : interest.status === 'Arrived' ? 'Here' : interest.status}</span>
                      {interest.expectedArrivalTime ? <span>Expected at {interest.expectedArrivalTime}</span> : null}
                      {interest.availabilityStartTime ? <span>Available {interest.availabilityStartTime}{interest.availabilityEndTime ? `–${interest.availabilityEndTime}` : ''}</span> : null}
                    </div>
                    <em className="waitlist-popup-age">{minutesSince(interest.interestedAt)}m</em>
                    <div className="waitlist-popup-actions">
                      {interest.status === 'Arrived' ? (
                        openTables.length ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button className="secondary-button waitlist-seat-button" type="button">Seat at table</button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="waitlist-action-menu">
                              {openTables.map((session) => (
                                <DropdownMenuItem
                                  key={session.id}
                                  onSelect={() => {
                                    seatInterestAtTable(interest, session.id);
                                    setWaitlistPopupOpen(false);
                                  }}
                                >
                                  {session.label} · {session.maxSeats - getActivePlayerSessionsForTable(state, session.id).length} open
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : <span className="waitlist-no-table">No open table</span>
                      ) : (
                        <button className="secondary-button waitlist-arrive-button" onClick={() => updateInterest(interest.id, { status: 'Arrived' })}>
                          Mark arrived
                        </button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><button className="icon-button" aria-label={`Actions for ${interest.playerName}`}><MoreHorizontal size={17} /></button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="waitlist-action-menu"><DropdownMenuItem onSelect={() => deleteInterest(interest.id)}>Remove from waitlist</DropdownMenuItem></DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </article>;
                }) : <div className="waitlist-popup-empty"><strong>No one is waiting</strong><span>New interest will appear here.</span></div>}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <section className="floor-summary-bar" aria-label="Floor summary">
        <span><strong>{state.sessions.filter((session) => session.status === 'Running').length}</strong> running</span>
        <span><strong>{state.playerSessions.filter((session) => !session.leftAt).length}</strong> seated</span>
        <span><strong>{state.interests.filter((interest) => activeInterestStatuses.includes(interest.status)).length}</strong> waiting</span>
        <span className={analytics.expiredTimeFeeSeats ? 'alert' : ''}><strong>{analytics.expiredTimeFeeSeats}</strong> actions needed</span>
      </section>

      <section className="minimal-dashboard dashboard-simple">
        <div className="dashboard-main-column">
        <section className={`panel floor-panel current-tables-panel ${openPanels.currentTables ? '' : 'collapsed-panel'}`}>
          <PanelTitle
            icon={<LayoutDashboard />}
            title="Current Tables"
            collapsed={!openPanels.currentTables}
            onToggle={() => togglePanel('currentTables')}
          />
          {openPanels.currentTables ? <div className="active-game-list">
            {state.sessions.filter((session: { status: string; }) => session.status !== 'Closed' && session.status !== 'Failed to Start').length ? (
              state.sessions.filter((session: { status: string; }) => session.status !== 'Closed' && session.status !== 'Failed to Start').map((session: GameSession) => {
                const game = state.games.find((item: { id: any; }) => item.id === session.gameId);
                const health = getTableHealth(state, session);
                const seatOptions = getSeatOptions(session.gameId);
                const seatedPlayers = state.playerSessions.filter((playerSession) => playerSession.tableId === session.id && !playerSession.leftAt);
                const selectedForStart = startPlayerDrafts[session.id] ?? [];
                const isTimeCollection = session.collectionMode === 'Time' || session.timeFeeBased;
                const averageStack = getAverageStackForTable(state, session.id);
                const tableDropTotal = state.dropLogs
                  .filter((drop) => drop.tableId === session.id)
                  .reduce((sum, drop) => sum + drop.amount, 0);
                const currentDealer = state.dealerAssignments.find((assignment) => assignment.tableId === session.id && !assignment.endedAt);
                const tableHandsTotal = state.handCountLogs
                  .filter((entry) => entry.tableId === session.id)
                  .reduce((sum, entry) => sum + entry.hands, 0);
                const tableExpanded = collapsedTables[session.id] ?? true;
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
                return (
                  <article className="active-game-card floor-table-launcher" key={session.id} onClick={() => openTableView(session.id)}>
                    <div>
                      <h3>{game?.name ?? 'Unknown'}</h3>
                    <span>{session.label} - {session.status} - {isTimeCollection ? 'Time fees' : 'Drop'}</span>
                      <small>
                        Start {formatClock(session.startedAt)} {session.manualEdits?.startedAt ? <em className="edited-marker">edited</em> : null}
                        {session.endedAt ? <> / End {formatClock(session.endedAt)} {session.manualEdits?.endedAt ? <em className="edited-marker">edited</em> : null}</> : null}
                        {' '} / Avg stack ${averageStack.toLocaleString()}
                        {currentDealer ? <> / Dealer {currentDealer.dealerName}</> : null}
                        {tableHandsTotal ? <> / {tableHandsTotal} hands logged</> : null}
                      </small>
                    </div>
                    <strong>{pokerTablePlayers.length}/{session.maxSeats}</strong>
                    <span className={`health-pill ${health.toLowerCase().replace(/\s+/g, '-')}`}>{health}</span>
                    <div className="seat-control" onClick={(event) => event.stopPropagation()}>
                      <button
                        className="mini-button"
                        onClick={() => {
                          openSeatPicker(session);
                          setCollapsedTables((tables) => ({ ...tables, [session.id]: true }));
                        }}
                        title="Add player to an open seat"
                      >
                        +
                      </button>
                      {session.status !== 'Running' ? (
                        <button className="secondary-button" onClick={() => startSessionWithPlayers(session)}>Start Table</button>
                      ) : null}
                      <button className="ghost-button" onClick={() => openTableView(session.id)}><Eye size={17} /> Open</button>
                      <button className="ghost-button" onClick={() => setTableLedgerSessionId(session.id)}><WalletCards size={17} /> Ledger</button>
                      <button
                        className="icon-button"
                        onClick={() => setCollapsedTables((tables) => ({ ...tables, [session.id]: !(tables[session.id] ?? true) }))}
                        title={tableExpanded ? 'Hide table' : 'Show table'}
                      >
                        {tableExpanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><button className="icon-button" title="Table actions"><MoreHorizontal size={17} /></button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {session.status === 'Running' ? <DropdownMenuItem onSelect={() => updateSession(session.id, { status: 'Paused' })}>Pause table</DropdownMenuItem> : null}
                          <DropdownMenuItem onSelect={() => setCollapsedTables((tables) => ({ ...tables, [session.id]: true }))}>Table settings</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={() => recordTableEvent(session, 'Broke', eventDrafts[session.id]?.breakReason || tableBreakReasons[0], eventDrafts[session.id]?.breakNote ?? '')}>Mark as broke</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => recordTableEvent(session, 'Closed', 'Staff closed table')}>Close table</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="table-detail-panel">
                      <div className="seat-help-row">
                        <span>Click an open seat and choose a player from the club database.</span>
                        <button
                          className="ghost-button"
                          onClick={() => {
                            openSeatPicker(session);
                            setCollapsedTables((tables) => ({ ...tables, [session.id]: true }));
                          }}
                        >
                          Next open seat
                        </button>
                      </div>
                      {session.status !== 'Running' ? (
                        <div className="start-table-panel">
                          <div className="start-table-head">
                            <strong>Select players to start this table</strong>
                            <span>{selectedForStart.length}/{session.maxSeats} selected</span>
                          </div>
                          <div className="player-picker-list start-table-picker">
                            {seatOptions.length ? (
                              seatOptions.slice(0, session.maxSeats).map((interest) => (
                                <label className="player-pick-row" key={interest.id}>
                                  <input
                                    type="checkbox"
                                    checked={selectedForStart.includes(interest.id)}
                                    onChange={() => toggleStartPlayer(session.id, interest.id)}
                                  />
                                  <span>{interest.playerName}</span>
                                  <small>{interest.status}</small>
                                </label>
                              ))
                            ) : (
                              <span className="muted-copy">No waiting or arrived players for this game yet. You can still start the table empty and add players from the + seat control.</span>
                            )}
                          </div>
                          <div className="inline-actions">
                            <button className="primary-button" onClick={() => startSessionWithPlayers(session)}>
                              {selectedForStart.length ? 'Start with selected' : 'Start empty'}
                            </button>
                            {selectedForStart.length ? (
                              <button className="ghost-button" onClick={() => setStartPlayerDrafts((drafts) => ({ ...drafts, [session.id]: [] }))}>
                                Clear
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                      {tableExpanded ? (
                        <div className="poker-table-display">
                          <PokerTable
                            players={pokerTablePlayers}
                            showTimeRemaining={isTimeCollection}
                            maxPlayers={session.maxSeats}
                            selectedSeatNumber={seatPicker?.sessionId === session.id ? seatPicker.seatNumber : undefined}
                            moveTargets={getMoveTargets(session.id)}
                            onSeatClick={(seatNumber) =>
                              openSeatPicker(session, seatNumber)
                            }
                            onAddTime={(playerId, minutes) => {
                              const playerSession = seatedPlayers.find((player) => player.id === playerId);
                              if (playerSession) addPlayerTime(playerSession, minutes);
                            }}
                            onAddBuyIn={(playerId, amount, note) => {
                              const playerSession = seatedPlayers.find((player) => player.id === playerId);
                              if (playerSession) addBuyIn(playerSession, amount, note);
                            }}
                            onRemovePlayer={(playerId) => {
                              const playerSession = seatedPlayers.find((player) => player.id === playerId);
                              if (playerSession) requestPlayerCashOut(playerSession);
                            }}
                            onChangeSeat={(playerId, seatNumber) => {
                              const playerSession = seatedPlayers.find((player) => player.id === playerId);
                              if (playerSession) changePlayerSeat(playerSession, seatNumber);
                            }}
                            onMovePlayer={(playerId, targetTableId) => {
                              const playerSession = seatedPlayers.find((player) => player.id === playerId);
                              if (playerSession) movePlayerToTable(playerSession, targetTableId);
                            }}
                          />
                        </div>
                      ) : (
                        <div className="table-collapsed-note">
                          <span>{seatedPlayers.length} seated player{seatedPlayers.length === 1 ? '' : 's'}</span>
                          <button
                            className="ghost-button"
                            onClick={() => setCollapsedTables((tables) => ({ ...tables, [session.id]: true }))}
                          >
                            Show table
                          </button>
                        </div>
                      )}
                    </div>
                    <details className="compact-details table-admin-details" onClick={(event) => event.stopPropagation()}>
                      <summary>Table admin</summary>
                      <div className="correction-grid">
                        <label>
                          Collection mode
                          <div className="segmented-control table-mode-control">
                            <button
                              type="button"
                              className={!isTimeCollection ? 'secondary-button active' : 'ghost-button'}
                              onClick={() => setTableCollectionMode(session.id, 'Drop')}
                            >
                              Drop
                            </button>
                            <button
                              type="button"
                              className={isTimeCollection ? 'secondary-button active' : 'ghost-button'}
                              onClick={() => setTableCollectionMode(session.id, 'Time')}
                            >
                              Time fees
                            </button>
                          </div>
                        </label>
                        <label>
                          Start
                          <input
                            type="datetime-local"
                            value={toDateTimeInput(session.startedAt)}
                            onChange={(event: { target: { value: string; }; }) => updateSessionTimestamp(session.id, 'startedAt', event.target.value)}
                          />
                        </label>
                        <label>
                          End
                          <input
                            type="datetime-local"
                            value={toDateTimeInput(session.endedAt)}
                            onChange={(event: { target: { value: string; }; }) => updateSessionTimestamp(session.id, 'endedAt', event.target.value)}
                          />
                        </label>
                        <label>
                          Current dealer
                          <input
                            list={`dealer-options-${session.id}`}
                            value={dealerDrafts[session.id] ?? currentDealer?.dealerName ?? ''}
                            onChange={(event) => setDealerDrafts((drafts) => ({ ...drafts, [session.id]: event.target.value }))}
                            placeholder="Dealer name"
                          />
                          <datalist id={`dealer-options-${session.id}`}>
                            {state.settings.staffAccounts.filter((staff) => staff.active).map((staff) => <option key={staff.id} value={staff.name} />)}
                          </datalist>
                        </label>
                        <div className="table-tracking-actions">
                          <button className="secondary-button" onClick={() => assignDealer(session)}>Start dealer down</button>
                          {currentDealer ? <button className="ghost-button" onClick={() => endDealerAssignment(session)}>End {currentDealer.dealerName}</button> : null}
                        </div>
                        <label>
                          Hands since last count
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={handCountDrafts[session.id] ?? ''}
                            onChange={(event) => setHandCountDrafts((drafts) => ({ ...drafts, [session.id]: event.target.value }))}
                            placeholder="Example: 15"
                          />
                        </label>
                        <div className="table-tracking-actions">
                          <button className="secondary-button" onClick={() => recordHands(session)}>Record hands</button>
                          <span className="muted-copy">{tableHandsTotal} total logged</span>
                        </div>
                        <label>
                          Break reason
                          <select
                            value={eventDrafts[session.id]?.breakReason ?? tableBreakReasons[0]}
                            onChange={(event: { target: { value: any; }; }) =>
                              setEventDrafts((drafts: { [x: string]: any; }) => ({
                                ...drafts,
                                [session.id]: { failReason: failedStartReasons[0], failNote: '', breakNote: '', ...(drafts[session.id] ?? {}), breakReason: event.target.value }
                              }))
                            }
                          >
                            {tableBreakReasons.map((reason) => (
                              <option key={reason}>{reason}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Break note
                          <input
                            value={eventDrafts[session.id]?.breakNote ?? ''}
                            onChange={(event: { target: { value: any; }; }) =>
                              setEventDrafts((drafts: { [x: string]: any; }) => ({
                                ...drafts,
                                [session.id]: { failReason: failedStartReasons[0], failNote: '', breakReason: tableBreakReasons[0], ...(drafts[session.id] ?? {}), breakNote: event.target.value }
                              }))
                            }
                            placeholder="Optional"
                          />
                        </label>
                        {!isTimeCollection ? (
                          <>
                            <label>
                              Table drop
                              <input
                                value={dropDrafts[session.id]?.amount ?? ''}
                                onChange={(event) =>
                                  setDropDrafts((drafts) => ({
                                    ...drafts,
                                    [session.id]: { amount: event.target.value, note: drafts[session.id]?.note ?? '' }
                                  }))
                                }
                                placeholder="Amount removed"
                                type="number"
                                min="0"
                                step="1"
                              />
                            </label>
                            <label>
                              Drop note
                              <input
                                value={dropDrafts[session.id]?.note ?? ''}
                                onChange={(event) =>
                                  setDropDrafts((drafts) => ({
                                    ...drafts,
                                    [session.id]: { amount: drafts[session.id]?.amount ?? '', note: event.target.value }
                                  }))
                                }
                                placeholder="Down, dealer, or note"
                              />
                            </label>
                            <button className="secondary-button" onClick={() => addTableDrop(session)}>
                              Record Drop
                            </button>
                            <span className="muted-copy">Recorded drop: ${tableDropTotal.toLocaleString()}</span>
                          </>
                        ) : null}
                      </div>
                    </details>
                  </article>
                );
              })
            ) : (
              <p className="muted-copy">No active tables.</p>
            )}
          </div> : null}
        </section>
        </div>

        <div className="dashboard-side-column">
        <section className={`panel floor-panel table-overview-panel ${openPanels.tableOverview ? '' : 'collapsed-panel'}`}>
          <PanelTitle
            icon={<Clock />}
            title="Time Overview"
            collapsed={!openPanels.tableOverview}
            onToggle={() => togglePanel('tableOverview')}
          />
          {openPanels.tableOverview ? (() => {
            const allTimeOverviewId = 'all-time-overview';
            const openSessions = state.sessions.filter((session) => session.status !== 'Closed' && session.status !== 'Failed to Start');
            const isAllTimeOverview = overviewTableId === allTimeOverviewId;
            const openSessionsById = new Map(openSessions.map((session) => [session.id, session]));
            const selectedTable = openSessions.find((session) => session.id === overviewTableId) ?? openSessions[0];
            const selectedPlayers = selectedTable
              ? state.playerSessions
                  .filter((playerSession) => playerSession.tableId === selectedTable.id && !playerSession.leftAt)
                  .map((playerSession) => ({
                    playerSession,
                    isTimeCollection: Boolean(selectedTable.collectionMode === 'Time' || selectedTable.timeFeeBased || playerSession.timeFeeEnabled),
                    remainingSeconds: getTimeRemainingSeconds(playerSession, clockNow)
                  }))
                  .sort((left, right) => {
                    if (left.isTimeCollection !== right.isTimeCollection) return left.isTimeCollection ? -1 : 1;
                    if (left.isTimeCollection && right.isTimeCollection) return left.remainingSeconds - right.remainingSeconds;
                    return left.playerSession.playerName.localeCompare(right.playerSession.playerName);
                  })
              : [];
            const allTimePlayers = state.playerSessions
              .filter((playerSession) => !playerSession.leftAt && openSessionsById.has(playerSession.tableId))
              .map((playerSession) => {
                const table = openSessionsById.get(playerSession.tableId);
                const isTimeCollection = Boolean(table && (table.collectionMode === 'Time' || table.timeFeeBased || playerSession.timeFeeEnabled));
                const remainingSeconds = getTimeRemainingSeconds(playerSession, clockNow);
                return { playerSession, table, isTimeCollection, remainingSeconds };
              })
              .sort((left, right) => {
                if (left.isTimeCollection !== right.isTimeCollection) return left.isTimeCollection ? -1 : 1;
                if (left.isTimeCollection && right.isTimeCollection) return left.remainingSeconds - right.remainingSeconds;
                return minutesSince(right.playerSession.seatedAt) - minutesSince(left.playerSession.seatedAt);
              });
            return (
              <div className="table-overview-content">
                {openSessions.length ? (
                  <>
                    <select value={isAllTimeOverview ? allTimeOverviewId : selectedTable?.id ?? ''} onChange={(event) => setOverviewTableId(event.target.value)}>
                      <option value={allTimeOverviewId}>All Players - Time Left</option>
                      {openSessions.map((session) => (
                        <option key={session.id} value={session.id}>
                          {session.label} - {state.games.find((game) => game.id === session.gameId)?.name ?? 'Unknown'}
                        </option>
                      ))}
                    </select>
                    <div className="overview-player-list">
                      {isAllTimeOverview ? (
                        allTimePlayers.length ? (
                          allTimePlayers.map(({ playerSession, table, isTimeCollection, remainingSeconds }) => {
                            const timeStatus = isTimeCollection ? getTimerStatusFromSeconds(remainingSeconds) : 'off';
                            return (
                              <div className="overview-player-row all-time-row" key={playerSession.id}>
                                <span>{table?.label ?? 'Table'} - Seat {playerSession.seatNumber ?? '-'}</span>
                                <strong>{playerSession.playerName}</strong>
                                <small>{state.games.find((game) => game.id === playerSession.gameId)?.name ?? 'Unknown'}</small>
                                <em className={`time-left-pill ${timeStatus}`}>
                                  {isTimeCollection ? formatTimeLeft(remainingSeconds) : 'No timer'}
                                </em>
                              </div>
                            );
                          })
                        ) : (
                          <p className="muted-copy">No seated players on open tables.</p>
                        )
                      ) : selectedPlayers.length ? (
                        selectedPlayers.map(({ playerSession, isTimeCollection, remainingSeconds }) => {
                          const timeStatus = isTimeCollection ? getTimerStatusFromSeconds(remainingSeconds) : 'off';
                          return (
                            <div className="overview-player-row" key={playerSession.id}>
                              <span>Seat {playerSession.seatNumber ?? '-'}</span>
                              <strong>{playerSession.playerName}</strong>
                              <em className={`time-left-pill ${timeStatus}`}>
                                {isTimeCollection ? formatTimeLeft(remainingSeconds) : 'No timer'}
                              </em>
                            </div>
                          );
                        })
                      ) : (
                        <p className="muted-copy">No seated players on this table.</p>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="muted-copy">No open tables to summarize.</p>
                )}
              </div>
            );
          })() : null}
        </section>

        <section className={`panel floor-panel table-financial-overview-panel ${openPanels.tableFinancials ? '' : 'collapsed-panel'}`}>
          <PanelTitle
            icon={<WalletCards />}
            title="Table Overview"
            collapsed={!openPanels.tableFinancials}
            onToggle={() => togglePanel('tableFinancials')}
          />
          {openPanels.tableFinancials ? (() => {
            const allTableFinancialsId = 'all-table-financials';
            const openSessions = state.sessions.filter((session) => session.status !== 'Closed' && session.status !== 'Failed to Start');
            const selectedTable = openSessions.find((session) => session.id === financialOverviewTableId);
            const isAllTables = financialOverviewTableId === allTableFinancialsId || !selectedTable;
            const sessionsToShow: GameSession[] = isAllTables || !selectedTable ? openSessions : [selectedTable];
            return openSessions.length ? (
              <div className="table-financial-content">
                <select
                  className="table-financial-selector"
                  value={isAllTables ? allTableFinancialsId : selectedTable?.id ?? allTableFinancialsId}
                  onChange={(event) => setFinancialOverviewTableId(event.target.value)}
                  aria-label="Choose table financial overview"
                >
                  <option value={allTableFinancialsId}>All Tables - Financial Overview</option>
                  {openSessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.label} - {state.games.find((game) => game.id === session.gameId)?.name ?? 'Unknown'}
                    </option>
                  ))}
                </select>
                <div className="table-financial-list">
                {sessionsToShow.map((session) => {
                  const game = state.games.find((entry) => entry.id === session.gameId);
                  const currentDealer = state.dealerAssignments
                    .filter((assignment) => assignment.tableId === session.id && !assignment.endedAt)
                    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
                  const tablePlayers = getActivePlayerSessionsForTable(state, session.id)
                    .sort((left, right) => (left.seatNumber ?? Number.MAX_SAFE_INTEGER) - (right.seatNumber ?? Number.MAX_SAFE_INTEGER));
                  const seatedCount = tablePlayers.length;
                  const financials = getTableFinancialOverview(state, session);
                  const currency = (amount: number) =>
                    `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

                  return (
                    <article className="table-financial-card" key={session.id}>
                      <div className="table-financial-head">
                        <div>
                          <strong>{session.label}</strong>
                          <span>{game?.name ?? 'Unknown game'} · {session.collectionMode ?? (session.timeFeeBased ? 'Time' : 'Drop')}</span>
                        </div>
                        <em>{seatedCount}/{session.maxSeats} seated</em>
                      </div>
                      <div className="table-financial-metrics">
                        <div>
                          <span>Buy-ins</span>
                          <strong>{currency(financials.totalBuyIns)}</strong>
                        </div>
                        <div className="table-profit-metric">
                          <span>Table profit</span>
                          <strong>{currency(financials.tableProfit)}</strong>
                          <small>{currency(financials.totalDrop)} drop · {currency(financials.totalTimeFees)} time</small>
                        </div>
                        <div>
                          <span>Cash in play</span>
                          <strong>{currency(financials.cashInPlay)}</strong>
                        </div>
                      </div>
                      <div className="table-financial-footer">
                        <div>
                          <span>Current dealer</span>
                          <strong>{currentDealer?.dealerName ?? 'Unassigned'}</strong>
                        </div>
                        <div>
                          <span>Cash-outs</span>
                          <strong>{currency(financials.totalCashOuts)}</strong>
                        </div>
                      </div>
                      {!isAllTables ? (
                        <div className="table-player-financials">
                          <div className="table-player-financials-title">
                            <strong>Players at this table</strong>
                            <span>{tablePlayers.length} currently seated</span>
                          </div>
                          {tablePlayers.length ? (
                            <div className="table-player-financial-list">
                              {tablePlayers.map((playerSession) => {
                                const playerFinancials = getTablePlayerFinancialOverview(state, session, playerSession);
                                return (
                                  <article className="table-player-financial-row" key={playerSession.id}>
                                    <div className="table-player-financial-head">
                                      <strong>{playerSession.playerName}</strong>
                                      <span>Seat {playerSession.seatNumber ?? '-'}</span>
                                    </div>
                                    <div className="table-player-financial-metrics">
                                      <div><span>Buy-ins</span><strong>{currency(playerFinancials.totalBuyIns)}</strong></div>
                                      <div><span>Cash-outs</span><strong>{currency(playerFinancials.totalCashOuts)}</strong></div>
                                      <div><span>Time paid</span><strong>{currency(playerFinancials.totalTimeFees)}</strong></div>
                                    </div>
                                  </article>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="muted-copy">No players are currently seated at this table.</p>
                          )}
                          <small className="table-player-financial-note">Recorded drop stays in the table total because it is not assigned to an individual player.</small>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
                </div>
              </div>
            ) : (
              <p className="muted-copy">No open tables to summarize.</p>
            );
          })() : null}
        </section>

        <section className={`panel floor-panel live-feed-panel ${openPanels.recentActivity ? '' : 'collapsed-panel'}`}>
          <PanelTitle
            icon={<MessageCircle />}
            title="Recent Activity"
            collapsed={!openPanels.recentActivity}
            onToggle={() => togglePanel('recentActivity')}
          />
          {openPanels.recentActivity ? <div className="live-feed-list" aria-live="polite">
            {liveFeedItems.length ? (
              liveFeedItems.map((item) => (
                <article className={`live-feed-item ${item.kind}`} key={item.id}>
                  <div className="live-feed-dot" />
                  <div>
                    <div className="live-feed-head">
                      <strong>{item.actor}</strong>
                      <span>{formatClock(item.timestamp)}</span>
                    </div>
                    <p>{item.label}{item.detail ? ` - ${item.detail}` : ''}</p>
                  </div>
                </article>
              ))
            ) : (
              <p className="muted-copy">Live floor events will appear here.</p>
            )}
          </div> : null}
        </section>

        <section className={`panel floor-panel shown-interest-panel ${openPanels.formingGames ? '' : 'collapsed-panel'}`}>
          <PanelTitle icon={<Users />} title="Forming Games" collapsed={!openPanels.formingGames} onToggle={() => togglePanel('formingGames')} />
          {openPanels.formingGames ? <div className="forming-list">
            {state.games.length ? (
              <label className="forming-game-menu">
                <span>Game to form</span>
                <select
                  value={state.games.some((game) => game.id === formingGameId) ? formingGameId : state.games[0].id}
                  onChange={(event) => setFormingGameId(event.target.value)}
                >
                  {state.games.map((game) => {
                    const demand = getDemand(game, state.interests);
                    const forming = state.sessions.some((session) => session.gameId === game.id && session.status === 'Forming');
                    return (
                      <option key={game.id} value={game.id}>
                        {game.name}{forming ? ', forming' : ''}{demand.inRoom ? `, ${demand.inRoom} in room` : ''}
                      </option>
                    );
                  })}
                </select>
              </label>
            ) : null}
            {state.games
              .filter((game) => game.id === (state.games.some((item) => item.id === formingGameId) ? formingGameId : state.games[0]?.id))
              .map((game: GameConfig) => {
              const demand = getDemand(game, state.interests);
              const viability = getViabilityState(state, game);
              const formingSession = state.sessions.find((session: { gameId: any; status: string; }) => session.gameId === game.id && session.status === 'Forming');
              const candidates = getParticipantPool(state, game.id, 3);
              const startOptions = getSeatOptions(game.id);
              const selectedForStart = formingSession ? (startPlayerDrafts[formingSession.id] ?? []) : [];
              return (
                <article className="forming-card" key={game.id}>
                  <div>
                    <strong>{game.name}</strong>
                    <span className={`status-pill ${viability.state === 'Ready to Start' || viability.state === 'Likely to Start' ? 'likely' : ''}`}>
                      {viability.state}
                    </span>
                  </div>
                  <p>{demand.inRoom} in / {demand.confirmed} coming / {demand.interested + demand.waiting} waiting</p>
                  <small>{viability.nextStep}</small>
                  {candidates.length ? <small>Likely: {candidates.map((candidate) => candidate.playerName).join(', ')}</small> : null}
                  <div className="inline-actions">
                    {formingSession ? (
                      <>
                        <button className="secondary-button" onClick={() => startSessionWithPlayers(formingSession)}>
                          Select + Start
                        </button>
                        <button className="ghost-button" onClick={() => failFormingGame(formingSession)}>
                          Failed
                        </button>
                      </>
                    ) : (
                      <button className="secondary-button" onClick={() => addSession(game.id)}>
                        Build Game
                      </button>
                    )}
                  </div>
                  {formingSession ? (
                    <details className="compact-details">
                      <summary>Players</summary>
                      <div className="player-picker-list">
                        {startOptions.length ? (
                          startOptions.slice(0, formingSession.maxSeats).map((interest) => (
                            <label className="player-pick-row" key={interest.id}>
                              <input
                                type="checkbox"
                                checked={selectedForStart.includes(interest.id)}
                                onChange={() => toggleStartPlayer(formingSession.id, interest.id)}
                              />
                              <span>{interest.playerName}</span>
                              <small>{interest.status}</small>
                            </label>
                          ))
                        ) : (
                          <span className="muted-copy">No players available.</span>
                        )}
                      </div>
                    </details>
                  ) : null}
                  {formingSession ? (
                    <details className="compact-details">
                      <summary>Failed start</summary>
                      <div className="correction-grid">
                      <label>
                        Failed reason
                        <select
                          value={eventDrafts[formingSession.id]?.failReason ?? failedStartReasons[0]}
                          onChange={(event: { target: { value: any; }; }) =>
                            setEventDrafts((drafts: { [x: string]: any; }) => ({
                              ...drafts,
                              [formingSession.id]: { breakReason: tableBreakReasons[0], breakNote: '', failNote: '', ...(drafts[formingSession.id] ?? {}), failReason: event.target.value }
                            }))
                          }
                        >
                          {failedStartReasons.map((reason) => (
                            <option key={reason}>{reason}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Failed note
                        <input
                          value={eventDrafts[formingSession.id]?.failNote ?? ''}
                          onChange={(event: { target: { value: any; }; }) =>
                            setEventDrafts((drafts: { [x: string]: any; }) => ({
                              ...drafts,
                              [formingSession.id]: { breakReason: tableBreakReasons[0], breakNote: '', failReason: failedStartReasons[0], ...(drafts[formingSession.id] ?? {}), failNote: event.target.value }
                            }))
                          }
                          placeholder="Optional"
                        />
                      </label>
                      </div>
                    </details>
                  ) : null}
                </article>
              );
            })}
            {!state.games.length ? <p className="muted-copy">Add a game in Settings before forming a table.</p> : null}
          </div> : null}
        </section>

        <section className={`panel floor-panel recommended-panel ${openPanels.waitlist ? '' : 'collapsed-panel'}`}>
          <PanelTitle icon={<Target />} title="Waitlist" collapsed={!openPanels.waitlist} onToggle={() => togglePanel('waitlist')} />
          {openPanels.waitlist ? <div className="waitlist-list">
            {state.interests.filter((interest) => activeInterestStatuses.includes(interest.status)).length ? (
              state.interests
                .filter((interest) => activeInterestStatuses.includes(interest.status))
                .slice(0, 8)
                .map((interest: Interest) => {
                const game = state.games.find((item: { id: any; }) => item.id === interest.gameId);
                return (
                  <article className="waitlist-card" key={interest.id}>
                    <div>
                      <strong>{interest.playerName}</strong>
                      <span>{game?.name ?? 'Unknown'} - {interest.status}</span>
                      <small>
                        Logged {formatClock(interest.interestedAt)} ({minutesSince(interest.interestedAt)}m)
                        {interest.manualEdits?.interestedAt ? <em className="edited-marker">edited</em> : null}
                      </small>
                      {interest.arrivedAt ? (
                        <small>
                          Arrived {formatClock(interest.arrivedAt)} ({minutesSince(interest.arrivedAt)}m)
                          {interest.manualEdits?.arrivedAt ? <em className="edited-marker">edited</em> : null}
                        </small>
                      ) : null}
                    </div>
                    <div className="lifecycle-actions">
                      <button className="ghost-button" onClick={() => deleteInterest(interest.id)}>Remove</button>
                    </div>
                  </article>
                );
              })
            ) : (
              <p className="muted-copy">No one is on the waitlist.</p>
            )}
          </div> : null}
        </section>

        {openPanels.quickAdd ? (
          <button
            className="quick-add-drawer-backdrop"
            type="button"
            aria-label="Close Quick Add"
            onClick={() => setOpenPanels((panels) => ({ ...panels, quickAdd: false }))}
          />
        ) : null}
        <section className={`panel floor-panel quick-add-panel ${openPanels.quickAdd ? '' : 'collapsed-panel'}`}>
          {openPanels.quickAdd ? (
            <button
              className="quick-add-drawer-close"
              type="button"
              aria-label="Close Quick Add"
              title="Close Quick Add"
              onClick={() => setOpenPanels((panels) => ({ ...panels, quickAdd: false }))}
            >
              <X size={19} />
            </button>
          ) : null}
          <PanelTitle icon={<Plus />} title="Quick Add" collapsed={!openPanels.quickAdd} onToggle={() => togglePanel('quickAdd')} />
          {openPanels.quickAdd ? <>
          <form className="quick-form" onSubmit={addInterest}>
            <input
              value={form.playerName}
              onChange={(event) => setForm({ ...form, playerName: event.target.value })}
              placeholder="Player name"
            />
            <select value={form.gameId} onChange={(event) => setForm({ ...form, gameId: event.target.value, tableId: '', seatNumber: '' })}>
              {state.games.map((game) => (
                <option key={game.id} value={game.id}>
                  {game.name}
                </option>
              ))}
            </select>
            <select
              id="quick-add-status"
              value={form.status}
              onChange={(event) =>
                setForm({
                  ...form,
                  status: event.target.value as InterestStatus,
                  tableId: event.target.value === 'Seated' ? form.tableId : '',
                  seatNumber: event.target.value === 'Seated' ? form.seatNumber : '',
                  initialBuyIn: event.target.value === 'Seated' ? form.initialBuyIn : ''
                })
              }
            >
              {statuses.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
            {form.status === 'Seated' ? (
              <>
                <select value={form.tableId} onChange={(event) => setForm({ ...form, tableId: event.target.value, seatNumber: '' })}>
                  <option value="">
                    {quickAddOpenSeatSessions.length > 1 ? 'Choose table' : 'Auto table'}
                  </option>
                  {quickAddOpenSeatSessions.map((session) => {
                    const game = state.games.find((item) => item.id === session.gameId);
                    const openSeatCount = session.maxSeats - getActivePlayerSessionsForTable(state, session.id).length;
                    return (
                      <option key={session.id} value={session.id}>
                        {session.label} - {game?.name ?? 'Table'} ({openSeatCount} open)
                      </option>
                    );
                  })}
                </select>
                <input
                  value={form.seatNumber}
                  onChange={(event) => setForm({ ...form, seatNumber: event.target.value })}
                  placeholder="Seat #"
                  type="number"
                  min="1"
                  step="1"
                />
                <input
                  value={form.initialBuyIn}
                  onChange={(event) => setForm({ ...form, initialBuyIn: event.target.value })}
                  placeholder="Initial buy-in $"
                  type="number"
                  min="0"
                  step="1"
                />
              </>
            ) : null}
            <input
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              placeholder="Notes"
            />
            <button className="primary-button">
              <Plus size={18} />
              Add
            </button>
          </form>
          <div className="check-in-search">
            <input
              value={checkInSearch}
              onChange={(event) => setCheckInSearch(event.target.value)}
              placeholder="Search first or last name"
            />
            <p className="check-in-help">Choose a member, then use the game and status options above.</p>
            <div className="check-in-results">
              {checkInMatches.length ? (
                checkInMatches.map((profile) => {
                  const preferredGame = state.games.find((game) => game.id === profile.preferredGameId)?.name ?? profile.preferredStakes;
                  const inClub = hasProfileReference(inClubInterests, state.profiles, profile);
                  return (
                    <button className="check-in-result" type="button" key={profile.id} onClick={() => checkInProfileFromSearch(profile)}>
                      <span>
                        <strong>{profile.name}</strong>
                        <small>{preferredGame || 'No preferred game'}</small>
                      </span>
                      <em>{inClub ? 'Edit status' : 'Choose'}</em>
                    </button>
                  );
                })
              ) : (
                <p className="muted-copy">No matching players.</p>
              )}
            </div>
          </div>
          </> : null}
        </section>
        </div>

      </section>
    </main>
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
