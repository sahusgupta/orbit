import { describe, expect, it } from 'vitest';
import type { PlayerSyncGame } from '../domain/playerSync';
import { getInitialSeatRequestAttendance, getSeatRequestTableId, isPublishedFreeMembership } from './usePlayerClubs';

const table = (id: string, status: PlayerSyncGame['openTables'][number]['status']): PlayerSyncGame['openTables'][number] => ({
  id,
  gameId: 'game-1',
  label: id,
  status,
  seatsFilled: 4,
  maxSeats: 9,
  availableSeats: 5,
  collectionMode: 'Time',
  tags: [],
  startedAt: '2026-09-04T12:00:00.000Z',
  social: { seatedPlayerCount: 4, adminCount: 0, knownPlayersCount: 0 }
});

const game = (openTables: PlayerSyncGame['openTables']): PlayerSyncGame => ({
  id: 'game-1',
  name: '1/2 NLH',
  maxSeats: 9,
  openTables,
  waitlistCount: 0,
  formingCount: openTables.filter((candidate) => candidate.status === 'Forming').length,
  availableSeats: openTables.filter((candidate) => candidate.status === 'Running').reduce((sum, candidate) => sum + candidate.availableSeats, 0),
  knownPlayersCount: 0
});

describe('published membership fee classification', () => {
  it('treats only explicit free or zero-price labels as no-fee options', () => {
    const option = { id: 'option-1', name: 'Membership', durationDays: 30 };
    expect(isPublishedFreeMembership({ ...option, priceLabel: 'Free' })).toBe(true);
    expect(isPublishedFreeMembership({ ...option, priceLabel: '$0.00' })).toBe(true);
    expect(isPublishedFreeMembership({ ...option, priceLabel: '$40 monthly' })).toBe(false);
    expect(isPublishedFreeMembership({ ...option, priceLabel: 'Ask venue' })).toBe(false);
  });
});

describe('seat-request table and attendance selection', () => {
  it.each([
    ['Forming-only', game([table('forming', 'Forming')])],
    ['Paused-only', game([table('paused', 'Paused')])],
    ['no-table', game([])]
  ])('defaults a %s game to interest and omits table identity', (_label, selectedGame) => {
    const attendance = getInitialSeatRequestAttendance(selectedGame);
    expect(attendance).toBe('interested');
    expect(getSeatRequestTableId(selectedGame, attendance)).toBeUndefined();
  });

  it('selects the first Running table for arrived or confirmed attendance even when a Forming table appears first', () => {
    const selectedGame = game([
      table('forming-first', 'Forming'),
      table('running-second', 'Running'),
      table('running-third', 'Running')
    ]);
    expect(getInitialSeatRequestAttendance(selectedGame)).toBe('arrived');
    expect(getSeatRequestTableId(selectedGame, 'arrived')).toBe('running-second');
    expect(getSeatRequestTableId(selectedGame, 'confirmed')).toBe('running-second');
    expect(getSeatRequestTableId(selectedGame, 'interested')).toBeUndefined();
  });
});
