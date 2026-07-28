import { describe, expect, it } from 'vitest';
import { normalizePublishedGames } from './orbitSyncApi';

const gameDoc = (id: string, data: Record<string, unknown>) => ({
  id,
  data: () => data
});

describe('published game normalization', () => {
  it('uses live session records instead of stale legacy aggregate activity', () => {
    const recentTimestamp = new Date().toISOString();
    const games = normalizePublishedGames([
      gameDoc('nlh-1-2', {
        id: 'nlh-1-2',
        name: '1/2 NLH',
        maxSeats: 10,
        openTables: [{ id: 'old-table', gameId: 'nlh-1-2', status: 'Running', availableSeats: 9 }],
        availableSeats: 9,
        waitlistCount: 3
      }),
      gameDoc('current-table', {
        id: 'current-table',
        gameId: '1-1-nlh',
        gameName: '1/1 NLH',
        label: 'Table 2',
        status: 'Running',
        format: 'Time',
        timeStarted: recentTimestamp,
        updatedAt: recentTimestamp,
        players: [{ playerName: 'Alex', seatNumber: 10, leftAt: '' }],
        waitlist: []
      }),
      gameDoc('closed-table', {
        id: 'closed-table',
        gameId: '2-5-dc',
        gameName: '2/5 DC',
        status: 'Closed',
        players: [{ playerName: 'Past player', seatNumber: 1 }]
      }),
      gameDoc('abandoned-running-table', {
        id: 'abandoned-running-table',
        gameId: '5-10-roe',
        gameName: '5/10 ROE',
        status: 'Running',
        updatedAt: '2026-06-01T00:00:00.000Z',
        players: [{ playerName: 'Stale player', seatNumber: 1 }]
      })
    ] as any);

    const liveGame = games.find((game) => game.id === '1-1-nlh');
    const staleOffering = games.find((game) => game.id === 'nlh-1-2');

    expect(liveGame).toMatchObject({
      name: '1/1 NLH',
      availableSeats: 9,
      knownPlayersCount: 1,
      waitlistCount: 0
    });
    expect(liveGame?.openTables).toHaveLength(1);
    expect(liveGame?.openTables[0]).toMatchObject({
      label: 'Table 2',
      status: 'Running',
      seatsFilled: 1
    });
    expect(staleOffering).toMatchObject({
      name: '1/2 NLH',
      availableSeats: 0,
      waitlistCount: 0,
      openTables: []
    });
    expect(games.some((game) => game.id === '2-5-dc')).toBe(false);
    expect(games.some((game) => game.id === '5-10-roe')).toBe(false);
  });
});
