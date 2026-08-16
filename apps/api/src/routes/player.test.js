import { describe, expect, it } from 'vitest';
import playerRoutes from './player';

describe('Player response DTOs', () => {
  it('returns player mutation fields without backend publication internals', () => {
    const response = playerRoutes.buildPlayerMutationResponse({
      accountKey: 'venue-one',
      savedAt: '2026-08-11T12:00:00.000Z',
      revision: 7,
      mutationId: 'internal-mutation-id',
      duplicate: false,
      changedEntityCount: 3,
      publication: { status: 'pending', attempts: 0 }
    }, { registrationId: 'tournament:player' });

    expect(response).toEqual({
      ok: true,
      accountKey: 'venue-one',
      savedAt: '2026-08-11T12:00:00.000Z',
      revision: 7,
      registrationId: 'tournament:player'
    });
    expect(response).not.toHaveProperty('mutationId');
    expect(response).not.toHaveProperty('duplicate');
    expect(response).not.toHaveProperty('changedEntityCount');
    expect(response).not.toHaveProperty('publication');
  });

  it('removes player-specific records from public club snapshots', () => {
    const state = {
      settings: {
        accountLogin: { username: 'club@example.com' },
        clubAccount: { clubName: 'Orbit Card House', address: '100 Main Street' },
        membershipPlans: []
      },
      games: [{ id: 'game-1', name: '1/2 NLH', maxSeats: 9 }],
      sessions: [],
      playerSessions: [],
      profiles: [{ id: 'player-1', name: 'Private Player' }],
      interests: [{
        id: 'interest-1',
        gameId: 'game-1',
        profileId: 'player-1',
        playerName: 'Private Player',
        status: 'Interested',
        interestedAt: '2026-08-12T12:00:00.000Z'
      }],
      inAppNotifications: [{
        id: 'notice-1',
        gameId: 'game-1',
        title: 'Private alert',
        body: 'A seat opened.',
        reason: 'seat-opened',
        createdAt: '2026-08-12T12:00:00.000Z',
        targetPlayerIds: ['player-1']
      }]
    };

    const snapshot = playerRoutes.buildPublicClubSnapshot(state);

    expect(snapshot.memberships).toEqual([]);
    expect(snapshot.waitlists).toEqual([]);
    expect(snapshot.notifications).toEqual([]);
    expect(snapshot.social.knownPlayersInHouse).toBe(0);
    expect(snapshot.games[0].waitlistCount).toBe(1);
  });

  it('removes non-public stress games from public club snapshots', () => {
    const state = {
      settings: {
        accountLogin: { username: 'club@example.com' },
        clubAccount: { clubName: 'Orbit Card House' },
        membershipPlans: []
      },
      games: [
        { id: 'game-1', name: '1/2 NLH', maxSeats: 9 },
        { id: 'game-2', name: 'Stress Game', maxSeats: 9 }
      ],
      sessions: [],
      playerSessions: [],
      profiles: [],
      interests: [],
      inAppNotifications: []
    };

    expect(playerRoutes.buildPublicClubSnapshot(state).games.map((game) => game.name)).toEqual(['1/2 NLH']);
  });

  it('fills a public discovery page after skipping non-public account records', async () => {
    const pages = new Map([
      ['', {
        records: [
          { accountKey: 'stress-one', state: { settings: { clubAccount: { clubName: 'Stress Club' } } } },
          { accountKey: 'test-one', state: { settings: { clubAccount: { clubName: 'Test Club' } } } }
        ],
        hasMore: true,
        nextCursor: 'test-one'
      }],
      ['test-one', {
        records: [
          { accountKey: 'aggieland', state: { settings: { clubAccount: { clubName: 'Aggieland Poker Club' } } } },
          { accountKey: 'river-room', state: { settings: { clubAccount: { clubName: 'River Room' } } } }
        ],
        hasMore: false,
        nextCursor: null
      }]
    ]);
    const listStatePage = async ({ afterAccountKey = '' }) => pages.get(afterAccountKey);

    const page = await playerRoutes.listPublicStatePage({ limit: 1 }, { listStatePage });

    expect(page.records.map((record) => record.accountKey)).toEqual(['aggieland']);
    expect(page).toMatchObject({ hasMore: true, nextCursor: 'aggieland' });
  });

  it('does not advertise another public page when only filtered records remain', async () => {
    const listStatePage = async ({ afterAccountKey = '' }) => afterAccountKey
      ? {
          records: [{ accountKey: 'stress-two', state: { settings: { clubAccount: { clubName: 'Stress Fixture' } } } }],
          hasMore: false,
          nextCursor: null
        }
      : {
          records: [{ accountKey: 'aggieland', state: { settings: { clubAccount: { clubName: 'Aggieland Poker Club' } } } }],
          hasMore: true,
          nextCursor: 'aggieland'
        };

    const page = await playerRoutes.listPublicStatePage({ limit: 1 }, { listStatePage });

    expect(page.records.map((record) => record.accountKey)).toEqual(['aggieland']);
    expect(page).toMatchObject({ hasMore: false, nextCursor: null });
  });
});
