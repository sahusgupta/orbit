import type { PlayerClubSnapshot } from '../playerSync';
import { decodePlayerClubSnapshot } from './playerBoundaryDecoders';

export type LegacyClubStateRecord = {
  accountKey: string;
  savedAt: string;
  snapshot: PlayerClubSnapshot;
  state?: Record<string, unknown>;
};

export type PublishedClubRecord = PlayerClubSnapshot['club'] & {
  social?: PlayerClubSnapshot['social'];
  generatedAt?: string;
  savedAt?: string;
  publishedAt?: string;
  syncProtocolVersion?: number;
  syncRevision?: string;
  entityCounts?: {
    games?: number;
  };
};

export function decodeLegacyClubStateRecord(value: unknown): LegacyClubStateRecord | null {
  const record = readRecord(value);
  const snapshot = record && decodePlayerClubSnapshot(record.snapshot);
  if (!record || !snapshot) return null;
  return {
    accountKey: typeof record.accountKey === 'string' ? record.accountKey : snapshot.club.id,
    savedAt: typeof record.savedAt === 'string' ? record.savedAt : snapshot.generatedAt,
    snapshot,
    ...(readRecord(record.state) ? { state: record.state as Record<string, unknown> } : {})
  };
}

export function decodePublishedClubRecord(value: unknown): PublishedClubRecord | null {
  const record = readRecord(value);
  if (!record || (record.id !== undefined && typeof record.id !== 'string')) return null;
  const hasPublishedId = typeof record.id === 'string' && Boolean(record.id.trim());
  const decoded = decodePlayerClubSnapshot({
    club: { ...record, id: hasPublishedId ? record.id : '__document__' },
    games: [],
    memberships: [],
    waitlists: [],
    notifications: [],
    social: record.social,
    generatedAt: typeof record.generatedAt === 'string'
      ? record.generatedAt
      : typeof record.publishedAt === 'string'
        ? record.publishedAt
        : typeof record.savedAt === 'string'
          ? record.savedAt
          : '',
    syncProtocolVersion: record.syncProtocolVersion,
    syncRevision: record.syncRevision
  });
  if (!decoded) return null;
  const entityCounts = readRecord(record.entityCounts);
  return {
    ...decoded.club,
    id: hasPublishedId ? decoded.club.id : '',
    ...(decoded.social ? { social: decoded.social } : {}),
    generatedAt: decoded.generatedAt,
    ...(typeof record.savedAt === 'string' ? { savedAt: record.savedAt } : {}),
    ...(typeof record.publishedAt === 'string' ? { publishedAt: record.publishedAt } : {}),
    ...(decoded.syncProtocolVersion != null ? { syncProtocolVersion: decoded.syncProtocolVersion } : {}),
    ...(typeof decoded.syncRevision === 'string' ? { syncRevision: decoded.syncRevision } : {}),
    ...(entityCounts && typeof entityCounts.games === 'number' && Number.isInteger(entityCounts.games) && entityCounts.games >= 0
      ? { entityCounts: { games: entityCounts.games } }
      : {})
  };
}

export function decodePlayerRecord<RecordType>(value: unknown, label: string): RecordType {
  return requireRecord(value, label) as RecordType;
}

function requireRecord(value: unknown, label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} records must be objects.`);
  }
  return value as Record<string, unknown>;
}

function readRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
