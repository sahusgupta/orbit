export const orbitSyncProtocolVersion = 2;

export type OrbitSyncCommit = {
  syncProtocolVersion?: number;
  syncRevision?: string;
  publishedAt?: string;
  entityCounts?: {
    games?: number;
  };
};

export type OrbitRevisionedRecord = {
  syncRevision?: string;
  publishedAt?: string;
};

/**
 * Protocol v2 publishers write child records first and promote the parent club
 * document last. Until the parent revision and expected child count agree, the
 * mobile app keeps rendering its previous complete revision.
 */
export function selectCommittedGames<T>(
  commit: OrbitSyncCommit,
  games: T[]
): T[] | null {
  if (Number(commit.syncProtocolVersion ?? 0) < orbitSyncProtocolVersion || !commit.syncRevision) {
    const hasStagedVersionedGame = games.some(
      (game) => Boolean((game as T & OrbitRevisionedRecord).syncRevision)
    );
    if (hasStagedVersionedGame) return null;
    return games;
  }

  const committedGames = games.filter(
    (game) => (game as T & OrbitRevisionedRecord).syncRevision === commit.syncRevision
  );
  const expectedGameCount = Number(commit.entityCounts?.games);
  if (Number.isFinite(expectedGameCount) && expectedGameCount >= 0 && committedGames.length !== expectedGameCount) {
    return null;
  }

  return committedGames;
}

export function selectRevisionCompatibleRecords<T>(
  commit: OrbitSyncCommit,
  records: T[]
): T[] {
  if (
    Number(commit.syncProtocolVersion ?? 0) < orbitSyncProtocolVersion ||
    !commit.syncRevision
  ) {
    return records;
  }

  return records.filter((record) => {
    const recordRevision = (record as T & OrbitRevisionedRecord).syncRevision;
    return !recordRevision || recordRevision === commit.syncRevision;
  });
}

export function hasUncommittedFutureRevision<T>(
  commit: OrbitSyncCommit,
  records: T[]
) {
  if (Number(commit.syncProtocolVersion ?? 0) < orbitSyncProtocolVersion || !commit.syncRevision) {
    return records.some((record) => Boolean((record as T & OrbitRevisionedRecord).syncRevision));
  }
  if (!commit.publishedAt) {
    return false;
  }

  const committedAt = Date.parse(commit.publishedAt);
  if (!Number.isFinite(committedAt)) return false;

  return records.some((record) => {
    const revisionedRecord = record as T & OrbitRevisionedRecord;
    if (!revisionedRecord.syncRevision || revisionedRecord.syncRevision === commit.syncRevision) return false;
    const recordPublishedAt = Date.parse(revisionedRecord.publishedAt || '');
    return Number.isFinite(recordPublishedAt) && recordPublishedAt > committedAt;
  });
}
