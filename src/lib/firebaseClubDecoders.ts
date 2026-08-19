import { decodePersistedAppState } from '../domain/state';
import type { PersistedAppState } from '../domain/types';
import type { PlayerAccount, PlayerMembershipRequest, PlayerWaitlistRequest } from './playerSync';

type UnknownRecord = Record<string, unknown>;

export type FirebaseClubStateRecord = {
  accountKey?: string;
  savedAt?: string;
  state: PersistedAppState;
  snapshot?: unknown;
};

export function decodeFirebaseClubStateRecord(value: unknown): FirebaseClubStateRecord | null {
  const record = asRecord(value);
  const state = record && decodePersistedAppState(record.state);
  if (!record || !state || !hasValidPersistedStateContainers(record.state)) return null;
  return {
    ...record,
    accountKey: optionalString(record.accountKey),
    savedAt: optionalString(record.savedAt),
    state,
    snapshot: record.snapshot
  };
}

export function readPendingRequestMarker(value: unknown) {
  const record = asRecord(value);
  return {
    id: optionalString(record?.id),
    status: optionalString(record?.status)
  };
}

export function decodeMembershipRequest(value: unknown): PlayerMembershipRequest {
  const record = requireRecord(value, 'Membership request');
  const player = decodePlayerAccount(record.player);
  if (
    !isNonEmptyString(record.id) ||
    (record.type !== undefined && record.type !== 'membership-request') ||
    !isNonEmptyString(record.clubId) ||
    !player ||
    (record.plan !== 'day' && record.plan !== 'monthly') ||
    (record.paymentMethod !== 'app' && record.paymentMethod !== 'in-person') ||
    !isNonEmptyString(record.requestedAt) ||
    !isOptionalString(record.priceLabel) ||
    !isOptionalString(record.planId) ||
    !isOptionalString(record.planName) ||
    !isOptionalString(record.planPriceLabel) ||
    !isOptionalPositiveNumber(record.membershipDurationDays)
  ) {
    throw new TypeError('Membership request record is malformed.');
  }
  return {
    id: record.id,
    type: 'membership-request',
    clubId: record.clubId,
    player,
    plan: record.plan,
    paymentMethod: record.paymentMethod,
    priceLabel: record.priceLabel,
    planId: record.planId,
    planName: record.planName,
    planPriceLabel: record.planPriceLabel,
    membershipDurationDays: record.membershipDurationDays,
    requestedAt: record.requestedAt
  };
}

export function decodeWaitlistRequest(value: unknown): PlayerWaitlistRequest {
  const record = requireRecord(value, 'Waitlist request');
  const player = decodePlayerAccount(record.player);
  if (
    !isNonEmptyString(record.id) ||
    (record.type !== undefined && record.type !== 'waitlist-request') ||
    !isNonEmptyString(record.clubId) ||
    !player ||
    !isNonEmptyString(record.gameId) ||
    !isOptionalString(record.expectedArrivalTime) ||
    !isOptionalString(record.availabilityStartTime) ||
    !isOptionalString(record.availabilityEndTime) ||
    !isOptionalString(record.tableId) ||
    !isOptionalString(record.note) ||
    !isNonEmptyString(record.requestedAt)
  ) {
    throw new TypeError('Waitlist request record is malformed.');
  }
  return {
    id: record.id,
    type: 'waitlist-request',
    clubId: record.clubId,
    player,
    gameId: record.gameId,
    // The legacy consumer treated unknown action/attendance values as join/interested.
    // Normalize those values to the existing optional-field fallback.
    action: record.action === 'cancel' || record.action === 'join' ? record.action : undefined,
    attendance: isWaitlistAttendance(record.attendance) ? record.attendance : undefined,
    expectedArrivalTime: record.expectedArrivalTime,
    availabilityStartTime: record.availabilityStartTime,
    availabilityEndTime: record.availabilityEndTime,
    tableId: record.tableId,
    note: record.note,
    requestedAt: record.requestedAt
  };
}

export function readFirebaseErrorCode(value: unknown) {
  return optionalString(asRecord(value)?.code);
}

function decodePlayerAccount(value: unknown): PlayerAccount | null {
  const record = asRecord(value);
  if (
    !record ||
    !isNonEmptyString(record.id) ||
    !isNonEmptyString(record.name) ||
    typeof record.email !== 'string' ||
    (record.preferredGameIds !== undefined && !isStringArray(record.preferredGameIds)) ||
    !isOptionalString(record.phone) ||
    !isOptionalString(record.homeLocation) ||
    !isOptionalNumber(record.searchRadiusMiles) ||
    !isOptionalString(record.preferredStakes) ||
    !isOptionalString(record.typicalAvailability)
  ) {
    return null;
  }
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    phone: record.phone,
    homeLocation: record.homeLocation,
    searchRadiusMiles: record.searchRadiusMiles,
    preferredGameIds: isStringArray(record.preferredGameIds) ? record.preferredGameIds : [],
    preferredStakes: record.preferredStakes,
    typicalAvailability: record.typicalAvailability
  };
}

function requireRecord(value: unknown, label: string) {
  const record = asRecord(value);
  if (!record) throw new TypeError(`${label} record must be an object.`);
  return record;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

const persistedRecordArrayFields = [
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
  'history',
  'nightCloses',
  'feedback',
  'correctionLog',
  'usageEvents'
] as const;

function hasValidPersistedStateContainers(value: unknown) {
  const state = asRecord(value);
  if (!state) return false;
  for (const field of persistedRecordArrayFields) {
    const collection = state[field];
    if (collection !== undefined && (!Array.isArray(collection) || collection.some((item) => !asRecord(item)))) {
      return false;
    }
  }
  if (state.scriptTemplates !== undefined && !isStringArray(state.scriptTemplates)) return false;
  const settings = asRecord(state.settings);
  if (state.settings !== undefined && !settings) return false;
  for (const field of ['collectionProfiles', 'membershipPlans', 'staffAccounts'] as const) {
    const collection = settings?.[field];
    if (collection !== undefined && (!Array.isArray(collection) || collection.some((item) => !asRecord(item)))) {
      return false;
    }
  }
  return true;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function optionalString(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function isOptionalPositiveNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value) && value > 0);
}

function isWaitlistAttendance(value: unknown): value is NonNullable<PlayerWaitlistRequest['attendance']> {
  return value === 'arrived' || value === 'confirmed' || value === 'interested';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
