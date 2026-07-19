import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ChevronDown,
  ChevronUp,
  Clock,
  ChevronLeft,
  Download,
  Edit3,
  Eye,
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './components/ui/dropdown-menu';
import {
  canonicalPayload,
  countActivePlayersForTable,
  createBackupEnvelope,
  getGameFrequencyRank,
  getTimerStatusFromMinutes,
  getTimerStatusFromSeconds,
  readBackupEnvelope,
  resolveGameId
} from './lib/appCore';
import { loadClubStateFromFirebase, saveClubStateToFirebase, signInOrCreateFirebaseEmailAccount, signOutOfFirebase, subscribeToPlayerRequestUpdates, syncPlayerUpdatesToClubState } from './lib/firebaseClubSync';
import { rendererFirebaseSyncEnabled } from './lib/firebaseConfig';
import './styles.css';

declare global {
  interface Window {
    tableManagerDesktop?: {
      platform: string;
      isDesktop: boolean;
      openWindow: (route: AppRoute, context?: { sessionId?: string }) => Promise<void>;
      loadState: () => Promise<{ schemaVersion: number; savedAt: string; state: Partial<AppState> } | null>;
      loadStateForAccount: (access: PilotAccess) => Promise<{ schemaVersion: number; savedAt: string; state: Partial<AppState> } | null>;
      saveState: (state: AppState) => Promise<{ ok: boolean; path: string; accountKey?: string }>;
      getBackendStatus: () => Promise<BackendStatus>;
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

type AppRoute = 'floor' | 'table' | 'builder' | 'profiles' | 'signals' | 'summary' | 'customization' | 'kpis' | 'tournaments' | 'tournament-tv';
type InterestStatus =
  | 'Interested'
  | 'Confirmed Coming'
  | 'Arrived'
  | 'Seated'
  | 'Declined'
  | 'No-Show'
  | 'Left Before Seated'
  | 'Removed';
type GameStatus = 'Running' | 'Forming' | 'Paused' | 'Closed' | 'Failed to Start';
type TableTag =
  | 'Action'
  | 'Social'
  | 'Competitive'
  | 'Beginner-Friendly'
  | 'Deep-Stacked'
  | 'Relaxed'
  | 'Short-handed'
  | 'Full-ring'
  | 'Fast-moving'
  | 'Slow-moving';

type GameConfig = {
  id: string;
  name: string;
  maxSeats: number;
  minInRoomForLikely: number;
  minFlexibleForLikely: number;
  minTotalForViable: number;
};

type Interest = {
  id: string;
  profileId?: string;
  playerName: string;
  gameId: string;
  status: InterestStatus;
  timestamp: string;
  interestedAt: string;
  confirmedAt?: string;
  arrivedAt?: string;
  seatedAt?: string;
  closedAt?: string;
  notes: string;
  manualEdits?: Record<string, string>;
};

type PlayerProfile = {
  id: string;
  name: string;
  phone: string;
  birthday: string;
  membershipStartDate: string;
  membershipExpirationDate: string;
  totalTimePlayedHours: number;
  lastSessionTimePlayedHours: number;
  commonlyPlaysWithProfileIds: string[];
  preferredGameId: string;
  preferredGameIds: string[];
  gamePlayCounts: Record<string, number>;
  mostPlayedGameId: string;
  preferredStakes: string;
  typicalBuyInMin: number;
  typicalBuyInMax: number;
  willingnessToMove: boolean;
  typicalAvailability: string;
  usualCompanions: string[];
  preferredTags: TableTag[];
  notes: string;
};

type GameSession = {
  id: string;
  gameId: string;
  label: string;
  status: GameStatus;
  seatsFilled: number;
  maxSeats: number;
  timeFeeBased?: boolean;
  collectionMode?: 'Time' | 'Drop';
  plannedPlayerIds?: string[];
  tags: TableTag[];
  startedAt: string;
  endedAt?: string;
  manualEdits?: Record<string, string>;
};

type PlayerSession = {
  id: string;
  playerName: string;
  profileId?: string;
  gameId: string;
  tableId: string;
  seatNumber?: number;
  seatedAt: string;
  leftAt?: string;
  timePurchasedMinutes?: number;
  timeRemainingMinutes?: number;
  lastTimeTickAt?: string;
  timeFeeEnabled?: boolean;
  manualEdits?: Record<string, string>;
};

type BuyInLog = {
  id: string;
  profileId?: string;
  playerName: string;
  tableId: string;
  gameId: string;
  amount: number;
  timestamp: string;
  note?: string;
};

type DropLog = {
  id: string;
  tableId: string;
  gameId: string;
  amount: number;
  timestamp: string;
  note?: string;
};

type PlayerLedgerEntry = {
  id: string;
  type: 'Check-In' | 'Buy-In' | 'Cash-Out';
  profileId?: string;
  playerName: string;
  tableId?: string;
  gameId?: string;
  amount?: number;
  timestamp: string;
  note?: string;
};

type CollectionProfile = {
  gameId: string;
  collectionMode: 'Time' | 'Drop';
  hourlyFee: number;
  estimatedDropPerSeatHour: number;
};

type TableEventType = 'Created' | 'Started' | 'Failed to Start' | 'Broke' | 'Merged' | 'Closed';

type TableEvent = {
  id: string;
  type: TableEventType;
  gameId: string;
  tableId?: string;
  timestamp: string;
  playerCount: number;
  reason?: string;
  note: string;
};

type NightRecord = {
  id: string;
  date: string;
  occupiedSeatHours: number;
  gamesStarted: number;
  averageSessionDurationHours: number;
  averageActiveTables: number;
  waitlistConversionRate: number;
  hadTwoPlusTables: boolean;
  notes?: string;
};

type TournamentLevel = {
  id: string;
  level: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  durationMinutes: number;
  breakAfter: boolean;
  breakMinutes: number;
};

type TournamentPlayerStatus = 'Registered' | 'Checked In' | 'Active' | 'Eliminated' | 'Finished';

type TournamentPlayer = {
  id: string;
  profileId?: string;
  name: string;
  phone?: string;
  email?: string;
  buyIn: number;
  rebuys: number;
  addOns: number;
  startingStack: number;
  currentStack?: number;
  status: TournamentPlayerStatus;
  registeredAt: string;
  eliminatedAt?: string;
  finishPlace?: number;
  tableNumber?: number;
  seatNumber?: number;
};

type TournamentPayout = {
  place: number;
  percent: number;
};

type TournamentStatus = 'Draft' | 'Running' | 'Paused' | 'Finished';

type Tournament = {
  id: string;
  name: string;
  status: TournamentStatus;
  createdAt: string;
  startedAt?: string;
  pausedAt?: string;
  completedAt?: string;
  currentLevelIndex: number;
  levelStartedAt?: string;
  pausedRemainingSeconds?: number;
  buyIn: number;
  startingStack: number;
  rebuyPrizePercent: number;
  rebuyPrice?: number;
  addOnPrice?: number;
  lateRegistrationThroughLevel?: number;
  registrationClosesAt?: string;
  tableSize: number;
  levels: TournamentLevel[];
  players: TournamentPlayer[];
  payouts: TournamentPayout[];
};

type FeedbackEntry = {
  id: string;
  role: 'Staff' | 'Owner';
  text: string;
  createdAt: string;
};

type CorrectionEntry = {
  id: string;
  entity: string;
  field: string;
  note: string;
  timestamp: string;
};

type UsageEvent = {
  id: string;
  feature: string;
  action: string;
  route: AppRoute | 'access';
  timestamp: string;
  staffId?: string;
  staffName?: string;
  staffRole?: StaffRole;
  accountKey: string;
  metadata?: Record<string, string | number | boolean>;
};

type UsageDescriptor = {
  feature: string;
  action: string;
  metadata?: Record<string, string | number | boolean>;
  route?: AppRoute | 'access';
};

type BrandTheme = typeof branding.theme.default;

type PilotAccess = {
  authorized: boolean;
  authorizationCode: string;
  expiresAt: string;
  activatedAt: string;
  keyFileName?: string;
  issuedTo?: string;
  issuedAt?: string;
  licenseId?: string;
};

type ClubAccount = {
  clubName: string;
  accountName: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
};

type StaffRole = 'Owner' | 'Manager' | 'Floor';

type StaffAccount = {
  id: string;
  name: string;
  role: StaffRole;
  pinSalt: string;
  pinHash: string;
  active: boolean;
  createdAt: string;
  lastSelectedAt?: string;
};

type AccountLogin = {
  username: string;
  passwordSalt: string;
  passwordHash: string;
  createdAt: string;
  lastLoginAt?: string;
};

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

type PlayerInAppNotification = {
  id: string;
  clubId: string;
  gameId: string;
  title: string;
  body: string;
  reason: 'game-forming' | 'seat-opened';
  createdAt: string;
  expiresAt?: string;
  targetPlayerIds?: string[];
  targetPlayerNames?: string[];
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

type AnalyticalReportPayload = {
  app: 'TableManager';
  kind: 'analytical-report';
  version: 1;
  generatedAt: string;
  account: {
    accountKey: string;
    clubName: string;
    accountName: string;
    contactName: string;
    email: string;
    license: string;
  };
  operational: Record<string, string | number | boolean>;
  collectionByGame: ReturnType<typeof getAnalytics>['collectionValueByGame'];
  usage: {
    totalEvents: number;
    eventsLast24Hours: number;
    eventsLast7Days: number;
    features: ReturnType<typeof getUsageAnalytics>['eventsByFeature'];
    actions: ReturnType<typeof getUsageAnalytics>['eventsByAction'];
    staff: ReturnType<typeof getUsageAnalytics>['eventsByStaff'];
    recentEvents: UsageEvent[];
  };
  feedback: FeedbackEntry[];
};

type AppState = {
  games: GameConfig[];
  profiles: PlayerProfile[];
  tournaments: Tournament[];
  interests: Interest[];
  sessions: GameSession[];
  playerSessions: PlayerSession[];
  buyIns: BuyInLog[];
  dropLogs: DropLog[];
  playerLedger: PlayerLedgerEntry[];
  tableEvents: TableEvent[];
  inAppNotifications: PlayerInAppNotification[];
  history: NightRecord[];
  feedback: FeedbackEntry[];
  scriptTemplates: string[];
  correctionLog: CorrectionEntry[];
  usageEvents: UsageEvent[];
  settings: {
    lowLight: boolean;
    defaultCollectionMode: 'Time' | 'Drop';
    defaultTableCap: TableCap;
    defaultHourlyFee: number;
    defaultEstimatedDropPerSeatHour: number;
    collectionProfiles: CollectionProfile[];
    showPlayerGrid: boolean;
    showDashboardKpis: boolean;
    showRecentPlayers: boolean;
    pilotAccess?: PilotAccess;
    clubAccount?: ClubAccount;
    staffAccounts: StaffAccount[];
    activeStaffId?: string;
    accountLogin?: AccountLogin;
  };
};

type ParticipantCandidate = {
  id: string;
  playerName: string;
  interest?: Interest;
  profile?: PlayerProfile;
  confidence: number;
  reasons: string[];
  source: 'interest' | 'connected-profile';
};

type BalancePlan = {
  game: GameConfig;
  demand: ReturnType<typeof getDemand>;
  fromTable: GameSession;
  moveCandidates: ParticipantCandidate[];
  tableASeatsAfterMove: number;
  tableBProjectedSeats: number;
  nextStep: string;
};

type GroupMeCandidate = {
  id: string;
  playerName: string;
  gameId: string;
  status: InterestStatus;
  timestamp: string;
  confidence: number;
  sourceText: string;
};

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
const activeInterestStatuses: InterestStatus[] = ['Interested', 'Confirmed Coming', 'Arrived'];
const closedInterestStatuses: InterestStatus[] = ['Seated', 'Declined', 'No-Show', 'Left Before Seated', 'Removed'];
const inactiveInterestStatuses: InterestStatus[] = ['Declined', 'No-Show', 'Left Before Seated', 'Removed'];
const tableCaps = [6, 8, 10] as const;
type TableCap = typeof tableCaps[number];
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
const defaultScriptTemplates = [
  'Current {game} has {inRoom} in the room, {coming} coming, and {waiting} waiting or interested.',
  'Current {game} is full, but overflow is building with {waiting} waiting or interested.',
  "We're building {game}, but need {needs} more player(s) before it is realistic.",
  '{game} is close to forming if arrivals hold. We can add you to the interest list.'
];
const storageKey = 'table-manager-state-v1';
const defaultTournamentLevels = (): TournamentLevel[] => [
  { id: uid(), level: 1, smallBlind: 100, bigBlind: 200, ante: 0, durationMinutes: 20, breakAfter: false, breakMinutes: 0 },
  { id: uid(), level: 2, smallBlind: 200, bigBlind: 400, ante: 400, durationMinutes: 20, breakAfter: false, breakMinutes: 0 },
  { id: uid(), level: 3, smallBlind: 300, bigBlind: 600, ante: 600, durationMinutes: 20, breakAfter: true, breakMinutes: 10 },
  { id: uid(), level: 4, smallBlind: 500, bigBlind: 1000, ante: 1000, durationMinutes: 20, breakAfter: false, breakMinutes: 0 },
  { id: uid(), level: 5, smallBlind: 1000, bigBlind: 2000, ante: 2000, durationMinutes: 20, breakAfter: false, breakMinutes: 0 },
  { id: uid(), level: 6, smallBlind: 1500, bigBlind: 3000, ante: 3000, durationMinutes: 20, breakAfter: true, breakMinutes: 10 },
  { id: uid(), level: 7, smallBlind: 2000, bigBlind: 4000, ante: 4000, durationMinutes: 20, breakAfter: false, breakMinutes: 0 },
  { id: uid(), level: 8, smallBlind: 3000, bigBlind: 6000, ante: 6000, durationMinutes: 20, breakAfter: false, breakMinutes: 0 }
];
const defaultTournamentPayouts = (): TournamentPayout[] => [
  { place: 1, percent: 50 },
  { place: 2, percent: 30 },
  { place: 3, percent: 20 }
];

const nowIso = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const memberId = () => `mem_${crypto.getRandomValues(new Uint32Array(2))[0].toString(16)}${crypto.getRandomValues(new Uint32Array(2))[1].toString(16)}`;
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
const todayDate = () => new Date().toISOString().slice(0, 10);
const nextYearDate = () => {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 1);
  return date.toISOString().slice(0, 10);
};
const hoursBetween = (start: string, end = nowIso()) =>
  Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 36e5);
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
const arrayBufferToHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
const legacyHashStaffPin = async (pin: string, salt: string) =>
  arrayBufferToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`)));
const hashStaffPin = async (pin: string, salt: string) => {
  const iterations = 210_000;
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode(salt),
      iterations,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );
  return `pbkdf2-sha256$${iterations}$${arrayBufferToHex(derived)}`;
};
const verifyStaffSecret = async (secret: string, salt: string, storedHash: string) => {
  if (storedHash.startsWith('pbkdf2-sha256$')) {
    return (await hashStaffPin(secret, salt)) === storedHash;
  }
  return (await legacyHashStaffPin(secret, salt)) === storedHash;
};
const formatMinutesLeft = (minutes: number) => {
  if (minutes <= 0) return '0m';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours ? `${hours}h ${mins}m` : `${mins}m`;
};
const getTimeRemainingMinutes = (session: PlayerSession, nowMs = Date.now()) => {
  if (!session.timeFeeEnabled) return 0;
  const baseRemaining = session.timeRemainingMinutes ?? 0;
  const lastTick = new Date(session.lastTimeTickAt ?? session.seatedAt).getTime();
  return Math.max(0, baseRemaining - Math.floor((nowMs - lastTick) / 60000));
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
const isFutureDate = (value?: string) => Boolean(value && new Date(`${value}T23:59:59`).getTime() >= Date.now());
const isPilotAccessActive = (access?: PilotAccess) => Boolean(access?.authorized && isFutureDate(access.expiresAt));
const safeAccountKeyPart = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
const getAccountKeyFromAccess = (access?: PilotAccess) =>
  safeAccountKeyPart(access?.licenseId || access?.authorizationCode || access?.issuedTo || '');
const getAccountKeyFromState = (state?: Partial<AppState>) =>
  getAccountKeyFromAccess(state?.settings?.pilotAccess) ||
  safeAccountKeyPart(state?.settings?.clubAccount?.email || state?.settings?.clubAccount?.clubName || 'unlicensed-local') ||
  'unlicensed-local';
const getStorageKeyForState = (state?: Partial<AppState>) => `${storageKey}:${getAccountKeyFromState(state)}`;
const getAuthStorageKey = (state?: Partial<AppState>) => `${storageKey}:auth:${getAccountKeyFromState(state)}`;
const mergeSyncedList = <T extends { id?: string; name?: string; playerName?: string }>(latest: T[], synced: T[]) => {
  const syncedByKey = new Map(
    synced.map((item) => [
      item.id || item.name?.trim().toLowerCase() || item.playerName?.trim().toLowerCase() || '',
      item
    ]).filter(([key]) => key)
  );
  const latestKeys = new Set<string>();
  const merged = latest.map((item) => {
    const key = item.id || item.name?.trim().toLowerCase() || item.playerName?.trim().toLowerCase() || '';
    if (key) latestKeys.add(key);
    return key && syncedByKey.has(key) ? syncedByKey.get(key)! : item;
  });
  return [
    ...merged,
    ...synced.filter((item) => {
      const key = item.id || item.name?.trim().toLowerCase() || item.playerName?.trim().toLowerCase() || '';
      return key && !latestKeys.has(key);
    })
  ];
};
const hasPersistedSignIn = (state: AppState) => {
  if (!isPilotAccessActive(state.settings.pilotAccess)) return false;
  try {
    const stored = localStorage.getItem(getAuthStorageKey(state));
    if (!stored) return false;
    const record = JSON.parse(stored) as { expiresAt?: string };
    return Boolean(record.expiresAt && state.settings.pilotAccess && record.expiresAt === state.settings.pilotAccess.expiresAt && isFutureDate(record.expiresAt));
  } catch {
    return false;
  }
};
const persistSignIn = (state: AppState, staySignedIn: boolean) => {
  const key = getAuthStorageKey(state);
  if (staySignedIn && state.settings.pilotAccess?.expiresAt) {
    localStorage.setItem(key, JSON.stringify({ expiresAt: state.settings.pilotAccess.expiresAt, savedAt: nowIso() }));
    return;
  }
  localStorage.removeItem(key);
};
const base64ToArrayBuffer = (base64: string) => {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
};
const leftPadSignatureInteger = (bytes: Uint8Array) => {
  const normalized = bytes[0] === 0 ? bytes.slice(1) : bytes;
  if (normalized.length > 32) throw new Error('Invalid signature integer length.');
  const padded = new Uint8Array(32);
  padded.set(normalized, 32 - normalized.length);
  return padded;
};
const derToRawP256Signature = (signature: Uint8Array) => {
  if (signature.length === 64) return signature.buffer;
  if (signature[0] !== 0x30) throw new Error('Invalid signature format.');
  let offset = 2;
  if (signature[offset] !== 0x02) throw new Error('Invalid signature format.');
  const rLength = signature[offset + 1];
  const r = signature.slice(offset + 2, offset + 2 + rLength);
  offset += 2 + rLength;
  if (signature[offset] !== 0x02) throw new Error('Invalid signature format.');
  const sLength = signature[offset + 1];
  const s = signature.slice(offset + 2, offset + 2 + sLength);
  const raw = new Uint8Array(64);
  raw.set(leftPadSignatureInteger(r), 0);
  raw.set(leftPadSignatureInteger(s), 32);
  return raw.buffer;
};
const pemToArrayBuffer = (pem: string) =>
  base64ToArrayBuffer(
    pem
      .replace(/-----BEGIN PUBLIC KEY-----/g, '')
      .replace(/-----END PUBLIC KEY-----/g, '')
      .replace(/\s/g, '')
  );
const verifyPilotSignature = async (payload: Record<string, unknown>, signature: string) => {
  const publicKeyPem = branding.license?.publicKeyPem?.trim();
  if (!publicKeyPem) return { ok: false, error: 'License verification is not configured for this build.' };
  try {
    const key = await crypto.subtle.importKey(
      'spki',
      pemToArrayBuffer(publicKeyPem),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    const verified = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      derToRawP256Signature(new Uint8Array(base64ToArrayBuffer(signature))),
      new TextEncoder().encode(canonicalPayload(payload))
    );
    return verified ? { ok: true } : { ok: false, error: 'License signature is invalid.' };
  } catch {
    return { ok: false, error: 'Unable to verify license signature.' };
  }
};
const emptyClubAccount: ClubAccount = {
  clubName: '',
  accountName: '',
  contactName: '',
  email: '',
  phone: '',
  address: ''
};
const validatePilotKey = async (licenseFile: unknown, fileName?: string): Promise<{ access?: PilotAccess; error?: string }> => {
  const file = licenseFile as Record<string, unknown>;
  const record = (file.payload ?? file) as Record<string, unknown>;
  const signature = String(file.signature ?? '').trim();
  const authorizationCode = String(record.authorizationCode ?? record.code ?? '').trim();
  const expiresAt = String(record.expiresAt ?? record.expirationDate ?? record.validUntil ?? '').slice(0, 10);

  if (!signature) {
    return { error: 'Key file is not signed. Generate a production pilot key with the license tool.' };
  }

  if (!authorizationCode || authorizationCode.length < 12) {
    return { error: 'Key file is missing a valid authorization code.' };
  }

  if (!expiresAt || Number.isNaN(new Date(expiresAt).getTime())) {
    return { error: 'Key file is missing a valid expiration date.' };
  }

  if (!isFutureDate(expiresAt)) {
    return { error: `This pilot key expired on ${expiresAt}.` };
  }

  const signatureResult = await verifyPilotSignature(record, signature);
  if (!signatureResult.ok) {
    return { error: signatureResult.error ?? 'License signature is invalid.' };
  }

  return {
    access: {
      authorized: true,
      authorizationCode,
      expiresAt,
      activatedAt: nowIso(),
      keyFileName: fileName,
      issuedTo: String(record.issuedTo ?? ''),
      issuedAt: String(record.issuedAt ?? ''),
      licenseId: String(record.licenseId ?? '')
    }
  };
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
const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const legacyStatusMap: Record<string, InterestStatus> = {
  'In Room': 'Arrived',
  Waiting: 'Interested',
  'Interested / Maybe': 'Interested',
  Coming: 'Confirmed Coming'
};
const normalizeTableCap = (value?: number): TableCap => {
  if (value === 6 || value === 8 || value === 10) return value;
  if (!value || value <= 6) return 6;
  if (value <= 8) return 8;
  return 10;
};

const orbitLaunchTournament = (): Tournament => ({
  id: 'orbit-launch-championship-2026',
  name: 'Orbit Launch Championship',
  status: 'Draft',
  createdAt: nowIso(),
  currentLevelIndex: 0,
  buyIn: 0,
  startingStack: 25000,
  rebuyPrizePercent: 100,
  rebuyPrice: 20,
  addOnPrice: 10,
  lateRegistrationThroughLevel: 8,
  registrationClosesAt: '2026-08-01T20:00:00-05:00',
  tableSize: 9,
  levels: defaultTournamentLevels().map((level) => ({ ...level, durationMinutes: 15 })),
  players: [],
  payouts: defaultTournamentPayouts()
});

const seedState: AppState = {
  games: [],
  profiles: [],
  tournaments: [orbitLaunchTournament()],
  interests: [],
  sessions: [],
  playerSessions: [],
  buyIns: [],
  dropLogs: [],
  playerLedger: [],
  tableEvents: [],
  inAppNotifications: [],
  history: [],
  feedback: [],
  scriptTemplates: defaultScriptTemplates,
  correctionLog: [],
  usageEvents: [],
  settings: {
      lowLight: false,
      defaultCollectionMode: 'Drop',
      defaultTableCap: 10,
      defaultHourlyFee: 0,
      defaultEstimatedDropPerSeatHour: 0,
      collectionProfiles: [],
      showPlayerGrid: true,
      showDashboardKpis: false,
      showRecentPlayers: true,
      pilotAccess: undefined,
      clubAccount: undefined,
      staffAccounts: [],
      activeStaffId: undefined
    }
};

function normalizeState(parsed: Partial<AppState>): AppState {
  const defaultTableCap = normalizeTableCap(parsed.settings?.defaultTableCap);
  const games = (parsed.games ?? seedState.games).map((game) =>
    ({ ...game, maxSeats: normalizeTableCap(game.maxSeats ?? defaultTableCap) })
  );
  const fallbackGameId = games[0]?.id ?? 'nlh-1-2';
  const normalizeGameIds = (values?: Array<string | undefined>, fallback = fallbackGameId) => {
    const resolved = (values ?? [])
      .map((value) => resolveGameId(games, value, ''))
      .filter(Boolean);
    return resolved.length ? Array.from(new Set(resolved)) : [fallback];
  };
  const profiles =
    parsed.profiles ??
    (parsed.interests ?? []).map((interest) => ({
      id: uid(),
      name: interest.playerName,
      phone: '',
      birthday: '',
      membershipStartDate: todayDate(),
      membershipExpirationDate: nextYearDate(),
      totalTimePlayedHours: 0,
      lastSessionTimePlayedHours: 0,
      commonlyPlaysWithProfileIds: [],
      preferredGameId: interest.gameId,
      preferredGameIds: [interest.gameId],
      gamePlayCounts: {},
      mostPlayedGameId: interest.gameId,
      preferredStakes: '',
      typicalBuyInMin: 0,
      typicalBuyInMax: 0,
      willingnessToMove: false,
      typicalAvailability: '',
      preferredTags: [],
      usualCompanions: [],
      notes: ''
    }));
  const interests = (parsed.interests ?? []).map((interest) => {
    const status = legacyStatusMap[interest.status] ?? (interest.status as InterestStatus);
    return {
      ...interest,
      status,
      interestedAt: interest.interestedAt ?? interest.timestamp ?? nowIso(),
      confirmedAt: interest.confirmedAt ?? (status === 'Confirmed Coming' ? interest.timestamp : undefined),
      arrivedAt: interest.arrivedAt ?? (status === 'Arrived' ? interest.timestamp : undefined),
      seatedAt: interest.seatedAt ?? (status === 'Seated' ? interest.timestamp : undefined),
      closedAt:
        interest.closedAt ??
        (['Declined', 'No-Show', 'Left Before Seated', 'Removed'].includes(status) ? interest.timestamp : undefined),
      manualEdits: interest.manualEdits ?? {}
    };
  });

  const getNormalizedGameCounts = (counts?: Record<string, number>) =>
    Object.entries(counts ?? {}).reduce<Record<string, number>>((record, [gameId, count]) => {
      const resolvedGameId = resolveGameId(games, gameId, '');
      const normalizedCount = Number(count);
      if (resolvedGameId && Number.isFinite(normalizedCount) && normalizedCount > 0) {
        record[resolvedGameId] = (record[resolvedGameId] ?? 0) + normalizedCount;
      }
      return record;
    }, {});
  const getMostPlayedGameIdFromCounts = (counts: Record<string, number>, fallback: string) => {
    const [topGameId] =
      Object.entries(counts)
        .filter(([, count]) => count > 0)
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0] ?? [];
    return topGameId ?? fallback;
  };

  return {
    games,
    profiles: profiles.map((profile) => {
      const preferredGameIds = normalizeGameIds([profile.preferredGameId, ...(profile.preferredGameIds ?? []), profile.preferredStakes]);
      const gamePlayCounts = getNormalizedGameCounts(profile.gamePlayCounts);
      return {
        ...profile,
        phone: profile.phone ?? '',
        birthday: profile.birthday ?? '',
        membershipStartDate: profile.membershipStartDate ?? todayDate(),
        membershipExpirationDate: profile.membershipExpirationDate ?? nextYearDate(),
        totalTimePlayedHours: profile.totalTimePlayedHours ?? 0,
        lastSessionTimePlayedHours: profile.lastSessionTimePlayedHours ?? 0,
        commonlyPlaysWithProfileIds:
          profile.commonlyPlaysWithProfileIds ??
          (profile.usualCompanions ?? [])
            .map((name) => profiles.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase())?.id)
            .filter((id): id is string => Boolean(id)),
        preferredGameId: preferredGameIds[0],
        preferredGameIds,
        gamePlayCounts,
        mostPlayedGameId: resolveGameId(
          games,
          profile.mostPlayedGameId,
          getMostPlayedGameIdFromCounts(gamePlayCounts, preferredGameIds[0])
        ),
        willingnessToMove: profile.willingnessToMove ?? false,
        typicalAvailability: profile.typicalAvailability ?? '',
        preferredTags: profile.preferredTags ?? []
      };
    }),
    tournaments: ([...(parsed.tournaments ?? []), ...((parsed.tournaments ?? []).some((tournament) => tournament.id === 'orbit-launch-championship-2026') ? [] : [orbitLaunchTournament()])]).map((tournament) => ({
      ...tournament,
      status: tournament.status ?? 'Draft',
      currentLevelIndex: tournament.currentLevelIndex ?? 0,
      buyIn: tournament.buyIn ?? 0,
      startingStack: tournament.startingStack ?? 10000,
      rebuyPrizePercent: Number(tournament.rebuyPrizePercent ?? 100),
      tableSize: Number(tournament.tableSize ?? 9),
      levels: (tournament.levels ?? []).map((level, index) => ({
        ...level,
        id: level.id ?? uid(),
        level: level.level ?? index + 1,
        smallBlind: Number(level.smallBlind ?? 0),
        bigBlind: Number(level.bigBlind ?? 0),
        ante: Number(level.ante ?? 0),
        durationMinutes: Number(level.durationMinutes ?? 20),
        breakAfter: Boolean(level.breakAfter),
        breakMinutes: Number(level.breakMinutes ?? 0)
      })),
      players: (tournament.players ?? []).map((player) => ({
        ...player,
        id: player.id ?? uid(),
        buyIn: Number(player.buyIn ?? tournament.buyIn ?? 0),
        rebuys: Number(player.rebuys ?? 0),
        addOns: Number(player.addOns ?? 0),
        startingStack: Number(player.startingStack ?? tournament.startingStack ?? 10000),
        status: player.status ?? 'Registered',
        registeredAt: player.registeredAt ?? nowIso()
      })),
      payouts: (tournament.payouts ?? []).map((payout, index) => ({
        place: Number(payout.place ?? index + 1),
        percent: Number(payout.percent ?? 0)
      }))
    })),
    interests: interests.map((interest) => ({
      ...interest,
      gameId: resolveGameId(games, interest.gameId, fallbackGameId)
    })),
    sessions: (parsed.sessions ?? []).map((session) => {
      const legacySession = session as Record<string, unknown>;
      const legacyMode = legacySession[`ra${'ke'}Mode`];
      const legacyTimeFlag = legacySession[`time${'Ra'}ked`];
      const collectionMode =
        session.collectionMode ??
        (legacyMode === 'Time' || legacyMode === 'Drop' ? legacyMode : undefined) ??
        (session.timeFeeBased || legacyTimeFlag ? 'Time' : 'Drop');
      const gameId = resolveGameId(games, session.gameId, session.gameId);
      const game = games.find((item) => item.id === gameId);
      return {
        ...session,
        gameId,
        maxSeats: normalizeTableCap(game?.maxSeats ?? session.maxSeats ?? defaultTableCap),
        collectionMode,
        timeFeeBased: collectionMode === 'Time',
        manualEdits: session.manualEdits ?? {}
      };
    }),
    playerSessions: (() => {
      const occupiedSeatsByTable = new Map<string, Set<number>>();
      return (parsed.playerSessions ?? []).map((session) => {
        const gameId = resolveGameId(games, session.gameId, fallbackGameId);
        const table = (parsed.sessions ?? []).find((item) => item.id === session.tableId);
        const maxSeats = normalizeTableCap(table?.maxSeats ?? games.find((game) => game.id === gameId)?.maxSeats ?? defaultTableCap);
        const occupiedSeats = occupiedSeatsByTable.get(session.tableId) ?? new Set<number>();
        const requestedSeat = Number(session.seatNumber);
        const seatNumber =
          Number.isInteger(requestedSeat) && requestedSeat >= 1 && requestedSeat <= maxSeats && !occupiedSeats.has(requestedSeat)
            ? requestedSeat
            : Array.from({ length: maxSeats }, (_, index) => index + 1).find((seat) => !occupiedSeats.has(seat)) ?? Math.min(maxSeats, occupiedSeats.size + 1);
        occupiedSeats.add(seatNumber);
        occupiedSeatsByTable.set(session.tableId, occupiedSeats);
        return {
          ...session,
          gameId,
          seatNumber,
          timePurchasedMinutes: session.timePurchasedMinutes ?? 0,
          timeRemainingMinutes: session.timeRemainingMinutes ?? 0,
          lastTimeTickAt: session.lastTimeTickAt ?? session.seatedAt,
          timeFeeEnabled: session.timeFeeEnabled ?? Boolean((session as Record<string, unknown>)[`time${'Ra'}keEnabled`]),
          manualEdits: session.manualEdits ?? {}
        };
      });
    })(),
    buyIns: parsed.buyIns ?? [],
    dropLogs: parsed.dropLogs ?? [],
    playerLedger: parsed.playerLedger ?? [
      ...(parsed.playerSessions ?? []).map((session) => ({
        id: uid(),
        type: 'Check-In' as const,
        profileId: session.profileId,
        playerName: session.playerName,
        tableId: session.tableId,
        gameId: session.gameId,
        timestamp: session.seatedAt,
        note: 'Imported from seated player history'
      })),
      ...(parsed.buyIns ?? []).map((buyIn) => ({
        id: uid(),
        type: 'Buy-In' as const,
        profileId: buyIn.profileId,
        playerName: buyIn.playerName,
        tableId: buyIn.tableId,
        gameId: buyIn.gameId,
        amount: buyIn.amount,
        timestamp: buyIn.timestamp,
        note: buyIn.note
      })),
      ...(parsed.playerSessions ?? [])
        .filter((session) => session.leftAt)
        .map((session) => ({
          id: uid(),
          type: 'Cash-Out' as const,
          profileId: session.profileId,
          playerName: session.playerName,
          tableId: session.tableId,
          gameId: session.gameId,
          timestamp: session.leftAt!,
          note: 'Imported from player leave history'
        }))
    ],
    tableEvents: (parsed.tableEvents ?? []).map((event) => ({ ...event, reason: event.reason ?? '' })),
    inAppNotifications: (parsed.inAppNotifications ?? []).map((notification) => ({
      ...notification,
      targetPlayerIds: notification.targetPlayerIds ?? [],
      targetPlayerNames: notification.targetPlayerNames ?? []
    })),
    history: parsed.history ?? [],
    feedback: parsed.feedback ?? [],
    scriptTemplates: parsed.scriptTemplates ?? defaultScriptTemplates,
    correctionLog: parsed.correctionLog ?? [],
    usageEvents: parsed.usageEvents ?? [],
    settings: {
      lowLight: parsed.settings?.lowLight ?? false,
      defaultCollectionMode:
        parsed.settings?.defaultCollectionMode ??
        (((parsed.settings as Record<string, unknown> | undefined)?.[`default${'Ra'}keMode`] === 'Time' ||
          (parsed.settings as Record<string, unknown> | undefined)?.[`default${'Ra'}keMode`] === 'Drop')
          ? (parsed.settings as Record<string, 'Time' | 'Drop'>)[`default${'Ra'}keMode`]
          : 'Drop'),
      defaultTableCap,
      defaultHourlyFee: parsed.settings?.defaultHourlyFee ?? 0,
      defaultEstimatedDropPerSeatHour: parsed.settings?.defaultEstimatedDropPerSeatHour ?? 0,
      collectionProfiles: (
        parsed.settings?.collectionProfiles ??
        ((parsed.settings as Record<string, CollectionProfile[]> | undefined)?.[`ra${'ke'}Profiles`] ?? [])
      ).map((profile) => {
        const legacyProfile = profile as Record<string, unknown>;
        const legacyMode = legacyProfile[`ra${'ke'}Mode`];
        return {
          ...profile,
          collectionMode: profile.collectionMode ?? (legacyMode === 'Time' || legacyMode === 'Drop' ? legacyMode : 'Drop')
        };
      }),
      showPlayerGrid: parsed.settings?.showPlayerGrid ?? true,
      showDashboardKpis: parsed.settings?.showDashboardKpis ?? false,
      showRecentPlayers: parsed.settings?.showRecentPlayers ?? true,
      pilotAccess: parsed.settings?.pilotAccess,
      clubAccount: parsed.settings?.clubAccount,
      staffAccounts: parsed.settings?.staffAccounts ?? [],
      activeStaffId: parsed.settings?.activeStaffId,
      accountLogin: parsed.settings?.accountLogin
        ? {
            ...parsed.settings.accountLogin,
            username: /^\S+@\S+\.\S+$/.test(parsed.settings.accountLogin.username)
              ? parsed.settings.accountLogin.username.toLowerCase()
              : parsed.settings.clubAccount?.email?.trim().toLowerCase() || parsed.settings.accountLogin.username
          }
        : undefined
    }
  };
}

function loadState(): AppState {
  try {
    const lastKey = localStorage.getItem(`${storageKey}:last-account`);
    const stored = localStorage.getItem(lastKey || storageKey) ?? localStorage.getItem(storageKey);
    if (!stored) return seedState;
    return normalizeState(JSON.parse(stored) as Partial<AppState>);
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
  if (canUseRendererFirebaseAuth()) {
    saveClubStateToFirebase(state).catch(() => undefined);
  }
  return localSave.then((result) => {
    return { ...result, cloud: 'firebase-pending' };
  });
}

function getDemand(game: GameConfig, interests: Interest[]) {
  const gameInterests = interests.filter((interest) => interest.gameId === game.id);
  const inRoom = gameInterests.filter((interest) => interest.status === 'Arrived' || interest.status === 'Seated').length;
  const confirmed = gameInterests.filter((interest) => interest.status === 'Confirmed Coming').length;
  const interested = gameInterests.filter((interest) => interest.status === 'Interested').length;
  const waiting = gameInterests.filter((interest) => interest.status === 'Arrived').length;
  const flexibleDemand = confirmed + interested + waiting;
  const totalDemand = inRoom + flexibleDemand;
  const likely = inRoom >= game.minInRoomForLikely && flexibleDemand >= game.minFlexibleForLikely;
  const needs = Math.max(0, game.minTotalForViable - totalDemand);

  return {
    inRoom,
    confirmed,
    interested,
    waiting,
    flexibleDemand,
    totalDemand,
    likely,
    needs,
    status: likely ? 'Likely to Start' : needs === 0 ? 'Viable' : `Needs ${needs} More`
  };
}

function getRunningSessions(state: AppState, gameId: string) {
  return state.sessions.filter((session) => session.gameId === gameId && session.status === 'Running');
}

function getOpenSessions(state: AppState, gameId: string) {
  return state.sessions.filter((session) => session.gameId === gameId && session.status !== 'Closed' && session.status !== 'Failed to Start');
}

function getPlayerLoggedHours(state: AppState, playerSession: PlayerSession) {
  const samePlayerSessions = state.playerSessions.filter((session) =>
    playerSession.profileId
      ? session.profileId === playerSession.profileId
      : session.playerName.toLowerCase() === playerSession.playerName.toLowerCase()
  );
  const total = samePlayerSessions.reduce((sum, session) => sum + hoursBetween(session.seatedAt, session.leftAt ?? nowIso()), 0);
  const tonight = state.playerSessions
    .filter((session) => session.id === playerSession.id || (
      !session.leftAt &&
      (playerSession.profileId
        ? session.profileId === playerSession.profileId
        : session.playerName.toLowerCase() === playerSession.playerName.toLowerCase())
    ))
    .reduce((sum, session) => sum + hoursBetween(session.seatedAt, session.leftAt ?? nowIso()), 0);
  return { tonight, total };
}

function getSessionBuyIns(state: AppState, playerSession: PlayerSession) {
  return state.buyIns.filter((buyIn) =>
    buyIn.tableId === playerSession.tableId &&
    buyIn.gameId === playerSession.gameId &&
    (playerSession.profileId ? buyIn.profileId === playerSession.profileId : buyIn.playerName.toLowerCase() === playerSession.playerName.toLowerCase())
  );
}

function getAverageStackForTable(state: AppState, tableId: string) {
  const activePlayers = state.playerSessions.filter((playerSession) => playerSession.tableId === tableId && !playerSession.leftAt);
  if (!activePlayers.length) return 0;
  const totalBuyIns = activePlayers.reduce(
    (sum, playerSession) => sum + getSessionBuyIns(state, playerSession).reduce((buyInSum, buyIn) => buyInSum + buyIn.amount, 0),
    0
  );
  return Math.round(totalBuyIns / activePlayers.length);
}

function getCollectionProfile(state: AppState, gameId: string): CollectionProfile {
  return state.settings.collectionProfiles.find((profile) => profile.gameId === gameId) ?? {
    gameId,
    collectionMode: state.settings.defaultCollectionMode,
    hourlyFee: state.settings.defaultHourlyFee,
    estimatedDropPerSeatHour: state.settings.defaultEstimatedDropPerSeatHour
  };
}

function getSessionSeatHours(state: AppState, session: GameSession) {
  return state.playerSessions
    .filter((playerSession) => playerSession.tableId === session.id)
    .reduce((sum, playerSession) => sum + hoursBetween(playerSession.seatedAt, playerSession.leftAt), 0);
}

function getViabilityState(state: AppState, game: GameConfig) {
  const demand = getDemand(game, state.interests);
  const running = getRunningSessions(state, game.id);
  const fullTable = running.some((session) => session.seatsFilled >= session.maxSeats);

  if (running.length && fullTable && demand.flexibleDemand >= game.minFlexibleForLikely) {
    return { state: 'Likely to Start', nextStep: 'Second table likely' };
  }

  if (!running.length && demand.inRoom >= game.minInRoomForLikely && demand.totalDemand >= game.minTotalForViable) {
    return { state: 'Ready to Start', nextStep: 'Enough in-room demand to start' };
  }

  if (running.length) {
    const totalSeats = running.reduce((sum, session) => sum + session.seatsFilled, 0);
    const totalCapacity = running.reduce((sum, session) => sum + session.maxSeats, 0);
    if (totalSeats <= Math.floor(totalCapacity * 0.55) && demand.flexibleDemand < 2) {
      return { state: 'Fragile', nextStep: 'Game may not sustain yet' };
    }
    return { state: 'Running', nextStep: demand.waiting ? `${demand.waiting} waiting` : 'Game is active' };
  }

  if (demand.likely) return { state: 'Likely to Start', nextStep: 'Coordinate arrivals' };
  if (demand.totalDemand >= Math.max(2, game.minTotalForViable - 2)) {
    return { state: 'Building', nextStep: `Needs ${demand.needs} more player${demand.needs === 1 ? '' : 's'}` };
  }
  return { state: 'Not Enough Interest', nextStep: `Needs ${demand.needs} more players` };
}

function getTableHealth(state: AppState, session: GameSession) {
  const demand = getDemand(state.games.find((game) => game.id === session.gameId)!, state.interests);
  const fillRate = session.maxSeats ? session.seatsFilled / session.maxSeats : 0;
  if (session.status === 'Forming') return 'Building';
  if (fillRate >= 0.75 || demand.waiting > 0) return 'Healthy';
  if (fillRate >= 0.55 || demand.flexibleDemand >= 2) return 'Needs Attention';
  return 'Fragile';
}

function getOverflowOpportunities(state: AppState) {
  return state.games
    .map((game) => {
      const demand = getDemand(game, state.interests);
      const fullTables = getRunningSessions(state, game.id).filter((session) => session.seatsFilled >= session.maxSeats);
      return {
        game,
        demand,
        fullTables,
        label: `${game.name} full - ${demand.flexibleDemand} waiting/interested - ${
          demand.flexibleDemand >= game.minFlexibleForLikely ? 'second table possible' : 'keep gathering interest'
        }`
      };
    })
    .filter((item) => item.fullTables.length && item.demand.flexibleDemand > 0);
}

function getBalancePlans(state: AppState): BalancePlan[] {
  return state.games
    .map((game) => {
      const demand = getDemand(game, state.interests);
      const runningTables = getRunningSessions(state, game.id).filter((session) => session.seatsFilled >= Math.min(7, session.maxSeats));
      const fromTable = runningTables[0];
      if (!fromTable || demand.totalDemand <= 12) return null;

      const flexibleDemand = demand.confirmed + demand.waiting + demand.interested;
      const inRoomCandidates = state.interests
        .filter((interest) => interest.gameId === game.id && interest.status === 'Arrived')
        .map((interest) => {
          const profile = getProfileForInterest(interest, state.profiles);
          const connectedNames = profile?.usualCompanions.filter((name) =>
            state.interests.some(
              (other) =>
                other.playerName === name &&
                other.gameId === game.id &&
                ['Arrived', 'Confirmed Coming', 'Interested'].includes(other.status)
            )
          ) ?? [];
          const buyInAverage =
            profile && profile.typicalBuyInMax > 0
              ? Math.round((profile.typicalBuyInMin + profile.typicalBuyInMax) / 2)
              : 0;
          const confidence =
            (profile?.preferredGameIds.includes(game.id) || profile?.preferredStakes.includes(game.name) ? 35 : 10) +
            (profile?.willingnessToMove ? 35 : -15) +
            connectedNames.length * 20 +
            Math.min(20, Math.round(buyInAverage / 100));

          return {
            id: interest.id,
            playerName: interest.playerName,
            interest,
            profile,
            confidence,
            reasons: [
              profile?.willingnessToMove ? 'willing to move' : 'ask before moving',
              connectedNames.length ? `connected to ${connectedNames.join(', ')}` : '',
              buyInAverage ? `$${buyInAverage} typical buy-in` : '',
              profile?.preferredStakes || game.name
            ].filter(Boolean),
            source: 'interest' as const
          };
        })
        .sort((a, b) => b.confidence - a.confidence);

      const minimumTableASeats = Math.min(6, fromTable.maxSeats);
      const projectedTableBTarget = Math.min(game.maxSeats, Math.floor(demand.totalDemand / 2));
      const moveNeeded = Math.max(2, projectedTableBTarget - flexibleDemand);
      const maxMovable = Math.max(0, fromTable.seatsFilled - minimumTableASeats);
      const moveCount = Math.min(inRoomCandidates.length, maxMovable, moveNeeded);
      const moveCandidates = inRoomCandidates.slice(0, moveCount);

      if (!moveCandidates.length) return null;

      return {
        game,
        demand,
        fromTable,
        moveCandidates,
        tableASeatsAfterMove: fromTable.seatsFilled - moveCandidates.length,
        tableBProjectedSeats: flexibleDemand + moveCandidates.length,
        nextStep: `${game.name}: move ${moveCandidates.map((candidate) => candidate.playerName).join(', ')} to seed Table B`
      };
    })
    .filter((plan): plan is BalancePlan => Boolean(plan));
}

function getAnalytics(state: AppState) {
  const activeSessions = state.sessions.filter((session) => session.status === 'Running' || session.status === 'Forming');
  const completedSessions = state.sessions.filter((session) => session.endedAt);
  const liveSeatHours = activeSessions.reduce(
    (sum, session) => sum + session.seatsFilled * hoursBetween(session.startedAt),
    0
  );
  const completedSeatHours = completedSessions.reduce(
    (sum, session) => sum + session.seatsFilled * hoursBetween(session.startedAt, session.endedAt),
    0
  );
  const playerSeatHours = state.playerSessions.reduce(
    (sum, session) => sum + hoursBetween(session.seatedAt, session.leftAt),
    0
  );
  const completedWaits = state.interests.filter((interest) => interest.arrivedAt && interest.seatedAt);
  const waitMinutes = completedWaits.map(
    (interest) => (new Date(interest.seatedAt!).getTime() - new Date(interest.arrivedAt!).getTime()) / 60000
  );
  const arrivalWaits = state.interests.filter((interest) => interest.interestedAt && interest.arrivedAt);
  const confirmedComing = state.interests.filter((interest) => interest.confirmedAt || interest.status === 'Confirmed Coming');
  const confirmedArrived = confirmedComing.filter((interest) => interest.arrivedAt || interest.status === 'Arrived' || interest.status === 'Seated');
  const durations = state.sessions.map((session) => hoursBetween(session.startedAt, session.endedAt));
  const conversionEligible = state.interests.filter((interest) => interest.status !== 'Removed');
  const convertedWaiters = state.interests.filter((interest) => interest.seatedAt).length;
  const noShows = state.interests.filter((interest) => interest.status === 'No-Show').length;
  const declined = state.interests.filter((interest) => interest.status === 'Declined').length;
  const leftBeforeSeated = state.interests.filter((interest) => interest.status === 'Left Before Seated').length;
  const totalArrivals = state.interests.filter((interest) => interest.arrivedAt || interest.status === 'Arrived' || interest.status === 'Seated').length;
  const seatHoursByGame = state.games.map((game) => ({
    game: game.name,
    hours: state.playerSessions
      .filter((session) => session.gameId === game.id)
      .reduce((sum, session) => sum + hoursBetween(session.seatedAt, session.leftAt), 0)
  }));
  const seatHoursByTable = state.sessions.map((session) => ({
    table: session.label,
    game: state.games.find((game) => game.id === session.gameId)?.name ?? 'Unknown',
    hours: state.playerSessions
      .filter((playerSession) => playerSession.tableId === session.id)
      .reduce((sum, playerSession) => sum + hoursBetween(playerSession.seatedAt, playerSession.leftAt), 0)
  }));
  const estimatedTimeFeeRevenue = state.playerSessions.reduce((sum, playerSession) => {
    const session = state.sessions.find((item) => item.id === playerSession.tableId);
    if (!session || session.collectionMode !== 'Time') return sum;
    const profile = getCollectionProfile(state, playerSession.gameId);
    return sum + ((playerSession.timePurchasedMinutes ?? 0) / 60) * profile.hourlyFee;
  }, 0);
  const expiredTimeFeeSeats = state.playerSessions.filter((playerSession) => {
    const session = state.sessions.find((item) => item.id === playerSession.tableId);
    return session?.collectionMode === 'Time' && !playerSession.leftAt && (playerSession.timePurchasedMinutes ?? 0) > 0 && getTimeRemainingMinutes(playerSession) <= 0;
  }).length;
  const recordedDropTotal = state.dropLogs.reduce((sum, drop) => sum + drop.amount, 0);
  const estimatedDropRevenue = state.sessions.reduce((sum, session) => {
    if (session.collectionMode !== 'Drop') return sum;
    return sum + getSessionSeatHours(state, session) * getCollectionProfile(state, session.gameId).estimatedDropPerSeatHour;
  }, 0);
  const collectionValueByGame = state.games.map((game) => {
    const timeRevenue = state.playerSessions
      .filter((playerSession) => playerSession.gameId === game.id)
      .reduce((sum, playerSession) => {
        const session = state.sessions.find((item) => item.id === playerSession.tableId);
        return session?.collectionMode === 'Time'
          ? sum + ((playerSession.timePurchasedMinutes ?? 0) / 60) * getCollectionProfile(state, game.id).hourlyFee
          : sum;
      }, 0);
    const recordedDrop = state.dropLogs
      .filter((drop) => drop.gameId === game.id)
      .reduce((sum, drop) => sum + drop.amount, 0);
    const estimatedDrop = state.sessions
      .filter((session) => session.gameId === game.id && session.collectionMode === 'Drop')
      .reduce((sum, session) => sum + getSessionSeatHours(state, session) * getCollectionProfile(state, game.id).estimatedDropPerSeatHour, 0);
    return { game: game.name, timeRevenue, recordedDrop, estimatedDrop };
  });
  const waitByGame = state.games.map((game) => {
    const waits = completedWaits
      .filter((interest) => interest.gameId === game.id)
      .map((interest) => (new Date(interest.seatedAt!).getTime() - new Date(interest.arrivedAt!).getTime()) / 60000);
    return {
      game: game.name,
      averageMinutes: waits.length ? waits.reduce((sum, value) => sum + value, 0) / waits.length : 0,
      count: waits.length
    };
  });
  const failedStartEvents = state.tableEvents.filter((event) => event.type === 'Failed to Start');
  const lostSeatHourEstimate = failedStartEvents.length * 2 + leftBeforeSeated * 1.5;
  const currentNight: NightRecord = {
    id: 'current',
    date: new Date().toISOString().slice(0, 10),
    occupiedSeatHours: Math.max(liveSeatHours + completedSeatHours, playerSeatHours),
    gamesStarted: state.sessions.filter((session) => session.status !== 'Closed').length,
    averageSessionDurationHours: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
    averageActiveTables: activeSessions.length,
    waitlistConversionRate: conversionEligible.length ? convertedWaiters / conversionEligible.length : 0,
    hadTwoPlusTables: activeSessions.length >= 2
  };
  return {
    currentNight,
    activeTables: activeSessions.length,
    averageSeatsOccupied: activeSessions.length
      ? activeSessions.reduce((sum, session) => sum + session.seatsFilled, 0) / activeSessions.length
      : 0,
    averageSeatHoursPerPlayer: state.playerSessions.length ? playerSeatHours / state.playerSessions.length : 0,
    averageWaitMinutes: waitMinutes.length ? waitMinutes.reduce((sum, value) => sum + value, 0) / waitMinutes.length : 0,
    medianWaitMinutes: median(waitMinutes),
    averageInterestToArrivalMinutes: arrivalWaits.length
      ? arrivalWaits.reduce((sum, interest) => sum + (new Date(interest.arrivedAt!).getTime() - new Date(interest.interestedAt).getTime()) / 60000, 0) /
        arrivalWaits.length
      : 0,
    conversionRate: conversionEligible.length ? convertedWaiters / conversionEligible.length : 0,
    noShowRate: conversionEligible.length ? noShows / conversionEligible.length : 0,
    declineRate: conversionEligible.length ? declined / conversionEligible.length : 0,
    leftBeforeSeatedRate: conversionEligible.length ? leftBeforeSeated / conversionEligible.length : 0,
    noShows,
    declined,
    leftBeforeSeated,
    confirmedArrivalRate: confirmedComing.length ? confirmedArrived.length / confirmedComing.length : 0,
    waitlistAbandonmentCount: leftBeforeSeated + declined,
    lostSeatHourEstimate,
    failedStarts: state.tableEvents.filter((event) => event.type === 'Failed to Start').length,
    tableBreaks: state.tableEvents.filter((event) => event.type === 'Broke' || event.type === 'Closed').length,
    secondTablesStarted: state.sessions.filter((session) => session.status !== 'Failed to Start' && session.label !== 'Main Table').length,
    totalArrivals,
    peakWaitlistPressure: Math.max(...state.games.map((game) => getDemand(game, state.interests).waiting + getDemand(game, state.interests).interested), 0),
    seatHoursByGame,
    seatHoursByTable,
    estimatedTimeFeeRevenue,
    expiredTimeFeeSeats,
    recordedDropTotal,
    estimatedDropRevenue,
    collectionValueByGame,
    waitByGame,
    peakActiveTables: Math.max(activeSessions.length, state.history.reduce((max, night) => Math.max(max, night.averageActiveTables), 0)),
    peakInterestedByGame: state.games
      .map((game) => ({ game: game.name, count: getDemand(game, state.interests).totalDemand }))
      .sort((a, b) => b.count - a.count)[0]
  };
}

function getUsageAnalytics(state: AppState) {
  const events = state.usageEvents ?? [];
  const eventsByFeature = [...events.reduce((map, event) => {
    const current = map.get(event.feature) ?? { feature: event.feature, count: 0, lastUsedAt: '' };
    current.count += 1;
    current.lastUsedAt = current.lastUsedAt && current.lastUsedAt > event.timestamp ? current.lastUsedAt : event.timestamp;
    map.set(event.feature, current);
    return map;
  }, new Map<string, { feature: string; count: number; lastUsedAt: string }>()).values()].sort((a, b) => b.count - a.count);
  const eventsByAction = [...events.reduce((map, event) => {
    const key = `${event.feature}:${event.action}`;
    const current = map.get(key) ?? { key, feature: event.feature, action: event.action, count: 0, lastUsedAt: '' };
    current.count += 1;
    current.lastUsedAt = current.lastUsedAt && current.lastUsedAt > event.timestamp ? current.lastUsedAt : event.timestamp;
    map.set(key, current);
    return map;
  }, new Map<string, { key: string; feature: string; action: string; count: number; lastUsedAt: string }>()).values()].sort((a, b) => b.count - a.count);
  const eventsByStaff = [...events.reduce((map, event) => {
    const key = event.staffId || 'unassigned';
    const current = map.get(key) ?? { key, staffName: event.staffName || 'Unassigned', staffRole: event.staffRole || '', count: 0, lastUsedAt: '' };
    current.count += 1;
    current.lastUsedAt = current.lastUsedAt && current.lastUsedAt > event.timestamp ? current.lastUsedAt : event.timestamp;
    map.set(key, current);
    return map;
  }, new Map<string, { key: string; staffName: string; staffRole: string; count: number; lastUsedAt: string }>()).values()].sort((a, b) => b.count - a.count);
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  return {
    totalEvents: events.length,
    eventsLast24Hours: events.filter((event) => new Date(event.timestamp).getTime() >= oneDayAgo).length,
    eventsLast7Days: events.filter((event) => new Date(event.timestamp).getTime() >= sevenDaysAgo).length,
    eventsByFeature,
    eventsByAction,
    eventsByStaff,
    recentEvents: [...events].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 20)
  };
}

function buildAnalyticalReportPayload(
  state: AppState,
  analytics: ReturnType<typeof getAnalytics>,
  usageAnalytics: ReturnType<typeof getUsageAnalytics>
): AnalyticalReportPayload {
  const account = state.settings.clubAccount;
  const access = state.settings.pilotAccess;
  return {
    app: 'TableManager',
    kind: 'analytical-report',
    version: 1,
    generatedAt: nowIso(),
    account: {
      accountKey: getAccountKeyFromState(state),
      clubName: account?.clubName ?? '',
      accountName: account?.accountName ?? '',
      contactName: account?.contactName ?? '',
      email: account?.email ?? '',
      license: access?.licenseId || access?.authorizationCode || ''
    },
    operational: {
      occupiedSeatHours: Number(analytics.currentNight.occupiedSeatHours.toFixed(1)),
      averageWaitMinutes: Number(analytics.averageWaitMinutes.toFixed(0)),
      waitlistConversionRate: Number((analytics.conversionRate * 100).toFixed(0)),
      gamesStarted: analytics.currentNight.gamesStarted,
      tableBreaks: analytics.tableBreaks,
      failedStarts: analytics.failedStarts,
      medianWaitMinutes: Number(analytics.medianWaitMinutes.toFixed(0)),
      noShows: analytics.noShows,
      declined: analytics.declined,
      leftBeforeSeated: analytics.leftBeforeSeated,
      confirmedArrivalRate: Number((analytics.confirmedArrivalRate * 100).toFixed(0)),
      lostSeatHourEstimate: Number(analytics.lostSeatHourEstimate.toFixed(1)),
      secondTablesStarted: analytics.secondTablesStarted,
      totalArrivals: analytics.totalArrivals,
      activeTables: analytics.activeTables,
      estimatedTimeFeeRevenue: Number(analytics.estimatedTimeFeeRevenue.toFixed(2)),
      expiredTimeFeeSeats: analytics.expiredTimeFeeSeats,
      recordedDropTotal: Number(analytics.recordedDropTotal.toFixed(2)),
      estimatedDropRevenue: Number(analytics.estimatedDropRevenue.toFixed(2))
    },
    collectionByGame: analytics.collectionValueByGame,
    usage: {
      totalEvents: usageAnalytics.totalEvents,
      eventsLast24Hours: usageAnalytics.eventsLast24Hours,
      eventsLast7Days: usageAnalytics.eventsLast7Days,
      features: usageAnalytics.eventsByFeature,
      actions: usageAnalytics.eventsByAction,
      staff: usageAnalytics.eventsByStaff,
      recentEvents: usageAnalytics.recentEvents
    },
    feedback: state.feedback
  };
}

function getClosestGameLabel(state: AppState) {
  const closest = state.games
    .map((game) => ({ game, demand: getDemand(game, state.interests) }))
    .sort((a, b) => a.demand.needs - b.demand.needs || b.demand.totalDemand - a.demand.totalDemand)[0];

  if (!closest) return '-';
  return closest.demand.likely ? `${closest.game.name} likely` : `${closest.game.name}: needs ${closest.demand.needs}`;
}

function getProfileForInterest(interest: Interest, profiles: PlayerProfile[]) {
  return (
    profiles.find((profile) => profile.id === interest.profileId) ??
    profiles.find((profile) => profile.name.toLowerCase() === interest.playerName.toLowerCase())
  );
}

function getInClubInterests(state: AppState) {
  return state.interests.filter((interest) => interest.status === 'Arrived' || interest.status === 'Seated');
}

function getInClubNames(state: AppState) {
  return new Set(getInClubInterests(state).map((interest) => interest.playerName));
}

function getParticipantPool(state: AppState, gameId: string, seats: number): ParticipantCandidate[] {
  const availabilityScore: Record<InterestStatus, number> = {
    Arrived: 100,
    Seated: 96,
    Interested: 58,
    'Confirmed Coming': 76,
    Declined: 0,
    'No-Show': 0,
    'Left Before Seated': 0,
    Removed: 0
  };
  const available = state.interests.filter((interest) => activeInterestStatuses.includes(interest.status) && interest.gameId === gameId);
  const inClubNames = getInClubNames(state);
  const interestNames = new Set(state.interests.map((interest) => interest.playerName.toLowerCase()));

  const interestCandidates = available
    .map((interest) => {
      const profile = getProfileForInterest(interest, state.profiles);
      const companions = profile?.usualCompanions ?? [];
      const companionMatches = companions.filter((name) => inClubNames.has(name));
      const gameMatch = interest.gameId === gameId || !!profile?.preferredGameIds.includes(gameId);
      const tagMatches = profile?.preferredTags.filter((tag) =>
        state.sessions.some((session) => session.gameId === gameId && session.tags.includes(tag))
      ) ?? [];
      const buyInAverage =
        profile && profile.typicalBuyInMax > 0
          ? Math.round((profile.typicalBuyInMin + profile.typicalBuyInMax) / 2)
          : 0;
      const buyInScore = buyInAverage ? Math.min(18, Math.round(buyInAverage / 100)) : 0;
      const confidence =
        availabilityScore[interest.status] +
        (gameMatch ? 28 : -18) +
        Math.min(14, tagMatches.length * 7) +
        Math.min(24, companionMatches.length * 8) +
        buyInScore;
      const reasons = [
        interest.status,
        gameMatch ? 'game/stakes fit' : 'alternate game',
        tagMatches.length ? `fits ${tagMatches.join(', ')}` : '',
        companionMatches.length ? `connected to ${companionMatches.join(', ')}` : '',
        buyInAverage ? `$${buyInAverage} typical buy-in` : ''
      ].filter(Boolean);

      return {
        id: interest.id,
        playerName: interest.playerName,
        interest,
        profile,
        confidence,
        reasons,
        source: 'interest' as const
      };
    });

  const connectedProfileCandidates = state.profiles
    .filter((profile) => !interestNames.has(profile.name.toLowerCase()))
    .map((profile) => {
      const connectedNames = profile.usualCompanions.filter((name) => inClubNames.has(name));
      const gameMatch = profile.preferredGameIds.includes(gameId) || profile.preferredStakes.includes(state.games.find((game) => game.id === gameId)?.name ?? '');
      const tagMatches = profile.preferredTags.filter((tag) =>
        state.sessions.some((session) => session.gameId === gameId && session.tags.includes(tag))
      );
      if (!connectedNames.length && !gameMatch) return null;
      const buyInAverage = profile.typicalBuyInMax > 0 ? Math.round((profile.typicalBuyInMin + profile.typicalBuyInMax) / 2) : 0;
      const confidence = (gameMatch ? 62 : 20) + connectedNames.length * 22 + tagMatches.length * 8 + Math.min(18, Math.round(buyInAverage / 100));
      return {
        id: `profile-${profile.id}`,
        playerName: profile.name,
        profile,
        confidence,
        reasons: [
          gameMatch ? 'game/stakes fit' : 'possible fit',
          tagMatches.length ? `fits ${tagMatches.join(', ')}` : '',
          connectedNames.length ? `connected to ${connectedNames.join(', ')}` : '',
          buyInAverage ? `$${buyInAverage} typical buy-in` : ''
        ].filter(Boolean),
        source: 'connected-profile' as const
      };
    })
    .filter((candidate): candidate is ParticipantCandidate => Boolean(candidate));

  return [...interestCandidates, ...connectedProfileCandidates]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, seats);
}

function getLikelyParticipants(state: AppState) {
  const activePlayerNames = getInClubNames(state);

  return state.games
    .flatMap((game) => {
      const demand = getDemand(game, state.interests);
      return state.profiles
        .filter((profile) => !activePlayerNames.has(profile.name))
        .map((profile) => {
          const prefersGame = profile.preferredGameIds.includes(game.id) || profile.preferredStakes.includes(game.name);
          const tagMatches = profile.preferredTags.filter((tag) =>
            state.sessions.some((session) => session.gameId === game.id && session.tags.includes(tag))
          );
          const companionMatches = profile.usualCompanions.filter((name) => activePlayerNames.has(name));
          const buyInAverage =
            profile.typicalBuyInMax > 0 ? Math.round((profile.typicalBuyInMin + profile.typicalBuyInMax) / 2) : 0;
          const confidence =
            (prefersGame ? 55 : 8) +
            demand.totalDemand * 7 +
            companionMatches.length * 18 +
            tagMatches.length * 8 +
            Math.min(20, Math.round(buyInAverage / 100));
          const reason = [
            prefersGame ? `prefers ${game.name}` : `possible ${game.name}`,
            tagMatches.length ? `fits ${tagMatches.join(', ')}` : '',
            demand.totalDemand ? `${demand.totalDemand} already interested` : '',
            companionMatches.length ? `connected to ${companionMatches.join(', ')}` : '',
            demand.needs ? `needs ${demand.needs}` : 'table viable'
          ].filter(Boolean);

          return {
            id: `${profile.id}-${game.id}`,
            profile,
            game,
            confidence,
            reason,
            message: `${profile.name}, ${game.name} is close to forming. ${demand.totalDemand} players are already in or interested. Would you want a seat if it starts?`
          };
        });
    })
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8);
}

function renderScriptTemplate(template: string, game: GameConfig, demand: ReturnType<typeof getDemand>) {
  return template
    .replaceAll('{game}', game.name)
    .replaceAll('{inRoom}', demand.inRoom.toString())
    .replaceAll('{coming}', demand.confirmed.toString())
    .replaceAll('{waiting}', (demand.interested + demand.waiting).toString())
    .replaceAll('{needs}', demand.needs.toString());
}

function getStaffScripts(state: AppState) {
  const gameScripts = state.games.flatMap((game) => {
    const demand = getDemand(game, state.interests);
    const running = getRunningSessions(state, game.id);
    const full = running.some((session) => session.seatsFilled >= session.maxSeats);
    const scripts = [{ label: `${game.name}: current demand`, text: renderScriptTemplate(state.scriptTemplates[0] ?? defaultScriptTemplates[0], game, demand) }];
    if (full && demand.flexibleDemand > 0) {
      scripts.push({
        label: `${game.name}: overflow`,
        text: renderScriptTemplate(state.scriptTemplates[1] ?? defaultScriptTemplates[1], game, demand)
      });
    }
    if (demand.needs > 0) {
      scripts.push({
        label: `${game.name}: needs more`,
        text: renderScriptTemplate(state.scriptTemplates[2] ?? defaultScriptTemplates[2], game, demand)
      });
    } else {
      scripts.push({
        label: `${game.name}: likely`,
        text: renderScriptTemplate(state.scriptTemplates[3] ?? defaultScriptTemplates[3], game, demand)
      });
    }
    return scripts;
  });
  return gameScripts.slice(0, 8);
}

function getOperationalOpportunities(state: AppState, analytics: ReturnType<typeof getAnalytics>) {
  const opportunities: string[] = [];
  if (analytics.failedStarts >= 2) {
    opportunities.push('Repeated failed starts: review arrival confirmation process.');
  }
  if (analytics.averageWaitMinutes >= 30 && analytics.conversionRate < 0.5) {
    opportunities.push('High wait with low conversion: reduce uncertainty for incoming players.');
  }
  if ((analytics.peakInterestedByGame?.count ?? 0) >= 8 && analytics.currentNight.gamesStarted <= 1) {
    opportunities.push('Strong demand with few starts: focus on second-table coordination.');
  }
  if (analytics.tableBreaks >= 2) {
    opportunities.push('Table breaks above normal: review late-night sustainability.');
  }
  if (!opportunities.length) {
    opportunities.push('No major operational flags yet. Keep tracking wait pressure and table starts.');
  }
  return opportunities;
}

function parseGroupMeMessages(text: string, games: GameConfig[]): GroupMeCandidate[] {
  const statusFromLine = (line: string): InterestStatus =>
    /on my way|coming|eta|be there/i.test(line)
      ? 'Confirmed Coming'
      : /here|arrived|in room|at the room/i.test(line)
        ? 'Arrived'
        : 'Interested';

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const matchedGame =
        games.find((game) => line.toLowerCase().includes(game.name.toLowerCase())) ??
        games.find((game) => game.name.includes('1/2') && /\b1\s*\/\s*2\b|1-2/i.test(line)) ??
        games.find((game) => game.name.includes('2/5') && /\b2\s*\/\s*5\b|2-5/i.test(line)) ??
        games.find((game) => game.name.toLowerCase().includes('plo') && /plo/i.test(line));
      if (!matchedGame) return null;
      const nameMatch = line.match(/^([A-Za-z][A-Za-z .'-]{1,32})[:\-]/) ?? line.match(/\bfrom\s+([A-Za-z][A-Za-z .'-]{1,32})\b/i);
      const playerName = (nameMatch?.[1] ?? line.split(/\s+/)[0] ?? 'Unknown').trim();
      const confidence = /interested|play|seat|list|coming|eta|arrived|here|in/i.test(line) ? 82 : 62;
      return {
        id: uid(),
        playerName,
        gameId: matchedGame.id,
        status: statusFromLine(line),
        timestamp: nowIso(),
        confidence,
        sourceText: line
      };
    })
    .filter((candidate): candidate is GroupMeCandidate => Boolean(candidate));
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
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [profileEditDraft, setProfileEditDraft] = useState<PlayerProfile | null>(null);
  const [groupMeText, setGroupMeText] = useState('');
  const [groupMeCandidates, setGroupMeCandidates] = useState<GroupMeCandidate[]>([]);
  const [staffFeedback, setStaffFeedback] = useState('');
  const [ownerFeedback, setOwnerFeedback] = useState('');
  const [pendingPilotAccess, setPendingPilotAccess] = useState<PilotAccess | null>(null);
  const [pilotKeyError, setPilotKeyError] = useState('');
  const [hasAuthenticated, setHasAuthenticated] = useState(() => hasPersistedSignIn(state));
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
    formingGames: true,
    kpis: false,
    quickAdd: false
  });
  const stateRef = useRef(state);
  const [overviewTableId, setOverviewTableId] = useState('all-time-overview');
  const [waitlistPopupOpen, setWaitlistPopupOpen] = useState(false);
  const [playerPopup, setPlayerPopup] = useState<'add' | 'ledger' | null>(null);
  const [settingsSection, setSettingsSection] = useState<'club' | 'staff' | 'tables' | 'data' | 'display'>('club');
  const [reportMode, setReportMode] = useState<'kpis' | 'night'>('kpis');
  const [kpiCategory, setKpiCategory] = useState<'operations' | 'waitlist' | 'tables' | 'collections'>('operations');
  const [gameFormatFilter, setGameFormatFilter] = useState('All formats');
  const [gameStakesFilter, setGameStakesFilter] = useState('All stakes');
  const [gameStatusFilter, setGameStatusFilter] = useState('All statuses');
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [coordinationConfig, setCoordinationConfig] = useState({ gameId: 'nlh-1-2', seats: 10 });
  const analytics = useMemo(() => getAnalytics(state), [state]);
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
  const balancePlans = useMemo(() => getBalancePlans(state), [state]);
  const activeAccountKey = getAccountKeyFromState(state);
  const selectedTournament = useMemo(
    () => state.tournaments.find((tournament) => tournament.id === selectedTournamentId) ?? state.tournaments[0] ?? null,
    [selectedTournamentId, state.tournaments]
  );

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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
  const duplicateProfiles = useMemo(() => {
    const groups = new Map<string, PlayerProfile[]>();
    state.profiles.forEach((profile: { name: any; id?: string; preferredGameIds?: string[]; preferredStakes?: string; typicalBuyInMin?: number; typicalBuyInMax?: number; willingnessToMove?: boolean; typicalAvailability?: string; usualCompanions?: string[]; preferredTags?: TableTag[]; notes?: string; }) => {
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
    document.body.classList.toggle('low-light', state.settings.lowLight);
    applyBrandTheme(state.settings.lowLight ? branding.theme.lowLight : branding.theme.default);
    document.title = branding.product.name;
  }, [state.settings.lowLight]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    window.tableManagerDesktop?.getBackendStatus()
      .then((status) => setBackendStatus(status))
      .catch(() => undefined);
  }, []);

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
    if (!activeAccountKey) return;
    let cancelled = false;
    const syncPlayerUpdates = () => {
      const currentState = stateRef.current;
      syncPlayerUpdatesToClubState<AppState>(currentState)
        .then((nextState) => {
          if (cancelled) return;
          const latestState = stateRef.current;
          const sameProfiles = JSON.stringify(nextState.profiles) === JSON.stringify(latestState.profiles);
          const sameInterests = JSON.stringify(nextState.interests) === JSON.stringify(latestState.interests);
          if (sameProfiles && sameInterests) return;
          const mergedState = {
            ...latestState,
            profiles: mergeSyncedList(latestState.profiles, nextState.profiles),
            interests: mergeSyncedList(latestState.interests, nextState.interests)
          };
          setUndoStack((current) => [latestState, ...current].slice(0, 20));
          setState(mergedState);
          setSaveStatus({ state: 'saving', message: 'Syncing player updates...' });
          saveState(mergedState)
            .then(() => setSaveStatus({ state: 'saved', message: 'Player updates synced' }))
            .catch(() => setSaveStatus({ state: 'error', message: 'Player update sync failed' }));
        })
        .catch(() => undefined);
    };
    const unsubscribe = subscribeToPlayerRequestUpdates(activeAccountKey, syncPlayerUpdates);
    return () => {
      cancelled = true;
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
    const nextState = promptDemandAction({
      ...state,
      interests: [
        {
          id: uid(),
          profileId: existingProfile?.id,
          playerName,
          gameId: form.gameId,
          status: form.status,
          notes: form.notes.trim(),
          timestamp: nowIso(),
          interestedAt: nowIso(),
          confirmedAt: form.status === 'Confirmed Coming' ? nowIso() : undefined,
          arrivedAt: form.status === 'Arrived' ? nowIso() : undefined,
          seatedAt: form.status === 'Seated' ? nowIso() : undefined
        },
        ...state.interests
      ]
    }, form.gameId);
    persist(nextState, true, { feature: 'Waitlist', action: 'Added interest', metadata: { status: form.status, gameId: form.gameId } });
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
    addProfileToClub(profile);
    setCheckInSearch('');
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
      interests: state.interests.map((interest: { id: string; timestamp: any; manualEdits: any; }) =>
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
      interests: state.interests.map((item: { id: string; manualEdits: Record<string, string> | undefined; }) =>
        item.id === id ? { ...item, [key]: nextValue, manualEdits: markManualEdit(item.manualEdits, key) } : item
      ),
      playerSessions: state.playerSessions.map((session: { playerName: any; gameId: any; manualEdits: Record<string, string> | undefined; }) => {
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
      playerSessions: state.playerSessions.map((session: { id: string; manualEdits: Record<string, string> | undefined; }) =>
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
    const existing = sourceState.interests.find(
      (interest) =>
        (interest.profileId === profile.id || interest.playerName.toLowerCase() === profile.name.toLowerCase()) &&
        interest.gameId === gameId &&
        !inactiveInterestStatuses.includes(interest.status)
    );
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
        const activeInterest = state.interests.find(
          (interest) =>
            (interest.profileId === profile.id || interest.playerName.toLowerCase() === profile.name.toLowerCase()) &&
            activeInterestStatuses.includes(interest.status)
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
    const alreadyInClub = state.interests.some(
      (interest) =>
        (interest.profileId === profile.id || interest.playerName.toLowerCase() === profile.name.toLowerCase()) &&
        activeInterestStatuses.includes(interest.status)
    );
    const checkedInState: AppState = alreadyInClub
      ? state
      : {
          ...state,
          interests: ensureInterestEntry(state, profile, session.gameId, 'Arrived', 'Checked in from table seat picker', timestamp)
        };
    const interest = checkedInState.interests.find(
      (item) =>
        item.gameId === session.gameId &&
        activeInterestStatuses.includes(item.status) &&
        (item.profileId === profile.id || item.playerName.toLowerCase() === profile.name.toLowerCase())
    ) ?? checkedInState.interests.find(
      (item) =>
        activeInterestStatuses.includes(item.status) &&
        (item.profileId === profile.id || item.playerName.toLowerCase() === profile.name.toLowerCase())
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
    const sourceTable = state.sessions.find((session: { id: string; }) => session.id === playerSession.tableId);
    const targetTable = state.sessions.find((session: { id: string; }) => session.id === targetTableId);
    if (!targetTable) return;
    const targetSeatNumber = getAvailableSeatNumber(targetTable, playerSession.seatNumber) ?? getAvailableSeatNumber(targetTable);
    if (!targetSeatNumber) {
      window.alert('No open seats on the target table.');
      return;
    }
    const movedState = {
      ...state,
      playerSessions: state.playerSessions.map((session: { id: string; manualEdits: Record<string, string> | undefined; }) =>
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
      (session: { playerName: string; gameId: string; leftAt: any; }) => session.playerName === interest.playerName && session.gameId === interest.gameId && !session.leftAt
    );

    const nextState = {
      ...state,
      interests: state.interests.map((item: { id: string; }) =>
        item.id === interest.id ? { ...item, status: 'Removed', closedAt: nowIso(), timestamp: nowIso() } : item
      ),
      playerSessions: state.playerSessions.map((session: { id: any; }) =>
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
    const nextState = {
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
        profile.id === playerSession.profileId ||
        (!playerSession.profileId && profile.name.toLowerCase() === playerSession.playerName.toLowerCase())
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
    const nextState = {
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
      .filter((candidate: { interest: any; }) => !candidate.interest)
      .map((candidate: { profile: { id: any; }; playerName: any; }) => ({
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
            ...participantPool.filter((candidate: { interest: any; }) => candidate.interest).map((candidate: { interest: any; }) => candidate.interest!.id),
            ...newInterests.map((interest: { id: any; }) => interest.id)
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
        ...state.sessions.map((session: { id: string; plannedPlayerIds: any; }) =>
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
      sessions: state.sessions.map((session: { id: string; endedAt: any; manualEdits: any; }) => {
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
      sessions: state.sessions.map((session: { id: string; manualEdits: Record<string, string> | undefined; }) =>
        session.id === id ? { ...session, [key]: nextValue, manualEdits: markManualEdit(session.manualEdits, key) } : session
      )
    }, id, key, 'Table timestamp corrected'));
  };

  const recordTableEvent = (session: GameSession, type: TableEventType, reason: string, note = '') => {
    persist({
      ...state,
      sessions: state.sessions.map((item: { id: string; status: any; endedAt: any; }) =>
        item.id === session.id
          ? {
              ...item,
              status: type === 'Started' ? 'Running' : type === 'Failed to Start' ? 'Failed to Start' : type === 'Broke' || type === 'Closed' ? 'Closed' : item.status,
              endedAt:
                type === 'Failed to Start' || type === 'Broke' || type === 'Closed'
                  ? item.endedAt ?? nowIso()
                  : item.endedAt
            }
          : item
      ),
      playerSessions:
        type === 'Broke' || type === 'Closed'
          ? state.playerSessions.map((playerSession: { tableId: string; leftAt: any; }) =>
              playerSession.tableId === session.id && !playerSession.leftAt
                ? { ...playerSession, leftAt: nowIso() }
                : playerSession
            )
          : state.playerSessions,
      tableEvents: [
        ...state.tableEvents,
        {
          id: uid(),
          type,
          gameId: session.gameId,
          tableId: session.id,
          timestamp: nowIso(),
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
    persist({
      ...state,
      profiles: [
        ...state.profiles,
        {
          id: memberId(),
          name: profileName,
          phone: newProfile.phone.trim(),
          birthday: newProfile.birthday,
          membershipStartDate: newProfile.membershipStartDate,
          membershipExpirationDate: newProfile.membershipExpirationDate,
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
      ]
    }, true, { feature: 'Profiles', action: 'Added profile', metadata: { preferredGameId: newProfile.preferredGameId } });
    setProfileFormMessage(`${profileName} profile added.`);
    setNewProfile({
      name: '',
      birthday: '',
      membershipStartDate: todayDate(),
      membershipExpirationDate: nextYearDate(),
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

  const addDemoProfile = () => {
    const demoName = 'Demo Player';
    const existingDemo = state.profiles.find((profile) => profile.name.toLowerCase() === demoName.toLowerCase());
    if (existingDemo) {
      setProfileSearch(demoName);
      return;
    }
    const preferredGame = state.games[0] ?? { id: 'nlh-1-2', name: '1/2 NLH' };
    const companionIds = state.profiles.slice(0, 2).map((profile) => profile.id);
    persist({
      ...state,
      profiles: [
        ...state.profiles,
        {
          id: memberId(),
          name: demoName,
          phone: '',
          birthday: '1990-05-22',
          membershipStartDate: todayDate(),
          membershipExpirationDate: nextYearDate(),
          totalTimePlayedHours: 56.5,
          lastSessionTimePlayedHours: 4.25,
          commonlyPlaysWithProfileIds: companionIds,
          preferredGameId: preferredGame.id,
          preferredGameIds: [preferredGame.id],
          gamePlayCounts: { [preferredGame.id]: 10 },
          mostPlayedGameId: preferredGame.id,
          preferredStakes: preferredGame.name,
          typicalBuyInMin: 200,
          typicalBuyInMax: 700,
          willingnessToMove: true,
          typicalAvailability: 'Weeknights after 7, Sundays flexible',
          preferredTags: ['Social', 'Action', 'Beginner-Friendly'],
          usualCompanions: state.profiles
            .slice(0, 2)
            .map((profile) => profile.name)
            .filter(Boolean),
          notes: 'Demo profile for testing player app sync, loyalty, recommendations, and club add/remove flows.'
        }
      ]
    }, true, { feature: 'Profiles', action: 'Added demo profile' });
    setProfileSearch(demoName);
  };

  const deleteProfile = (id: string) => {
    if (!window.confirm('Remove this profile? Existing sessions and interest entries will keep the player name.')) return;
    persist({
      ...state,
      profiles: state.profiles.filter((profile: { id: string; }) => profile.id !== id),
      interests: state.interests.map((interest: { profileId: string; }) =>
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
      profiles: state.profiles.map((profile: { id: string; }) => (profile.id === primary.id ? merged : profile)).filter((profile: { id: string; }) => !duplicateIds.has(profile.id)),
      interests: state.interests.map((interest: { profileId: string; }) =>
        interest.profileId && duplicateIds.has(interest.profileId) ? { ...interest, profileId: primary.id } : interest
      ),
      playerSessions: state.playerSessions.map((session: { profileId: string; }) =>
        session.profileId && duplicateIds.has(session.profileId) ? { ...session, profileId: primary.id } : session
      )
    });
  };

  const addProfileToClub = (profile: PlayerProfile) => {
    const existingInterest = state.interests.find(
      (interest: { profileId: string; playerName: string; status: InterestStatus; }) =>
        (interest.profileId === profile.id || interest.playerName.toLowerCase() === profile.name.toLowerCase()) &&
        !inactiveInterestStatuses.includes(interest.status)
    );
    const preferredGameId = profile.preferredGameIds[0] ?? state.games[0]?.id ?? 'nlh-1-2';
    const timestamp = nowIso();
    let nextState = {
      ...state,
      interests: ensureInterestEntry(state, profile, existingInterest?.gameId || preferredGameId, 'Arrived', 'Checked in at club entry', timestamp),
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
        ...state.playerLedger
      ]
    };

    nextState = promptDemandAction(nextState, preferredGameId);
    persist(nextState, true, {
      feature: 'Profiles',
      action: 'Checked player into club',
      metadata: { preferredGameId, seated: false }
    });
  };

  const removeProfileFromClub = (profile: PlayerProfile) => {
    persist({
      ...state,
      interests: state.interests.filter(
        (interest: { status: string; profileId: string; playerName: string; }) =>
          !(
            interest.status === 'Arrived' &&
            (interest.profileId === profile.id || interest.playerName.toLowerCase() === profile.name.toLowerCase())
          )
      )
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

  const importProfiles = () => {
    const raw = importText.trim();
    if (!raw) return;

    let imported: PlayerProfile[] = [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        imported = parsed
          .filter((item) => item?.name)
          .map((item) => {
            const preferredGameId = resolveGameId(
              state.games,
              String(item.preferredGameId ?? item.preferredGameIds?.[0] ?? item.preferredGame ?? item.stakes ?? ''),
              state.games[0]?.id ?? 'nlh-1-2'
            );
            const companionNames = Array.isArray(item.usualCompanions)
              ? item.usualCompanions.map(String)
              : String(item.usualCompanions ?? item.commonlyPlaysWith ?? item.companions ?? '')
                  .split(/[|;]/)
                  .map((name) => name.trim())
                  .filter(Boolean);
            const preferredGameIds = Array.isArray(item.preferredGameIds)
              ? Array.from(new Set(item.preferredGameIds.map((gameId: unknown) => resolveGameId(state.games, String(gameId), '')).filter(Boolean)))
              : [preferredGameId];
            return {
            id: String(item.id ?? memberId()),
            name: String(item.name).trim(),
            phone: String(item.phone ?? item.phoneNumber ?? item.mobile ?? item.cell ?? ''),
            birthday: String(item.birthday ?? ''),
            membershipStartDate: String(item.membershipStartDate ?? item.memberSince ?? todayDate()),
            membershipExpirationDate: String(item.membershipExpirationDate ?? item.expiresAt ?? nextYearDate()),
            totalTimePlayedHours: Number(item.totalTimePlayedHours ?? item.totalTimePlayed ?? 0),
            lastSessionTimePlayedHours: Number(item.lastSessionTimePlayedHours ?? item.lastSessionTimePlayed ?? 0),
            commonlyPlaysWithProfileIds: Array.isArray(item.commonlyPlaysWithProfileIds) ? item.commonlyPlaysWithProfileIds.map(String) : [],
            preferredGameId,
            preferredGameIds: preferredGameIds.length ? preferredGameIds : [preferredGameId],
            gamePlayCounts: Object.entries((item.gamePlayCounts ?? {}) as Record<string, unknown>).reduce<Record<string, number>>((counts, [gameId, count]) => {
              const resolvedGameId = resolveGameId(state.games, gameId, '');
              const numericCount = Number(count);
              if (resolvedGameId && Number.isFinite(numericCount) && numericCount > 0) counts[resolvedGameId] = numericCount;
              return counts;
            }, {}),
            mostPlayedGameId: resolveGameId(state.games, String(item.mostPlayedGameId ?? ''), preferredGameId),
            preferredStakes: String(item.preferredStakes ?? item.stakes ?? state.games.find((game) => game.id === preferredGameId)?.name ?? ''),
            typicalBuyInMin: Number(item.typicalBuyInMin ?? item.buyInMin ?? 0),
            typicalBuyInMax: Number(item.typicalBuyInMax ?? item.buyInMax ?? 0),
            willingnessToMove: Boolean(item.willingnessToMove ?? item.moveTables ?? false),
            typicalAvailability: String(item.typicalAvailability ?? item.availability ?? ''),
            preferredTags: Array.isArray(item.preferredTags) ? item.preferredTags : [],
            usualCompanions: companionNames,
            notes: String(item.notes ?? '')
          };
          });
      }
    } catch {
      imported = raw
        .split(/\r?\n/)
        .map((line: string) => line.trim())
        .filter(Boolean)
        .map((line: { split: (arg0: string) => { (): any; new(): any; map: { (arg0: (part: any) => any): [any, ("" | undefined)?, ("0" | undefined)?, ("0" | undefined)?, ("" | undefined)?, ("" | undefined)?, ("yes" | undefined)?]; new(): any; }; }; }) => {
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

  const archiveNight = () => {
    if (!window.confirm('Close and archive this night?')) return;
    persist({
      ...state,
      history: [...state.history, { ...analytics.currentNight, id: uid(), notes: summaryNotes.trim() }],
      interests: [],
      sessions: state.sessions.map((session: { endedAt: any; }) => ({ ...session, status: 'Closed', endedAt: session.endedAt ?? nowIso() })),
      playerSessions: state.playerSessions.map((session: { leftAt: any; }) => ({ ...session, leftAt: session.leftAt ?? nowIso() })),
      tableEvents: [
        ...state.tableEvents,
        ...state.sessions
          .filter((session: { status: string; }) => session.status !== 'Closed')
          .map((session: { gameId: any; id: any; seatsFilled: any; }) => ({
            id: uid(),
            type: 'Closed' as TableEventType,
            gameId: session.gameId,
            tableId: session.id,
            timestamp: nowIso(),
            playerCount: session.seatsFilled,
            note: summaryNotes.trim() || 'Night archived'
          }))
      ]
    }, true, { feature: 'Owner summary', action: 'Closed night', metadata: { seatHours: Number(analytics.currentNight.occupiedSeatHours.toFixed(1)) } });
    setSummaryNotes('');
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
      const backup = readBackupEnvelope<Partial<AppState>>(parsed);
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
      ['Occupied seat-hours', analytics.currentNight.occupiedSeatHours.toFixed(2)],
      ['Average seat-hours/player', analytics.averageSeatHoursPerPlayer.toFixed(2)],
      ['Average wait minutes', analytics.averageWaitMinutes.toFixed(0)],
      ['Waitlist conversion', `${(analytics.conversionRate * 100).toFixed(0)}%`],
      ['Games started', analytics.currentNight.gamesStarted.toString()],
      ['Failed starts', analytics.failedStarts.toString()],
      ['Table breaks', analytics.tableBreaks.toString()],
      ['Peak active tables', analytics.peakActiveTables.toString()],
      ['Median wait minutes', analytics.medianWaitMinutes.toFixed(0)],
      ['Confirmed to arrived', `${(analytics.confirmedArrivalRate * 100).toFixed(0)}%`],
      ['Waitlist abandonment', analytics.waitlistAbandonmentCount.toString()],
      ['Lost seat-hour estimate', analytics.lostSeatHourEstimate.toFixed(1)],
      ['Estimated time-fee revenue', `$${analytics.estimatedTimeFeeRevenue.toFixed(2)}`],
      ['Expired time-fee seats', analytics.expiredTimeFeeSeats.toString()],
      ['Recorded table drop', `$${analytics.recordedDropTotal.toFixed(2)}`],
      ['Estimated drop revenue', `$${analytics.estimatedDropRevenue.toFixed(2)}`],
      ...analytics.collectionValueByGame.flatMap((item) => [
        [`Time fees revenue - ${item.game}`, `$${item.timeRevenue.toFixed(2)}`],
        [`Recorded drop - ${item.game}`, `$${item.recordedDrop.toFixed(2)}`],
        [`Estimated drop - ${item.game}`, `$${item.estimatedDrop.toFixed(2)}`]
      ]),
      ...analytics.waitByGame.map((item: { game: any; count: any; averageMinutes: number; }) => [`Wait by game - ${item.game}`, item.count ? `${item.averageMinutes.toFixed(0)} minutes` : 'No seated waits']),
      ...state.tableEvents
        .filter((event: { type: string; }) => event.type === 'Failed to Start' || event.type === 'Broke')
        .map((event: { type: any; reason: any; note: any; }) => [`${event.type} reason`, `${event.reason || 'Unspecified'}${event.note ? ` - ${event.note}` : ''}`])
    ];
    const csv = rows.map((row) => row.map((cell: string) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `table-manager-summary-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const scanGroupMeText = () => {
    setGroupMeCandidates(parseGroupMeMessages(groupMeText, state.games));
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
    setGroupMeCandidates((candidates: any[]) => candidates.filter((item: { id: string; }) => item.id !== candidate.id));
  };

  const rejectGroupMeCandidate = (id: string) => {
    setGroupMeCandidates((candidates: any[]) => candidates.filter((item: { id: string; }) => item.id !== id));
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
    let desktopRecord: { state?: Partial<AppState> } | undefined;
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
          return stored ? { state: JSON.parse(stored) as Partial<AppState> } : null;
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
              <button className="primary-button" type="submit" disabled={!pendingPilotAccess}>
                Unlock Dashboard
              </button>
            </form>
          </div>
        </section>
      </main>
    );
  }

  if (route === 'tournament-tv') {
    const tournament = selectedTournament;
    const currentLevel = getTournamentLevel(tournament);
    const nextLevel = getNextTournamentLevel(tournament);
    const prizePool = getTournamentPrizePool(tournament);
    const remaining = getTournamentLevelRemainingSeconds(tournament, clockNow);
    const levelsUntilBreak = getLevelsUntilBreak(tournament);
    return (
      <main className="tournament-tv-shell">
        {tournament ? (
          <>
            <section className="tournament-tv-header">
              <div>
                <span>{tournament.status}</span>
                <h1>{tournament.name}</h1>
              </div>
              <strong>{formatTournamentTime(remaining)}</strong>
            </section>
            <section className="tournament-tv-grid">
              <article>
                <span>Current blinds</span>
                <strong>{currentLevel ? `${currentLevel.smallBlind}/${currentLevel.bigBlind}` : '-'}</strong>
                <small>{currentLevel?.ante ? `BB ante ${currentLevel.ante}` : 'No ante'}</small>
              </article>
              <article>
                <span>Next level</span>
                <strong>{nextLevel ? `${nextLevel.smallBlind}/${nextLevel.bigBlind}` : 'Final level'}</strong>
                <small>{nextLevel?.ante ? `BB ante ${nextLevel.ante}` : nextLevel ? 'No ante' : 'No next level'}</small>
              </article>
              <article>
                <span>Entries</span>
                <strong>{getTournamentEntries(tournament)}</strong>
                <small>{getTournamentActivePlayers(tournament)} players remain</small>
              </article>
              <article>
                <span>Average stack</span>
                <strong>{getTournamentAverageStack(tournament).toLocaleString()}</strong>
                <small>{tournament.startingStack.toLocaleString()} start</small>
              </article>
              <article>
                <span>Total prize pool</span>
                <strong>${prizePool.toLocaleString()}</strong>
                <small>{tournament.buyIn ? `$${tournament.buyIn} buy-in` : 'No buy-in set'}</small>
              </article>
              <article>
                <span>Break</span>
                <strong>{levelsUntilBreak ? `${levelsUntilBreak} level${levelsUntilBreak === 1 ? '' : 's'}` : 'None'}</strong>
                <small>{currentLevel?.breakAfter ? `${currentLevel.breakMinutes} min after this level` : 'Upcoming schedule'}</small>
              </article>
            </section>
            <section className="tournament-tv-payouts">
              <h2>Prize Pool Distribution</h2>
              <div>
                {tournament.payouts.map((payout) => (
                  <article key={payout.place}>
                    <span>{payout.place}</span>
                    <strong>${Math.round(prizePool * (payout.percent / 100)).toLocaleString()}</strong>
                    <small>{payout.percent}%</small>
                  </article>
                ))}
              </div>
            </section>
          </>
        ) : (
          <section className="tournament-tv-empty">
            <h1>No tournament selected</h1>
          </section>
        )}
      </main>
    );
  }

  if (route === 'tournaments') {
    const tournament = selectedTournament;
    const currentLevel = getTournamentLevel(tournament);
    const nextLevel = getNextTournamentLevel(tournament);
    const prizePool = getTournamentPrizePool(tournament);
    const remaining = getTournamentLevelRemainingSeconds(tournament, clockNow);

    const tournamentForm = (mode: 'create' | 'edit') => (
      <form className="tournament-form tournament-focused-form" onSubmit={mode === 'create' ? createTournament : saveTournamentSettings}>
        <label className="tournament-field tournament-field-wide"><span>Tournament name</span><input value={tournamentDraft.name} onChange={(event) => setTournamentDraft({ ...tournamentDraft, name: event.target.value })} placeholder="Friday Night Main Event" /></label>
        <label className="tournament-field"><span>Buy-in</span><input value={tournamentDraft.buyIn} onChange={(event) => setTournamentDraft({ ...tournamentDraft, buyIn: event.target.value })} placeholder="$100" type="number" min="0" /></label>
        <label className="tournament-field"><span>Starting stack</span><input value={tournamentDraft.startingStack} onChange={(event) => setTournamentDraft({ ...tournamentDraft, startingStack: event.target.value })} placeholder="20,000" type="number" min="1000" /></label>
        <label className="tournament-field tournament-field-wide"><span>Level length <small>Minutes per blind level</small></span><input value={tournamentDraft.levelMinutes} onChange={(event) => setTournamentDraft({ ...tournamentDraft, levelMinutes: event.target.value })} placeholder="20 minutes" type="number" min="5" /></label>
        <label className="tournament-field"><span>Rebuy to prize pool <small>Percent</small></span><input value={tournamentDraft.rebuyPrizePercent} onChange={(event) => setTournamentDraft({ ...tournamentDraft, rebuyPrizePercent: event.target.value })} type="number" min="0" max="100" /></label>
        <label className="tournament-field"><span>Players per table</span><input value={tournamentDraft.tableSize} onChange={(event) => setTournamentDraft({ ...tournamentDraft, tableSize: event.target.value })} type="number" min="2" max="10" /></label>
        <div className="tournament-form-actions">
          <button className="ghost-button" type="button" onClick={() => setTournamentView('library')}>Cancel</button>
          <button className="primary-button" type="submit">{mode === 'create' ? 'Create tournament' : 'Save changes'}</button>
        </div>
      </form>
    );

    return withShell('tournaments', (
      <main className="app-shell compact-shell tournament-manager-shell">
        <header className={tournamentView === 'library' ? 'topbar tournament-library-header' : 'page-header'}>
          <div>
            {tournamentView !== 'library' ? <div className="eyebrow">Tournament Manager</div> : null}
            <h1>{tournamentView === 'library' ? 'Tournaments' : tournamentView === 'create' ? 'Create tournament' : tournamentView === 'edit' ? 'Edit tournament' : tournament?.name}</h1>
            {tournamentView !== 'library' ? <p>{tournamentView === 'manage' ? 'Everything you need for this event, one view at a time.' : 'Set the essentials. You can manage players and payouts afterward.'}</p> : null}
          </div>
          <div className="header-actions">
            {tournamentView !== 'library' ? <button className="ghost-button" onClick={() => setTournamentView('library')}><ChevronLeft size={17} /> All tournaments</button> : null}
            {tournamentView === 'library' ? <button className="primary-button" onClick={() => { setTournamentDraft({ name: `Tournament ${todayDate()}`, buyIn: '', startingStack: '20000', levelMinutes: '20', rebuyPrizePercent: '100', tableSize: '9' }); setTournamentView('create'); }}><Plus size={17} /> New tournament</button> : null}
            {tournamentView === 'manage' ? <button className="secondary-button" onClick={() => window.tableManagerDesktop?.openWindow('tournament-tv').catch(() => { window.location.hash = '/tournament-tv'; }) || (window.location.hash = '/tournament-tv')}><Eye size={17} /> TV View</button> : null}
          </div>
        </header>

        {tournamentView === 'library' ? (
          <section className="tournament-library">
            <button className="tournament-new-card" onClick={() => { setTournamentDraft({ name: `Tournament ${todayDate()}`, buyIn: '', startingStack: '20000', levelMinutes: '20', rebuyPrizePercent: '100', tableSize: '9' }); setTournamentView('create'); }}>
              <span><Plus size={28} /></span><strong>Create a new tournament</strong><small>Build a fresh structure from scratch</small>
            </button>
            {state.tournaments.length ? <div className="tournament-library-list">
              {state.tournaments.map((item) => (
                <article className="tournament-library-card" key={item.id}>
                  <button className="tournament-library-main" onClick={() => { setSelectedTournamentId(item.id); setTournamentSection('clock'); setTournamentView('manage'); }}>
                    <span className={`tournament-library-icon tournament-library-icon-${item.status.toLowerCase()}`}><Target size={22} /></span>
                    <span><strong>{item.name}</strong><small>{item.status} · {getTournamentEntries(item)} entries · ${item.buyIn.toLocaleString()} buy-in</small></span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><button className="icon-button" title="Tournament actions"><MoreHorizontal size={18} /></button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => beginTournamentEdit(item)}>Edit tournament</DropdownMenuItem><DropdownMenuItem onSelect={() => runTournamentAgain(item)}>Run again</DropdownMenuItem></DropdownMenuContent>
                  </DropdownMenu>
                </article>
              ))}
            </div> : <div className="tournament-empty-library"><Target size={32} /><strong>No tournaments yet</strong><span>Create your first one above.</span></div>}
          </section>
        ) : tournamentView === 'create' || tournamentView === 'edit' ? (
          <section className="panel tournament-panel tournament-form-panel">
            <PanelTitle icon={tournamentView === 'create' ? <Plus /> : <Edit3 />} title={tournamentView === 'create' ? 'Tournament setup' : 'Tournament details'} />
            {tournamentForm(tournamentView)}
          </section>
        ) : tournament ? (
          <section className="tournament-workspace">
            <nav className="tournament-section-nav" aria-label="Tournament sections">
              <button className={tournamentSection === 'clock' ? 'active' : ''} onClick={() => setTournamentSection('clock')}><Clock size={18} /> Clock & levels</button>
              <button className={tournamentSection === 'players' ? 'active' : ''} onClick={() => setTournamentSection('players')}><Users size={18} /> Players</button>
              <button className={tournamentSection === 'tables' ? 'active' : ''} onClick={() => setTournamentSection('tables')}><LayoutDashboard size={18} /> Tables</button>
              <button className={tournamentSection === 'payouts' ? 'active' : ''} onClick={() => setTournamentSection('payouts')}><WalletCards size={18} /> Payouts</button>
            </nav>

            {tournamentSection === 'clock' ? <section className="panel tournament-panel tournament-control-panel">
              <PanelTitle icon={<Clock />} title="Clock & Levels" />
                <div className="tournament-clock-card">
                  <span className={`tournament-status tournament-status-${tournament.status.toLowerCase()}`}>{tournament.status}</span>
                  <strong>{formatTournamentTime(remaining)}</strong>
                  <small>Level {(tournament.currentLevelIndex + 1).toString()} - {currentLevel ? `${currentLevel.smallBlind}/${currentLevel.bigBlind}${currentLevel.ante ? `/${currentLevel.ante}` : ''}` : '-'}</small>
                </div>
                <div className="tournament-actions">
                  {tournament.status === 'Running' ? (
                    <button className="secondary-button" onClick={() => pauseTournament(tournament)}>Pause</button>
                  ) : tournament.status === 'Paused' ? (
                    <button className="primary-button" onClick={() => resumeTournament(tournament)}>Resume</button>
                  ) : (
                    <button className="primary-button" onClick={() => startTournament(tournament)}>Start</button>
                  )}
                  <button className="ghost-button" onClick={() => advanceTournamentLevel(tournament, -1)}>Prev Level</button>
                  <button className="ghost-button" onClick={() => advanceTournamentLevel(tournament, 1)}>Next Level</button>
                </div>
                <div className="tournament-level-strip">
                  <article><span>Next</span><strong>{nextLevel ? `${nextLevel.smallBlind}/${nextLevel.bigBlind}` : 'Final'}</strong></article>
                  <article><span>Entries</span><strong>{getTournamentEntries(tournament)}</strong></article>
                  <article><span>Remaining</span><strong>{getTournamentActivePlayers(tournament)}</strong></article>
                  <article><span>Avg stack</span><strong>{getTournamentAverageStack(tournament).toLocaleString()}</strong></article>
                </div>
            </section> : null}

            {tournamentSection === 'tables' ? <section className="panel tournament-panel tournament-tables-panel">
              <div className="tournament-tables-head"><div><h2>Table overview</h2><p>{tournament.players.filter((player) => player.status !== 'Eliminated').length} active participants · {tournament.tableSize} seats per table</p></div><button className="primary-button" onClick={() => drawTournamentTables(tournament)}>Draw all participants</button></div>
              <div className="tournament-table-grid">
                {Array.from(new Set(tournament.players.filter((player) => player.tableNumber).map((player) => player.tableNumber!))).sort((a, b) => a - b).map((tableNumber) => <article key={tableNumber}><header><strong>Table {tableNumber}</strong><span>{tournament.players.filter((player) => player.tableNumber === tableNumber && player.status !== 'Eliminated').length}/{tournament.tableSize}</span></header>{tournament.players.filter((player) => player.tableNumber === tableNumber && player.status !== 'Eliminated').sort((a, b) => (a.seatNumber ?? 0) - (b.seatNumber ?? 0)).map((player) => <div key={player.id}><span>Seat {player.seatNumber}</span><strong>{player.name}</strong></div>)}</article>)}
                {!tournament.players.some((player) => player.tableNumber) ? <div className="tournament-table-empty">Draw participants to create balanced table assignments.</div> : null}
              </div>
            </section> : null}

            {tournamentSection === 'players' ? <section className="panel tournament-panel tournament-players-panel">
            <PanelTitle icon={<Users />} title="Register Players" />
                <form className="tournament-form" onSubmit={registerTournamentPlayer}>
                  <label className="tournament-field tournament-field-wide"><span>Player source <small>Saved profile or someone new</small></span><select value={tournamentPlayerDraft.profileId} onChange={(event) => {
                    const profile = state.profiles.find((item) => item.id === event.target.value);
                    setTournamentPlayerDraft({ ...tournamentPlayerDraft, profileId: event.target.value, name: profile?.name ?? tournamentPlayerDraft.name, phone: profile?.phone ?? tournamentPlayerDraft.phone });
                  }}>
                    <option value="">New / manual player</option>
                    {state.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                  </select></label>
                  <label className="tournament-field tournament-field-wide"><span>Player name</span><input value={tournamentPlayerDraft.name} onChange={(event) => setTournamentPlayerDraft({ ...tournamentPlayerDraft, name: event.target.value })} placeholder="Full name" /></label>
                  <label className="tournament-field"><span>Phone <small>Optional</small></span><input value={tournamentPlayerDraft.phone} onChange={(event) => setTournamentPlayerDraft({ ...tournamentPlayerDraft, phone: event.target.value })} placeholder="(555) 555-0123" /></label>
                  <label className="tournament-field"><span>Email <small>Optional</small></span><input value={tournamentPlayerDraft.email} onChange={(event) => setTournamentPlayerDraft({ ...tournamentPlayerDraft, email: event.target.value })} placeholder="player@example.com" /></label>
                  <button className="primary-button tournament-submit" type="submit">Register player</button>
                </form>
                <div className="tournament-section-label">Registered field</div>
                <div className="tournament-player-list">
                  {tournament.players.map((player) => (
                    <article key={player.id}>
                      <div>
                        <strong>{player.name}</strong>
                        <span>{player.status} · {player.rebuys} rebuys · {player.addOns} add-ons</span>
                      </div>
                      <div className="tournament-player-actions">
                        {player.status === 'Registered' ? <button className="mini-button" onClick={() => checkInTournamentPlayer(tournament, player.id)}>Check in</button> : null}
                        <button className="mini-button" onClick={() => addTournamentEntry(tournament, player.id, 'rebuys')}>Rebuy</button>
                        <button className="mini-button" onClick={() => addTournamentEntry(tournament, player.id, 'addOns')}>Add-on</button>
                        {player.status !== 'Eliminated' ? <button className="mini-button" onClick={() => eliminateTournamentPlayer(tournament, player.id)}>Out</button> : null}
                      </div>
                    </article>
                  ))}
                </div>
            </section> : null}

            {tournamentSection === 'payouts' ? <section className="panel tournament-panel tournament-prize-panel">
            <PanelTitle icon={<Target />} title="Prize Pool" />
                <div className="tournament-prize-total">
                  <span>Total prize pool</span>
                  <strong>${prizePool.toLocaleString()}</strong>
                </div>
                <div className="tournament-payout-list">
                  {tournament.payouts.map((payout) => (
                    <label key={payout.place}>
                      <span>{payout.place}{payout.place === 1 ? 'st' : payout.place === 2 ? 'nd' : payout.place === 3 ? 'rd' : 'th'}</span>
                      <input
                        value={tournamentPayoutDrafts[payout.place] ?? String(payout.percent)}
                        onChange={(event) => setTournamentPayoutDrafts({ ...tournamentPayoutDrafts, [payout.place]: event.target.value })}
                        onBlur={(event) => updateTournamentPayout(tournament, payout.place, Number(event.target.value) || 0)}
                        type="number"
                        min="0"
                        max="100"
                      />
                      <strong>${Math.round(prizePool * (payout.percent / 100)).toLocaleString()}</strong>
                    </label>
                  ))}
                </div>
            </section> : null}
          </section>
        ) : null}
      </main>
    ));
  }

  if (route === 'customization') {
    return withShell('settings', (
      <main className={`app-shell compact-shell settings-page settings-view-${settingsSection}`}>
        <header className="topbar">
          <div>
            <h1>Settings</h1>
            <p className="page-subtitle">Club, staff, tables, data, and display</p>
          </div>
          <button className="ghost-button" onClick={closeRoute}>
            <X size={18} />
            Close
          </button>
        </header>

        <nav className="settings-nav" aria-label="Settings sections">
          <button className={settingsSection === 'club' ? 'active' : ''} onClick={() => setSettingsSection('club')}>Club & license</button><button className={settingsSection === 'staff' ? 'active' : ''} onClick={() => setSettingsSection('staff')}>Staff</button><button className={settingsSection === 'tables' ? 'active' : ''} onClick={() => setSettingsSection('tables')}>Tables & fees</button><button className={settingsSection === 'data' ? 'active' : ''} onClick={() => setSettingsSection('data')}>Data</button><button className={settingsSection === 'display' ? 'active' : ''} onClick={() => setSettingsSection('display')}>Display</button>
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
        </section>
      </main>
    ));
  }

  if (route === 'builder') {
    const getGameFormat = (name: string) => /plo|omaha/i.test(name) ? 'Omaha' : /hold|nlh/i.test(name) ? 'Hold’em' : /mixed|mix/i.test(name) ? 'Mixed' : 'Other';
    const getGameStakes = (name: string) => name.match(/\d+\s*\/\s*\d+/)?.[0]?.replace(/\s/g, '') ?? 'Unspecified';
    const getGameStatus = (game: GameConfig) => {
      if (state.sessions.some((session) => session.gameId === game.id && session.status === 'Running')) return 'Running';
      const viability = getViabilityState(state, game).state;
      return viability === 'Ready to Start' || viability === 'Likely to Start' ? 'Ready' : 'Needs players';
    };
    const gameFormats = ['All formats', ...Array.from(new Set(state.games.map((game) => getGameFormat(game.name))))];
    const gameStakes = ['All stakes', ...Array.from(new Set(state.games.map((game) => getGameStakes(game.name))))];
    const filteredGameOptions = state.games.filter((game) => (gameFormatFilter === 'All formats' || getGameFormat(game.name) === gameFormatFilter) && (gameStakesFilter === 'All stakes' || getGameStakes(game.name) === gameStakesFilter) && (gameStatusFilter === 'All statuses' || getGameStatus(game) === gameStatusFilter));
    return withShell('games', (
      <main className="app-shell compact-shell">
        <header className="topbar">
          <div>
            <h1>Games</h1>
            <p className="page-subtitle">Tonight's demand and forming tables</p>
          </div>
          <div className="topbar-actions">
            <button className="ghost-button" onClick={exportPilotReport}>
              <Download size={18} />
              Export Pilot
            </button>
            <button className="ghost-button" onClick={closeRoute}>
              <X size={18} />
              Close
            </button>
          </div>
        </header>

        <nav className="route-tabs" aria-label="Games sections">
          <button className="active">Tonight</button>
          <button onClick={() => openRoute('signals')}>Outreach</button>
          <button onClick={() => openRoute('customization')}>Configuration</button>
        </nav>

        <section className="game-filter-bar">
          <label><span>Stakes</span><select value={gameStakesFilter} onChange={(event) => setGameStakesFilter(event.target.value)}>{gameStakes.map((stakes) => <option key={stakes}>{stakes}</option>)}</select></label>
          <label><span>Format</span><select value={gameFormatFilter} onChange={(event) => setGameFormatFilter(event.target.value)}>{gameFormats.map((format) => <option key={format}>{format}</option>)}</select></label>
          <label><span>Status</span><select value={gameStatusFilter} onChange={(event) => setGameStatusFilter(event.target.value)}>{['All statuses', 'Running', 'Ready', 'Needs players'].map((status) => <option key={status}>{status}</option>)}</select></label>
        </section>

        <section className="panel">
          <div className="builder-controls">
            <label>
              Game
              <select
                value={coordinationConfig.gameId}
                onChange={(event: { target: { value: any; }; }) => setCoordinationConfig({ ...coordinationConfig, gameId: event.target.value })}
              >
                {filteredGameOptions.map((game: { id: any; name: any; }) => (
                  <option key={game.id} value={game.id}>
                    {game.name}
                  </option>
                ))}
                {!filteredGameOptions.length ? <option value="">No matching games</option> : null}
              </select>
            </label>
            <label>
              Seats
              <input
                type="number"
                min="2"
                max={state.games.find((game: { id: any; }) => game.id === coordinationConfig.gameId)?.maxSeats ?? 10}
                value={coordinationConfig.seats}
                onChange={(event: { target: { value: any; }; }) => setCoordinationConfig({ ...coordinationConfig, seats: Number(event.target.value) })}
              />
            </label>
            <button className="primary-button" onClick={addPlannedSession}>
              <Plus size={18} />
              Start Forming Table
            </button>
          </div>
          <div className="builder-grid single-window-grid">
            {participantPool.map((candidate: { id: any; playerName: any; reasons: any[]; profile: { preferredStakes: any; typicalBuyInMin: any; typicalBuyInMax: any; }; source: string; }, index: number) => (
              <article className="candidate-card" key={candidate.id}>
                <div className="candidate-rank">{index + 1}</div>
                <div>
                  <h3>{candidate.playerName}</h3>
                  <p>{candidate.reasons.slice(0, 3).join(' - ')}</p>
                  <small>
                    {candidate.profile?.preferredStakes || 'No saved stakes'} -{' '}
                    {candidate.profile
                      ? `$${candidate.profile.typicalBuyInMin}-${candidate.profile.typicalBuyInMax} buy-in`
                      : 'No profile'}
                  </small>
                  {candidate.source === 'connected-profile' ? <small>Profile connection, not currently listed</small> : null}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="panel">
          <PanelTitle icon={<Target />} title="Two-Table Balance Option" />
          <div className="balance-list">
            {balancePlans.filter((plan: { game: { id: any; }; }) => plan.game.id === coordinationConfig.gameId).length ? (
              balancePlans
                .filter((plan: { game: { id: any; }; }) => plan.game.id === coordinationConfig.gameId)
                .map((plan: { game: any; fromTable: any; demand: any; tableASeatsAfterMove: any; tableBProjectedSeats: any; nextStep: any; moveCandidates: any; }) => (
                  <article className="balance-card" key={`${plan.game.id}-${plan.fromTable.id}`}>
                    <div>
                      <h3>{plan.game.name}</h3>
                      <p>{plan.demand.totalDemand} total demand - Table A {plan.tableASeatsAfterMove}/{plan.fromTable.maxSeats} after move - Table B projected {plan.tableBProjectedSeats}/{plan.game.maxSeats}</p>
                      <small>{plan.nextStep}</small>
                    </div>
                    <div className="balance-movers">
                      {plan.moveCandidates.map((candidate: { id: any; playerName: any; reasons: any[]; }) => (
                        <span key={candidate.id}>{candidate.playerName} - {candidate.reasons.slice(0, 2).join(' - ')}</span>
                      ))}
                    </div>
                    <button className="primary-button" onClick={() => createBalancedTable(plan)}>
                      Create Table B
                    </button>
                  </article>
                ))
            ) : (
              <p className="muted-copy">This appears when a game has more than 12 total players across in-room, waiting, coming, and interested demand.</p>
            )}
          </div>
        </section>
      </main>
    ));
  }

  if (route === 'profiles') {
    return withShell('players', (
      <main className="app-shell compact-shell">
        <header className="topbar">
          <div>
            <h1>Players</h1>
            <p className="page-subtitle">Search and manage player records</p>
          </div>
          <div className="topbar-actions players-header-actions">
            <button className="player-tool-icon" onClick={() => setPlayerPopup('ledger')} title="Open player ledger" aria-label="Open player ledger"><Clock size={19} /></button>
            <button className="player-tool-icon primary" onClick={() => setPlayerPopup('add')} title="Add player" aria-label="Add player"><Plus size={19} /></button>
          </div>
        </header>

        <Dialog.Root open={playerPopup !== null} onOpenChange={(open) => { if (!open) setPlayerPopup(null); }}>
          <Dialog.Portal>
            <Dialog.Overlay className="player-popup-overlay" />
            <Dialog.Content className="player-popup-content">
              <div className="player-popup-header">
                <div><Dialog.Title>{playerPopup === 'add' ? 'Add player' : 'Player ledger'}</Dialog.Title><Dialog.Description>{playerPopup === 'add' ? 'Create a player record.' : 'Recent check-ins and transactions.'}</Dialog.Description></div>
                <Dialog.Close asChild><button className="icon-button" aria-label="Close"><X size={18} /></button></Dialog.Close>
              </div>
              {playerPopup === 'add' ? (
                <form className="player-popup-form" onSubmit={(event) => { addProfile(event); setPlayerPopup(null); }}>
                  <label><span>Player name</span><input autoFocus value={newProfile.name} onChange={(event) => setNewProfile({ ...newProfile, name: event.target.value })} placeholder="Full name" /></label>
                  <label><span>Phone</span><input value={newProfile.phone} onChange={(event) => setNewProfile({ ...newProfile, phone: event.target.value })} placeholder="Phone number" /></label>
                  <label><span>Preferred game</span><select value={newProfile.preferredGameId} onChange={(event) => setNewProfile({ ...newProfile, preferredGameId: event.target.value, preferredGameIds: [event.target.value] })}>{state.games.map((game) => <option key={game.id} value={game.id}>{game.name}</option>)}</select></label>
                  <div className="player-popup-form-grid"><label><span>Birthday</span><input type="date" value={newProfile.birthday} onChange={(event) => setNewProfile({ ...newProfile, birthday: event.target.value })} /></label><label><span>Membership expires</span><input type="date" value={newProfile.membershipExpirationDate} onChange={(event) => setNewProfile({ ...newProfile, membershipExpirationDate: event.target.value })} /></label></div>
                  <div className="player-popup-actions"><Dialog.Close asChild><button className="ghost-button" type="button">Cancel</button></Dialog.Close><button className="primary-button" type="submit">Add player</button></div>
                </form>
              ) : (
                <div className="player-popup-ledger">
                  {state.playerLedger.length ? state.playerLedger.slice(0, 40).map((entry) => <article key={entry.id}><div><strong>{entry.playerName}</strong><span>{entry.type}{entry.note ? ` · ${entry.note}` : ''}</span></div><div><strong>{entry.amount ? `$${entry.amount.toLocaleString()}` : '—'}</strong><time>{formatClock(entry.timestamp)}</time></div></article>) : <div className="player-popup-empty"><strong>No ledger activity</strong><span>Check-ins and transactions will appear here.</span></div>}
                </div>
              )}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <section className="profile-command-strip">
          <article>
            <span className="eyebrow">Directory health</span>
            <strong>{state.profiles.length} profiles</strong>
            <small>{inClubInterests.length} in club now</small>
          </article>
          <article>
            <span className="eyebrow">Memberships</span>
            <strong>{state.profiles.filter((profile) => isFutureDate(profile.membershipExpirationDate)).length} active</strong>
            <small>{duplicateProfiles.length} duplicate group{duplicateProfiles.length === 1 ? '' : 's'}</small>
          </article>
          <div className="profile-command-actions">
            <button className="secondary-button" onClick={addDemoProfile}>
              <Plus size={17} />
              Demo Profile
            </button>
            <button className="ghost-button" onClick={() => setProfileSearch('')}>
              Clear Search
            </button>
          </div>
        </section>

        <section className="profiles-layout">
          <section className="panel profile-directory-panel">
            <PanelTitle icon={<Users />} title="Player Directory" />
            <div className="profile-search-row">
              <input
                value={profileSearch}
                onChange={(event: { target: { value: any; }; }) => setProfileSearch(event.target.value)}
                placeholder="Search players, stakes, companions, notes"
              />
              <span>{filteredProfiles.length} shown</span>
            </div>
            {duplicateProfiles.length ? (
              <div className="duplicate-list">
                {duplicateProfiles.map((group: any[]) => (
                  <article className="duplicate-card" key={group[0].name.toLowerCase()}>
                    <span>Possible duplicate: {group.map((profile: { name: any; }) => profile.name).join(', ')}</span>
                    <button className="secondary-button" onClick={() => mergeDuplicateProfiles(group)}>
                      Merge
                    </button>
                  </article>
                ))}
              </div>
            ) : null}
            <div className="profile-grid">
              {filteredProfiles.map((profile) => {
                const preferredGame = state.games.find((game) => game.id === profile.preferredGameId)?.name ?? profile.preferredStakes;
                const gamePlayEntries = getGamePlayEntries(profile);
                const mostPlayedGame = getMostPlayedGameName(profile);
                const companionNames = profile.commonlyPlaysWithProfileIds
                  .map((id) => state.profiles.find((candidate) => candidate.id === id)?.name)
                  .filter(Boolean);
                const inClub = inClubInterests.some(
                  (interest: { profileId: any; playerName: string; }) => interest.profileId === profile.id || interest.playerName.toLowerCase() === profile.name.toLowerCase()
                );
                const seated = state.playerSessions.some(
                  (session) => !session.leftAt && (session.profileId === profile.id || session.playerName.toLowerCase() === profile.name.toLowerCase())
                );
                return (
                  <article className="profile-card" key={profile.id}>
                    <div className="profile-card-main">
                      <div className="profile-card-header">
                        <div>
                          <h3>{profile.name}</h3>
                          <p>{preferredGame || 'No preferred game'}</p>
                        </div>
                        {seated ? <span className="status-pill viable">Seated</span> : inClub ? <span className="status-pill viable">In club</span> : null}
                      </div>
                      <div className="profile-card-stats">
                        <span>Total <strong>{formatHours(profile.totalTimePlayedHours)}</strong></span>
                        <span>Last <strong>{formatHours(profile.lastSessionTimePlayedHours)}</strong></span>
                        <span>Most played <strong>{mostPlayedGame}</strong></span>
                      </div>
                      {gamePlayEntries.length ? (
                        <div className="profile-game-counts">
                          {gamePlayEntries.slice(0, 4).map(([gameId, count]) => (
                            <span key={gameId}>{getGameName(gameId)}: <strong>{count}</strong></span>
                          ))}
                        </div>
                      ) : (
                        <small>No seated game history yet.</small>
                      )}
                      <small>Membership: {profile.membershipStartDate || 'Not set'} to {profile.membershipExpirationDate || 'Not set'}</small>
                      {profile.phone ? <small>Phone: {profile.phone}</small> : null}
                      {companionNames.length > 0 ? <small>Plays with: {companionNames.join(', ')}</small> : null}
                      {editingProfileId === profile.id && profileEditDraft ? (
                        <form className="profile-edit-form" onSubmit={saveProfileEdit}>
                          <input
                            value={profileEditDraft.name}
                            onChange={(event) => setProfileEditDraft({ ...profileEditDraft, name: event.target.value })}
                            placeholder="Player name"
                          />
                          <input
                            value={profileEditDraft.phone}
                            onChange={(event) => setProfileEditDraft({ ...profileEditDraft, phone: event.target.value })}
                            placeholder="Phone"
                          />
                          <label>
                            Member since
                            <input
                              type="date"
                              value={profileEditDraft.membershipStartDate}
                              onChange={(event) => setProfileEditDraft({ ...profileEditDraft, membershipStartDate: event.target.value })}
                            />
                          </label>
                          <label>
                            Expires
                            <input
                              type="date"
                              value={profileEditDraft.membershipExpirationDate}
                              onChange={(event) => setProfileEditDraft({ ...profileEditDraft, membershipExpirationDate: event.target.value })}
                            />
                          </label>
                          <select
                            value={profileEditDraft.preferredGameId}
                            onChange={(event) =>
                              setProfileEditDraft({
                                ...profileEditDraft,
                                preferredGameId: event.target.value,
                                preferredGameIds: Array.from(new Set([event.target.value, ...(profileEditDraft.preferredGameIds ?? [])]))
                              })
                            }
                          >
                            {state.games.map((game) => (
                              <option key={game.id} value={game.id}>
                                {game.name}
                              </option>
                            ))}
                          </select>
                          <input
                            value={profileEditDraft.preferredStakes}
                            onChange={(event) => setProfileEditDraft({ ...profileEditDraft, preferredStakes: event.target.value })}
                            placeholder="Preferred stakes"
                          />
                          <input
                            type="number"
                            min="0"
                            step="0.1"
                            value={profileEditDraft.totalTimePlayedHours}
                            onChange={(event) => setProfileEditDraft({ ...profileEditDraft, totalTimePlayedHours: Number(event.target.value) })}
                            title="Total time played"
                          />
                          <input
                            type="number"
                            min="0"
                            step="0.1"
                            value={profileEditDraft.lastSessionTimePlayedHours}
                            onChange={(event) => setProfileEditDraft({ ...profileEditDraft, lastSessionTimePlayedHours: Number(event.target.value) })}
                            title="Last session time played"
                          />
                          <select
                            multiple
                            value={profileEditDraft.commonlyPlaysWithProfileIds}
                            onChange={(event) =>
                              setProfileEditDraft({
                                ...profileEditDraft,
                                commonlyPlaysWithProfileIds: Array.from(event.target.selectedOptions).map((option) => option.value)
                              })
                            }
                            title="Commonly plays with"
                          >
                            {state.profiles
                              .filter((candidate) => candidate.id !== profile.id)
                              .map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                  {candidate.name}
                                </option>
                              ))}
                          </select>
                          <textarea
                            value={profileEditDraft.notes}
                            onChange={(event) => setProfileEditDraft({ ...profileEditDraft, notes: event.target.value })}
                            placeholder="Owner notes"
                          />
                          <div className="profile-edit-actions">
                            <button className="primary-button" type="submit">
                              <Save size={16} />
                              Save
                            </button>
                            <button className="ghost-button" type="button" onClick={cancelEditProfile}>
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : null}
                    </div>
                    <div className="profile-actions">
                      <button className="secondary-button" onClick={() => beginEditProfile(profile)}>
                        <Edit3 size={16} />
                        Edit
                      </button>
                      <button className="secondary-button" onClick={() => (inClub ? removeProfileFromClub(profile) : addProfileToClub(profile))}>
                        {inClub ? 'Remove' : 'Check in'}
                      </button>
                      <button className="icon-button danger" onClick={() => deleteProfile(profile.id)} title="Remove profile">
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </article>
                );
              })}
              {!filteredProfiles.length ? <p className="muted-copy">No matching profiles.</p> : null}
            </div>
          </section>

          <div className="profiles-right-column">
            <section className="panel">
              <PanelTitle icon={<Users />} title="In Club" />
              <div className="club-list">
                {inClubInterests.length ? (
                  inClubInterests.map((interest: { id: string; playerName: any; gameId: any; }) => (
                    <article className="club-card" key={interest.id}>
                      <div>
                        <strong>{interest.playerName}</strong>
                        <small>{state.games.find((game: { id: any; }) => game.id === interest.gameId)?.name ?? 'Unknown game'}</small>
                      </div>
                      <button className="secondary-button" onClick={() => deleteInterest(interest.id)}>
                        Remove
                      </button>
                    </article>
                  ))
                ) : (
                  <p className="muted-copy">No one marked in club.</p>
                )}
              </div>
            </section>

            <section className="panel">
              <PanelTitle icon={<Plus />} title="Add Players" />
              <div className="profile-form-hint">
                <strong>Quick profile builder</strong>
                <span>Create a usable player record for recommendations, waitlist matching, and loyalty tracking.</span>
              </div>
              <form className="profile-form" onSubmit={addProfile}>
                <input
                  className="profile-form-name"
                  value={newProfile.name}
                  onChange={(event: { target: { value: any; }; }) => setNewProfile({ ...newProfile, name: event.target.value })}
                  placeholder="Player name"
                />
                <input
                  value={newProfile.phone}
                  onChange={(event: { target: { value: string; }; }) => setNewProfile({ ...newProfile, phone: event.target.value })}
                  placeholder="Phone"
                  title="Phone"
                />
                <select
                  className="profile-form-game"
                  value={newProfile.preferredGameId}
                  onChange={(event: { target: { value: any; }; }) =>
                    setNewProfile({
                      ...newProfile,
                      preferredGameId: event.target.value,
                      preferredGameIds: [event.target.value]
                    })
                  }
                  title="Preferred game"
                >
                  {state.games.map((game: { id: any; name: any; }) => (
                    <option key={game.id} value={game.id}>
                      {game.name}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  value={newProfile.birthday}
                  onChange={(event: { target: { value: string; }; }) => setNewProfile({ ...newProfile, birthday: event.target.value })}
                  title="Birthday"
                />
                <input
                  type="date"
                  value={newProfile.membershipStartDate}
                  onChange={(event: { target: { value: string; }; }) => setNewProfile({ ...newProfile, membershipStartDate: event.target.value })}
                  title="Membership start"
                />
                <input
                  type="date"
                  value={newProfile.membershipExpirationDate}
                  onChange={(event: { target: { value: string; }; }) => setNewProfile({ ...newProfile, membershipExpirationDate: event.target.value })}
                  title="Membership expiration"
                />
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={newProfile.totalTimePlayedHours}
                  onChange={(event: { target: { value: any; }; }) => setNewProfile({ ...newProfile, totalTimePlayedHours: Number(event.target.value) })}
                  title="Total time played"
                />
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={newProfile.lastSessionTimePlayedHours}
                  onChange={(event: { target: { value: any; }; }) => setNewProfile({ ...newProfile, lastSessionTimePlayedHours: Number(event.target.value) })}
                  title="Last session time played"
                />
                <select
                  className="profile-form-companions"
                  multiple
                  value={newProfile.commonlyPlaysWithProfileIds}
                  onChange={(event) =>
                    setNewProfile({
                      ...newProfile,
                      commonlyPlaysWithProfileIds: Array.from(event.target.selectedOptions).map((option) => option.value),
                      usualCompanions: Array.from(event.target.selectedOptions)
                        .map((option) => option.text)
                        .join(', ')
                    })
                  }
                  title="Commonly plays with"
                >
                  {state.profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
                <button className="primary-button">
                  <Plus size={18} />
                  Add
                </button>
              </form>
              {profileFormMessage ? <p className="profile-form-message">{profileFormMessage}</p> : null}
              <textarea
                className="import-box"
                value={importText}
                onChange={(event: { target: { value: any; }; }) => setImportText(event.target.value)}
                placeholder="Import CSV: name, preferred game, birthday, membership start, membership expiration, companions separated by |"
              />
              <div className="inline-actions">
                <button className="secondary-button import-button" onClick={importProfiles}>
                  Import Pasted People
                </button>
                <label className="secondary-button license-file-button">
                  <Upload size={16} />
                  Upload CSV / XLSX
                  <input
                    type="file"
                    accept=".csv,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={(event) => importProfileFile(event.target.files?.[0])}
                  />
                </label>
              </div>
            </section>

            <section className="panel">
              <PanelTitle icon={<Clock />} title="Player Ledger" />
              <div className="waitlist-list">
                {state.playerLedger.slice(0, 20).map((entry) => (
                  <article className="waitlist-card" key={entry.id}>
                    <div>
                      <strong>{entry.playerName}</strong>
                      <span>{entry.type}{entry.amount ? ` - $${entry.amount.toLocaleString()}` : ''}</span>
                      <small>{formatClock(entry.timestamp)}{entry.note ? ` - ${entry.note}` : ''}</small>
                    </div>
                  </article>
                ))}
                {!state.playerLedger.length ? <p className="muted-copy">No check-in, buy-in, or cash-out entries yet.</p> : null}
              </div>
            </section>
          </div>
        </section>
      </main>
    ));
  }

  if (route === 'signals') {
    return withShell('games', (
      <main className="app-shell compact-shell">
        <header className="topbar">
          <div>
            <h1>Games</h1>
            <p className="page-subtitle">Outreach and player coordination</p>
          </div>
          <button className="ghost-button" onClick={closeRoute}>
            <X size={18} />
            Close
          </button>
        </header>

        <nav className="route-tabs" aria-label="Games sections">
          <button onClick={() => openRoute('builder')}>Tonight</button>
          <button className="active">Outreach</button>
          <button onClick={() => openRoute('customization')}>Configuration</button>
        </nav>

        <section className="panel">
          <PanelTitle icon={<Target />} title="Likely Participants" />
          <div className="outreach-list">
            {likelyParticipants.map((item: { id: any; profile: { name: any; }; game: { name: any; }; reason: any[]; message: string; confidence: number; }) => (
              <article className="outreach-card" key={item.id}>
                <div>
                  <h3>{item.profile.name}</h3>
                  <p>{item.game.name} - {item.reason.join(' - ')}</p>
                  <small>{item.message}</small>
                </div>
                <div className="outreach-actions">
                  <strong>{item.confidence >= 95 ? 'High' : item.confidence >= 70 ? 'Medium' : 'Low'}</strong>
                  <button className="secondary-button" onClick={() => copyMessage(item.message)}>
                    Copy Text
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="panel">
          <PanelTitle icon={<MessageCircle />} title="Message Scan" />
          <div className="integration-copy">
            <p>
              Paste room chat here to detect likely interest. Staff must review every match before it is added.
            </p>
            <textarea value={groupMeText} onChange={(event: { target: { value: any; }; }) => setGroupMeText(event.target.value)} placeholder="Paste player interest messages for staff review" />
            <button className="secondary-button" onClick={scanGroupMeText}>Scan Pasted Messages</button>
            <div className="script-grid">
              {groupMeCandidates.map((candidate: { id: any; playerName: any; gameId: any; status: any; sourceText: any; confidence: any; timestamp?: string; }) => (
                <article className="script-card" key={candidate.id}>
                  <div className="candidate-edit-grid">
                    <input
                      value={candidate.playerName}
                      onChange={(event: { target: { value: any; }; }) =>
                        setGroupMeCandidates((candidates: any[]) =>
                          candidates.map((item: { id: any; }) => (item.id === candidate.id ? { ...item, playerName: event.target.value } : item))
                        )
                      }
                    />
                    <select
                      value={candidate.gameId}
                      onChange={(event: { target: { value: any; }; }) =>
                        setGroupMeCandidates((candidates: any[]) =>
                          candidates.map((item: { id: any; }) => (item.id === candidate.id ? { ...item, gameId: event.target.value } : item))
                        )
                      }
                    >
                      {state.games.map((game: { id: any; name: any; }) => (
                        <option key={game.id} value={game.id}>{game.name}</option>
                      ))}
                    </select>
                    <select
                      value={candidate.status}
                      onChange={(event: { target: { value: string; }; }) =>
                        setGroupMeCandidates((candidates: any[]) =>
                          candidates.map((item: { id: any; }) => (item.id === candidate.id ? { ...item, status: event.target.value as InterestStatus } : item))
                        )
                      }
                    >
                      {statuses.map((status) => (
                        <option key={status}>{status}</option>
                      ))}
                    </select>
                  </div>
                  <p>{candidate.sourceText}</p>
                  <small>{candidate.confidence}% confidence - staff review required</small>
                  <div className="inline-actions">
                    <button className="secondary-button" onClick={() => acceptGroupMeCandidate(candidate)}>Add</button>
                    <button className="ghost-button" onClick={() => rejectGroupMeCandidate(candidate.id)}>Reject</button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="panel">
          <PanelTitle icon={<MessageCircle />} title="Templates" />
          <div className="script-template-list">
            {state.scriptTemplates.map((template: any, index: number) => (
              <label key={index}>
                Template {index + 1}
                <input value={template} onChange={(event: { target: { value: string; }; }) => updateScriptTemplate(index, event.target.value)} />
              </label>
            ))}
          </div>
          <div className="script-grid">
            {staffScripts.map((script: { label: any; text: string; }) => (
              <article className="script-card" key={script.label}>
                <strong>{script.label}</strong>
                <p>{script.text}</p>
                <button className="secondary-button" onClick={() => copyMessage(script.text)}>
                  Copy
                </button>
              </article>
            ))}
          </div>
        </section>
      </main>
    ));
  }

  if (route === 'summary') {
    return withShell('reports', (
      <main className={`app-shell compact-shell reports-page reports-mode-${reportMode} reports-kpi-${kpiCategory}`}>
        <header className="topbar">
          <div>
            <h1>Night Report</h1>
            <p className="page-subtitle">Current shift performance and closeout</p>
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
        </nav>
        {reportMode === 'kpis' ? <nav className="metric-category-menu" aria-label="Metric categories"><button className={kpiCategory === 'operations' ? 'active' : ''} onClick={() => setKpiCategory('operations')}>Operations</button><button className={kpiCategory === 'waitlist' ? 'active' : ''} onClick={() => setKpiCategory('waitlist')}>Waitlist</button><button className={kpiCategory === 'tables' ? 'active' : ''} onClick={() => setKpiCategory('tables')}>Tables</button><button className={kpiCategory === 'collections' ? 'active' : ''} onClick={() => setKpiCategory('collections')}>Collections</button></nav> : null}

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
            <strong>{analytics.currentNight.gamesStarted}</strong>
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
            <span>Time Fees Est.</span>
            <strong>${analytics.estimatedTimeFeeRevenue.toFixed(0)}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Expired Time</span>
            <strong>{analytics.expiredTimeFeeSeats}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Recorded Drop</span>
            <strong>${analytics.recordedDropTotal.toFixed(0)}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Drop Est.</span>
            <strong>${analytics.estimatedDropRevenue.toFixed(0)}</strong>
          </article>
        </section>

        <section className="panel summary-report">
          <PanelTitle icon={<Target />} title="What Happened Tonight" />
          <p>
            The room generated {analytics.currentNight.occupiedSeatHours.toFixed(1)} occupied seat-hours across {analytics.activeTables} active/forming tables.
            Average wait is {analytics.averageWaitMinutes.toFixed(0)} minutes, with {(analytics.conversionRate * 100).toFixed(0)}% waitlist conversion.
          </p>
          <p>
            Peak demand is {analytics.peakInterestedByGame ? `${analytics.peakInterestedByGame.game} with ${analytics.peakInterestedByGame.count} interested/in-room players` : 'not available yet'}.
            Failed starts: {analytics.failedStarts}. Table breaks: {analytics.tableBreaks}.
          </p>
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
              {analytics.collectionValueByGame.map((item) => (
                <span key={item.game}>
                  {item.game}: ${item.timeRevenue.toFixed(0)} time / ${item.recordedDrop.toFixed(0)} actual drop / ${item.estimatedDrop.toFixed(0)} est. drop
                </span>
              ))}
            </div>
            <div>
              <h3>Event Reasons</h3>
              {state.tableEvents.filter((event: { type: string; }) => event.type === 'Failed to Start' || event.type === 'Broke').slice(-6).map((event: { id: any; type: any; reason: any; note: any; }) => (
                <span key={event.id}>{event.type}: {event.reason || 'Unspecified'}{event.note ? ` - ${event.note}` : ''}</span>
              ))}
              {!state.tableEvents.some((event: { type: string; }) => event.type === 'Failed to Start' || event.type === 'Broke') ? <span>No failed starts or breaks logged.</span> : null}
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
              {operationalOpportunities.map((item: any) => (
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
          <button className="primary-button" onClick={archiveNight}>
            <Save size={18} />
            Close Night
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

  const liveFeedItems = [
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
  ]
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
                  return <article className="waitlist-popup-row" key={interest.id}>
                    <div><strong>{interest.playerName}</strong><span>{game?.name ?? 'Unknown game'} · {interest.status === 'Confirmed Coming' ? 'Coming' : interest.status === 'Arrived' ? 'Here' : interest.status}</span></div>
                    <em>{minutesSince(interest.interestedAt)}m</em>
                    <DropdownMenu><DropdownMenuTrigger asChild><button className="icon-button" aria-label={`Actions for ${interest.playerName}`}><MoreHorizontal size={17} /></button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => deleteInterest(interest.id)}>Remove from waitlist</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
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
                    <details className="compact-details table-admin-details">
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

        <section className="panel floor-panel live-feed-panel">
          <PanelTitle icon={<MessageCircle />} title="Recent Activity" />
          <div className="live-feed-list" aria-live="polite">
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
          </div>
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
                        {game.name}{forming ? ' — forming' : ''}{demand.inRoom ? ` — ${demand.inRoom} in room` : ''}
                      </option>
                    );
                  })}
                </select>
              </label>
            ) : null}
            {state.games
              .filter((game) => game.id === (state.games.some((item) => item.id === formingGameId) ? formingGameId : state.games[0]?.id))
              .map((game: { id: any; name: any; maxSeats?: number; minInRoomForLikely?: number; minFlexibleForLikely?: number; minTotalForViable?: number; }) => {
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
                .map((interest: { gameId: any; id: any; playerName: any; status: any; interestedAt: any; manualEdits: any; arrivedAt: any; }) => {
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

        <section className={`panel floor-panel quick-add-panel ${openPanels.quickAdd ? '' : 'collapsed-panel'}`}>
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
            <div className="check-in-results">
              {checkInMatches.length ? (
                checkInMatches.map((profile) => {
                  const preferredGame = state.games.find((game) => game.id === profile.preferredGameId)?.name ?? profile.preferredStakes;
                  const inClub = inClubInterests.some(
                    (interest) => interest.profileId === profile.id || interest.playerName.toLowerCase() === profile.name.toLowerCase()
                  );
                  return (
                    <button className="check-in-result" key={profile.id} onClick={() => checkInProfileFromSearch(profile)}>
                      <span>
                        <strong>{profile.name}</strong>
                        <small>{preferredGame || 'No preferred game'}</small>
                      </span>
                      <em>{inClub ? 'In club' : 'Check in'}</em>
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
  const totalRemoved = totalDrop + totalTimeFees;
  const cashInPlay = totalBuyIns - totalCashOuts - totalRemoved;
  const entries = [
    ...buyIns.map((entry) => ({ ...entry, kind: 'Buy-in', direction: 'in' as const })),
    ...cashOuts.map((entry) => ({ ...entry, amount: entry.amount ?? 0, kind: 'Cash-out', direction: 'out' as const })),
    ...drops.map((entry) => ({ ...entry, playerName: 'House collection', kind: 'Drop', direction: 'fee' as const })),
    ...timeFees.map((entry) => ({ ...entry, kind: 'Time fee', direction: 'fee' as const }))
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
        <article><span>Drop + time</span><strong>${totalRemoved.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></article>
        <article className="cash-ledger-balance"><span>Cash in play</span><strong>${cashInPlay.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></article>
      </div>
      <div className="cash-ledger-reconcile">
        <span>Reconciliation</span>
        <code>${totalBuyIns.toLocaleString()} − ${totalCashOuts.toLocaleString()} − ${totalRemoved.toLocaleString(undefined, { maximumFractionDigits: 2 })} = ${cashInPlay.toLocaleString(undefined, { maximumFractionDigits: 2 })}</code>
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

function PanelTitle({
  icon,
  title,
  collapsed,
  onToggle
}: {
  icon: React.ReactNode;
  title: string;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className="panel-title">
      <div className="panel-title-main">
        {icon}
        <h2>{title}</h2>
      </div>
      {onToggle ? (
        <button className="icon-button panel-toggle-button" onClick={onToggle} title={collapsed ? `Open ${title}` : `Close ${title}`}>
          {collapsed ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
        </button>
      ) : null}
    </div>
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
