import type { PlayerAccount, PlayerClubSnapshot } from '../../../player-app/src/domain/playerSync';
export { applyWaitlistRequest } from '../../../player-app/src/data/playerRequests';
export { summarizeRetainedMatchHistory } from '../../../player-app/src/domain/orbitMatchAnalytics';

export const qaUid = 'local-match-qa-actor';
export function createQaInventory(nowMs = Date.now()) {
  const player: PlayerAccount = { id: qaUid, name: 'Local QA Player', email: 'local-qa@example.test', preferredGameIds: [],
    adultDeclaredAt: new Date(nowMs).toISOString(), adultDeclarationVersion: 'v1' };
  const locations = ['Austin, TX', 'Chicago, IL', 'Denver, CO', 'Las Vegas, NV'];
  const clubs: PlayerClubSnapshot[] = Array.from({ length: 24 }, (_, index) => {
    const id = `qa-venue-${String(index).padStart(2, '0')}`;
    const gameId = `${id}-nlh`;
    return {
      club: { id, name: index === 0 ? 'Local QA Riverside Community Poker Room with a deliberately long published venue name' : `Local QA Venue ${index + 1}`,
        address: `Fictional QA location, ${locations[index % 4]}`, minimumAge: 21, venueKind: 'Card house' },
      games: [{ id: gameId, name: index === 0 ? '1/2 No Limit Holdem — Community evening game with a deliberately long published title' : `${index + 1}/${index + 2} No Limit Holdem`,
        maxSeats: 9, collectionMode: 'Time', waitlistCount: 0, formingCount: 0, availableSeats: 3, knownPlayersCount: 0,
        updatedAt: new Date(nowMs).toISOString(), openTables: [{ id: `${gameId}-table`, gameId, label: 'QA table', status: 'Running', seatsFilled: 6,
          maxSeats: 9, availableSeats: 3, collectionMode: 'Time', tags: [], startedAt: new Date(nowMs - 3600000).toISOString(),
          social: { seatedPlayerCount: 6, adminCount: 0, knownPlayersCount: 0 } }] }],
      memberships: [{ id: `${id}-membership`, clubId: id, playerId: qaUid, playerName: player.name, status: 'Active',
        expiresAt: new Date(nowMs + 86400000 * 30).toISOString(), preferredGameIds: [], preferredStakes: '', clubNote: '' }],
      waitlists: [], notifications: [], generatedAt: new Date(nowMs).toISOString()
    };
  });
  return { player, clubs };
}
