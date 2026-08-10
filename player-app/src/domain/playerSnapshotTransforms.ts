import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { isPlayerVisibleClubName, isPlayerVisibleGameName } from './clubVisibility';
import type { PlayerAccount, PlayerClubSnapshot } from './playerSync';
import { hasUncommittedFutureRevision, selectCommittedGames, selectRevisionCompatibleRecords } from './syncProtocol';
import { decodePlayerRecord, decodePublishedClubRecord } from './decoders/playerSnapshotDecoders';

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
  clubDoc: QueryDocumentSnapshot,
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
        name: club.name || 'Local Poker Club',
        address: club.address,
        phone: club.phone,
        membershipOptions: club.membershipOptions,
        syncProtocolVersion: club.syncProtocolVersion,
        syncRevision: club.syncRevision,
        publishedAt: club.publishedAt ?? club.savedAt
      },
      games: committedGames,
      memberships: committedMemberships,
      waitlists: committedWaitlists,
      notifications: committedNotifications,
      social: club.social ?? { activePlayerCount: 0, adminCount: 0, knownPlayersInHouse: 0, waitlistCount: 0 },
      generatedAt: club.generatedAt ?? club.publishedAt ?? club.savedAt ?? new Date().toISOString(),
      syncProtocolVersion: club.syncProtocolVersion,
      syncRevision: club.syncRevision
    },
    player
  );
}

export function mergeClubSnapshots(clubs: PlayerClubSnapshot[]): PlayerClubSnapshot {
  const [first, ...rest] = clubs;
  return {
    ...first,
    club: { id: '__all__', name: 'All Clubs' },
    games: clubs.flatMap((club) => club.games),
    memberships: clubs.flatMap((club) => club.memberships),
    waitlists: clubs.flatMap((club) => club.waitlists),
    notifications: clubs.flatMap((club) => club.notifications ?? []),
    social: clubs.reduce(
      (summary, club) => ({
        activePlayerCount: summary.activePlayerCount + (club.social?.activePlayerCount ?? 0),
        adminCount: summary.adminCount + (club.social?.adminCount ?? 0),
        knownPlayersInHouse: summary.knownPlayersInHouse + (club.social?.knownPlayersInHouse ?? 0),
        waitlistCount: summary.waitlistCount + (club.social?.waitlistCount ?? 0)
      }),
      { activePlayerCount: 0, adminCount: 0, knownPlayersInHouse: 0, waitlistCount: 0 }
    ),
    generatedAt: new Date().toISOString(),
    // Keep the original club snapshots available to callers through the normal state merge path.
    ...(rest.length ? {} : {})
  };
}

export function filterSnapshotForPlayer(snapshot: PlayerClubSnapshot, player: Pick<PlayerAccount, 'id' | 'name'>): PlayerClubSnapshot {
  const id = normalizeIdentity(player.id);
  const name = normalizeIdentity(player.name);
  return {
    ...snapshot,
    games: snapshot.games.filter((game) => isPlayerVisibleGameName(game.name)),
    memberships: snapshot.memberships.filter((membership) =>
      Boolean(id && normalizeIdentity(membership.playerId) === id) ||
      Boolean(name && normalizeIdentity(membership.playerName) === name)
    ),
    waitlists: snapshot.waitlists.filter((entry) =>
      Boolean(id && normalizeIdentity(entry.playerId) === id) ||
      Boolean(name && normalizeIdentity(entry.playerName) === name)
    ),
    notifications: (snapshot.notifications ?? []).filter((notification) => {
      const targetIds = (notification.targetPlayerIds ?? []).map(normalizeIdentity);
      const targetNames = (notification.targetPlayerNames ?? []).map(normalizeIdentity);
      return Boolean(id && targetIds.includes(id)) || Boolean(name && targetNames.includes(name));
    })
  };
}

export function decodeRevisionedMembership(value: unknown) {
  return decodePlayerRecord<PlayerClubSnapshot['memberships'][number] & { publishedAt?: string; syncRevision?: string }>(value, 'Membership');
}

export function decodeRevisionedWaitlist(value: unknown) {
  return decodePlayerRecord<PlayerClubSnapshot['waitlists'][number] & { publishedAt?: string; syncRevision?: string }>(value, 'Waitlist');
}

export function decodeRevisionedNotification(value: unknown) {
  return decodePlayerRecord<PlayerClubSnapshot['notifications'][number] & { publishedAt?: string; syncRevision?: string }>(value, 'Notification');
}

function normalizeIdentity(value?: string) {
  return (value ?? '').trim().toLowerCase();
}
