import type { PlayerClubSnapshot } from '../playerSync';

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

export function decodeLegacyClubStateRecord(value: unknown): LegacyClubStateRecord {
  return requireRecord(value, 'Legacy club state') as LegacyClubStateRecord;
}

export function decodePublishedClubRecord(value: unknown): PublishedClubRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as PublishedClubRecord;
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
