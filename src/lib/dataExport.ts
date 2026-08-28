import type { AccountLogin, AppState, PilotAccess, StaffAccount } from '../domain/types';
import { safeAccountKeyPart } from '../domain/licensing';

export const roomDataExportVersion = 1 as const;

const roomDataCollectionKeys = [
  'games',
  'physicalTables',
  'profiles',
  'tournaments',
  'interests',
  'sessions',
  'playerSessions',
  'buyIns',
  'dropLogs',
  'dealerAssignments',
  'handCountLogs',
  'timeFeeLogs',
  'revenueTransactions',
  'playerLedger',
  'tableEvents',
  'inAppNotifications',
  'staffRequests',
  'selfCheckIn',
  'history',
  'nightCloses',
  'feedback',
  'scriptTemplates',
  'correctionLog',
  'usageEvents'
] as const satisfies readonly (keyof Omit<AppState, 'settings'>)[];

type MissingRoomDataCollection = Exclude<
  keyof Omit<AppState, 'settings'>,
  (typeof roomDataCollectionKeys)[number]
>;

const allRoomDataCollectionsAreListed: MissingRoomDataCollection extends never ? true : never = true;
void allRoomDataCollectionsAreListed;

export type SafeStaffAccount = Pick<
  StaffAccount,
  'id' | 'name' | 'role' | 'active' | 'createdAt' | 'lastSelectedAt'
>;

export type SafePilotAccess = Pick<
  PilotAccess,
  'authorized' | 'expiresAt' | 'activatedAt' | 'issuedTo' | 'issuedAt' | 'licenseId' | 'serverManaged'
>;

export type SafeAccountLogin = Pick<AccountLogin, 'username' | 'createdAt' | 'lastLoginAt'>;

export type SafeRoomSettings = Omit<
  AppState['settings'],
  'accountLogin' | 'pilotAccess' | 'staffAccounts'
> & {
  accountLogin?: SafeAccountLogin;
  pilotAccess?: SafePilotAccess;
  staffAccounts: SafeStaffAccount[];
};

export type RoomDataExportState = Omit<AppState, 'settings'> & {
  settings: SafeRoomSettings;
};

export type RoomDataExportEnvelope = {
  app: 'Orbit';
  kind: 'room-data-export';
  version: typeof roomDataExportVersion;
  exportedAt: string;
  state: RoomDataExportState;
};

export type DownloadTextFileResult =
  | { ok: true }
  | { ok: false; error: string };

const cloneForExport = <T,>(value: T): T => structuredClone(value);

const createSafeStaffAccount = (staff: StaffAccount): SafeStaffAccount => ({
  id: staff.id,
  name: staff.name,
  role: staff.role,
  active: staff.active,
  createdAt: staff.createdAt,
  ...(staff.lastSelectedAt ? { lastSelectedAt: staff.lastSelectedAt } : {})
});

const createSafePilotAccess = (access: PilotAccess): SafePilotAccess => ({
  authorized: access.authorized,
  expiresAt: access.expiresAt,
  activatedAt: access.activatedAt,
  ...(access.issuedTo ? { issuedTo: access.issuedTo } : {}),
  ...(access.issuedAt ? { issuedAt: access.issuedAt } : {}),
  ...(access.licenseId ? { licenseId: access.licenseId } : {}),
  ...(access.serverManaged !== undefined ? { serverManaged: access.serverManaged } : {})
});

const createSafeAccountLogin = (login: AccountLogin): SafeAccountLogin => ({
  username: login.username,
  createdAt: login.createdAt,
  ...(login.lastLoginAt ? { lastLoginAt: login.lastLoginAt } : {})
});

const createSafeRoomIdentifier = (settings: AppState['settings']) =>
  safeAccountKeyPart(
    settings.clubAccount?.email ||
    settings.clubAccount?.clubName ||
    settings.accountLogin?.username ||
    settings.pilotAccess?.licenseId ||
    'local-room'
  ) || 'local-room';

const createSafeRoomSettings = (settings: AppState['settings']): SafeRoomSettings => ({
  lowLight: settings.lowLight,
  defaultCollectionMode: settings.defaultCollectionMode,
  defaultTableCap: settings.defaultTableCap,
  defaultHourlyFee: settings.defaultHourlyFee,
  defaultEstimatedDropPerSeatHour: settings.defaultEstimatedDropPerSeatHour,
  collectionProfiles: cloneForExport(settings.collectionProfiles),
  membershipPlans: cloneForExport(settings.membershipPlans),
  showPlayerGrid: settings.showPlayerGrid,
  showDashboardKpis: settings.showDashboardKpis,
  showRecentPlayers: settings.showRecentPlayers,
  ...(settings.clubAccount ? { clubAccount: cloneForExport(settings.clubAccount) } : {}),
  staffAccounts: settings.staffAccounts.map(createSafeStaffAccount),
  ...(settings.activeStaffId ? { activeStaffId: settings.activeStaffId } : {}),
  ...(settings.pilotAccess ? { pilotAccess: createSafePilotAccess(settings.pilotAccess) } : {}),
  ...(settings.accountLogin ? { accountLogin: createSafeAccountLogin(settings.accountLogin) } : {})
});

export const createRoomDataExport = (
  state: AppState,
  exportedAt = new Date().toISOString()
): RoomDataExportEnvelope => {
  const exportedCollections = Object.fromEntries(
    roomDataCollectionKeys.map((key) => [key, cloneForExport(state[key])])
  ) as Omit<AppState, 'settings'>;
  const roomIdentifier = createSafeRoomIdentifier(state.settings);

  return {
    app: 'Orbit',
    kind: 'room-data-export',
    version: roomDataExportVersion,
    exportedAt,
    state: {
      ...exportedCollections,
      usageEvents: state.usageEvents.map((event) => ({
        ...cloneForExport(event),
        accountKey: roomIdentifier
      })),
      inAppNotifications: state.inAppNotifications.map((notification) => ({
        ...cloneForExport(notification),
        clubId: roomIdentifier
      })),
      settings: createSafeRoomSettings(state.settings)
    }
  };
};

export const downloadTextFile = ({
  content,
  fileName,
  mimeType
}: {
  content: string;
  fileName: string;
  mimeType: string;
}): DownloadTextFileResult => {
  let anchor: HTMLAnchorElement | undefined;
  let objectUrl = '';

  try {
    const blob = new Blob([content], { type: mimeType });
    objectUrl = URL.createObjectURL(blob);
    anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The download could not be started.'
    };
  } finally {
    anchor?.remove();
    if (objectUrl) {
      window.setTimeout(() => {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch {
          // The download has already been handed to the browser; cleanup failure is non-fatal.
        }
      }, 0);
    }
  }
};
