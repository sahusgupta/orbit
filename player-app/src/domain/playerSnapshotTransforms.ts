import { isPlayerVisibleClubName, isPlayerVisibleGameName } from './clubVisibility';
import type { PlayerAccount, PlayerClubSnapshot, PlayerRecordDocument } from './playerSync';
import { hasUncommittedFutureRevision, selectCommittedGames, selectRevisionCompatibleRecords } from './syncProtocol';
import {
  decodePlayerMembership,
  decodePlayerNotification,
  decodePlayerWaitlist
} from './decoders/playerBoundaryDecoders';
import { decodePublishedClubRecord } from './decoders/playerSnapshotDecoders';

export function mergeSnapshotSources(...sources: PlayerClubSnapshot[][]) {
  const clubs = new Map<string, PlayerClubSnapshot>();
  sources
    .flat()
    .filter((snapshot) => isPlayerVisibleClubName(snapshot.club.name))
    .forEach((snapshot) => {
      const current = clubs.get(snapshot.club.id);
      if (!current || getSnapshotFreshness(snapshot) >= getSnapshotFreshness(current)) {
        clubs.set(snapshot.club.id, snapshot);
      }
    });
  return Array.from(clubs.values());
}

export function getSnapshotFreshness(snapshot: PlayerClubSnapshot) {
  const timestamp = Date.parse(snapshot.club.publishedAt || snapshot.generatedAt || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function buildPublishedClubSnapshot(
  clubDoc: PlayerRecordDocument,
  games: PlayerClubSnapshot['games'],
  memberships: PlayerClubSnapshot['memberships'],
  waitlists: PlayerClubSnapshot['waitlists'],
  notifications: PlayerClubSnapshot['notifications'],
  player: Pick<PlayerAccount, 'id' | 'name'>
) {
  const club = decodePublishedClubRecord(clubDoc.data());
  if (!club || !isPlayerVisibleClubName(club.name)) return null;
  const committedGames = selectCommittedGames(club, games);
  if (!committedGames) return null;
  if (
    hasUncommittedFutureRevision(club, memberships) ||
    hasUncommittedFutureRevision(club, waitlists) ||
    hasUncommittedFutureRevision(club, notifications)
  ) {
    return null;
  }
  const committedMemberships = selectRevisionCompatibleRecords(club, memberships);
  const committedWaitlists = selectRevisionCompatibleRecords(club, waitlists);
  const committedNotifications = selectRevisionCompatibleRecords(club, notifications);
  return filterSnapshotForPlayer(
    {
      club: {
        id: club.id || clubDoc.id,
        name: club.name,
        address: club.address,
        phone: club.phone,
        minimumAge: club.minimumAge,
        coordinate: club.coordinate,
        venueKind: club.venueKind,
        membershipOptions: club.membershipOptions,
        syncProtocolVersion: club.syncProtocolVersion,
        syncRevision: club.syncRevision,
        publishedAt: club.publishedAt ?? club.savedAt
      },
      games: committedGames,
      memberships: committedMemberships,
      waitlists: committedWaitlists,
      notifications: committedNotifications,
      ...(club.social ? { social: club.social } : {}),
      generatedAt: club.generatedAt ?? club.publishedAt ?? club.savedAt ?? '',
      syncProtocolVersion: club.syncProtocolVersion,
      syncRevision: club.syncRevision
    },
    player
  );
}

export function mergeClubSnapshots(clubs: PlayerClubSnapshot[]): PlayerClubSnapshot {
  const [first] = clubs;
  const { social: _firstSocial, ...firstWithoutSocial } = first;
  const social = clubs.every((club) => club.social)
    ? clubs.reduce(
      (summary, club) => ({
        activePlayerCount: summary.activePlayerCount + (club.social?.activePlayerCount ?? 0),
        adminCount: summary.adminCount + (club.social?.adminCount ?? 0),
        knownPlayersInHouse: summary.knownPlayersInHouse + (club.social?.knownPlayersInHouse ?? 0),
        waitlistCount: summary.waitlistCount + (club.social?.waitlistCount ?? 0)
      }),
      { activePlayerCount: 0, adminCount: 0, knownPlayersInHouse: 0, waitlistCount: 0 }
    )
    : undefined;
  const generatedAt = clubs
    .map((club) => club.generatedAt)
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? '';
  return {
    ...firstWithoutSocial,
    club: { id: '__all__', name: 'All Clubs' },
    games: clubs.flatMap((club) => club.games),
    memberships: clubs.flatMap((club) => club.memberships),
    waitlists: clubs.flatMap((club) => club.waitlists),
    notifications: clubs.flatMap((club) => club.notifications ?? []),
    ...(social ? { social } : {}),
    generatedAt
  };
}

export function filterSnapshotForPlayer(snapshot: PlayerClubSnapshot, player: Pick<PlayerAccount, 'id' | 'name'>): PlayerClubSnapshot {
  const id = normalizeIdentity(player.id);
  return {
    ...snapshot,
    games: snapshot.games.filter((game) => isPlayerVisibleGameName(game.name)),
    memberships: snapshot.memberships.filter((membership) => {
      const recordId = normalizeIdentity(membership.playerId);
      return Boolean(id && recordId && recordId === id);
    }),
    waitlists: snapshot.waitlists.filter((entry) => {
      const recordId = normalizeIdentity(entry.playerId);
      return Boolean(id && recordId && recordId === id);
    }),
    notifications: (snapshot.notifications ?? []).filter((notification) => {
      const targetIds = (notification.targetPlayerIds ?? []).map(normalizeIdentity).filter(Boolean);
      return Boolean(id && targetIds.includes(id));
    })
  };
}

export function decodeRevisionedMembership(value: unknown) {
  return decodePlayerMembership(value);
}

export function decodeRevisionedWaitlist(value: unknown) {
  return decodePlayerWaitlist(value);
}

export function decodeRevisionedNotification(value: unknown) {
  return decodePlayerNotification(value);
}

function normalizeIdentity(value?: string) {
  return (value ?? '').trim().toLowerCase();
}
