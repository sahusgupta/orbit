import { describe, expect, it } from 'vitest';
import { isActivePlayerGameRequest, type PlayerWaitlistEntry } from './playerSync';

const request = (status: PlayerWaitlistEntry['status']): PlayerWaitlistEntry => ({
  id: status,
  clubId: 'club-1',
  gameId: 'game-1',
  playerId: 'player-1',
  playerName: 'Alex',
  status,
  position: 1,
  requestedAt: '2026-07-31T12:00:00.000Z'
});

describe('player game flow', () => {
  it.each(['Interested', 'Confirmed Coming', 'Arrived', 'Seated'] as const)(
    'treats %s as an active game request',
    (status) => expect(isActivePlayerGameRequest(request(status))).toBe(true)
  );

  it.each(['Declined', 'No-Show', 'Left Before Seated', 'Removed'] as const)(
    'allows a game to return to discovery after %s',
    (status) => expect(isActivePlayerGameRequest(request(status))).toBe(false)
  );
});
