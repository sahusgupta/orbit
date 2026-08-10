import type { PlayerClubSnapshot, PlayerPrivateGameListing, PlayerProfileDocument, PlayerTournament, PlayerTournamentRegistration } from '../playerSync';
import type { PlayerIdentityStatus } from '../playerIdentity';

type UnknownRecord = Record<string, unknown>;

const identityStatuses = new Set<PlayerIdentityStatus['status']>([
  'unverified',
  'requires_input',
  'processing',
  'verified',
  'underage',
  'canceled',
  'redacted'
]);

export type DecodedIdentityResponse = {
  ok: true;
  identity: PlayerIdentityStatus;
  alreadyVerified?: boolean;
  verificationUrl?: string | null;
  returnUrl?: string;
};

export function decodeIdentityResponse(value: unknown): DecodedIdentityResponse | null {
  const record = asRecord(value);
  const identity = record && decodeIdentityStatus(record.identity);
  if (!record || !identity) return null;
  return {
    ok: true,
    identity,
    ...(typeof record.alreadyVerified === 'boolean' ? { alreadyVerified: record.alreadyVerified } : {}),
    ...(typeof record.verificationUrl === 'string' || record.verificationUrl === null ? { verificationUrl: record.verificationUrl } : {}),
    ...(typeof record.returnUrl === 'string' ? { returnUrl: record.returnUrl } : {})
  };
}

export function decodeCheckoutResponse(value: unknown) {
  const record = asRecord(value);
  if (!record || typeof record.checkoutUrl !== 'string' || typeof record.sessionId !== 'string') return null;
  return { ok: true as const, checkoutUrl: record.checkoutUrl, sessionId: record.sessionId };
}

export function decodeSnapshotEnvelope(value: unknown) {
  const record = asRecord(value);
  const snapshot = record && decodePlayerClubSnapshot(record.snapshot);
  if (!record || !snapshot) return null;
  return {
    ok: true as const,
    snapshot,
    accountKey: typeof record.accountKey === 'string' ? record.accountKey : snapshot.club.id,
    ...(typeof record.savedAt === 'string' ? { savedAt: record.savedAt } : {})
  };
}

export function decodePrivateGameRecord(value: unknown): PlayerPrivateGameListing {
  return requireRecord(value, 'Private game') as PlayerPrivateGameListing;
}

export function decodeTournamentEvent(value: unknown, id: string, clubId: string): PlayerTournament {
  return {
    ...(asRecord(value) ?? {}),
    id,
    clubId
  } as PlayerTournament;
}

export function decodeTournamentRegistration(value: unknown): PlayerTournamentRegistration {
  return value as PlayerTournamentRegistration;
}

// REF-024 characterizes malformed profile objects as an unchanged passthrough.
// Keep that compatibility in one named boundary until a contract migration can reject it.
export function preserveLegacyPlayerProfile(value: unknown): PlayerProfileDocument {
  return value as PlayerProfileDocument;
}

export function readBoundaryError(value: unknown, fallback: string) {
  const record = asRecord(value);
  return typeof record?.error === 'string' ? record.error : fallback;
}

export function readFirebaseErrorCode(value: unknown) {
  const record = asRecord(value);
  return typeof record?.code === 'string' ? record.code : undefined;
}

function decodeIdentityStatus(value: unknown): PlayerIdentityStatus | null {
  const record = asRecord(value);
  if (
    !record ||
    typeof record.status !== 'string' ||
    !identityStatuses.has(record.status as PlayerIdentityStatus['status']) ||
    typeof record.ageVerified !== 'boolean' ||
    typeof record.ageLevel !== 'number' ||
    typeof record.minimumAge !== 'number' ||
    (record.verifiedAt !== null && typeof record.verifiedAt !== 'string') ||
    (record.failureCode !== null && typeof record.failureCode !== 'string')
  ) {
    return null;
  }
  return {
    status: record.status as PlayerIdentityStatus['status'],
    ageVerified: record.ageVerified,
    ageLevel: record.ageLevel,
    minimumAge: record.minimumAge,
    verifiedAt: record.verifiedAt,
    failureCode: record.failureCode
  };
}

function decodePlayerClubSnapshot(value: unknown): PlayerClubSnapshot | null {
  const record = asRecord(value);
  const club = record && asRecord(record.club);
  if (
    !record ||
    !club ||
    typeof club.id !== 'string' ||
    typeof club.name !== 'string' ||
    !Array.isArray(record.games) ||
    !Array.isArray(record.memberships) ||
    !Array.isArray(record.waitlists) ||
    (record.notifications !== undefined && !Array.isArray(record.notifications))
  ) {
    return null;
  }
  return record as PlayerClubSnapshot;
}

function requireRecord(value: unknown, label: string) {
  const record = asRecord(value);
  if (!record) throw new TypeError(`${label} records must be objects.`);
  return record;
}

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as UnknownRecord;
}
