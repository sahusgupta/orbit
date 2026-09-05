import type { NightCloseTable } from '../lib/nightClose';

export type AppRoute = 'floor' | 'table' | 'builder' | 'profiles' | 'signals' | 'summary' | 'customization' | 'kpis' | 'tournaments' | 'tournament-tv';
export type ReportPeriod = 'day' | 'week' | 'month' | 'year' | 'all';
export type InterestStatus =
  | 'Interested'
  | 'Confirmed Coming'
  | 'Arrived'
  | 'Seated'
  | 'Declined'
  | 'No-Show'
  | 'Left Before Seated'
  | 'Removed';
export type GameStatus = 'Running' | 'Forming' | 'Paused' | 'Closed' | 'Failed to Start';
export type TableTag =
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
export type TableCap = 6 | 8 | 10;
export type IdentityCaptureMethod = 'id-barcode' | 'id-image-pdf417' | 'id-image-ocr' | 'player-camera-pdf417';

export type PhysicalTable = {
  id: string;
  label: string;
  maxSeats: TableCap;
  createdAt: string;
};

export type GameConfig = {
  id: string;
  name: string;
  maxSeats: number;
  minInRoomForLikely: number;
  minFlexibleForLikely: number;
  minTotalForViable: number;
};

export type Interest = {
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
  expectedArrivalTime?: string;
  availabilityStartTime?: string;
  availabilityEndTime?: string;
  tableId?: string;
  notes: string;
  manualEdits?: Record<string, string>;
};

export type PlayerProfile = {
  id: string;
  name: string;
  orbitPlayerId?: string;
  email?: string;
  phone: string;
  address?: string;
  communicationPreferences?: {
    email: boolean;
    mail: boolean;
    sms: boolean;
  };
  birthday: string;
  membershipStartDate: string;
  membershipExpirationDate: string;
  membershipExpiresAt?: string;
  membershipPlan?: 'day' | 'monthly';
  membershipPaymentMethod?: 'app' | 'in-person' | 'core';
  membershipStatus?: 'Requested' | 'Approved' | 'Active' | 'Expired';
  membershipRequestedAt?: string;
  membershipPriceLabel?: string;
  membershipPlanId?: string;
  membershipPlanName?: string;
  membershipDurationDays?: number;
  membershipPaymentStatus?: 'Not required' | 'Pending' | 'Paid' | 'Failed' | 'Refunded';
  membershipPaymentTransactionId?: string;
  membershipPaymentAmountCents?: number;
  savedTimeCreditMinutes?: number;
  archivedAt?: string;
  archivedReason?: string;
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
  identityReviewStatus?: 'Pending' | 'Approved' | 'Rejected' | 'Not required';
  identityCaptureMethod?: IdentityCaptureMethod;
  identityCapturedAt?: string;
  identityReviewedAt?: string;
  identityReviewedByStaffId?: string;
};

export type GameSession = {
  id: string;
  physicalTableId?: string;
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

export type PlayerSession = {
  id: string;
  playerName: string;
  profileId?: string;
  gameId: string;
  tableId: string;
  seatNumber?: number;
  seatedAt: string;
  leftAt?: string;
  timePurchasedMinutes?: number;
  timeCreditAppliedMinutes?: number;
  timeRemainingMinutes?: number;
  lastTimeTickAt?: string;
  timeFeeEnabled?: boolean;
  manualEdits?: Record<string, string>;
};

export type BuyInLog = {
  id: string;
  profileId?: string;
  playerName: string;
  tableId: string;
  gameId: string;
  amount: number;
  timestamp: string;
  note?: string;
};

export type DropLog = {
  id: string;
  tableId: string;
  gameId: string;
  amount: number;
  timestamp: string;
  note?: string;
};

export type DealerAssignment = {
  id: string;
  tableId: string;
  gameId: string;
  dealerName: string;
  startedAt: string;
  endedAt?: string;
};

export type HandCountLog = {
  id: string;
  tableId: string;
  gameId: string;
  hands: number;
  timestamp: string;
};

export type TimeFeeLog = {
  id: string;
  playerSessionId: string;
  tableId: string;
  gameId: string;
  playerName: string;
  minutes: number;
  amount: number;
  timestamp: string;
};

export type RevenueTransaction = {
  id: string;
  type: 'membership' | 'time-package' | 'tournament_entry' | 'rebuy' | 'add_on' | 'refund' | 'other';
  amountCents: number;
  occurredAt: string;
  paymentStatus: 'paid' | 'refunded' | 'partially_refunded' | 'pending' | 'failed';
  source: 'stripe' | 'manual' | 'import';
  playerId?: string;
  playerName?: string;
  playerEmail?: string;
  membershipPlan?: string | null;
  tournamentId?: string;
  stripeEventId?: string;
};

export type PlayerLedgerEntry = {
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

export type CollectionProfile = {
  gameId: string;
  collectionMode: 'Time' | 'Drop';
  hourlyFee: number;
  estimatedDropPerSeatHour: number;
};

export type TableEventType = 'Created' | 'Started' | 'Failed to Start' | 'Broke' | 'Merged' | 'Closed';

export type TableEvent = {
  id: string;
  type: TableEventType;
  gameId: string;
  tableId?: string;
  profileId?: string;
  profileIds?: string[];
  timestamp: string;
  playerCount: number;
  reason?: string;
  note: string;
};

export type NightRecord = {
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

export type TournamentLevel = {
  id: string;
  level: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  durationMinutes: number;
  breakAfter: boolean;
  breakMinutes: number;
};

export type TournamentPlayerStatus = 'Registered' | 'Checked In' | 'Active' | 'Eliminated' | 'Finished';

export type TournamentPlayer = {
  id: string;
  registrationId?: string;
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

export type TournamentPayout = {
  place: number;
  percent: number;
};

export type TournamentStatus = 'Draft' | 'Running' | 'Paused' | 'Finished';

export type Tournament = {
  id: string;
  name: string;
  status: TournamentStatus;
  createdAt: string;
  scheduledAt?: string;
  startedAt?: string;
  pausedAt?: string;
  completedAt?: string;
  registrationOpensAt?: string;
  registrationClosesAt?: string;
  registrationStatus?: 'open' | 'closed';
  unregisterAllowed?: boolean;
  currentLevelIndex: number;
  levelStartedAt?: string;
  pausedRemainingSeconds?: number;
  buyIn: number;
  startingStack: number;
  rebuyPrizePercent: number;
  rebuysAllowed?: boolean;
  rebuyPrice?: number;
  unlimitedRebuys?: boolean;
  addOnsAllowed?: boolean;
  addOnPrice?: number;
  buyInPublished?: boolean;
  lateRegistrationThroughLevel?: number;
  tableSize: number;
  levels: TournamentLevel[];
  players: TournamentPlayer[];
  payouts: TournamentPayout[];
};

export type FeedbackEntry = {
  id: string;
  role: 'Staff' | 'Owner';
  text: string;
  createdAt: string;
};

export type CorrectionEntry = {
  id: string;
  entity: string;
  field: string;
  note: string;
  timestamp: string;
};

export type StaffRole = 'Owner' | 'Manager' | 'Floor';

export type UsageEvent = {
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

export type PilotAccess = {
  authorized: boolean;
  authorizationCode: string;
  expiresAt: string;
  activatedAt: string;
  keyFileName?: string;
  issuedTo?: string;
  issuedAt?: string;
  licenseId?: string;
  serverManaged?: boolean;
};

export type ClubAccount = {
  clubName: string;
  accountName: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  minimumPlayerAge?: 18 | 21;
};

export type StaffAccount = {
  id: string;
  name: string;
  role: StaffRole;
  pinSalt: string;
  pinHash: string;
  active: boolean;
  createdAt: string;
  lastSelectedAt?: string;
};

export type ClubMembershipPlan = {
  id: string;
  name: string;
  priceLabel: string;
  durationDays: number;
  description?: string;
  active: boolean;
};

export type NightCloseStatus = 'Draft' | 'Staff Signed' | 'Locked';

export type NightCloseAudit = {
  id: string;
  action: 'Created' | 'Saved' | 'Staff Signed' | 'Manager Approved' | 'Reopened';
  timestamp: string;
  staffId?: string;
  staffName: string;
  staffRole?: StaffRole;
  note?: string;
};

export type NightCloseRecord = {
  id: string;
  date: string;
  status: NightCloseStatus;
  createdAt: string;
  updatedAt: string;
  lockedAt?: string;
  notes: string;
  tables: NightCloseTable[];
  warnings: string[];
  staffSignOff?: NightCloseAudit;
  managerSignOff?: NightCloseAudit;
  audit: NightCloseAudit[];
};

export type AccountLogin = {
  username: string;
  passwordSalt: string;
  passwordHash: string;
  createdAt: string;
  lastLoginAt?: string;
};

export type PlayerInAppNotification = {
  id: string;
  clubId: string;
  gameId: string;
  title: string;
  body: string;
  reason: 'game-forming' | 'seat-opened' | 'membership-approved' | 'membership-activated';
  createdAt: string;
  expiresAt?: string;
  targetPlayerIds?: string[];
  targetPlayerNames?: string[];
};

export type StaffAssistanceRequest = {
  id: string;
  type: 'self-check-in-assistance';
  playerName: string;
  reason: 'not-found' | 'ambiguous';
  status: 'pending' | 'handled';
  createdAt: string;
  handledAt?: string;
  handledByStaffId?: string;
};

export type ClubSelfCheckInConfiguration = {
  capabilityGeneration: string;
  generatedAt: string;
};

export type AppState = {
  games: GameConfig[];
  physicalTables?: PhysicalTable[];
  profiles: PlayerProfile[];
  tournaments: Tournament[];
  interests: Interest[];
  sessions: GameSession[];
  playerSessions: PlayerSession[];
  buyIns: BuyInLog[];
  dropLogs: DropLog[];
  dealerAssignments: DealerAssignment[];
  handCountLogs: HandCountLog[];
  timeFeeLogs: TimeFeeLog[];
  revenueTransactions: RevenueTransaction[];
  playerLedger: PlayerLedgerEntry[];
  tableEvents: TableEvent[];
  inAppNotifications: PlayerInAppNotification[];
  staffRequests: StaffAssistanceRequest[];
  selfCheckIn?: ClubSelfCheckInConfiguration;
  history: NightRecord[];
  nightCloses: NightCloseRecord[];
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
    membershipPlans: ClubMembershipPlan[];
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

export type PersistedSettings = Partial<AppState['settings']> & {
  defaultRakeMode?: unknown;
};

export type PersistedAppState = Omit<Partial<AppState>, 'settings'> & {
  settings?: PersistedSettings;
};

export type PersistedStateRecord = {
  schemaVersion: number;
  savedAt: string;
  state: PersistedAppState;
  accountKey?: string;
  revision?: number;
  authoritative?: boolean;
  source?: 'api' | 'offline-cache' | 'local-account-migration' | string;
  publication?: {
    status?: 'not-queued' | 'pending' | 'publishing' | 'failed' | 'published' | string;
    attempts?: number;
    error?: string;
    publishedAt?: string | null;
  };
};
