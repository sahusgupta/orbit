import type { PlayerRecordDocument, PlayerSyncGame } from '../playerSync';
import { decodePlayerSyncGame } from './playerBoundaryDecoders';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function publishedGameCandidate(documentId: string, value: unknown) {
  const record = asRecord(value);
  if (!record) return null;
  const publishedId = typeof record.id === 'string' && record.id.trim() ? record.id : documentId;
  return decodePlayerSyncGame({ ...record, id: publishedId });
}

/**
 * Accepts only the complete Player game projection. Partial legacy table-session
 * records are intentionally ignored: filling their missing capacity, mode,
 * labels, or timestamps would make unpublished facts appear current.
 */
export function normalizePublishedGames(gameDocs: readonly PlayerRecordDocument[]): PlayerSyncGame[] {
  return gameDocs.flatMap((gameDoc) => {
    const decoded = publishedGameCandidate(gameDoc.id, gameDoc.data());
    return decoded ? [decoded] : [];
  });
}
